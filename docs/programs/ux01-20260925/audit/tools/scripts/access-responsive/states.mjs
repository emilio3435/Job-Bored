// UX01 access-responsive: axe + 375 overflow + target-size sweep over 8 states x 2 viewports.
// Run from worktree root: node <this> [desktop|phone|both]
import { openApp, shoot, runAxe } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
import { writeFileSync } from "node:fs";
const S = "/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/ux01/access-responsive/";
const LENS = "access-responsive";
const which = process.argv[2] || "both";
const vps = which === "both" ? ["desktop", "phone"] : [which];

async function measure(page, scope) {
  return page.evaluate((scope) => {
    const root = scope ? document.querySelector(scope) : document;
    const W = innerWidth;
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[inert],[aria-hidden=true]"); };
    const sel = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "");
    const overflowPx = document.documentElement.scrollWidth - W;
    const wide = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 || r.width > W + 1) {
        const p = el.parentElement; const pr = p?.getBoundingClientRect();
        // report only the outermost offender whose parent fits
        if (!p || !(pr.right > W + 1 || pr.width > W + 1)) wide.push(`${sel(el)} w=${Math.round(r.width)} right=${Math.round(r.right)}`);
      }
    }
    const I = "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=menuitem],[role=menuitemradio],[role=option],[role=checkbox],[role=switch],[tabindex]:not([tabindex='-1'])";
    const els = [...(root || document).querySelectorAll(I)].filter(vis);
    const small44 = [], small24 = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (el.matches("input[type=checkbox],input[type=radio]") && el.closest("label")) continue;
      const name = (el.getAttribute("aria-label") || el.textContent || el.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const d = `${sel(el)} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`;
      if (r.width < 44 || r.height < 44) small44.push(d);
      if (r.width < 24 || r.height < 24) small24.push(d);
    }
    return { W, overflowPx, wide: wide.slice(0, 15), wideCount: wide.length, interactive: els.length, small44: small44.length, small24: small24.length, small24List: small24.slice(0, 20), small44Sample: small44.slice(0, 25) };
  }, scope);
}

const states = [
  { name: "demo-board", mode: "greenfield", go: async () => {} },
  { name: "onboarding-beat1", mode: "greenfield", go: async (p) => { await p.getByRole("button", { name: /Make it mine/ }).first().click(); await p.waitForTimeout(1500); } },
  { name: "dashboard", mode: "signed-in", go: async () => {} },
  { name: "discovery-drawer", mode: "signed-in", scope: "#discoveryDrawer", go: async (p) => { await p.locator("#discoveryBtn:visible, [data-flowing-action=discoveryBtn]:visible").first().click().catch(async () => { await p.evaluate(() => document.getElementById("discoveryBtn").click()); }); await p.waitForTimeout(1200); } },
  { name: "settings", mode: "signed-in", scope: "#settingsModal", go: async (p) => { await p.locator("#settingsBtn:visible").first().click().catch(async () => { await p.evaluate(() => document.getElementById("settingsBtn").click()); }); await p.waitForTimeout(1200); } },
  { name: "dossier", mode: "signed-in", scope: '[data-region="role"]', go: async (p) => { await p.locator(".today-item__action", { hasText: "Open dossier" }).first().click(); await p.waitForTimeout(1500); await p.locator('[data-region="role"]').scrollIntoViewIfNeeded(); } },
  { name: "scribe", mode: "signed-in", scope: '[data-region="scribe"]', go: async (p) => { await p.locator('[data-region="scribe"]').scrollIntoViewIfNeeded(); await p.waitForTimeout(600); } },
  { name: "stage-menu", mode: "signed-in", scope: ".jb-a11y-stage-menu[data-open], .jb-a11y-stage-menu", go: async (p) => { const t = p.locator('[data-action="move-to-stage"]:visible').first(); await t.scrollIntoViewIfNeeded(); await t.click(); await p.waitForTimeout(800); } },
];

const results = [];
for (const vp of vps) {
  for (const st of states) {
    const app = await openApp({ mode: st.mode, viewport: vp });
    const { page } = app;
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
    let reached = true;
    try { await st.go(page); } catch (e) { reached = false; errs.push("GO: " + e.message.split("\n")[0].slice(0, 160)); }
    const shot = await shoot(page, LENS, `${st.name}`, {});
    const full = await runAxe(page);
    let scoped = null;
    if (st.scope) { try { const s = st.scope.split(",")[0].trim(); if (await page.locator(s).count()) scoped = await runAxe(page, { include: s }); } catch (e) { errs.push("AXE-SCOPE " + e.message.slice(0, 100)); } }
    const m = await measure(page, st.scope ? st.scope.split(",")[0].trim() : null);
    const tally = (v) => { const t = { critical: 0, serious: 0, moderate: 0, minor: 0 }; for (const x of v) t[x.impact] = (t[x.impact] || 0) + 1; return t; };
    const rec = { state: st.name, vp, width: page.viewportSize().width, reached, shot, axeFull: { tally: tally(full), rules: full.map((v) => `${v.id}(${v.impact},${v.nodes})`), detail: full }, axeScoped: scoped && { scope: st.scope.split(",")[0].trim(), tally: tally(scoped), rules: scoped.map((v) => `${v.id}(${v.impact},${v.nodes})`), detail: scoped }, m, errs };
    results.push(rec);
    console.log(`${st.name} @${rec.width} reached=${reached} full=${JSON.stringify(rec.axeFull.tally)} ${rec.axeFull.rules.join(" ")}${scoped ? " | scoped=" + JSON.stringify(rec.axeScoped.tally) + " " + rec.axeScoped.rules.join(" ") : ""} | overflow=${m.overflowPx} wide=${m.wideCount} int=${m.interactive} <44=${m.small44} <24=${m.small24} ${errs.length ? "ERR " + errs.join(" / ") : ""}`);
    await app.close();
  }
}
writeFileSync(S + `states-${which}.json`, JSON.stringify(results, null, 2));
