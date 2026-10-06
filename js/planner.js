// FlowShield rules-based planner. PURE functions: no network, no storage.
// It runs entirely on the user's device, so scheduling data never leaves the phone to make a plan.
//
// How it decides (every rule is explained to the user in the "Why" text):
//  1. LEAST SPARE TIME FIRST. Spare time ("slack") = time until the deadline minus the work still
//     needed. A 4-hour task due tonight outranks a 15-minute task due an hour later. Ties: priority.
//  2. BUFFER. Estimates are padded by 20% (people under-estimate), rounded up to 5 minutes.
//  3. DEADLINE MARGIN. Work is planned to finish 30 minutes before the deadline.
//  4. Work only inside the working window; never over events or protected time (sleep, meals, rest).
//  5. FOCUS BLOCKS of at most 90 minutes, with a 10-minute break after any block of 45+ minutes.
//  6. DAILY CAP of 6 hours of planned work, to protect rest.
//  7. If something cannot fit before its deadline, WARN instead of silently failing.
const DAY_START = 8, DAY_END = 22;
const MAX_BLOCK = 90, MAX_DAILY = 360, BREAK = 10, MARGIN = 30, BUFFER = 1.2;
const HORIZON_DAYS = 7, STEP = 15, MIN = 60000;
const PRIORITY = { 1: "High", 2: "Medium", 3: "Low" };

const atHM = (day, hm) => { const d = new Date(day); const [h, m] = hm.split(":"); d.setHours(+h, +m, 0, 0); return d; };
export const fmt = (d) => d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function buildPlan({ tasks, events, periods, now = new Date() }) {
  const base = new Date(now); base.setHours(0, 0, 0, 0);
  const dayAt = (i) => { const d = new Date(base); d.setDate(base.getDate() + i); return d; };

  // 1) Everything that blocks time: calendar events + protected periods expanded per day.
  const busy = events.map((e) => [new Date(e.starts_at), new Date(e.ends_at)]);
  for (let i = -1; i <= HORIZON_DAYS; i++) {            // -1 so last night's sleep is counted
    const day = dayAt(i);
    for (const p of periods.filter((p) => p.day_of_week === day.getDay())) {
      const s = atHM(day, p.start_time), e = atHM(day, p.end_time);
      if (e > s) busy.push([s, e]);
      else { const next = dayAt(i + 1); busy.push([s, next], [next, atHM(next, p.end_time)]); }   // overnight
    }
  }

  // 2) Free slots inside the working window, from now onwards.
  const from = new Date(Math.ceil(now / (STEP * MIN)) * STEP * MIN);
  const slots = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const day = dayAt(i);
    let free = [[new Date(Math.max(atHM(day, DAY_START + ":00"), from)), atHM(day, DAY_END + ":00")]];
    for (const [bs, be] of busy)
      free = free.flatMap(([fs, fe]) => (be <= fs || bs >= fe) ? [[fs, fe]] : [[fs, bs], [be, fe]]);
    for (const [s, e] of free) if (e - s >= STEP * MIN) slots.push({ s, e, day: day.toDateString() });
  }

  // 3) Rank tasks by spare time, then place them into the earliest suitable slots.
  const todo = tasks.filter((t) => t.status !== "done").map((t) => {
    const raw = t.estimated_minutes || 30;
    const mins = Math.ceil((raw * BUFFER) / 5) * 5;
    const realDue = t.due_at ? new Date(t.due_at) : null;
    const due = realDue ? new Date(+realDue - MARGIN * MIN) : null;
    const slack = due ? (due - now) / MIN - mins : Infinity;
    return { ...t, raw, mins, due, realDue, slack };
  }).sort((a, b) => (a.slack - b.slack) || (a.priority - b.priority));

  const load = {}, blocks = [], warnings = [];
  for (const t of todo) {
    let left = t.mins;
    const mine = [];
    while (left > 0) {
      const slot = slots.find((sl) => sl.e - sl.s >= 5 * MIN && (load[sl.day] || 0) < MAX_DAILY && (!t.due || sl.s < t.due));
      if (!slot) break;
      const len = Math.floor(Math.min(left, MAX_BLOCK, (slot.e - slot.s) / MIN,
        MAX_DAILY - (load[slot.day] || 0), t.due ? (t.due - slot.s) / MIN : Infinity));
      if (len < 5) { slot.s = slot.e; continue; }        // too small to use: discard the slot
      const end = new Date(+slot.s + len * MIN);
      mine.push({ title: t.title, start: slot.s, end, day: slot.day, mins: len, task: t });
      slot.s = new Date(+end + (len >= 45 ? BREAK * MIN : 0));   // short break after long blocks
      load[slot.day] = (load[slot.day] || 0) + len; left -= len;
    }
    mine.forEach((b, i) => {
      const why = t.realDue
        ? `Due ${fmt(t.realDue)}${t.slack < 240 ? " with little spare time left, so it is urgent" : ""}. Tasks with the least spare time go first, and it is planned to finish ${MARGIN} minutes early.`
        : `No deadline, so it is scheduled by priority (${PRIORITY[t.priority] || "Medium"}).`;
      const part = mine.length > 1 ? ` Part ${i + 1} of ${mine.length}: focus blocks are capped at ${MAX_BLOCK} minutes.` : "";
      blocks.push({ ...b, reason: `${why}${part} Includes a 20% buffer on your ${t.raw}-minute estimate. Placed in your first free time that avoids events and protected time.` });
    });
    if (left > 0) warnings.push(`"${t.title}": only ${t.mins - left} of ${t.mins} minutes (with buffer) fit ${t.due ? "before its deadline" : "in the next 7 days"}. ` +
      `Consider moving the deadline or freeing up time.`);
  }
  blocks.sort((a, b) => a.start - b.start);
  return { blocks, warnings, load };
}
