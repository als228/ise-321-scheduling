# ===================== SETS =====================
set COURSES ordered;  # ordered so each cohort course pair can be counted only once
set LABS within COURSES;
set NONLABS = COURSES diff LABS;
set PROFESSORS;
set ROOMS;                        # physical rooms
set DAYS;

# Courses taught fully online. They are placed in the pseudo-room "Online",
# which has no clash limit (and, later, no capacity). Everything else still
# applies: professor clash, cohorts, department closures, professor
# availability and the time score.
set ONLINE within COURSES default {};
check: "Online" not in ROOMS;

# ===================== ROOM PROPERTIES =====================
# Read from a tabular  param: ROOMS: capacity controlled remote_ready := ...
# block. The defaults let a data file list plain ROOMS and have every room
# usable by every course.
param capacity {ROOMS} >= 0 default 0;          # seats; 0 = unknown (shown only, not enforced)
param controlled {ROOMS} binary default 1;      # 1 = the department may book it freely
param remote_ready {ROOMS} binary default 0;    # 1 = equipped for a remote async section

# courses with a remote async section: may only use remote_ready rooms
set REMOTE within COURSES default {};

# (room, course) pairs that reserve a room. An entry is either a course name
# (ISE308_408: that course only) or a course number (216: every course whose
# name contains it as a whole number, like COHORT_NUMS). It works both ways:
# a matching course may only use its dedicated rooms, and a dedicated room
# may only be used by matching courses. Rooms not in ROOMS are ignored, so
# one list can go in every semester.
set DEDICATED_TO dimen 2 default {};
set DEDICATED = {r in ROOMS, c in COURSES: exists {(r2,n) in DEDICATED_TO: r2 = r}
    (c = n or match(c, "(^|[^0-9])" & n & "([^0-9]|$)") > 0 and n not in COURSES)};
set DEDICATED_ROOMS   = setof {(r,c) in DEDICATED} r;
set DEDICATED_COURSES = setof {(r,c) in DEDICATED} c;

# Every room rule is a filter here, so a room a course can't use never
# becomes a variable:
#   dedicated course    -> its dedicated rooms
#   any other course    -> controlled rooms that aren't dedicated to anything
#   remote async course -> additionally only remote_ready rooms
set ROOMS_OF {c in COURSES} =
    if c in ONLINE then {"Online"}
    else {r in ROOMS:
            ((c in DEDICATED_COURSES and (r,c) in DEDICATED) or
             (c not in DEDICATED_COURSES and controlled[r] = 1
                                         and r not in DEDICATED_ROOMS))
            and (c not in REMOTE or remote_ready[r] = 1)};

# in-person courses left with no room: the model is then infeasible, so
# this is reported as a warning
set NO_ROOM = {c in COURSES diff ONLINE: card(ROOMS_OF[c]) = 0};

param K integer > 1;
set BLOCKS = 1..K;                 # time blocks are represented by consecutive integers
set LAB_BLOCKS = 1..(K-1);           # labs occupy two consecutive time blocks, so they cannot start in the final block K   

set PATTERNS;
set DAYS_OF {PATTERNS} within DAYS;

# ===================== PARAMETERS =====================
# fixed instructor assigned to each course
param instructor {COURSES} symbolic in PROFESSORS;

# meeting patterns each course may use; a course with no entry may use any pattern
set ALLOWED_PATTERNS {COURSES} within PATTERNS default {};
set UNLISTED = {c in COURSES: card(ALLOWED_PATTERNS[c]) = 0};    # reported as a warning
set PATTERNS_OF {c in COURSES} =
    if c in UNLISTED then PATTERNS else ALLOWED_PATTERNS[c];

set SLOTS {c in NONLABS} = {p in PATTERNS_OF[c], b in BLOCKS};

# labs may only start in blocks 1,...,K-1 because they occupy b and b+1
set LAB_SLOTS {c in LABS} = {p in PATTERNS_OF[c], b in LAB_BLOCKS};

set SECTIONS_OF {f in PROFESSORS} = {c in COURSES: instructor[c] = f};

# what is in session on day d during block b:
#   X_AT[d,b]: (c,p)   non-labs whose pattern p meets on d   -> x[c,r,p,b]
#   Y_AT[d,b]: (c,p,s) labs starting at s that cover b (s or s+1) -> y[c,r,p,s]
# Every resource constraint sums over both sets.
set X_AT {d in DAYS, b in BLOCKS} =
    {c in NONLABS, p in PATTERNS_OF[c]: d in DAYS_OF[p]};
set Y_AT {d in DAYS, b in BLOCKS} =
    {c in LABS, (p,s) in LAB_SLOTS[c]: d in DAYS_OF[p] and (s = b or s + 1 = b)};

# ===================== DEPARTMENT RULES =====================
# (day, block) pairs where no class may meet
set CLOSED within {DAYS, BLOCKS} default {};

# (room, day, block) triples where a room may not be used
set ROOM_CLOSED within {ROOMS, DAYS, BLOCKS} default {};

# 4XX courses: any course whose name contains a 4XX number, so cross-listed
# courses like ISE334_434 count as graduate courses
set GRAD_COURSES = {c in COURSES: match(c, "4[0-9][0-9]") > 0};

# (day, block) pairs where no 4XX course may meet
set GRAD_CLOSED within {DAYS, BLOCKS} default {};

# ===================== PROFESSOR AVAILABILITY =====================
# (professor, day, block) triples when that professor may NOT teach (hard)
set PROF_CLOSED within {PROFESSORS, DAYS, BLOCKS} default {};

# Preferences (soft). Rows are keyed by a professor or by a course ("who").
# If a course has any row of its own, its professor's rows are ignored for it.
#   PREF_BLOCK   (who, block, weight): -1 = avoid .. 1 = want; unlisted = 0
#   PREF_PATTERN (who, pattern, weight): 0 .. 1. If who lists any pattern,
#                unlisted patterns get 0; with no pattern rows, every pattern
#                gets 1. It only scales PREF_BLOCK, so it needs block rows.
# A course earns W_PREF * pattern weight * block weight (averaged over a
# lab's two blocks), so between -W_PREF and W_PREF.
set PREF_WHO = PROFESSORS union COURSES;
check: card(PROFESSORS inter COURSES) = 0;
set PREF_BLOCK   within {PREF_WHO, BLOCKS}   default {};
set PREF_PATTERN within {PREF_WHO, PATTERNS} default {};
param pref_block   {PREF_BLOCK}   >= -1, <= 1;
param pref_pattern {PREF_PATTERN} >= 0,  <= 1;

# courses with rows of their own
set PREF_COURSES = {c in COURSES:
    (exists {(w,b) in PREF_BLOCK} w = c) or (exists {(w,p) in PREF_PATTERN} w = c)};
param pref_key {c in COURSES} symbolic = if c in PREF_COURSES then c else instructor[c];
param block_w {c in COURSES, b in BLOCKS} =
    if (pref_key[c], b) in PREF_BLOCK then pref_block[pref_key[c], b] else 0;
param pattern_w {c in COURSES, p in PATTERNS} =
    if (pref_key[c], p) in PREF_PATTERN then pref_pattern[pref_key[c], p]
    else if exists {(w,q) in PREF_PATTERN} w = pref_key[c] then 0 else 1;

# ===================== COHORTS =====================
# (cohort, course number) pairs, e.g. (junior, 172). A number covers every
# course whose name contains it: 172 -> ISE172 and ISE172_L, 308 -> ISE308_408,
# ISE308_408_L, ISE308_408_W. The same list can go in every semester's data;
# numbers not offered this term are listed in COHORT_MISSING.
set COHORT_NUMS dimen 2 default {};
set COHORTS = setof {(h,n) in COHORT_NUMS} h;
set IN_COHORT = {h in COHORTS, c in COURSES:
    exists {(h2,n) in COHORT_NUMS: h2 = h}
        match(c, "(^|[^0-9])" & n & "([^0-9]|$)") > 0};
# Unique pairs of courses within the same cohort
set COHORT_PAIRS = {h in COHORTS, c1 in COURSES, c2 in COURSES:
        (h,c1) in IN_COHORT and (h,c2) in IN_COHORT and ord(c1) < ord(c2)};
set COHORT_MISSING = {(h,n) in COHORT_NUMS:
    not exists {c in COURSES} match(c, "(^|[^0-9])" & n & "([^0-9]|$)") > 0};

# ===================== SCORING =====================
# Each course earns at most 1 point for time quality: good[b] of its block,
# or the average of good[s] and good[s+1] for a two-block lab.
# Default: blocks 2-6 are good, block 1 and anything after block 6 are not.
param good {b in BLOCKS} default (if b >= 2 and b <= 6 then 1 else 0);

# points lost per overlapping course pair from same cohort 
param W >= 0 default 3;

# points per course for meeting in its professor's preferred times
param W_PREF >= 0 default 1;

# preference points for each slot (see PREF_BLOCK / PREF_PATTERN above)
param pref_x {c in NONLABS, (p,b) in SLOTS[c]} =
    W_PREF * pattern_w[c,p] * block_w[c,b];
param pref_y {c in LABS, (p,s) in LAB_SLOTS[c]} =
    W_PREF * pattern_w[c,p] * (block_w[c,s] + block_w[c,s+1]) / 2;

# ===================== VARIABLES =====================
var x {c in NONLABS, ROOMS_OF[c], SLOTS[c]}  binary;    # 1 if course meets in room r, pattern p, block b
var y {c in LABS, ROOMS_OF[c], LAB_SLOTS[c]} binary;    # 1 if lab STARTS in room r, pattern p, block b

# 1 if two courses in the same cohort overlap at least once during the week
var Overlap {(h,c1,c2) in COHORT_PAIRS} binary;

# ===================== OBJECTIVE =====================
# Score = time quality (up to 1 per course)
#       + preferences (-W_PREF to W_PREF per course)
#       - W points for every overlapping same cohort course pair

# score each course once based on its assigned time, rather than meeting occurence;
# labs use the average score of the 2 occupied blocks

maximize Score:
    sum {c in NONLABS, r in ROOMS_OF[c], (p,b) in SLOTS[c]} (good[b] + pref_x[c,p,b]) * x[c,r,p,b]
      + sum {c in LABS, r in ROOMS_OF[c], (p,b) in LAB_SLOTS[c]}
            ((good[b] + good[b+1]) / 2 + pref_y[c,p,b]) * y[c,r,p,b]
  - W * sum {(h,c1,c2) in COHORT_PAIRS} Overlap[h,c1,c2];

# ===================== CONSTRAINTS =====================

# every course is scheduled exactly once
subject to ScheduleNonlab {c in NONLABS}:
    sum {r in ROOMS_OF[c], (p,b) in SLOTS[c]} x[c,r,p,b] = 1;

subject to ScheduleLab {c in LABS}:
    sum {r in ROOMS_OF[c], (p,b) in LAB_SLOTS[c]} y[c,r,p,b] = 1;

# A two-block lab occupies both its starting block s and the following block s+1.
# Only courses that may use room r count (online courses never can).
subject to NoRoomClash {r in ROOMS, d in DAYS, b in BLOCKS}:
    sum {(c,p) in X_AT[d,b]: r in ROOMS_OF[c]} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b]: r in ROOMS_OF[c]} y[c,r,p,s] <= 1;

subject to NoProfClash {f in PROFESSORS, d in DAYS, b in BLOCKS}:
    sum {(c,p) in X_AT[d,b], r in ROOMS_OF[c]: instructor[c] = f} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b], r in ROOMS_OF[c]: instructor[c] = f} y[c,r,p,s] <= 1;

# ---------- department rules (hard) ----------
subject to DeptClosed {(d,b) in CLOSED}:
    sum {(c,p) in X_AT[d,b], r in ROOMS_OF[c]} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b], r in ROOMS_OF[c]} y[c,r,p,s] = 0;

subject to DeptRoomClosed {(r,d,b) in ROOM_CLOSED}:
    sum {(c,p) in X_AT[d,b]: r in ROOMS_OF[c]} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b]: r in ROOMS_OF[c]} y[c,r,p,s] = 0;

subject to DeptGradClosed {(d,b) in GRAD_CLOSED}:
    sum {(c,p) in X_AT[d,b], r in ROOMS_OF[c]: c in GRAD_COURSES} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b], r in ROOMS_OF[c]: c in GRAD_COURSES} y[c,r,p,s] = 0;

# ---------- professor availability (hard) ----------
subject to ProfClosed {(f,d,b) in PROF_CLOSED}:
    sum {(c,p) in X_AT[d,b], r in ROOMS_OF[c]: instructor[c] = f} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b], r in ROOMS_OF[c]: instructor[c] = f} y[c,r,p,s] = 0;

# ---------- cohorts (soft) ----------
# Mark a cohort course pair as overlapping if both courses meet at the same day/block
subject to CohortPairOverlap {(h,c1,c2) in COHORT_PAIRS, d in DAYS, b in BLOCKS}:
    sum {(c,p) in X_AT[d,b], r in ROOMS_OF[c]: c = c1 or c = c2} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b], r in ROOMS_OF[c]: c = c1 or c = c2} y[c,r,p,s]
  <= 1 + Overlap[h,c1,c2];     # if both course are active, Overlap must be 1
