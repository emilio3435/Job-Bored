// UX01 first-run: shortest path to a tracked row once a sheet exists (close flow -> Add job from URL).
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "first-run"; const log = (...a) => console.log(...a);
const app = await openApp({ mode: "signed-in-empty", viewport: "desktop", setupDone: false });
const { page } = app;
const writes = [];
page.on("request", (r) => { if (r.method() !== "GET" && r.method() !== "OPTIONS") writes.push(`${r.method()} ${r.url().slice(0, 120)}`); });
await page.keyboard.press("Escape"); await page.waitForTimeout(1000);
const add = page.getByRole("button", { name: /Add a job opportunity/i }).first();
await add.scrollIntoViewIfNeeded(); await add.click(); await page.waitForTimeout(500);
await shoot(page, L, "addjob-modal");
await page.locator("#pipeUrlModalInput").fill("https://boards.greenhouse.io/example/jobs/123");
await page.getByRole("button", { name: "Add to Pipeline" }).click();
await page.waitForTimeout(3000);
await shoot(page, L, "addjob-after-submit");
log("modal text:", await page.evaluate(() => document.querySelector("[data-pipeline-url-modal]")?.innerText.replace(/\s+/g, " ").slice(0, 600)));
log("other dialogs:", await page.evaluate(() => [...document.querySelectorAll("[role=dialog]:not([hidden]), dialog[open]")].filter((d) => d.getBoundingClientRect().width > 0).map((d) => d.innerText.replace(/\s+/g, " ").slice(0, 400))));
log("writes:", JSON.stringify(writes));
await app.close();
