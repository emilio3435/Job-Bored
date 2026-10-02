// HOLES KEEP R6: rescore covers only active (blank/New/Researching),
// non-dismissed rows, newest first, and the row cap counts only those.
// In-memory Sheet and stub chat provider; globalThis.fetch is replaced.
import assert from "node:assert/strict";
import { it } from "node:test";

import { rescoreAllPipelineRows } from "../server/profile-rescore-worker.mjs";
import { buildStarterTemplate, listStarterTemplateIds } from "../server/user-profile.mjs";

function row({ title, status = "", dateFound = "", dismissedAt = "", n }) {
  const r = new Array(26).fill("");
  r[0] = dateFound;
  r[1] = title;
  r[2] = "Acme";
  r[3] = "Remote";
  r[4] = `http://127.0.0.1:18169/job/${n}`;
  r[12] = status;
  r[22] = dismissedAt;
  return r;
}

// Sheet rows 2..9.
const ROWS = [
  row({ n: 2, title: "Old New Role", status: "New", dateFound: "2026-01-05" }),
  row({ n: 3, title: "Applied Role", status: "Applied", dateFound: "2026-09-30" }),
  row({ n: 4, title: "Rejected Role", status: "Rejected", dateFound: "2026-09-29" }),
  row({ n: 5, title: "Dismissed Role", status: "New", dateFound: "2026-09-28", dismissedAt: "2026-09-29T10:00:00Z" }),
  row({ n: 6, title: "Researching Role", status: "Researching", dateFound: "2026-09-20" }),
  row({ n: 7, title: "Blank Status Role", status: "", dateFound: "2026-09-25" }),
  row({ n: 8, title: "Spring New Role", status: "New", dateFound: "2026-03-01" }),
  row({ n: 9, title: "Expired Role", status: "Expired", dateFound: "2026-09-27" }),
];

function installStubs(rows) {
  const written = new Set();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
    if (url.hostname === "sheets.googleapis.com") {
      if ((init.method || "GET") === "GET") {
        const m = /!E(\d+)\s*$/.exec(decodeURIComponent(url.pathname));
        if (m) {
          return new Response(JSON.stringify({ values: [[rows[Number(m[1]) - 2]?.[4] ?? ""]] }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ values: rows }), { status: 200 });
      }
      for (const d of JSON.parse(init.body).data) {
        const m = /![A-Z]+(\d+)$/.exec(d.range);
        if (m) written.add(Number(m[1]));
      }
      return new Response("{}", { status: 200 });
    }
    if (url.hostname === "stub-llm.invalid") {
      const content = JSON.stringify({ fitScore: 7, rationale: "ok", leadAngle: "ok" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }
    throw new TypeError(`no-egress: ${url.hostname}`);
  };
  return { written, restore: () => (globalThis.fetch = realFetch) };
}

function profile() {
  const base = structuredClone(buildStarterTemplate(listStarterTemplateIds()[0]));
  base.hardConstraints = { workMode: "any" };
  return base;
}

const providerConfig = {
  provider: "openai",
  apiKey: "probe-key",
  model: "probe-model",
  baseUrl: "http://stub-llm.invalid/v1",
};

it("R6: rescore scores the newest active rows and skips closed and dismissed ones", async () => {
  const stubs = installStubs(ROWS);
  const events = [];
  try {
    const result = await rescoreAllPipelineRows({
      sheetId: "probe-sheet",
      providerConfig,
      overrideToken: "probe-token",
      profile: profile(),
      maxRows: 2,
      onProgress: (e) => events.push(e),
    });
    assert.deepEqual([...stubs.written].sort(), [6, 7], "the two newest active rows, nothing else");
    assert.equal(result.rescored, 2);
    const skippedReasons = Object.fromEntries(
      events.filter((e) => e.status === "skipped").map((e) => [e.row, e.reason]),
    );
    assert.deepEqual(skippedReasons, {
      3: "not_active",
      4: "not_active",
      5: "dismissed",
      9: "not_active",
    });
  } finally {
    stubs.restore();
  }
});

it("R6: a dry run counts only active, non-dismissed rows", async () => {
  const stubs = installStubs(ROWS);
  try {
    const result = await rescoreAllPipelineRows({
      sheetId: "probe-sheet",
      providerConfig,
      overrideToken: "probe-token",
      profile: profile(),
      dryRun: true,
    });
    assert.deepEqual(result, { rescored: 0, skipped: 4, failed: 0, total: 4, dryRun: true });
    assert.equal(stubs.written.size, 0);
  } finally {
    stubs.restore();
  }
});
