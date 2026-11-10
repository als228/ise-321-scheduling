# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An AMPL integer program that builds a course timetable for the ISE department (Fall 2026). It places each course in a room, a meeting pattern and a time block, with no room or professor clashes. It maximizes a `Score`: each course earns a time-quality score based on its assigned block(s), minus `W` points for each overlapping same-cohort course pair.

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
- **Online courses:** `ONLINE` (subset of `COURSES`, default empty) is placed in the pseudo-room `"Online"` through `ROOMS_OF[c]`. That means `{"Online"}` for online courses and `ROOMS` for the rest, and `x`/`y` are indexed by it. Every per-course room loop must use `r in ROOMS_OF[c]`, not `r in ROOMS`. Constraints about physical rooms (`NoRoomClash`, `DeptRoomClosed`, and the future capacity rule) loop over `ROOMS` and skip `c in ONLINE`. Everything else still applies to online courses: professor clash, cohorts, department closures, professor availability and the score. In the web UI they appear in "Online" rows of the timetable (one row per course meeting at the same time) and are left out of the "Room use" percentage.
- **Department rules** are hard constraints driven by data sets, and all of them default to empty: `CLOSED` (day, block), `ROOM_CLOSED` (room, day, block), and `GRAD_CLOSED` (day, block, for `GRAD_COURSES`). `GRAD_COURSES` is derived from course names: any name containing a 4XX number, so cross-listed `ISE334_434` counts.
- **Professor availability** uses (professor, day, block) triples. `PROF_CLOSED` is hard (`ProfClosed`). `PROF_PREF` is soft: a course earns `W_PREF` (default 1) times the share of its meeting-blocks that fall in its professor's preferred times (`pref_x` / `pref_y`). Unlisted blocks are still allowed. The department's "only these four professors on Thursday block 4" rule is written as `PROF_CLOSED` rows for every other professor, so **a new professor must be added there** unless they're allowed then.
- **Objective (`maximize Score`):** one-block courses earn `good[b]` based on their assigned block, while two-block courses earn the average of `good[b]` and `good[b+1]`, so each course has a maximum time-quality score of 1. Each same-cohort course pair that overlaps at least once during the week is counted once through `Overlap[h,c1,c2]` and penalized by `W` (default 3). Preferences add up to `W_PREF` per course.
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

- **AMPL segfaults (exit 139) on `reset data` + `solve`** if the model has a set indexed over another *data* set (e.g. `set S {CLOSED}`) and a constraint tests membership in it. `tests.run` resets data between cases, so this kills the whole suite after Test 0 with no error message. Use a flat tuple set instead (as `PROF_CLOSED` and `PROF_PREF` do).

- `BLOCKS` is a numeric range, not an ordered set, so output code should use `b + 1` rather than `next(b, BLOCKS)`.

## To do

Done: early/late block scores, professor closed times and preferences, same-cohort course-pair overlaps, online courses, and the department rules (hard). Time-quality terms are scored per course rather than per meeting occurrence; `X_AT`/`Y_AT` are still used for constraints that need to know which courses are active at each day/block.

### Room properties (planned design, not built)

Every room rule below should be a **filter on `ROOMS_OF[c]`**, not a new constraint. A room a course can't use never becomes a variable. All room eligibility then lives in one definition, and `NoRoomClash` stays unchanged. Online courses keep `{"Online"}` and skip every room rule.

0. **"No eligible room" warning (build first).** With filters, a course whose room list ends up empty makes the model infeasible with no hint. Add a derived set of such courses and report it like `UNLISTED`: as a `warning:` in `tests.run` and as a callout in the web UI.
1. **Room table.** One row per room with `capacity`, `hybrid` (0/1) and `lab_ok` (0/1), read as an AMPL tabular `param:` block. Room data doesn't change, but copy it into each semester file for now (the web UI and `tests.run` load one file). Move it to a shared `rooms.dat` only if the copies drift apart.
2. **Capacity (hard).** A course may only use rooms with `capacity >= enrollment`.
   - `enrollment` is per semester and lives in each semester file. Use the **registrar's enrollment cap**, not actual enrollment, since the cap is known before registration. Cross-listed courses use their combined cap.
   - **Placeholder:** `capacity = 50` for every room until real counts arrive (the user is asking their supervisor). Courses with a cap above 50 will have no eligible room, which is what item 0 catches.
   - **SMALL/MEDIUM/BIG size classes:** use them only to fill in `capacity` (each class's *guaranteed* seat count, e.g. small = 30) and keep the numbers in the model. Comparing categories directly is wrong: a 35-student "medium" course and a 31-seat "medium" room match by category but don't fit.
   - Open: may a course go slightly over capacity? What happens to a course with no enrollment (any room plus a warning, or an error)?
3. **Wasted seats (soft, optional).** Penalize the share of empty seats, `(capacity − enrollment) / capacity`, times a weight, so each course costs at most that weight. This matches the per-course scoring.
4. **Hybrid rooms.** MO121, MO451 and MO453 are hybrid. The rest are 0 until confirmed by the user's supervisor.
   - Courses needing a hybrid room: an explicit set (preferred), possibly drafted from a rule such as "all 4XX". A hybrid course may only use hybrid rooms.
   - Open: does capacity count only in-person students for hybrid courses (two enrollment numbers)? Should regular courses be softly steered away from hybrid rooms to keep them free? Do online courses ever need a hybrid room to broadcast from?
5. **Lab rooms.** `LABS` means "two-block meeting" (how long it lasts), which is **not** the same as "needs lab equipment". `ISE254_W` and `ISE382_482` are two-block meetings in regular rooms, and `ISE308_408_L` is one block. Add a separate course set for "needs a lab room" (it could start as a copy of `LABS` and then be fixed by hand). Such a course may only use rooms with `lab_ok = 1`.
   - Open: which courses need a lab room besides 216? Should lectures be kept out of lab rooms in general (a per-room "lab only" flag)?
6. **Dedicated rooms.** MO171 (ManTech) is only for ISE216, and ISE216 may only use MO171. Add a (room, course number) list matched by number like `COHORT_NUMS`, so `216` covers `ISE216_L1` and `ISE216_L2`. It applies in both directions: a matching course may only use that room, and that room may only be used by matching courses. MO171 is only in the Spring room list, so Fall is unaffected.
   - Open: is PA416 dedicated to 308/408, or is that just where it was placed?

### Recitations (planned, not built)

7. **Recitation sections.** `ISE308_408_L` is actually a recitation, not a lab. Model recitations as a separate course set linked to their parent lecture (e.g. (recitation, lecture) pairs, or matched by number). Likely rules, all to confirm:
   - A recitation must not overlap its parent lecture. This is probably hard, since every student attends both.
   - It's probably on a different day from the lecture, or after the lecture's first meeting of the week.
   - Several sections of one recitation are alternatives: a student takes one, so they shouldn't count as cohort overlaps with each other. The same applies to `ISE216_L1`/`L2`.
   - Who teaches it: the instructor (then `NoProfClash` applies) or a TA (then the professor clash shouldn't apply)? A TA would need an instructor value that isn't a real professor, or a new "TA" marker.
   - Room needs: a regular room, or a lab room?
   - Open: which other courses have recitations, and does `ISE308_408_W` (a one-block Friday meeting) count as one?

### Other

8. **Professor data:** fill `PROF_CLOSED` and `PROF_PREF` once availability is collected.
9. **Graded block scores** (for example block 7 less bad than block 10): override `good[b]` in data.
10. **Weights:** `W` (cohort overlap) is 3 and `W_PREF` is 1 for now. Tune them once more terms exist.
11. **`CLOSED` and online courses:** `CLOSED` currently blocks online courses too. That assumes the closed times are department-wide events, not just room shortages, so confirm it.
12. **Data to collect** (from the user's supervisor):
    - seat counts and hybrid status for MO121, MO171, MO355, MO375, MO451, MO453 and PA416;
    - enrollment caps per course for each semester;
    - which courses are hybrid, which need a lab room, and which have recitations.
