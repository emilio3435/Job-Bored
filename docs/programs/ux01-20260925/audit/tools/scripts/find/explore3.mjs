import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "find";
const vp = process.argv[2] || "desktop";
const log = (...a) => console.log(`[${vp}]`, ...a);
// A
if (!process.argv.includes("--wiz-only")) {
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const { page } = app;
  await page.evaluate(() => globalThis.CommandCenterUserContent.saveDiscoveryProfile({ targetRoles: "Senior Product Designer, Design Engineer", locations: "", remotePolicy: "remote", seniority: "Senior", keywordsInclude: "Design systems, Prototyping" }));
  await page.click("#discoveryBtn");
  await page.waitForTimeout(1500);
  log("prefill", JSON.stringify(await page.evaluate(() => ["dpTargetRoles","dpLocations","dpRemotePolicy","dpSeniority","dpKeywordsInclude"].map(id => document.getElementById(id).value))));
  log("banner", await page.evaluate(() => document.querySelector(".fit-profile-empty-banner")?.innerText || "(none)"));
  await shoot(page, L, "drawer-prefilled-from-onboarding");
  // AI ideas section
  await page.evaluate(() => document.getElementById("dpSuggestBtn").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await shoot(page, L, "drawer-ai-ideas-no-provider");
  log("ai hint", await page.evaluate(() => { const e = document.getElementById("dpAiHint"); return e.hidden ? "(hidden)" : e.innerText; }), "suggest disabled?", await page.evaluate(() => document.getElementById("dpSuggestBtn").disabled));
  await page.click("#dpSuggestBtn").catch(() => {});
  await page.waitForTimeout(1500);
  log("suggest status", await page.evaluate(() => { const e = document.getElementById("dpSuggestStatus"); return e.hidden ? "(hidden)" : e.innerText; }));
  log("toasts", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".toast")].map(e => e.innerText.replace(/\s+/g, " ")))));
  // Run, catch preview
  const shots = [];
  page.on("console", () => {});
  await page.click("#discoveryPrefsRun");
  for (let i = 0; i < 20; i++) {
    const v = await page.evaluate(() => { const m = document.getElementById("discoveryRunPreviewMount"); const d = document.getElementById("discoveryDrawer"); return { mountHidden: m.hidden, text: m.innerText.slice(0, 400), drawerHidden: d.hidden }; });
    if (!v.mountHidden && !v.drawerHidden) { shots.push(v); await shoot(page, L, "run-preview-flash"); break; }
    await page.waitForTimeout(20);
  }
  log("preview seen while drawer open", JSON.stringify(shots));
  const h3 = await page.evaluate(() => { const t = document.querySelector("#discoveryRunPreviewTitle"); return t ? { fs: getComputedStyle(t).fontSize, ff: getComputedStyle(t).fontFamily.slice(0, 40), m: getComputedStyle(t).margin } : null; });
  log("preview h3 computed", JSON.stringify(h3));
  await app.close();
}
// B: setup wizard walk (no webhook)
{
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const { page } = app;
  await page.addInitScript(() => { const k = "command_center_config_overrides"; const o = JSON.parse(localStorage.getItem(k) || "{}"); delete o.discoveryWebhookUrl; delete o.discoveryWebhookSecret; localStorage.setItem(k, JSON.stringify(o)); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  await page.click("#discoveryBtn");
  await page.waitForTimeout(1500);
  await page.fill("#dpTargetRoles", "Designer");
  await page.click("#discoveryPrefsRun");
  await page.waitForTimeout(3000);
  const root = ".discovery-setup-wizard-root";
  const words = ["webhook","tunnel","ngrok","Tailscale","relay","worker","secret","Cloudflare","localhost","8644","npm","terminal","endpoint","Apps Script","bootstrap","CORS","URL","port"];
  const seen = new Set();
  for (let step = 1; step <= 12; step++) {
    const info = await page.evaluate((root) => { const r = [...document.querySelectorAll(root)].find(e => e.getClientRects().length && e.innerText.trim()); if (!r) return null; const btns = [...r.querySelectorAll("button")].filter(b => b.getClientRects().length && !b.disabled).map(b => b.innerText.trim()).filter(Boolean); return { text: r.innerText.replace(/\s+/g, " "), btns }; }, root);
    if (!info) { log("wizard gone at step", step); break; }
    const key = info.text.slice(0, 200);
    if (seen.has(key)) { log("wizard no progress at step", step); break; }
    seen.add(key);
    const counts = Object.fromEntries(words.map(w => [w, (info.text.match(new RegExp("\\b" + w, "gi")) || []).length]).filter(([, n]) => n));
    log(`WIZ ${step}:`, info.text.slice(0, 900));
    log(`WIZ ${step} buttons:`, JSON.stringify(info.btns), "jargon:", JSON.stringify(counts));
    await shoot(page, L, `wizard-step${step}`);
    const next = page.locator(`${root} button`, { hasText: /^(Continue|Next|Skip|Use this|Choose)/ }).first();
    if (!(await next.count())) {
      const opt = page.locator(`${root} button`).filter({ hasText: /local|this computer|recommended/i }).first();
      if (await opt.count()) { await opt.click().catch(() => {}); } else break;
    } else await next.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  await app.close();
}
