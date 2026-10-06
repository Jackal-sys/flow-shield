import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

// 1) Paste your values from Supabase > Project Settings > API.
//    The anon key is PUBLIC by design; Row Level Security protects the data.
//    NEVER put the service_role key here.
const SUPABASE_URL = "https://cvqhvgcecoagryqhclcy.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2cWh2Z2NlY29hZ3J5cWhjbGN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExOTE2NzgsImV4cCI6MjEwNjc2NzY3OH0.fjearuGGbcHEmcUEsIUwsgfYuf-ehVgVhXRl3A1wSQ8";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
let factorId = null;

// SECURITY: all DOM is built with textContent, never innerHTML.
function el(tag, text, props = {}) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  return Object.assign(e, props);
}
const show = (id) => ["auth", "mfa", "app"].forEach((v) => ($(v).hidden = v !== id));
const say = (t, bad = true) => { $("msg").textContent = t || ""; $("msg").className = bad ? "err" : "ok"; };

// ---------- Routing: decides which screen to show ----------
async function route() {
  say("");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return show("auth");
  const { data: a } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (a.currentLevel !== "aal2") return startMfa(a.nextLevel === "aal2");   // MFA is mandatory

  const { data: p, error } = await sb.from("profiles").select("role,status").single();
  if (error || !p) return say("Could not load your profile.");
  if (p.status !== "active") {
    await sb.auth.signOut(); show("auth");
    return say("Your account is suspended. Contact the administrator.");
  }
  show("app");
  $("tabAdmin").hidden = p.role !== "admin";
  tab("tasks");
}

// ---------- Sign in / sign up ----------
$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value, password: $("pw").value });
  if (error) return say(error.message);
  $("pw").value = ""; route();
};
$("signUp").onclick = async () => {
  const pw = $("pw").value;
  if (pw.length < 12) return say("Use at least 12 characters.");
  const { error } = await sb.auth.signUp({ email: $("email").value, password: pw });
  if (error) return say(error.message);
  $("pw").value = ""; say("Account created. Check your email to confirm, then sign in.", false);
};
$("signOut").onclick = async () => { await sb.auth.signOut(); route(); };

// ---------- MFA (TOTP) ----------
async function startMfa(hasFactor) {
  show("mfa"); $("qr").hidden = true; $("secret").textContent = "";
  const { data: l } = await sb.auth.mfa.listFactors();
  if (hasFactor) {
    factorId = l.totp[0].id;
    $("mfaHelp").textContent = "Enter the 6-digit code from your authenticator app.";
    return;
  }
  for (const f of l.all.filter((f) => f.status === "unverified")) await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp" });
  if (error) return say(error.message);
  factorId = data.id;
  $("qr").src = data.totp.qr_code; $("qr").hidden = false;
  $("secret").textContent = "Or enter manually: " + data.totp.secret;
  $("mfaHelp").textContent = "Scan the QR code with an authenticator app, then enter the code.";
}
$("mfaForm").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: $("code").value.trim() });
  if (error) return say(error.message);
  $("code").value = ""; route();
};

// ---------- Tabs ----------
function tab(name) {
  $("tasksPane").hidden = name !== "tasks";
  $("adminPane").hidden = name !== "admin";
  if (name === "tasks") loadTasks(); else loadAdmin();
}
$("tabTasks").onclick = () => tab("tasks");
$("tabAdmin").onclick = () => tab("admin");

// ---------- Tasks (RLS guarantees you only ever get your own rows) ----------
async function loadTasks() {
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
    const del = el("button", "✕", { className: "alt", ariaLabel: "Delete" });
    del.onclick = async () => { await sb.from("tasks").delete().eq("id", t.id); loadTasks(); };
    li.append(cb, el("span", t.title), del);
    ul.append(li);
  }
}
$("taskForm").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("tasks").insert({ title: $("title").value.trim() });   // user_id is set by the database
  if (error) return say(error.message);
  $("title").value = ""; loadTasks();
};

// ---------- Admin panel (server re-checks admin + MFA on every call) ----------
const btn = (label, fn, cls = "alt") => el("button", label, { className: cls, onclick: fn });
async function adminAct(fn, args) {
  const { error } = await sb.rpc(fn, args);
  say(error ? error.message : "Done.", !!error); loadAdmin();
}
async function loadAdmin() {
  const { data, error } = await sb.rpc("admin_list_accounts");
  if (error) return say(error.message);
  const tb = $("accounts"); tb.replaceChildren();
  for (const a of data) {
    const tr = el("tr");
    [a.email, a.role, a.status, a.mfa_enabled ? "Yes" : "No",
     a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString() : "Never"]
      .forEach((v) => tr.append(el("td", v)));
    const td = el("td");
    if (a.role !== "admin") {
      const suspend = a.status === "active";
      td.append(
        btn(suspend ? "Suspend" : "Reactivate", () => adminAct("admin_set_account_status", { p_target: a.id, p_status: suspend ? "suspended" : "active" })),
        btn("Revoke sessions", () => adminAct("admin_revoke_sessions", { p_target: a.id })),
        btn("Delete", () => confirm("Permanently delete " + a.email + " and all their data?") && adminAct("admin_delete_account", { p_target: a.id }), "danger"),
      );
    }
    tr.append(td); tb.append(tr);
  }
}

sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") route(); });
route();
