// Reads axe's contrast data for the Settings Save button.
import { readFileSync } from "node:fs";
import { H } from "./common.mjs";
const { openApp } = await import(H);
const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const { page } = app;
await page.locator("#settingsBtn").click(); await page.waitForTimeout(800);
await page.addScriptTag({ content: readFileSync(process.env.UX01_AXE_PATH || "/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/axe/node_modules/axe-core/axe.min.js", "utf8") });
const r = await page.evaluate(async () => { const x = await axe.run({ include: [["#settingsModal"]] }, { runOnly: ["color-contrast"] }); return x.violations.flatMap(v => v.nodes.map(n => ({ t: n.target.join(" "), d: n.any[0]?.data }))); });
console.log(JSON.stringify(r, null, 1));
await app.close();
