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

async function openDesk(page, viewport, motion) {
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
      { runId: "run-00", createdAt: hoursAgo(72), source: "draft", label: "Drafted", model: MODEL },
      { runId: "run-01", createdAt: hoursAgo(26), source: "edit", prompt: "Shorter summary", model: MODEL },
    ],
  });
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
  await page.locator('[data-region="role"] .brief-materials [data-doc="resume"]').getByRole("button", { name: "Edit" }).click();
  const desk = page.getByRole("dialog", { name: "Scribe" });
  await expect(desk).toBeVisible();
  await page.waitForFunction(() => {
    const sheet = document.querySelector("jb-scribe .scribe__sheet");
    return sheet && sheet.getAnimations().every((a) => a.playState !== "running") && getComputedStyle(sheet).opacity === "1";
  });
  await expect(page.frameLocator("jb-scribe .scribe__docscroll iframe").locator(`[data-family="${FAMILY}"]`)).toHaveCount(1);
  await expect(desk.getByRole("region", { name: /^Resume, version 1/ })).toHaveAttribute("aria-busy", "false");
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
  await expect(desk.getByRole("log", { name: "Conversation with Scribe" })).toContainText("3 changes are ready");
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
  await expect(rail.locator('.scribe__mm[data-op="o2"]')).toContainText("Unverified: please confirm. Northwind");
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
