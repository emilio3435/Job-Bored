/* global document, innerWidth, DataTransfer, ClipboardEvent */
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
import { startScribeRealService } from "../e2e-fixtures/scribe-real-service.mjs";
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
  await edit.click({ force: true });

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
  await expect(log).toContainText("Blocked: that would change a locked fact.");

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
  await desk.locator('[data-scribe="stop"]').click();
  await expect(log).toContainText("Stopped.");
  expect(posted(`/edits/${stopId}/stop`)).toHaveLength(1);
  await expect(rail.locator(".scribe__mm")).toHaveCount(2);
  await expect(note("s2"), "the stop reply's late op joins the review").toHaveCount(1);
  await expect(rail.getByRole("button", { name: /^Accept / })).toHaveCount(2);
  await desk.getByRole("button", { name: "Reject all" }).click();
  await desk.locator('[data-review="discard"]').click();
  await expect(log).toContainText("Discarded.");
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
  await expect(versions.getByRole("listitem").first()).toContainText("Brought back from v0");
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


const SCRP_OP = {
  resume: { opId: 'safe-edit', op: 'replace', node: 'b:acme:c14', text: 'Measured carrier delays through a weekly operations dashboard.', flags: [], facts: [] },
  cover_letter: { opId: 'safe-edit', op: 'replace', node: 'p:p3', text: 'I welcome a conversation about improving daily operations.', flags: [], facts: [] },
};
async function realDesk(page, which, options = {}) {
  const service = await startScribeRealService({ pdfSession: async () => null,
    propose: async () => ({ ops: [SCRP_OP[which]], blocked: [], summary: { changes: 1 }, factCheck: 'model' }), ...options });
  const pkg = await service.seed({ slug: 'acme-example', model: options.model });
  const calls = [];
  page.on('request', req => { if (req.url().startsWith(service.baseUrl)) calls.push({ method: req.method(), path: new URL(req.url()).pathname }); });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: 'load' });
  await page.evaluate(async () => { await globalThis.CommandCenterUserContent.completeInfraSetup(); await globalThis.CommandCenterUserContent.completeOnboarding(); });
  await page.reload({ waitUntil: "load" });
  await service.pointPage(page);
  const open = async (doc = which) => {
    await page.evaluate(({ slug, doc, base }) => globalThis.JB_SCRIBE_V2.open({ slug, doc, base }), { slug: pkg.slug, doc, base: service.baseUrl });
    await expect(page.locator('jb-scribe .scribe__docscroll')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.loading)).toBe(false);
  };
  await open();
  const desk = page.locator('jb-scribe'); const composer = desk.locator('textarea');
  const send = async (text = 'Shorten the wording using only existing facts.') => { await composer.fill(text); await composer.press('Enter'); };
  const ready = async () => { await expect(page.frameLocator('jb-scribe .scribe__frame').locator('[data-scribe-id]')).toHaveCount(1); await expect(desk.locator('[data-review="accept-all"]')).toBeVisible(); };
  return { service, pkg, fence, desk, composer, calls, open, send, ready, hostPathsAtOpen: fence.hostPathRequests.slice() };
}

for (const which of ['resume', 'cover_letter']) {
  for (const action of ['close', 'switch', 'resubmit']) {
    test(`SCRP-F21 ASTRA-01 ${which} ${action} recovers a real persisted proposal`, async ({ page }) => {
      const t = await realDesk(page, which);
      try {
        await t.send(); await t.ready();
        const id = await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.proposal.id);
        if (action === 'close') { await t.desk.getByRole('button', { name: 'Close Scribe' }).click(); await t.open(); await t.ready(); }
        if (action === 'switch') {
          await t.desk.getByRole('tab', { name: which === 'resume' ? 'Cover letter' : 'Resume', exact: true }).click();
          await expect(t.desk.locator('.scribe__recover')).toContainText('suggested changes waiting');
          await t.send('A second request'); await expect(t.composer).toHaveValue('A second request');
          await t.desk.locator('[data-action="review-request"]').click(); await t.ready();
        }
        if (action === 'resubmit') { await t.send('A second request'); await expect(t.composer).toHaveValue('A second request'); }
        expect(await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.proposal.id)).toBe(id);
        expect(t.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits'))).toHaveLength(1);
        expect(t.calls.filter(c => c.method === 'DELETE')).toHaveLength(0);
        const response = await fetch(`${t.service.baseUrl}${t.pkg.path}/edits/open`);
        const body = await response.json(); expect(body.proposal.proposalId).toBe(id); expect(body.proposal.status).toBe('ready');
        expect(body.proposal.doc).toBe(which === 'resume' ? 'resume' : 'coverLetter');
        expect(t.fence.unexpectedExternal).toEqual([]);
      } finally { await t.service.close(); }
    });
  }
  for (const action of ['Stop', 'close', 'switch', 'new editor']) {
    test(`SCRP-F22 ASTRA-02 ${which} deferred POST then ${action} stops the late ID`, async ({ page }) => {
      const t = await realDesk(page, which);
      try {
        const hold = t.service.deferStart(); await t.send(); await hold.entered;
        expect(await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.proposal.id)).toBe(null);
        if (action === 'Stop') { await t.desk.locator('[data-scribe="stop"]').click(); await expect(t.desk.locator('[data-scribe="stop"]')).toHaveText('Stopping…'); }
        if (action === 'close') await t.desk.getByRole('button', { name: 'Close Scribe' }).click();
        const sibling = which === 'resume' ? 'cover_letter' : 'resume';
        if (action === 'switch') await t.desk.getByRole('tab', { name: sibling === 'resume' ? 'Resume' : 'Cover letter', exact: true }).click();
        if (action === 'new editor') await t.open(sibling);
        hold.release();
        await expect.poll(() => t.calls.filter(c => c.path.endsWith('/stop')).length).toBe(1);
        await expect.poll(async () => (await (await fetch(`${t.service.baseUrl}${t.pkg.path}/edits/open`)).json()).proposal).toBe(null);
        expect(t.calls.filter(c => c.path.endsWith('/stream'))).toHaveLength(0);
        if (action === 'switch' || action === 'new editor') expect(await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.proposal)).toBe(null);
        if (action === 'Stop') await expect(t.desk.locator('.scribe__log')).toContainText('Stopped. No changes suggested.');
        expect(t.fence.unexpectedExternal).toEqual([]);
      } finally { await t.service.close(); }
    });
  }
  test(`SCRP-F23 ASTRA-01 ${which} failed discard retains controls`, async ({ page }) => {
    const t = await realDesk(page, which);
    try {
      await t.send(); await t.ready();
      await page.route(`${t.service.baseUrl}/**/edits/*`, route => route.request().method() === 'DELETE' ? route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Try again.', code: 'unavailable' }) }) : route.fallback());
      await t.desk.locator('[data-review="discard"]').click();
      await expect(t.desk.locator('.scribe__status')).toContainText('The suggested changes are still open.');
      await expect(t.desk.locator('[data-review="discard"]')).toBeVisible();
      await expect(t.desk.locator('[data-review="accept-all"]')).toBeVisible();
      expect((await (await fetch(`${t.service.baseUrl}${t.pkg.path}/edits/open`)).json()).proposal.status).toBe('ready');
    } finally { await t.service.close(); }
  });
  test(`SCRP-F24 ASTRA-03 ${which} real committed 503 saves text exactly once`, async ({ page }) => {
    const t = await realDesk(page, which);
    try {
      await page.evaluate(() => { globalThis.__scrpSaved = []; globalThis.addEventListener('jb:scribe:saved', e => globalThis.__scrpSaved.push(e.detail)); });
      await t.send(); await t.ready();
      await t.desk.locator('[data-review="accept-all"]').click(); await t.desk.locator('[data-review="save"]').click();
      await expect(t.desk.locator('.scribe__status')).toContainText('Text saved as v1. PDF unavailable — it’s rebuilt on your next save.');
      await expect(t.desk.locator('[data-review="save"]')).toHaveCount(0);
      await expect(t.desk.locator('.scribe__status-action')).toBeHidden();
      await expect(page.frameLocator('jb-scribe .scribe__frame').locator(`[data-node="${SCRP_OP[which].node}"]`)).toHaveText(SCRP_OP[which].text);
      expect(await page.evaluate(() => globalThis.__scrpSaved.length)).toBe(1);
      expect(t.calls.filter(c => c.path.endsWith('/accept'))).toHaveLength(1);
      const listing = await (await fetch(`${t.service.baseUrl}${t.pkg.path}/versions?doc=${which}`)).json();
      expect(listing.versions).toHaveLength(2); expect(listing.versions[0].n).toBe(1);
      const sibling = which === 'resume' ? 'coverLetter' : 'resume';
      const siblingListing = await (await fetch(`${t.service.baseUrl}${t.pkg.path}/versions?doc=${sibling}`)).json();
      const model = await (await fetch(`${t.service.baseUrl}${t.pkg.path}/versions/${siblingListing.currentRunId}/model`)).json();
      expect(model.model.documents[sibling]).toEqual(t.pkg.model.documents[sibling]);
      expect(siblingListing.versions).toHaveLength(1);
    } finally { await t.service.close(); }
  });
  test(`SCRP-F25 ASTRA-03 ${which} ordinary 503 stays unsaved and retryable`, async ({ page }) => {
    const t = await realDesk(page, which);
    try {
      await t.send(); await t.ready();
      await page.route(`${t.service.baseUrl}/**/accept`, route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unavailable.', code: 'provider_failed' }) }));
      await t.desk.locator('[data-review="accept-all"]').click(); await t.desk.locator('[data-review="save"]').click();
      await expect(t.desk.locator('.scribe__status')).toContainText('The AI provider didn’t respond. Your document is unchanged.');
      await expect(t.desk.locator('[data-review="save"]')).toBeVisible();
      const listing = await (await fetch(`${t.service.baseUrl}${t.pkg.path}/versions?doc=${which}`)).json(); expect(listing.versions).toHaveLength(1);
    } finally { await t.service.close(); }
  });
}

async function selectBlocks(page, ids, substring = false) {
  await page.evaluate(({ ids, substring }) => {
    const inner = document.querySelector('jb-scribe .scribe__frame').contentDocument;
    const els = ids.map(id => [...inner.querySelectorAll('[data-node]')].find(el => el.dataset.node === id));
    const range = inner.createRange();
    range.setStart(els[0].firstChild, substring ? 2 : 0);
    range.setEnd(els[els.length - 1].lastChild, substring ? 6 : els[els.length - 1].lastChild.textContent.length);
    const selection = inner.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    inner.dispatchEvent(new Event('selectionchange'));
  }, { ids, substring });
}
async function leaveBlock(page) {
  await page.evaluate(() => { const ctl = globalThis.JB_SCRIBE_V2.current(); if (ctl.isNarrow()) ctl.setSeg('chat'); ctl.refs.prompt.focus(); });
}
async function typeBlock(page, id, text) {
  await page.evaluate(() => { const ctl = globalThis.JB_SCRIBE_V2.current(); if (ctl.isNarrow()) ctl.setSeg('doc'); });
  const el = page.frameLocator('jb-scribe .scribe__frame').locator(`[data-node="${id}"]`);
  await el.dblclick(); await expect(el).toHaveAttribute('contenteditable', 'plaintext-only');
  await el.fill(text);
  await leaveBlock(page);
  return el;
}
test('SCRP-F815 UX-FE-1 Dossier resume 375 preserves bullet layout during edit, retained blur/error and restored spans', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const h = await realDesk(page, 'resume', { model: MODEL });
  try {
    const frame = page.frameLocator('jb-scribe .scribe__frame');
    await expect(frame.locator('.sheet')).toHaveAttribute('data-family', 'dossier');
    const bullet = frame.locator('[data-node="b:acme:c14"]');
    const text = SCRP_OP.resume.text;
    const layout = () => bullet.evaluate(el => {
      const inner = el.ownerDocument;
      const style = inner.defaultView.getComputedStyle(el);
      const row = el.getBoundingClientRect();
      const spans = [...el.children].filter(child => child.tagName === 'SPAN');
      const range = inner.createRange(); range.selectNodeContents(spans.length ? spans[spans.length - 1] : el);
      return {
        spans: spans.length,
        rowWidth: row.width,
        textWidth: range.getBoundingClientRect().width,
        lines: parseFloat(style.height) / parseFloat(style.lineHeight),
        spanWidths: spans.map(span => span.getBoundingClientRect().width),
      };
    });
    const rendered = async () => {
      const box = await layout();
      expect(box.spans).toBe(2);
      expect(box.spanWidths[0]).toBeLessThan(box.rowWidth * 0.2);
      expect(box.spanWidths[1]).toBeGreaterThan(box.rowWidth * 0.75);
    };
    const plain = async () => {
      const box = await layout();
      expect(box.spans).toBe(0);
      expect(box.textWidth, 'plain bullet text must use the row rather than the ledger gutter').toBeGreaterThan(box.rowWidth * 0.6);
      expect(box.lines, 'a short bullet must not wrap into a tall gutter column').toBeLessThan(3);
      await expect(bullet).toHaveText(text);
    };
    const capture = state => h.desk.screenshot({ path: test.info().outputPath(`ux-fe-1-${state}.png`) });
    await rendered(); await capture('rendered');
    await bullet.dblclick(); await expect(bullet).toHaveAttribute('contenteditable', 'plaintext-only');
    await bullet.fill(text);
    await plain(); await capture('editing');
    await page.route(`${h.service.baseUrl}${h.pkg.path}/edits/manual`, route => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Example save failed.', code: 'fixture_failure' }),
    }), { times: 1 });
    await page.keyboard.press('Tab');
    await h.desk.locator('button[data-seg="doc"]').click();
    await expect(bullet).not.toHaveAttribute('data-scribe-editing');
    await plain(); await capture('blurred');
    await expect(h.desk.locator('.scribe__manual-state')).toContainText('Not saved. Your text is kept.', { timeout: 15000 });
    await plain(); await capture('error-kept');
    expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=resume`)).json()).versions).toHaveLength(1);
    await h.desk.locator('[data-manual="retry"]').click();
    await expect(h.desk.locator('.scribe__manual-state')).toContainText('Text saved as v1.', { timeout: 15000 });
    await expect(h.desk.locator('.scribe__docscroll')).toHaveAttribute('aria-busy', 'false');
    await expect(bullet).toHaveText(text);
    await rendered(); await capture('restored');
    expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=resume`)).json()).versions).toHaveLength(2);
    expect(h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual'))).toHaveLength(2);
    expect(h.fence.unexpectedExternal).toEqual([]); expect(h.fence.hostPathRequests).toEqual(h.hostPathsAtOpen);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await h.service.close(); }
});
for (const which of ['resume', 'cover_letter']) {
  for (const width of [1440, 375]) {
    test(`SCRP-F43 GAP-02 ${which} ${width} substring, multi-block, keyboard, payload and stale refusal`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const h = await realDesk(page, which);
      try {
        const id = which === 'resume' ? 'b:acme:c14' : 'p:p3';
        const multi = which === 'resume' ? ['b:acme:c14', 'b:acme:c19'] : ['p:p2', 'p:p3'];
        await selectBlocks(page, multi); await expect(h.desk.locator('.scribe__scope')).toContainText('Selected: 2 blocks');
        await selectBlocks(page, [id], true);
        const toolbar = h.desk.locator('.scribe__selection-actions'); await expect(toolbar).toBeVisible();
        const buttons = toolbar.locator('button');
        await page.frameLocator('jb-scribe .scribe__frame').locator(`[data-node="${id}"]`).focus(); await page.keyboard.press('Tab'); await expect(buttons.first()).toBeFocused();
        await page.keyboard.press('Shift+Tab'); await expect(buttons.last()).toBeFocused();
        await page.keyboard.press('Tab'); await expect(buttons.first()).toBeFocused();
        await page.keyboard.press('Escape'); await expect(toolbar).toBeHidden();
        await expect(page.frameLocator('jb-scribe .scribe__frame').locator(`[data-node="${id}"]`)).toBeFocused();
        await selectBlocks(page, [id], true);
        if (width === 375) for (const box of await buttons.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()))) expect(box.height).toBeGreaterThanOrEqual(44);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const restored = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/r0/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
        expect(restored.run.runId).toBeTruthy();
        const sibling = which === 'resume' ? 'cover_letter' : 'resume';
        await page.evaluate(doc => globalThis.JB_SCRIBE_V2.current().setDoc(doc), sibling);
        await page.evaluate(doc => globalThis.JB_SCRIBE_V2.current().setDoc(doc), which);
        await expect(h.desk.locator('.scribe__docscroll')).toHaveAttribute('aria-busy', 'false');
        expect(await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.currentRunId)).toBe(restored.run.runId);
        if (width === 375) await h.desk.locator('[data-seg="chat"]').click();
        await h.send(); await expect(h.desk.locator('.scribe__status')).toContainText('Your selection changed. Select the text again.');
        expect(h.calls.filter(c => c.method === 'POST' && /\/edits$/.test(c.path))).toHaveLength(0);
        if (width === 375) await h.desk.locator('button[data-seg="doc"]').click();
        await selectBlocks(page, [id], true); await toolbar.locator('[data-selection="shorten"]').click();
        const request = page.waitForRequest(req => req.method() === 'POST' && /\/edits$/.test(new URL(req.url()).pathname));
        await h.composer.press('Enter'); expect((await request).postDataJSON().scope).toEqual([id]);
        await h.ready();
        await h.desk.locator('[data-review="reject-all"]').click();
        await h.desk.locator('[data-review="discard"]').click();
        await expect.poll(() => page.evaluate(() => { const ctl = globalThis.JB_SCRIBE_V2.current(); return !ctl.discarding && !ctl.state.loading && !ctl.state.proposal && !ctl.openProposal && !ctl.request; })).toBe(true);
        await expect(h.desk.locator('.scribe__docscroll')).toHaveAttribute('aria-busy', 'false');
        await selectBlocks(page, multi);
        if (width === 375) await h.desk.locator('.scribe__selection-actions [data-selection="shorten"]').click();
        const multiRequest = page.waitForRequest(req => req.method() === 'POST' && /\/edits$/.test(new URL(req.url()).pathname));
        await h.send(); expect((await multiRequest).postDataJSON().scope).toEqual(multi); await h.ready();
        const current = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/r0/model`)).json(); expect(current.model).toEqual(h.pkg.model);
        expect(h.fence.unexpectedExternal).toEqual([]); expect(h.fence.hostPathRequests).toEqual(h.hostPathsAtOpen);
      } finally { await h.service.close(); }
    });
    test(`SCRP-F44 GAP-01 ${which} ${width} one debounced manual version keeps v0 and sibling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const h = await realDesk(page, which);
      try {
        const id = which === 'resume' ? 'line:beta' : 'p:p3';
        const text = which === 'resume' ? 'Tracked daily shipments.' : 'I welcome a conversation about improving daily operations.';
        const before = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/r0/model`)).json();
        const requests = []; page.on('request', req => { if (req.method() === 'POST' && /\/edits\/manual$/.test(new URL(req.url()).pathname)) requests.push(req.postDataJSON()); });
        await typeBlock(page, id, text);
        if (width === 375) await h.desk.locator('button[data-seg="doc"]').click();
        expect(requests).toHaveLength(0);
        await expect(h.desk.locator('.scribe__manual-state')).toContainText('Text saved as v1.', { timeout: 15000 });
        await expect(h.desk.locator('.scribe__status')).toContainText('Text saved as v1. PDF unavailable — it’s rebuilt on your next save.');
        expect(requests).toHaveLength(1); expect(requests[0].manualOps).toHaveLength(1); expect(requests[0].manualOps[0]).toMatchObject({ op: 'replace', node: id, text });
        const listing = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json();
        expect(listing.versions).toHaveLength(2); expect(listing.versions.some(v => v.runId === 'r0')).toBe(true);
        const after = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/${listing.currentRunId}/model`)).json();
        const sibling = which === 'resume' ? 'coverLetter' : 'resume';
        const siblingListing = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${sibling}`)).json();
        const siblingModel = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/${siblingListing.currentRunId}/model`)).json();
        expect(siblingModel.model.documents[sibling]).toEqual(before.model.documents[sibling]); expect(siblingListing.versions).toHaveLength(1);
        expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/r0/model`)).json()).model).toEqual(before.model);
        expect(deriveNodes(after.model).find(n => n.id === id).text).toBe(text);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally { await h.service.close(); }
    });
    test(`SCRP-F45 GAP-01 ${which} ${width} metric refusal, plain paste, confirm, conflict and unsaved choices`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const h = await realDesk(page, which);
      try {
        const frame = page.frameLocator('jb-scribe .scribe__frame');
        const metric = which === 'resume' ? 'stmt' : 'p:p2';
        for (const locked of which === 'resume' ? ['seat:acme', 'cred:education', metric] : [metric]) {
          if (width === 375) await h.desk.locator('button[data-seg="doc"]').click();
          const block = frame.locator(`[data-node="${locked}"]`), original = await block.textContent();
          await block.dblclick();
          await expect(block).not.toHaveAttribute('contenteditable', 'plaintext-only');
          await expect(h.desk.locator('.scribe__status')).toHaveText(locked === 'seat:acme' ? 'Employer, title and dates are locked.' : locked === 'cred:education' ? 'Degree and school are locked.' : 'This line has locked figures. Ask Scribe to change it.');
          if (locked === metric) await expect(h.composer).toBeFocused();
          else { await expect(block).toBeFocused(); await expect(h.composer).not.toBeFocused(); }
          await expect(block).toHaveText(original);
          expect(h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual'))).toHaveLength(0);
        }
        if (width === 375) await h.desk.locator('button[data-seg="doc"]').click();
        const id = which === 'resume' ? 'line:beta' : 'p:p3'; const target = frame.locator(`[data-node="${id}"]`);
        await target.dblclick();
        await target.evaluate(node => {
          const inner = node.ownerDocument, range = inner.createRange(); range.selectNodeContents(node); inner.getSelection().removeAllRanges(); inner.getSelection().addRange(range);
          const data = new DataTransfer(); data.setData('text/html', '<b>Tracked Contoso operations.</b>'); data.setData('text/plain', 'Tracked Contoso operations.');
          node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        });
        await expect(target).toHaveText('Tracked Contoso operations.'); expect(await target.locator('b').count()).toBe(0);
        await leaveBlock(page);
        await expect(h.desk.locator('.scribe__manual-state')).toContainText('Some of this text isn’t in your saved facts:', { timeout: 15000 });
        await expect(h.desk.locator('.scribe__manual-state')).toContainText('“Tracked Contoso operations.”');
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json()).versions).toHaveLength(1);
        const newer = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/r0/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json(); expect(newer.run.runId).toBeTruthy();
        if (width === 375) await h.desk.locator('button[data-seg="doc"]').click();
        await h.desk.locator('[data-manual="confirm"]').click();
        await expect(h.desk.locator('.scribe__manual-state')).toContainText('A newer version exists. Your text is kept.'); await expect(target).toHaveText('Tracked Contoso operations.');
        await h.desk.locator('[data-manual="review"]').click(); await expect(h.desk.locator('.scribe__compare')).toBeVisible();
        expect(await h.desk.locator('.scribe__compare-frame').evaluateAll(els => els.every(f => !f.contentDocument.querySelector('[contenteditable]')))).toBe(true);
        await h.desk.locator('[data-cmp-act="exit"]').click();
        await h.desk.locator('[data-manual="reapply"]').click();
        await expect(h.desk.locator('[data-manual="save"]')).toBeVisible();
        await h.desk.locator('[data-manual="save"]').click();
        await expect(h.desk.locator('[data-manual="confirm"]')).toBeVisible(); await h.desk.locator('[data-manual="confirm"]').click();
        await expect(h.desk.locator('.scribe__manual-state')).toContainText('Text saved as v2.', { timeout: 15000 });
        await typeBlock(page, id, which === 'resume' ? 'Tracked operations.' : 'I welcome a conversation.');
        await h.desk.locator('[data-scribe="close"]').click(); await expect(h.desk.locator('.scribe__unsaved')).toBeVisible();
        await h.desk.locator('[data-unsaved="stay"]').click(); await expect(h.desk).toBeVisible();
        await h.desk.locator('[data-scribe="close"]').click(); await h.desk.locator('[data-unsaved="discard"]').click(); await expect(h.desk).toHaveCount(0);
        expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json()).versions).toHaveLength(3);
      } finally { await h.service.close(); }
    });
  }
  test(`SCRP-F46 GAP-02 ${which} server rejects unselected and sibling ops without a save`, async ({ page }) => {
    const id = which === 'resume' ? 'b:acme:c14' : 'p:p3';
    const h = await realDesk(page, which, { propose: async () => ({ ops: [
      { opId: 'outside', op: 'replace', node: which === 'resume' ? 'line:beta' : 'p:p1', text: 'Tracked operations.' },
      { opId: 'sibling', op: 'replace', node: which === 'resume' ? 'p:p3' : 'line:beta', text: 'Tracked operations.' },
    ], blocked: [], summary: { changes: 2 } }) });
    try {
      await selectBlocks(page, [id]); await h.send();
      await expect.poll(() => page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.busy)).toBe(false);
      const proposalId = await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.proposal.id);
      for (const opId of ['outside', 'sibling']) {
        const response = await fetch(`${h.service.baseUrl}${h.pkg.path}/edits/${proposalId}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept: [opId], confirmUnverified: [] }) });
        expect(response.status).toBe(400); expect((await response.json()).code).toBe('out_of_scope');
      }
      expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json()).versions).toHaveLength(1);
      expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/r0/model`)).json()).model).toEqual(h.pkg.model);
    } finally { await h.service.close(); }
  });
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F56 SCRP-F92 R4-#3 ${which} pending sibling recovery retains the manual draft and gates Continue`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 1000 });
    const h = await realDesk(page, which); const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      const id = which === 'resume' ? 'line:beta' : 'p:p3';
      const text = which === 'resume' ? 'Tracked daily shipments.' : 'I welcome a conversation about improving daily operations.';
      await typeBlock(page, id, text);
      const sibling = which === 'resume' ? 'cover_letter' : 'resume';
      const response = await fetch(`${h.service.baseUrl}${h.pkg.path}/edits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: sibling, baseRunId: 'r0', instruction: 'Shorten existing wording.', scope: 'all', lockFacts: true }) });
      expect(response.status).toBe(202);
      const openBeforeFailure = h.calls.filter(c => c.method === 'GET' && c.path.endsWith('/edits/open')).length;
      await expect(h.desk.locator('[data-action="continue-request"]')).toBeVisible({ timeout: 15000 });
      expect(h.calls.filter(c => c.method === 'GET' && c.path.endsWith('/edits/open'))).toHaveLength(openBeforeFailure + 1);
      await h.desk.locator('[data-action="continue-request"]').click(); await expect(h.desk.locator('.scribe__unsaved')).toBeVisible();
      await h.desk.locator('[data-unsaved="stay"]').click(); expect(errors).toEqual([]);
      await expect(h.desk.locator('.scribe__manual-state')).toContainText('Review or discard the open changes first.');
      await page.waitForTimeout(2200);
      await h.desk.locator('[data-seg="doc"]').click();
      await expect(h.desk.locator('[data-manual="retry"]')).toBeVisible();
      await h.desk.locator('[data-seg="chat"]').click();
      expect(await page.evaluate(id => globalThis.JB_SCRIBE_V2.current().manual.drafts[id].text, id)).toBe(text);
      expect(await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().state.doc)).toBe(which);
      await h.desk.locator('[data-action="discard-request"]').click();
      await expect.poll(() => page.evaluate(() => { const ctl = globalThis.JB_SCRIBE_V2.current(); return !ctl.discarding && !ctl.openProposal; })).toBe(true);
      await h.desk.locator('[data-seg="doc"]').click();
      // R4-#3 clearing the gate re-arms the save even after Stay has waited longer than the debounce.
      await expect(h.desk.locator('.scribe__manual-state')).toContainText('Text saved as v1.', { timeout: 15000 });
      expect(h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual'))).toHaveLength(2);
      expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json()).versions).toHaveLength(2);
      expect(errors).toEqual([]);
    } finally { await h.service.close(); }
  });
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F27 R1 #10 ${which} real-service locked fact uses fixed blocked copy`, async ({ page }) => {
    const op = which === 'resume'
      ? { opId: 'locked', op: 'replace', node: 'seat:acme', text: 'Invented title' }
      : { opId: 'locked', op: 'replace', node: 'p:p2', text: 'Reduced carrier delays by 40%.' };
    const h = await realDesk(page, which, { propose: async () => ({ ops: [], blocked: [{ op, reason: 'locked', detail: '38%' }], summary: { changes: 0 } }) });
    try {
      await h.send();
      await expect(h.desk.locator('.scribe__msg--blocked')).toHaveText('Blocked: that would change a locked fact.');
      expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json()).versions).toHaveLength(1);
      await expect(h.desk.locator('[data-review="save"]')).toHaveCount(0);
    } finally { await h.service.close(); }
  });
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F58 ${which} phone recovery Review reveals the document`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 1000 });
    const h = await realDesk(page, which);
    try {
      await h.desk.locator('[data-seg="chat"]').click();
      await h.send(); await h.ready();
      const newer = await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/r0/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: which }) });
      const restored = await newer.json(); expect(restored.run.runId).toBeTruthy();
      if (newer.status === 503) expect(restored.run.pdf).toBe('stale');
      await page.evaluate(async doc => { const ctl = globalThis.JB_SCRIBE_V2.current(); await ctl.setDoc(doc === 'resume' ? 'cover_letter' : 'resume'); await ctl.setDoc(doc); }, which);
      await h.desk.locator('[data-seg="chat"]').click();
      await expect(h.desk.locator('[data-action="review-request"]')).toBeVisible();
      await h.desk.locator('[data-action="review-request"]').click();
      await expect(h.desk.locator('.scribe__docpane')).toBeVisible();
      await expect(h.desk.locator('button[data-seg="doc"]')).toHaveAttribute('aria-selected', 'true');
      expect(h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits'))).toHaveLength(1);
    } finally { await h.service.close(); }
  });
}

async function keyboardBlock(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('jb-scribe .scribe__frame');
    return document.activeElement === frame ? frame.contentDocument.activeElement?.getAttribute('data-node') : null;
  });
}
async function tabToBlock(page) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await keyboardBlock(page)) return;
  }
  expect(await keyboardBlock(page), 'Tab must reach the document without injected focus').toBeTruthy();
}
async function arrowToBlock(page, id, count) {
  for (let i = 0; i < count; i++) {
    if (await keyboardBlock(page) === id) return;
    await page.keyboard.press('ArrowDown');
  }
  expect(await keyboardBlock(page)).toBe(id);
}
async function keyboardEditBlock(page, desk) {
  await page.keyboard.press('Enter');
  const toolbar = desk.locator('.scribe__selection-actions'); await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('button').first()).toBeFocused();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  await expect(toolbar.locator('[data-selection="edit"]')).toBeFocused(); await page.keyboard.press('Enter');
}
for (const which of ['resume', 'cover_letter']) for (const width of [1440, 375]) {
  test(`SCRP-F814 KBD-01 ${which} ${width} keyboard-only blocks, locks, manual save and Escape`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
    const h = await realDesk(page, which);
    try {
      const frame = page.frameLocator('jb-scribe .scribe__frame');
      const blocks = await frame.locator('[data-node]').evaluateAll(els => els.map(el => ({ id: el.dataset.node, label: el.getAttribute('aria-label') })));
      await tabToBlock(page);
      const reached = [];
      for (let i = 0; i < blocks.length; i++) {
        reached.push(await keyboardBlock(page));
        await expect(frame.locator('[data-node][tabindex="0"]')).toHaveCount(1);
        await page.keyboard.press('ArrowDown');
      }
      expect(reached).toEqual(blocks.map(b => b.id));
      for (const block of blocks) expect(block.label).toMatch(/, (locked|editable)$/);
      expect(await frame.locator('[data-node][tabindex="0"]').evaluate(el => el.ownerDocument.defaultView.getComputedStyle(el).outlineStyle)).toBe('solid');
      const current = await keyboardBlock(page); await page.keyboard.press('j'); await page.keyboard.press('k'); expect(await keyboardBlock(page)).toBe(current);
      await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown'); expect(await keyboardBlock(page)).toBe(current);
      if (which === 'resume') {
        await arrowToBlock(page, 'seat:acme', blocks.length);
        await expect(frame.locator('[data-node="seat:acme"]')).toHaveAttribute('aria-label', /, locked$/);
        await page.keyboard.press('Enter'); await expect(h.desk.locator('.scribe__status')).toHaveText('Employer, title and dates are locked.');
        await expect(frame.locator('[data-node="seat:acme"]')).toBeFocused();
        await expect(h.composer).not.toBeFocused();
        await expect(frame.locator('[data-node="seat:acme"]')).not.toHaveAttribute('contenteditable', 'plaintext-only');
      }
      // D29 announces metric blocks as locked and directs keyboard editing to Scribe.
      const metric = which === 'resume' ? 'stmt' : 'p:p2';
      await arrowToBlock(page, metric, blocks.length);
      await expect(frame.locator(`[data-node="${metric}"]`)).toHaveAttribute('aria-label', /, locked$/);
      await page.keyboard.press('F2');
      await expect(h.desk.locator('.scribe__status')).toHaveText('This line has locked figures. Ask Scribe to change it.');
      await expect(h.composer).toBeFocused();
      await expect(frame.locator(`[data-node="${metric}"]`)).not.toHaveAttribute('contenteditable', 'plaintext-only');
      expect(h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual'))).toHaveLength(0);
      if (width === 375) await h.desk.locator('button[data-seg="doc"]').click();
      await tabToBlock(page);
      const id = which === 'resume' ? 'line:beta' : 'p:p3';
      await arrowToBlock(page, id, blocks.length);
      await page.keyboard.press('Space'); await expect(h.desk.locator('.scribe__selection-actions button').first()).toBeFocused();
      await page.keyboard.press('Escape'); await expect(frame.locator(`[data-node="${id}"]`)).toBeFocused();
      await keyboardEditBlock(page, h.desk);
      await expect(frame.locator(`[data-node="${id}"]`)).toHaveAttribute('contenteditable', 'plaintext-only');
      const text = which === 'resume' ? 'Tracked daily shipments.' : 'I welcome a conversation about improving daily operations.';
      await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(text); await page.keyboard.press('Tab');
      await expect(h.desk.locator('.scribe__manual-state')).toContainText('Text saved as v1.', { timeout: 15000 });
      expect(h.calls.filter(c => c.method === 'POST' && /\/edits\/manual$/.test(c.path))).toHaveLength(1);
      const listing = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json();
      expect(listing.versions).toHaveLength(2);
      const saved = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions/${listing.currentRunId}/model`)).json();
      expect(deriveNodes(saved.model).find(n => n.id === id).text).toBe(text);
      const sibling = which === 'resume' ? 'coverLetter' : 'resume';
      const siblingListing = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${sibling}`)).json();
      expect(siblingListing.versions).toHaveLength(1);
      expect(h.fence.unexpectedExternal).toEqual([]);
      await expect(h.desk.locator('.scribe__frame')).toHaveAttribute('sandbox', 'allow-same-origin');
      expect(await frame.locator('script').count()).toBe(0);
    } finally { await h.service.close(); }
  });
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F104 R5-#4 ${which} real recovery does not save under an unanswered navigation prompt`, async ({ page }) => {
    const h = await realDesk(page, which);
    try {
      const id = which === 'resume' ? 'line:beta' : 'p:p3';
      await typeBlock(page, id, which === 'resume' ? 'Tracked daily shipments.' : 'I welcome a conversation about improving daily operations.');
      const sibling = which === 'resume' ? 'cover_letter' : 'resume';
      const response = await fetch(`${h.service.baseUrl}${h.pkg.path}/edits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: sibling, baseRunId: 'r0', instruction: 'Shorten existing wording.', scope: 'all', lockFacts: true }) });
      expect(response.status).toBe(202);
      await expect(h.desk.locator('[data-action="continue-request"]')).toBeVisible({ timeout: 15000 });
      await h.desk.getByRole('tab', { name: sibling === 'resume' ? 'Resume' : 'Cover letter', exact: true }).click();
      await expect(h.desk.locator('.scribe__unsaved')).toBeVisible();
      await h.desk.locator('[data-action="discard-request"]').click();
      await expect.poll(() => page.evaluate(() => !globalThis.JB_SCRIBE_V2.current().openProposal)).toBe(true);
      await page.waitForTimeout(2300);
      expect(h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual'))).toHaveLength(1);
      await expect(h.desk.locator('.scribe__unsaved')).toBeVisible();
      await expect(h.desk.locator('.scribe__manual-state')).toHaveText('Your text is kept.');
      await h.desk.locator('[data-unsaved="discard"]').click();
      expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json()).versions).toHaveLength(1);
      expect(h.fence.unexpectedExternal).toEqual([]);
    } finally { await h.service.close(); }
  });
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F105 R5-#5 ${which} a running materials request has truthful manual retry copy`, async ({ page }) => {
    const h = await realDesk(page, which);
    try {
      const pending = route => route.fulfill({ status: 409, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ code: 'materials_pending', error: 'Role is busy.' }) });
      await page.route(`${h.service.baseUrl}${h.pkg.path}/edits/manual`, pending);
      await page.route(`${h.service.baseUrl}${h.pkg.path}/edits/open`, pending);
      const id = which === 'resume' ? 'line:beta' : 'p:p3';
      const text = which === 'resume' ? 'Tracked daily shipments.' : 'I welcome a conversation about improving daily operations.';
      await typeBlock(page, id, text);
      await expect(h.desk.locator('.scribe__manual-state')).toHaveText('Not saved. Your text is kept.Try again', { timeout: 15000 });
      await expect(h.desk.locator('.scribe__recover')).toBeHidden();
      await h.desk.locator('[data-manual="retry"]').click();
      await expect.poll(() => h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual')).length).toBe(2);
      await expect(h.desk.locator('.scribe__manual-state')).toHaveText('Not saved. Your text is kept.Try again');
      expect(await page.evaluate(id => globalThis.JB_SCRIBE_V2.current().manual.drafts[id].text, id)).toBe(text);
      expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json()).versions).toHaveLength(1);
      expect(h.fence.unexpectedExternal).toEqual([]);
    } finally { await h.service.close(); }
  });
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F106 R5-#6 ${which} a hung pending claim stops automatically and exposes Try again`, async ({ page }) => {
    const h = await realDesk(page, which);
    try {
      await page.route(`${h.service.baseUrl}${h.pkg.path}/edits/manual`, route => route.fulfill({ status: 409, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ code: 'materials_pending', error: 'Role is busy.' }) }));
      const openReadsBefore = h.calls.filter(c => c.method === 'GET' && c.path.endsWith('/edits/open')).length;
      const id = which === 'resume' ? 'line:beta' : 'p:p3';
      await typeBlock(page, id, which === 'resume' ? 'Tracked daily shipments.' : 'I welcome a conversation about improving daily operations.');
      await page.waitForTimeout(11500);
      expect(h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual'))).toHaveLength(4);
      expect(h.calls.filter(c => c.method === 'GET' && c.path.endsWith('/edits/open'))).toHaveLength(openReadsBefore + 4);
      await expect(h.desk.locator('.scribe__manual-state')).toHaveText('Not saved. Your text is kept.Try again');
      await expect(h.desk.locator('.scribe__recover')).toBeHidden();
      expect(await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().manual.timer)).toBeNull();
      await h.desk.locator('[data-manual="retry"]').click();
      await expect.poll(() => h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual')).length).toBe(5);
      expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json()).versions).toHaveLength(1);
      expect(h.fence.unexpectedExternal).toEqual([]);
    } finally { await h.service.close(); }
  });
}

for (const which of ['resume', 'cover_letter']) for (const [style, base] of [['asterisk', 'Cut defects 38%* across teams.'], ['backtick', 'Hit `38%` across teams.']]) {
  test(`SCRP-F107 D29 ${which} ${style} metric markup cannot enter manual editing`, async ({ page }) => {
      const model = structuredClone(MODEL);
      const id = which === 'resume' ? 'b:acme:c14' : 'p:p2';
      if (which === 'resume') {
        const at = base.indexOf('38%');
        model.documents.resume.sections.find(s => s.kind === 'experience').entries[0].bullets[0].runs = [{ t: base.slice(0, at) }, { n: '38%' }, { t: base.slice(at + 3) }];
      } else model.documents.coverLetter.paragraphs[1].text = base;
      const h = await realDesk(page, which, { model });
      try {
        const block = page.frameLocator('jb-scribe .scribe__frame').locator(`[data-node="${id}"]`);
        await block.dblclick();
        await expect(block).not.toHaveAttribute('contenteditable', 'plaintext-only');
        await expect(h.desk.locator('.scribe__status')).toHaveText('This line has locked figures. Ask Scribe to change it.');
        await expect(h.composer).toBeFocused(); await expect(block).toHaveText(base);
        const saved = await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json();
        expect(saved.versions).toHaveLength(1);
        expect(h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual'))).toHaveLength(0);
        expect(h.fence.unexpectedExternal).toEqual([]);
      } finally { await h.service.close(); }
  });
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F116 R6-#7 ${which} 375px Chat and Versions expose scheduled Save and exhausted Try again`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const h = await realDesk(page, which);
    try {
      await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
      await page.route(`${h.service.baseUrl}${h.pkg.path}/edits/manual`, route => route.fulfill({ status: 409, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ code: 'materials_pending', error: 'Role is busy.' }) }));
      const id = which === 'resume' ? 'line:beta' : 'p:p3';
      const text = which === 'resume' ? 'Tracked daily shipments.' : 'I welcome a conversation about improving daily operations.';
      await typeBlock(page, id, text); await page.clock.fastForward(2000);
      await expect(h.desk.locator('.scribe__manual-state')).toHaveText('Your text is kept. Saves in 2 seconds.Save');
      const visibleAction = async action => {
        for (const seg of ['chat', 'versions']) {
          await h.desk.locator(`button[data-seg="${seg}"]`).click();
          await expect(h.desk.locator('.scribe__stage')).toBeVisible();
          const button = h.desk.locator(`[data-manual="${action}"]`);
          await expect(button).toBeVisible(); await expect(button).toBeEnabled();
          const box = await button.boundingBox(); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(667);
          await button.focus(); await expect(button).toBeFocused();
          await expect(h.desk.locator('.scribe__docscroll')).toBeHidden();
        }
      };
      await visibleAction('save');
      for (let attempts = 2; attempts <= 4; attempts++) {
        await page.clock.fastForward(2000);
        await expect.poll(() => h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual')).length).toBe(attempts);
        await expect.poll(() => page.evaluate(() => globalThis.JB_SCRIBE_V2.current().manual.saving)).toBe(false);
      }
      await expect(h.desk.locator('.scribe__manual-state')).toHaveText('Not saved. Your text is kept.Try again');
      await visibleAction('retry');
      expect(await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().manual.timer)).toBeNull();
      await h.desk.locator('[data-manual="retry"]').click();
      await expect.poll(() => h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual')).length).toBe(5);
      expect(await page.evaluate(id => globalThis.JB_SCRIBE_V2.current().manual.drafts[id].text, id)).toBe(text);
      expect(h.fence.unexpectedExternal).toEqual([]);
      await expect(h.desk.locator('.scribe__frame')).toHaveAttribute('sandbox', 'allow-same-origin');
    } finally { await h.service.close(); }
  });
}

for (const which of ['resume', 'cover_letter']) for (const entry of ['double-click', 'Edit text', 'keyboard']) {
  test(`SCRP-F121 D29 ${which} real-service metric block denies ${entry}`, async ({ page }) => {
    const h = await realDesk(page, which);
    try {
      const id = which === 'resume' ? 'stmt' : 'p:p2';
      const frame = page.frameLocator('jb-scribe .scribe__frame'), block = frame.locator(`[data-node="${id}"]`);
      const original = await block.textContent();
      if (entry === 'double-click') await block.dblclick();
      else if (entry === 'Edit text') {
        await selectBlocks(page, [id]);
        const edit = h.desk.locator('[data-selection="edit"]');
        await expect(edit).toHaveAttribute('aria-disabled', 'true'); await edit.click({ force: true });
      } else {
        await tabToBlock(page); await arrowToBlock(page, id, await frame.locator('[data-node]').count());
        await page.keyboard.press('F2');
      }
      await expect(block).not.toHaveAttribute('contenteditable', 'plaintext-only');
      await expect(block).toHaveAttribute('aria-label', /, locked$/);
      await expect(h.desk.locator('.scribe__status')).toHaveText('This line has locked figures. Ask Scribe to change it.');
      await expect(h.composer).toBeFocused();
      expect(await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().scope.ids)).toEqual([id]);
      // Real typing now goes to the composer, never to the locked document.
      await page.keyboard.type('Ask Scribe to shorten this.');
      await expect(block).toHaveText(original);
      expect(h.calls.filter(c => c.method === 'POST' && c.path.endsWith('/edits/manual'))).toHaveLength(0);
      expect((await (await fetch(`${h.service.baseUrl}${h.pkg.path}/versions?doc=${which}`)).json()).versions).toHaveLength(1);
      expect(h.fence.unexpectedExternal).toEqual([]);
    } finally { await h.service.close(); }
  });
}

for (const width of [1440, 375]) for (const id of ['seat:acme', 'cred:education']) {
  test(`SCRP-F130 R8-#4 ${width} ${id} whole lock keeps fixed copy and document focus`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const h = await realDesk(page, 'resume');
    try {
      if (width === 375) await h.desk.locator('button[data-seg="doc"]').click();
      const block = page.frameLocator('jb-scribe .scribe__frame').locator(`[data-node="${id}"]`);
      await block.dblclick();
      const lockCopy = id === 'cred:education' ? 'Degree and school are locked.' : 'Employer, title and dates are locked.';
      await expect(h.desk.locator('.scribe__status')).toHaveText(lockCopy);
      await expect(h.desk.locator('.scribe__manual-state')).toBeVisible();
      await expect(h.desk.locator('.scribe__manual-state')).toContainText(lockCopy);
      await expect(block).toBeFocused(); await expect(h.composer).not.toBeFocused();
      await expect(block).not.toHaveAttribute('contenteditable', 'plaintext-only');
      expect(await page.evaluate(() => globalThis.JB_SCRIBE_V2.current().scope.ids)).toEqual([id]);
      expect(h.calls.filter(c => c.method === 'POST' && c.path.includes('/edits'))).toHaveLength(0);
      expect(h.fence.unexpectedExternal).toEqual([]);
    } finally { await h.service.close(); }
  });
}
