// Archived copy: ran from .lane-evidence/live-sample/ in the integration worktree (relative imports resolve from there).
// SCRP host-run live-provider sample. Fictional package only; the provider key is read into memory
// from the configured llm.json and never printed or written. Output is counts and booleans only.
import { startScribeRealService } from "../../tests/e2e-fixtures/scribe-real-service.mjs";
import { loadStoredLlmConfig, resolveActivePin } from "../../server/llm-config.mjs";
import { proposeEdits } from "../../server/materials-edit.mjs";

const realConfigPath = process.argv[2];
const config = loadStoredLlmConfig({ JOBBORED_LLM_CONFIG_PATH: realConfigPath });
if (!config) { console.log(JSON.stringify({ liveProvider: "unavailable", reason: "no stored llm config" })); process.exit(0); }
const pin = await resolveActivePin(config);
const fixture = await startScribeRealService({ propose: (args) => proposeEdits({ ...args, pin }) });
const results = [];
const requests = [
  ["resume", "Make the earlier-role line shorter."],
  ["resume", "Make two experience bullets punchier."],
  ["cover_letter", "Make the last paragraph warmer."],
  ["cover_letter", "Make the first paragraph more formal."],
];
const pkg = await fixture.seed({ slug: "acme-live-sample" });
const api = (path, init = {}) => fetch(fixture.baseUrl + pkg.path + path, { ...init, headers: { "Content-Type": "application/json" } });
const docKey = (doc) => (doc === "resume" ? "resume" : "coverLetter");

async function currentRun(doc) {
  const res = await api(`/versions?doc=${doc}`); const body = await res.json();
  return { runId: body.currentRunId, versions: body.versions || [] };
}
async function modelOf(runId) { return (await (await api(`/versions/${runId}/model`)).json()).model; }
async function readStream(url) {
  const res = await fetch(fixture.baseUrl + url); const text = await res.text();
  const events = []; for (const block of text.split("\n\n")) {
    const ev = /event: (\S+)/.exec(block)?.[1]; const data = /data: (.*)/.exec(block)?.[1];
    if (ev) events.push({ ev, data: data ? JSON.parse(data) : null });
  }
  return events;
}

for (const [doc, instruction] of requests) {
  const row = { doc, instruction, ok: false };
  try {
    const before = await currentRun(doc);
    const sibling = doc === "resume" ? "cover_letter" : "resume";
    const siblingBefore = await currentRun(sibling);
    const siblingModelBefore = JSON.stringify((await modelOf(siblingBefore.runId)).documents?.[docKey(sibling)] ?? null);
    const started = await (await api("/edits", { method: "POST", body: JSON.stringify({ doc, baseRunId: before.runId, instruction, lockFacts: true }) })).json();
    row.started = Boolean(started.proposalId);
    const events = await readStream(started.streamUrl);
    const ops = events.filter((e) => e.ev === "op").map((e) => e.data?.op || e.data);
    const done = events.filter((e) => e.ev === "done").map((e) => e.data?.status);
    row.ops = ops.length; row.blocked = events.filter((e) => e.ev === "blocked").length; row.done = done;
    const verified = ops.filter((op) => op && op.opId && !(op.unverified && op.unverified.length));
    row.verifiedOps = verified.length;
    if (!verified.length) { results.push(row); await api(`/edits/${started.proposalId}`, { method: "DELETE" }); continue; }
    const accept = await api(`/edits/${started.proposalId}/accept`, { method: "POST", body: JSON.stringify({ accept: verified.map((o) => o.opId), confirmUnverified: [] }) });
    row.acceptStatus = accept.status;
    const after = await currentRun(doc);
    row.newVersion = after.runId !== before.runId;
    row.provenance = after.versions.find((v) => v.runId === after.runId)?.source || null;
    const saved = await modelOf(after.runId);
    const leaves = []; (function walk(v){ if (typeof v === "string") leaves.push(v); else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x); })(saved.documents?.[docKey(doc)] ?? {}); const norm = (t) => String(t).replace(/\s+/g, " ").trim(); const savedText = leaves.map(norm).join("\n");
    row.savedContainsAccepted = verified.every((op) => op.text == null || savedText.includes(norm(op.text).slice(0, 40))); row.savedCheckDetail = verified.map((op) => ({ len: String(op.text || "").length, hasLeafEqual: leaves.some((l) => norm(l) === norm(op.text)) }));
    const preview = await (await api("/preview", { method: "POST", body: JSON.stringify({ doc, baseRunId: after.runId }) })).json();
    row.previewContainsAccepted = verified.every((op) => op.text == null || String(preview.html || "").includes(String(op.text).slice(0, 25).replace(/&/g, "&amp;")));
    const reopened = await currentRun(doc);
    row.reopenPersists = reopened.runId === after.runId;
    const siblingAfter = await currentRun(sibling);
    const siblingModelAfter = JSON.stringify((await modelOf(siblingAfter.runId)).documents?.[docKey(sibling)] ?? null);
    row.siblingEqual = siblingModelBefore === siblingModelAfter && siblingModelBefore !== "null";
    row.ok = row.acceptStatus === 200 && row.newVersion && row.savedContainsAccepted && row.reopenPersists && row.siblingEqual;
  } catch (error) { row.error = String(error?.code || error?.name || "error"); }
  results.push(row);
}
console.log(JSON.stringify({ provider: pin.provider, model: pin.resolvedModel || pin.model, results }, null, 1));
await fixture.close?.();
process.exit(0);
