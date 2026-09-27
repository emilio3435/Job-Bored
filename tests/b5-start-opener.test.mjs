/* ============================================================
   B5 Option 4 — start.sh browser opener (spec C1 deep link + C4 flag).

   start.sh waits for the dashboard with a bounded poll, then opens the
   dashboard ROOT via macOS `open` / Linux `xdg-open` — never a deep link
   (GFX-R4 reverted the C1 ?beat=discovery URL; the flow resumes itself) —
   unless JB_SKIP_BROWSER_OPEN=1 (C4), CI, or headless-no-TTY says skip.

   Every runtime case below uses a test hook (JB_START_DRY_RUN,
   JB_OPEN_POLL_ONLY, JB_START_NO_EXEC on a skip path), so no case starts
   servers, opens a browser, or leaves a background job: spawnSync would
   time out instead of returning if the poll could hang.
   ============================================================ */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { readRepoFile, repoRoot } from "./oneflow-l0-harness.mjs";

const START_SH = join(repoRoot, "start.sh");
const N4 = "Return to your open tab and press Save & verify.";

function runStartSh(env = {}, timeoutMs = 15000) {
  return spawnSync("bash", [START_SH], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

/**
 * A port nothing listens on. start.sh checks the dashboard port before it
 * starts anything (GFX-N4), so the no-exec cases must not land on a live
 * :8080 (PLAN R16).
 */
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return String(port);
}

/** Clear inherited CI so headless/force cases are deterministic. */
function noCi(extra = {}) {
  return { CI: "", ...extra };
}

describe("B5 start opener · start.sh source contract", () => {
  it("honors the SPEC-FIXED C4 flag name JB_SKIP_BROWSER_OPEN=1", () => {
    const src = readRepoFile("start.sh");
    assert.match(src, /JB_SKIP_BROWSER_OPEN/);
    assert.match(src, /\$\{JB_SKIP_BROWSER_OPEN:-\}"\s*=\s*"1"/);
  });

  it("GFX-R4: opens the dashboard root — no beat, no returnTo, no key material", () => {
    const src = readRepoFile("start.sh");
    assert.match(src, /JB_OPEN_URL="\$\{JB_DASHBOARD_SCHEME\}:\/\/localhost:\$\{JB_DASHBOARD_PORT\}\/"/);
    assert.doesNotMatch(src, /JB_OPEN_URL=.*\?/);
    assert.doesNotMatch(src, /apikey|api_key/);
  });

  it("opens via macOS open plus Linux xdg-open", () => {
    const src = readRepoFile("start.sh");
    assert.match(src, /command -v open/);
    assert.match(src, /xdg-open/);
  });

  it("bounds the dashboard wait (per-probe timeout plus overall deadline)", () => {
    const src = readRepoFile("start.sh");
    assert.match(src, /JB_OPEN_MAX_WAIT_SECS/);
    assert.match(src, /curl --max-time/);
    assert.match(src, /SECONDS/);
  });

  it("defaults OFF under CI or headless with no TTY", () => {
    const src = readRepoFile("start.sh");
    assert.match(src, /\$\{CI:-\}/);
    assert.match(src, /!\s*-t [01]/);
  });

  it("prints the N4 stdout line on an explicit flag skip", () => {
    assert.match(readRepoFile("start.sh"), new RegExp(N4.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("start.command delegates to start.sh so the flag passes through", () => {
    assert.match(readRepoFile("start.command"), /start\.sh/);
  });
});

describe("B5 start opener · JB_START_DRY_RUN flag matrix (no servers, no open)", () => {
  it("JB_SKIP_BROWSER_OPEN=1 skips with reason=flag", () => {
    const r = runStartSh(noCi({ JB_START_DRY_RUN: "1", JB_SKIP_BROWSER_OPEN: "1" }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /SKIP reason=flag url=http:\/\/localhost:8080\/$/m);
  });

  it("CI=true skips with reason=ci", () => {
    const r = runStartSh({ JB_START_DRY_RUN: "1", CI: "true" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /SKIP reason=ci/);
  });

  it("headless with no TTY (piped stdio) skips with reason=headless", () => {
    const r = runStartSh(noCi({ JB_START_DRY_RUN: "1" }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /SKIP reason=headless/);
  });

  it("JB_FORCE_BROWSER_OPEN=1 opens at the dashboard root", () => {
    const r = runStartSh(noCi({ JB_START_DRY_RUN: "1", JB_FORCE_BROWSER_OPEN: "1" }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /OPEN url=http:\/\/localhost:8080\/ /);
  });

  it("the explicit flag wins over the force override", () => {
    const r = runStartSh(
      noCi({ JB_START_DRY_RUN: "1", JB_SKIP_BROWSER_OPEN: "1", JB_FORCE_BROWSER_OPEN: "1" }),
    );
    assert.equal(r.status, 0);
    assert.match(r.stdout, /SKIP reason=flag/);
  });

  it("GFX-R4: the opened URL carries no beat and no returnTo — the flow resumes itself", () => {
    const r = runStartSh(noCi({ JB_START_DRY_RUN: "1", JB_FORCE_BROWSER_OPEN: "1" }));
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /beat=|returnTo/);
  });

  it("respects PORT for the opened URL", () => {
    const r = runStartSh(
      noCi({ JB_START_DRY_RUN: "1", JB_FORCE_BROWSER_OPEN: "1", PORT: "9123" }),
    );
    assert.equal(r.status, 0);
    assert.match(r.stdout, /OPEN url=http:\/\/localhost:9123\/ /);
  });
});

describe("B5 start opener · real skip path prints N4 without starting servers", () => {
  it("JB_START_NO_EXEC + flag prints N4 and exits 0 (skip path launches no jobs)", async () => {
    const PORT = await freePort();
    const r = runStartSh(noCi({ JB_START_NO_EXEC: "1", JB_SKIP_BROWSER_OPEN: "1", PORT }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, new RegExp(N4.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(r.stdout, /NO_EXEC npm start skipped/);
  });

  it("CI skip stays silent (no N4) and exits 0", async () => {
    const PORT = await freePort();
    const r = runStartSh({ JB_START_NO_EXEC: "1", CI: "true", PORT });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /Save & verify/);
    assert.match(r.stdout, /NO_EXEC npm start skipped/);
  });
});

describe("B5 start opener · bounded poll cannot hang and leaves no daemon", () => {
  it("JB_OPEN_POLL_ONLY against a dead port finishes inside its bound", () => {
    const started = Date.now();
    const r = runStartSh(
      noCi({ JB_OPEN_POLL_ONLY: "1", JB_OPEN_MAX_WAIT_SECS: "2", PORT: "59999" }),
      20000,
    );
    const wallMs = Date.now() - started;
    assert.equal(r.error, undefined);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /POLL_DONE result=(timeout|up) elapsed_secs=\d+ max_wait=2/);
    // Generous ceiling: 2s bound plus one 2s probe plus process overhead.
    assert.ok(wallMs < 15000, `poll must be bounded, took ${wallMs}ms`);
  });
});
