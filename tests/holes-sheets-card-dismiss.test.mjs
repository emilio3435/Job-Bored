/**
 * HOLES lane SHEETS · A8 / R12 — the card's Dismiss and Restore are the
 * same write as dismissJob / restoreJob.
 *
 * app-bootstrap.js claims jb:closure:change (the board card's Dismiss) and
 * wrote the planner's W-plus-notes batch, so the live dismiss never wrote
 * the Blacklist row and had none of dismissJob's rollback or Undo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { COL, HEADERS, createFakeSheets, loadWriteback, pipelineRow, rowByLink } from "./holes-sheets-fake.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const LINK = "https://jobs.ashbyhq.com/initech/role-77";
const STAMP = "2026-09-30T12:00:00.000Z";
const BL_HEADER = ["URL", "Dismissed At", "Title", "Company", "Reason", "Provider ID"];

function setup({ dismissed = false } = {}) {
  const fake = createFakeSheets({
    Pipeline: [
      HEADERS.slice(),
      pipelineRow({ title: "Data Engineer", company: "Initech", link: LINK, status: "New", dismissedAt: dismissed ? STAMP : "" }),
    ],
    Blacklist: dismissed ? [BL_HEADER, [LINK, STAMP, "Data Engineer", "Initech", ""]] : [BL_HEADER],
  });
  const env = loadWriteback(fake);
  env.load();
  const handlers = {};
  const failed = [];
  // The planner the shim used to write with: W plus a notes line, no Blacklist.
  const planner = {
    planTransition({ action, row }) {
      const w = action === "dismiss" ? STAMP : "";
      return {
        ok: true,
        patches: [
          { column: "W", sheetRow: row.sheetRow, range: `Pipeline!W${row.sheetRow}`, value: w },
          { column: "O", sheetRow: row.sheetRow, range: `Pipeline!O${row.sheetRow}`, value: action },
        ],
      };
    },
  };
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const document = {
    addEventListener(type, fn) {
      handlers[type] = fn;
    },
    dispatchEvent(ev) {
      if (ev.type === "jb:write:failed") failed.push(ev.detail);
      return true;
    },
    documentElement: { classList: { contains: () => false, remove() {} } },
  };
  const window = {
    JobBoredApp: env.app,
    JobBoredPipelineTransitions: planner,
    JobBored: { getPipelineJobs: () => env.state.data },
  };
  vm.runInNewContext(readFileSync(join(repoRoot, "app-bootstrap.js"), "utf8"), {
    window,
    document,
    CustomEvent,
    console: { info() {}, warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
  });
  const fire = async (action) => {
    let claimed = false;
    handlers["jb:closure:change"]({
      detail: { action, jobKey: env.indexOf(LINK), source: "board" },
      preventDefault() {
        claimed = true;
      },
    });
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    return claimed;
  };
  return { fake, env, fire, failed };
}

const blacklistUrls = (fake) => fake.rows("Blacklist").slice(1).map((r) => r[0]);

describe("A8 / R12 · the card's Dismiss runs dismissJob", () => {
  it("writes W and the Blacklist row, and offers dismissJob's Undo", async () => {
    const t = setup();
    assert.equal(await t.fire("dismiss"), true);
    assert.match(rowByLink(t.fake, LINK)[COL.dismissedAt], /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(blacklistUrls(t.fake), [LINK]);
    const toast = t.env.toasts.find((x) => /^Dismissed/.test(x.message));
    assert.equal(toast && toast.action && toast.action.label, "Undo");
    assert.deepEqual(t.failed, []);
  });

  it("the card's Restore clears W and lifts the block", async () => {
    const t = setup({ dismissed: true });
    assert.equal(await t.fire("restore"), true);
    assert.equal(rowByLink(t.fake, LINK)[COL.dismissedAt], "");
    assert.deepEqual(blacklistUrls(t.fake), []);
  });

  it("a failed dismiss reports jb:write:failed", async () => {
    const t = setup();
    t.fake.failWhen((r) => r.method === "POST" && /values:batchUpdate/.test(r.url), 500, "Internal error");
    await t.fire("dismiss");
    assert.equal(t.failed.length, 1);
    assert.deepEqual(blacklistUrls(t.fake), []);
  });
});
