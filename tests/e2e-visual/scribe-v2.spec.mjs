/* global document, getComputedStyle, matchMedia -- evaluated in the browser page */
/**
 * EDITOR Q1: the look of the Scribe v2 desk (SPEC §1, §4, §8 e2e-visual).
 *
 *   - 1440: the open sheet, and a landed proposal with its marks and rail;
 *   - 390: full screen, one segment at a time (Doc, Chat, Versions);
 *   - no sideways scroll anywhere;
 *   - both reduced-motion states: the sheet slides and fades by default, and
 *     only fades under `prefers-reduced-motion: reduce` (asserted on
 *     matchMedia and the computed transition, per the page.emulateMedia rule);
 *   - the primary button's text meets 4.5:1 on its fill.
 *
 * Structure first, then a screenshot against this platform's baseline. As in
 * leads.spec.mjs, a platform with no baseline skips only the pixel compare,
 * and the config's updateSnapshots "none" means a normal run never writes one.
 *
 * Hermetic: the fence plus the harness's installScribeEditApi (real renders,
 * scripted SSE through a loopback relay). No model call, no live port.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import {
  DISPOSABLE_AUTH,
  HERMETIC_APPLICATION_SLUG,
  REPO_ROOT,
  installHermeticNetworkFence,
  installScribeEditApi,
  stageSignedInDisposableAuth,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import { renderDocument, retargetModel } from "../../server/materials-render.mjs";
import { resolveFamily } from "../../server/materials-templates.mjs";
import { applyOps, deriveNodes } from "../../server/materials-nodes.mjs";

const FAMILY = "dossier";
const MODEL = retargetModel(
  JSON.parse(readFileSync(join(REPO_ROOT, "docs/programs/editor-20260927/fixtures/model.json"), "utf8")),
  resolveFamily(FAMILY),
);

const PROPOSAL = [
  { opId: "o1", op: "replace", node: "b:acme:c14", text: "Measured carrier delays and reduced them through a weekly operations dashboard.", rationale: "Lead with the outcome", flags: [], facts: [] },
  { opId: "o2", op: "insert", after: "b:acme:c14", claimId: "c22", text: "Built a daily exception review with the Northwind carrier team.", rationale: "New proof point", flags: ["unverified"], facts: ["Northwind"] },
  { opId: "o3", op: "replace", node: "line:beta", text: "Tracked daily shipments and cleared exceptions within one shift.", rationale: "Show the pace", flags: [], facts: [] },
];

function manifest() {
  const at = "2026-09-27T15:00:00.000Z";
  const doc = (type, label, stem) => ({
    type,
    label,
    status: "ready",
    primary: `${stem}.pdf`,
    lastModifiedAt: at,
    files: [
      { filename: `${stem}.pdf`, format: "pdf", size: 120000, modifiedAt: at },
      { filename: `${stem}.html`, format: "html", size: 40000, modifiedAt: at },
    ],
  });
  return {
    slug: HERMETIC_APPLICATION_SLUG,
    company: "Acme",
    title: "Platform Engineer",
    derived: false,
    updatedAt: at,
    template: { family: FAMILY, source: "draft" },
    documents: [doc("resume", "Tailored Resume", "resume"), doc("cover_letter", "Cover Letter", "cover-letter")],
  };
}

let app = null;
let api = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterEach(async () => {
  await api?.close();
  api = null;
});

test.afterAll(async () => {
  if (app) await app.close();
});

async function openDesk(page, viewport, motion, doc = "resume", openProposal = null) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize(viewport);
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl, pipelineStartsWithJob: true });
  const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  api = await installScribeEditApi(page, {
    slug: HERMETIC_APPLICATION_SLUG,
    render: renderDocument,
    applyOps,
    nodesOf: deriveNodes,
    manifest,
    runs: [
      { runId: "run-00", createdAt: "2026-09-25T15:00:00.000Z", source: "draft", label: "Drafted", model: MODEL },
      { runId: "run-01", createdAt: hoursAgo(26), source: "edit", prompt: "Shorter summary", model: MODEL },
    ],
  });
  if (openProposal) await page.route(`${DISPOSABLE_AUTH.materialsOrigin}/api/applications/${HERMETIC_APPLICATION_SLUG}/edits/open`, route => route.fulfill({
    status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ proposal: openProposal }),
  }));
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.emulateMedia({ reducedMotion: motion });
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(motion === "reduce");
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: /Pipeline/ }).click();
  const expand = page.getByRole("region", { name: "Discovered column" }).getByRole("button", { name: "Expand Discovered" });
  if (await expand.count()) await expand.click();
  await page.locator(".pipe-sticker", { hasText: "Platform Engineer" }).click();
  await page.locator(`[data-region="role"] .brief-materials [data-doc="${doc}"]`).getByRole("button", { name: "Edit" }).click();
  const desk = page.getByRole("dialog", { name: "Scribe" });
  await expect(desk).toBeVisible();
  await page.waitForFunction(() => {
    const sheet = document.querySelector("jb-scribe .scribe__sheet");
    return sheet && sheet.getAnimations().every((a) => a.playState !== "running") && getComputedStyle(sheet).opacity === "1";
  });
  await expect(page.frameLocator("jb-scribe .scribe__docscroll iframe").locator(`[data-family="${FAMILY}"]`)).toHaveCount(1);
  const version = openProposal?.doc === doc && openProposal.status !== "accepting" && openProposal.baseRunId === "run-00" ? 0 : 1;
  await expect(desk.getByRole("region", { name: new RegExp(`^${doc === "resume" ? "Resume" : "Cover letter"}, version ${version}`) })).toHaveAttribute("aria-busy", "false");
  return { desk, errors, fence };
}

/** Send one request and play a whole proposal through the stream. */
async function landProposal(page, desk) {
  const composer = desk.getByRole("textbox", { name: "Ask Scribe for a change" });
  await composer.fill("Make the bullets punchier");
  await composer.press("Enter");
  await expect.poll(() => api.proposals.length).toBe(1);
  const id = api.proposals[0].id;
  await api.streamOpened(id);
  api.emit(id, "stage", { stage: "drafting" });
  for (const op of PROPOSAL) api.emit(id, "op", { op });
  api.emit(id, "blocked", { op: { opId: "o4", op: "replace", node: "stmt", text: "Cut delays by half." }, reason: "locked", detail: "38%" });
  api.emit(id, "proposal", { summary: { changes: 3, removals: 0, wordsDelta: 12, lossPct: 3, pages: 1, unverified: 1 } });
  api.emit(id, "done", { status: "ready" });
  api.end(id);
  await expect(desk.getByRole("log", { name: "Conversation with Scribe" })).toContainText("3 suggested changes");
  await expect(page.frameLocator("jb-scribe .scribe__docscroll iframe").locator("[data-scribe-id]")).toHaveCount(3);
}

async function expectNoSidewaysScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no horizontal page scroll").toBeLessThanOrEqual(0);
}

/**
 * Compare with this platform's baseline. With no baseline the pixel compare
 * is skipped. The config sets updateSnapshots "none", so a normal run never
 * writes; recording a new baseline takes an explicit --update-snapshots flag.
 */
async function compareScreenshot(page, name) {
  const info = test.info();
  const baseline = info.snapshotPath(name, { kind: "screenshot" });
  const recording = info.config.updateSnapshots !== "none";
  if (!existsSync(baseline) && !recording) {
    info.annotations.push({ type: "skip-pixels", description: `no ${name} baseline for ${process.platform}; structural checks only` });
    return;
  }
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name, { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.01 });
}

function expectHermetic({ errors, fence }) {
  expect(errors).toEqual([]);
  expect(fence.unexpectedExternal).toEqual([]);
  expect(app.hostRequests).toEqual([]);
}

for (const motion of ["reduce", "no-preference"]) {
  test(`the sheet at 1440, reduced motion ${motion}`, async ({ page }) => {
    const booted = await openDesk(page, { width: 1440, height: 900 }, motion);
    const { desk } = booted;
    const sheet = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector("jb-scribe .scribe__sheet"));
      return { transition: cs.transitionProperty, transform: cs.transform };
    });
    if (motion === "reduce") {
      expect(sheet.transition, "the sheet only fades").toBe("opacity");
    } else {
      expect(sheet.transition, "the sheet slides as it fades").toContain("transform");
    }
    expect(sheet.transform).toBe("none");
    const docBox = await desk.locator(".scribe__docpane").boundingBox();
    const sideBox = await desk.locator(".scribe__side").boundingBox();
    expect(docBox.x + docBox.width, "document left, side column right").toBeLessThanOrEqual(sideBox.x + 1);
    await expect(desk.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    await expectNoSidewaysScroll(page);
    if (motion === "reduce") await compareScreenshot(page, "scribe-v2-sheet-1440.png");
    expectHermetic(booted);
  });
}

test("a landed proposal at 1440: marks, rail, and a readable primary button", async ({ page }) => {
  const booted = await openDesk(page, { width: 1440, height: 900 }, "reduce");
  const { desk } = booted;
  await landProposal(page, desk);
  const rail = desk.locator(".scribe__rail");
  await expect(rail.locator(".scribe__mm")).toHaveCount(3);
  await expect(rail.locator('.scribe__mm[data-op="o2"]')).toContainText("Not in your saved facts — confirm before accepting. Northwind");
  const primary = desk.getByRole("button", { name: "Accept all verified" });
  await expect(primary).toHaveClass(/scribe__btn--primary/);
  const contrast = await primary.evaluate((el) => {
    const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const c = [r, g, b].map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const cs = getComputedStyle(el);
    const [fg, bg] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))];
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  expect(contrast, "primary button text on its fill (WCAG AA)").toBeGreaterThanOrEqual(4.5);
  await expectNoSidewaysScroll(page);
  await compareScreenshot(page, "scribe-v2-proposal-1440.png");
  expectHermetic(booted);
});

test("full screen at 390, one segment at a time", async ({ page }) => {
  const booted = await openDesk(page, { width: 390, height: 844 }, "reduce");
  const { desk } = booted;
  const sheetBox = await desk.boundingBox();
  expect(Math.round(sheetBox.width), "the sheet is full width").toBe(390);
  const view = desk.getByRole("tablist", { name: "View" });
  const panes = {
    Doc: desk.locator(".scribe__docpane"),
    Chat: desk.getByRole("textbox", { name: "Ask Scribe for a change" }),
    Versions: desk.getByRole("list", { name: "Resume versions, newest first" }),
  };
  for (const segment of ["Doc", "Chat", "Versions"]) {
    await view.getByRole("tab", { name: segment }).click();
    await expect(view.getByRole("tab", { name: segment })).toHaveAttribute("aria-selected", "true");
    for (const [name, pane] of Object.entries(panes)) {
      if (name === segment) await expect(pane).toBeVisible();
      else await expect(pane).toBeHidden();
    }
    await expectNoSidewaysScroll(page);
    await compareScreenshot(page, `scribe-v2-390-${segment.toLowerCase()}.png`);
  }
  expectHermetic(booted);
});


/* SCRP: injected presentation states use the real FE mount points. These
 * checks prove styling only; recovery/manual behavior belongs to FE's floor.
 * No new pixel baselines are recorded until the host's FE-COPY signal. */
async function injectPresentation(page, kind, state = "idle") {
  await page.evaluate(({ kind, state }) => {
    const host = document.querySelector("jb-scribe.scribe");
    const button = (text, primary = false) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `scribe__btn scribe__btn--small${primary ? " scribe__btn--primary" : ""}`;
      el.textContent = text;
      return el;
    };
    if (kind === "recover") {
      const el = host.querySelector(".scribe__recover");
      el.hidden = false;
      el.dataset.recoverDoc = host.dataset.doc;
      el.replaceChildren();
      const text = document.createElement("p");
      text.textContent = "You have 2 suggested changes from an earlier request.";
      const review = button("Review", true); review.dataset.action = "review-request";
      const discard = button("Discard"); discard.dataset.action = "discard-request";
      el.append(text, review, discard);
    } else if (kind === "status") {
      const messages = {
        idle: "Ask for a change.", sending: "Sending…", stopping: "Stopping…", ready: "2 suggested changes",
        saving: "Saving…", saved: "Saved as v2", recovered: "Review the earlier suggested changes.",
        "saved-pdf-unavailable": "Text saved as v2. PDF unavailable — it’s rebuilt on your next save.",
        stale: "Not saved — a newer version exists.", error: "Not saved. Your accepted changes are still here.",
      };
      const el = host.querySelector(".scribe__status");
      el.hidden = false; el.dataset.state = state;
      const text = document.createElement("span"); text.textContent = messages[state];
      el.replaceChildren(text);
      if (["stale", "error"].includes(state)) {
        const action = button(state === "stale" ? "Review current" : "Try again");
        action.classList.add("scribe__status-action"); el.append(action);
      }
    } else if (kind === "selection") {
      const scope = host.querySelector(".scribe__scope");
      scope.querySelector(".scribe__pill").textContent = "Selected: Introduction and supporting operations experience";
      const clear = scope.querySelector('[data-action="clear-scope"]'); clear.hidden = false;
      // FE-2 owns these two anchors; the injected shape matches SPEC §4.
      let toolbar = host.querySelector(".scribe__selection-actions");
      if (!toolbar) {
        toolbar = document.createElement("div"); toolbar.className = "scribe__selection-actions";
        toolbar.role = "toolbar"; toolbar.setAttribute("aria-label", "Selected text actions");
        host.querySelector(".scribe__docscroll").append(toolbar);
      }
      toolbar.hidden = false; toolbar.style.left = "8px"; toolbar.style.top = "8px";
      toolbar.replaceChildren(...["Rewrite", "Shorten", "Emphasize", "Ask…", "Edit text"].map(text => button(text)));
    } else if (kind === "manual") {
      let el = host.querySelector(".scribe__manual-state");
      if (!el) {
        el = document.createElement("span"); el.className = "scribe__manual-state";
        host.querySelector(".scribe__stage").append(el);
      }
      el.hidden = false; el.dataset.state = state;
      const messages = {
        editing: "Editing Introduction. Saves when you leave the block.", saving: "Saving…", saved: "Saved as v2",
        error: "Not saved. Your text is kept.", conflict: "A newer version exists. Your text is kept.",
        confirm: "“Northwind” isn’t in your saved facts.",
      };
      const text = document.createElement("span"); text.textContent = messages[state]; el.replaceChildren(text);
      if (state === "error") el.append(button("Try again"));
      if (state === "conflict") el.append(button("Review current"), button("Reapply"));
      if (state === "confirm") el.append(button("Save anyway"), button("Edit"));
    } else if (kind === "unsaved") {
      const el = host.querySelector(".scribe__unsaved"); el.hidden = false;
      const text = document.createElement("p"); text.textContent = "You have unsaved text.";
      el.replaceChildren(text, button("Save", true), button("Discard"), button("Stay"));
    }
  }, { kind, state });
}

async function expectPresentation(page, locator, mobile) {
  await expect(locator).toBeVisible();
  await expectNoSidewaysScroll(page);
  const box = await locator.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual((await page.viewportSize()).width);
  const overflow = await locator.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow, "the anchor contains its long text and actions").toBeLessThanOrEqual(1);
  if (mobile) {
    for (const button of await locator.locator("button").all()) {
      if (!await button.isVisible()) continue;
      const box = await button.boundingBox();
      expect(box.height, "44px mobile action height").toBeGreaterThanOrEqual(44);
      expect(box.width, "44px mobile action width").toBeGreaterThanOrEqual(44);
    }
  }
  const contrastFailures = await locator.evaluate(root => {
    const rgba = value => (value.match(/[\d.]+/g) || []).map(Number);
    const composite = (front, back) => {
      const alpha = front.length < 4 ? 1 : front[3];
      return front.slice(0, 3).map((v, i) => v * alpha + back[i] * (1 - alpha));
    };
    const background = el => {
      const chain = []; for (let node = el; node; node = node.parentElement) chain.unshift(node);
      return chain.reduce((bg, node) => composite(rgba(getComputedStyle(node).backgroundColor), bg), [255, 255, 255]);
    };
    const luminance = rgb => rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
    return [root, ...root.querySelectorAll("p, span, button")].filter(el => el.getClientRects().length && el.textContent.trim() && !el.matches('[aria-disabled="true"], :disabled')).flatMap(el => {
      const bg = background(el); const foreground = composite(rgba(getComputedStyle(el).color), bg);
      const a = luminance(bg), b = luminance(foreground); const ratio = (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05);
      return ratio < 4.5 ? [{ text: el.textContent, ratio }] : [];
    });
  });
  expect(contrastFailures, "anchor text meets WCAG AA contrast").toEqual([]);
  const focusable = locator.locator("button:visible").first();
  if (await focusable.count()) {
    await page.keyboard.press("Tab");
    await focusable.focus();
    const ring = await focusable.evaluate(el => {
      const cs = getComputedStyle(el);
      return el.matches(":focus-visible") && (cs.boxShadow !== "none" || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2));
    });
    expect(ring, "keyboard focus has a visible ring").toBe(true);
  }
}

for (const doc of ["resume", "cover_letter"]) for (const width of [1440, 375]) {
  const mobile = width === 375;
  const viewport = { width, height: mobile ? 667 : 1000 };
  test(`SCRP-U1 ${doc} ${width}: recovery and every status outcome`, async ({ page }) => {
    const booted = await openDesk(page, viewport, "reduce", doc);
    if (mobile) await booted.desk.getByRole("tab", { name: "Chat", exact: true }).click();
    await injectPresentation(page, "recover");
    const recover = booted.desk.locator(".scribe__recover");
    await expectPresentation(page, recover, mobile);
    await expect(recover).toHaveCSS("border-left-width", "3px");
    await recover.evaluate(el => { el.hidden = true; });
    const heights = [];
    for (const state of ["idle", "sending", "stopping", "ready", "saving", "saved", "saved-pdf-unavailable", "stale", "error", "recovered"]) {
      await injectPresentation(page, "status", state);
      const status = booted.desk.locator(".scribe__status");
      await expectPresentation(page, status, mobile);
      expect((await status.boundingBox()).height, "status space is reserved").toBeGreaterThanOrEqual(64);
      if (["idle", "sending", "stopping", "ready", "saving", "saved"].includes(state)) heights.push((await status.boundingBox()).height);
      if (state === "saved-pdf-unavailable") await expect(status.locator("button")).toHaveCount(0);
    }
    expect(Math.max(...heights) - Math.min(...heights), "short status outcomes keep the composer stable").toBeLessThanOrEqual(1);
    expectHermetic(booted);
  });

  test(`SCRP-U2 ${doc} ${width}: selection, manual outcomes and unsaved prompt`, async ({ page }) => {
    const booted = await openDesk(page, viewport, "reduce", doc);
    await injectPresentation(page, "selection");
    if (mobile) await booted.desk.getByRole("tab", { name: "Chat", exact: true }).click();
    await expectPresentation(page, booted.desk.locator(".scribe__scope"), mobile);
    if (mobile) await booted.desk.getByRole("tab", { name: "Doc", exact: true }).click();
    const toolbar = booted.desk.locator(".scribe__selection-actions");
    await expectPresentation(page, toolbar, mobile);
    await expect(toolbar).toHaveCSS("position", "absolute");
    for (const state of ["editing", "saving", "saved", "error", "conflict", "confirm"]) {
      await injectPresentation(page, "manual", state);
      await expectPresentation(page, booted.desk.locator(".scribe__manual-state"), mobile);
    }
    await injectPresentation(page, "unsaved");
    const prompt = booted.desk.getByRole("alertdialog", { name: "Unsaved text" });
    await expectPresentation(page, prompt, mobile);
    await expect(prompt).toHaveCSS("position", "absolute");
    expectHermetic(booted);
  });
}

test("SCRP-U3 composer: 44px phone field and keyboard focus ring", async ({ page }) => {
  const booted = await openDesk(page, { width: 375, height: 667 }, "reduce");
  await booted.desk.getByRole("tab", { name: "Chat", exact: true }).click();
  const field = booted.desk.getByRole("textbox", { name: "Ask Scribe for a change" });
  expect((await field.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Tab"); await field.focus();
  const ring = await field.evaluate(el => {
    const cs = getComputedStyle(el);
    return el.matches(":focus-visible") && (cs.boxShadow !== "none" || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2));
  });
  expect(ring, "the composer field has its own keyboard focus ring").toBe(true);
  await expectNoSidewaysScroll(page);
  expectHermetic(booted);
});


/* FE-1 now renders these rows through GET open and its own recovery code,
 * rather than the earlier presentation injection. */
for (const doc of ["resume", "cover_letter"]) for (const width of [1440, 375]) {
  test(`SCRP-U4 ${doc} ${width}: live recovery rows and recovered status`, async ({ page }) => {
    const proposal = {
      proposalId: "ux-recovered-request", doc, baseRunId: "run-00", instruction: "Clarify the wording",
      scope: "all", lockFacts: true, status: "ready", createdAt: "2026-10-03T07:00:00.000Z",
      ops: doc === "resume" ? PROPOSAL.slice(0, 1) : [{ opId: "letter-1", op: "replace", node: "p:p1", text: "I turn operations data into clear daily decisions that teams can act on.", rationale: "Lead with the outcome", flags: [], facts: [] }],
      blocked: [], summary: { changes: 1, removals: 0, wordsDelta: 2, lossPct: 0, pages: 1, unverified: 0 },
    };
    const booted = await openDesk(page, { width, height: width === 375 ? 667 : 1000 }, "reduce", doc, proposal);
    const { desk } = booted;
    if (width === 375) await desk.getByRole("tab", { name: "Chat", exact: true }).click();
    const recovery = desk.locator(".scribe__recover");
    await expect(recovery).toContainText("These changes were suggested for v0; v1 is now current.");
    await expectPresentation(page, recovery, width === 375);
    const row = recovery.locator("[data-recover-doc]");
    const text = await row.locator("span").boundingBox();
    const review = await row.getByRole("button", { name: "Review", exact: true }).boundingBox();
    const current = await row.getByRole("button", { name: "Review current", exact: true }).boundingBox();
    expect(review.y, "live recovery actions sit below the message").toBeGreaterThanOrEqual(text.y + text.height);
    expect(current.x - (review.x + review.width), "live recovery actions have an 8px gap").toBeGreaterThanOrEqual(8);
    const status = desk.locator('.scribe__status[data-state="recovered"]');
    await expect(status).toContainText("Your earlier accept/reject choices weren’t kept. Review again.");
    await expectPresentation(page, status, width === 375);
    expectHermetic(booted);
  });
}
