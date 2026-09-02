import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function boot() {
  const win = {};
  const sandbox = { window: win, console };
  vm.runInNewContext(
    readFileSync(join(repoRoot, "expired-review.js"), "utf8"),
    sandbox,
  );
  return win.JobBoredExpiredReview;
}

const review = boot();
const health = (job, opts) => review.getPostingHealth(job, opts);

describe("getPostingHealth", () => {
  it("expired status wins", () => {
    assert.equal(health({ status: "Expired", link: "https://x/1" }).state, "expired");
    assert.equal(
      health({ status: "Expired", link: "https://x/1" }).label,
      "Posting expired",
    );
  });

  it("cleanup audit note → needs-review with checkedAt", () => {
    const h = health({
      status: "New",
      link: "https://x/1",
      notes:
        "[2026-08-31T10:00:00Z] expired-review: needs review · HTTP 403 · previous New",
    });
    assert.equal(h.state, "needs-review");
    assert.equal(h.checkedAt, "2026-08-31T10:00:00Z");
    assert.ok(h.detail, "needs-review must carry the reason detail");
  });

  it("open when active, recent, and unflagged; unknown for closed stages", () => {
    assert.equal(
      health(
        { status: "Researching", link: "https://x/1", dateFoundRaw: "2026-08-29" },
        { now: "2026-09-01" },
      ).state,
      "open",
    );
    assert.equal(health({ status: "Rejected", link: "https://x/1" }).state, "unknown");
  });

  it("unknown without an http link, and for a non-object job", () => {
    assert.equal(health({ status: "New", link: "" }).state, "unknown");
    assert.equal(health(null).state, "unknown");
    assert.equal(health(undefined).label, "");
  });

  it("keeps an aging active listing open — staleness is advisory, not a health state", () => {
    const h = health(
      { status: "New", link: "https://x/1", dateFoundRaw: "2026-06-01" },
      { now: "2026-09-01" },
    );
    assert.equal(h.state, "open");
    assert.match(h.detail, /days ago/);
  });

  it("reads the audit stamp out of raw notes even when the state is open", () => {
    const h = health(
      {
        status: "New",
        link: "https://x/1",
        _rawNotes: "[2026-08-30] availability check: still live",
        dateFoundRaw: "2026-08-29",
      },
      { now: "2026-09-01" },
    );
    assert.equal(h.state, "open");
    assert.equal(h.checkedAt, "2026-08-30");
  });
});
