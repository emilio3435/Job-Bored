import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
for (const vp of ["desktop", "phone"]) {
  const app = await openApp({ mode: "signed-in", viewport: vp, path: "/?jb-v2=0" });
  const { page } = app;
  const y = await page.evaluate(() => { const e = document.getElementById("ingestUrlInput"); const b = e.getBoundingClientRect(); return [Math.round(b.top + scrollY), !!e.offsetParent, document.body.className]; });
  console.log(vp, "legacy ingest input y/visible/body", JSON.stringify(y));
  await page.evaluate(() => document.getElementById("ingestUrlInput").scrollIntoView({ block: "center" }));
  await shoot(page, "find", "legacy-ingest-hero");
  await app.close();
}
