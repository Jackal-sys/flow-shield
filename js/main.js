// Entry point: decides which screen to show and handles navigation.
import { sb } from "./supabase.js";
import { $, show, say } from "./ui.js";
import { initAuth } from "./auth.js";
import { loadTasks, refreshBadge } from "./tasks.js";
import { showPlan } from "./plan.js";
import { loadEvents } from "./events.js";
import { loadPeriods } from "./periods.js";
import { loadAdmin } from "./admin.js";

const panes = { plan: showPlan, tasks: loadTasks, events: loadEvents, periods: loadPeriods, admin: loadAdmin };
let isAdmin = false;

// Switch tab: shows the pane, highlights the bar button, remembers the tab in the URL (#tasks)
// so a refresh returns you to the same place. Unknown tabs and admin-for-non-admins fall back to Plan.
function tab(name) {
  if (!panes[name] || (name === "admin" && !isAdmin)) name = "plan";
  for (const k in panes) $(k + "Pane").hidden = k !== name;
  document.querySelectorAll("#bar button").forEach((b) =>
    b.dataset.tab === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  say(""); history.replaceState(null, "", "#" + name);
  panes[name](); window.scrollTo(0, 0);
}
$("bar").onclick = (e) => { const b = e.target.closest("button"); if (b) tab(b.dataset.tab); };
document.addEventListener("goto", (e) => tab(e.detail));

async function route() {
  say("");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return show("auth");
  const { data: p, error } = await sb.from("profiles").select("role,status").single();
  if (error || !p) return say("Could not load your profile.");
  if (p.status !== "active") {
    await sb.auth.signOut(); show("auth");
    return say("Your account is suspended. Contact the administrator.");
  }
  isAdmin = p.role === "admin";
  $("tabAdmin").hidden = !isAdmin;
  $("who").textContent = session.user.email;
  show("app"); refreshBadge();
  tab(location.hash.slice(1));
}

initAuth(route);
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") route(); });
route();
