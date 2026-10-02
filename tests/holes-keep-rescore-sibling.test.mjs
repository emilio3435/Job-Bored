// HOLES KEEP R15: when the posting page is thin and SerpApi answers with a
// title+company sibling (another posting by the same company), rescore must
// not score the row against the sibling's description.
import assert from "node:assert/strict";
import { it } from "node:test";

import { rescoreAllPipelineRows } from "../server/profile-rescore-worker.mjs";
import { buildStarterTemplate, listStarterTemplateIds } from "../server/user-profile.mjs";

const POSTING_URL = "https://jobs.acme.example/posting/AUSTIN-123";
const SIBLING_TEXT = "Sibling posting in Berlin. ";

function sheetRows() {
  const r = new Array(26).fill("");
  r[0] = "2026-09-30";
  r[1] = "Senior Software Engineer";
  r[2] = "Acme";
  r[3] = "Austin, TX";
  r[4] = POSTING_URL;
  r[12] = "New";
  return [r];
}

it("R15: a SerpApi title+company sibling's description is never scored", async () => {
  const rows = sheetRows();
  const prompts = [];
  const events = [];
  const realFetch = globalThis.fetch;
  const realKey = process.env.SERPAPI_API_KEY;
  process.env.SERPAPI_API_KEY = "probe-serp";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
    if (url.hostname === "sheets.googleapis.com") {
      if ((init.method || "GET") === "GET") {
        const m = /!E(\d+)\s*$/.exec(decodeURIComponent(url.pathname));
        if (m) return new Response(JSON.stringify({ values: [[rows[0][4]]] }), { status: 200 });
        return new Response(JSON.stringify({ values: rows }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }
    if (url.hostname === "serpapi.com") {
      return new Response(
        JSON.stringify({
          jobs_results: [
            {
              title: "Senior Software Engineer",
              company_name: "Acme",
              location: "Berlin, Germany",
              job_id: "SIBLING-999",
              description: SIBLING_TEXT.repeat(40),
              apply_options: [{ link: "https://careers.acme.example/jobs/SIBLING-999" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.hostname === "jobs.acme.example") {
      return new Response("<html><head><title>Acme</title></head><body>Enable JavaScript</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.hostname === "stub-llm.invalid") {
      const body = JSON.parse(init.body);
      prompts.push(body.messages.map((m) => m.content).join("\n"));
      const content = JSON.stringify({ fitScore: 6, rationale: "ok", leadAngle: "ok" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }
    throw new TypeError(`no-egress: ${url.hostname}`);
  };
  try {
    const profile = structuredClone(buildStarterTemplate(listStarterTemplateIds()[0]));
    profile.hardConstraints = { workMode: "any" };
    const result = await rescoreAllPipelineRows({
      sheetId: "probe-sheet",
      providerConfig: {
        provider: "openai",
        apiKey: "probe-key",
        model: "probe-model",
        baseUrl: "http://stub-llm.invalid/v1",
      },
      overrideToken: "probe-token",
      profile,
      onProgress: (e) => events.push(e),
    });
    assert.equal(result.rescored, 1);
    assert.equal(prompts.length, 1);
    assert.ok(!prompts[0].includes(SIBLING_TEXT.trim()), "the sibling's description reached the scorer");
    assert.ok(
      events.some((e) => e.row === 2 && e.status === "no_description"),
      "the row is scored on its own fields and says it had no description",
    );
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = realKey;
  }
});
