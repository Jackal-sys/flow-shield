// Tasks. Row Level Security guarantees you only ever receive your own rows.
import { sb } from "./supabase.js";
import { $, el, say, delBtn } from "./ui.js";

export async function loadTasks() {
  const { data, error } = await sb.from("tasks").select("id,title,status").order("created_at", { ascending: false });
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
    li.append(cb, el("span", t.title), delBtn(async () => { await sb.from("tasks").delete().eq("id", t.id); loadTasks(); }));
    ul.append(li);
  }
}

$("taskForm").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("tasks").insert({ title: $("title").value.trim() });   // user_id is set by the database
  if (error) return say(error.message);
  $("title").value = ""; loadTasks();
};
