/**
 * The model the last draft actually used (CDESK MODELUI).
 *
 * Every drafted package writes run.json with a `pin` block
 * ({ provider, requestedModel, resolvedModel }); the drafter deletes
 * pending.json on success, so run.json is the durable record. This scans the
 * applications root for the newest run.json that carries a pin and returns
 * the facts Settings shows as "Last draft used …". Regenerate runs make no
 * LLM call and carry no pin, so they are skipped. Only the newest run.json
 * files (by their own mtime; a re-draft rewrites run.json in place, which
 * leaves the folder's mtime alone) are read, at most LAST_DRAFT_MAX_READS, so
 * a large applications root never costs one read per package on every
 * Settings open.
 *
 * Read-only. No secrets: run.json never holds a key.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getApplicationsRoot, isValidSlug } from "./application-materials.mjs";

/** Settings opens call this every time; read at most this many run.json. */
export const LAST_DRAFT_MAX_READS = 20;

/**
 * @typedef {object} LastDraft
 * @property {string} slug
 * @property {string} company
 * @property {string} title
 * @property {string} feature
 * @property {string} provider
 * @property {string} requestedModel
 * @property {string} resolvedModel
 * @property {string} finishedAt
 */

/**
 * @param {string} path
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readJsonObject(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {{ root?: string }} [options]
 * @returns {Promise<LastDraft | null>}
 */
export async function readLastDraft(options = {}) {
  const root = typeof options.root === "string" && options.root ? options.root : getApplicationsRoot();
  let names;
  try {
    names = await readdir(root);
  } catch {
    return null;
  }
  /** @type {{ slug: string, mtimeMs: number }[]} */
  const runs = [];
  for (const slug of names) {
    if (!isValidSlug(slug)) continue;
    try {
      const info = await stat(join(root, slug, "run.json"));
      if (info.isFile()) runs.push({ slug, mtimeMs: info.mtimeMs });
    } catch {
      // No run.json yet, or unreadable: skip it.
    }
  }
  runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  /** @type {{ slug: string, run: Record<string, unknown>, pin: Record<string, unknown>, finishedMs: number } | null} */
  let newest = null;
  for (const { slug } of runs.slice(0, LAST_DRAFT_MAX_READS)) {
    const run = await readJsonObject(join(root, slug, "run.json"));
    if (!run) continue;
    const pin = run.pin && typeof run.pin === "object" && !Array.isArray(run.pin)
      ? /** @type {Record<string, unknown>} */ (run.pin)
      : null;
    if (!pin || !(str(pin.resolvedModel) || str(pin.requestedModel))) continue;
    const finishedMs = Date.parse(str(run.finishedAt));
    if (!Number.isFinite(finishedMs)) continue;
    if (!newest || finishedMs > newest.finishedMs) newest = { slug, run, pin, finishedMs };
  }
  if (!newest) return null;
  const manifest = await readJsonObject(join(root, newest.slug, "manifest.json"));
  return {
    slug: newest.slug,
    company: str(manifest && manifest.company),
    title: str(manifest && manifest.title),
    feature: str(newest.run.feature),
    provider: str(newest.pin.provider),
    requestedModel: str(newest.pin.requestedModel),
    resolvedModel: str(newest.pin.resolvedModel),
    finishedAt: new Date(newest.finishedMs).toISOString(),
  };
}
