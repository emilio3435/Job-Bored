/**
 * HOLES lane SHEETS · A10 — the existing-sheet check says what is wrong.
 *
 * verifyExistingSheetAccess (Beat 1's "use my sheet" path) mapped every
 * failed metadata read to access_denied: an expired token (401), Google
 * rate-limiting (429) or an outage (5xx) all told the person to go get the
 * owner's permission. It also accepted any Pipeline tab whose row 1 merely
 * existed, and never checked the account could write. Now:
 *   401 → one silent refresh and a retry, then session_expired
 *   403 → access_denied (unchanged), 429 → rate_limited, 5xx → google_unavailable
 *   row 1 is checked like the discovery worker's checkPipelineHeader
 *   a no-op write probe tells a viewer (read_only) from an editor.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { HEADERS, createFakeSheets } from "./holes-sheets-fake.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadSetup({ refreshTo = "" } = {}) {
  let token = "token-1";
  const host = {
    getAccessToken: () => token,
    refreshAccessTokenSilently: async () => {
      if (!refreshTo) return false;
      token = refreshTo;
      return true;
    },
    getStarterPipelineHeaders: () => HEADERS.slice(),
  };
  const win = { JobBoredApp: { core: { host } }, location: { search: "" } };
  const ctx = vm.createContext({
    window: win,
    document: { getElementById: () => null, documentElement: { classList: { contains: () => false } } },
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    URLSearchParams,
  });
  vm.runInContext(readFileSync(join(repoRoot, "sheet-access-setup.js"), "utf8"), ctx, {
    filename: "sheet-access-setup.js",
  });
  win.JobBoredApp.core = { host };
  return win.JobBoredApp.setup;
}

function sheetWith(headerRow, opts) {
  return createFakeSheets({ Pipeline: [headerRow] }, opts);
}

async function check(fake, setupOpts) {
  const setup = loadSetup(setupOpts);
  const res = await setup.verifyExistingSheetAccess({
    sheetId: "sheet-123",
    accessToken: "token-1",
    fetchImpl: (url, init) => fake.fetch(url, init),
  });
  return JSON.parse(JSON.stringify(res));
}

const metaRead = (r) => r.method === "GET" && !/\/values\//.test(r.url);
const headerRead = (r) => r.method === "GET" && /\/values\//.test(r.url);

describe("A10 · status codes are told apart", () => {
  it("401: refreshes once, retries with the new token, then carries on", async () => {
    const fake = sheetWith(HEADERS.slice());
    const seen = [];
    fake.intercept(async (req) => {
      seen.push(req);
      return null;
    });
    let first = true;
    fake.intercept(async (req) => {
      if (first && metaRead(req)) {
        first = false;
        return { ok: false, status: 401, json: async () => ({ error: { message: "Invalid Credentials" } }) };
      }
      return null;
    });
    const setup = loadSetup({ refreshTo: "token-2" });
    const auths = [];
    const res = await setup.verifyExistingSheetAccess({
      sheetId: "sheet-123",
      accessToken: "token-1",
      fetchImpl: (url, init) => {
        auths.push(init && init.headers && init.headers.Authorization);
        return fake.fetch(url, init);
      },
    });
    assert.equal(res.ok, true);
    assert.equal(res.reason, "headers_ok");
    assert.equal(auths[0], "Bearer token-1");
    assert.ok(auths.slice(1).every((a) => a === "Bearer token-2"), "retries use the refreshed token");
  });

  it("401 that a refresh can't fix is session_expired, not access_denied", async () => {
    const fake = sheetWith(HEADERS.slice());
    fake.failWhen(metaRead, 401, "Invalid Credentials", 5);
    const res = await check(fake);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "session_expired");
    assert.equal(res.status, 401);
    assert.match(res.message, /sign/i);
  });

  it("403 stays access_denied", async () => {
    const fake = sheetWith(HEADERS.slice());
    fake.failWhen(metaRead, 403, "The caller does not have permission");
    assert.deepEqual(await check(fake), { ok: false, reason: "access_denied", status: 403 });
  });

  it("429 is rate_limited and 5xx is google_unavailable, on either read", async () => {
    const limited = sheetWith(HEADERS.slice());
    limited.failWhen(metaRead, 429, "Quota exceeded");
    const a = await check(limited);
    assert.equal(a.reason, "rate_limited");
    assert.equal(a.status, 429);
    assert.ok(a.message);

    const down = sheetWith(HEADERS.slice());
    down.failWhen(headerRead, 503, "Backend unavailable");
    const b = await check(down);
    assert.equal(b.reason, "google_unavailable");
    assert.equal(b.status, 503);
    assert.ok(b.message);
  });
});

describe("A10 · row 1 must be the JobBored Pipeline header", () => {
  it("a different label in a core column is headers_mismatch, naming the column", async () => {
    const row = HEADERS.slice();
    row[2] = "Employer";
    const res = await check(sheetWith(row));
    assert.equal(res.ok, false);
    assert.equal(res.reason, "headers_mismatch");
    assert.equal(res.column, "C");
    assert.equal(res.expected, "Company");
    assert.equal(res.found, "Employer");
    assert.match(res.message, /column C/);
  });

  it("a blank header row is headers_mismatch at column A", async () => {
    const res = await check(sheetWith([]));
    assert.equal(res.reason, "headers_mismatch");
    assert.equal(res.column, "A");
  });

  it("a legacy sheet that stops after column Q is accepted (the worker upgrades it)", async () => {
    const res = await check(sheetWith(HEADERS.slice(0, 17)));
    assert.deepEqual(res, { ok: true, reason: "headers_ok" });
  });

  it("an optional column carrying another label is refused", async () => {
    const row = HEADERS.slice();
    row[17] = "Recruiter email";
    const res = await check(sheetWith(row));
    assert.equal(res.reason, "headers_mismatch");
    assert.equal(res.column, "R");
  });

  it("U's legacy 'Match Score' and a foreign Z label pass, as in the worker", async () => {
    const row = HEADERS.slice();
    row[20] = "Match Score";
    row[25] = "Remote?";
    assert.equal((await check(sheetWith(row))).reason, "headers_ok");
  });
});

describe("A10 · write access", () => {
  it("a view-only account is read_only", async () => {
    const res = await check(sheetWith(HEADERS.slice(), { readOnly: true }));
    assert.equal(res.ok, false);
    assert.equal(res.reason, "read_only");
    assert.equal(res.status, 403);
    assert.match(res.message, /edit/i);
  });

  it("the write probe re-sets the current title and changes nothing else", async () => {
    const fake = sheetWith(HEADERS.slice(), { title: "My Job Hunt" });
    const res = await check(fake);
    assert.deepEqual(res, { ok: true, reason: "headers_ok" });
    const writes = fake.writes();
    assert.equal(writes.length, 1);
    assert.match(writes[0].url, /:batchUpdate$/);
    assert.deepEqual(writes[0].body, {
      requests: [
        { updateSpreadsheetProperties: { properties: { title: "My Job Hunt" }, fields: "title" } },
      ],
    });
  });
});
