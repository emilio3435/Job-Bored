// axe color-contrast details (fg, bg, ratio, font) per state at 1440, grouped by selector class.
import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const AXE = readFileSync("/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/axe/node_modules/axe-core/axe.min.js", "utf8");
const vp = process.argv[2] || "desktop";
const states = [
  ["demo-board", "greenfield", async () => {}],
  ["onboarding-beat1", "greenfield", async (p) => { await p.getByRole("button", { name: /Make it mine/ }).first().click(); await p.waitForTimeout(1500); }],
  ["dashboard", "signed-in", async () => {}],
  ["discovery-drawer", "signed-in", async (p) => { await p.evaluate(() => document.getElementById("discoveryBtn").click()); await p.waitForTimeout(1200); }],
  ["settings", "signed-in", async (p) => { await p.evaluate(() => document.getElementById("settingsBtn").click()); await p.waitForTimeout(1200); }],
];
const all = {};
for (const [name, mode, go] of states) {
  const app = await openApp({ mode, viewport: vp }); const page = app.page;
  await go(page);
  await page.addScriptTag({ content: AXE });
  const rows = await page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
    const v = r.violations[0]; if (!v) return [];
    return v.nodes.map((n) => { const d = n.any[0]?.data || {}; const el = document.querySelector(n.target[0]); return { t: n.target.join(" "), text: (el?.textContent || "").trim().slice(0, 30), fg: d.fgColor, bg: d.bgColor, ratio: d.contrastRatio, exp: d.expectedContrastRatio, size: d.fontSize, weight: d.fontWeight }; });
  });
  all[name] = rows;
  const groups = {};
  for (const r of rows) { const k = r.t.replace(/\[data-[^\]]+\]/g, "").replace(/:nth-child\(\d+\)/g, "").slice(0, 70); (groups[k] ||= []).push(r); }
  console.log(`\n## ${name} @${vp}: ${rows.length} nodes`);
  for (const [k, g] of Object.entries(groups)) { const m = g.reduce((a, b) => (a.ratio < b.ratio ? a : b)); console.log(`  ${g.length}x ${k} "${m.text}" ${m.fg} on ${m.bg} = ${m.ratio}:1 (need ${m.exp}) ${m.size} ${m.weight}`); }
  await app.close();
}
writeFileSync(`/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/ux01/access-responsive/contrast-${vp}.json`, JSON.stringify(all, null, 1));
