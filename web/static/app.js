"use strict";

// ===================== state =====================
const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
                    Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const PALETTE = ["#3b6ea8", "#b5563a", "#3f8f6b", "#8a5aa8", "#b08a2e", "#2f8f9d", "#a8476e",
                 "#6b7f2a", "#5560b0", "#8c6239", "#4a9bd1", "#c0443f", "#5f6b7a", "#b04fa0", "#c27c1a"];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The case builder is hidden until it has a use (see CLAUDE.md). Set to true to bring it back.
const BUILDER_ENABLED = false;

// Block b is a 75-minute class; blocks start 85 minutes apart, from 7:55 AM
// (block 1 = 7:55-9:10 AM, ..., block 10 = 8:40-9:55 PM).
const FIRST_START = 7 * 60 + 55, BLOCK_LEN = 75, BLOCK_STEP = 85;
const blockStart = (b) => FIRST_START + (b - 1) * BLOCK_STEP;
const blockEnd = (b) => blockStart(b) + BLOCK_LEN;
const meridiem = (min) => (min % 1440 < 720 ? "AM" : "PM");
const clock = (min) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")}`;
const clockFull = (min) => `${clock(min)} ${meridiem(min)}`;
// "7:55–9:10 AM", or "11:30 AM–12:45 PM" when the range crosses noon.
function timeRange(b, len = 1) {
  const a = blockStart(b), z = blockEnd(b + len - 1);
  return meridiem(a) === meridiem(z) ? `${clock(a)}–${clockFull(z)}` : `${clockFull(a)}–${clockFull(z)}`;
}
const timeLabel = (b) => `<span class="t-start">${clockFull(blockStart(b))}</span><span class="t-end">${clockFull(blockEnd(b))}</span>`;

const state = {
  view: "datasets",
  datasets: [],
  testRuns: {},        // dataset path -> {status, pass}
  running: null,       // dataset path or "builder" or "all"
  builder: sampleCase(),
  result: null,        // last solve response, plus {source, expect}
  sched: { mode: "timetable", day: "all", room: null, prof: null, sort: ["course", 1] },
};

function sampleCase() {
  return {
    name: "my_case",
    description: "Small example built in the case builder",
    K: 4,
    days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    rooms: ["R1", "R2"],
    professors: ["P1", "P2"],
    patterns: [{ name: "MW", days: ["Mon", "Wed"] }, { name: "TR", days: ["Tue", "Thu"] }],
    courses: [
      { code: "A", instructor: "P1", lab: false },
      { code: "B", instructor: "P2", lab: false },
      { code: "L1", instructor: "P2", lab: true },
    ],
  };
}

// ===================== utils =====================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayName = (d) => DAY_NAMES[d] || d;

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok && res.status !== 409) throw new Error(data.error || `HTTP ${res.status}`);
  return Object.assign(data, { httpStatus: res.status });
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function statusBadge(status) {
  const label = { solved: "Solved", infeasible: "Infeasible", error: "Error", timeout: "Timed out" }[status] || status;
  const cls = ["solved", "infeasible", "error", "timeout"].includes(status) ? status : "";
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

const spinner = '<span class="spin" aria-hidden="true"></span>';

// ===================== navigation =====================
function setView(view) {
  if (view === "builder" && !BUILDER_ENABLED) view = "datasets";
  state.view = view;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  if (state.view === "datasets") renderDatasets();
  if (state.view === "builder") renderBuilder();
  if (state.view === "schedule") renderSchedule();
  const badge = $("#tab-badge");
  badge.hidden = !state.result;
  if (state.result) badge.className = `tab-badge ${state.result.status}`;
}

// ===================== running the model =====================
async function solveDataset(ds, { show = true } = {}) {
  const res = await api("/api/solve", { dataset: ds.path });
  res.source = ds.name;
  res.expect = ds.expect;
  if (ds.expect) state.testRuns[ds.path] = { status: res.status, pass: res.status === ds.expect };
  if (show) { state.result = res; resetSchedView(); }
  return res;
}

function resetSchedView() {
  const inst = state.result?.instance;
  state.sched.day = "all";
  state.sched.room = inst?.rooms[0] ?? null;
  state.sched.prof = inst?.professors[0] ?? null;
}

async function runOne(path) {
  const ds = state.datasets.find((d) => d.path === path);
  state.running = path;
  renderDatasets();
  try {
    await solveDataset(ds);
    state.running = null;
    setView("schedule");
  } catch (e) {
    state.running = null;
    renderDatasets();
    toast(e.message);
  }
}

async function runAll() {
  state.running = "all";
  const tests = state.datasets.filter((d) => d.expect);
  for (const ds of tests) delete state.testRuns[ds.path];
  renderDatasets();
  try {
    for (const ds of tests) {
      await solveDataset(ds, { show: false });
      renderDatasets();
    }
  } catch (e) {
    toast(e.message);
  }
  state.running = null;
  renderDatasets();
}

async function openInBuilder(path) {
  const ds = state.datasets.find((d) => d.path === path);
  try {
    const res = await api("/api/instance", { dataset: path });
    if (!res.instance || res.status === "error") throw new Error("Could not load this dataset in AMPL.");
    state.builder = caseFromInstance(res.instance, `${ds.name}_copy`, ds.description);
    setView("builder");
    toast(`Loaded ${ds.name} into the builder`);
  } catch (e) {
    toast(e.message);
  }
}

function caseFromInstance(inst, name, description) {
  return {
    name, description: description || "",
    K: inst.K,
    days: [...inst.days],
    rooms: [...inst.rooms],
    professors: [...inst.professors],
    patterns: Object.entries(inst.patterns).map(([n, days]) => ({ name: n, days: [...days] })),
    courses: inst.courses.map((c) => ({ ...c })),
  };
}

// ===================== datasets view =====================
function renderDatasets() {
  const el = $("#view-datasets");
  const tests = state.datasets.filter((d) => d.expect);
  const done = tests.filter((d) => state.testRuns[d.path]);
  const passed = done.filter((d) => state.testRuns[d.path].pass).length;
  const busy = !!state.running;

  const rows = state.datasets.map((d) => {
    const run = state.testRuns[d.path];
    let result = '<span class="muted">—</span>';
    if (state.running === "all" && d.expect && !run) result = `<span class="muted small">Waiting…</span>`;
    if (run) result = `${statusBadge(run.status)} <span class="badge plain ${run.pass ? "pass" : "fail"}">${run.pass ? "Pass" : "Fail"}</span>`;
    return `
      <tr>
        <td class="mono muted">${d.test ?? ""}</td>
        <td><div class="ds-name">${esc(d.name)}</div><div class="ds-path">${esc(d.path)}</div></td>
        <td class="ds-desc">${esc(d.description) || '<span class="muted">No description</span>'}</td>
        <td>${d.expect ? `<span class="badge outline plain">${esc(d.expect)}</span>` : '<span class="muted small">Not in tests.run</span>'}</td>
        <td class="nowrap">${result}</td>
        <td class="actions">
          ${BUILDER_ENABLED ? `<button class="btn sm ghost" data-act="edit" data-path="${esc(d.path)}" ${busy ? "disabled" : ""}>Open in builder</button>` : ""}
          <button class="btn sm" data-act="run" data-path="${esc(d.path)}" ${busy ? "disabled" : ""}>
            ${state.running === d.path ? spinner : ""}Run</button>
        </td>
      </tr>`;
  }).join("");

  el.innerHTML = `
    <div class="view-head">
      <div>
        <h2>Datasets</h2>
        <p>Data files in <code>data/</code> and <code>data/tests/</code>. Expected results come from
        <code>scripts/tests.run</code>. Run a file to see its schedule, or run every test case and compare against the expected results.</p>
      </div>
      <div class="run-summary">
        ${done.length ? `<span class="badge ${passed === tests.length ? "pass" : done.length === tests.length ? "fail" : ""}">${passed} / ${tests.length} passed</span>` : ""}
        <button class="btn primary" id="run-all" ${busy || !tests.length ? "disabled" : ""}>
          ${state.running === "all" ? spinner : ""}Run all tests</button>
      </div>
    </div>
    <div class="card table-wrap">
      <table class="data">
        <thead><tr><th>#</th><th>Dataset</th><th>Description</th><th>Expected</th><th>Last result</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">No .dat files found.</td></tr>'}</tbody>
      </table>
    </div>`;

  $("#run-all").onclick = runAll;
  $$("[data-act=run]", el).forEach((b) => (b.onclick = () => runOne(b.dataset.path)));
  $$("[data-act=edit]", el).forEach((b) => (b.onclick = () => openInBuilder(b.dataset.path)));
}

// ===================== builder =====================
function validate(c) {
  const issues = [];
  const checkList = (label, list) => {
    if (!list.length) issues.push(`Add at least one ${label}.`);
    const seen = new Set();
    for (const v of list) {
      if (!IDENT.test(v)) issues.push(`${label} “${v || "(blank)"}” must start with a letter or _ and use only letters, digits and _.`);
      else if (seen.has(v)) issues.push(`Duplicate ${label} “${v}”.`);
      seen.add(v);
    }
  };
  if (!Number.isInteger(c.K) || c.K < 2) issues.push("Blocks per day (K) must be an integer of at least 2.");
  checkList("day", c.days);
  checkList("room", c.rooms);
  checkList("professor", c.professors);
  checkList("pattern", c.patterns.map((p) => p.name));
  checkList("course", c.courses.map((x) => x.code));
  for (const p of c.patterns) {
    if (!p.days.length) issues.push(`Pattern “${p.name || "(blank)"}” meets on no days.`);
  }
  for (const x of c.courses) {
    if (!c.professors.includes(x.instructor)) issues.push(`Course “${x.code || "(blank)"}” needs an instructor.`);
  }
  return issues;
}

function toDat(c) {
  const list = (xs) => xs.join("  ");
  const pad = (s) => s.padEnd(11);
  const lines = [];
  for (const l of (c.description || "").split("\n")) if (l.trim()) lines.push(`# ${l.trim()}`);
  lines.push(`# ${c.name} -- created in the web case builder`, "");
  lines.push(`set ${pad("COURSES")}:= ${list(c.courses.map((x) => x.code))} ;`);
  lines.push(`set ${pad("LABS")}:= ${list(c.courses.filter((x) => x.lab).map((x) => x.code))} ;`);
  lines.push(`set ${pad("PROFESSORS")}:= ${list(c.professors)} ;`);
  lines.push(`set ${pad("ROOMS")}:= ${list(c.rooms)} ;`);
  lines.push(`set ${pad("DAYS")}:= ${list(c.days)} ;`);
  lines.push(`param ${"K".padEnd(9)}:= ${c.K} ;`);
  lines.push(`set ${pad("PATTERNS")}:= ${list(c.patterns.map((p) => p.name))} ;`);
  for (const p of c.patterns) {
    const days = c.days.filter((d) => p.days.includes(d));
    lines.push(`set DAYS_OF[${p.name}] := ${list(days)} ;`);
  }
  lines.push("", "param instructor :=");
  const w = Math.max(...c.courses.map((x) => x.code.length), 4);
  c.courses.forEach((x, i) =>
    lines.push(`  ${x.code.padEnd(w)}  ${x.instructor}${i === c.courses.length - 1 ? " ;" : ""}`));
  return lines.join("\n") + "\n";
}

function tagEditor(key, values, placeholder) {
  return `
    <div class="tags" data-tags="${key}">
      ${values.map((v, i) => `<span class="tag">${esc(v)}<button title="Remove" data-rm="${key}" data-i="${i}">×</button></span>`).join("")}
      <input class="chip-input" data-add="${key}" placeholder="${esc(placeholder)}" aria-label="Add ${key}">
    </div>`;
}

function renderBuilder(focusKey) {
  const c = state.builder;
  const el = $("#view-builder");
  const dsOptions = state.datasets.map((d) => `<option value="${esc(d.path)}">${esc(d.name)}</option>`).join("");

  const patternRows = c.patterns.map((p, i) => `
    <tr>
      <td style="width:120px"><input class="input" data-pat-name="${i}" value="${esc(p.name)}"></td>
      <td><div class="day-toggles">${c.days.map((d) => `
        <button class="day-toggle ${p.days.includes(d) ? "on" : ""}" data-pat="${i}" data-day="${esc(d)}">${esc(d)}</button>`).join("")}
      </div></td>
      <td><button class="btn icon ghost" title="Remove pattern" data-rm-pat="${i}">×</button></td>
    </tr>`).join("");

  const courseRows = c.courses.map((x, i) => `
    <tr>
      <td><input class="input" data-course-code="${i}" value="${esc(x.code)}"></td>
      <td><select class="input" data-course-prof="${i}">
        <option value="" ${c.professors.includes(x.instructor) ? "" : "selected"} disabled>Choose…</option>
        ${c.professors.map((f) => `<option ${f === x.instructor ? "selected" : ""}>${esc(f)}</option>`).join("")}
      </select></td>
      <td style="width:110px"><label class="check"><input type="checkbox" data-course-lab="${i}" ${x.lab ? "checked" : ""}> 2-block lab</label></td>
      <td><button class="btn icon ghost" title="Remove course" data-rm-course="${i}">×</button></td>
    </tr>`).join("");

  el.innerHTML = `
    <div class="view-head">
      <div>
        <h2>Case builder</h2>
        <p>Set up your own instance. The model’s rules apply: each course meets once in one pattern and block,
        and a lab takes two blocks in a row, so it can’t start in block K.</p>
      </div>
      <div class="row">
        <select class="input" id="load-src" style="width:200px">${dsOptions}</select>
        <button class="btn" id="load-btn">Load</button>
        <button class="btn ghost" id="reset-btn">Start from example</button>
      </div>
    </div>

    <div class="builder">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>Case</h3></div>
          <div class="card-body stack">
            <div class="grid-2">
              <label class="field"><span>File name</span>
                <input class="input mono" id="b-name" value="${esc(c.name)}"></label>
              <label class="field"><span>Blocks per day (K)</span>
                <input class="input" id="b-K" type="number" min="2" step="1" value="${c.K}"></label>
            </div>
            <label class="field"><span>Description (saved as a comment at the top of the file)</span>
              <textarea class="input" id="b-desc" rows="2">${esc(c.description)}</textarea></label>
            <div class="field"><span>Days</span>${tagEditor("days", c.days, "Add day, press Enter")}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Rooms and professors</h3></div>
          <div class="card-body stack">
            <div class="field"><span>Rooms</span>${tagEditor("rooms", c.rooms, "Add room, press Enter")}</div>
            <div class="field"><span>Professors</span>${tagEditor("professors", c.professors, "Add professor, press Enter")}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Meeting patterns</h3><span class="hint">Pick the days each pattern meets</span></div>
          <div class="card-body">
            <table class="edit"><thead><tr><th>Name</th><th>Days</th><th></th></tr></thead>
              <tbody>${patternRows}</tbody></table>
            <button class="btn sm" id="add-pat" style="margin-top:8px">+ Add pattern</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Courses</h3><span class="hint">${c.courses.length} total · ${c.courses.filter((x) => x.lab).length} labs</span></div>
          <div class="card-body">
            <table class="edit"><thead><tr><th>Code</th><th>Instructor</th><th>Type</th><th></th></tr></thead>
              <tbody>${courseRows}</tbody></table>
            <button class="btn sm" id="add-course" style="margin-top:8px">+ Add course</button>
          </div>
        </div>
      </div>

      <aside class="builder-side" id="builder-side"></aside>
    </div>`;

  bindBuilder(el);
  renderBuilderSide();
  if (focusKey) $(`[data-add="${focusKey}"]`, el)?.focus();
}

function renderBuilderSide() {
  const c = state.builder;
  const issues = validate(c);
  const side = $("#builder-side");
  if (!side) return;
  const dat = issues.length ? "" : toDat(c);
  side.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Summary</h3></div>
      <div class="card-body stack">
        <div class="summary-grid">
          <div><b>${c.courses.length}</b><span>Courses</span></div>
          <div><b>${c.rooms.length}</b><span>Rooms</span></div>
          <div><b>${c.professors.length}</b><span>Professors</span></div>
          <div><b>${c.patterns.length}</b><span>Patterns</span></div>
          <div><b>${c.days.length}</b><span>Days</span></div>
          <div><b>${Number.isInteger(c.K) ? c.K : "–"}</b><span>Blocks / day</span></div>
        </div>
        ${issues.length
          ? `<ul class="issues">${issues.slice(0, 8).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
          : `<div class="ok-line">✓ Ready to run</div>`}
        <div class="row">
          <button class="btn primary" id="b-run" ${issues.length || state.running ? "disabled" : ""}>
            ${state.running === "builder" ? spinner : ""}Run model</button>
          <button class="btn" id="b-save" ${issues.length ? "disabled" : ""}>Save to data/tests</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Generated .dat</h3>
        <button class="btn sm ghost" id="b-copy" ${dat ? "" : "disabled"}>Copy</button></div>
      <div class="card-body">${dat ? `<pre class="code">${esc(dat)}</pre>` : '<p class="muted small" style="margin:0">Fix the issues above to see the generated file.</p>'}</div>
    </div>`;

  $("#b-run").onclick = runBuilder;
  $("#b-save").onclick = saveBuilder;
  $("#b-copy").onclick = () => navigator.clipboard.writeText(dat).then(() => toast("Copied to clipboard"));
}

function bindBuilder(el) {
  const c = state.builder;
  const soft = renderBuilderSide;      // text edits: refresh side panel only, keep focus
  const hard = () => renderBuilder();  // structural edits: re-render the form

  $("#load-btn").onclick = () => openInBuilder($("#load-src").value);
  $("#reset-btn").onclick = () => { state.builder = sampleCase(); hard(); };
  $("#b-name").oninput = (e) => { c.name = e.target.value.trim(); soft(); };
  $("#b-desc").oninput = (e) => { c.description = e.target.value; soft(); };
  $("#b-K").oninput = (e) => { c.K = Number(e.target.value); soft(); };

  $$("[data-add]", el).forEach((inp) => {
    inp.onkeydown = (e) => {
      if (e.key !== "Enter" && e.key !== ",") return;
      e.preventDefault();
      const key = inp.dataset.add;
      const vals = inp.value.split(/[\s,]+/).filter(Boolean);
      if (!vals.length) return;
      for (const v of vals) if (!c[key].includes(v)) c[key].push(v);
      renderBuilder(key);
    };
  });
  $$("[data-rm]", el).forEach((b) => (b.onclick = () => {
    const key = b.dataset.rm;
    const [gone] = c[key].splice(Number(b.dataset.i), 1);
    if (key === "days") c.patterns.forEach((p) => (p.days = p.days.filter((d) => d !== gone)));
    hard();
  }));

  $$("[data-pat-name]", el).forEach((inp) => (inp.oninput = () => {
    c.patterns[inp.dataset.patName].name = inp.value.trim(); soft();
  }));
  $$("[data-pat]", el).forEach((b) => (b.onclick = () => {
    const p = c.patterns[b.dataset.pat], d = b.dataset.day;
    p.days = p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d];
    hard();
  }));
  $$("[data-rm-pat]", el).forEach((b) => (b.onclick = () => { c.patterns.splice(b.dataset.rmPat, 1); hard(); }));
  $("#add-pat").onclick = () => { c.patterns.push({ name: `P${c.patterns.length + 1}`, days: [] }); hard(); };

  $$("[data-course-code]", el).forEach((inp) => (inp.oninput = () => {
    c.courses[inp.dataset.courseCode].code = inp.value.trim(); soft();
  }));
  $$("[data-course-prof]", el).forEach((s) => (s.onchange = () => {
    c.courses[s.dataset.courseProf].instructor = s.value; soft();
  }));
  $$("[data-course-lab]", el).forEach((cb) => (cb.onchange = () => {
    c.courses[cb.dataset.courseLab].lab = cb.checked; hard();
  }));
  $$("[data-rm-course]", el).forEach((b) => (b.onclick = () => { c.courses.splice(b.dataset.rmCourse, 1); hard(); }));
  $("#add-course").onclick = () => {
    let n = c.courses.length + 1;
    while (c.courses.some((x) => x.code === `C${n}`)) n++;
    c.courses.push({ code: `C${n}`, instructor: c.professors[0] || "", lab: false });
    hard();
  };
}

async function runBuilder() {
  state.running = "builder";
  renderBuilderSide();
  try {
    const res = await api("/api/solve", { dat: toDat(state.builder) });
    res.source = `${state.builder.name} (builder)`;
    state.result = res;
    resetSchedView();
    state.running = null;
    setView("schedule");
  } catch (e) {
    state.running = null;
    renderBuilderSide();
    toast(e.message);
  }
}

async function saveBuilder() {
  const c = state.builder;
  try {
    let res = await api("/api/save", { name: c.name, dat: toDat(c) });
    if (res.httpStatus === 409) {
      if (!confirm(`${res.path} already exists. Overwrite it?`)) return;
      res = await api("/api/save", { name: c.name, dat: toDat(c), overwrite: true });
    }
    state.datasets = await api("/api/datasets");
    toast(`Saved ${res.path}`);
  } catch (e) {
    toast(e.message);
  }
}

// ===================== schedule =====================
function derive(res) {
  const inst = res.instance;
  const course = Object.fromEntries(inst.courses.map((c) => [c.code, c]));
  const color = Object.fromEntries(inst.professors.map((f, i) =>
    [f, i < PALETTE.length ? PALETTE[i] : `hsl(${(i * 137) % 360} 40% 48%)`]));
  const items = res.assignments.map((a) => ({
    ...a,
    instructor: course[a.course]?.instructor ?? "?",
    lab: a.length > 1,
    days: inst.patterns[a.pattern] || [],
  }));
  return { inst, items, color };
}

function chip(it, color, sub, style) {
  const blocks = timeRange(it.block, it.length);
  const title = `${it.course}${it.lab ? " (lab)" : ""}\n${it.instructor} · ${it.room}\n${it.pattern} (${it.days.join(", ")}) · ${blocks}`;
  return `<div class="chip" style="--c:${color[it.instructor]};${style}" data-course="${esc(it.course)}"
            data-prof="${esc(it.instructor)}" title="${esc(title)}">
            <b>${esc(it.course)}${it.lab ? '<span class="lab-tag">Lab</span>' : ""}</b><span>${esc(sub)}</span></div>`;
}

// Grid with row labels down the side and block or day columns across the top.
function gridHTML({ cols, rows, rowLabel, colLabel, corner, colWidth, labelWidth, items, numRows }) {
  const tmpl = `grid-template-columns: ${labelWidth} repeat(${cols.length}, minmax(${colWidth}, 1fr));`;
  const minW = `min-width: calc(${labelWidth} + ${cols.length} * ${colWidth});`;
  let html = `<div class="hcell corner" style="grid-row:1;grid-column:1">${esc(corner)}</div>`;
  cols.forEach((c, j) => {
    html += `<div class="hcell ${j === cols.length - 1 ? "last-col" : ""}" style="grid-row:1;grid-column:${j + 2}">${colLabel(c)}</div>`;
  });
  rows.forEach((r, i) => {
    const last = i === rows.length - 1 ? "last-row" : "";
    html += `<div class="rcell ${numRows ? "num" : ""} ${last}" style="grid-row:${i + 2};grid-column:1">${rowLabel(r)}</div>`;
    cols.forEach((_, j) => {
      html += `<div class="cell ${last} ${j === cols.length - 1 ? "last-col" : ""}" style="grid-row:${i + 2};grid-column:${j + 2}"></div>`;
    });
  });
  return `<div class="grid-scroll"><div class="tgrid" style="${tmpl}${minW}">${html}${items}</div></div>`;
}

const blockRange = (K) => Array.from({ length: K }, (_, i) => i + 1);

function timetableView({ inst, items, color }) {
  const days = state.sched.day === "all" ? inst.days : [state.sched.day];
  return days.map((d) => {
    const today = items.filter((it) => it.days.includes(d));
    const chips = today.map((it) => chip(it, color, it.instructor,
      `grid-row:${inst.rooms.indexOf(it.room) + 2};grid-column:${it.block + 1} / span ${it.length}`)).join("");
    return `
      <div class="day-block">
        <div class="day-title"><h3>${esc(dayName(d))}</h3><span>${today.length} meeting${today.length === 1 ? "" : "s"}</span></div>
        ${gridHTML({ cols: blockRange(inst.K), rows: inst.rooms, rowLabel: esc, colLabel: timeLabel,
                     corner: "Room", colWidth: "104px", labelWidth: "96px", items: chips })}
      </div>`;
  }).join("");
}

function weekView({ inst, items, color }, key, value) {
  const mine = items.filter((it) => it[key] === value);
  const chips = mine.flatMap((it) => it.days.map((d) => chip(it, color,
    key === "room" ? it.instructor : it.room,
    `grid-row:${it.block + 1} / span ${it.length};grid-column:${inst.days.indexOf(d) + 2}`))).join("");
  return gridHTML({ cols: inst.days, rows: blockRange(inst.K), rowLabel: timeLabel, colLabel: (d) => esc(dayName(d)),
                    corner: "Time", colWidth: "130px", labelWidth: "92px", items: chips, numRows: true });
}

function listView({ items, color }) {
  const [key, dir] = state.sched.sort;
  const val = (it) => key === "block" ? it.block : key === "type" ? (it.lab ? 1 : 0) : String(it[key]);
  const sorted = [...items].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const th = (k, label) => `<th class="sortable" data-sort="${k}">${label}${key === k ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`;
  return `
    <div class="card table-wrap"><table class="data">
      <thead><tr>${th("course", "Course")}${th("type", "Type")}${th("instructor", "Instructor")}${th("room", "Room")}
        ${th("pattern", "Pattern")}<th>Days</th>${th("block", "Time")}</tr></thead>
      <tbody>${sorted.map((it) => `
        <tr data-course="${esc(it.course)}" data-prof="${esc(it.instructor)}">
          <td class="mono">${esc(it.course)}</td>
          <td>${it.lab ? "Lab" : "Lecture"}</td>
          <td><span class="legend-item" style="--c:${color[it.instructor]}"><i></i>${esc(it.instructor)}</span></td>
          <td class="mono">${esc(it.room)}</td>
          <td class="mono">${esc(it.pattern)}</td>
          <td>${esc(it.days.join(", "))}</td>
          <td class="nowrap">${timeRange(it.block, it.length)}</td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function exportCSV({ items }) {
  const rows = [["course", "type", "instructor", "room", "pattern", "days", "start_block", "end_block", "start_time", "end_time"]];
  for (const it of items) rows.push([it.course, it.lab ? "lab" : "lecture", it.instructor, it.room, it.pattern,
    it.days.join(" "), it.block, it.block + it.length - 1,
    clockFull(blockStart(it.block)), clockFull(blockEnd(it.block + it.length - 1))]);
  const blob = new Blob([rows.map((r) => r.join(",")).join("\n") + "\n"], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob), download: `${state.result.source.split(" ")[0]}_schedule.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderSchedule() {
  const el = $("#view-schedule");
  const res = state.result;
  if (!res) {
    el.innerHTML = `<div class="card empty">
      <h3>No schedule yet</h3>
      <p>Run a dataset${BUILDER_ENABLED ? " or build your own case" : ""}, and the result will appear here.</p>
      <div class="row" style="justify-content:center;margin-top:16px">
        <button class="btn ${BUILDER_ENABLED ? "" : "primary"}" data-go="datasets">Browse datasets</button>
        ${BUILDER_ENABLED ? `<button class="btn primary" data-go="builder">Open case builder</button>` : ""}</div></div>`;
    $$("[data-go]", el).forEach((b) => (b.onclick = () => setView(b.dataset.go)));
    return;
  }

  const inst = res.instance;
  const solved = res.status === "solved" && inst;
  const d = solved ? derive(res) : null;
  const used = d ? d.items.reduce((s, it) => s + it.length * it.days.length, 0) : 0;
  const cap = inst ? inst.rooms.length * inst.days.length * inst.K : 0;
  const expectNote = res.expect
    ? `<span class="badge plain ${res.status === res.expect ? "pass" : "fail"}">${res.status === res.expect ? "Matches expected" : `Expected ${esc(res.expect)}`}</span>` : "";

  const stat = (label, v) => `<div class="stat"><span>${label}</span><b>${v}</b></div>`;
  const header = `
    <div class="card">
      <div class="card-body result-head">
        <div>
          <div class="result-title"><h2>${esc(res.source)}</h2>${statusBadge(res.status)}${expectNote}</div>
          <div class="muted small" style="margin-top:4px">HiGHS via AMPL${res.n_vars != null ? ` · ${res.n_vars} binary variables, ${res.n_cons} constraints` : ""}</div>
        </div>
        ${solved ? `<button class="btn sm" id="csv">Export CSV</button>` : ""}
      </div>
      ${inst ? `<div class="stats">
        ${stat("Courses", inst.courses.length)}
        ${stat("Labs", inst.courses.filter((c) => c.lab).length)}
        ${stat("Rooms", inst.rooms.length)}
        ${stat("Professors", inst.professors.length)}
        ${stat("Blocks / day", inst.K)}
        ${solved ? stat("Room use", `${Math.round((100 * used) / cap)}%`) : ""}
        ${res.solve_time != null ? stat("Solve time", `${res.solve_time.toFixed(2)} s`) : ""}
      </div>` : ""}
      <details class="disclose"><summary>Input data</summary><div><pre class="code">${esc(res.dat)}</pre></div></details>
      <details class="disclose" ${res.status === "error" || res.status === "timeout" ? "open" : ""}>
        <summary>AMPL log</summary><div><pre class="code">${esc(res.log || "(no output)")}</pre></div></details>
    </div>`;

  const unlisted = inst && inst.unlisted && inst.unlisted.length ? `<div class="callout warn"><div class="mark">!</div><div>
      <h3>${inst.unlisted.length} course${inst.unlisted.length === 1 ? " has" : "s have"} no allowed patterns</h3>
      <p>${inst.unlisted.map(esc).join(", ")} ${inst.unlisted.length === 1 ? "has" : "have"} no <code>ALLOWED_PATTERNS</code>
      entry in the data, so the model lets ${inst.unlisted.length === 1 ? "it" : "them"} use every pattern.</p></div></div>` : "";

  let body = "";
  if (res.status === "infeasible") {
    body = `<div class="callout warn"><div class="mark">!</div><div>
      <h3>No feasible schedule</h3>
      <p>No combination of rooms, patterns and blocks satisfies every constraint. Each course must be scheduled once, with
      no room or professor teaching two things in the same block on the same day. Labs take two blocks in a row.
      To get a feasible case, add rooms, blocks or patterns, or spread courses across more professors.</p></div></div>`;
  } else if (!solved) {
    body = `<div class="callout err"><div class="mark">×</div><div>
      <h3>${res.status === "timeout" ? "The solver timed out" : "AMPL reported an error"}</h3>
      <p>See the AMPL log above for details. This usually means the data file uses a name or set the model doesn’t define.</p></div></div>`;
  } else {
    const s = state.sched;
    const count = (k, v) => d.items.filter((it) => it[k] === v).length;
    let controls = "", content = "";
    if (s.mode === "timetable") {
      controls = `<div class="pills">${["all", ...inst.days].map((x) =>
        `<button class="pill ${s.day === x ? "on" : ""}" data-day="${esc(x)}">${x === "all" ? "All days" : esc(dayName(x))}</button>`).join("")}</div>`;
      content = timetableView(d);
    } else if (s.mode === "room" || s.mode === "prof") {
      const key = s.mode === "room" ? "room" : "instructor";
      const list = s.mode === "room" ? inst.rooms : inst.professors;
      const cur = s.mode === "room" ? s.room : s.prof;
      controls = `<div class="pills">${list.map((x) => `
        <button class="pill ${cur === x ? "on" : ""}" data-pick="${esc(x)}" ${s.mode === "prof" ? `style="--c:${d.color[x]}"` : ""}>
          ${s.mode === "prof" ? '<span class="dot"></span>' : ""}${esc(x)} <span class="count">${count(key, x)}</span></button>`).join("")}</div>`;
      content = weekView(d, key, cur);
    } else {
      content = listView(d);
    }
    body = `
      <div class="card"><div class="card-body stack">
        <div class="toolbar">
          <div class="segmented">
            ${[["timetable", "Timetable"], ["room", "By room"], ["prof", "By professor"], ["list", "List"]].map(([m, l]) =>
              `<button class="${s.mode === m ? "on" : ""}" data-mode="${m}">${l}</button>`).join("")}
          </div>
          ${s.mode === "timetable" || s.mode === "list" ? `<div class="legend">${inst.professors.map((f) =>
            `<span class="legend-item" data-prof="${esc(f)}" style="--c:${d.color[f]}"><i></i>${esc(f)}</span>`).join("")}</div>` : ""}
        </div>
        ${controls}
        <div id="sched-content">${content}</div>
      </div></div>`;
  }

  el.innerHTML = `<div class="stack">${header}${unlisted}${body}</div>`;
  bindSchedule(el, d);
}

function bindSchedule(el, d) {
  const s = state.sched;
  $("#csv", el)?.addEventListener("click", () => exportCSV(d));
  $$("[data-mode]", el).forEach((b) => (b.onclick = () => { s.mode = b.dataset.mode; renderSchedule(); }));
  $$("[data-day]", el).forEach((b) => (b.onclick = () => { s.day = b.dataset.day; renderSchedule(); }));
  $$("[data-pick]", el).forEach((b) => (b.onclick = () => {
    s[s.mode === "room" ? "room" : "prof"] = b.dataset.pick; renderSchedule();
  }));
  $$("[data-sort]", el).forEach((th) => (th.onclick = () => {
    s.sort = [th.dataset.sort, s.sort[0] === th.dataset.sort ? -s.sort[1] : 1]; renderSchedule();
  }));

  // Hover a course to highlight all its meetings; hover a legend entry to highlight that professor.
  const box = $("#sched-content", el);
  if (!box) return;
  const highlight = (attr, value) => {
    box.classList.toggle("focus", !!value);
    $$("[data-course]", box).forEach((n) => n.classList.toggle("hl", !!value && n.dataset[attr] === value));
  };
  box.addEventListener("mouseover", (e) => {
    const n = e.target.closest("[data-course]");
    highlight("course", n?.dataset.course);
  });
  box.addEventListener("mouseleave", () => highlight("course", null));
  $$(".legend [data-prof]", el).forEach((n) => {
    n.onmouseenter = () => highlight("prof", n.dataset.prof);
    n.onmouseleave = () => highlight("prof", null);
  });
}

// ===================== boot =====================
$$(".tab").forEach((t) => (t.onclick = () => setView(t.dataset.view)));
$('.tab[data-view="builder"]').hidden = !BUILDER_ENABLED;
api("/api/datasets")
  .then((ds) => { state.datasets = ds; render(); })
  .catch(() => toast("Could not reach the server. Is web/server.py running?"));
setView("datasets");
