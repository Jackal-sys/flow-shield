// Simple email + password sign in, sign up and sign out.
import { sb } from "./supabase.js";
import { $, say } from "./ui.js";

export function initAuth(route) {
  $("authForm").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("pw").value });
    if (error) return say(error.message);
    $("pw").value = ""; route();
  };
  $("signUp").onclick = async () => {
    const pw = $("pw").value;
    if (pw.length < 12) return say("Use at least 12 characters.");
    const { data, error } = await sb.auth.signUp({ email: $("email").value.trim(), password: pw });
    if (error) return say(error.message);
    $("pw").value = "";
    if (data.session) route();                     // email confirmation is off: signed in straight away
    else say("Account created. Check your email to confirm, then sign in.", false);
  };
  $("signOut").onclick = async () => { await sb.auth.signOut(); route(); };
}
