// BEAUDIT A7: schemas/discovery-webhook-request.v1.schema.json and the worker
// parser must agree on every payload (promotes probes/A/schema-drift.mts).
// BEAUDIT A20: webhook v1.1 optional `idempotencyKey` is hashed into the runId.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import {
  deriveIdempotentRunId,
  handleDiscoveryWebhook,
} from "../../src/webhook/handle-discovery-webhook.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const load = (rel: string) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
(addFormatsModule as unknown as { default: (a: unknown) => void }).default(ajv);
const schema = ajv.compile(load("schemas/discovery-webhook-request.v1.schema.json"));

const SECRET = "parity-secret";

async function parserAccepts(body: unknown): Promise<{ ok: boolean; message: string }> {
  const res = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": SECRET, "x-discovery-auth-probe": "1" },
      bodyText: JSON.stringify(body),
    },
    {
      runDependencies: { runtimeConfig: { webhookSecret: SECRET } } as never,
      runDiscovery: async () => {
        throw new Error("must not run");
      },
    },
  );
  return { ok: res.status === 200, message: JSON.parse(res.body).message };
}

const base = {
  event: "command-center.discovery",
  schemaVersion: 1,
  sheetId: "1AbCdEfGhIjKlMnOp",
  variationKey: "var-abc",
  requestedAt: "2026-09-25T10:00:00.000Z",
  discoveryProfile: { targetRoles: "Engineer" },
};

// Rules the parser enforces that JSON Schema cannot express. Each is
// documented in AGENT_CONTRACT.md; everything else must agree exactly.
const PARSER_ONLY_REJECTIONS = new Set(["discoveryProfile blank intent"]);

const cases: Array<[string, unknown]> = [
  ["baseline", base],
  ["sheetId empty (local fallback)", { ...base, sheetId: "" }],
  ["sheetId missing (local fallback)", (() => { const { sheetId: _omit, ...rest } = base; return rest; })()],
  ["sheetId short (5)", { ...base, sheetId: "abcde" }],
  ["variationKey 1 char", { ...base, variationKey: "v" }],
  ["variationKey blank", { ...base, variationKey: "   " }],
  ["schemaVersion string '1'", { ...base, schemaVersion: "1" }],
  ["requestedAt non-ISO 'Sep 25 2026'", { ...base, requestedAt: "Sep 25 2026" }],
  ["ultraPlanTuning unknown key", { ...base, discoveryProfile: { targetRoles: "Eng", ultraPlanTuning: { foo: true } } }],
  ["groundedSearchTuning unknown key", { ...base, discoveryProfile: { targetRoles: "Eng", groundedSearchTuning: { foo: 1 } } }],
  ["ultraPlanTuning known keys", { ...base, discoveryProfile: { targetRoles: "Eng", ultraPlanTuning: { multiQueryEnabled: true } } }],
  ["companyAllowlist 501 entries", { ...base, companyAllowlist: Array.from({ length: 501 }, (_, i) => `Co${i}`) }],
  ["companyAllowlist duplicate entries (parser dedupes)", { ...base, companyAllowlist: ["Acme", "acme"] }],
  ["companyAllowlist blank entry", { ...base, companyAllowlist: ["  "] }],
  ["companyBlocklist 51 entries", { ...base, companyBlocklist: Array.from({ length: 51 }, (_, i) => `Co${i}`) }],
  ["discoveryProfile blank intent", { ...base, discoveryProfile: { targetRoles: "" } }],
  ["googleAccessToken number", { ...base, googleAccessToken: 123 }],
  ["mergedUserProfile array", { ...base, mergedUserProfile: [] }],
  ["idempotencyKey string", { ...base, idempotencyKey: "click-2026-09-25T10:00:00Z-1" }],
  ["idempotencyKey blank", { ...base, idempotencyKey: "  " }],
  ["idempotencyKey number", { ...base, idempotencyKey: 7 }],
  ["idempotencyKey too long", { ...base, idempotencyKey: "k".repeat(201) }],
];

for (const [name, body] of cases) {
  test(`A7 parity: ${name}`, async () => {
    const schemaOk = schema(body) === true;
    const parser = await parserAccepts(body);
    if (PARSER_ONLY_REJECTIONS.has(name)) {
      assert.equal(parser.ok, false, "documented parser-only rejection");
      return;
    }
    assert.equal(
      parser.ok,
      schemaOk,
      `schema=${schemaOk ? "accept" : `reject (${ajv.errorsText(schema.errors)})`} parser=${parser.ok ? "accept" : `reject (${parser.message})`}`,
    );
  });
}

for (const rel of [
  "examples/discovery-webhook-request.v1.json",
  "examples/discovery-webhook-request.v1-with-profile.json",
  "examples/discovery-webhook-request.v1-preview-parity.json",
  "examples/discovery-webhook-request.v1.1-idempotency.json",
]) {
  test(`A7 parity: example ${rel} is accepted by both`, async () => {
    const body = load(rel);
    assert.equal(schema(body), true, ajv.errorsText(schema.errors));
    assert.equal((await parserAccepts(body)).ok, true);
  });
}

test("A20: idempotencyKey decides the runId, independent of requestedAt and variationKey", () => {
  const a = deriveIdempotentRunId({
    sheetId: "sheet",
    variationKey: "v1",
    requestedAt: "2026-09-25T10:00:00.000Z",
    idempotencyKey: "click-1",
  });
  const b = deriveIdempotentRunId({
    sheetId: "sheet",
    variationKey: "v2",
    requestedAt: "2026-09-25T10:00:03.000Z",
    idempotencyKey: "click-1",
  });
  const other = deriveIdempotentRunId({
    sheetId: "sheet",
    variationKey: "v1",
    requestedAt: "2026-09-25T10:00:00.000Z",
    idempotencyKey: "click-2",
  });
  assert.ok(a);
  assert.equal(a, b);
  assert.notEqual(a, other);
});

test("A20: a second POST with the same idempotencyKey resolves to the first run and starts no second run", async () => {
  const states = new Map<string, Record<string, unknown>>();
  const store = {
    put: (p: Record<string, unknown>) => states.set(String(p.runId), p),
    get: (id: string) => states.get(id) ?? null,
    close() {},
  };
  let runs = 0;
  const deps = {
    runSynchronously: false,
    runStatusStore: store,
    maxRunDurationMs: 60_000,
    runDiscovery: () => {
      runs += 1;
      return new Promise(() => {});
    },
    runDependencies: {
      runtimeConfig: { webhookSecret: SECRET, runMode: "local" },
      loadStoredWorkerConfig: async () => ({ sheetId: "1AbCdEfGhIjKlMnOpQrSt", companies: [{ name: "Acme" }] }),
      now: () => new Date(),
    },
  } as never;
  const post = (requestedAt: string, variationKey: string) =>
    handleDiscoveryWebhook(
      {
        method: "POST",
        headers: { "x-discovery-secret": SECRET },
        bodyText: JSON.stringify({
          ...base,
          sheetId: "1AbCdEfGhIjKlMnOpQrSt",
          requestedAt,
          variationKey,
          googleAccessToken: "dashboard-token",
          idempotencyKey: "click-abc",
        }),
      },
      deps,
    );
  const first = JSON.parse((await post("2026-09-25T10:00:00.000Z", "var-1")).body);
  const second = JSON.parse((await post("2026-09-25T10:00:02.000Z", "var-2")).body);
  assert.equal(first.runId, second.runId);
  assert.equal(runs, 1);
});
