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
- **Room eligibility lives in `ROOMS_OF[c]`**, and `x`/`y` are indexed by it, so a room a course can't use never becomes a variable. Every per-course room loop must use `r in ROOMS_OF[c]`, not `r in ROOMS`. Constraints about one physical room (`NoRoomClash`, `DeptRoomClosed`) loop over `ROOMS` and keep only courses with `r in ROOMS_OF[c]` (this also drops online courses). New room rules should be filters in `ROOMS_OF`, not new constraints. The filters:
  - **Online:** `ONLINE` courses (default empty) get the pseudo-room `{"Online"}` and skip every other rule. Everything else still applies to them: professor clash, cohorts, department closures, professor availability and the score. In the web UI they appear in "Online" rows of the timetable (one row per course meeting at the same time) and are left out of the "Room use" percentage.
  - **Room table:** `param: ROOMS: capacity controlled remote_ready`. The defaults (`0`, `1`, `0`) let a data file list plain `set ROOMS` and have every room usable, which the small tests rely on. `capacity` is shown in the web UI only and isn't enforced (see the to-do list). A course may only use `controlled = 1` rooms, unless a room is dedicated to it.
  - **Dedicated rooms:** `DEDICATED_TO` holds (room, entry) pairs. An entry is a course name (`ISE308_408` means that course only) or a course number matched like `COHORT_NUMS` (`216` gives `ISE216_L1` and `ISE216_L2`). It applies both ways: a matching course may only use its dedicated rooms, and a dedicated room may only be used by matching courses. Rows for rooms not in `ROOMS` are ignored. `DEDICATED` holds the matched (room, course) pairs.
  - **Remote async sections:** courses in `REMOTE` (default empty) may only use `remote_ready = 1` rooms.
  - An in-person course with no eligible room is listed in `NO_ROOM`. The model is then infeasible, and `tests.run` prints a `warning: no eligible room:` line while the web UI shows a callout.
- **Department rules** are hard constraints driven by data sets, and all of them default to empty: `CLOSED` (day, block), `ROOM_CLOSED` (room, day, block), and `GRAD_CLOSED` (day, block, for `GRAD_COURSES`). `GRAD_COURSES` is derived from course names: any name containing a 4XX number, so cross-listed `ISE334_434` counts.
- **Professor availability:** `PROF_CLOSED` (professor, day, block) is hard (`ProfClosed`). The department's "only these four professors on Thursday block 4" rule is written as `PROF_CLOSED` rows for every other professor, so **a new professor must be added there** unless they're allowed then.
- **Preferences (soft)** are two weighted tables, read as tabular `param: SET: param` blocks:
  - `PREF_BLOCK` (who, block, weight) goes from −1 (avoid) to 1 (want). Unlisted blocks are 0.
  - `PREF_PATTERN` (who, pattern, weight) goes from 0 to 1. If someone lists any pattern, their unlisted patterns get 0. With no pattern rows, every pattern gets 1. It only scales `PREF_BLOCK`.
  - `who` is a professor (applies to all their courses) or a course. If a course has any row of its own, its professor's rows are ignored for it (`PREF_COURSES`, `pref_key`). Professor and course names must not overlap, which a `check` enforces.
  - A course earns `W_PREF` × pattern weight × block weight (`pref_x` / `pref_y`; a two-block meeting averages its two blocks), so between −`W_PREF` and `W_PREF`. Days aren't keyed separately, because the pattern carries them.
  - The Spring 2027 rows come from faculty requests. Derya is assumed to be Pamukcu, and Nyberg's new project management course is assumed to be ISE336_436. Zimmers' ISE254 TR 12:10 can't be met, because Tue block 4 is `CLOSED`.
- **Objective (`maximize Score`):** one-block courses earn `good[b]` based on their assigned block, while two-block courses earn the average of `good[b]` and `good[b+1]`, so each course has a maximum time-quality score of 1. Each same-cohort course pair that overlaps at least once during the week is counted once through `Overlap[h,c1,c2]` and penalized by `W` (default 3). Preferences add between −`W_PREF` and `W_PREF` per course.
- **Cohorts** come from `COHORT_NUMS`, which is a list of (cohort, course number) pairs. A number matches every course whose name contains it as a whole number, so `172` gives `ISE172` and `ISE172_L`. That lets the same list go in every semester. `IN_COHORT` holds the matched (cohort, course) pairs, and `COHORT_MISSING` lists numbers not offered this term. That is expected for semester-specific courses; `tests.run` prints them as `not offered:` and the web UI shows them in a Cohorts callout.
- `instructor[c]` fixes the professor for each course. `SECTIONS_OF[f]` is derived from it.
- `ALLOWED_PATTERNS[c]` (from the data) limits the patterns a course may use, and `PATTERNS_OF[c]` is the set actually used. A course with no entry falls back to every pattern and is listed in `UNLISTED`. `tests.run` prints it as a `warning:` line and the web UI shows it as a callout. Because `SLOTS[c]` and `LAB_SLOTS[c]` are indexed by course, loops over assignments must use `(p,b) in SLOTS[c]`.

## Data

- `data/fall2026_sets.dat` and `data/spring2027.dat` are the real instances (Tests 0 and 7). Both use only the four rooms ISE controls (MO121 computing lab, MO375, MO451, MO453), and all four are remote-ready. MO355/365 isn't under ISE control and is left out. Spring uses `K = 8` and adds two uncontrolled rooms through `DEDICATED_TO`: MO171 (ManTech, only for 216) and PA416 (Packard, only for the `ISE308_408` lecture, the largest class). Each semester file carries its own copy of the room table. Room capacities: MO121 38, MO171 25, MO355/365 64, MO375 32, MO451 63 (56 seats plus 7 tablet-arm chairs), MO453 48, PA416 139. Cross-listed courses (for example 334/434) are merged into one course, such as `ISE334_434`, because they share a room, an instructor and a time.
- `data/tests/*.dat` are small instances. Each one is built to be feasible or infeasible on purpose, and the comment at the top says which constraint it tests. `tests.run` prints the expected result next to `solve_result`.
- The model is the source of truth for names. Data files supply `param K` and `param instructor`, never `BLOCKS` or `SLOTS`, because the model computes those. The model requires `K > 1`, so a clash test must have more courses than the available blocks or rooms can hold. A single-block setup is not allowed.
## Web UI (`web/`)

- `server.py` writes the submitted `.dat` text to a temp directory and runs `ampl` on a generated run script (`REPORT`). That script prints the instance and the solution as tab-separated lines (`COURSE`, `PATDAY`, `ASSIGN`, …), and the server turns them into JSON. If the model's set or variable names change, update `REPORT`/`SOLVE_BLOCK` and `parse_report` together.
- The expected result for each dataset is read from the `data …;` and `TEST n … expect: X` lines in `scripts/tests.run`, so keep that format when adding tests.
- `static/app.js` is plain JavaScript with no framework.
- **Theme:** the page follows the OS until the sun/moon button (right of the tabs) is clicked; a click sets `data-theme` on `<html>` to the other theme and saves it in `localStorage`. An inline script in `index.html` applies it before the first paint. Dark colors appear twice in `app.css` (under the media query and under `:root[data-theme="dark"]`), so change both copies together.
- **The case builder is hidden** (`BUILDER_ENABLED = false` in `app.js`) until there's a real use for it. The code is intact, along with `/api/instance` and `/api/save`, so setting the flag to `true` brings back the tab and the "Open in builder" buttons. The builder creates the `.dat` text in the browser (`toDat`), and "Save" writes it to `data/tests/<name>.dat`.
- Clock times exist only in the UI (`FIRST_START`, `BLOCK_LEN`, `BLOCK_STEP` in `app.js`). Block `b` is a 75-minute slot starting at 7:55 AM + 85·(b−1) minutes, so block 1 is 7:55–9:10 AM and block 10 is 8:40–9:55 PM. The model and data use only block numbers.

## Conventions

- **AMPL segfaults (exit 139) on `reset data` + `solve`** if the model has a set indexed over another *data* set (e.g. `set S {CLOSED}`) and a constraint tests membership in it. `tests.run` resets data between cases, so this kills the whole suite after Test 0 with no error message. Use a flat tuple set instead (as `PROF_CLOSED`, `PREF_BLOCK` and `PREF_PATTERN` do).

- `BLOCKS` is a numeric range, not an ordered set, so output code should use `b + 1` rather than `next(b, BLOCKS)`.

## To do

Done: early/late block scores, professor closed times and preferences, same-cohort course-pair overlaps, online courses, and the department rules (hard). Time-quality terms are scored per course rather than per meeting occurrence; `X_AT`/`Y_AT` are still used for constraints that need to know which courses are active at each day/block.

### Rooms (remaining)

Built: the room table, the controlled-room rule, dedicated rooms, remote-ready rooms and the "no eligible room" warning (see Model structure). Still open:

1. **Capacity (not enforced on purpose).** ISE has no fixed enrollment caps. Registration opens at 30 or 40 and the cap grows until it reaches room capacity, so the room sets the cap rather than the other way round. `capacity` is stored and shown. If big courses need steering to big rooms, prefer a soft "expected size" score (or a `DEDICATED_TO` row, as with 308/408 and PA416) over a hard `capacity >= enrollment` rule.
2. **`REMOTE` list.** It's empty, and every ISE room is remote-ready, so the rule has no effect yet. It's there for new rooms or other departments. Fill it in once the courses with remote async sections are known.
3. **Lab rooms.** `LABS` means "two-block meeting" (how long it lasts), which is not the same as "needs lab equipment". `ISE254_W` and `ISE382_482` are two-block meetings in regular rooms. If some courses need the MO121 computing lab, add a course set and a room flag, filtered in `ROOMS_OF` like `REMOTE`.
4. **Shared room file.** Move the room table to a shared `rooms.dat` only if the per-semester copies drift apart (the web UI and `tests.run` load one file).

### Recitations (planned, not built)

7. **Recitation sections.** `ISE308_408_L` is actually a recitation, not a lab. Model recitations as a separate course set linked to their parent lecture (e.g. (recitation, lecture) pairs, or matched by number). Likely rules, all to confirm:
   - A recitation must not overlap its parent lecture. This is probably hard, since every student attends both.
   - It's probably on a different day from the lecture, or after the lecture's first meeting of the week.
   - Several sections of one recitation are alternatives: a student takes one, so they shouldn't count as cohort overlaps with each other. The same applies to `ISE216_L1`/`L2`.
   - Who teaches it: the instructor (then `NoProfClash` applies) or a TA (then the professor clash shouldn't apply)? A TA would need an instructor value that isn't a real professor, or a new "TA" marker.
   - Room needs: a regular room, or a lab room?
   - Open: which other courses have recitations, and does `ISE308_408_W` (a one-block Friday meeting) count as one?

### Other

8. **Professor data:** Spring 2027 preferences are in. Fall has none yet. Requests can be per course, so write course-specific ones against the course (`ISE240 4 1`), not the professor.
9. **Graded block scores** (for example block 7 less bad than block 10): override `good[b]` in data.
10. **Weights:** `W` (cohort overlap) is 3 and `W_PREF` is 1 for now. A preferred evening block (`good` = 0, preference = 1) ties with an unpreferred daytime block, so the evening side of preferences like Paredes' "after 5 PM" can win arbitrarily. Tune `W_PREF` against `good[b]`.
11. **`CLOSED` and online courses:** `CLOSED` currently blocks online courses too. That assumes the closed times are department-wide events, not just room shortages, so confirm it.
12. **Data to collect** (from the user's supervisor): which courses have a remote async section, which need the computing lab, and which have recitations.
