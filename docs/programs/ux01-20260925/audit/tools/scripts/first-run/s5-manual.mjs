// UX01 first-run: welcome empty state -> Add manually -> first tracked row (Sheets write is fixture-fulfilled).
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "first-run"; const log = (...a) => console.log(...a);
for (const viewport of ["desktop", "phone"]) {
const app = await openApp({ mode: "signed-in-empty", viewport, setupDone: false });
const { page } = app;
const writes = [];
page.on("request", (r) => { if (!["GET", "OPTIONS"].includes(r.method())) writes.push(`${r.method()} ${r.url().slice(0, 110)}`); });
let clicks = 0, fields = 0;
await page.keyboard.press("Escape"); clicks++; await page.waitForTimeout(1500);
const welcome = await page.evaluate(() => { const r = document.querySelector('[data-region="welcome"]'); return r ? { mode: r.dataset.mode, text: r.innerText.replace(/\s+/g, " ").slice(0, 200), box: JSON.stringify(r.getBoundingClientRect()) } : null; });
log(viewport, "welcome:", JSON.stringify(welcome));
await shoot(page, L, "welcome-empty", { fullPage: false });
const manual = page.getByRole("button", { name: "Add manually" }).first();
if (await manual.count()) {
  await manual.scrollIntoViewIfNeeded(); await manual.click(); clicks++; await page.waitForTimeout(700);
  await shoot(page, L, "manual-add-open");
  const form = await page.evaluate(() => { const d = [...document.querySelectorAll("[role=dialog], dialog, .modal")].find((x) => x.getBoundingClientRect().width > 0 && getComputedStyle(x).display !== "none"); return d ? { id: d.id, inputs: [...d.querySelectorAll("input,textarea,select")].filter((i) => i.getBoundingClientRect().width > 0).map((i) => `${i.id}${i.required ? "*" : ""}`), text: d.innerText.replace(/\s+/g, " ").slice(0, 400) } : null; });
  log("manual form:", JSON.stringify(form));
} else log("no Add manually button");
log("writes:", JSON.stringify(writes), "clicks so far", clicks);
await app.close();
}
