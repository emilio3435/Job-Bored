# Pipeline Write-Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-first `POST /pipeline-update` endpoint to the discovery worker so an external agent can advance an existing Pipeline row (stage, contact, notes, last-contact, reply) from inbound signals, matched by job URL.

**Architecture:** A new focused `pipeline-patcher` module reads the Pipeline tab, matches one row by normalized job URL (company+title fallback), and writes ONLY the progression columns via the Sheets `values:batchUpdate` API. A new `handle-pipeline-update` webhook handler validates the request (reusing the existing `x-discovery-secret` auth) and delegates to the patcher. A new route in `server.ts` wires it up. The contract is documented as schema + fixture + contract test, mirroring the discovery webhook contract.

**Why a new patcher instead of reusing `createPipelineWriter().write()`:** the discovery writer's `mergeExistingRow` *deliberately preserves* exactly the columns we need to write (Contact, Status, Notes, Last contact, Did they reply?) so re-discovery never clobbers user edits. Reusing it would silently no-op on those fields. The patcher is the inverse: it writes only those user/progression columns.

**Tech Stack:** TypeScript ESM run via `node --experimental-strip-types`; native `node:http` worker server; `node:test` + `node:assert/strict`; Google Sheets REST v4; `ajv/2020` + `ajv-formats` for contract validation.

## Global Constraints

- Node 24, npm 11 (matches CI and repo version files).
- Worker source is ESM TypeScript with **explicit `.ts` import extensions** and `import type` for types. Match this exactly.
- Test runner is `node:test`; assertions are `node:assert/strict`. No vitest/jest.
- New worker tests under `tests/sheets/` and `tests/webhook/` are auto-discovered by `npm run test:browser-use-discovery` (it globs those dirs).
- **Local-first auth:** the worker writes with its own `runtimeConfig` Google credential via `resolveAccessToken`. The request carries NO Google token — only `x-discovery-secret`.
- Pipeline column indices (0-based, mirror `PIPELINE_HEADER_ROW` in `contracts.ts`): Title=1, Company=2, Link=4, Contact=11, Status=12, Applied Date=13, Notes=14, Last contact=17, Did they reply?=18.
- `Status` enum: `New, Researching, Applied, Phone Screen, Interviewing, Offer, Rejected, Passed, Expired`.
- `Did they reply?` enum: `Yes, No, Unknown` (NOT "Y"/"N").
- Contract event const: `command-center.pipeline-update`; `schemaVersion` const `1`.

---

### Task 1: `pipeline-patcher` module

**Files:**
- Create: `integrations/browser-use-discovery/src/sheets/pipeline-patcher.ts`
- Modify: `integrations/browser-use-discovery/src/sheets/pipeline-writer.ts` (add `export` to the Sheets primitives the patcher reuses)
- Test: `integrations/browser-use-discovery/tests/sheets/pipeline-patcher.test.ts`

**Interfaces:**
- Consumes: `resolveAccessToken`, `getSheetValues`, `batchUpdateRows`, `DEFAULT_SHEET_NAME`, `DEFAULT_TOKEN_SCOPE`, `LAST_COLUMN_LETTER`, `FetchLike` (from `pipeline-writer.ts`); `normalizeLeadUrl` (from `../normalize/lead-normalizer.ts`); `PIPELINE_HEADER_ROW` (from `../contracts.ts`); `WorkerRuntimeConfig` (from `../config.ts`).
- Produces: `createPipelinePatcher(runtimeConfig, options?) => { patch(sheetId, input): Promise<PipelinePatchResult> }`; types `PipelinePatchInput`, `PipelinePatchResult`, `PipelinePatchFields`, `PipelineStatus`, `DidTheyReply`; const arrays `PIPELINE_STATUS_VALUES`, `DID_THEY_REPLY_VALUES`.

- [ ] **Step 1: Export the Sheets primitives from `pipeline-writer.ts`**

In `integrations/browser-use-discovery/src/sheets/pipeline-writer.ts`, add the `export` keyword to these existing declarations (find each, prepend `export`):
- `const DEFAULT_SHEET_NAME = "Pipeline";` (line ~75)
- `const DEFAULT_TOKEN_SCOPE = "https://www.googleapis.com/auth/spreadsheets";` (line ~76)
- `const LAST_COLUMN_LETTER = columnIndexToLetter(COLUMN_COUNT);` (line ~83)
- `async function getSheetValues(` (line ~444)
- `async function batchUpdateRows(` (line ~474)

Then export the `FetchLike` type. Run `grep -n "FetchLike" integrations/browser-use-discovery/src/sheets/pipeline-writer.ts` to find its declaration. If it is declared locally (`type FetchLike = ...`), prepend `export`. If it is imported, add a re-export line near the top: `export type { FetchLike } from "<that module>";`

- [ ] **Step 2: Write the failing test**

Create `integrations/browser-use-discovery/tests/sheets/pipeline-patcher.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { createPipelinePatcher } from "../../src/sheets/pipeline-patcher.ts";
import { PIPELINE_HEADER_ROW } from "../../src/contracts.ts";

const runtimeConfig = { googleAccessToken: "test-token" } as never;

type Call = { url: string; method: string; body?: string };

function mockFetch(existingRows: string[][]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL | string, init: { method?: string; body?: string } = {}) => {
    const url = String(input);
    const method = (init.method || "GET").toUpperCase();
    calls.push({ url, method, body: init.body });
    if (method === "GET" && /\/values\//.test(url)) {
      return { ok: true, status: 200, json: async () => ({ values: existingRows }), text: async () => "" };
    }
    if (method === "POST" && /values:batchUpdate/.test(url)) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
  }) as never;
  return { fetchImpl, calls };
}

function rowFor(opts: { url?: string; company?: string; title?: string; status?: string; notes?: string }): string[] {
  const row = new Array(PIPELINE_HEADER_ROW.length).fill("");
  row[1] = opts.title ?? "";
  row[2] = opts.company ?? "";
  row[4] = opts.url ?? "";
  row[12] = opts.status ?? "Applied";
  row[14] = opts.notes ?? "";
  return row;
}

test("patch updates status and appends a dated note, matched by url", async () => {
  const existing = [rowFor({ url: "https://acme.com/jobs/1", company: "Acme", title: "PM" })];
  const { fetchImpl, calls } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl, now: () => new Date("2026-06-18T10:00:00Z") });

  const result = await patcher.patch("sheet_1234567890", {
    job: { url: "https://acme.com/jobs/1" },
    fields: { stage: "Interviewing", note: "recruiter replied" },
  });

  assert.equal(result.matched, true);
  assert.equal(result.matchedBy, "url");
  assert.equal(result.rowNumber, 2);

  const update = calls.find((c) => /values:batchUpdate/.test(c.url));
  assert.ok(update, "expected a batchUpdate call");
  const body = JSON.parse(update.body as string);
  const written: string[] = body.data[0].values[0];
  assert.equal(written[12], "Interviewing");
  assert.equal(written[14], "[2026-06-18] recruiter replied");
  assert.match(body.data[0].range, /^Pipeline!A2:[A-Z]+2$/);
});

test("re-posting the same note is idempotent", async () => {
  const existing = [rowFor({ url: "https://acme.com/jobs/1", notes: "[2026-06-18] recruiter replied" })];
  const { fetchImpl, calls } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl, now: () => new Date("2026-06-18T10:00:00Z") });

  await patcher.patch("sheet_1234567890", { job: { url: "https://acme.com/jobs/1" }, fields: { note: "recruiter replied" } });

  const update = calls.find((c) => /values:batchUpdate/.test(c.url));
  const written: string[] = JSON.parse((update as Call).body as string).data[0].values[0];
  assert.equal(written[14], "[2026-06-18] recruiter replied");
});

test("returns matched:false and writes nothing when no row matches", async () => {
  const existing = [rowFor({ url: "https://other.com/x", company: "Other", title: "Eng" })];
  const { fetchImpl, calls } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl });

  const result = await patcher.patch("sheet_1234567890", { job: { url: "https://acme.com/jobs/1" }, fields: { stage: "Offer" } });

  assert.equal(result.matched, false);
  assert.equal(calls.some((c) => /values:batchUpdate/.test(c.url)), false);
});

test("matches by company+title when url is absent", async () => {
  const existing = [rowFor({ url: "https://acme.com/jobs/1", company: "Acme", title: "PM" })];
  const { fetchImpl } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl });

  const result = await patcher.patch("sheet_1234567890", { job: { company: "acme", title: "pm" }, fields: { stage: "Offer" } });

  assert.equal(result.matched, true);
  assert.equal(result.matchedBy, "company-title");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --experimental-strip-types --test integrations/browser-use-discovery/tests/sheets/pipeline-patcher.test.ts`
Expected: FAIL — cannot resolve `../../src/sheets/pipeline-patcher.ts` (module not created yet).

- [ ] **Step 4: Write the patcher implementation**

Create `integrations/browser-use-discovery/src/sheets/pipeline-patcher.ts`:

```ts
import type { WorkerRuntimeConfig } from "../config.ts";
import { PIPELINE_HEADER_ROW } from "../contracts.ts";
import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";
import {
  DEFAULT_SHEET_NAME,
  DEFAULT_TOKEN_SCOPE,
  LAST_COLUMN_LETTER,
  batchUpdateRows,
  getSheetValues,
  resolveAccessToken,
  type FetchLike,
} from "./pipeline-writer.ts";

// 0-based column indices in the Pipeline tab (mirror PIPELINE_HEADER_ROW).
const COL = {
  title: 1,
  company: 2,
  link: 4,
  contact: 11,
  status: 12,
  appliedDate: 13,
  notes: 14,
  lastContact: 17,
  didTheyReply: 18,
} as const;

export const PIPELINE_STATUS_VALUES = [
  "New", "Researching", "Applied", "Phone Screen",
  "Interviewing", "Offer", "Rejected", "Passed", "Expired",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUS_VALUES)[number];

export const DID_THEY_REPLY_VALUES = ["Yes", "No", "Unknown"] as const;
export type DidTheyReply = (typeof DID_THEY_REPLY_VALUES)[number];

export type PipelinePatchFields = {
  stage?: PipelineStatus;
  contact?: string;
  note?: string;
  lastContact?: string;
  appliedDate?: string;
  didTheyReply?: DidTheyReply;
};

export type PipelinePatchInput = {
  job: { url?: string; company?: string; title?: string };
  fields: PipelinePatchFields;
};

export type PipelinePatchResult = {
  matched: boolean;
  matchedBy?: "url" | "company-title";
  rowNumber?: number;
};

export type PipelinePatcherOptions = {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sheetName?: string;
  tokenScope?: string;
};

export type PipelinePatcher = {
  patch(sheetId: string, input: PipelinePatchInput): Promise<PipelinePatchResult>;
};

function isoDate(now: () => Date): string {
  return now().toISOString().slice(0, 10);
}

function appendNote(existing: string, note: string, date: string): string {
  const entry = `[${date}] ${note}`;
  if (!existing) return entry;
  const lines = existing.split("\n");
  if (lines.some((line) => line.trim() === entry)) return existing; // idempotent
  return `${entry}\n${existing}`;
}

function padRow(row: string[]): string[] {
  const out = row.slice();
  while (out.length < PIPELINE_HEADER_ROW.length) out.push("");
  return out;
}

export function createPipelinePatcher(
  runtimeConfig: WorkerRuntimeConfig,
  options: PipelinePatcherOptions = {},
): PipelinePatcher {
  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike);
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this runtime");
  }
  const now = options.now || (() => new Date());
  const sheetName = options.sheetName || DEFAULT_SHEET_NAME;
  const tokenScope = options.tokenScope || DEFAULT_TOKEN_SCOPE;

  async function patch(sheetId: string, input: PipelinePatchInput): Promise<PipelinePatchResult> {
    const token = await resolveAccessToken(runtimeConfig, fetchImpl, now, tokenScope);
    const rows = await getSheetValues(sheetId, `${sheetName}!A2:${LAST_COLUMN_LETTER}`, token, fetchImpl);

    const wantUrl = normalizeLeadUrl(input.job.url || "");
    const wantCompany = (input.job.company || "").trim().toLowerCase();
    const wantTitle = (input.job.title || "").trim().toLowerCase();

    let matchIndex = -1;
    let matchedBy: "url" | "company-title" | undefined;

    if (wantUrl) {
      matchIndex = rows.findIndex((row) => normalizeLeadUrl(row[COL.link] || "") === wantUrl);
      if (matchIndex >= 0) matchedBy = "url";
    }
    if (matchIndex < 0 && wantCompany && wantTitle) {
      matchIndex = rows.findIndex(
        (row) =>
          (row[COL.company] || "").trim().toLowerCase() === wantCompany &&
          (row[COL.title] || "").trim().toLowerCase() === wantTitle,
      );
      if (matchIndex >= 0) matchedBy = "company-title";
    }

    if (matchIndex < 0) return { matched: false };

    const rowNumber = matchIndex + 2; // +1 header, +1 for 1-based row numbers
    const patched = padRow(rows[matchIndex]);
    const { fields } = input;

    if (fields.stage !== undefined) patched[COL.status] = fields.stage;
    if (fields.contact !== undefined) patched[COL.contact] = fields.contact;
    if (fields.lastContact !== undefined) patched[COL.lastContact] = fields.lastContact;
    if (fields.appliedDate !== undefined) patched[COL.appliedDate] = fields.appliedDate;
    if (fields.didTheyReply !== undefined) patched[COL.didTheyReply] = fields.didTheyReply;
    if (fields.note !== undefined && fields.note !== "") {
      patched[COL.notes] = appendNote(patched[COL.notes] || "", fields.note, isoDate(now));
    }

    await batchUpdateRows(sheetId, [{ rowNumber, values: patched }], token, fetchImpl, sheetName);

    return { matched: true, matchedBy, rowNumber };
  }

  return { patch };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --experimental-strip-types --test integrations/browser-use-discovery/tests/sheets/pipeline-patcher.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Confirm no regression in the writer suite**

Run: `node --experimental-strip-types --test integrations/browser-use-discovery/tests/sheets/pipeline-writer.test.ts`
Expected: PASS (the added `export` keywords change nothing at runtime).

- [ ] **Step 7: Commit**

```bash
git add integrations/browser-use-discovery/src/sheets/pipeline-patcher.ts \
        integrations/browser-use-discovery/src/sheets/pipeline-writer.ts \
        integrations/browser-use-discovery/tests/sheets/pipeline-patcher.test.ts
git commit -m "feat(worker): add pipeline-patcher for progression-field row updates"
```

---

### Task 2: `handle-pipeline-update` webhook handler

**Files:**
- Create: `integrations/browser-use-discovery/src/webhook/handle-pipeline-update.ts`
- Test: `integrations/browser-use-discovery/tests/webhook/handle-pipeline-update.test.ts`

**Interfaces:**
- Consumes: `hasValidWebhookSecret`, `WebhookRequestLike`, `WebhookResponseLike` (from `./handle-discovery-webhook.ts`); `WorkerRuntimeConfig` (from `../config.ts`); `PIPELINE_STATUS_VALUES`, `DID_THEY_REPLY_VALUES`, `PipelinePatchInput`, `PipelinePatchResult`, `PipelineStatus`, `DidTheyReply` (from `../sheets/pipeline-patcher.ts`).
- Produces: `handlePipelineUpdateWebhook(request, dependencies): Promise<WebhookResponseLike>`; type `HandlePipelineUpdateDependencies` with `{ runtimeConfig, patchPipeline(sheetId, input), log? }`.

- [ ] **Step 1: Write the failing test**

Create `integrations/browser-use-discovery/tests/webhook/handle-pipeline-update.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { handlePipelineUpdateWebhook } from "../../src/webhook/handle-pipeline-update.ts";

const SECRET = "shared-secret";
const runtimeConfig = { webhookSecret: SECRET } as never;

function bodyOk() {
  return JSON.stringify({
    event: "command-center.pipeline-update",
    schemaVersion: 1,
    sheetId: "sheet_1234567890",
    job: { url: "https://acme.com/jobs/1" },
    fields: { stage: "Interviewing", note: "recruiter replied" },
  });
}

function makeRequest(overrides: { method?: string; headers?: Record<string, string>; bodyText?: string } = {}) {
  return {
    method: overrides.method ?? "POST",
    headers: { "content-type": "application/json", "x-discovery-secret": SECRET, ...(overrides.headers || {}) },
    bodyText: overrides.bodyText ?? bodyOk(),
  };
}

function makeDeps(patchResult: { matched: boolean; matchedBy?: string; rowNumber?: number } = { matched: true, matchedBy: "url", rowNumber: 2 }) {
  const calls: Array<{ sheetId: string; input: unknown }> = [];
  return {
    deps: {
      runtimeConfig,
      patchPipeline: async (sheetId: string, input: unknown) => {
        calls.push({ sheetId, input });
        return patchResult as never;
      },
    } as never,
    calls,
  };
}

test("rejects non-POST with 405", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(makeRequest({ method: "GET" }), deps);
  assert.equal(res.status, 405);
});

test("rejects bad secret with 401", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(makeRequest({ headers: { "x-discovery-secret": "wrong" } }), deps);
  assert.equal(res.status, 401);
});

test("rejects invalid JSON with 400", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(makeRequest({ bodyText: "not-json" }), deps);
  assert.equal(res.status, 400);
  assert.match(res.body, /valid JSON/);
});

test("rejects missing sheetId with 400", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(
    makeRequest({ bodyText: JSON.stringify({ job: { url: "x" }, fields: { stage: "Offer" } }) }),
    deps,
  );
  assert.equal(res.status, 400);
  assert.match(res.body, /sheetId/);
});

test("rejects invalid stage with 400", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(
    makeRequest({ bodyText: JSON.stringify({ sheetId: "sheet_1234567890", job: { url: "x" }, fields: { stage: "Chatting" } }) }),
    deps,
  );
  assert.equal(res.status, 400);
  assert.match(res.body, /stage must be one of/);
});

test("rejects missing identity with 400", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(
    makeRequest({ bodyText: JSON.stringify({ sheetId: "sheet_1234567890", job: {}, fields: { stage: "Offer" } }) }),
    deps,
  );
  assert.equal(res.status, 400);
});

test("happy path returns 200 and calls patchPipeline once", async () => {
  const { deps, calls } = makeDeps();
  const res = await handlePipelineUpdateWebhook(makeRequest(), deps);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.updated, true);
  assert.equal(body.row, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sheetId, "sheet_1234567890");
});

test("returns 404 when no row matches", async () => {
  const { deps } = makeDeps({ matched: false });
  const res = await handlePipelineUpdateWebhook(makeRequest(), deps);
  assert.equal(res.status, 404);
});

test("returns 502 when the patch throws", async () => {
  const deps = {
    runtimeConfig,
    patchPipeline: async () => {
      throw new Error("sheets down");
    },
  } as never;
  const res = await handlePipelineUpdateWebhook(makeRequest(), deps);
  assert.equal(res.status, 502);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/handle-pipeline-update.test.ts`
Expected: FAIL — cannot resolve `../../src/webhook/handle-pipeline-update.ts`.

- [ ] **Step 3: Write the handler implementation**

Create `integrations/browser-use-discovery/src/webhook/handle-pipeline-update.ts`:

```ts
import type { WorkerRuntimeConfig } from "../config.ts";
import {
  DID_THEY_REPLY_VALUES,
  PIPELINE_STATUS_VALUES,
  type DidTheyReply,
  type PipelinePatchInput,
  type PipelinePatchResult,
  type PipelineStatus,
} from "../sheets/pipeline-patcher.ts";
import {
  hasValidWebhookSecret,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";

export type HandlePipelineUpdateDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  patchPipeline: (sheetId: string, input: PipelinePatchInput) => Promise<PipelinePatchResult>;
  log?: (event: string, details?: Record<string, unknown>) => void;
};

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): WebhookResponseLike {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  };
}

type ParseResult =
  | { ok: true; sheetId: string; input: PipelinePatchInput }
  | { ok: false; message: string };

function parseRequest(bodyText: string | undefined): ParseResult {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(bodyText || "") as Record<string, unknown>;
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
  if (!record || typeof record !== "object") {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const sheetId = typeof record.sheetId === "string" ? record.sheetId.trim() : "";
  if (!sheetId) {
    return { ok: false, message: "sheetId is required." };
  }
  const job = (record.job ?? {}) as Record<string, unknown>;
  const url = typeof job.url === "string" ? job.url.trim() : "";
  const company = typeof job.company === "string" ? job.company.trim() : "";
  const title = typeof job.title === "string" ? job.title.trim() : "";
  if (!url && !(company && title)) {
    return { ok: false, message: "job.url, or both job.company and job.title, are required." };
  }
  const rawFields = (record.fields ?? {}) as Record<string, unknown>;
  const fields: PipelinePatchInput["fields"] = {};
  if ("stage" in rawFields) {
    const stage = rawFields.stage;
    if (typeof stage !== "string" || !PIPELINE_STATUS_VALUES.includes(stage as PipelineStatus)) {
      return { ok: false, message: `stage must be one of: ${PIPELINE_STATUS_VALUES.join(", ")}.` };
    }
    fields.stage = stage as PipelineStatus;
  }
  if ("didTheyReply" in rawFields) {
    const reply = rawFields.didTheyReply;
    if (typeof reply !== "string" || !DID_THEY_REPLY_VALUES.includes(reply as DidTheyReply)) {
      return { ok: false, message: `didTheyReply must be one of: ${DID_THEY_REPLY_VALUES.join(", ")}.` };
    }
    fields.didTheyReply = reply as DidTheyReply;
  }
  for (const key of ["contact", "note", "lastContact", "appliedDate"] as const) {
    if (key in rawFields) {
      if (typeof rawFields[key] !== "string") {
        return { ok: false, message: `${key} must be a string.` };
      }
      fields[key] = rawFields[key] as string;
    }
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, message: "fields must include at least one updatable field." };
  }
  return { ok: true, sheetId, input: { job: { url, company, title }, fields } };
}

export async function handlePipelineUpdateWebhook(
  request: WebhookRequestLike,
  dependencies: HandlePipelineUpdateDependencies,
): Promise<WebhookResponseLike> {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return jsonResponse(405, { ok: false, message: "Method not allowed" }, { allow: "POST,OPTIONS" });
  }
  const auth = hasValidWebhookSecret(dependencies.runtimeConfig.webhookSecret, request.headers);
  if (!auth.valid) {
    return jsonResponse(401, { ok: false, message: "Unauthorized pipeline-update request." });
  }
  const parsed = parseRequest(request.bodyText);
  if (!parsed.ok) {
    return jsonResponse(400, { ok: false, message: parsed.message });
  }
  let result: PipelinePatchResult;
  try {
    result = await dependencies.patchPipeline(parsed.sheetId, parsed.input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.log?.("pipeline-update.error", { message });
    return jsonResponse(502, { ok: false, message: "Failed to update pipeline.", detail: message });
  }
  if (!result.matched) {
    return jsonResponse(404, { ok: false, message: "No matching pipeline row." });
  }
  return jsonResponse(200, { ok: true, updated: true, matchedBy: result.matchedBy, row: result.rowNumber });
}
```

> If `grep -n "webhookSecret" integrations/browser-use-discovery/src/config.ts` shows the field has a different name, use that name in the `hasValidWebhookSecret(...)` call (it must match what `handle-discovery-profile.ts` passes).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/handle-pipeline-update.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add integrations/browser-use-discovery/src/webhook/handle-pipeline-update.ts \
        integrations/browser-use-discovery/tests/webhook/handle-pipeline-update.test.ts
git commit -m "feat(worker): add handle-pipeline-update webhook handler"
```

---

### Task 3: Wire `POST /pipeline-update` into the worker server

**Files:**
- Modify: `integrations/browser-use-discovery/src/server.ts` (add imports + a route block mirroring `/discovery-profile`)

**Interfaces:**
- Consumes: `handlePipelineUpdateWebhook`, `HandlePipelineUpdateDependencies` (Task 2); `createPipelinePatcher` (Task 1). Uses the in-scope `runtimeConfig`, `readBody`, `getHeaderValue`, `setHeaders`, `corsHeaders`, `logEvent`, `requestId`, `startedAt` already present in the `createServer` callback.

- [ ] **Step 1: Add imports**

At the top of `integrations/browser-use-discovery/src/server.ts`, with the other `./webhook/*` and `./sheets/*` imports, add:

```ts
import { handlePipelineUpdateWebhook } from "./webhook/handle-pipeline-update.ts";
import { createPipelinePatcher } from "./sheets/pipeline-patcher.ts";
```

- [ ] **Step 2: Add the route block**

In the `createServer` request callback, immediately after the closing brace of the `if (requestPath === "/discovery-profile") { ... }` block (ends near line 1176), add:

```ts
  if (requestPath === "/pipeline-update") {
    try {
      const bodyText = await readBody(request);
      logEvent("http.request.body", {
        requestId,
        method,
        path: requestPath,
        bytes: Buffer.byteLength(bodyText, "utf8"),
        contentType: getHeaderValue(request.headers["content-type"]) || undefined,
      });
      const patcher = createPipelinePatcher(runtimeConfig);
      const result = await handlePipelineUpdateWebhook(
        {
          method,
          headers: Object.fromEntries(
            Object.entries(request.headers).map(([key, value]) => [
              key,
              Array.isArray(value) ? value : (value ?? undefined),
            ]),
          ),
          bodyText,
        },
        {
          runtimeConfig,
          patchPipeline: (sheetId, input) => patcher.patch(sheetId, input),
          log: (event, details) =>
            logEvent(event, { requestId, method, path: requestPath, ...details }),
        },
      );
      logEvent("http.request.completed", {
        requestId,
        method,
        path: requestPath,
        status: result.status,
        durationMs: Date.now() - startedAt,
      });
      response.statusCode = result.status;
      setHeaders(response, { ...corsHeaders, ...result.headers });
      response.end(result.body);
      return;
    } catch (error) {
      // Mirror the catch/return at the end of the /discovery-profile block exactly
      // (same logEvent error shape, status 500, and response.end).
    }
  }
```

Open the existing `/discovery-profile` block, copy its `catch (error) { ... }` body verbatim into the placeholder above so error logging and the 500 response match the established pattern.

- [ ] **Step 3: Verify the worker suite is green (no handler regressions)**

Run: `npm run test:browser-use-discovery`
Expected: PASS, including the new `pipeline-patcher` and `handle-pipeline-update` suites.

- [ ] **Step 4: Manual smoke test the live route**

> Route glue has no dedicated automated test in this repo (the other worker routes are covered only by their handler unit tests). Verify the wiring manually.

Start the worker locally, then:

```bash
curl -s -X POST http://127.0.0.1:8644/pipeline-update \
  -H "content-type: application/json" \
  -H "x-discovery-secret: $BROWSER_USE_DISCOVERY_WEBHOOK_SECRET" \
  -d '{"event":"command-center.pipeline-update","schemaVersion":1,"sheetId":"<your-sheet-id>","job":{"url":"<a-url-in-your-pipeline>"},"fields":{"stage":"Interviewing","note":"smoke test"}}'
```

Expected: `{"ok":true,"updated":true,"matchedBy":"url","row":<n>}` and the matching Pipeline row's Status = `Interviewing` with a dated `smoke test` note. A bad secret returns `401`; an unknown URL returns `404`.

- [ ] **Step 5: Commit**

```bash
git add integrations/browser-use-discovery/src/server.ts
git commit -m "feat(worker): wire POST /pipeline-update route"
```

---

### Task 4: Contract artifacts (schema, fixture, contract test, docs)

**Files:**
- Create: `schemas/pipeline-update-request.v1.schema.json`
- Create: `examples/pipeline-update-request.v1.json`
- Create: `scripts/test-pipeline-update-contract.mjs`
- Modify: `package.json` (add `test:pipeline-update-contract`; append it to `test:contract:all`)
- Modify: `AGENT_CONTRACT.md` (document the new contract)
- Modify: `docs/CONTRACT-CHANGELOG.md` (add an entry)

**Interfaces:**
- Produces: a contract validated by `npm run test:pipeline-update-contract` and included in `npm run test:contract:all`.

- [ ] **Step 1: Write the failing contract test**

Create `scripts/test-pipeline-update-contract.mjs`:

```js
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const CASES = [
  {
    schema: "schemas/pipeline-update-request.v1.schema.json",
    example: "examples/pipeline-update-request.v1.json",
    label: "pipeline-update request",
  },
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

let failed = false;
for (const c of CASES) {
  const schema = JSON.parse(readFileSync(join(repoRoot, c.schema), "utf8"));
  const data = JSON.parse(readFileSync(join(repoRoot, c.example), "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    console.error(`Schema validation failed (${c.label}): ${c.example}`);
    console.error(validate.errors);
    failed = true;
  } else {
    console.log(`OK schema (${c.label}): ${c.example}`);
  }
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-pipeline-update-contract.mjs`
Expected: FAIL — `ENOENT` reading `schemas/pipeline-update-request.v1.schema.json` (not created yet).

- [ ] **Step 3: Create the schema**

Create `schemas/pipeline-update-request.v1.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/job-bored/command-center/schemas/pipeline-update-request.v1.schema.json",
  "title": "Command Center pipeline update (POST body)",
  "description": "Sent by an external agent to advance an existing Pipeline row from inbound signals (e.g. recruiter email). schemaVersion 1.",
  "type": "object",
  "additionalProperties": true,
  "required": ["event", "schemaVersion", "sheetId", "job", "fields"],
  "properties": {
    "event": { "type": "string", "const": "command-center.pipeline-update" },
    "schemaVersion": { "type": "integer", "const": 1 },
    "sheetId": { "type": "string", "minLength": 10 },
    "job": {
      "type": "object",
      "additionalProperties": true,
      "description": "Row identity. Provide url, or both company and title.",
      "properties": {
        "url": { "type": "string" },
        "company": { "type": "string" },
        "title": { "type": "string" }
      },
      "anyOf": [
        { "required": ["url"], "properties": { "url": { "type": "string", "minLength": 1 } } },
        { "required": ["company", "title"], "properties": { "company": { "type": "string", "minLength": 1 }, "title": { "type": "string", "minLength": 1 } } }
      ]
    },
    "fields": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "properties": {
        "stage": { "type": "string", "enum": ["New", "Researching", "Applied", "Phone Screen", "Interviewing", "Offer", "Rejected", "Passed", "Expired"] },
        "contact": { "type": "string" },
        "note": { "type": "string" },
        "lastContact": { "type": "string" },
        "appliedDate": { "type": "string" },
        "didTheyReply": { "type": "string", "enum": ["Yes", "No", "Unknown"] }
      }
    }
  }
}
```

- [ ] **Step 4: Create the example fixture**

Create `examples/pipeline-update-request.v1.json`:

```json
{
  "event": "command-center.pipeline-update",
  "schemaVersion": 1,
  "sheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2up",
  "job": { "url": "https://boards.greenhouse.io/acme/jobs/12345" },
  "fields": {
    "stage": "Interviewing",
    "lastContact": "2026-06-18",
    "note": "Recruiter replied; phone screen scheduled.",
    "didTheyReply": "Yes"
  }
}
```

- [ ] **Step 5: Run the contract test to verify it passes**

Run: `node scripts/test-pipeline-update-contract.mjs`
Expected: `OK schema (pipeline-update request): examples/pipeline-update-request.v1.json`, exit 0.

- [ ] **Step 6: Wire the npm scripts**

In `package.json` `scripts`, add:

```json
"test:pipeline-update-contract": "node scripts/test-pipeline-update-contract.mjs",
```

And change `test:contract:all` from:

```json
"test:contract:all": "npm run test:contract && npm run test:ats-contract && npm run test:pipeline-contract && npm run lint:skills",
```

to:

```json
"test:contract:all": "npm run test:contract && npm run test:ats-contract && npm run test:pipeline-contract && npm run test:pipeline-update-contract && npm run lint:skills",
```

- [ ] **Step 7: Verify the aggregate contract suite passes**

Run: `npm run test:contract:all`
Expected: PASS (all contract scripts, including the new one).

- [ ] **Step 8: Document the contract**

In `AGENT_CONTRACT.md`, add a section after the discovery webhook contract:

```markdown
## Pipeline update (`POST /pipeline-update`, schemaVersion 1)

An external agent advances an existing Pipeline row from inbound signals. Local-first: authenticated with `x-discovery-secret`; the worker writes with its own Google credential (no token in the request).

- `event`: `"command-center.pipeline-update"` (const)
- `schemaVersion`: `1` (const)
- `sheetId`: target Google Sheet (required)
- `job`: row identity — `url` (preferred), or both `company` and `title`
- `fields` (at least one): `stage` (one of: New, Researching, Applied, Phone Screen, Interviewing, Offer, Rejected, Passed, Expired), `contact`, `note` (appended as a dated, deduped line), `lastContact`, `appliedDate`, `didTheyReply` (Yes | No | Unknown)

Matching is by normalized job URL, falling back to company+title. Unknown rows return `404` (this contract updates existing rows only; discovery creates rows). Schema: `schemas/pipeline-update-request.v1.schema.json`; fixture: `examples/pipeline-update-request.v1.json`.
```

- [ ] **Step 9: Add the changelog entry**

In `docs/CONTRACT-CHANGELOG.md`, add as the first row of the table body:

```markdown
| 2026-06-18 | Added the **pipeline-update** contract: `schemas/pipeline-update-request.v1.schema.json`, fixture `examples/pipeline-update-request.v1.json`, worker endpoint `POST /pipeline-update`, and `npm run test:pipeline-update-contract` (wired into `test:contract:all`). Lets an external agent advance an existing Pipeline row (Status, Contact, Notes, Last contact, Did they reply?) from inbound signals; matched by job URL with company+title fallback; local-first auth via `x-discovery-secret`; writes use the worker's own Google credential. | Additive — new interface contract; existing receivers unaffected. |
```

- [ ] **Step 10: Commit**

```bash
git add schemas/pipeline-update-request.v1.schema.json \
        examples/pipeline-update-request.v1.json \
        scripts/test-pipeline-update-contract.mjs \
        package.json AGENT_CONTRACT.md docs/CONTRACT-CHANGELOG.md
git commit -m "feat(contract): add pipeline-update request schema, fixture, and contract test"
```

---

### Task 5: Agent-driving doc + watcher wiring note

**Files:**
- Create: `docs/PIPELINE-UPDATE-AGENT.md` (how a BYO agent drives the seam)

**Interfaces:**
- Consumes: the `POST /pipeline-update` endpoint (Task 3) and the contract (Task 4).

- [ ] **Step 1: Write the agent-driving doc**

Create `docs/PIPELINE-UPDATE-AGENT.md`:

```markdown
# Driving the pipeline from an external agent

The discovery worker exposes `POST /pipeline-update` (local-first, `x-discovery-secret`).
Any agent that detects a job-search development can advance the matching Pipeline row.

## Request

```bash
curl -s -X POST http://127.0.0.1:8644/pipeline-update \
  -H "content-type: application/json" \
  -H "x-discovery-secret: $BROWSER_USE_DISCOVERY_WEBHOOK_SECRET" \
  -d '{
    "event": "command-center.pipeline-update",
    "schemaVersion": 1,
    "sheetId": "<your-sheet-id>",
    "job": { "url": "<job url already in your pipeline>" },
    "fields": { "stage": "Interviewing", "lastContact": "2026-06-18", "note": "recruiter replied", "didTheyReply": "Yes" }
  }'
```

Response: `{ "ok": true, "updated": true, "matchedBy": "url", "row": <n> }`.
Unknown row → `404`; bad secret → `401`. See `AGENT_CONTRACT.md` for the full field list.

## Wiring the job-opportunity-watcher (reference agent)

This is a change to your **agent's** prompt, not the repo. After the watcher records a
new development in its tracker, add a step that POSTs the update above with the
matching job's URL and the new stage/note. The watcher keeps drafting replies as before —
this only mirrors progressions into the Pipeline so the dashboard card moves.
```

- [ ] **Step 2: Commit**

```bash
git add docs/PIPELINE-UPDATE-AGENT.md
git commit -m "docs: how an external agent drives the pipeline-update seam"
```

> **Manual follow-up (outside the repo):** Add the POST step to `~/Documents/Claude/Scheduled/job-opportunity-watcher/SKILL.md` so the watcher mirrors each new development into the Pipeline. The exact stage values it sends must be from the `Status` enum; map its finer interview stages (if any) onto: Phone Screen / Interviewing / Offer / Rejected.

---

## Final verification

- [ ] Run the full worker suite: `npm run test:browser-use-discovery` — PASS
- [ ] Run the full contract suite: `npm run test:contract:all` — PASS
- [ ] Run the repo gate: `npm test` — PASS

## Self-Review

**Spec coverage:**
- `pipeline-update` message → Task 4 (schema) + Task 2 (handler parse/validate). ✓
- Endpoint receives it → Task 2 (handler) + Task 3 (route). ✓
- Reuse Sheets-write machinery → **refined**: the spec said "reuse pipeline-writer"; the writer *protects* the target columns, so Task 1 builds a focused `pipeline-patcher` reusing the writer's low-level Sheets primitives instead. ✓ (intentional divergence, documented above)
- Local-first auth → Task 2/3 (`hasValidWebhookSecret` + `runtimeConfig` credential). ✓
- Identity by URL + company/title fallback → Task 1. ✓
- Idempotent note append → Task 1 (`appendNote`) + test. ✓
- Contract artifacts + tests → Task 4. ✓
- Agent-side wiring → Task 5. ✓
- **Spec correction:** `didTheyReply` uses `Yes/No/Unknown` (the real enum), not the `"Y"` in the spec example.

**Placeholder scan:** The only intentional "fill-in" is the Task 3 `catch` body, which instructs copying the existing `/discovery-profile` catch verbatim (the real content lives in the file being edited). No TBD/TODO elsewhere; all code blocks are complete.

**Type consistency:** `PipelinePatchInput`/`PipelinePatchResult`/`PipelineStatus`/`DidTheyReply` and `PIPELINE_STATUS_VALUES`/`DID_THEY_REPLY_VALUES` are defined in Task 1 and consumed with the same names in Task 2/Task 3. `handlePipelineUpdateWebhook` + `HandlePipelineUpdateDependencies` defined in Task 2, consumed in Task 3. `createPipelinePatcher` defined in Task 1, consumed in Task 3.
