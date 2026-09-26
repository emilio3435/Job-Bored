import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "modern-patterns";
const vp = process.argv[2] || "desktop";
const log = (...a) => console.log(vp, ...a);
{
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const p = app.page;
  await p.getByRole("button", { name: "Open dossier" }).first().click();
  await p.waitForTimeout(1200);
  const applied = p.locator('.role-case [data-stage="applied"], [data-region="role"] button:has-text("Applied")').first();
  log("applied btn count", await applied.count());
  if (await applied.count()) { await applied.click(); await p.waitForTimeout(800); }
  await shoot(p, L, "apply-mark-submitted");
  log("dialog:", await p.evaluate(() => [...document.querySelectorAll('[role=dialog],[role=alertdialog],dialog')].filter(d => d.offsetParent || d.open).map(d => d.innerText.replace(/\s+/g, " ").slice(0, 600))));
  await app.close();
}
{
  const app = await openApp({ mode: "signed-in-empty", viewport: vp });
  const p = app.page;
  await shoot(p, L, "empty-today");
  log("empty today:", await p.evaluate(() => document.querySelector('[data-region="today"]')?.innerText.replace(/\s+/g, " ").slice(0, 500)));
  await p.locator('[data-region="pipeline"]').first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await shoot(p, L, "empty-pipeline");
  log("empty pipeline:", await p.evaluate(() => document.querySelector('[data-region="pipeline"]')?.innerText.replace(/\s+/g, " ").slice(0, 700)));
  await app.close();
}
