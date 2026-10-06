// Protected periods: sleep, meals, rest. The planner must never schedule into these.
import { sb } from "./supabase.js";
import { $, el, say, delBtn } from "./ui.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function loadPeriods() {
  const { data, error } = await sb.from("protected_periods")
    .select("id,label,day_of_week,start_time,end_time").order("day_of_week").order("start_time");
  if (error) return say(error.message);
  const ul = $("periodList"); ul.replaceChildren();
  if (!data.length) ul.append(el("li", "Nothing protected yet. Add sleep and meals first."));
  for (const p of data) {
    const li = el("li");
    li.append(el("span", `${DAYS[p.day_of_week]} ${p.start_time.slice(0, 5)} to ${p.end_time.slice(0, 5)} · ${p.label}`),
      delBtn(async () => { await sb.from("protected_periods").delete().eq("id", p.id); loadPeriods(); }));
    ul.append(li);
  }
}

$("periodForm").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("protected_periods").insert({
    label: $("pdLabel").value.trim(), day_of_week: Number($("pdDay").value),
    start_time: $("pdStart").value, end_time: $("pdEnd").value,
  });
  if (error) return say(error.message);
  say(""); e.target.reset(); loadPeriods();
};
