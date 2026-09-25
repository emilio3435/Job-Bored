import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
await page.waitForTimeout(300); await shoot(page, "access-responsive", "focus-run-discovery", { locator: ".page-top" });
for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
await page.waitForTimeout(300); await shoot(page, "access-responsive", "focus-settings-icon", { locator: ".page-top" });
await app.close();
