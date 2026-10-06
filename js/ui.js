// Small UI helpers shared by every module.
export const $ = (id) => document.getElementById(id);

// SECURITY: DOM is built with textContent, never innerHTML, so user text can't inject HTML/JS.
export function el(tag, text, props = {}) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  return Object.assign(e, props);
}
export const show = (id) => ["auth", "app"].forEach((v) => ($(v).hidden = v !== id));
export const say = (t, bad = true) => { $("msg").textContent = t || ""; $("msg").className = bad ? "err" : "ok"; };
export const delBtn = (fn) => el("button", "✕", { className: "alt", ariaLabel: "Delete", onclick: fn });
// Ask main.js to switch tab (an event avoids circular imports between modules).
export const goTab = (name) => document.dispatchEvent(new CustomEvent("goto", { detail: name }));
