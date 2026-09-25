// Cascade-trap probe: single-class rules that set font-size / font-family /
// font-weight / line-height / color / margin on an h1-h6 or p that renders
// under body.jb-v2, where the computed value differs from the rule's literal
// value because `body.jb-v2 h3|p` (0,1,1) wins. Run from worktree root.
import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const hits = new Map();
async function probe(page, label) {
  const rows = await page.evaluate(() => {
    const out = [];
    const props = ["font-size", "font-family", "font-weight", "line-height", "color", "margin-top", "margin-bottom"];
    const spec = (sel) => { const ids = (sel.match(/#[\w-]+/g) || []).length; const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)(?!not|is|where)[\w-]+/g) || []).length; const types = (sel.replace(/\[[^\]]*\]|\([^)]*\)/g, "").match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length; return [ids, cls, types]; };
    const lt = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
    const walk = (rules, f) => { for (const r of rules) { if (r.cssRules && !(r instanceof CSSStyleRule)) { walk(r.cssRules, f); continue; } if (!(r instanceof CSSStyleRule)) continue;
      for (const part of r.selectorText.split(/,(?![^(]*\))/)) { const p = part.trim(); if (/::|:hover|:focus/.test(p)) continue; const sp = spec(p); if (!lt(sp, [0, 1, 2])) continue;
        let els = []; try { els = [...document.querySelectorAll(p)]; } catch { continue; }
        for (const e of els) { if (!/^(H[1-6]|P)$/.test(e.tagName) || !e.getClientRects().length) continue;
          const cs = getComputedStyle(e);
          for (const pr of props) { const v = r.style.getPropertyValue(pr); if (!v || /var\(|inherit|em$|%/.test(v)) continue;
            const probeEl = document.createElement("div"); probeEl.style.setProperty(pr, v); document.body.appendChild(probeEl); const want = getComputedStyle(probeEl).getPropertyValue(pr); probeEl.remove();
            const got = cs.getPropertyValue(pr);
            if (want && got && want !== got && r.style.getPropertyPriority(pr) !== "important") out.push(`${f} | ${p} | ${e.tagName} | ${pr}: wants ${want}, gets ${got}`);
          } } } } };
    for (const sh of document.styleSheets) if (sh.href) walk(sh.cssRules, new URL(sh.href).pathname.slice(1));
    return out;
  });
  for (const r of rows) hits.set(r, (hits.get(r) || []).concat(label));
}
const click = async (page, sel) => { try { await page.locator(sel).filter({ visible: true }).first().click({ timeout: 3000 }); await page.waitForTimeout(800); return true; } catch { return false; } };
for (const vp of ["desktop"]) {
  const app = await openApp({ mode: "signed-in", viewport: vp, settleMs: 2500 });
  const { page } = app;
  await probe(page, "default");
  if (await click(page, ".brief-btn--primary")) await probe(page, "dossier");
  await page.evaluate(() => scrollTo(0, 0));
  if (await click(page, "#settingsBtn")) { await probe(page, "settings"); await page.keyboard.press("Escape"); }
  if (await click(page, "#discoveryBtn")) { await probe(page, "discovery"); await page.keyboard.press("Escape"); }
  if (await click(page, "#materialsBtn")) { await probe(page, "materials"); await page.keyboard.press("Escape"); }
  await app.close();
  const g = await openApp({ mode: "greenfield", viewport: vp, settleMs: 2500 });
  await probe(g.page, "greenfield");
  if (await click(g.page, ".oneflow-demo__invite-action--primary")) await probe(g.page, "beat1");
  await g.close();
}
// Collapse: one line per rule/prop, noting a sample of states.
const seen = new Map();
for (const [k, st] of hits) { const key = k.replace(/ \| H\d \| | \| P \| /, " | "); if (!seen.has(key)) seen.set(key, { k, st: new Set(st) }); else st.forEach((s) => seen.get(key).st.add(s)); }
console.log(`cascade-trap hits (rule/prop pairs): ${seen.size}`);
for (const { k, st } of seen.values()) console.log(`${k}   [${[...st].join(",")}]`);
