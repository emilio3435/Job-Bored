// UX01 design-system lens — runtime pass.
// Run from the worktree root:  node <this file>
// For greenfield + signed-in (+ empty/error defaults) at 1440 and 375 it:
//   - records Chromium CSS coverage (started, then page reloaded so first
//     paint is tracked) across every driven state,
//   - runs a selector-match pass over document.styleSheets after each state,
//   - inventories rendered buttons / pills / cards / inputs by computed style,
//   - records rendered font sizes / families / weights,
//   - screenshots each state to audit/shots/design-system/.
// Writes runtime.json next to this script.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const LENS = "design-system";
const REPS = join(HERE, "reps");
mkdirSync(REPS, { recursive: true });

const ruleMatch = new Map(); // key -> {sheet, sel, matched}
const coverage = new Map(); // url -> {text, ranges:[]}
const inventory = { button: new Map(), pill: new Map(), card: new Map(), input: new Map() };
const type = { size: new Map(), family: new Map(), weight: new Map(), combo: new Map() };
const colours = { text: new Map(), bg: new Map() };
const log = [];

async function matchPass(page) {
  const rows = await page.evaluate(() => {
    const out = [];
    const strip = (s) =>
      s.replace(/::?(hover|focus-visible|focus-within|focus|active|visited|link|before|after|placeholder|selection|marker|first-letter|first-line|backdrop|target|checked|placeholder-shown|-webkit-[a-z-]+|-moz-[a-z-]+|autofill)(?![\w-])/g, "")
       .replace(/:(is|where)\(\s*\)/g, "");
    const walk = (rules, sheet, path) => {
      [...rules].forEach((r, i) => {
        const p = `${path}/${i}`;
        if (r.cssRules && !(r instanceof CSSStyleRule)) return walk(r.cssRules, sheet, p);
        if (!(r instanceof CSSStyleRule)) return;
        let matched = false;
        const parts = r.selectorText.split(/,(?![^(]*\))/);
        for (const part of parts) {
          let s = strip(part.trim()) || "*";
          try { if (document.querySelector(s)) { matched = true; break; } } catch { /* invalid after strip */ }
        }
        out.push([sheet, p, r.selectorText.slice(0, 160), matched]);
        if (r.cssRules && r.cssRules.length) walk(r.cssRules, sheet, p);
      });
    };
    for (const sh of document.styleSheets) {
      const href = sh.href ? new URL(sh.href).pathname.replace(/^\//, "") : "(inline)";
      try { walk(sh.cssRules, href, ""); } catch { /* cross-origin */ }
    }
    return out;
  });
  for (const [sheet, p, sel, m] of rows) {
    const k = sheet + p;
    const cur = ruleMatch.get(k);
    if (!cur) ruleMatch.set(k, { sheet, sel, matched: m });
    else if (m) cur.matched = true;
  }
}

async function inventoryPass(page, state) {
  const res = await page.evaluate((state) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const s = getComputedStyle(e);
      if (s.visibility === "hidden" || s.opacity === "0") return false;
      return !!e.offsetParent || s.position === "fixed";
    };
    const cls = (e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${[...e.classList].slice(0, 3).map((c) => "." + c).join("")}`;
    const sig = (e) => {
      const s = getComputedStyle(e);
      const bw = s.borderTopWidth === "0px" || s.borderTopStyle === "none" ? "none" : `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`;
      return [s.backgroundColor, s.color, bw, s.borderTopLeftRadius, s.fontFamily.split(",")[0].replace(/"/g, ""), s.fontSize, s.fontWeight, s.textTransform, s.boxShadow === "none" ? "noshadow" : "shadow", `${Math.round(e.getBoundingClientRect().height)}h`].join(" | ");
    };
    const coarse = (e) => {
      const s = getComputedStyle(e);
      const filled = s.backgroundColor !== "rgba(0, 0, 0, 0)" ? s.backgroundColor : "clear";
      const bw = s.borderTopWidth === "0px" || s.borderTopStyle === "none" ? "noborder" : s.borderTopColor;
      const rad = parseFloat(s.borderTopLeftRadius) >= 999 || s.borderTopLeftRadius.includes("%") ? "pill" : s.borderTopLeftRadius;
      return [filled, bw, rad, s.fontFamily.split(",")[0].replace(/"/g, ""), s.fontWeight].join(" | ");
    };
    const all = [...document.querySelectorAll("body *")].filter(vis);
    const out = { button: [], pill: [], card: [], input: [], type: [], colours: [] };
    let n = 0;
    const tag = (e) => { const id = `${state}-${n++}`; e.setAttribute("data-ds-rep", id); return id; };
    for (const e of all) {
      const c = e.className && typeof e.className === "string" ? e.className : "";
      const isBtn = e.matches("button, [role=button], a.btn, a[class*='btn'], a[class*='button'], input[type=submit], input[type=button]") && !e.closest("jb-fit-ring");
      const isInput = e.matches("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=range]):not([type=file]), select, textarea");
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (isBtn) out.button.push({ sig: sig(e), coarse: coarse(e), who: cls(e), rep: tag(e) });
      else if (isInput) out.input.push({ sig: sig(e), coarse: coarse(e), who: cls(e), rep: tag(e) });
      else if ((/chip|pill|badge|tag\b|__tag|stamp/.test(c) || (parseFloat(s.borderTopLeftRadius) >= r.height / 2 - 1 && r.height <= 30 && r.width > r.height * 1.4 && s.backgroundColor !== "rgba(0, 0, 0, 0)")) && r.height <= 36)
        out.pill.push({ sig: sig(e), coarse: coarse(e), who: cls(e), rep: tag(e) });
      else if (/card|sticker|panel|tile|brief-lead\b|dossier/.test(c) && r.width * r.height > 12000 && (s.boxShadow !== "none" || (s.borderTopStyle !== "none" && s.borderTopWidth !== "0px")))
        out.card.push({ sig: sig(e), coarse: coarse(e), who: cls(e), rep: tag(e) });
      const hasText = [...e.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim());
      if (hasText) {
        out.type.push([s.fontSize, s.fontFamily.split(",")[0].replace(/"/g, "").trim(), s.fontWeight, cls(e)]);
        out.colours.push([s.color, s.backgroundColor]);
      }
    }
    return out;
  }, state);
  for (const k of ["button", "pill", "card", "input"]) for (const it of res[k]) {
    if (!inventory[k].has(it.sig)) inventory[k].set(it.sig, { coarse: it.coarse, who: new Set(), states: new Set(), rep: it.rep, repState: state, count: 0 });
    const x = inventory[k].get(it.sig); x.who.add(it.who); x.states.add(state); x.count++;
  }
  for (const [sz, fam, w, who] of res.type) {
    const bump = (m, key) => m.set(key, (m.get(key) || { n: 0, who: new Set() })) && (m.get(key).n++, m.get(key).who.add(who));
    bump(type.size, sz); bump(type.family, fam); bump(type.weight, w); bump(type.combo, `${fam} ${w} ${sz}`);
  }
  for (const [c, b] of res.colours) { colours.text.set(c, (colours.text.get(c) || 0) + 1); colours.bg.set(b, (colours.bg.get(b) || 0) + 1); }
  // Screenshot representatives for the contact sheet (first time a signature is seen in this state)
  for (const k of ["button", "pill", "card", "input"]) for (const [sig, x] of inventory[k]) {
    if (x.repState !== state || x.shot) continue;
    try {
      const loc = page.locator(`[data-ds-rep="${x.rep}"]`).first();
      await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
      const file = join(REPS, `${k}-${x.rep}.png`);
      await loc.screenshot({ path: file, timeout: 3000 });
      x.shot = file;
    } catch { x.shot = null; }
  }
}

async function state(page, name, vpw, { full = false } = {}) {
  await page.waitForTimeout(500);
  await matchPass(page);
  await inventoryPass(page, `${name}@${vpw}`);
  const p = await shoot(page, LENS, name, { fullPage: full });
  log.push(p);
}

async function tryClick(page, sel, label) {
  try {
    const loc = page.locator(sel).filter({ visible: true }).first();
    await loc.click({ timeout: 4000 });
    await page.waitForTimeout(900);
    return true;
  } catch (e) { log.push(`click failed: ${label} (${sel}) ${String(e.message).split("\n")[0]}`); return false; }
}
async function esc(page) { await page.keyboard.press("Escape"); await page.waitForTimeout(500); }

async function run(mode, viewport, drive) {
  const app = await openApp({ mode, viewport, settleMs: 2000 });
  const { page } = app;
  await page.coverage.startCSSCoverage({ resetOnNavigation: false });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  const w = page.viewportSize().width;
  await drive(page, w);
  const cov = await page.coverage.stopCSSCoverage();
  for (const e of cov) {
    const u = new URL(e.url).pathname.replace(/^\//, "");
    if (!coverage.has(u)) coverage.set(u, { len: e.text.length, ranges: [] });
    coverage.get(u).ranges.push(...e.ranges);
  }
  log.push(`${mode}@${viewport} unexpectedExternal=${app.unexpectedExternal.length}`);
  await app.close();
}

for (const vp of ["desktop", "phone"]) {
  await run("greenfield", vp, async (page, w) => {
    await state(page, "greenfield-demo", w, { full: true });
    if (await tryClick(page, ".oneflow-demo__invite-action--primary", "make it mine")) await state(page, "greenfield-beat1", w, { full: true });
  });
  await run("greenfield", vp, async (page, w) => {
    if (await tryClick(page, ".oneflow-demo__invite-action--ghost", "poke around")) await state(page, "greenfield-poke", w, { full: true });
  });
  await run("signed-in", vp, async (page, w) => {
    await state(page, "signed-in-default", w, { full: true });
    if (await tryClick(page, ".pipe-tool__btn--url", "add job url")) { await state(page, "signed-in-addurl", w); await esc(page); }
    if (await tryClick(page, ".jb-a11y-stage-menu__trigger", "move to stage")) { await state(page, "signed-in-stagemenu", w); await esc(page); }
    if (await tryClick(page, ".brief-btn--primary", "open dossier")) { await state(page, "signed-in-dossier", w, { full: true }); }
    await page.evaluate(() => window.scrollTo(0, 0));
    if (await tryClick(page, "#settingsBtn", "settings")) {
      await state(page, "settings-open", w);
      const tabs = await page.locator(".settings-tab, [role=tab]").filter({ visible: true }).count();
      for (let i = 1; i < Math.min(tabs, 8); i++) {
        try { await page.locator(".settings-tab, [role=tab]").filter({ visible: true }).nth(i).click({ timeout: 2000 }); await page.waitForTimeout(400); await matchPass(page); await inventoryPass(page, `settings-tab${i}@${w}`); if (i <= 3) log.push(await shoot(page, LENS, `settings-tab${i}`)); } catch { /* ignore */ }
      }
      await esc(page);
    }
    if (await tryClick(page, "#discoveryBtn", "discovery")) { await state(page, "discovery-open", w); await esc(page); }
    if (await tryClick(page, "#runsBtn", "runs log")) { await state(page, "runs-open", w); await esc(page); }
    if (await tryClick(page, "#materialsBtn", "materials")) { await state(page, "materials-open", w); await esc(page); }
    if (await tryClick(page, "#authMenuToggle", "auth menu")) { await state(page, "auth-menu-open", w); await esc(page); }
  });
  await run("signed-in-empty", vp, async (page, w) => { await state(page, "signed-in-empty", w, { full: true }); });
  await run("signed-in-error", vp, async (page, w) => { await state(page, "signed-in-error", w, { full: true }); });
}

// Coverage: union of used byte ranges per file
const covOut = {};
for (const [u, { len, ranges }] of coverage) {
  ranges.sort((a, b) => a.start - b.start);
  let used = 0, end = -1;
  for (const r of ranges) { if (r.end <= end) continue; used += r.end - Math.max(r.start, end); end = r.end; }
  covOut[u] = { bytes: len, used, pct: Math.round((used / len) * 1000) / 10 };
}
const matchOut = {};
for (const { sheet, matched } of ruleMatch.values()) { matchOut[sheet] ||= { rules: 0, matched: 0 }; matchOut[sheet].rules++; if (matched) matchOut[sheet].matched++; }
const ser = (m) => [...m].map(([sig, x]) => ({ sig, coarse: x.coarse, who: [...x.who].slice(0, 6), states: [...x.states], count: x.count, shot: x.shot }));
const tser = (m) => [...m].map(([k, v]) => ({ k, n: v.n, who: [...v.who].slice(0, 5) })).sort((a, b) => b.n - a.n);
const unmatchedSamples = {};
for (const { sheet, sel, matched } of ruleMatch.values()) if (!matched) (unmatchedSamples[sheet] ||= []).length < 400 && unmatchedSamples[sheet].push(sel);
writeFileSync(join(HERE, "runtime.json"), JSON.stringify({ log, covOut, matchOut, unmatchedSamples, inventory: { button: ser(inventory.button), pill: ser(inventory.pill), card: ser(inventory.card), input: ser(inventory.input) }, type: { size: tser(type.size), family: tser(type.family), weight: tser(type.weight), combo: tser(type.combo) }, colours: { text: colours.text.size, bg: colours.bg.size } }, null, 1));
console.log(log.join("\n"));
console.log("done");
