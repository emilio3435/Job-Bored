/**
 * Materials request bridge — POST /api/applications/:slug/request.
 *
 * Enqueues an in-process draft on the local scraper server. The HTTP
 * handler returns immediately with pending.json on disk so the dossier
 * poller can show queued/drafting state.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getApplicationsRoot } from "./application-materials.mjs";
import { createMaterialsDrafter } from "./materials-drafter.mjs";
import { resolveFamily } from "./materials-templates.mjs";
import {
  normalizeResumeSource,
  readResumeSnapshot,
  resumeRequiredError,
} from "./materials-resume-source.mjs";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const FEATURES = new Set(["resume", "cover_letter", "both"]);
/* Wave 3: optional pieces generated beside the letter. */
export const EXTRAS = Object.freeze(["outreach"]);
const MAX_NOTES_LEN = 4000;
/* Plenty for a long posting with boilerplate; matches the resume cap. */
const MAX_JD_LEN = 60_000;

/**
 * @typedef {object} MaterialsRequestPayload
 * @property {string} slug
 * @property {string} company
 * @property {string} title
 * @property {string} feature
 * @property {string} jobUrl
 * @property {string} notes
 * @property {string} [jobDescription] pasted posting; the drafter prefers
 *   it over the cached JD and the scrape (F9)
 * @property {import("./materials-resume-source.mjs").ResumeSource | null} resume
 *   The user's own resume. Required unless resumeFrom is "snapshot".
 * @property {"snapshot"} [resumeFrom]
 *   Set by the repair path: redraft from the resume the role's last
 *   draft used (resume-source.json). Still 422s when there is none.
 * @property {string} [template] a template registry family named by this
 *   request (source "request")
 * @property {string} [preferredTemplate] the user's saved materialsTemplate
 *   preference (source "preference"); used when `template` is absent
 * @property {MaterialsEnrichment} [enrichment] what JobBored already knows
 *   about the role (C-4); the draft prompt carries it
 * @property {"cover_letter"} [then] U-5 "Draft both": after a resume run
 *   finishes, the drafter queues the cover letter as its own run
 * @property {string[]} [thenExtras] the extras ("outreach") that chained
 *   letter run asks for; a resume run itself never generates them
 * @property {string[]} [extras] optional pieces beside the letter (Wave 3):
 *   "outreach" = the LinkedIn note + email to the hiring manager
 *   (outreach.json / outreach.txt). Needs a letter (feature cover_letter
 *   or both); ignored for a resume-only request.
 * @property {{ feature: "resume" | "cover_letter", instruction: string, issues: Record<string, unknown>[], issueIds: string[], parentRunId: string, sourceText: string, sourceDraft: Record<string, unknown>, requestId?: string }} [repair]
 */

/**
 * @typedef {object} MaterialsEnrichment
 * @property {string} [fitAngle]
 * @property {string[]} [talkingPoints]
 * @property {string[]} [mustHaves]
 * @property {string} [contact]
 * @property {number} [fitScore] 0..10
 */

/**
 * @typedef {object} MaterialsRequestOptions
 * @property {(payload: MaterialsRequestPayload) => Promise<Record<string, unknown>>} [enqueue]
 * @property {string} [applicationsRoot] where resume-source.json snapshots live
 */

/**
 * @param {unknown} value
 * @param {number} [max]
 */
function trimString(value, max) {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\r/g, "").trim();
  if (max && trimmed.length > max) return trimmed.slice(0, max);
  return trimmed;
}

/**
 * @param {unknown} value
 * @param {number} maxItems
 * @param {number} maxLen
 * @returns {string[]}
 */
function stringList(value, maxItems, maxLen) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n|;\s*/) : [];
  return list
    .map((item) => trimString(typeof item === "string" ? item.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "") : "", maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Enrichment and sheet fields (C-4): read from `body.enrichment` or the
 * top-level fields of the same names. Absent → undefined.
 * @param {Record<string, unknown> | null | undefined} body
 * @returns {MaterialsEnrichment | undefined}
 */
export function normalizeEnrichment(body) {
  if (!body || typeof body !== "object") return undefined;
  const nested = body.enrichment && typeof body.enrichment === "object"
    ? /** @type {Record<string, unknown>} */ (body.enrichment)
    : {};
  const field = (/** @type {string} */ key) => (nested[key] !== undefined ? nested[key] : body[key]);
  /** @type {MaterialsEnrichment} */
  const out = {};
  const fitAngle = trimString(field("fitAngle"), 400);
  if (fitAngle) out.fitAngle = fitAngle;
  const talkingPoints = stringList(field("talkingPoints"), 6, 300);
  if (talkingPoints.length) out.talkingPoints = talkingPoints;
  const mustHaves = stringList(field("mustHaves"), 8, 200);
  if (mustHaves.length) out.mustHaves = mustHaves;
  const rawContact = field("contact");
  const contact = trimString(
    rawContact && typeof rawContact === "object" ? /** @type {{ name?: unknown }} */ (rawContact).name : rawContact,
    120,
  );
  if (contact && !/^unknown$/i.test(contact)) out.contact = contact;
  const rawScore = field("fitScore");
  const score = typeof rawScore === "number" ? rawScore : typeof rawScore === "string" && rawScore.trim() ? Number(rawScore) : NaN;
  if (Number.isFinite(score) && score >= 0 && score <= 10) out.fitScore = Math.round(score * 10) / 10;
  return Object.keys(out).length ? out : undefined;
}

/**
 * An optional family id: absent → undefined; present → must be a registry
 * family, else a 400 `unknown_template` listing the valid ids.
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalFamily(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const id = typeof value === "string" ? value.trim() : value;
  return resolveFamily(id).id;
}

/**
 * Validate and normalise a materials request body. Throws with
 * .statusCode = 400 when the body is unusable (including an unknown
 * `template` / `preferredTemplate`, code `unknown_template`), and 422
 * { code: "resume_required" } when it carries no resume text.
 * @param {Record<string, unknown> | null | undefined} body
 * @returns {MaterialsRequestPayload}
 */
export function normalizeRequestBody(body) {
  const slug = trimString(body && body.slug);
  if (!slug || !SLUG_PATTERN.test(slug)) {
    const err = /** @type {Error & { statusCode: number }} */ (
      new Error("Invalid slug")
    );
    err.statusCode = 400;
    throw err;
  }
  const feature = trimString(body && body.feature);
  if (!FEATURES.has(feature)) {
    const err = /** @type {Error & { statusCode: number }} */ (
      new Error("feature must be one of resume, cover_letter, both")
    );
    err.statusCode = 400;
    throw err;
  }
  const company = trimString(body && body.company, 200);
  const title = trimString(body && body.title, 200);
  if (!company) {
    const err = /** @type {Error & { statusCode: number }} */ (
      new Error("company is required")
    );
    err.statusCode = 400;
    throw err;
  }
  if (!title) {
    const err = /** @type {Error & { statusCode: number }} */ (
      new Error("title is required")
    );
    err.statusCode = 400;
    throw err;
  }
  const jobUrl = trimString(body && body.jobUrl, 1000);
  const notes = trimString(body && body.notes, MAX_NOTES_LEN);
  /* F9: a pasted posting in the body reaches the drafter's request-JD
   * branch (payload JD → cache → scrape). jdText is the legacy alias. */
  const jobDescription =
    trimString(body && body.jobDescription, MAX_JD_LEN) ||
    trimString(body && body.jdText, MAX_JD_LEN);
  const template = optionalFamily(body && body.template);
  const preferredTemplate = optionalFamily(body && body.preferredTemplate);
  const resume = normalizeResumeSource(body && body.resume);
  const resumeFrom = body && body.resumeFrom === "snapshot" ? "snapshot" : undefined;
  if (!resume && !resumeFrom) {
    throw resumeRequiredError();
  }
  /** @type {MaterialsRequestPayload} */
  const payload = { slug, company, title, feature, jobUrl, notes, resume };
  if (jobDescription) payload.jobDescription = jobDescription;
  if (resumeFrom && !resume) payload.resumeFrom = resumeFrom;
  if (template) payload.template = template;
  if (preferredTemplate) payload.preferredTemplate = preferredTemplate;
  const enrichment = normalizeEnrichment(body);
  if (enrichment) payload.enrichment = enrichment;
  /* U-5: only "resume, then the cover letter" chains; anything else is
   * ignored rather than refused, so an older client never breaks. */
  if (feature === "resume" && body && body.then === "cover_letter") {
    payload.then = "cover_letter";
    /* Wave 3 extras (extras: ["outreach"] or outreach: true) belong to the
     * letter, so Draft both hands them to the chained letter run. */
    const asked = Array.isArray(body.extras) && body.extras.some((x) => typeof x === "string" && x.trim() === "outreach");
    if (asked || body.outreach === true) payload.thenExtras = ["outreach"];
  }
  const extras = normalizeExtras(body);
  if (extras.length && feature !== "resume") payload.extras = extras;
  return payload;
}

/**
 * `extras: ["outreach"]` (or `outreach: true`); unknown values are dropped.
 * @param {Record<string, unknown> | null | undefined} body
 * @returns {string[]}
 */
export function normalizeExtras(body) {
  const raw = body && Array.isArray(body.extras) ? body.extras : [];
  const out = raw.filter((x) => typeof x === "string" && EXTRAS.includes(x.trim())).map((x) => String(x).trim());
  if (body && body.outreach === true) out.push("outreach");
  return [...new Set(out)];
}

/** @type {((payload: MaterialsRequestPayload) => Promise<Record<string, unknown>>) | null} */
let defaultEnqueue = null;

function getDefaultEnqueue() {
  if (!defaultEnqueue) {
    const drafter = createMaterialsDrafter({});
    defaultEnqueue = (payload) => drafter.enqueue(payload);
  }
  return defaultEnqueue;
}

/**
 * Accept a materials request onto the in-process FIFO.
 * @param {MaterialsRequestPayload} payload
 * @param {MaterialsRequestOptions} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function spawnMaterialsRequest(payload, options = {}) {
  const enqueue = typeof options.enqueue === "function" ? options.enqueue : getDefaultEnqueue();
  let resume = payload.resume;
  if (!resume && payload.resumeFrom === "snapshot") {
    const root = options.applicationsRoot || getApplicationsRoot();
    const snapshot = await readResumeSnapshot(join(root, payload.slug));
    if (snapshot) {
      const { usedAt: _usedAt, ...source } = snapshot;
      resume = source;
    }
  }
  if (!resume) throw resumeRequiredError();
  const { resumeFrom, ...rest } = payload;
  /* F8: the repair signal travels with the snapshot resume so the drafter
   * re-enters at the draft stage instead of regenerating from scratch. */
  return resumeFrom ? enqueue({ ...rest, resumeFrom, resume }) : enqueue({ ...rest, resume });
}

/** @type {Map<string, Promise<Record<string, unknown>>>} */
const repairRequestsInFlight = new Map();
/** @type {Map<string, Promise<Record<string, unknown>>>} */
const repairRequestsByApplication = new Map();

/**
 * Return the first accepted result for a requestId, including after the
 * queue has finished. The file stores only the id and accepted response.
 * @param {string} slug
 * @param {string | undefined} requestId
 * @param {() => Promise<Record<string, unknown>>} submit
 * @param {{ root?: string }} [options]
 */
export async function withRepairIdempotency(slug, requestId, submit, { root } = {}) {
  if (!SLUG_PATTERN.test(slug)) throw Object.assign(new Error("Invalid slug"), { statusCode: 400 });
  if (!requestId) return submit();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(requestId)) {
    throw Object.assign(new Error("Invalid requestId"), { statusCode: 400, code: "invalid_request_id" });
  }
  const dir = join(root || getApplicationsRoot(), slug);
  const key = `${dir}:\0${requestId}`;
  const pending = repairRequestsInFlight.get(key);
  if (pending) return pending;
  /* Serialize different IDs for one application so neither can overwrite
   * the other's just-persisted result. */
  const previous = repairRequestsByApplication.get(dir);
  const task = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
    const path = join(dir, "repair-requests.json");
    /** @type {Record<string, Record<string, unknown>>} */
    let saved = Object.create(null);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = Object.assign(Object.create(null), parsed);
    } catch {
      // First request for this application.
    }
    if (Object.hasOwn(saved, requestId)) return saved[requestId];
    const response = await submit();
    await mkdir(dir, { recursive: true });
    saved[requestId] = response;
    const entries = Object.entries(saved).slice(-100);
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`, "utf8");
    await rename(tmp, path);
    return response;
  });
  repairRequestsByApplication.set(dir, task);
  repairRequestsInFlight.set(key, task);
  try {
    return await task;
  } finally {
    repairRequestsInFlight.delete(key);
    if (repairRequestsByApplication.get(dir) === task) repairRequestsByApplication.delete(dir);
  }
}
