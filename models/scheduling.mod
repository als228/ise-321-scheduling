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
set ROOMS_OF {c in COURSES} = if c in ONLINE then {"Online"} else ROOMS;

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

# (professor, day, block) triples when that professor would LIKE to teach
# (soft). Blocks not listed are still allowed, just not rewarded.
set PROF_PREF within {PROFESSORS, DAYS, BLOCKS} default {};

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

# share of a course's meeting-blocks that fall in PROF_PREF, times W_PREF.
# An MW class with only Mon preferred earns W_PREF/2; a lab averages its
# two blocks the same way.
param pref_x {c in NONLABS, (p,b) in SLOTS[c]} =
    W_PREF * card {d in DAYS_OF[p]: (instructor[c],d,b) in PROF_PREF}
           / card(DAYS_OF[p]);
param pref_y {c in LABS, (p,s) in LAB_SLOTS[c]} =
    W_PREF * card {d in DAYS_OF[p], bb in {s, s+1}: (instructor[c],d,bb) in PROF_PREF}
           / (2 * card(DAYS_OF[p]));

# ===================== VARIABLES =====================
var x {c in NONLABS, ROOMS_OF[c], SLOTS[c]}  binary;    # 1 if course meets in room r, pattern p, block b
var y {c in LABS, ROOMS_OF[c], LAB_SLOTS[c]} binary;    # 1 if lab STARTS in room r, pattern p, block b

# 1 if two courses in the same cohort overlap at least once during the week
var Overlap {(h,c1,c2) in COHORT_PAIRS} binary;

# ===================== OBJECTIVE =====================
# Score = time quality (up to 1 per course)
#       + professor preference (up to W_PREF per course)
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
# Online courses have no room, so they are left out.
subject to NoRoomClash {r in ROOMS, d in DAYS, b in BLOCKS}:
    sum {(c,p) in X_AT[d,b]: c not in ONLINE} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b]: c not in ONLINE} y[c,r,p,s] <= 1;

subject to NoProfClash {f in PROFESSORS, d in DAYS, b in BLOCKS}:
    sum {(c,p) in X_AT[d,b], r in ROOMS_OF[c]: instructor[c] = f} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b], r in ROOMS_OF[c]: instructor[c] = f} y[c,r,p,s] <= 1;

# ---------- department rules (hard) ----------
subject to DeptClosed {(d,b) in CLOSED}:
    sum {(c,p) in X_AT[d,b], r in ROOMS_OF[c]} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b], r in ROOMS_OF[c]} y[c,r,p,s] = 0;

subject to DeptRoomClosed {(r,d,b) in ROOM_CLOSED}:
    sum {(c,p) in X_AT[d,b]: c not in ONLINE} x[c,r,p,b]
  + sum {(c,p,s) in Y_AT[d,b]: c not in ONLINE} y[c,r,p,s] = 0;

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
