/**
 * scribe-edit-journey.spec.mjs — EDITOR lane Q1: the Scribe v2 desk, end to
 * end, against the live B2 routes (no `?scribe-api=stub`).
 *
 * One user's pass over a drafted resume, at 1440:
 *   - Edit on the role's resume row mounts the desk on the real template
 *     render (the server renderer's HTML in the sandboxed srcdoc frame);
 *   - a chip fills the composer and sends nothing;
 *   - Send: the stage line moves only when the server says so, and each
 *     validated op is marked on the page as it arrives; a locked fact comes
 *     back as a blocked line;
 *   - j/k move between changes, a/r decide the focused one, Accept all skips
 *     the Unverified change, and "Save as v2" posts exactly the accepted ops,
 *     adds a version row and re-reads the preview from the new run;
 *   - Stop mid-proposal keeps the ops the server validated (partial);
 *   - `c` opens Compare A | B; Bring back appends a version and deletes none;
 *   - Esc closes the desk and hands focus back to Edit.
 *
 * The routes are answered by the harness's installScribeEditApi: real
 * renders, append-only runs, and a real SSE stream the test writes event by
 * event through an ephemeral loopback relay. No model call; no live port.
 */

import { readFileSync } from "node:fs";
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
/* v0 words the summary differently, so Compare and Bring back have real text to move. */
const DRAFTED = applyOps(MODEL, [{
  opId: "seed",
  op: "replace",
  node: "stmt",
  text: "Operations analyst who tracked fulfillment delays 38% through careful measurement and practical process changes. Builds clear dashboards, tests assumptions, and helps teams turn reliable evidence into daily decisions.",
}]);

const OPS = {
  o1: { opId: "o1", op: "replace", node: "b:acme:c14", text: "Measured carrier delays and reduced them through a weekly operations dashboard.", rationale: "Lead with the outcome", flags: [], facts: [] },
  o2: { opId: "o2", op: "insert", after: "b:acme:c14", claimId: "c22", text: "Built a daily exception review with the Contoso carrier team.", rationale: "New proof point", flags: ["unverified"], facts: ["Contoso"] },
  o3: { opId: "o3", op: "remove", node: "b:acme:c19", rationale: "Weakest bullet" },
  o4: { opId: "o4", op: "replace", node: "line:beta", text: "Tracked daily shipments and cleared exceptions within one shift.", rationale: "Show the pace", flags: [], facts: [] },
};

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

async function bootSignedIn(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl, pipelineStartsWithJob: true });
  const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  api = await installScribeEditApi(page, {
    slug: HERMETIC_APPLICATION_SLUG,
    render: renderDocument,
    applyOps,
    nodesOf: deriveNodes,
    manifest,
    runs: [
      { runId: "run-00", createdAt: hoursAgo(72), source: "draft", label: "Drafted", model: DRAFTED },
      { runId: "run-01", createdAt: hoursAgo(2), source: "edit", prompt: "Shorter summary", model: MODEL },
    ],
  });
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#dashboard")).toBeVisible();
  return fence;
}

async function openResumeEdit(page) {
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: /Pipeline/ }).click();
  const column = page.getByRole("region", { name: "Discovered column" });
  const expand = column.getByRole("button", { name: "Expand Discovered" });
  if (await expand.count()) await expand.click();
  await page.locator(".pipe-sticker", { hasText: "Platform Engineer" }).click();
  const row = page.locator('[data-region="role"] .brief-materials [data-doc="resume"]');
  await expect(row).toBeVisible();
  return row.getByRole("button", { name: "Edit" });
}

const posted = (path) => api.calls.filter((c) => c.method === "POST" && c.path === path);

/** Send from the composer and wait until the browser holds the stream open. */
async function sendAndOpenStream(page, composer, text) {
  const before = api.proposals.length;
  if (text !== null) await composer.fill(text);
  await composer.press("Enter");
  await expect.poll(() => api.proposals.length).toBe(before + 1);
  const id = api.proposals[before].id;
  await api.streamOpened(id);
  return id;
}

/** Review keys work only outside text fields: put focus on the document,
 *  where F6 would take it. */
async function focusDocument(desk) {
  await desk.locator(".scribe__docscroll").focus();
}

test("should take a resume from Edit through review, save, stop, compare and bring back", async ({ page }) => {
  const fence = await bootSignedIn(page);
  await expect(page.locator("jb-scribe")).toHaveCount(0);
  const edit = await openResumeEdit(page);
  await edit.click();

  /* The desk mounts on the real render of the current run. */
  const desk = page.getByRole("dialog", { name: "Scribe" });
  await expect(desk).toBeVisible();
  const frame = page.frameLocator("jb-scribe .scribe__docscroll iframe");
  await expect(frame.locator(`[data-doc="resume"][data-family="${FAMILY}"]`)).toHaveCount(1);
  await expect(frame.locator('[data-node="b:acme:c14"]')).toContainText("built a weekly dashboard");
  await expect(desk.getByRole("region", { name: /^Resume, version 1/ })).toHaveAttribute("aria-busy", "false");
  expect(api.calls.some((c) => c.method === "GET" && c.path === "/versions?doc=resume")).toBe(true);
  expect(posted("/preview")[0].body).toMatchObject({ doc: "resume", baseRunId: "run-01" });

  /* A chip fills the composer and sends nothing. */
  const composer = desk.getByRole("textbox", { name: "Ask Scribe for a change" });
  await desk.getByRole("button", { name: "Punchier" }).click();
  await expect(composer).toHaveValue("Punchier");
  expect(posted("/edits"), "a chip never sends").toEqual([]);

  /* Send. The line starts at Reading and waits for the server. */
  const id = await sendAndOpenStream(page, composer, "Make the summary punchier");
  expect(posted("/edits")[0].body).toMatchObject({ doc: "resume", baseRunId: "run-01", instruction: "Make the summary punchier", lockFacts: true });
  const stage = desk.locator(".scribe__stage-short");
  await expect(stage).toHaveText("Reading resume");
  await expect(desk.getByRole("region", { name: /^Resume/ })).toHaveAttribute("aria-busy", "true");
  await page.waitForTimeout(800);
  await expect(stage, "no progress without a server event").toHaveText("Reading resume");

  api.emit(id, "stage", { stage: "reading" });
  api.emit(id, "stage", { stage: "drafting" });
  await expect(stage).toHaveText("Drafting edits");
  api.emit(id, "stage", { stage: "checking", done: 1, total: 4 });
  await expect(stage).toHaveText("Checking facts (1/4)");

  /* Each validated op is marked as it arrives, while the run is still busy. */
  api.emit(id, "op", { op: OPS.o1 });
  await expect(frame.locator('[data-scribe-id="o1"] ins')).toContainText("reduced them");
  await expect(stage).toHaveText("Checking facts (1/4)");
  for (const key of ["o2", "o3", "o4"]) api.emit(id, "op", { op: OPS[key] });
  await expect(frame.locator("[data-scribe-id]")).toHaveCount(4);

  /* A locked fact comes back blocked, in words. */
  api.emit(id, "blocked", { op: { opId: "o5", op: "replace", node: "stmt", text: "Cut fulfillment delays by half." }, reason: "locked", detail: "38%" });
  const log = desk.getByRole("log", { name: "Conversation with Scribe" });
  await expect(log).toContainText("Blocked: “38%” is a locked fact.");

  api.emit(id, "stage", { stage: "measuring" });
  await expect(stage).toHaveText("Measuring length");
  api.emit(id, "proposal", { summary: { changes: 4, removals: 1, wordsDelta: 2, lossPct: 9, pages: 1, unverified: 1 } });
  api.emit(id, "done", { status: "ready" });
  api.end(id);
  await expect(log).toContainText("4 suggested changes");
  await expect(desk.getByRole("region", { name: /^Resume/ })).toHaveAttribute("aria-busy", "false");

  /* j/k move, a/r decide the focused change. Reading order: o1 o2 o3 o4. */
  const rail = desk.locator(".scribe__rail");
  const note = (op) => rail.locator(`.scribe__mm[data-op="${op}"]`);
  const focusedOp = () => rail.locator('.scribe__mm[data-focus="true"]').getAttribute("data-op");
  await focusDocument(desk);
  await page.keyboard.press("j");
  await expect.poll(focusedOp).toBe("o1");
  await page.keyboard.press("a");
  await expect(note("o1")).toHaveAttribute("data-state", "accepted");
  await expect(frame.locator('[data-scribe-id="o1"]')).toHaveAttribute("data-scribe-state", "accepted");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect.poll(focusedOp).toBe("o3");
  await page.keyboard.press("k");
  await expect.poll(focusedOp).toBe("o2");
  await page.keyboard.press("j");
  await page.keyboard.press("r");
  await expect(note("o3")).toHaveAttribute("data-state", "rejected");

  /* Accept all takes the verified change and leaves the Unverified one. */
  await expect(note("o2")).toContainText("Not in your saved facts — confirm before accepting. Contoso");
  await desk.getByRole("button", { name: "Accept all verified" }).click();
  await expect(note("o4")).toHaveAttribute("data-state", "accepted");
  await expect(note("o2")).toHaveAttribute("data-state", "pending");

  /* Save posts exactly the accepted ops; the list and the preview move on. */
  await desk.getByRole("button", { name: "Save as v2 (2 accepted)" }).click();
  await expect(log).toContainText("Saved as v2");
  const accepted = api.calls.find((c) => c.method === "POST" && c.path === `/edits/${id}/accept`);
  expect(accepted.body).toEqual({ accept: ["o1", "o4"], confirmUnverified: [] });
  await desk.getByRole("tab", { name: "Versions" }).click();
  const versions = desk.getByRole("list", { name: "Resume versions, newest first" });
  await expect(versions.getByRole("listitem")).toHaveCount(3);
  await expect(versions.getByRole("listitem").first()).toContainText("v2");
  await expect(versions.getByRole("listitem").first()).toContainText("Make the summary punchier");
  await expect.poll(() => posted("/preview").at(-1)?.body?.baseRunId).toBe("run-02");
  await expect(frame.locator('[data-node="b:acme:c14"]')).toContainText("reduced them through a weekly operations dashboard");
  await expect(frame.locator('[data-node="line:beta"]')).toContainText("cleared exceptions within one shift");
  await expect(frame.locator("body")).not.toContainText("Contoso");
  await expect(frame.locator("[data-scribe-id]")).toHaveCount(0);

  /* Stop mid-proposal keeps what the server validated, marked partial. */
  await desk.getByRole("tab", { name: "Chat" }).click();
  await desk.getByRole("button", { name: "Shorter" }).click();
  const stopId = await sendAndOpenStream(page, composer, null);
  expect(posted("/edits")[1].body).toMatchObject({ instruction: "Shorter", baseRunId: "run-02" });
  api.emit(stopId, "stage", { stage: "drafting" });
  api.emit(stopId, "op", { op: { opId: "s1", op: "replace", node: "b:acme:c19", text: "Documented the handoff and trained new coordinators.", flags: [], facts: [] } });
  api.holdForStop(stopId, [{ opId: "s2", op: "replace", node: "tool:Analytics", text: "SQL, Spreadsheets, Dashboards", flags: [], facts: [] }]);
  await expect(frame.locator('[data-scribe-id="s1"]')).toHaveCount(1);
  await desk.getByRole("button", { name: "Stop" }).click();
  await expect(log).toContainText("Stopped.");
  expect(posted(`/edits/${stopId}/stop`)).toHaveLength(1);
  await expect(rail.locator(".scribe__mm")).toHaveCount(2);
  await expect(note("s2"), "the stop reply's late op joins the review").toHaveCount(1);
  await expect(rail.getByRole("button", { name: /^Accept / })).toHaveCount(2);
  await desk.getByRole("button", { name: "Reject all" }).click();
  await desk.getByRole("button", { name: "Discard" }).click();
  await expect(log).toContainText("Nothing was saved.");
  expect(api.calls.some((c) => c.method === "DELETE" && c.path === `/edits/${stopId}`)).toBe(true);

  /* `c` opens Compare: previous and current side by side, read-only. */
  await focusDocument(desk);
  await page.keyboard.press("c");
  const compare = desk.getByRole("region", { name: /^Comparing resume v1 with v2\./ });
  await expect(compare).toBeVisible();
  await expect(compare.locator(".scribe__compare-item ins").first()).toBeVisible();
  await expect(compare).toContainText("reduced them");
  await expect(compare.getByRole("button", { name: /accept|reject/i })).toHaveCount(0);
  const [a, b] = await Promise.all([
    compare.locator(".scribe__compare-fig--a .scribe__compare-sheet").boundingBox(),
    compare.locator(".scribe__compare-fig--b .scribe__compare-sheet").boundingBox(),
  ]);
  expect(a.x + a.width, "A sits left of B at 1440").toBeLessThanOrEqual(b.x);
  await page.keyboard.press("c");
  await expect(desk.locator(".scribe__compare")).toBeHidden();

  /* Bring back appends; every version survives. */
  await desk.getByRole("tab", { name: "Versions" }).click();
  await desk.getByRole("button", { name: "Bring back v0 as a new version" }).click();
  await desk.getByRole("group", { name: "Bring back v0" }).getByRole("button", { name: "Bring back as v3" }).click();
  await expect(versions.getByRole("listitem")).toHaveCount(4);
  await expect(versions.getByRole("listitem").first()).toContainText("Restored from v0");
  for (const n of ["v2", "v1", "v0"]) await expect(versions).toContainText(n);
  expect(posted("/versions/run-00/restore")).toHaveLength(1);
  expect(api.runs.map((r) => r.runId)).toEqual(["run-00", "run-01", "run-02", "run-03"]);
  expect(api.calls.filter((c) => c.method === "DELETE" && !c.path.startsWith("/edits/")), "nothing is ever deleted").toEqual([]);
  await expect(frame.locator('[data-node="stmt"]')).toContainText("tracked fulfillment delays");

  /* Esc closes the desk and hands focus back to Edit. */
  await page.keyboard.press("Escape");
  await expect(page.locator("jb-scribe")).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(fence.unexpectedExternal).toEqual([]);
  expect(app.hostRequests).toEqual([]);
});
