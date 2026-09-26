/**
 * Materials request bridge — POST /api/applications/:slug/request.
 *
 * Enqueues an in-process draft on the local scraper server. The HTTP
 * handler returns immediately with pending.json on disk so the dossier
 * poller can show queued/drafting state.
 */

import { join } from "node:path";
import { getApplicationsRoot } from "./application-materials.mjs";
import { createMaterialsDrafter } from "./materials-drafter.mjs";
import {
  normalizeResumeSource,
  readResumeSnapshot,
  resumeRequiredError,
} from "./materials-resume-source.mjs";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const FEATURES = new Set(["resume", "cover_letter", "both"]);
const MAX_NOTES_LEN = 4000;

/**
 * @typedef {object} MaterialsRequestPayload
 * @property {string} slug
 * @property {string} company
 * @property {string} title
 * @property {string} feature
 * @property {string} jobUrl
 * @property {string} notes
 * @property {import("./materials-resume-source.mjs").ResumeSource | null} resume
 *   The user's own resume. Required unless resumeFrom is "snapshot".
 * @property {"snapshot"} [resumeFrom]
 *   Set by the repair path: redraft from the resume the role's last
 *   draft used (resume-source.json). Still 422s when there is none.
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
 * Validate and normalise a materials request body. Throws with
 * .statusCode = 400 when the body is unusable, and 422
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
  const resume = normalizeResumeSource(body && body.resume);
  const resumeFrom = body && body.resumeFrom === "snapshot" ? "snapshot" : undefined;
  if (!resume && !resumeFrom) {
    throw resumeRequiredError();
  }
  /** @type {MaterialsRequestPayload} */
  const payload = { slug, company, title, feature, jobUrl, notes, resume };
  if (resumeFrom && !resume) payload.resumeFrom = resumeFrom;
  return payload;
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
  const { resumeFrom: _resumeFrom, ...rest } = payload;
  return enqueue({ ...rest, resume });
}
