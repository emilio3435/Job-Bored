/**
 * Materials v3 — the claim ledger store (plan slice 1).
 *
 * The ledger is the only place candidate facts live: employers, claims
 * with metric tokens and tool lists, and a tool inventory with ownership
 * levels. It is built once per profile/resume change by
 * materials-ledger-build.mjs and read (never rebuilt) by claims.load.
 * Templates and prompts carry no facts.
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { resolveProfilePath } from "./user-profile.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const LEDGER_FILENAME = "claim-ledger.json";
export const LEDGER_CONTRACT = "materials.claim-ledger.v1";

const SCHEMA_PATH = resolvePath(__dirname, "..", "schemas", "materials-claim-ledger.v1.schema.json");

/** @type {import("ajv").ValidateFunction<unknown> | null} */
let cachedValidator = null;

function loadValidator() {
  if (cachedValidator) return cachedValidator;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const Ajv2020Constructor = /** @type {typeof import("ajv/dist/2020.js").default} */ (
    /** @type {unknown} */ (Ajv2020)
  );
  const addFormatsPlugin = /** @type {typeof import("ajv-formats").default} */ (
    /** @type {unknown} */ (addFormats)
  );
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
  addFormatsPlugin(ajv);
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/**
 * The ledger lives beside the profile it was built from.
 */
export function resolveLedgerPath() {
  return join(dirname(resolveProfilePath()), LEDGER_FILENAME);
}

/**
 * @param {unknown} candidate
 */
export function validateLedger(candidate) {
  const validate = loadValidator();
  const ok = validate(candidate);
  if (ok) return { ok: true, ledger: candidate };
  return {
    ok: false,
    errors: (validate.errors || []).map((e) => ({
      instancePath: e.instancePath || "",
      schemaPath: e.schemaPath || "",
      keyword: e.keyword || "",
      message: e.message || "validation failed",
      params: e.params || {},
    })),
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Content hash over the fact-bearing parts (employers, claims, tool
 * inventory) — the cache key's ledger segment. Metadata (builtAt, note)
 * does not move the hash.
 * @param {{ employers?: unknown, claims?: unknown, toolInventory?: unknown }} ledger
 */
export function hashLedger(ledger) {
  const body = stableStringify({
    employers: ledger.employers || [],
    claims: ledger.claims || [],
    toolInventory: ledger.toolInventory || [],
  });
  return `sha256:${createHash("sha256").update(body).digest("hex").slice(0, 16)}`;
}

/**
 * Read the stored ledger. Returns:
 *   { ok: true, ledger, path }
 *   { ok: false, reason: "no_ledger" } when nothing was built yet
 *   { ok: false, reason: "invalid_json" | "invalid_ledger", ... } otherwise
 */
export async function readLedger() {
  const path = resolveLedgerPath();
  if (!existsSync(path)) {
    return { ok: false, reason: "no_ledger" };
  }
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    return { ok: false, reason: "read_failed", detail: String(err) };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: "invalid_json", detail: String(err) };
  }
  const validation = validateLedger(parsed);
  if (!validation.ok) {
    return { ok: false, reason: "invalid_ledger", errors: validation.errors };
  }
  return { ok: true, ledger: parsed, path };
}

/**
 * Validate, stamp the hash, and write atomically (tmp + rename).
 * @param {Record<string, unknown>} ledger
 */
export async function writeLedgerAtomic(ledger) {
  const stamped = { ...ledger, contract: LEDGER_CONTRACT, ledgerHash: hashLedger(ledger) };
  const validation = validateLedger(stamped);
  if (!validation.ok) {
    const err = /** @type {Error & { code: string, errors: unknown }} */ (
      new Error("invalid_ledger")
    );
    err.code = "INVALID_LEDGER";
    err.errors = validation.errors;
    throw err;
  }
  const path = resolveLedgerPath();
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(stamped, null, 2) + "\n", "utf8");
  await rename(tmpPath, path);
  return { ledgerHash: stamped.ledgerHash, path };
}

/* ─── Queries ─────────────────────────────────────────────────────────── */

/**
 * @param {{ claims?: Array<{ id?: unknown }> }} ledger
 * @param {unknown} id
 */
export function claimById(ledger, id) {
  return (ledger.claims || []).find((c) => c && c.id === id) || null;
}

/**
 * @param {{ employers?: Array<{ id?: unknown }> }} ledger
 * @param {unknown} id
 */
export function employerById(ledger, id) {
  return (ledger.employers || []).find((e) => e && e.id === id) || null;
}

/**
 * Metric tokens exactly as they may appear in output.
 * @param {{ claims?: Array<{ id?: unknown, metrics?: Array<{ token?: unknown }> }> }} ledger
 * @param {unknown} claimId
 * @returns {string[]}
 */
export function metricsForClaim(ledger, claimId) {
  const claim = claimById(ledger, claimId);
  if (!claim || !Array.isArray(claim.metrics)) return [];
  return claim.metrics.map((m) => String(m.token || "")).filter(Boolean);
}

/**
 * @param {{ toolInventory?: Array<{ tool?: unknown, level?: unknown }> }} ledger
 * @param {string} level owned | adjacent | none
 * @returns {string[]}
 */
export function toolsByLevel(ledger, level) {
  return (ledger.toolInventory || [])
    .filter((t) => t && t.level === level)
    .map((t) => String(t.tool || ""))
    .filter(Boolean);
}
