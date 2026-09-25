// Schema-vs-parser drift probe (read-only). Run from worktree root:
//   node --experimental-strip-types .lane-evidence/probes/schema-drift.mts
// Feeds the same payloads to the JSON Schema (ajv 2020) and to the worker's real parsers
// (handleDiscoveryWebhook / handlePipelineUpdateWebhook with stubbed deps) and prints disagreements.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { handleDiscoveryWebhook } from "../../integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts";
import { handlePipelineUpdateWebhook } from "../../integrations/browser-use-discovery/src/webhook/handle-pipeline-update.ts";
import {
  PIPELINE_PATCH_FIELD_KEYS,
  PIPELINE_STATUS_VALUES,
  DID_THEY_REPLY_VALUES,
} from "../../integrations/browser-use-discovery/src/sheets/pipeline-patcher.ts";

const ajv = new Ajv2020({ allErrors: true, strict: false });
(addFormatsModule as unknown as { default: (a: unknown) => void }).default(ajv);
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const discSchema = ajv.compile(load("schemas/discovery-webhook-request.v1.schema.json"));
const pipeSchema = ajv.compile(load("schemas/pipeline-update-request.v1.schema.json"));

const SECRET = "probe-secret";
const headers = { "x-discovery-secret": SECRET, "x-discovery-auth-probe": "1" };

// Auth-probe header makes the handler return right after parse: 200 = parser accepted, 400 = rejected.
async function discParser(body: unknown): Promise<string> {
  const res = await handleDiscoveryWebhook(
    { method: "POST", headers, bodyText: JSON.stringify(body) },
    {
      runDependencies: { runtimeConfig: { webhookSecret: SECRET } } as never,
      runDiscovery: async () => { throw new Error("must not run"); },
    },
  );
  return res.status === 200 ? "accept" : `reject(${res.status}: ${JSON.parse(res.body).message})`;
}

async function pipeParser(body: unknown): Promise<string> {
  const res = await handlePipelineUpdateWebhook(
    { method: "POST", headers: { "x-discovery-secret": SECRET }, bodyText: JSON.stringify(body) },
    {
      runtimeConfig: { webhookSecret: SECRET } as never,
      patchPipeline: async () => ({ matched: true, matchedBy: "url", rowNumber: 2 }) as never,
    },
  );
  return res.status === 200 ? "accept" : `reject(${res.status}: ${JSON.parse(res.body).message})`;
}

const base = {
  event: "command-center.discovery",
  schemaVersion: 1,
  sheetId: "1AbCdEfGhIjKlMnOp",
  variationKey: "var-abc",
  requestedAt: "2026-09-25T10:00:00.000Z",
  discoveryProfile: { targetRoles: "Engineer" },
};

const discCases: Array<[string, unknown]> = [
  ["baseline", base],
  ["sheetId empty", { ...base, sheetId: "" }],
  ["sheetId short (5)", { ...base, sheetId: "abcde" }],
  ["variationKey 1 char", { ...base, variationKey: "v" }],
  ["schemaVersion string '1'", { ...base, schemaVersion: "1" }],
  ["requestedAt non-ISO 'Sep 25 2026'", { ...base, requestedAt: "Sep 25 2026" }],
  ["ultraPlanTuning unknown key", { ...base, discoveryProfile: { targetRoles: "Eng", ultraPlanTuning: { foo: true } } }],
  ["groundedSearchTuning unknown key", { ...base, discoveryProfile: { targetRoles: "Eng", groundedSearchTuning: { foo: 1 } } }],
  ["companyAllowlist 501 entries", { ...base, companyAllowlist: Array.from({ length: 501 }, (_, i) => `Co${i}`) }],
  ["companyBlocklist 51 entries", { ...base, companyBlocklist: Array.from({ length: 51 }, (_, i) => `Co${i}`) }],
  ["discoveryProfile blank intent", { ...base, discoveryProfile: { targetRoles: "" } }],
  ["googleAccessToken number", { ...base, googleAccessToken: 123 }],
  ["mergedUserProfile array", { ...base, mergedUserProfile: [] }],
];

console.log("== discovery-webhook-request.v1: schema vs parser ==");
for (const [name, body] of discCases) {
  const schemaOk = discSchema(body);
  const parser = await discParser(body);
  const agree = schemaOk === parser.startsWith("accept");
  console.log(`${agree ? "  same" : "DRIFT"} | ${name} | schema=${schemaOk ? "accept" : "reject"} | parser=${parser}`);
}

for (const f of ["examples/discovery-webhook-request.v1.json", "examples/discovery-webhook-request.v1-with-profile.json", "examples/discovery-webhook-request.v1-preview-parity.json"]) {
  const body = load(f);
  console.log(`example ${f}: schema=${discSchema(body) ? "valid" : "INVALID " + ajv.errorsText(discSchema.errors)} parser=${await discParser(body)}`);
}

const schemaJson = load("schemas/pipeline-update-request.v1.schema.json");
const schemaFields = Object.keys(schemaJson.properties.fields.properties).sort();
const schemaStages = schemaJson.properties.fields.properties.stage?.enum ?? [];
const schemaReplies = schemaJson.properties.fields.properties.didTheyReply?.enum ?? [];
console.log("\n== pipeline-update-request.v1 ==");
console.log("schema fields :", schemaFields.join(","));
console.log("code fields   :", [...PIPELINE_PATCH_FIELD_KEYS].sort().join(","));
console.log("schema stages :", schemaStages.join(","));
console.log("code stages   :", [...PIPELINE_STATUS_VALUES].join(","));
console.log("schema replies:", schemaReplies.join(","));
console.log("code replies  :", [...DID_THEY_REPLY_VALUES].join(","));
const pBase = { event: "command-center.pipeline-update", schemaVersion: 1, sheetId: "1AbCdEfGhIjKlMnOp", job: { url: "https://x.example/job/1" }, fields: { stage: "Applied" } };
const pipeCases: Array<[string, unknown]> = [
  ["baseline", pBase],
  ["sheetId short", { ...pBase, sheetId: "abc" }],
  ["job missing url+title", { ...pBase, job: { company: "Acme" } }],
  ["fields empty", { ...pBase, fields: {} }],
  ["stage Rejected", { ...pBase, fields: { stage: "Rejected" } }],
  ["stage Passed", { ...pBase, fields: { stage: "Passed" } }],
  ["contact number", { ...pBase, fields: { contact: 5 } }],
];
for (const [name, body] of pipeCases) {
  const schemaOk = pipeSchema(body);
  const parser = await pipeParser(body);
  const agree = schemaOk === parser.startsWith("accept");
  console.log(`${agree ? "  same" : "DRIFT"} | ${name} | schema=${schemaOk ? "accept" : "reject"} | parser=${parser}`);
}
const pex = load("examples/pipeline-update-request.v1.json");
console.log(`example pipeline-update-request.v1.json: schema=${pipeSchema(pex) ? "valid" : "INVALID"} parser=${await pipeParser(pex)}`);
