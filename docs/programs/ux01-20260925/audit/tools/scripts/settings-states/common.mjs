export const H = "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
export const LENS = "settings-states";
// Records every toast text ever shown, with its class.
export const TOAST_SPY = () => {
  window.__toasts = [];
  const hook = () => {
    const c = document.getElementById("toastContainer");
    if (!c) return setTimeout(hook, 50);
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) window.__toasts.push({ t: Date.now(), cls: n.className, text: (n.innerText || n.textContent || "").trim().replace(/\s+/g, " ") }); }).observe(c, { childList: true, subtree: false });
  };
  document.addEventListener("DOMContentLoaded", hook);
};
export async function toasts(page) { return page.evaluate(() => window.__toasts || []); }
export async function visibleText(page, sel) { return page.evaluate((s) => { const e = document.querySelector(s); return e ? { shown: !!(e.offsetWidth || e.offsetHeight), text: (e.innerText || "").trim().replace(/\s+/g, " ").slice(0, 600) } : null; }, sel); }
