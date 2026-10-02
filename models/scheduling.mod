# ===================== SETS =====================
set COURSES;
set LABS within COURSES;
set NONLABS = COURSES diff LABS;
set PROFESSORS;
set ROOMS;
set DAYS;
set BLOCKS ordered;                       # order matters: labs use next()
set PATTERNS;
set DAYS_OF {PATTERNS} within DAYS;

# ===================== PARAMETERS =====================
param teacher {COURSES} symbolic in PROFESSORS;

set SLOTS = {p in PATTERNS, b in BLOCKS};

# a lab can start at b only if the next block exists and is also allowed
set LAB_SLOTS = {(p,b) in SLOTS: b != last(BLOCKS) and (p, next(b)) in SLOTS};

set SECTIONS_OF {f in PROFESSORS} = {c in COURSES: teacher[c] = f};

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

# at most one course per room, per day, per block
subject to NoRoomClash {r in ROOMS, d in DAYS, b in BLOCKS}:
    sum {c in NONLABS, p in PATTERNS: (p,b) in SLOTS and d in DAYS_OF[p]}
        x[c,r,p,b]
  + sum {c in LABS, (p,s) in LAB_SLOTS: d in DAYS_OF[p] and (s = b or next(s) = b)}
        y[c,r,p,s]
  <= 1;

# a professor teaches at most one section per day, per block
subject to NoProfClash {f in PROFESSORS, d in DAYS, b in BLOCKS}:
    sum {c in SECTIONS_OF[f] inter NONLABS, r in ROOMS, p in PATTERNS:
         (p,b) in SLOTS and d in DAYS_OF[p]}
        x[c,r,p,b]
  + sum {c in SECTIONS_OF[f] inter LABS, r in ROOMS, (p,s) in LAB_SLOTS:
         d in DAYS_OF[p] and (s = b or next(s) = b)}
        y[c,r,p,s]
  <= 1;
