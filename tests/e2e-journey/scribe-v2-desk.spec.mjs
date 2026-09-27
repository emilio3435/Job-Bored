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
 * The materials API is answered here from the C0 fixture model rendered by
 * the real server renderer, layered over the hermetic fence (a route added
 * after the fence wins; anything else falls through to it).
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

async function bootSignedIn(page, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    globalThis.__cspViolations = [];
    globalThis.document.addEventListener("securitypolicyviolation", (event) => {
      globalThis.__cspViolations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl, pipelineStartsWithJob: true });
  await servePackage(page);
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
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
  await expect(log).toContainText("Blocked: would change “38%”.");
  await expect(log).toContainText("1 change is ready");
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

test("should fit a phone: one pane at a time, 44px targets, no sideways scroll", async ({ page }) => {
  const fence = await bootSignedIn(page, { width: 390, height: 844 });
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
  await expect(desk.getByRole("textbox", { name: "Ask Scribe for a change" })).toBeVisible();
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
  expect(fence.unexpectedExternal).toEqual([]);
});
