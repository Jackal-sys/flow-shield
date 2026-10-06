// Tasks. Row Level Security guarantees you only ever receive your own rows.
import { sb } from "./supabase.js";
import { $, el, say, delBtn } from "./ui.js";

export async function loadTasks() {
  const { data, error } = await sb.from("tasks").select("id,title,status,priority,due_at,estimated_minutes").order("created_at", { ascending: false });
  if (error) return say(error.message);
  const ul = $("taskList"); ul.replaceChildren();
  if (!data.length) ul.append(el("li", "No tasks yet."));
  for (const t of data) {
    const done = t.status === "done";
    const li = el("li"); if (done) li.className = "done";
    const cb = el("input", null, { type: "checkbox", checked: done, ariaLabel: "Done" });
    cb.onchange = async () => {
      const { error } = await sb.from("tasks").update({
        status: cb.checked ? "done" : "todo",
        completed_at: cb.checked ? new Date().toISOString() : null,
      }).eq("id", t.id);
      if (error) say(error.message); loadTasks();
    };
    const meta = [t.estimated_minutes ? t.estimated_minutes + " min" : null, ["", "High", "Medium", "Low"][t.priority],
      t.due_at ? "due " + new Date(t.due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null].filter(Boolean).join(" · ");
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
