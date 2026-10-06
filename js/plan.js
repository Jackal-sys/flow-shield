// Plan tab: loads the user's data, runs the planner on-device and shows explained suggestions.
import { sb } from "./supabase.js";
import { $, el, say } from "./ui.js";
import { buildPlan } from "./planner.js";

export async function showPlan() {
  const now = new Date();
  const horizon = new Date(+now + 8 * 864e5).toISOString();
  const [t, e, p] = await Promise.all([
    sb.from("tasks").select("id,title,status,priority,due_at,estimated_minutes"),
    sb.from("events").select("title,starts_at,ends_at").lte("starts_at", horizon).gte("ends_at", now.toISOString()),
    sb.from("protected_periods").select("label,day_of_week,start_time,end_time"),
  ]);
  const err = t.error || e.error || p.error;
  if (err) return say(err.message);

  const { blocks, warnings, load } = buildPlan({ tasks: t.data, events: e.data, periods: p.data, now });
  const out = $("planOut"); out.replaceChildren();
  for (const w of warnings) out.append(el("p", "⚠ " + w, { className: "err" }));
  if (!blocks.length) { out.append(el("p", "Nothing to plan. Add tasks with an effort and a due date first.")); return; }

  let ul = null, last = "";
  for (const b of blocks) {
    if (b.day !== last) {
      last = b.day;
      out.append(el("h3", `${b.start.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })} · ${((load[b.day] || 0) / 60).toFixed(1)}h planned`));
      ul = el("ul"); out.append(ul);
    }
    const time = `${b.start.toLocaleTimeString([], { timeStyle: "short" })} to ${b.end.toLocaleTimeString([], { timeStyle: "short" })}`;
    const box = el("div"); box.append(el("strong", `${time} · ${b.title}`), el("div", "Why: " + b.reason, { className: "small" }));
    const li = el("li"); li.append(box); ul.append(li);
  }
}
