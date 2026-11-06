# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An AMPL integer program that builds a course timetable for the ISE department (Fall 2026). It places each course in a room, a meeting pattern and a time block, with no room or professor clashes. It maximizes a `Score`: 1 point for each class meeting in a good block, minus `W` points for each same-cohort overlap.

## Commands

AMPL is installed at `/Applications/AMPL/` (`ampl`, `highs`). Run everything from the repo root, because the scripts use paths relative to it:

```sh
ampl scripts/tests.run          # runs every test case in order
```

There is no single-test runner. To run one case, use the AMPL console:

```
reset; option solver highs; model models/scheduling.mod;
data data/tests/test_room_clash.dat; solve; display solve_result;
```

Web UI: `python3 web/server.py`, then open http://127.0.0.1:8321. It uses only the Python standard library and needs no build step. Set `SOLVER=` or `PORT=` to override the defaults.

`ampl scripts/run.run` solves a single instance (Fall 2026 by default; edit its `data` line to change it) and prints the schedule as CSV to stdout.

## Model structure (`models/scheduling.mod`)

- **Time** uses integer blocks `1..K`, and `K` is given in the data (10 in the Fall 2026 data). A meeting **pattern** (`MW`, `TR`, `M`, …) is linked to days through `DAYS_OF[p]`. A slot is a pair `(pattern, block)`.
- **Two decision variables, split by course type:**
  - `x[c,r,p,b]` is for `NONLABS` and takes one block.
  - `y[c,r,p,s]` is for `LABS` and marks the lab's *start* block `s`. A lab takes blocks `s` and `s+1`, so it can only start in `LAB_BLOCKS = 1..K-1`.
- The clash constraints (`NoRoomClash`, `NoProfClash`) are indexed by **(day, block)**, not by slot. A pattern is spread over its days, and a lab adds to both block `s` and block `s+1`. `X_AT[d,b]` (pairs `(c,p)` for `x`) and `Y_AT[d,b]` (triples `(c,p,s)` for `y`) already do this expansion, so every resource constraint is `sum over X_AT + sum over Y_AT`. New constraints should use them too.
- **Department rules** are hard constraints driven by data sets, and all of them default to empty: `CLOSED` (day, block), `ROOM_CLOSED` (room, day, block), `GRAD_CLOSED` (day, block, for `GRAD_COURSES`) and `PROF_ONLY` (day, block) with `PROF_ONLY_OK` (day, block, professor). `GRAD_COURSES` is derived from course names: any name containing a 4XX number, so cross-listed `ISE334_434` counts.
- **Objective (`maximize Score`):** `good[b]` (default 1 for blocks 2–6, else 0) is earned for every (day, block) a class occupies, so labs earn per block. `Overlap[h,d,b] >= (cohort h classes in session) − 1` is subtracted with weight `W` (default 3). Both defaults can be overridden in data.
- **Cohorts** come from `COHORT_NUMS`, which is a list of (cohort, course number) pairs. A number matches every course whose name contains it as a whole number, so `172` gives `ISE172` and `ISE172_L`. That lets the same list go in every semester. `IN_COHORT` holds the matched (cohort, course) pairs, and `COHORT_MISSING` lists numbers not offered this term. That is expected for semester-specific courses; `tests.run` prints them as `not offered:` and the web UI shows them in a Cohorts callout.
- `instructor[c]` fixes the professor for each course. `SECTIONS_OF[f]` is derived from it.
- `ALLOWED_PATTERNS[c]` (from the data) limits the patterns a course may use, and `PATTERNS_OF[c]` is the set actually used. A course with no entry falls back to every pattern and is listed in `UNLISTED`. `tests.run` prints it as a `warning:` line and the web UI shows it as a callout. Because `SLOTS[c]` and `LAB_SLOTS[c]` are indexed by course, loops over assignments must use `(p,b) in SLOTS[c]`.

## Data

- `data/fall2026_sets.dat` and `data/spring2027.dat` are the real instances (Tests 0 and 7). Spring uses `K = 8` and adds rooms MO171 (ManTech lab) and PA416. Cross-listed courses (for example 334/434) are merged into one course, such as `ISE334_434`, because they share a room, an instructor and a time.
- `data/tests/*.dat` are small instances. Each one is built to be feasible or infeasible on purpose, and the comment at the top says which constraint it tests. `tests.run` prints the expected result next to `solve_result`.
- The model is the source of truth for names. Data files supply `param K` and `param instructor`, never `BLOCKS` or `SLOTS`, because the model computes those. The model requires `K > 1`, so a clash test must have more courses than the available blocks or rooms can hold. A single-block setup is not allowed.
## Web UI (`web/`)

- `server.py` writes the submitted `.dat` text to a temp directory and runs `ampl` on a generated run script (`REPORT`). That script prints the instance and the solution as tab-separated lines (`COURSE`, `PATDAY`, `ASSIGN`, …), and the server turns them into JSON. If the model's set or variable names change, update `REPORT`/`SOLVE_BLOCK` and `parse_report` together.
- The expected result for each dataset is read from the `data …;` and `TEST n … expect: X` lines in `scripts/tests.run`, so keep that format when adding tests.
- `static/app.js` is plain JavaScript with no framework.
- **The case builder is hidden** (`BUILDER_ENABLED = false` in `app.js`) until there's a real use for it. The code is intact, along with `/api/instance` and `/api/save`, so setting the flag to `true` brings back the tab and the "Open in builder" buttons. The builder creates the `.dat` text in the browser (`toDat`), and "Save" writes it to `data/tests/<name>.dat`.
- Clock times exist only in the UI (`FIRST_START`, `BLOCK_LEN`, `BLOCK_STEP` in `app.js`). Block `b` is a 75-minute slot starting at 7:55 AM + 85·(b−1) minutes, so block 1 is 7:55–9:10 AM and block 10 is 8:40–9:55 PM. The model and data use only block numbers.

## Conventions

- **AMPL segfaults (exit 139) on `reset data` + `solve`** if the model has a set indexed over another *data* set (e.g. `set S {PROF_ONLY}`) and a constraint tests membership in it. `tests.run` resets data between cases, so this kills the whole suite after Test 0 with no error message. Use a flat tuple set instead (as `PROF_ONLY_OK` does).

- `BLOCKS` is a numeric range, not an ordered set, so output code should use `b + 1` rather than `next(b, BLOCKS)`.

## To do: more soft goals

Done: early/late blocks (flat `good[b]`), cohort overlaps, and the department rules (hard). Count every new term **per meeting** (once per day in `DAYS_OF[p]`), using `X_AT`/`Y_AT` so labs count for both blocks, and add it to `Score` as a reward or a weighted penalty.

1. **Professor preferences.** Soft: a `pref` param over (professor, day, block), for example as flat triples. Hard: `UNAVAILABLE` (professor, day, block) triples, enforced like `DeptProfOnly`.
   - *Data needed:* for each professor, the times they can't teach and the times they'd rather avoid.
2. **Room fit.** `param capacity {ROOMS}` and `param enrollment {COURSES}`. Make capacity hard by filtering the rooms in the `x`/`y` index sets. Charge a soft penalty for empty seats.
   - *Data needed:* room capacities, enrollment per course (combined for cross-listed ones), lab room requirements, and any online sections.
3. **Graded block scores** (for example block 7 less bad than block 10): override `good[b]` in data.
4. **Weights:** `W` is 3 for now and should be tuned once more terms exist.
