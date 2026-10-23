"""Local web front end for the AMPL scheduling model.

Run from anywhere:   python3 web/server.py   (then open http://127.0.0.1:8321)

The server only listens on localhost. Each solve writes the .dat text to a temp
directory, runs `ampl` on a generated run script, and parses the tab-separated
report that script prints.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = Path(__file__).resolve().parent / "static"
MODEL = ROOT / "models" / "scheduling.mod"
DATA_DIRS = [ROOT / "data", ROOT / "data" / "tests"]
TESTS_RUN = ROOT / "scripts" / "tests.run"
CUSTOM_DIR = ROOT / "data" / "tests"

HOST, PORT = "127.0.0.1", int(os.environ.get("PORT", 8321))
SOLVER = os.environ.get("SOLVER", "highs")
TIMEOUT_S = 120
AMPL = shutil.which("ampl") or "/Applications/AMPL/ampl"

# Prints the instance (always) and the solution (when solved) as TSV lines.
REPORT = r'''
reset;
option solver {solver};
option solver_msg 0;
option highs_options 'time_limit={limit}';
model "{model}";
data "{data}";
printf "LOADED\n" >> "{out}";
printf "K\t%d\n", K >> "{out}";
printf {{d in DAYS}} "DAY\t%s\n", d >> "{out}";
printf {{r in ROOMS}} "ROOM\t%s\n", r >> "{out}";
printf {{f in PROFESSORS}} "PROF\t%s\n", f >> "{out}";
printf {{p in PATTERNS}} "PATTERN\t%s\n", p >> "{out}";
printf {{p in PATTERNS, d in DAYS_OF[p]}} "PATDAY\t%s\t%s\n", p, d >> "{out}";
printf {{c in COURSES}} "COURSE\t%s\t%s\t%d\n", c, instructor[c], if c in LABS then 1 else 0 >> "{out}";
printf {{c in UNLISTED}} "UNLISTED\t%s\n", c >> "{out}";
{solve_block}
close "{out}";
'''

SOLVE_BLOCK = r'''
solve;
printf "STATUS\t%s\n", solve_result >> "{out}";
printf "TIME\t%.3f\n", _solve_elapsed_time >> "{out}";
printf "SIZE\t%d\t%d\n", _nvars, _ncons >> "{out}";
if solve_result = "solved" then {{
  printf {{c in NONLABS, r in ROOMS, (p,b) in SLOTS[c]: x[c,r,p,b] > 0.5}}
    "ASSIGN\t%s\t%s\t%s\t%d\t1\n", c, r, p, b >> "{out}";
  printf {{c in LABS, r in ROOMS, (p,b) in LAB_SLOTS[c]: y[c,r,p,b] > 0.5}}
    "ASSIGN\t%s\t%s\t%s\t%d\t2\n", c, r, p, b >> "{out}";
}}
'''


def run_ampl(dat_text, solve=True):
    """Run the model on `dat_text`; return the parsed report as a dict."""
    with tempfile.TemporaryDirectory(prefix="sched-") as tmp:
        tmp = Path(tmp)
        dat, out, run = tmp / "case.dat", tmp / "report.tsv", tmp / "case.run"
        dat.write_text(dat_text)
        fmt = dict(model=MODEL, data=dat, out=out, solver=SOLVER, limit=TIMEOUT_S - 10)
        script = REPORT.format(**fmt, solve_block=SOLVE_BLOCK.format(**fmt) if solve else "")
        run.write_text(script)
        try:
            proc = subprocess.run([AMPL, str(run)], cwd=tmp, capture_output=True,
                                  text=True, timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return {"status": "timeout", "log": f"AMPL did not finish within {TIMEOUT_S}s."}
        except FileNotFoundError:
            return {"status": "error", "log": f"AMPL executable not found at {AMPL}."}
        log = (proc.stdout + proc.stderr).replace(str(tmp) + "/", "")
        report = out.read_text() if out.exists() else ""
    return parse_report(report, log, solve)


def parse_report(text, log, solve):
    res = {"status": "error", "log": log.strip(), "instance": None, "assignments": []}
    inst = {"K": 0, "days": [], "rooms": [], "professors": [], "patterns": {}, "courses": [],
            "unlisted": []}
    loaded = False
    for line in text.splitlines():
        f = line.split("\t")
        tag = f[0]
        if tag == "LOADED":
            loaded = True
        elif tag == "K":
            inst["K"] = int(f[1])
        elif tag == "DAY":
            inst["days"].append(f[1])
        elif tag == "ROOM":
            inst["rooms"].append(f[1])
        elif tag == "PROF":
            inst["professors"].append(f[1])
        elif tag == "PATTERN":
            inst["patterns"].setdefault(f[1], [])
        elif tag == "PATDAY":
            inst["patterns"].setdefault(f[1], []).append(f[2])
        elif tag == "COURSE":
            inst["courses"].append({"code": f[1], "instructor": f[2], "lab": f[3] == "1"})
        elif tag == "UNLISTED":
            inst["unlisted"].append(f[1])
        elif tag == "STATUS":
            res["status"] = f[1]
        elif tag == "TIME":
            res["solve_time"] = float(f[1])
        elif tag == "SIZE":
            res["n_vars"], res["n_cons"] = int(f[1]), int(f[2])
        elif tag == "ASSIGN":
            res["assignments"].append({"course": f[1], "room": f[2], "pattern": f[3],
                                       "block": int(f[4]), "length": int(f[5])})
    if loaded:
        res["instance"] = inst
        if not solve and "Error" not in log:
            res["status"] = "loaded"
    return res


def test_expectations():
    """Map data file -> expected result, read from the printf lines in tests.run."""
    expect, current = {}, None
    if not TESTS_RUN.exists():
        return expect
    for line in TESTS_RUN.read_text().splitlines():
        m = re.match(r"\s*data\s+(\S+?);", line)
        if m:
            current = m.group(1)
        m = re.search(r'TEST\s+(\d+)\s+(.*?)\s+expect:\s*(\w+)', line)
        if m and current:
            expect[current] = {"test": int(m.group(1)), "label": m.group(2).strip(),
                               "expect": m.group(3)}
            current = None
    return expect


def list_datasets():
    expect = test_expectations()
    out = []
    for d in DATA_DIRS:
        for p in sorted(d.glob("*.dat")):
            rel = p.relative_to(ROOT).as_posix()
            text = p.read_text()
            comment = []
            for line in text.splitlines():
                if not line.startswith("#"):
                    break
                comment.append(line.lstrip("# ").rstrip())
            out.append({"path": rel, "name": p.stem, "description": " ".join(comment),
                        **expect.get(rel, {})})
    out.sort(key=lambda d: (d.get("test", 99), d["path"]))
    return out


def resolve_dataset(rel):
    p = (ROOT / rel).resolve()
    if p.suffix != ".dat" or not any(p.parent == d.resolve() for d in DATA_DIRS) or not p.exists():
        raise ValueError(f"unknown dataset: {rel}")
    return p


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(STATIC), **kw)

    def log_message(self, fmt, *args):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if self.path == "/api/datasets":
            return self.send_json(list_datasets())
        if self.path.startswith("/api/"):
            return self.send_json({"error": "not found"}, 404)
        return super().do_GET()

    def do_POST(self):
        try:
            body = self.read_json()
            if self.path in ("/api/solve", "/api/instance"):
                if "dataset" in body:
                    text = resolve_dataset(body["dataset"]).read_text()
                else:
                    text = body.get("dat", "")
                res = run_ampl(text, solve=self.path == "/api/solve")
                res["dat"] = text
                return self.send_json(res)
            if self.path == "/api/save":
                name = body.get("name", "")
                if not re.fullmatch(r"[A-Za-z0-9_-]{1,60}", name):
                    raise ValueError("Name may only contain letters, digits, '-' and '_'.")
                p = CUSTOM_DIR / f"{name}.dat"
                if p.exists() and not body.get("overwrite"):
                    return self.send_json({"error": "exists", "path": p.relative_to(ROOT).as_posix()}, 409)
                p.write_text(body["dat"])
                return self.send_json({"path": p.relative_to(ROOT).as_posix()})
            return self.send_json({"error": "not found"}, 404)
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            return self.send_json({"error": str(e)}, 400)


if __name__ == "__main__":
    print(f"Scheduling model UI on http://{HOST}:{PORT}  (solver: {SOLVER}, ampl: {AMPL})")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
