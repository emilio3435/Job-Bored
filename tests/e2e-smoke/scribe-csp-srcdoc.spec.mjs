/**
 * scribe-csp-srcdoc.spec.mjs — EDITOR lane P0, the SPEC §5 CSP probe.
 *
 * Scribe v2 (SPEC §0 D4) previews a document by asking the server for the
 * `renderDocument` HTML and injecting it as the `srcdoc` of an
 * `<iframe sandbox="allow-same-origin">` with no `allow-scripts`. A srcdoc
 * document is never fetched, but it inherits the parent's CSP, and the
 * dashboard's `frame-src` names only https://accounts.google.com. This spec
 * proves, under the real policy the dev server serves, that such a preview
 * renders with its inline `<style>`, `data:` fonts and a `data:` logo, and
 * raises no violation in the parent or the frame. A red run here sends
 * SPEC §0-4(b) back to Emilio before any front-end lane is built.
 *
 * A control test injects a srcdoc that must violate `img-src`, so the
 * collectors are proven able to see a frame violation and a frame request;
 * the clean result is not vacuous.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import {
  REPO_ROOT,
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import { buildContentSecurityPolicy } from "../../scripts/lib/browser-csp-policy.mjs";
import {
  renderDocument,
  retargetModel,
  validateRenderModel,
} from "../../server/materials-render.mjs";
import { resolveFamily } from "../../server/materials-templates.mjs";

const MODEL_PATH = join(
  REPO_ROOT,
  "docs/programs/editor-20260927/fixtures/model.json",
);
const EVIDENCE_DIR = join(REPO_ROOT, ".lane-evidence");
const FRAME_NAME = "scribe-csp-probe";

/** The face each family sets its body copy in; it must load in the frame. */
const FAMILIES = [
  { id: "signal", face: "Archivo" },
  { id: "dossier", face: "Source Sans 3" },
  { id: "editorial", face: "Bodoni Moda" },
];

/** A tiny SVG mark, inlined the way the logo resolver hands logos over. */
const DATA_LOGO = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1b1b1b"/><path d="M8 22 16 8l8 14z" fill="#d4ff3a"/></svg>',
).toString("base64")}`;

/**
 * The C0 fixture model, re-pointed at `familyId`, with a `data:` logo on the
 * first experience entry so the probe covers `img-src data:` as well.
 */
function probeModel(familyId) {
  const base = JSON.parse(readFileSync(MODEL_PATH, "utf8"));
  const model = retargetModel(base, resolveFamily(familyId));
  const entry = model.documents.resume.sections.find(
    (section) => section.kind === "experience",
  ).entries[0];
  entry.logo = { src: DATA_LOGO, alt: `${entry.org} logo`, shape: "mark", source: "upload" };
  const verdict = validateRenderModel(model);
  if (!verdict.ok) throw new Error(`probe model invalid: ${verdict.errors.join("; ")}`);
  return model;
}

/** Every directive except connect-src, which config.js may legitimately widen. */
function directivesExceptConnect(policy) {
  return policy
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("connect-src"))
    .sort();
}

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.afterAll(async () => {
  if (app) await app.close();
});

/**
 * Boot the dashboard under its served CSP and arm three violation collectors:
 * a `securitypolicyviolation` listener on the parent document (installed
 * before any script runs), the page console, and the CDP Log domain, which
 * reports violations from every frame, a script-less sandboxed one included.
 */
async function openDashboard(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push({
        where: "parent",
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        sample: event.sample,
      });
    });
  });
  const consoleCsp = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) consoleCsp.push(message.text());
  });
  const cdp = await page.context().newCDPSession(page);
  const logCsp = [];
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (/Content Security Policy/i.test(entry.text)) logCsp.push(entry.text);
  });
  await cdp.send("Log.enable");

  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  const response = await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  const servedPolicy = response.headers()["content-security-policy"] || "";
  return { fence, servedPolicy, consoleCsp, logCsp };
}

/**
 * Create the sandboxed preview frame and wait for its srcdoc document. The
 * frame document's own listener is attached once it exists, so late
 * violations (a lazily loaded face, say) are caught there too.
 */
async function injectPreview(page, html) {
  await page.evaluate(
    ({ html: srcdoc, name }) =>
      new Promise((resolve) => {
        const frame = document.createElement("iframe");
        frame.name = name;
        frame.title = "Scribe preview probe";
        frame.setAttribute("sandbox", "allow-same-origin");
        frame.style.cssText =
          "position:fixed;inset:0;width:1440px;height:900px;border:0;z-index:2147483647;background:#fff";
        frame.addEventListener("load", () => {
          frame.contentDocument.addEventListener("securitypolicyviolation", (event) => {
            window.__cspViolations.push({
              where: "frame",
              directive: event.effectiveDirective,
              blocked: event.blockedURI,
              sample: event.sample,
            });
          });
          resolve();
        }, { once: true });
        frame.srcdoc = srcdoc;
        document.body.appendChild(frame);
      }),
    { html, name: FRAME_NAME },
  );
}

/** Measure the frame from the parent: the frame itself may run no script. */
async function inspectPreview(page, face) {
  return page.evaluate(
    async ({ name, face: family }) => {
      const frame = document.querySelector(`iframe[name="${name}"]`);
      const doc = frame.contentDocument;
      await doc.fonts.ready;
      const sheet = doc.querySelector("[data-page]");
      frame.style.height = `${Math.max(900, doc.documentElement.scrollHeight)}px`;
      const faces = [...doc.fonts].filter(
        (f) => f.family.replace(/^['"]|['"]$/g, "") === family,
      );
      const logo = doc.querySelector('img[src^="data:image/svg+xml"]');
      return {
        sandbox: frame.getAttribute("sandbox"),
        hasSrcdoc: frame.hasAttribute("srcdoc"),
        url: doc.URL,
        pageScrollHeight: sheet ? sheet.scrollHeight : 0,
        fontCheck: doc.fonts.check(`16px "${family}"`),
        facesDeclared: faces.length,
        facesLoaded: faces.filter((f) => f.status === "loaded").length,
        logoDecoded: Boolean(logo && logo.complete && logo.naturalWidth > 0),
        scriptsInFrame: doc.querySelectorAll("script").length,
      };
    },
    { name: FRAME_NAME, face },
  );
}

for (const { id, face } of FAMILIES) {
  test(`should render the ${id} resume in a sandboxed srcdoc frame with no CSP violation`, async ({
    page,
  }) => {
    const html = renderDocument(probeModel(id), "resume");
    expect(html).toContain("<style>");
    expect(html).toContain("url(data:font/");
    expect(html).toContain(DATA_LOGO);

    const { fence, servedPolicy, consoleCsp, logCsp } = await openDashboard(page);
    expect(servedPolicy, "the dashboard must be served under its CSP").not.toBe("");
    expect(directivesExceptConnect(servedPolicy)).toEqual(
      directivesExceptConnect(buildContentSecurityPolicy()),
    );
    expect(servedPolicy).toContain("frame-src https://accounts.google.com");

    const frameRequests = [];
    page.on("request", (request) => {
      if (request.frame().name() === FRAME_NAME && !request.url().startsWith("data:")) {
        frameRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await injectPreview(page, html);
    const probe = await inspectPreview(page, face);
    // Give any deferred violation report a turn to arrive.
    await page.waitForTimeout(250);

    expect(probe.sandbox).toBe("allow-same-origin");
    expect(probe.hasSrcdoc).toBe(true);
    expect(probe.url).toBe("about:srcdoc");
    expect(probe.scriptsInFrame).toBe(0);
    expect(probe.pageScrollHeight).toBeGreaterThan(0);
    expect(probe.facesDeclared, `${face} must be declared in the frame`).toBeGreaterThan(0);
    expect(probe.facesLoaded, `${face} must load from its data: URI`).toBeGreaterThan(0);
    expect(probe.fontCheck).toBe(true);
    expect(probe.logoDecoded, "the data: logo must decode").toBe(true);

    const domViolations = await page.evaluate(() => window.__cspViolations);
    expect(domViolations).toEqual([]);
    expect(consoleCsp).toEqual([]);
    expect(logCsp).toEqual([]);
    expect(frameRequests, "no network request may leave for the preview").toEqual([]);
    expect(fence.unexpectedExternal).toEqual([]);

    await page
      .locator(`iframe[name="${FRAME_NAME}"]`)
      .screenshot({ path: join(EVIDENCE_DIR, `P0-csp-srcdoc-${id}-resume-1440.png`) });
  });
}

test("control: should see a frame violation when the srcdoc breaks img-src", async ({
  page,
}) => {
  const { logCsp } = await openDashboard(page);
  const frameRequests = [];
  page.on("request", (request) => {
    if (request.frame().name() === FRAME_NAME) frameRequests.push(request.url());
  });
  // http: is outside img-src ('self' data: https:), so the image is refused.
  // Playwright still reports the refused attempt against the frame, which
  // proves the network collector attributes preview traffic correctly.
  await injectPreview(
    page,
    '<!doctype html><html><body><div data-page="1"><img src="http://csp-probe.invalid/x.png" alt=""></div></body></html>',
  );
  await expect.poll(() => logCsp.length, { timeout: 5_000 }).toBeGreaterThan(0);
  expect(logCsp.join("\n")).toContain("img-src");
  expect(frameRequests).toContain("http://csp-probe.invalid/x.png");
});
