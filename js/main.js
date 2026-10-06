// Entry point: decides which screen to show and wires the tabs.
import { sb } from "./supabase.js";
import { $, show, say } from "./ui.js";
import { initAuth, startMfa } from "./auth.js";
import { loadTasks } from "./tasks.js";
import { loadEvents } from "./events.js";
import { loadPeriods } from "./periods.js";
import { loadAdmin } from "./admin.js";

const panes = { tasks: loadTasks, events: loadEvents, periods: loadPeriods, admin: loadAdmin };
function tab(name) {
  for (const k in panes) $(k + "Pane").hidden = k !== name;
  panes[name]();
}
$("tabTasks").onclick = () => tab("tasks");
$("tabEvents").onclick = () => tab("events");
$("tabPeriods").onclick = () => tab("periods");
$("tabAdmin").onclick = () => tab("admin");

async function route() {
  say("");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return show("auth");
  const { data: a } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const enrolled = a.nextLevel === "aal2";                      // user has a verified MFA factor
  if (enrolled && a.currentLevel !== "aal2") return startMfa(true);   // enrolled users must verify

  const { data: p, error } = await sb.from("profiles").select("role,status").single();
  if (error || !p) return say("Could not load your profile.");
  if (p.status !== "active") {
    await sb.auth.signOut(); show("auth");
    return say("Your account is suspended. Contact the administrator.");
  }
  // MFA policy: optional for regular users, MANDATORY for the admin.
  if (p.role === "admin" && a.currentLevel !== "aal2") return startMfa(false);
  $("mfaEnable").hidden = enrolled || p.role === "admin";
  show("app");
  $("tabAdmin").hidden = p.role !== "admin";
  tab("tasks");
}

initAuth(route);
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") route(); });
route();
