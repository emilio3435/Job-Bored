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
import { resolveFamily } from "./materials-templates.mjs";
import {
  normalizeResumeSource,
  readResumeSnapshot,
  resumeRequiredError,
} from "./materials-resume-source.mjs";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const FEATURES = new Set(["resume", "cover_letter", "both"]);
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
  const { resumeFrom, ...rest } = payload;
  /* F8: the repair signal travels with the snapshot resume so the drafter
   * re-enters at the draft stage instead of regenerating from scratch. */
  return resumeFrom ? enqueue({ ...rest, resumeFrom, resume }) : enqueue({ ...rest, resume });
}
