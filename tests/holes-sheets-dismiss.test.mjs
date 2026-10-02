/**
 * HOLES lane SHEETS · A8 / R12 — a dismiss is written now, Undo reverses it,
 * and it never half-commits.
 *
 * dismissJob used to wait 10 s before writing anything (a closed tab lost
 * the dismiss) and then wrote Pipeline!W and the Blacklist row in parallel,
 * so one failing half left the other behind: a role hidden on the board but
 * still re-discoverable, or blocked but still on the board. Now W lands
 * first, the Blacklist row second, and a failed second half puts W back.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COL,
  HEADERS,
  createFakeSheets,
  loadWriteback,
  pipelineRow,
  rowByLink,
} from "./holes-sheets-fake.mjs";

const LINK = "https://jobs.ashbyhq.com/initech/role-77";
const STAMP = "2026-09-30T12:00:00.000Z";

function setup({ dismissed = false } = {}) {
  const fake = createFakeSheets({
    Pipeline: [
      HEADERS.slice(),
      pipelineRow({
        title: "Data Engineer",
        company: "Initech",
        link: LINK,
        status: "New",
        dismissedAt: dismissed ? STAMP : "",
      }),
    ],
    Blacklist: dismissed
      ? [["URL", "Dismissed At", "Title", "Company", "Reason"], [LINK, STAMP, "Data Engineer", "Initech", ""]]
      : [["URL", "Dismissed At", "Title", "Company", "Reason"]],
  });
  const env = loadWriteback(fake);
  env.load();
  return { fake, env, idx: env.indexOf(LINK) };
}

const blacklistUrls = (fake) => fake.rows("Blacklist").slice(1).map((r) => r[0]);
const isAppend = (req) => req.method === "POST" && /:append/.test(req.url);
const isPipelineWrite = (req) => req.method === "POST" && /values:batchUpdate/.test(req.url);
const isDeleteRows = (req) => req.method === "POST" && /:batchUpdate$/.test(req.url) && !/values:/.test(req.url);

describe("A8 / R12 · dismiss writes now and never half-commits", () => {
  it("writes W and the Blacklist row before dismissJob resolves, with no 10 s window", { timeout: 2000 }, async () => {
    const t = setup();
    const ok = await t.env.sw.dismissJob(t.idx);
    assert.equal(ok, true);
    assert.match(rowByLink(t.fake, LINK)[COL.dismissedAt], /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(blacklistUrls(t.fake), [LINK]);
    assert.equal(t.env.timers.length, 0, "nothing waits on a timer before writing");
    const toast = t.env.toasts.find((x) => /^Dismissed/.test(x.message));
    assert.equal(toast.action.label, "Undo");
  });

  it("Undo reverses what landed: W is cleared and the Blacklist row removed", { timeout: 2000 }, async () => {
    const t = setup();
    await t.env.sw.dismissJob(t.idx);
    const toast = t.env.toasts.find((x) => /^Dismissed/.test(x.message));
    toast.action.onClick();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], "");
    assert.deepEqual(blacklistUrls(t.fake), []);
    assert.equal(t.env.state.data[t.idx].dismissedAt, null);
  });

  it("a double-clicked Undo restores once and never lifts another role's block", { timeout: 2000 }, async () => {
    const t = setup();
    await t.env.sw.dismissJob(t.idx);
    // Another role's block sits right after ours: a second, stale delete
    // of "our" row index would lift it.
    t.fake.rows("Blacklist").push(["https://example.com/other-role", STAMP, "Other", "Hooli", ""]);
    const toast = t.env.toasts.find((x) => /^Dismissed/.test(x.message));
    toast.action.onClick();
    toast.action.onClick();
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(blacklistUrls(t.fake), ["https://example.com/other-role"]);
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], "");
  });

  it("a failed Blacklist write puts W back and reverts the card", { timeout: 2000 }, async () => {
    const t = setup();
    t.fake.failWhen(isAppend, 503, "Backend unavailable");
    const ok = await t.env.sw.dismissJob(t.idx);
    assert.equal(ok, false);
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], "", "W rolled back");
    assert.deepEqual(blacklistUrls(t.fake), []);
    assert.equal(t.env.state.data[t.idx].dismissedAt, null);
    assert.ok(t.env.toasts.some((x) => x.type === "error" && /reverted/.test(x.message)));
    const undo = t.env.toasts.find((x) => /^Dismissed/.test(x.message));
    assert.equal(undo.dismissed, true, "the Undo toast is withdrawn");
  });

  it("the rollback re-finds the role when a row was inserted above it", { timeout: 2000 }, async () => {
    const t = setup();
    const OTHER = "https://jobs.lever.co/hooli/other-1";
    t.fake.intercept(async (req) => {
      if (isAppend(req)) {
        t.fake.rows("Pipeline").splice(1, 0, pipelineRow({ title: "Other", company: "Hooli", link: OTHER }));
      }
      return null;
    });
    t.fake.failWhen(isAppend, 503, "Backend unavailable");
    assert.equal(await t.env.sw.dismissJob(t.idx), false);
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], "", "W rolled back on the role's own row");
    assert.equal(rowByLink(t.fake, OTHER)[COL.dismissedAt], "", "the inserted row is untouched");
  });

  it("a Sheet switch during the identity check writes nothing", { timeout: 2000 }, async () => {
    const t = setup();
    t.fake.intercept(async (req) => {
      if (req.method === "GET") t.env.host.getActiveSheetId = () => "sheet-other";
      return null;
    });
    assert.equal(await t.env.sw.dismissJob(t.idx), false);
    assert.equal(t.fake.requests.filter(isPipelineWrite).length, 0);
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], "");
  });

  const spreadsheetsHit = (fake) => [
    ...new Set(fake.requests.map((r) => /spreadsheets\/([^/:?]+)/.exec(r.url)[1])),
  ];
  const switchAfterW = (t) =>
    t.fake.intercept(async (req) => {
      if (isPipelineWrite(req)) t.env.host.getActiveSheetId = () => "sheet-other";
      return null;
    });

  it("a Sheet switch after W lands still sends the Blacklist row to the same spreadsheet", { timeout: 2000 }, async () => {
    const t = setup();
    switchAfterW(t);
    assert.equal(await t.env.sw.dismissJob(t.idx), true);
    assert.deepEqual(spreadsheetsHit(t.fake), ["sheet-123"]);
    assert.deepEqual(blacklistUrls(t.fake), [LINK]);
  });

  it("a failed Blacklist half after a Sheet switch rolls W back on the original spreadsheet", { timeout: 2000 }, async () => {
    const t = setup();
    switchAfterW(t);
    t.fake.failWhen(isAppend, 503, "Backend unavailable");
    assert.equal(await t.env.sw.dismissJob(t.idx), false);
    assert.deepEqual(spreadsheetsHit(t.fake), ["sheet-123"]);
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], "", "W rolled back");
  });

  it("restore after a Sheet switch deletes the block on the same spreadsheet", { timeout: 2000 }, async () => {
    const t = setup({ dismissed: true });
    switchAfterW(t);
    assert.equal(await t.env.sw.restoreJob(t.idx), true);
    assert.deepEqual(spreadsheetsHit(t.fake), ["sheet-123"]);
    assert.deepEqual(blacklistUrls(t.fake), []);
  });

  it("a failed W write leaves the Blacklist untouched", { timeout: 2000 }, async () => {
    const t = setup();
    t.fake.failWhen(isPipelineWrite, 500, "Internal error");
    const ok = await t.env.sw.dismissJob(t.idx);
    assert.equal(ok, false);
    assert.deepEqual(blacklistUrls(t.fake), []);
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], "");
    assert.equal(t.env.state.data[t.idx].dismissedAt, null);
  });

  it("restore: a failed Blacklist delete puts W back, so the role stays fully dismissed", { timeout: 2000 }, async () => {
    const t = setup({ dismissed: true });
    t.fake.failWhen(isDeleteRows, 500, "Internal error");
    const ok = await t.env.sw.restoreJob(t.idx);
    assert.equal(ok, false);
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], STAMP, "W put back");
    assert.deepEqual(blacklistUrls(t.fake), [LINK]);
    assert.equal(t.env.state.data[t.idx].dismissedAt, STAMP);
  });

  it("restore clears W and every Blacklist row for the role", { timeout: 2000 }, async () => {
    const t = setup({ dismissed: true });
    t.fake.rows("Blacklist").push([LINK + "?utm_source=x", STAMP, "Data Engineer", "Initech", ""]);
    const ok = await t.env.sw.restoreJob(t.idx);
    assert.equal(ok, true);
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], "");
    assert.deepEqual(blacklistUrls(t.fake), [], "duplicate blocks are all lifted");
  });
});
