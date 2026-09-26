import { openApp, shoot, runAxe } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "find";
const vp = process.argv[2] || "desktop";
const log = (...a) => console.log(`[${vp}]`, ...a);
async function toasts(page) {
  return page.evaluate(() => [...document.querySelectorAll('.toast, [class*="toast"]')].filter(e => e.offsetParent && e.textContent.trim()).map(e => e.textContent.replace(/\s+/g, " ").trim()).filter((t, i, a) => a.indexOf(t) === i).slice(0, 6));
}
const app = await openApp({ mode: "signed-in", viewport: vp });
const { page } = app;
const consoleErrs = [];
page.on("console", m => { if (m.type() === "error") consoleErrs.push(m.text().slice(0, 200)); });
await shoot(page, L, "dashboard-default");
// entry point positions
const pos = await page.evaluate(() => {
  const r = id => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { id, top: Math.round(b.top + scrollY), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height), visible: !!e.offsetParent, text: e.textContent.replace(/\s+/g, " ").trim().slice(0, 40), title: e.title || "" }; };
  return ["discoveryBtn", "runsBtn", "ingestUrlInput", "ingestUrlSubmit", "ingestManualModalOpenBtn", "whatsNextOpenDiscovery", "companiesBtn"].map(r);
});
log("entry points", JSON.stringify(pos, null, 0));
log("vh", await page.evaluate(() => innerHeight));
// open the drawer
await page.click("#discoveryBtn");
await page.waitForSelector("#discoveryDrawer:not([hidden])", { timeout: 5000 });
await page.waitForTimeout(1200);
await shoot(page, L, "drawer-search-open");
await shoot(page, L, "drawer-search-full", { locator: "#discoveryDrawer .discovery-drawer__inner" });
log("chip", await page.textContent("#discoveryDrawerReadiness"), "| lastrun:", await page.evaluate(() => { const e = document.getElementById("discoveryDrawerLastRun"); return e.hidden ? "(hidden)" : e.textContent; }));
log("banner", await page.evaluate(() => document.querySelector(".fit-profile-empty-banner")?.textContent || "(none)"));
log("fields", JSON.stringify(await page.evaluate(() => ["dpTargetRoles","dpLocations","dpRemotePolicy","dpSeniority","dpKeywordsInclude","dpKeywordsExclude","dpMaxLeads"].map(id => [id, document.getElementById(id).value]))));
log("ai hint hidden?", await page.evaluate(() => document.getElementById("dpAiHint").hidden));
log("focused", await page.evaluate(() => document.activeElement?.id));
const inputs = await page.evaluate(() => { const p = document.getElementById("dd-panel-search"); return [...p.querySelectorAll("input,textarea,select,button")].filter(e => e.offsetParent).length; });
log("search-tab visible controls", inputs);
const counts = await page.evaluate(() => [...document.querySelectorAll(".discovery-subtab-panel")].map(p => [p.id, [...p.querySelectorAll("input,textarea,select,button,a")].length, p.innerText.split(/\s+/).length]));
log("controls/words per panel", JSON.stringify(counts));
for (const t of ["sources", "automation", "connection", "history"]) {
  await page.click(`#dd-tab-${t}`);
  await page.waitForTimeout(400);
  await shoot(page, L, `drawer-${t}`);
}
const axeDrawer = await runAxe(page, { include: "#discoveryDrawer" });
log("axe drawer", JSON.stringify(axeDrawer));
await page.click("#dd-tab-search");
// Run with blank intent
await page.fill("#dpTargetRoles", "");
await page.fill("#dpKeywordsInclude", "");
await page.click("#discoveryPrefsRun");
await page.waitForTimeout(1500);
log("blank-run toasts", JSON.stringify(await toasts(page)));
log("suggest status", await page.evaluate(() => { const e = document.getElementById("dpSuggestStatus"); return e.hidden ? "(hidden)" : e.textContent; }));
await shoot(page, L, "drawer-run-blank-intent");
// Fill and run
await page.fill("#dpTargetRoles", "Senior Product Designer");
const t0 = Date.now();
await page.click("#discoveryPrefsRun");
const snaps = [];
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(500);
  snaps.push([Date.now() - t0, (await toasts(page)).join(" || "), await page.evaluate(() => [document.getElementById("discoveryBtn").className, document.getElementById("discoveryDrawer").hidden, document.getElementById("discoveryRunPreviewMount")?.hidden])]);
  if (i === 1) await shoot(page, L, "run-pending");
}
for (const s of snaps) log("t+", JSON.stringify(s));
await shoot(page, L, "run-lost-connection");
log("btn aria-label", await page.getAttribute("#discoveryBtn", "aria-label"));
// runs modal
await page.click("#runsBtn");
await page.waitForTimeout(1500);
await shoot(page, L, "runs-default");
log("runs status", await page.textContent("#runsStatus"));
log("runs rows", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("#runsTableBody tr")].map(r => r.innerText.replace(/\s+/g, " | ")))));
log("runs table overflow", JSON.stringify(await page.evaluate(() => { const w = document.querySelector(".runs-table-wrap"); return { client: w.clientWidth, scroll: w.scrollWidth }; })));
const axeRuns = await runAxe(page, { include: "#runsModal" });
log("axe runs", JSON.stringify(axeRuns));
await page.click('[data-runs-filter-status="failure"]');
await page.waitForTimeout(400);
await shoot(page, L, "runs-filter-failure");
await page.click('[data-runs-filter-status="all"]');
await page.click("#runsModalClose");
await page.waitForTimeout(300);
log("console errors", JSON.stringify(consoleErrs.slice(0, 8)));
log("unexpectedExternal", JSON.stringify(app.unexpectedExternal.slice(0, 10)));
await app.close();
