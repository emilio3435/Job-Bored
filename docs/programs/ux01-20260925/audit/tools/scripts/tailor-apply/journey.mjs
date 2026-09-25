// Journey: pipeline card -> dossier -> cover letter -> resume -> Scribe -> Applied confirm.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const vp = process.argv[2] || "desktop";
const L = "tailor-apply";
const app = await openApp({ mode: "signed-in", viewport: vp });
const { page } = app;
const log = [];
const t0 = Date.now();
const step = (s, extra = {}) => { const e = { t: ((Date.now() - t0) / 1000).toFixed(1), step: s, ...extra }; log.push(e); console.log(JSON.stringify(e)); };
const reqs = [];
page.on("request", r => { if (r.url().includes("3847")) reqs.push(r.method() + " " + r.url().replace("http://127.0.0.1:3847", "")); });
const toasts = async () => page.evaluate(() => [...document.querySelectorAll('#toastContainer .toast-message, .jb-toast, [data-jb-toast]')].map(e => e.textContent.trim()).filter(Boolean).slice(0, 8));
const consoleMsgs = [];
page.on("console", m => { if (/warn|error/.test(m.type()) || /materials/i.test(m.text())) consoleMsgs.push(m.type() + ": " + m.text().slice(0, 300)); });

// 1. Click the Kestrel card (Researching) in the pipeline.
const card = page.locator('[data-region="pipeline"] article.pipe-sticker', { hasText: "Kestrel" }).first();
await card.scrollIntoViewIfNeeded();
const yBefore = await page.evaluate(() => scrollY);
await card.click();
await page.waitForTimeout(1500);
const roleInfo = await page.evaluate(() => { const r = document.querySelector('[data-region="role"]'); const b = r.getBoundingClientRect(); return { roleTop: Math.round(b.top), vh: innerHeight, scrollY, hasCase: !!r.querySelector(".case"), text: r.innerText.slice(0, 200) }; });
step("click pipeline card", { yBefore, ...roleInfo });
await shoot(page, L, "pipeline-after-card-click");
await page.locator('[data-region="role"] .case').first().scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(600);
await shoot(page, L, "dossier-open", { locator: '[data-region="role"]' });
const dossier = await page.evaluate(() => {
  const r = document.querySelector('[data-region="role"]');
  return {
    docket: [...r.querySelectorAll(".case__docket button")].map(b => b.textContent.trim()),
    hint: [...r.querySelectorAll(".case__hint")].map(e => e.textContent.trim()),
    materials: r.querySelector('[data-mount="materials"]')?.innerText.trim(),
    numbers: [...r.querySelectorAll(".case__num")].map(e => e.innerText.replace(/\s+/g, " ")),
    sections: [...r.querySelectorAll(".case__section-title")].map(e => e.textContent),
    h: Math.round(r.getBoundingClientRect().height),
  };
});
step("dossier rendered", dossier);

// 2. Draft cover letter.
await page.locator('[data-region="role"] [data-action="resume-cover"]').first().click();
await page.waitForTimeout(500);
await shoot(page, L, "cover-notes-form-open", { locator: '[data-region="role"]' });
const form = await page.evaluate(() => { const f = document.querySelector(".brief-materials__notes-form"); if (!f) return null; const b = f.getBoundingClientRect(); return { top: Math.round(b.top), inView: b.top >= 0 && b.top < innerHeight, focused: document.activeElement?.className }; });
step("notes form", { form });
await page.locator('.brief-materials__notes-form [data-action="notes-send"]').click();
const sendAt = Date.now();
await page.waitForTimeout(4000);
const after = await page.evaluate(() => { const r = document.querySelector('[data-region="role"]'); return { jd: !!document.querySelector(".brief-materials__jd-form"), jdText: document.querySelector(".brief-materials__jd-form")?.innerText.slice(0, 300), materials: r.querySelector('[data-mount="materials"]')?.innerText.slice(0, 400), docket: [...r.querySelectorAll(".case__docket-actions > *")].map(b => b.textContent.trim()) }; });
step("after start draft (4s)", { ...after, toasts: await toasts(), reqs: reqs.slice(), console: consoleMsgs.slice(-8) });
await shoot(page, L, "cover-after-start-draft", { locator: '[data-region="role"]' });
await shoot(page, L, "cover-after-start-draft-viewport");
// paste a JD
if (after.jd) {
  await page.locator(".brief-materials__jd-form textarea").fill("We are hiring a Staff Frontend Engineer to lead performance and design systems work across our web platform. You will mentor engineers and own Core Web Vitals.");
  await page.locator('.brief-materials__jd-form button[type="submit"]').click();
  await page.waitForTimeout(4000);
  const afterPaste = await page.evaluate(() => { const r = document.querySelector('[data-region="role"]'); return { jd: !!document.querySelector(".brief-materials__jd-form"), jdHint: document.querySelector(".brief-materials__jd-hint")?.textContent, materials: r.querySelector('[data-mount="materials"]')?.innerText.slice(0, 400), docket: [...r.querySelectorAll(".case__docket-actions > *")].map(b => b.textContent.trim()) }; });
  step("after paste JD (4s)", { ...afterPaste, toasts: await toasts() });
  await shoot(page, L, "cover-after-paste-jd", { locator: '[data-region="role"]' });
}
await page.waitForTimeout(8000);
const later = await page.evaluate(() => { const r = document.querySelector('[data-region="role"]'); return { materials: r.querySelector('[data-mount="materials"]')?.innerText.slice(0, 400), docket: [...r.querySelectorAll(".case__docket-actions > *")].map(b => b.textContent.trim()), queue: document.querySelector('[data-region="materials-queue"]')?.innerText.slice(0, 200) }; });
step("12s later", later);
await shoot(page, L, "cover-12s-later", { locator: '[data-region="role"]' });

// 3. Tailor resume
await page.locator('[data-region="role"] [data-action="resume-tailor"]').first().click().catch(e => step("tailor click failed", { e: String(e).slice(0, 200) }));
await page.waitForTimeout(500);
const tf = await page.locator('.brief-materials__notes-form [data-action="notes-send"]').count();
if (tf) { await page.locator('.brief-materials__notes-form [data-action="notes-send"]').click(); }
await page.waitForTimeout(5000);
const tailor = await page.evaluate(() => { const r = document.querySelector('[data-region="role"]'); return { jd: !!document.querySelector(".brief-materials__jd-form"), materials: r.querySelector('[data-mount="materials"]')?.innerText.slice(0, 400), docket: [...r.querySelectorAll(".case__docket-actions > *")].map(b => b.textContent.trim()) }; });
step("tailor resume after 5s", { formShown: tf, ...tailor, toasts: await toasts() });
await shoot(page, L, "resume-after-start", { locator: '[data-region="role"]' });

// 4. Scribe
const scribe = page.locator('[data-region="scribe"]');
await scribe.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const sc = await page.evaluate(() => { const s = document.querySelector('[data-region="scribe"]'); return { target: s.querySelector("[data-scribe-target]")?.textContent, editorEmpty: s.querySelector("#scribeEditor")?.dataset.empty, note: s.querySelector("[data-scribe-score-note]")?.textContent.trim(), model: s.querySelector("[data-scribe-model]")?.textContent, top: Math.round(s.getBoundingClientRect().top + scrollY), docH: document.documentElement.scrollHeight }; });
step("scribe with role open", sc);
await shoot(page, L, "scribe-role-open", { locator: '[data-region="scribe"]' });
await page.locator("#scribeRefineInput").fill("more specific");
await page.locator("#scribeRefineBtn").click({ force: true });
await page.waitForTimeout(2500);
step("scribe refine", { status: await page.locator("[data-scribe-status]").textContent(), toasts: await toasts() });
await shoot(page, L, "scribe-after-refine", { locator: '[data-region="scribe"]' });

// 5. Mark Applied via stepper
await page.locator('[data-region="role"] .case').first().scrollIntoViewIfNeeded();
await page.locator('[data-region="role"] [data-action="stage-step"][data-stage="applied"]').first().click();
await page.waitForTimeout(800);
const dlg = await page.evaluate(() => { const d = document.querySelector('dialog[open], [role="dialog"]:not([hidden]), [role="alertdialog"]'); return d ? { text: d.innerText.slice(0, 600), inputs: [...d.querySelectorAll("input,textarea")].map(i => ({ id: i.id, type: i.type, value: i.value })) } : null; });
step("applied confirm", { dlg });
await shoot(page, L, "applied-confirm-open");
// Edit fields: pick a different applied date & source, confirm
const writes = [];
page.on("request", r => { if (r.url().includes("sheets.googleapis.com") && r.method() !== "GET") writes.push({ m: r.method(), url: decodeURIComponent(r.url()).replace(/.*spreadsheets\/[^/]+/, ""), body: r.postData()?.slice(0, 400) }); });
if (dlg) {
  await page.fill("#jb-submission-applied-date", "2026-09-20").catch(() => {});
  await page.fill("#jb-submission-source", "Company portal").catch(() => {});
  await page.fill("#jb-submission-receipt-note", "Confirmation #A1B2").catch(() => {});
  await page.fill("#jb-submission-follow-up-date", "2026-10-10").catch(() => {});
  await page.getByRole("button", { name: "Mark submitted" }).click();
  await page.waitForTimeout(1000);
  step("after confirm 1s", { toasts: await toasts() });
  await shoot(page, L, "applied-undo-toast");
  await page.waitForTimeout(11000);
  step("after 12s", { toasts: await toasts(), writes });
  await shoot(page, L, "applied-after-write", { locator: '[data-region="role"]' });
}
step("materials API requests", { reqs });
await app.close();
