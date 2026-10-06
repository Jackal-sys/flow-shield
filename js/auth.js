// Sign in, sign up, sign out and mandatory TOTP multi-factor authentication.
import { sb } from "./supabase.js";
import { $, show, say } from "./ui.js";

let factorId = null;

export function initAuth(route) {
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
  $("mfaForm").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: $("code").value.trim() });
    if (error) return say(error.message);
    $("code").value = ""; route();
  };
}

export async function startMfa(hasFactor) {
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
