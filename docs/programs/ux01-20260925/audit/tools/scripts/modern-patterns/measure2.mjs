import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "modern-patterns";
for (const vp of ["desktop", "phone"]) {
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const p = app.page;
  const y0 = await p.evaluate(() => scrollY);
  await p.keyboard.press("Meta+k");
  await p.waitForTimeout(700);
  const y1 = await p.evaluate(() => scrollY);
  console.log(vp, "cmdK scrollY", y0, "->", y1, "active:", await p.evaluate(() => document.activeElement.getAttribute("aria-label")));
  // palette-like results? count of list options
  console.log(vp, "listbox after cmdk:", await p.evaluate(() => document.querySelectorAll('[role=listbox],[role=option],[role=combobox]').length));
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.activeElement.blur());
  // expand Discovered
  const exp = p.getByRole("button", { name: "Expand Discovered" });
  if (await exp.count()) { await exp.click(); await p.waitForTimeout(600); }
  await p.locator('[data-region="pipeline"]').first().scrollIntoViewIfNeeded();
  await shoot(p, L, "triage-discovered", { locator: '[data-region="pipeline"]' });
  const card = p.locator('.pipe-sticker[data-stage="new"]').first();
  console.log(vp, "discovered cards", await p.locator('.pipe-sticker[data-stage="new"]').count());
  if (await card.count()) {
    await card.focus();
    const before = await card.getAttribute("data-stable-key");
    for (const k of ["j", "ArrowDown", "1", "e", "Meta+ArrowRight", "ArrowRight"]) {
      await p.keyboard.press(k); await p.waitForTimeout(250);
    }
    const stageNow = await p.evaluate((key) => document.querySelector(`.pipe-sticker[data-stable-key="${key}"]`)?.getAttribute("data-stage"), before);
    console.log(vp, "card", before, "stage after j/ArrowDown/1/e/Cmd+Right/Right:", stageNow, "dialogs:", await p.evaluate(() => [...document.querySelectorAll('[role=dialog]')].filter(d => d.offsetParent && !d.hidden).length));
    // count controls on a card
    console.log(vp, "card controls:", await card.evaluate(c => [...c.querySelectorAll("button,a")].map(b => b.getAttribute("aria-label") || b.innerText.trim()).join(" | ")));
  }
  await app.close();
}
