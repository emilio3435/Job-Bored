// Dawn (the visible Daily Brief): capture region + its numbers.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
for (const mode of ["signed-in", "signed-in-empty"]) {
  const app = await openApp({ mode, viewport: "desktop" });
  const { page } = app;
  await shoot(page, "track", `dawn-${mode}`, { locator: '[data-region="dawn"]' });
  if (mode === "signed-in-empty") await shoot(page, "track", `today-${mode}`, { locator: '[data-region="today"]' });
  console.log(mode, (await page.locator('[data-region="dawn"]').innerText()).replace(/\s+/g, " "));
  console.log(mode, "TODAY:", (await page.locator('[data-region="today"]').innerText()).replace(/\s+/g, " "));
  await app.close();
}
