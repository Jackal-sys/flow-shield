// Admin panel. The server re-checks admin role + MFA on every call; this file only draws the UI.
import { sb } from "./supabase.js";
import { $, el, say } from "./ui.js";

const btn = (label, fn, cls = "alt") => el("button", label, { className: cls, onclick: fn });

async function act(fn, args) {
  const { error } = await sb.rpc(fn, args);
  say(error ? error.message : "Done.", !!error); loadAdmin();
}

export async function loadAdmin() {
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
        btn(suspend ? "Suspend" : "Reactivate", () => act("admin_set_account_status", { p_target: a.id, p_status: suspend ? "suspended" : "active" })),
        btn("Revoke sessions", () => act("admin_revoke_sessions", { p_target: a.id })),
        btn("Delete", () => confirm("Permanently delete " + a.email + " and all their data?") && act("admin_delete_account", { p_target: a.id }), "danger"),
      );
    }
    tr.append(td); tb.append(tr);
  }
}
