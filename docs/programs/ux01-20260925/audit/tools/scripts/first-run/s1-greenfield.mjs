// UX01 first-run: greenfield S0 + Beat 1 at both viewports.
import { openApp, shoot, runAxe } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";

const L = "first-run";
const log = (...a) => console.log(...a);

for (const viewport of ["desktop", "phone"]) {
  const t0 = Date.now();
  const app = await openApp({ mode: "greenfield", viewport });
  const { page } = app;
  const toasts = [];
  page.on("console", (m) => { if (/error|warn/i.test(m.type())) toasts.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
  log(`\n=== ${viewport} === boot+settle ms`, Date.now() - t0);
  const demo = await page.locator("#oneFlowDemoBoard").count();
  const gate = await page.evaluate(() => { const g = document.getElementById("sheetAccessGateScreen"); return g ? { hidden: g.hidden, display: getComputedStyle(g).display, mode: g.dataset.gateMode } : null; });
  log("demo board mounted:", demo, "gate:", JSON.stringify(gate));
  const cards = await page.locator(".oneflow-demo__card").count();
  log("demo cards:", cards);
  await shoot(page, L, "s0-default");
  await shoot(page, L, "s0-default-full", { fullPage: true });
  // Is the invite in the first viewport?
  const inviteBox = await page.locator(".oneflow-demo__invite").boundingBox();
  log("invite box:", JSON.stringify(inviteBox));
  // Open a demo card detail
  await page.locator(".oneflow-demo__card").first().click();
  await page.waitForTimeout(300);
  await shoot(page, L, "s0-card-detail");
  await page.keyboard.press("Escape");
  // Poke around first
  await page.getByRole("button", { name: "Poke around first" }).click();
  await page.waitForTimeout(300);
  await shoot(page, L, "s0-poke-pill");
  // What is reachable under the overlay? dashboard add-job controls
  const reach = await page.evaluate(() => {
    const ids = ["addJobBtn", "quickAddBtn", "ingestUrlInput", "addJobUrlInput", "manualAddBtn"];
    const found = {};
    for (const sel of ["[data-action*='add']", "#addJobBtn", "button[aria-label*='Add' i]", "input[placeholder*='URL' i]"]) {
      const els = [...document.querySelectorAll(sel)];
      found[sel] = els.slice(0, 5).map((e) => {
        const r = e.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { id: e.id, text: (e.textContent || e.placeholder || "").trim().slice(0, 40), visible: r.width > 0 && r.height > 0, onTop: !!top && (top === e || e.contains(top)) };
      });
    }
    const board = document.getElementById("oneFlowDemoBoard");
    return { found, overlay: board ? getComputedStyle(board).position + " z" + getComputedStyle(board).zIndex + " inset:" + getComputedStyle(board).inset : null, bodyClasses: document.body.className.slice(0, 200) };
  });
  log("reachable under overlay:", JSON.stringify(reach, null, 1));
  // Reload keeps pill?
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  log("after reload: invite visible?", await page.locator(".oneflow-demo__invite").count(), "pill?", await page.locator(".oneflow-demo__pill").count());
  // Make it mine
  const tMine = Date.now();
  await page.getByRole("button", { name: /Make it mine/ }).click();
  await page.waitForSelector("#oneFlowMount .oneflow-beat, .oneflow-beat", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  log("beat1 open ms", Date.now() - tMine);
  await shoot(page, L, "b1-default");
  await shoot(page, L, "b1-default-full", { fullPage: true });
  const b1 = await page.evaluate(() => {
    const m = document.getElementById("oneFlowMount");
    return m ? m.innerText.slice(0, 1500) : "no mount";
  });
  log("B1 text:\n" + b1);
  // expand detour
  await page.locator(".oneflow-google__detour-summary").click();
  await page.waitForTimeout(300);
  await shoot(page, L, "b1-detour-open");
  await shoot(page, L, "b1-detour-open-full", { fullPage: true });
  // axe on the shell
  try {
    const v = await runAxe(page, { include: "#oneFlowMount" });
    log("axe B1:", JSON.stringify(v));
  } catch (e) { log("axe err", e.message); }
  // bad client id
  await page.locator("#oneFlowOauthClientIdInput").fill("abc");
  await page.getByRole("button", { name: "Save Client ID" }).click();
  await page.waitForTimeout(400);
  await shoot(page, L, "b1-clientid-invalid");
  log("detour open after invalid-save repaint?", await page.evaluate(() => document.querySelector(".oneflow-google__detour")?.open));
  // First: Continue with Google with NO client id (greenfield default)
  const tC = Date.now();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForTimeout(3000);
  await shoot(page, L, "b1-continue-no-clientid");
  log("no-clientid continue msgs:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("#oneFlowMount [class*='message'], #oneFlowMount [class*='stage'], [class*='toast']")].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 10))));
  log("continue button disabled?", await page.getByRole("button", { name: /Continue with Google|Waiting/ }).first().isDisabled().catch(()=>"n/a"));
  await page.evaluate(() => { const d = document.querySelector(".oneflow-google__detour"); if (d) d.open = true; });
  // valid-looking client id
  await page.locator("#oneFlowOauthClientIdInput").fill("123-abc.apps.googleusercontent.com");
  await page.getByRole("button", { name: "Save Client ID" }).click();
  await page.waitForTimeout(800);
  await shoot(page, L, "b1-clientid-saved");
  const msg1 = await page.evaluate(() => [...document.querySelectorAll("#oneFlowMount [class*='message'], .toast, [role=status], [role=alert]")].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 8));
  log("after save msgs:", JSON.stringify(msg1));
  // Continue with Google (hermetic GIS stub)
  await page.getByRole("button", { name: "Continue with Google" }).click({ timeout: 5000 }).catch((e) => log("continue click failed:", e.message.split("\n")[0]));
  await page.waitForTimeout(2500);
  await shoot(page, L, "b1-continue-waiting");
  const msg2 = await page.evaluate(() => [...document.querySelectorAll("#oneFlowMount [class*='message'], #oneFlowMount [class*='stage'], .toast, [role=status], [role=alert]")].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 10));
  log("after continue msgs:", JSON.stringify(msg2));
  // Escape
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await shoot(page, L, "b1-after-escape");
  log("after esc: mount children", await page.evaluate(() => document.getElementById("oneFlowMount")?.children.length), "invite", await page.locator(".oneflow-demo__invite").count(), "resume pill", await page.locator("#oneFlowResumePill").count());
  const toastsTxt = await page.evaluate(() => [...document.querySelectorAll(".toast, [class*='toast']")].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 5));
  log("toasts:", JSON.stringify(toastsTxt));
  // Reload mid-flow: resumes?
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  log("after reload mid-flow: invite", await page.locator(".oneflow-demo__invite").count(), "beat open", await page.locator(".oneflow-beat").count());
  await shoot(page, L, "b1-after-reload");
  log("console warnings/errors:", toasts.slice(0, 15).join("\n"));
  await app.close();
}
