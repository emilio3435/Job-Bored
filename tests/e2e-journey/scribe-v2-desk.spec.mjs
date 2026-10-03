/**
 * scribe-v2-desk.spec.mjs — EDITOR lane F1: the Scribe v2 desk shell.
 *
 * The journey a user takes to edit a drafted resume: sign in, open a role,
 * press Edit on the resume row, see that role's real template render in the
 * desk, ask for a change, look at the versions, close. Pinned here:
 *
 *   - R1: a signed-in user with no package has no Scribe in the DOM at all.
 *     The old region was forced `display:block !important` and painted an
 *     empty 100vh box under every dashboard.
 *   - Edit opens a modal desk bound to the role's package, and the iframe
 *     shows that package's render in its own template family (dossier
 *     here, not the default).
 *   - The composer takes a request and the stage line and chat report the
 *     stubbed stream honestly; the versions rail lists the stubbed history.
 *   - Close and Esc both return focus to the Edit button.
 *   - SPEC §4 at 1440 and 390: no sentence under 12px, 44px targets on a
 *     phone, no mint fill carrying ink-inverse text, no sideways scroll.
 *
 * The stub API is opt-in, so every journey here loads `?scribe-api=stub`,
 * except the one that proves the desk calls the live routes by default.
 *
 * The materials API is answered here from the C0 fixture model rendered by
 * the real server renderer, layered over the hermetic fence (a route added
 * after the fence wins; anything else falls through to it).
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { applyOps } from "../../server/materials-nodes.mjs";
import { startScribeRealService } from "../e2e-fixtures/scribe-real-service.mjs";
import { test, expect } from "@playwright/test";
import {
  DISPOSABLE_AUTH,
  HERMETIC_APPLICATION_SLUG,
  REPO_ROOT,
  installHermeticNetworkFence,
  stageSignedInDisposableAuth,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import { renderDocument, retargetModel } from "../../server/materials-render.mjs";
import { resolveFamily } from "../../server/materials-templates.mjs";

const EVIDENCE_DIR = join(REPO_ROOT, ".lane-evidence");
const FAMILY = "dossier";
const MODEL = retargetModel(
  JSON.parse(readFileSync(join(REPO_ROOT, "docs/programs/editor-20260927/fixtures/model.json"), "utf8")),
  resolveFamily(FAMILY),
);
const RENDERED = {
  "resume.html": renderDocument(MODEL, "resume"),
  "cover-letter.html": renderDocument(MODEL, "coverLetter"),
};

function packageManifest() {
  const at = "2026-09-27T15:00:00.000Z";
  const doc = (type, label, stem) => ({
    type,
    label,
    status: "ready",
    primary: `${stem}.pdf`,
    lastModifiedAt: at,
    files: [
      { filename: `${stem}.pdf`, format: "pdf", size: 120000, modifiedAt: at },
      { filename: `${stem}.html`, format: "html", size: RENDERED[`${stem}.html`].length, modifiedAt: at },
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

async function servePackage(page) {
  const prefix = `${DISPOSABLE_AUTH.materialsOrigin}/api/applications/${HERMETIC_APPLICATION_SLUG}`;
  await page.route(`${prefix}/**`, async (route) => {
    const url = new URL(route.request().url());
    const tail = url.pathname.slice(new URL(prefix).pathname.length);
    if (route.request().method() === "GET" && tail === "/manifest") {
      await route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(packageManifest()) });
      return;
    }
    const file = /^\/files\/(resume\.html|cover-letter\.html)$/.exec(tail);
    if (route.request().method() === "GET" && file) {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "Access-Control-Allow-Origin": "*" }, body: RENDERED[file[1]] });
      return;
    }
    await route.fallback();
  });
}

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.afterAll(async () => {
  if (app) await app.close();
});

/* The C0-fixture stub is opt-in (Grok F1-stub): these journeys ask for it,
   because B2's routes are not in this branch. */
async function bootSignedIn(page, viewport, { stub = true, initScript = null } = {}) {
  await page.setViewportSize(viewport);
  if (initScript) await page.addInitScript(initScript);
  await page.addInitScript(() => {
    globalThis.__cspViolations = [];
    globalThis.document.addEventListener("securitypolicyviolation", (event) => {
      globalThis.__cspViolations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl, pipelineStartsWithJob: true });
  await servePackage(page);
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.goto(`${app.baseUrl}/?jb-v2=1${stub ? "&scribe-api=stub" : ""}`, { waitUntil: "load" });
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#dashboard")).toBeVisible();
  await expect(page.locator("#authUser")).toBeVisible();
  return fence;
}

/** R1: signed in, nothing bound, so there is no Scribe anywhere in the DOM. */
async function expectNoScribe(page) {
  await expect(page.locator('jb-scribe, [data-region="scribe"], .jb-scribe-region')).toHaveCount(0);
}

async function openRole(page) {
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: /Pipeline/ }).click();
  const column = page.getByRole("region", { name: "Discovered column" });
  const expand = column.getByRole("button", { name: "Expand Discovered" });
  if (await expand.count()) await expand.click();
  await page.locator(".pipe-sticker", { hasText: "Platform Engineer" }).click();
  const role = page.locator('[data-region="role"]');
  const resumeRow = role.locator('.brief-materials [data-doc="resume"]');
  await expect(resumeRow).toBeVisible();
  return { role, editResume: resumeRow.getByRole("button", { name: "Edit" }) };
}

/** Wait until the sheet's open transition has finished, so screenshots and
 *  measurements see the settled desk, not a half-faded one. */
async function settleDesk(page) {
  await expect(page.locator("jb-scribe.scribe.is-open")).toHaveCount(1);
  await page.waitForFunction(() => {
    const sheet = globalThis.document.querySelector("jb-scribe .scribe__sheet");
    return sheet && sheet.getAnimations().every((a) => a.playState !== "running") && globalThis.getComputedStyle(sheet).opacity === "1";
  });
}

/** SPEC §4 checks, measured in the page. */
async function measureDesk(page) {
  return page.evaluate(() => {
    const host = globalThis.document.querySelector("jb-scribe");
    const mint = "rgb(95, 203, 142)";
    const inkInverse = "rgb(255, 254, 249)";
    const small = [];
    const mintOnInverse = [];
    const shortTargets = [];
    for (const el of host.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = globalThis.getComputedStyle(el);
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownText && parseFloat(cs.fontSize) < 12) small.push(`${el.className || el.tagName} ${cs.fontSize}`);
      if (cs.backgroundColor === mint && cs.color === inkInverse) mintOnInverse.push(el.className || el.tagName);
      if (el.matches("button, [role=tab]") && r.height < 44) shortTargets.push(`${el.textContent.trim() || el.getAttribute("aria-label")} ${Math.round(r.height)}`);
    }
    return {
      small,
      mintOnInverse,
      shortTargets,
      pageScrollX: globalThis.document.scrollingElement.scrollWidth - globalThis.innerWidth,
      csp: globalThis.__cspViolations,
    };
  });
}

test("should open the desk from a role's Edit button and return focus on close", async ({ page }) => {
  const fence = await bootSignedIn(page, { width: 1440, height: 900 });
  await expectNoScribe(page);

  const { editResume } = await openRole(page);
  /* A package on disk, and still no Scribe until Edit binds it. */
  await expectNoScribe(page);
  await editResume.click();

  const desk = page.getByRole("dialog", { name: "Scribe" });
  await expect(desk).toBeVisible();
  await settleDesk(page);
  await expect(desk).toContainText("Platform Engineer · Acme");
  await expect(desk.getByRole("tab", { name: "Resume" })).toHaveAttribute("aria-selected", "true");

  const frame = page.frameLocator("jb-scribe iframe");
  await expect(frame.locator(`[data-doc="resume"][data-family="${FAMILY}"]`)).toHaveCount(1);
  await expect(frame.locator("body")).toContainText("Alex Example");
  await expect(desk.locator("iframe")).toHaveAttribute("sandbox", "allow-same-origin");
  await expect(desk.getByRole("region", { name: /^Resume, version 3/ })).toHaveAttribute("aria-busy", "false");

  /* The composer accepts a request; the stubbed stream reports honestly. */
  const composer = desk.getByRole("textbox", { name: "Ask Scribe for a change" });
  await expect(composer).toBeFocused();
  await desk.getByRole("button", { name: "Punchier" }).click();
  await expect(composer).toHaveValue("Punchier");
  await composer.fill("Make the summary punchier");
  await composer.press("Enter");
  const log = desk.getByRole("log", { name: "Conversation with Scribe" });
  await expect(log).toContainText("Make the summary punchier");
  await expect(log).toContainText("Blocked: that would change a locked fact.");
  await expect(log).toContainText("1 suggested change");
  await expect(desk.locator(".scribe__reviewbar")).toContainText("1 change");
  await page.screenshot({ path: join(EVIDENCE_DIR, "F1-desk-1440-chat.png") });

  /* The versions rail lists the stubbed history, newest first. */
  await desk.getByRole("tab", { name: "Versions" }).click();
  const versions = desk.getByRole("list", { name: "Resume versions, newest first" });
  await expect(versions.getByRole("listitem")).toHaveCount(4);
  await expect(versions.getByRole("listitem").first()).toContainText("v3");
  await expect(versions.getByRole("listitem").first()).toContainText("Shorter summary");
  await expect(versions.getByRole("listitem").last()).toContainText("Pinned");
  await page.screenshot({ path: join(EVIDENCE_DIR, "F1-desk-1440-versions.png") });

  const m = await measureDesk(page);
  expect(m.small, "no text under 12px (SPEC §4)").toEqual([]);
  expect(m.mintOnInverse, "never ink-inverse on mint (R18)").toEqual([]);
  expect(m.pageScrollX).toBeLessThanOrEqual(0);
  expect(m.csp, "the desk and its srcdoc preview raise no CSP violation").toEqual([]);

  /* Grok F1-trap: a click in the preview moves focus into the iframe.
     Tab must stay in the dialog, and Esc must still close it. */
  await desk.getByRole("tab", { name: "Chat" }).click();
  await desk.locator("iframe").click({ position: { x: 200, y: 200 } });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => {
    const sheet = globalThis.document.querySelector("jb-scribe [role=dialog]");
    const a = globalThis.document.activeElement;
    return !!sheet && sheet.contains(a) && a.tagName !== "IFRAME";
  }), "Tab from the preview lands on a dialog control").toBe(true);
  await desk.locator("iframe").click({ position: { x: 200, y: 200 } });
  await page.keyboard.press("Escape");
  await expectNoScribe(page);
  await expect(editResume).toBeFocused();

  await editResume.click();
  await expect(desk).toBeVisible();
  await settleDesk(page);
  await desk.getByRole("button", { name: "Close Scribe" }).click();
  await expectNoScribe(page);
  await expect(editResume).toBeFocused();

  /* Esc is the other way out, and it also hands focus back. */
  await editResume.press("Enter");
  await expect(desk).toBeVisible();
  await page.keyboard.press("Escape");
  await expectNoScribe(page);
  await expect(editResume).toBeFocused();
  expect(fence.unexpectedExternal).toEqual([]);
});

/* A stand-in visualViewport the test can "open the keyboard" on; Chromium
   has no software keyboard to raise. */
function fakeVisualViewport() {
  const listeners = {};
  const vv = {
    height: globalThis.innerHeight,
    offsetTop: 0,
    width: globalThis.innerWidth,
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
  };
  globalThis.__raiseKeyboard = (height) => {
    vv.height = height;
    for (const fn of listeners.resize || []) fn();
  };
  globalThis.__vvListeners = () => (listeners.resize || []).length + (listeners.scroll || []).length;
  Object.defineProperty(globalThis, "visualViewport", { configurable: true, get: () => vv });
}

test("should fit a phone: one pane at a time, 44px targets, no sideways scroll", async ({ page }) => {
  const fence = await bootSignedIn(page, { width: 390, height: 844 }, { initScript: fakeVisualViewport });
  await expectNoScribe(page);
  const { editResume } = await openRole(page);
  await editResume.click();

  const desk = page.getByRole("dialog", { name: "Scribe" });
  await expect(desk).toBeVisible();
  await settleDesk(page);
  const view = desk.getByRole("tablist", { name: "View" });
  await expect(view).toBeVisible();
  await expect(page.frameLocator("jb-scribe iframe").locator(`[data-family="${FAMILY}"]`)).toHaveCount(1);
  await expect(desk.getByRole("region", { name: /^Resume, version 3/ })).toHaveAttribute("aria-busy", "false");
  await expect(desk.locator(".scribe__side")).toBeHidden();
  await page.screenshot({ path: join(EVIDENCE_DIR, "F1-desk-390-doc.png") });

  const docMetrics = await measureDesk(page);
  expect(docMetrics.shortTargets, "44px targets on phones (SPEC §4)").toEqual([]);
  expect(docMetrics.small).toEqual([]);
  expect(docMetrics.pageScrollX).toBeLessThanOrEqual(0);
  const frameBox = await desk.locator(".scribe__page").boundingBox();
  expect(frameBox.x + frameBox.width, "the page is scaled into the pane").toBeLessThanOrEqual(390);

  await view.getByRole("tab", { name: "Chat" }).click();
  await expect(desk.locator(".scribe__docpane")).toBeHidden();
  const composerBox = desk.getByRole("textbox", { name: "Ask Scribe for a change" });
  await expect(composerBox).toBeVisible();

  /* Grok F1-keyboard: a 340px keyboard leaves 504px; the composer must
     sit inside that, not under the keyboard. */
  await page.evaluate(() => globalThis.__raiseKeyboard(504));
  const composerRect = await composerBox.boundingBox();
  expect(composerRect.y + composerRect.height, "the composer stays above the keyboard").toBeLessThanOrEqual(504);
  await page.evaluate(() => globalThis.__raiseKeyboard(844));
  await page.screenshot({ path: join(EVIDENCE_DIR, "F1-desk-390-chat.png") });
  const chatMetrics = await measureDesk(page);
  expect(chatMetrics.shortTargets).toEqual([]);

  await view.getByRole("tab", { name: "Versions" }).click();
  await expect(desk.getByRole("list", { name: "Resume versions, newest first" }).getByRole("listitem")).toHaveCount(4);
  await expect(desk.getByRole("textbox", { name: "Ask Scribe for a change" })).toBeHidden();
  await page.screenshot({ path: join(EVIDENCE_DIR, "F1-desk-390-versions.png") });
  const versionMetrics = await measureDesk(page);
  expect(versionMetrics.shortTargets).toEqual([]);
  expect(versionMetrics.pageScrollX).toBeLessThanOrEqual(0);

  await desk.getByRole("button", { name: "Close Scribe" }).click();
  await expectNoScribe(page);
  await expect(editResume).toBeFocused();
  expect(await page.evaluate(() => globalThis.__vvListeners()), "close drops the visualViewport listeners").toBe(0);
  expect(fence.unexpectedExternal).toEqual([]);
});

/* Grok F1-stub (P1): with no flag, Edit must talk to the real server and
   never show the fixture history ("Shorter summary", "Match JD keywords"). */
test("should call the live routes, not the fixtures, when no stub flag is set", async ({ page }) => {
  const seen = [];
  page.on("request", (req) => {
    if (req.url().includes(`/api/applications/${HERMETIC_APPLICATION_SLUG}/`)) seen.push(`${req.method()} ${new URL(req.url()).pathname}${new URL(req.url()).search}`);
  });
  await bootSignedIn(page, { width: 1440, height: 900 }, { stub: false });
  const prefix = `${DISPOSABLE_AUTH.materialsOrigin}/api/applications/${HERMETIC_APPLICATION_SLUG}`;
  await page.route(`${prefix}/versions?doc=resume`, (route) => route.fulfill({
    status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ currentRunId: "live-r0", versions: [{ runId: "live-r0", n: 0, createdAt: "2026-09-27T15:00:00.000Z", source: "draft", label: "Drafted", pinned: true, starred: false, pages: 1, words: 402, family: FAMILY }] }),
  }));
  await page.route(`${prefix}/preview`, (route) => route.fulfill({
    status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ html: RENDERED["resume.html"], words: 60, pageBudget: 1 }),
  }));
  const { editResume } = await openRole(page);
  await editResume.click();
  const desk = page.getByRole("dialog", { name: "Scribe" });
  await expect(desk).toBeVisible();
  await expect(page.frameLocator("jb-scribe iframe").locator(`[data-family="${FAMILY}"]`)).toHaveCount(1);
  await desk.getByRole("tab", { name: "Versions" }).click();
  await expect(desk.getByRole("list", { name: "Resume versions, newest first" }).getByRole("listitem")).toHaveCount(1);
  await expect(desk).not.toContainText("Shorter summary");
  expect(seen).toContain("GET /api/applications/" + HERMETIC_APPLICATION_SLUG + "/versions?doc=resume");
  expect(seen).toContain("POST /api/applications/" + HERMETIC_APPLICATION_SLUG + "/preview");
});

/* EDITOR lane F3: the versions rail. Stub transport, with the drafted
   version's summary worded differently so Compare has something to mark
   (the C0 stub serves one model for every run). Pinned here:
     - Compare with current splits A | B at 1440 and marks A → B with no
       accept controls; the `c` key toggles it; View is read-only;
     - Bring back asks first, then appends: every older row survives;
     - at 390 compare is an A/B toggle, one page at a time, with 44px
       targets and no sideways scroll. */
test("should view, compare and bring back versions at 1440 and 390", async ({ page }) => {
  const fence = await bootSignedIn(page, { width: 1440, height: 900 });
  await page.evaluate(() => {
    const api = globalThis.JBScribeApi;
    const create = api.create;
    api.create = (opts) => {
      const client = create(opts);
      const getModel = client.getModel;
      client.getModel = (runId) => getModel(runId).then((res) => {
        if (runId !== "stub-r0") return res;
        const stmt = res.nodes.find((n) => n.id === "stmt");
        stmt.text = "Operations analyst who tracked fulfillment delays through careful measurement and practical process changes. Builds clear dashboards, tests assumptions, and helps teams turn reliable evidence into daily decisions.";
        return res;
      });
      return client;
    };
  });
  const { editResume } = await openRole(page);
  await editResume.click();
  const desk = page.getByRole("dialog", { name: "Scribe" });
  await settleDesk(page);
  await desk.getByRole("tab", { name: "Versions" }).click();
  const versions = desk.getByRole("list", { name: "Resume versions, newest first" });
  await expect(versions.getByRole("listitem")).toHaveCount(4);
  await expect(versions.getByRole("listitem").first()).toContainText("Scribe");

  /* Compare with current: A | B, marked, read-only. */
  await desk.getByRole("button", { name: "Compare v0 with current" }).click();
  const compare = desk.getByRole("region", { name: /^Comparing resume v0 with v3\. 1 block differ/ });
  await expect(compare).toBeVisible();
  await expect(desk.getByRole("button", { name: /^Compare/ }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(compare.locator(".scribe__compare-item del")).toContainText("tracked");
  await expect(compare.locator(".scribe__compare-item ins")).toContainText("reduced");
  await expect(compare.getByRole("button", { name: /accept|reject/i })).toHaveCount(0);
  await expect(page.frameLocator("jb-scribe .scribe__compare-fig--b iframe").locator(`[data-family="${FAMILY}"]`)).toHaveCount(1);
  const [boxA, boxB] = await Promise.all([
    compare.locator(".scribe__compare-fig--a .scribe__compare-sheet").boundingBox(),
    compare.locator(".scribe__compare-fig--b .scribe__compare-sheet").boundingBox(),
  ]);
  expect(boxA.x + boxA.width, "A sits left of B at 1440").toBeLessThanOrEqual(boxB.x);
  expect(Math.abs(boxA.y - boxB.y)).toBeLessThan(2);
  await expect(compare.getByRole("tablist", { name: "Show version" })).toBeHidden();
  await page.screenshot({ path: join(EVIDENCE_DIR, "F3-compare-1440.png") });
  const wide = await measureDesk(page);
  expect(wide.small, "no text under 12px").toEqual([]);
  expect(wide.csp).toEqual([]);

  /* Grok F3-trap: after a click in a compared page, Tab comes back to the
     compare controls and `c` still closes compare. */
  const pageB = compare.locator(".scribe__compare-fig--b iframe");
  await pageB.click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("Tab");
  await expect(compare.getByRole("combobox", { name: "Version A" })).toBeFocused();
  await pageB.click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("c");
  await expect(desk.locator(".scribe__compare")).toBeHidden();
  await page.keyboard.press("c");
  await expect(desk.getByRole("region", { name: /^Comparing resume v2 with v3/ })).toBeVisible();
  await desk.getByRole("button", { name: "Done comparing" }).click();

  /* View is read-only and has its own way back. */
  await desk.getByRole("button", { name: "View v1, read-only" }).click();
  const viewing = desk.getByRole("region", { name: "Resume, version 1, read-only" });
  await expect(viewing).toContainText("Viewing v1");
  await viewing.locator(".scribe__compare-fig--a iframe").click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("Tab");
  await expect(viewing.getByRole("button", { name: "Compare with current" })).toBeFocused();
  await viewing.getByRole("button", { name: "Back to current" }).click();
  await expect(viewing).toBeHidden();
  await expect(desk.getByRole("button", { name: "View v1, read-only" })).toBeFocused();

  /* Grok F3-rebind: View → Compare with current hands page A the srcdoc it
     already holds, so no load fires. Tab and Esc from it must still reach
     the desk, and the page must not stay dimmed as busy. */
  await desk.getByRole("button", { name: "View v1, read-only" }).click();
  await expect(viewing).toContainText("Viewing v1");
  await viewing.getByRole("button", { name: "Compare with current" }).click();
  const rebound = desk.getByRole("region", { name: /^Comparing resume v1 with v3/ });
  await expect(rebound).toBeVisible();
  await expect(rebound.locator(".scribe__compare-fig--a .scribe__compare-sheet")).toHaveAttribute("aria-busy", "false");
  const pageA = rebound.locator(".scribe__compare-fig--a iframe");
  await pageA.click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("Tab");
  await expect(rebound.getByRole("combobox", { name: "Version A" })).toBeFocused();
  await pageA.click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("Escape");
  await expectNoScribe(page);
  await expect(editResume).toBeFocused();
  await editResume.click();
  await settleDesk(page);
  await desk.getByRole("tab", { name: "Versions" }).click();

  /* Bring back asks first, then appends. */
  await desk.getByRole("button", { name: "Bring back v1 as a new version" }).click();
  const ask = desk.getByRole("group", { name: "Bring back v1" });
  await expect(ask).toContainText("Bring back v1 as v4? All versions are kept.");
  await expect(versions.getByRole("listitem")).toHaveCount(4);
  await ask.getByRole("button", { name: "Bring back as v4" }).press("Enter");
  await expect(versions.getByRole("listitem")).toHaveCount(5);
  await expect(versions.getByRole("listitem").first()).toContainText("Brought back from v1");
  await expect(versions.getByRole("listitem").first()).toContainText("Brought back");
  await expect(versions.getByRole("listitem").first()).toHaveAttribute("aria-current", "true");
  for (const n of ["v3", "v2", "v1", "v0"]) await expect(versions).toContainText(n);
  /* The chat panel is behind the Versions tab here, so read the log directly. */
  await expect(desk.locator(".scribe__log")).toContainText("Brought back v1 as v4.");

  /* 390: one page at a time behind an A/B toggle. */
  await page.setViewportSize({ width: 390, height: 844 });
  await desk.getByRole("tablist", { name: "View" }).getByRole("tab", { name: "Versions" }).click();
  await desk.getByRole("button", { name: "Compare v0 with current" }).click();
  const phone = desk.getByRole("region", { name: /^Comparing resume v0 with v4/ });
  await expect(phone).toBeVisible();
  await expect(desk.getByRole("tablist", { name: "View" }).getByRole("tab", { name: "Doc" })).toHaveAttribute("aria-selected", "true");
  const ab = phone.getByRole("tablist", { name: "Show version" });
  await expect(ab).toBeVisible();
  await expect(phone.locator(".scribe__compare-fig--b")).toBeVisible();
  await expect(phone.locator(".scribe__compare-fig--a")).toBeHidden();
  await ab.getByRole("tab", { name: /^A · v0/ }).click();
  await expect(phone.locator(".scribe__compare-fig--a")).toBeVisible();
  await expect(phone.locator(".scribe__compare-fig--b")).toBeHidden();
  await expect(phone.locator(".scribe__compare-item ins")).toContainText("reduced");
  await page.screenshot({ path: join(EVIDENCE_DIR, "F3-compare-390.png") });
  const narrow = await measureDesk(page);
  expect(narrow.shortTargets, "44px targets on phones").toEqual([]);
  expect(narrow.small).toEqual([]);
  expect(narrow.pageScrollX).toBeLessThanOrEqual(0);
  await desk.getByRole("tablist", { name: "View" }).getByRole("tab", { name: "Versions" }).click();
  await page.screenshot({ path: join(EVIDENCE_DIR, "F3-versions-390.png") });
  const rail = await measureDesk(page);
  expect(rail.shortTargets, "row actions are 44px on phones").toEqual([]);
  expect(rail.pageScrollX).toBeLessThanOrEqual(0);
  expect(fence.unexpectedExternal).toEqual([]);
});


const REAL_OP = {
  resume: { opId: 'safe-edit', op: 'replace', node: 'b:acme:c14', text: 'Measured carrier delays through a weekly operations dashboard.', flags: [], facts: [] },
  cover_letter: { opId: 'safe-edit', op: 'replace', node: 'p:p3', text: 'I welcome a conversation about improving daily operations.', flags: [], facts: [] },
};
async function realReliabilityDesk(page, which, propose) {
  const service = await startScribeRealService({ pdfSession: async () => null,
    propose: propose || (async () => ({ ops: [REAL_OP[which]], blocked: [], summary: { changes: 1 }, factCheck: 'model' })) });
  const pkg = await service.seed({ slug: 'acme-example' });
  const calls = [];
  page.on('request', req => { if (req.url().startsWith(service.baseUrl)) calls.push({ method: req.method(), path: new URL(req.url()).pathname, body: req.method() === 'POST' ? req.postDataJSON() : null }); });
  const fence = await bootSignedIn(page, { width: 1440, height: 900 }, { stub: false });
  await service.pointPage(page);
  await page.evaluate(({ slug, doc, base }) => globalThis.JB_SCRIBE_V2.open({ slug, doc, base }), { slug: pkg.slug, doc: which, base: service.baseUrl });
  const desk = page.locator('jb-scribe');
  await expect(desk.locator('.scribe__docscroll')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.loading)).toBe(false);
  const composer = desk.locator('textarea');
  const send = async () => { await composer.fill('Shorten using existing facts.'); await composer.press('Enter'); };
  return { service, pkg, calls, fence, desk, composer, send };
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F26 ASTRA-04 ${which} real stale retry uses the exact current redline base`, async ({ page }) => {
    const t = await realReliabilityDesk(page, which);
    try {
      const baseText = which === 'resume' ? 'Resolved carrier exceptions and tracked daily shipments.' : 'I welcome a conversation about your daily operations.';
      const alternate = applyOps(t.pkg.model, [{ ...REAL_OP[which], opId: 'seed', text: baseText }]);
      const folder = join(t.pkg.dir, 'runs', 'rseed'); await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'render-model.json'), JSON.stringify(alternate));
      await writeFile(join(folder, 'run.json'), JSON.stringify({ runId: 'rseed', slug: t.pkg.slug, feature: 'both', requestedAt: '2026-09-26T10:00:00.000Z', finishedAt: '2026-09-26T10:00:00.000Z', template: { family: alternate.template.family, source: 'default' }, artifacts: [] }));
      // Move the base by a real Bring back; manual writes are forbidden by D18.
      const restored = await (await fetch(`${t.service.baseUrl}${t.pkg.path}/versions/rseed/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
      const latest = restored.run.runId;
      await t.send(); await expect(t.desk.locator('[data-review="accept-all"]')).toBeVisible();
      const starts = t.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits'));
      expect(starts).toHaveLength(2); expect(starts[0].body.baseRunId).toBe('r0'); expect(starts[1].body.baseRunId).toBe(latest);
      const state = await page.evaluate(() => {
        const c = globalThis.JB_SCRIBE_V2.current(); const p = c.state.proposal;
        return { currentRunId: c.state.currentRunId, before: p.changes[0].before, baseWords: p.baseWords, baseRunId: p.baseRunId };
      });
      expect(state.currentRunId).toBe(latest); expect(state.baseRunId).toBe(latest); expect(state.before).toBe(baseText);
      const listing = await (await fetch(`${t.service.baseUrl}${t.pkg.path}/versions?doc=${which}`)).json();
      const row = listing.versions.find(v => v.runId === latest); expect(state.baseWords).toBe(row.words);
      await expect(t.desk.locator('.scribe__stage')).toContainText(`v${row.n}`);
      await expect(t.desk.locator('.scribe__ver[aria-current="true"]')).toHaveAttribute('data-run', latest);
      const delText = await page.frameLocator('jb-scribe .scribe__frame').locator(`[data-node="${REAL_OP[which].node}"] del`).allTextContents();
      expect(delText.join(' ')).toMatch(which === 'resume' ? /Resolved|exceptions|shipments/ : /your|daily/);
      await fetch(`${t.service.baseUrl}${t.pkg.path}/versions/r0/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await t.desk.locator('[data-review="accept-all"]').click(); await t.desk.locator('[data-review="save"]').click();
      await expect(t.desk.locator('.scribe__status')).toContainText('Not saved — a newer version exists.');
      await t.desk.locator('.scribe__status-action').click();
      await expect(t.desk.locator('.scribe__compare')).toBeVisible();
      await expect(t.desk.locator('.scribe__compare [data-review]')).toHaveCount(0);
      expect(await page.evaluate(() => !!globalThis.JB_SCRIBE_V2.current().state.proposal.id)).toBe(true);
      expect(t.fence.unexpectedExternal).toEqual([]);
    } finally { await t.service.close(); }
  });
  for (const [reason, expected] of [
    ['provider_failed', 'The AI provider didn’t respond. Your document is unchanged.'],
    ['unreadable_reply', 'Scribe’s reply couldn’t be read. Your document is unchanged.'],
    ['invalid_model', 'Blocked: that change doesn’t fit this template’s layout.'],
  ]) {
    test(`SCRP-F27 ASTRA-05 ${which} real blocked ${reason} has safe copy and a retry`, async ({ page }) => {
      let failed = true;
      const t = await realReliabilityDesk(page, which, async () => failed ? { ops: [], blocked: [{ reason, detail: '/private/provider-payload' }], summary: { changes: 0 }, factCheck: 'model' } : { ops: [REAL_OP[which]], blocked: [], summary: { changes: 1 }, factCheck: 'model' });
      try {
        await t.send(); await expect(t.desk.locator('.scribe__status')).toContainText(expected);
        await expect(t.desk.locator('.scribe__status-action')).toHaveText('Try again');
        await expect(t.composer).toHaveValue('Shorten using existing facts.');
        await expect(t.desk.locator('.scribe__log')).not.toContainText('/private/provider-payload');
        const before = await (await fetch(`${t.service.baseUrl}${t.pkg.path}/versions?doc=${which}`)).json(); expect(before.versions).toHaveLength(1);
        failed = false; await t.desk.locator('.scribe__status-action').click();
        await expect(t.desk.locator('[data-review="accept-all"]')).toBeVisible();
        expect(t.fence.unexpectedExternal).toEqual([]);
      } finally { await t.service.close(); }
    });
  }
  for (const [code, expected, action] of [
    ['http_429', 'Too many requests right now. Try again in a minute. Your request is kept.', 'Try again'],
    ['writer_truncated', 'Scribe’s reply was cut off. Your document is unchanged.', 'Try again'],
    ['writer_blocked', 'The AI provider declined this request. Your document is unchanged. Try rewording it.', 'Try again'],
    ['llm_unconfigured', 'The AI model isn’t set up correctly. Check it in Settings, then try again.', 'Settings'],
  ]) {
    test(`SCRP-F28 ASTRA-05 ${which} real SSE error ${code} is bounded and actionable`, async ({ page }) => {
      const t = await realReliabilityDesk(page, which, async () => { throw Object.assign(new Error('/private/raw-provider-body'), { code }); });
      try {
        await t.send(); await expect(t.desk.locator('.scribe__status')).toContainText(expected);
        await expect(t.desk.locator('.scribe__status-action')).toHaveText(action);
        await expect(t.composer).toHaveValue('Shorten using existing facts.');
        await expect(t.desk.locator('.scribe__log')).not.toContainText('/private/raw-provider-body');
        expect(t.fence.unexpectedExternal).toEqual([]);
      } finally { await t.service.close(); }
    });
  }
}
