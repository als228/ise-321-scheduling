# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An AMPL integer program that builds a course timetable for the ISE department (Fall 2026). It places each course in a room, a meeting pattern and a time block, with no room or professor clashes. The objective is still a placeholder (`minimize NoObjective: 0`), so the model is currently only a feasibility check.

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
- The clash constraints (`NoRoomClash`, `NoProfClash`) are indexed by **(day, block)**, not by slot. A pattern is spread over its days, and a lab adds to both block `s` and block `s+1`. Any new resource constraint should follow the same day/block expansion.
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

- `BLOCKS` is a numeric range, not an ordered set, so output code should use `b + 1` rather than `next(b, BLOCKS)`.

## To do: replace the placeholder objective

None of this is implemented yet. Count every penalty **per meeting** (once per day in `DAYS_OF[p]`), and charge labs for both blocks `s` and `s+1`. The plan is to make non-negotiable rules hard constraints and combine soft goals as `minimize Total: w_time*TimeCost + w_pref*PrefCost + w_room*RoomCost + w_cohort*sum Overlap`.

1. **Avoid early and late blocks.** Add `param block_cost {BLOCKS} default 0` and an optional `day_cost {DAYS}`, then build `TimeCost` from them. This adds no new variables.
   - *Data needed:* which blocks are bad and how much they should cost (e.g. block 1 = 2, blocks 9 and 10 = 3), whether any block is banned outright, and whether Friday should be avoided.
2. **Professor preferences.** Soft: `param pref_cost {PROFESSORS, DAYS, BLOCKS} default 0`. Hard: `set UNAVAILABLE within {PROFESSORS, DAYS, BLOCKS}`, enforced by a `ProfUnavailable` constraint with the same left-hand side as `NoProfClash` and a right-hand side of 0.
   - *Data needed:* for each professor, the times they can't teach and the times they'd rather avoid, plus whether some professors' preferences count more.
3. **Room fit.** Add `param capacity {ROOMS}` and `param enrollment {COURSES}`. Make capacity hard through `ROOMS_FOR[c] = {r: capacity[r] >= enrollment[c]}`, which restricts the `x`/`y` index sets. Add a soft `RoomCost` that charges for empty seats (`capacity - enrollment`). An optional `SUITABLE_ROOMS[c]` can limit which rooms the labs use.
   - *Data needed:* capacities of MO121, MO355, MO375, MO451 and MO453; enrollment per course (combined for cross-listed ones); any room requirements for labs; and whether any sections are online, so they need no room.
4. **Cohort conflicts.** Add `set COHORTS` and `set COURSES_OF {COHORTS}`, then a hard `NoCohortClash` constraint shaped like `NoProfClash`. If that is infeasible, make it soft with `Overlap {COHORTS, DAYS, BLOCKS} >= 0` on the right-hand side and penalize the overlaps.
   - *Data needed:* which courses are taken together in the same semester, whether 400-level and cross-listed courses share students with undergraduate cohorts, and the fixed times of any outside courses (math, physics) that should be blocked.
5. **Weights.** *Data needed:* a ranking of the soft goals, e.g. professor preferences > early/late blocks > room fit.

Items 1 and 5 alone are enough to replace `NoObjective`. The others can be added as their data comes in.
