import assert from "node:assert/strict";
import test from "node:test";
import { _internal, rescoreAllPipelineRows } from "../server/profile-rescore-worker.mjs";

const PROFILE = { version: 1, identity: { targetRoles: ["Engineer"], targetSeniority: "ic_senior", primaryNarrative: "Backend" }, strengths: [{ name: "backend", rank: 1 }], hardConstraints: { workMode: "any" } };
const PROVIDER = { provider: "openai", model: "probe-model", apiKey: "probe-key", baseUrl: "http://stub-llm.invalid/v1" };

test("R7: rescore writes its scorer beside the score in the same batch", async () => {
  const previous = globalThis.fetch;
  let batch;
  globalThis.fetch = async (_input, init) => { batch = JSON.parse(init.body); return new Response("{}"); };
  try {
    await _internal.writeRowScoreCells({ sheetId: "sheet_1", token: "example-token", rowNumber: 2, fitScore: 8, fitAssessment: "Strong", talkingPoints: "Backend", scorer: "llm:probe-model" });
    assert.equal(batch.data.find((cell) => cell.range === "Pipeline!AA2")?.values[0][0], "llm:probe-model");
  } finally { globalThis.fetch = previous; }
});

for (const mode of ["llm", "llm-blank", "prefilter", "prefilter-race", "foreign"]) {
  test(`R7: rescore provenance and downgrade protection (${mode})`, async () => {
    const row = new Array(27).fill("");
    row[1] = "Engineer"; row[2] = "Acme"; row[3] = "Onsite"; row[4] = "http://127.0.0.1:18169/job/1";
    row[7] = "9"; row[10] = "Prior LLM"; row[26] = mode === "foreign" ? "My text" : mode === "prefilter-race" ? "heuristic" : mode === "llm-blank" ? "" : "llm:old-model";
    const batches = [];
    const events = [];
    const previous = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.pathname);
      if (url.hostname === "sheets.googleapis.com") {
        if (init.method === "POST") { batches.push(JSON.parse(init.body)); return new Response("{}"); }
        const values = /!AA1$/.test(path) ? [[mode === "foreign" ? "My notes" : "Scorer"]]
          : /!AA2:AA$/.test(path) ? [[row[26]]]
          : /!H2:AA2$/.test(path) ? [[row[7], ...Array(18).fill(""), "llm:new-model"]]
          : /!E2$/.test(path) ? [[row[4]]] : [row];
        return new Response(JSON.stringify({ values }));
      }
      if (url.hostname === "stub-llm.invalid") return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fitScore: 7, rationale: "Fit", leadAngle: "Backend" }) } }] }));
      throw new TypeError("no-egress");
    };
    try {
      const result = await rescoreAllPipelineRows({ sheetId: "sheet_1", profile: { ...PROFILE, hardConstraints: { workMode: mode.startsWith("prefilter") ? "remote_only" : "any" } }, providerConfig: PROVIDER, overrideToken: "example-token", onProgress: (event) => events.push(event) });
      const data = batches.flatMap((batch) => batch.data || []);
      if (mode.startsWith("prefilter")) {
        assert.equal(data.length, 0, "a deterministic prefilter cannot overwrite an LLM score");
        assert.equal(result.rescored, 0);
        assert.ok(events.some((event) => event.reason === "llm_score_preserved"));
      } else {
        assert.equal(result.rescored, 1);
        const scorerCell = data.find((cell) => cell.range === "Pipeline!AA2");
        if (mode.startsWith("llm")) assert.equal(scorerCell?.values[0][0], "llm:probe-model");
        else assert.equal(scorerCell, undefined, "a custom AA column stays untouched");
      }
    } finally { globalThis.fetch = previous; }
  });
}

for (const scenario of [
  { name: "blank Scorer", scorer: "", fit: "8", protected: true },
  { name: "explicit heuristic", scorer: "heuristic", fit: "8", protected: false },
  { name: "empty Fit Score", scorer: "", fit: "", protected: false },
  { name: "custom AA", scorer: "heuristic", fit: "8", header: "My notes", protected: true },
  { name: "unavailable Scorer", scorer: "", fit: "8", headerError: true, protected: true },
  { name: "legacy score landed after snapshot", scorer: "heuristic", fit: "8", liveScorer: "", protected: true },
]) {
  test(`R7 review: prefilter respects ${scenario.name}`, async () => {
    const row = new Array(27).fill("");
    row[1] = "Engineer"; row[2] = "Acme"; row[3] = "Onsite"; row[4] = "http://127.0.0.1:18169/job/1";
    row[7] = scenario.fit; row[10] = "Existing assessment"; row[26] = scenario.scorer;
    const previous = globalThis.fetch;
    const batches = [];
    globalThis.fetch = async (input, init = {}) => {
      const path = decodeURIComponent(new URL(String(input)).pathname);
      if (init.method === "POST") { batches.push(JSON.parse(init.body)); return new Response("{}"); }
      if (/!AA1$/.test(path) && scenario.headerError) return new Response("unavailable", { status: 403 });
      const live = new Array(20).fill(""); live[0] = scenario.fit; live[19] = scenario.liveScorer ?? scenario.scorer;
      const values = /!AA1$/.test(path) ? [[scenario.header ?? "Scorer"]]
        : /!AA2:AA$/.test(path) ? [[scenario.scorer]]
        : /!H2:AA2$/.test(path) ? [live]
        : /!H2$/.test(path) ? [[scenario.fit]]
        : /!AA2$/.test(path) ? [[scenario.liveScorer ?? scenario.scorer]]
        : /!E2$/.test(path) ? [[row[4]]] : [row];
      return new Response(JSON.stringify({ values }));
    };
    try {
      const result = await rescoreAllPipelineRows({ sheetId: "sheet_1", profile: { ...PROFILE, hardConstraints: { workMode: "remote_only" } }, providerConfig: PROVIDER, overrideToken: "example-token" });
      assert.equal(result.failed, 0);
      const data = batches.flatMap((batch) => batch.data || []);
      if (scenario.protected) {
        assert.equal(result.rescored, 0);
        assert.equal(data.length, 0, "keep the non-empty score and assessment");
      } else {
        assert.equal(result.rescored, 1);
        assert.equal(data.find((cell) => cell.range === "Pipeline!H2")?.values[0][0], "1");
      }
    } finally { globalThis.fetch = previous; }
  });
}
