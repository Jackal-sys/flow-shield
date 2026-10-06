// Calendar events: classes, work shifts, appointments.
import { sb } from "./supabase.js";
import { $, el, say, delBtn } from "./ui.js";

export async function loadEvents() {
  const since = new Date(Date.now() - 864e5).toISOString();   // hide events that ended over a day ago
  const { data, error } = await sb.from("events").select("id,title,kind,starts_at,ends_at")
    .gte("ends_at", since).order("starts_at");
  if (error) return say(error.message);
  const ul = $("eventList"); ul.replaceChildren();
  if (!data.length) ul.append(el("li", "No upcoming events."));
  for (const ev of data) {
    const when = new Date(ev.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      + " to " + new Date(ev.ends_at).toLocaleTimeString([], { timeStyle: "short" });
    const li = el("li");
    li.append(el("span", `[${ev.kind}] ${ev.title} · ${when}`),
      delBtn(async () => { await sb.from("events").delete().eq("id", ev.id); loadEvents(); }));
    ul.append(li);
  }
}

$("eventForm").onsubmit = async (e) => {
  e.preventDefault();
  const start = new Date($("evStart").value), end = new Date($("evEnd").value);
  if (!(end > start)) return say("End must be after the start.");
  const { error } = await sb.from("events").insert({
    title: $("evTitle").value.trim(), kind: $("evKind").value,
    starts_at: start.toISOString(), ends_at: end.toISOString(),
  });
  if (error) return say(error.message);
  say(""); e.target.reset(); loadEvents();
};
