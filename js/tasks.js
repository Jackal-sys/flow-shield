// Tasks. Row Level Security guarantees you only ever receive your own rows.
import { sb } from "./supabase.js";
import { $, el, say, delBtn } from "./ui.js";

export async function loadTasks() {
  const { data, error } = await sb.from("tasks").select("id,title,status,priority,due_at,estimated_minutes").order("created_at", { ascending: false });
  if (error) return say(error.message);
  // Logical order: open tasks first, soonest deadline first; finished tasks sink to the bottom.
  data.sort((a, b) => (a.status === "done") - (b.status === "done")
    || (a.due_at ? +new Date(a.due_at) : Infinity) - (b.due_at ? +new Date(b.due_at) : Infinity));
  setBadge(data);
  const ul = $("taskList"); ul.replaceChildren();
  if (!data.length) ul.append(el("li", "No tasks yet."));
  for (const t of data) {
    const done = t.status === "done";
    const late = !done && t.due_at && new Date(t.due_at) < new Date();
    const li = el("li"); li.className = done ? "done" : late ? "late" : "";
    const cb = el("input", null, { type: "checkbox", checked: done, ariaLabel: "Done" });
    cb.onchange = async () => {
      const { error } = await sb.from("tasks").update({
        status: cb.checked ? "done" : "todo",
        completed_at: cb.checked ? new Date().toISOString() : null,
      }).eq("id", t.id);
      if (error) say(error.message); loadTasks();
    };
    const meta = [t.estimated_minutes ? t.estimated_minutes + " min" : null, ["", "High", "Medium", "Low"][t.priority],
      t.due_at ? "due " + new Date(t.due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null, late ? "OVERDUE" : null].filter(Boolean).join(" · ");
    li.append(cb, el("span", t.title + (meta ? "  (" + meta + ")" : "")), delBtn(async () => { await sb.from("tasks").delete().eq("id", t.id); loadTasks(); }));
    ul.append(li);
  }
}

$("taskForm").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("tasks").insert({
    title: $("title").value.trim(),
    estimated_minutes: Number($("effort").value) || 30,
    priority: Number($("prio").value),
    due_at: $("due").value ? new Date($("due").value).toISOString() : null,
  });   // user_id is set by the database
  if (error) return say(error.message);
  e.target.reset(); loadTasks();
};

// Badge on the Tasks tab: open task count, or the number of overdue tasks in red.
export function setBadge(rows) {
  const open = rows.filter((t) => t.status !== "done");
  const late = open.filter((t) => t.due_at && new Date(t.due_at) < new Date()).length;
  const b = $("badgeTasks");
  b.textContent = late ? late + " late" : open.length || "";
  b.className = late ? "badge late" : "badge";
}
export async function refreshBadge() {
  const { data } = await sb.from("tasks").select("status,due_at");
  if (data) setBadge(data);
}
