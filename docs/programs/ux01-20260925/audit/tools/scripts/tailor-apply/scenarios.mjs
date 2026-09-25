// Scenarios: (a) no materials server, (b) mocked pending->ready run, (c) Scribe unbound, (d) Portfolio modal.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "tailor-apply";
const vp = process.argv[2] || "desktop";
const which = process.argv[3] || "all";
const MAT = "http://127.0.0.1:3847";
const SLUG = "kestrel-staff-frontend-engineer";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,PUT,OPTIONS", "content-type": "application/json" };
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toastContainer .toast-message')].map(e => e.textContent.trim()));
async function openKestrel(page) {
  await page.locator('[data-region="pipeline"] article.pipe-sticker', { hasText: "Kestrel" }).first().click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll('#toastContainer .toast').forEach(t => t.remove()));
}
const mat = (page) => page.evaluate(() => { const r = document.querySelector('[data-region="role"]'); return { materials: r.querySelector('[data-mount="materials"]')?.innerText.replace(/\n+/g, " | ").slice(0, 600), docket: [...r.querySelectorAll(".case__docket-actions > *")].map(b => b.textContent.trim()), numbers: [...r.querySelectorAll(".case__num")].map(e => e.innerText.replace(/\s+/g, " ")) }; });

if (which === "all" || which === "noserver") {
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const { page } = app;
  await page.route(MAT + "/**", r => r.abort("connectionrefused"));
  await openKestrel(page);
  console.log("NOSERVER open", JSON.stringify(await mat(page)));
  await shoot(page, L, "noserver-dossier", { locator: '[data-region="role"]' });
  await page.locator('[data-region="role"] [data-action="resume-cover"]').first().click();
  await page.waitForTimeout(400);
  const formShown = await page.locator(".brief-materials__notes-form").count();
  if (formShown) await page.locator('.brief-materials__notes-form [data-action="notes-send"]').click();
  await page.waitForTimeout(3000);
  console.log("NOSERVER after", formShown, JSON.stringify(await mat(page)), JSON.stringify(await toasts(page)));
  await shoot(page, L, "noserver-after-draft", { locator: '[data-region="role"]' });
  await app.close();
}

if (which === "all" || which === "mocked") {
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const { page } = app;
  let requested = false, polls = 0;
  const t0 = Date.now();
  const timeline = [];
  await page.route(MAT + "/**", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const j = (b, s = 200) => route.fulfill({ status: s, headers: cors, body: JSON.stringify(b) });
    if (u.pathname === "/api/applications") return j({ applications: requested ? [{ slug: SLUG, company: "Kestrel", title: "Staff Frontend Engineer" }] : [] });
    if (u.pathname === "/api/applications/queue") return j({ queue: requested && polls < 3 ? [{ slug: SLUG, company: "Kestrel", title: "Staff Frontend Engineer", feature: "both", progress: { phase: "drafting" } }] : [] });
    if (u.pathname.endsWith("/job-description") && m === "GET") return j({ exists: true, text: "x".repeat(200) });
    if (u.pathname.endsWith("/request") && m === "POST") { requested = true; timeline.push(["POST request", Date.now() - t0]); return j({ ok: true, slug: SLUG }, 202); }
    if (u.pathname.endsWith("/manifest")) {
      const base = { slug: SLUG, company: "Kestrel", title: "Staff Frontend Engineer", documents: [] };
      if (!requested) return j(base);
      polls++; timeline.push(["manifest poll " + polls, Date.now() - t0]);
      if (polls < 4) return j({ ...base, pending: { feature: "cover_letter", requestedAt: new Date(t0).toISOString(), progress: { phase: "drafting", message: "Writing your cover letter and tailoring your resume…", started_at: new Date(t0).toISOString(), attempt: 1 } } });
      const f = (n, s) => ({ filename: n, format: n.split(".").pop(), size: s, modifiedAt: "2026-09-25T15:05:00.000Z" });
      return j({ ...base, updatedAt: "2026-09-25T15:05:00.000Z",
        documents: [
          { type: "resume", label: "Tailored Resume", status: "ready", primary: "resume.pdf", lastModifiedAt: "2026-09-25T15:05:00.000Z", files: [f("resume.pdf", 150000), f("resume.html", 20000)] },
          { type: "cover_letter", label: "Cover Letter", status: "ready", primary: "cover-letter.pdf", lastModifiedAt: "2026-09-25T15:05:00.000Z", files: [f("cover-letter.pdf", 100000), f("cover-letter.html", 12000)] },
          { type: "qa_report", label: "QA Report", status: "ready", primary: "qa-report.md", files: [f("qa-report.md", 3000)] },
          { type: "manual_apply_checklist", label: "Apply Checklist", status: "ready", primary: "manual-apply-checklist.md", files: [f("manual-apply-checklist.md", 1500)] },
        ],
        quality: { documents: { resume: { status: "review", issues: [{ code: "resume_page_count_high", message: "Resume runs to 3 pages." }] } } } });
    }
    return j({ ok: true });
  });
  await openKestrel(page);
  await page.locator('[data-region="role"] [data-action="resume-cover"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.brief-materials__notes-form [data-action="notes-send"]').click();
  await page.waitForTimeout(2500);
  console.log("MOCK pending", JSON.stringify(await mat(page)));
  await shoot(page, L, "materials-pending", { locator: '[data-region="role"]' });
  const qtext = await page.evaluate(() => { const q = document.querySelector('[data-region="materials-queue"]'); return q ? { hidden: q.hidden, text: q.innerText.slice(0, 200) } : null; });
  console.log("QUEUE", JSON.stringify(qtext));
  if (qtext && !qtext.hidden) await shoot(page, L, "materials-queue-strip", { locator: '[data-region="materials-queue"]' });
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(1000); const s = await mat(page); if (/ready/i.test(s.materials)) break; }
  console.log("MOCK ready", JSON.stringify(await mat(page)), "timeline", JSON.stringify(timeline));
  const rowActions = await page.evaluate(() => [...document.querySelectorAll('[data-region="role"] .case__doc')].map(d => d.getAttribute("data-doc") + ": " + [...d.querySelectorAll("a,button")].map(a => a.textContent.trim() + (a.href ? "(" + a.getAttribute("href").replace(/^.*\/files\//, "") + ")" : "")).join(", ")));
  console.log("ROW ACTIONS", JSON.stringify(rowActions));
  await shoot(page, L, "materials-ready", { locator: '[data-region="role"]' });
  await app.close();
}

if (which === "all" || which === "scribe") {
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const { page } = app;
  await page.evaluate(() => document.querySelectorAll('#toastContainer .toast').forEach(t => t.remove()));
  const geo = await page.evaluate(() => { const s = document.querySelector('[data-region="scribe"]'); const b = s.getBoundingClientRect(); const strip = s.querySelector(".scribe-strip"); const sb = strip.getBoundingClientRect(); return { scribeTop: Math.round(b.top + scrollY), scribeH: Math.round(b.height), docH: document.documentElement.scrollHeight, stripPos: getComputedStyle(strip).position, target: s.querySelector("[data-scribe-target]")?.textContent, tabbables: s.querySelectorAll("button, select, input, textarea, [contenteditable='true'], a[href]").length }; });
  console.log("SCRIBE geometry", JSON.stringify(geo));
  await page.locator('[data-region="scribe"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shoot(page, L, "scribe-no-role", { locator: '[data-region="scribe"]' });
  await shoot(page, L, "scribe-no-role-viewport");
  // Refine with nothing
  await page.evaluate(() => { document.getElementById("scribeRefineInput").value = "more specific"; document.getElementById("scribeRefineBtn").click(); });
  await page.waitForTimeout(2500);
  console.log("SCRIBE refine status", await page.locator("[data-scribe-status]").textContent(), JSON.stringify(await toasts(page)));
  // Paste text and see local fallback scoring
  await page.evaluate(() => { const e = document.getElementById("scribeEditor"); e.textContent = "Dear hiring team, I led a design-system migration and improved Core Web Vitals across a large React codebase. I mentor engineers and care about performance."; e.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(2500);
  const sc = await page.evaluate(() => { const s = document.querySelector('[data-region="scribe"]'); return { note: s.querySelector("[data-scribe-score-note]")?.textContent.trim(), model: s.querySelector("[data-scribe-model]")?.textContent, axes: [...s.querySelectorAll(".scribe-axis")].map(a => a.innerText.replace(/\s+/g, " ")), save: s.querySelector("[data-scribe-save]")?.textContent, gaps: s.querySelector("#scribeGaps")?.innerText, ring: s.querySelector("#scribeFitRing")?.getAttribute("label") }; });
  console.log("SCRIBE pasted", JSON.stringify(sc));
  await shoot(page, L, "scribe-pasted", { locator: '[data-region="scribe"]' });
  // Open role, check scribe binding
  await openKestrel(page);
  console.log("SCRIBE after role open target", await page.locator("[data-scribe-target]").textContent());
  // audit log link
  await page.evaluate(() => document.querySelector("[data-scribe-audit]").click());
  await page.waitForTimeout(300);
  console.log("AUDIT link hash", await page.evaluate(() => location.hash));
  await app.close();
}

if (which === "all" || which === "portfolio") {
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const { page } = app;
  await page.evaluate(() => document.querySelectorAll('#toastContainer .toast').forEach(t => t.remove()));
  await page.locator("#materialsBtn").click();
  await page.waitForTimeout(1000);
  const modal = await page.evaluate(() => { const m = document.getElementById("materialsModal"); return m ? { visible: m.getBoundingClientRect().height > 0, title: m.querySelector("#materialsModalTitle")?.textContent.trim(), headings: [...m.querySelectorAll("h3,h4,[id$=Heading]")].map(h => h.textContent.trim()).slice(0, 10) } : null; });
  console.log("PORTFOLIO", JSON.stringify(modal));
  await shoot(page, L, "portfolio-modal-open");
  await app.close();
}
