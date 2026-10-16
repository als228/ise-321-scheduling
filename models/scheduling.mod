# ===================== SETS =====================
set COURSES;
set LABS within COURSES;
set NONLABS = COURSES diff LABS;
set PROFESSORS;
set ROOMS;
set DAYS;

param K integer > 1;
set BLOCKS = 1..K;                 # time blocks are represented by consecutive integers
set LAB_BLOCKS = 1..(K-1);           # labs occupy two consecutive time blocks, so they cannot start in the final block K   

set PATTERNS;
set DAYS_OF {PATTERNS} within DAYS;

# ===================== PARAMETERS =====================
# fixed instructor assigned to each course
param instructor {COURSES} symbolic in PROFESSORS;

set SLOTS = {p in PATTERNS, b in BLOCKS};

# labs may only start in blocks 1,...,K-1 because they occupy b and b+1
set LAB_SLOTS = {p in PATTERNS, b in LAB_BLOCKS};

set SECTIONS_OF {f in PROFESSORS} = {c in COURSES: instructor[c] = f};

# ===================== VARIABLES =====================
var x {NONLABS, ROOMS, SLOTS}  binary;    # 1 if course meets in room r, pattern p, block b
var y {LABS, ROOMS, LAB_SLOTS} binary;    # 1 if lab STARTS in room r, pattern p, block b

# ===================== OBJECTIVE =====================
# placeholder until the objective is designed
minimize NoObjective: 0;

# ===================== CONSTRAINTS =====================

# every course is scheduled exactly once
subject to ScheduleNonlab {c in NONLABS}:
    sum {r in ROOMS, (p,b) in SLOTS} x[c,r,p,b] = 1;

subject to ScheduleLab {c in LABS}:
    sum {r in ROOMS, (p,b) in LAB_SLOTS} y[c,r,p,b] = 1;

# A two-block lab occupies both its starting block s and the following block s+1.
subject to NoRoomClash {r in ROOMS, d in DAYS, b in BLOCKS}:
    sum {c in NONLABS, p in PATTERNS: (p,b) in SLOTS and d in DAYS_OF[p]}
        x[c,r,p,b]
  + sum {c in LABS, (p,s) in LAB_SLOTS:
         d in DAYS_OF[p] and (s = b or s + 1 = b)}
        y[c,r,p,s]
  <= 1;

# A two-block lab occupies both its starting block s and the following block s+1.
subject to NoProfClash {f in PROFESSORS, d in DAYS, b in BLOCKS}:
    sum {c in SECTIONS_OF[f] inter NONLABS, r in ROOMS, p in PATTERNS:
         (p,b) in SLOTS and d in DAYS_OF[p]}
        x[c,r,p,b]
  + sum {c in SECTIONS_OF[f] inter LABS, r in ROOMS, (p,s) in LAB_SLOTS:
         d in DAYS_OF[p] and (s = b or s + 1 = b)}
        y[c,r,p,s]
  <= 1;
