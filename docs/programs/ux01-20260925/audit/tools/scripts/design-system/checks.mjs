// UX01 design-system lens — targeted checks. Run from worktree root: node <this>
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop", settleMs: 2500 });
const { page } = app;
const out = await page.evaluate(() => {
  const res = {};
  // 1. role.css stray brace: is `body.jb-v2 .brief-materials` in the CSSOM?
  const sels = [];
  for (const sh of document.styleSheets) if (sh.href && sh.href.endsWith("/role.css")) for (const r of sh.cssRules) if (r.selectorText && r.selectorText.includes("brief-materials")) sels.push(r.selectorText);
  res.roleBriefMaterialsRules = sels.slice(0, 4);
  res.roleHasRootRule = sels.some((s) => s.trim() === "body.jb-v2 .brief-materials");
  // 2. undefined tokens resolve: celebration card padding, settings tab title size
  const probe = (cls, tag = "div") => { const e = document.createElement(tag); e.className = cls; document.body.appendChild(e); const s = getComputedStyle(e); const o = { padding: s.padding, fontSize: s.fontSize, fontFamily: s.fontFamily.split(",")[0] }; e.remove(); return o; };
  res.celebrationCard = probe("onboarding-celebration__card");
  const t = document.querySelector(".settings-tab-panel__title");
  res.settingsTitle = t ? { tag: t.tagName, fontSize: getComputedStyle(t).fontSize, family: getComputedStyle(t).fontFamily.split(",")[0] } : null;
  // 3. legacy-hide: rules whose selector matches only hidden (no-box) elements, per sheet
  const strip = (s) => s.replace(/::?(hover|focus-visible|focus-within|focus|active|visited|before|after|placeholder|selection|marker|backdrop|-webkit-[a-z-]+|-moz-[a-z-]+)(?![\w-])/g, "");
  const per = {};
  const walk = (rules, f) => { for (const r of rules) { if (r.cssRules && !(r instanceof CSSStyleRule)) { walk(r.cssRules, f); continue; } if (!(r instanceof CSSStyleRule)) continue;
    let any = false, vis = false;
    for (const part of r.selectorText.split(/,(?![^(]*\))/)) { let els = []; try { els = [...document.querySelectorAll(strip(part.trim()) || "*")]; } catch {} if (els.length) any = true; if (els.some((e) => e.getClientRects().length > 0)) { vis = true; break; } }
    per[f] ||= { rules: 0, matchedAny: 0, matchedVisible: 0 }; per[f].rules++; if (any) per[f].matchedAny++; if (vis) per[f].matchedVisible++; } };
  for (const sh of document.styleSheets) if (sh.href) walk(sh.cssRules, new URL(sh.href).pathname.slice(1));
  res.hiddenMatch = per;
  // 4. elements present in DOM but hidden by jb-v2-legacy-hide
  const hidden = {};
  for (const s of ["#dashboard > .command-strip.daily-brief-panel", "#dashboard > main.main-content", "#dashboard > header.top-bar", "#pipelineSection", "#resumeGenerateModal", "[data-region=lattice]", "[data-region=welcome]", "[data-region=letter]"]) { const e = document.querySelector(s); hidden[s] = e ? { nodes: e.querySelectorAll("*").length, box: e.getClientRects().length > 0 } : "absent"; }
  res.hiddenHosts = hidden;
  res.totalNodes = document.querySelectorAll("*").length;
  // 5. token values actually in force on body
  const b = getComputedStyle(document.body);
  res.tokens = Object.fromEntries(["--surface", "--border", "--text", "--jb-ink", "--accent", "--jb-mint", "--radius-md", "--mute", "--font-body", "--jb-font-body"].map((k) => [k, b.getPropertyValue(k).trim()]));
  // 6. fonts actually loaded
  res.fontsLoaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight} ${f.style}`);
  // 7. z-index of main overlays
  res.z = Object.fromEntries([".page-top", ".toast-stack", "#settingsModal", "#discoveryDrawer", ".modal-overlay"].map((s) => { const e = document.querySelector(s); return [s, e ? getComputedStyle(e).zIndex : "absent"]; }));
  return res;
});
console.log(JSON.stringify(out, null, 1));
await app.close();
// Legacy view for comparison
const legacy = await openApp({ mode: "signed-in", viewport: "desktop", path: "/?jb-v2=0", settleMs: 2500 });
console.log("legacy bodyClass:", await legacy.page.evaluate(() => document.body.className));
console.log(await shoot(legacy.page, "design-system", "legacy-view-default"));
await legacy.close();
