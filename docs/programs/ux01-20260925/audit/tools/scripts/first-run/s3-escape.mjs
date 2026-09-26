// UX01 first-run: what a signed-in user with a sheet sees after closing the flow; spine clickability.
// Deliberately never clicks Save & verify (B5), templates (B3), or Looks like me (B4): the in-process
// dev-server proxies /__proxy/discovery-env-key and /profile/* to the host machine.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "first-run";
const log = (...a) => console.log(...a);
for (const viewport of ["desktop", "phone"]) {
  const app = await openApp({ mode: "signed-in-empty", viewport, setupDone: false });
  const { page } = app;
  log(`\n=== ${viewport} ===`);
  const spine = await page.evaluate(() => [...document.querySelectorAll("#oneFlowMount [data-beat-id]")].map((e) => `${e.tagName}:${e.dataset.beatId}:${e.querySelector("button,a") ? "clickable" : "static"}`));
  log("spine:", JSON.stringify(spine));
  // Esc from beat 1 with a sheet configured
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  await shoot(page, L, "signedin-empty-after-escape");
  const after = await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); if (!e) return "absent"; const r = e.getBoundingClientRect(); return `${getComputedStyle(e).display}/${Math.round(r.width)}x${Math.round(r.height)}`; };
    const add = [...document.querySelectorAll("button")].filter((b) => /add job/i.test(b.innerText));
    return {
      demo: !!document.getElementById("oneFlowDemoBoard"),
      pill: !!document.getElementById("oneFlowResumePill"),
      gate: vis("sheetAccessGateScreen"),
      addJob: add.map((b) => { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { vis: r.width > 0, onTop: !!top && (b === top || b.contains(top)) }; }),
      bodyText: document.body.innerText.slice(0, 300).replace(/\s+/g, " "),
    };
  });
  log("after escape:", JSON.stringify(after, null, 1));
  // Try Add job from URL if reachable
  const add = page.getByRole("button", { name: /Add job from URL/i }).first();
  if (await add.isVisible().catch(() => false)) {
    await add.click({ timeout: 3000 }).catch((e) => log("add click fail", e.message.split("\n")[0]));
    await page.waitForTimeout(800);
    await shoot(page, L, "signedin-empty-addjob-open");
    log("add-job dialog text:", (await page.evaluate(() => { const d = [...document.querySelectorAll("dialog[open], [role=dialog]")].find((x) => x.getBoundingClientRect().width > 0); return d ? d.innerText.slice(0, 800) : "none"; })));
  }
  await app.close();
}
