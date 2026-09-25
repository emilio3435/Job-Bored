// UX01 first-run: signed-in, setup not done -> beats 2..6 at both viewports.
import { openApp, shoot, runAxe } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "first-run";
const log = (...a) => console.log(...a);
const txt = (page, sel = "#oneFlowMount") => page.evaluate((s) => document.querySelector(s)?.innerText || "(none)", sel);
const msgs = (page) => page.evaluate(() => [...document.querySelectorAll("#oneFlowMount [class*='message'], [class*='toast']")].map((e) => e.innerText.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 8));

for (const viewport of ["desktop", "phone"]) {
  const app = await openApp({ mode: "signed-in", viewport, setupDone: false });
  const { page } = app;
  log(`\n=== ${viewport} ===`);
  const boot = await page.evaluate(() => ({
    demo: !!document.getElementById("oneFlowDemoBoard"),
    flowOpen: !!window.JobBoredOneFlow?.isOpen?.(),
    state: window.JobBoredOneFlow?.getState?.(),
    gate: document.getElementById("sheetAccessGateScreen")?.dataset.gateMode,
  }));
  log("boot:", JSON.stringify(boot));
  await shoot(page, L, "signedin-notdone-boot");
  log("boot text:", (await txt(page)).slice(0, 400));

  const beats = viewport === "desktop" ? ["google", "ai", "resume", "fit", "discovery", "payoff"] : ["google", "ai", "resume", "fit", "discovery", "payoff"];
  for (const id of beats) {
    await page.evaluate((b) => window.JobBoredOneFlow.goToBeat(b), id);
    await page.waitForTimeout(900);
    await shoot(page, L, `b-${id}-default`);
    await shoot(page, L, `b-${id}-default-full`, { fullPage: true });
    const t = await txt(page);
    log(`--- beat ${id} text ---\n${t.slice(0, 2200)}`);
    const overflow = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const bad = [...document.querySelectorAll("#oneFlowMount *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > w + 1 || r.left < -1); }).slice(0, 5).map((e) => `${e.tagName}.${String(e.className).slice(0, 50)} r=${Math.round(e.getBoundingClientRect().right)}`);
      return { w, scrollW: document.documentElement.scrollWidth, bad };
    });
    log("overflow:", JSON.stringify(overflow));
    if (viewport === "desktop") {
      try { const v = await runAxe(page, { include: "#oneFlowMount" }); log("axe:", JSON.stringify(v.map((x) => `${x.id}:${x.impact}:${x.nodes}`))); } catch (e) { log("axe err", e.message); }
    }
  }

  // Beat 2 interaction: check with empty key, then with a fake key (fenced)
  await page.evaluate(() => window.JobBoredOneFlow.goToBeat("ai"));
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Check & continue" }).click();
  await page.waitForTimeout(500);
  log("B2 empty key msgs:", JSON.stringify(await msgs(page)));
  await page.locator("#oneFlowAiKeyInput").fill("sk-or-v1-fake-audit-key");
  const t2 = Date.now();
  await page.getByRole("button", { name: "Check & continue" }).click();
  await page.waitForTimeout(4000);
  await shoot(page, L, "b-ai-checking");
  log("B2 fake key after 4s:", JSON.stringify(await msgs(page)), "stages:", JSON.stringify(await page.evaluate(() => window.JobBoredOneFlowBeatAi?.getRenderedStages?.())));
  await page.waitForTimeout(13000);
  await shoot(page, L, "b-ai-after-check");
  log("B2 fake key after 17s:", JSON.stringify(await msgs(page)), "open beat:", await page.evaluate(() => document.querySelector(".oneflow-beat")?.dataset.beatId));

  // Beat 3: paste text + draft
  await page.evaluate(() => window.JobBoredOneFlow.goToBeat("resume"));
  await page.waitForTimeout(600);
  await page.locator("#oneFlowResumePaste").fill("Jane Doe\nSenior Frontend Engineer\n8 years React, TypeScript, design systems.\nLed accessibility program at Example Co.");
  // Esc + reload test for drafts
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await shoot(page, L, "b-resume-after-escape");
  log("after esc: resume pill?", await page.locator("#oneFlowResumePill").count(), "msgs", JSON.stringify(await msgs(page)));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const afterReload = await page.evaluate(() => ({ open: window.JobBoredOneFlow?.isOpen?.(), beat: document.querySelector(".oneflow-beat")?.dataset.beatId, pill: !!document.getElementById("oneFlowResumePill"), paste: document.getElementById("oneFlowResumePaste")?.value?.slice(0, 30) }));
  log("after reload:", JSON.stringify(afterReload));
  await shoot(page, L, "b-resume-after-reload");
  if (!afterReload.open) {
    await page.evaluate(() => window.JobBoredOneFlow.open());
    await page.waitForTimeout(800);
    log("after re-open:", JSON.stringify(await page.evaluate(() => ({ beat: document.querySelector(".oneflow-beat")?.dataset.beatId, paste: document.getElementById("oneFlowResumePaste")?.value?.slice(0, 30) }))));
  }
  const draftBtn = page.getByRole("button", { name: /Draft from this text|Draft|Continue/ }).first();
  const labels = await page.evaluate(() => [...document.querySelectorAll("#oneFlowMount button")].map((b) => b.innerText.trim()).filter(Boolean));
  log("B3 buttons:", JSON.stringify(labels));
  if (await page.getByRole("button", { name: "Draft from this text" }).count()) {
    await page.getByRole("button", { name: "Draft from this text" }).click();
    await page.waitForTimeout(5000);
    await shoot(page, L, "b-resume-draft-result");
    log("B3 draft result:", JSON.stringify(await msgs(page)), "beat:", await page.evaluate(() => document.querySelector(".oneflow-beat")?.dataset.beatId));
  }
  await app.close();
}
