/**
 * Materials request bridge — POST /api/applications/:slug/request.
 *
 * Enqueues an in-process draft on the local scraper server. The HTTP
 * handler returns immediately with pending.json on disk so the dossier
 * poller can show queued/drafting state.
 */

import { createMaterialsDrafter } from "./materials-drafter.mjs";

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
 */

/**
 * @typedef {object} MaterialsRequestOptions
 * @property {(payload: MaterialsRequestPayload) => Promise<Record<string, unknown>>} [enqueue]
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
 * .statusCode = 400 when the body is unusable.
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
  return { slug, company, title, feature, jobUrl, notes };
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
export function spawnMaterialsRequest(payload, options = {}) {
  const enqueue = typeof options.enqueue === "function" ? options.enqueue : getDefaultEnqueue();
  return enqueue(payload);
}
