// BEAUDIT D13: DiscoveryRuns header-read edge cases (probe p10).
import assert from "node:assert/strict";
import test from "node:test";

import { DISCOVERY_RUNS_HEADER_ROW } from "../../src/contracts.ts";
import {
  appendDiscoveryRunRow,
  parseDiscoveryRunsCells,
} from "../../src/sheets/discovery-runs-writer.ts";
import { createFakeSheets, runtimeConfig } from "./fake-sheets.ts";

const RUNS = [...DISCOVERY_RUNS_HEADER_ROW];
const row = {
  runAt: "2026-09-25T10:00:00Z",
  trigger: "manual",
  status: "partial",
  durationS: 30,
  companiesSeen: 4,
  leadsWritten: 2,
  leadsUpdated: 1,
  source: "worker",
  variationKey: "v1",
  error: "",
} as never;

for (const status of [429, 401, 403, 503]) {
  test(`D13: HTTP ${status} on the header read is not "tab missing" (p10a)`, async () => {
    const sheet = createFakeSheets({ DiscoveryRuns: [RUNS] });
    sheet.hooks.failNext.push({ kind: "values.get", status, body: "RESOURCE_EXHAUSTED" });
    const events: string[] = [];
    const result = await appendDiscoveryRunRow("fake-sheet", row, {
      runtimeConfig,
      fetchImpl: sheet.fetchImpl,
      log: (event) => events.push(event),
    });
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, new RegExp(`HTTP ${status}`));
    assert.equal(sheet.calls.some((c) => c.kind === "spreadsheets.batchUpdate"), false, "no addSheet");
    assert.equal(events.includes("discovery.runs_log.tab_created"), false);
  });
}

test("D13: a missing tab (400 Unable to parse range) is still created", async () => {
  const sheet = createFakeSheets({});
  const result = await appendDiscoveryRunRow("fake-sheet", row, { runtimeConfig, fetchImpl: sheet.fetchImpl });
  assert.deepEqual(result, { ok: true, created: true });
  assert.deepEqual(sheet.tabs.get("DiscoveryRuns")![0], RUNS);
});

test("D13: a legacy 9-column tab keeps its old rows readable after the header upgrade (p10b)", async () => {
  const legacy = ["Run At", "Trigger", "Status", "Duration (s)", "Companies Seen", "Leads Written", "Source", "Variation Key", "Error"];
  const old = ["2026-08-01T00:00:00Z", "manual", "failure", "10", "3", "0", "worker", "v0", "Gemini key missing"];
  const sheet = createFakeSheets({ DiscoveryRuns: [legacy, old] });
  const result = await appendDiscoveryRunRow("fake-sheet", row, { runtimeConfig, fetchImpl: sheet.fetchImpl });
  assert.equal(result.ok, true);
  const tab = sheet.tabs.get("DiscoveryRuns")!;
  assert.deepEqual(tab[0], RUNS);
  const parsed = parseDiscoveryRunsCells(tab[1], tab[0])!;
  assert.equal(parsed.leadsWritten, 0);
  assert.equal(parsed.leadsUpdated, 0);
  assert.equal(parsed.source, "worker");
  assert.equal(parsed.variationKey, "v0");
  assert.equal(parsed.error, "Gemini key missing");
  assert.equal(tab.length, 3, "the new run is appended below the migrated row");
});
