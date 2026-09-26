import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "modern-patterns";
const vp = process.argv[2] || "desktop";
const app = await openApp({ mode: "signed-in", viewport: vp });
const p = app.page;
const log = (...a) => console.log(vp, ...a);
// open dossier for Kestrel via brief button
await p.getByRole("button", { name: "Open dossier" }).first().click();
await p.waitForTimeout(1500);
await shoot(p, L, "dossier-open");
log("dossier text:", await p.evaluate(() => { const d = document.querySelector('[data-region="role"], .role-case, #role, [data-region="dossier"]'); return d ? d.innerText.replace(/\s+/g, " ").slice(0, 1500) : "no dossier root"; }));
log("regions:", await p.evaluate(() => [...document.querySelectorAll("[data-region]")].map(e => e.getAttribute("data-region") + ":" + Math.round(e.getBoundingClientRect().top + scrollY)).join(" ")));
await shoot(p, L, "dossier-open-full", { fullPage: true });
// materials / scribe
const scribe = p.locator('[data-region="scribe"]').first();
if (await scribe.count()) { await scribe.scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await shoot(p, L, "tailor-scribe"); log("scribe:", (await scribe.innerText()).replace(/\s+/g, " ").slice(0, 1500)); }
await app.close();
