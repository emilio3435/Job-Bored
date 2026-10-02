/**
 * HOLES HOST: GET /health?deep=1, the readiness half of /health.
 *
 * The materials modules read ../schemas, ../templates/materials and
 * ../vendor/fonts at request time, so an image without them boots, answers
 * /health and then fails every materials route (S2). This proves those
 * three are present (ok = all three) and reports the two optional pieces:
 * the PDF browser and the logo resolver. Details name no absolute paths.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { getLogoResolverScript, logoResolverGate } from "./brand-logos.mjs";
import { probePdfBrowser } from "./materials-pdf.mjs";
import { materialsFontFaces } from "./materials-render.mjs";
import { listFamilies } from "./materials-templates.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolvePath(__dirname, "..", "schemas");
const FONTS_DIR = resolvePath(__dirname, "..", "vendor", "fonts");

/** The schemas the materials modules compile at request time. */
const MATERIALS_SCHEMAS = [
  "materials-claim-ledger.v1.schema.json",
  "materials-draft.v1.schema.json",
  "materials-draft.v2.schema.json",
  "materials-edit-op.v1.schema.json",
  "materials-jd-extract.v1.schema.json",
  "materials-render-model.v1.schema.json",
  "materials-run.v1.schema.json",
  "materials-selection.v1.schema.json",
];

/** @typedef {{ ok: boolean, detail?: string } & Record<string, unknown>} Check */

/**
 * A missing directory reads as `missing`; any other message is kept only
 * when it names no absolute path (the template registry's own messages are
 * repo-relative).
 * @param {unknown} err
 * @param {string} missing
 */
function failureDetail(err, missing) {
  const error = /** @type {{ code?: unknown, message?: unknown } | null} */ (err);
  if (error && error.code === "ENOENT") return missing;
  const message = String((error && error.message) || "");
  if (!message || /(^|[\s'"(])\/|[A-Za-z]:\\/.test(message)) return "failed to load";
  return message.slice(0, 200);
}

/** @returns {Check} */
export function checkSchemas(dir = SCHEMAS_DIR) {
  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch (err) {
    return { ok: false, detail: failureDetail(err, "schemas/ is missing") };
  }
  const missing = MATERIALS_SCHEMAS.filter((name) => !names.includes(name));
  if (missing.length) return { ok: false, count: names.length, detail: `missing ${missing.join(", ")}` };
  const unparseable = names.filter((name) => {
    try {
      JSON.parse(readFileSync(join(dir, name), "utf8"));
      return false;
    } catch {
      return true;
    }
  });
  if (unparseable.length) return { ok: false, count: names.length, detail: `unparseable ${unparseable.join(", ")}` };
  return { ok: true, count: names.length };
}

/** @returns {Check} */
export function checkTemplates(list = listFamilies) {
  try {
    return { ok: true, families: list().map((family) => family.id) };
  } catch (err) {
    return { ok: false, detail: failureDetail(err, "templates/materials/ is missing") };
  }
}

/** @returns {Check} */
export function checkFonts(faces = materialsFontFaces, dir = FONTS_DIR) {
  /** @type {{ src: string }[]} */
  let list;
  try {
    list = faces();
  } catch (err) {
    return { ok: false, detail: failureDetail(err, "vendor/fonts/ is missing") };
  }
  if (!list.length) return { ok: false, detail: "no font faces declared" };
  const missing = list.filter((face) => !face.src || !existsSync(join(dir, face.src)));
  if (missing.length) return { ok: false, faces: list.length, detail: `${missing.length} font files missing` };
  return { ok: true, faces: list.length };
}

/* A launch costs a second of CPU, so one verdict serves five minutes and
 * concurrent callers share it. */
const PLAYWRIGHT_TTL_MS = 5 * 60_000;
/** @type {{ at: number, verdict: Promise<Check> } | null} */
let playwrightVerdict = null;

/**
 * Optional: without a browser, renders keep their HTML and skip the PDF.
 * @param {{ probe?: () => Promise<{ ok: boolean, detail?: string }>, env?: NodeJS.ProcessEnv, now?: () => number }} [options]
 * @returns {Promise<Check>}
 */
export function checkPlaywright({
  probe = () => probePdfBrowser({ timeoutMs: 15_000 }),
  env = process.env,
  now = Date.now,
} = {}) {
  if (!playwrightVerdict || now() - playwrightVerdict.at > PLAYWRIGHT_TTL_MS) {
    const browser = String(env.JOBBORED_CHROMIUM_PATH || "").trim() ? "system" : "playwright";
    playwrightVerdict = { at: now(), verdict: probe().then((result) => ({ ...result, browser })) };
  }
  return playwrightVerdict.verdict;
}

/** @type {boolean | null} */
let pythonPresent = null;

function probePythonOnce() {
  if (pythonPresent === null) {
    const result = spawnSync("python3", ["--version"], { stdio: "ignore", timeout: 5_000 });
    pythonPresent = result.status === 0;
  }
  return pythonPresent;
}

/**
 * Optional: without the resolver, uploads still become marks and every
 * other company falls back to its monogram.
 * @param {{ env?: NodeJS.ProcessEnv, probePython?: () => boolean }} [options]
 * @returns {Check}
 */
export function checkLogoResolver({ env = process.env, probePython = probePythonOnce } = {}) {
  const gate = logoResolverGate({ env });
  if (!gate.enabled) return { ok: false, detail: `resolver off (${gate.reason})` };
  if (!existsSync(getLogoResolverScript())) return { ok: false, detail: "resolver script missing" };
  /* The gate runs first: on a Mac without developer tools, python3 is a
   * shim that opens an install dialog. */
  if (!probePython()) return { ok: false, detail: "python3 is not installed" };
  return { ok: true };
}

/** @returns {Promise<{ ok: boolean, checks: Record<string, Check> }>} */
export async function deepHealth() {
  const checks = {
    schemas: checkSchemas(),
    templates: checkTemplates(),
    fonts: checkFonts(),
    playwright: await checkPlaywright(),
    logoResolver: checkLogoResolver(),
  };
  return { ok: checks.schemas.ok && checks.templates.ok && checks.fonts.ok, checks };
}
