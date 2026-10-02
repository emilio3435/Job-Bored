export const GEMINI_FLASH_FAMILY = "gemini-flash";
export const GEMINI_FLASH_FALLBACK = "gemini-flash-latest";

/**
 * The old browser automatically saved 3.7 when the user chose the Flash
 * family. There is no provenance for that exact id, so migrate it as the
 * generated default; other explicit versions and families stay pinned.
 * @param {unknown} model
 */
export function normalizeGeminiFlashPreference(model) {
  const id = String(model || "").trim();
  const bare = id.replace(/^models\//i, "").toLowerCase();
  return !id || bare === GEMINI_FLASH_FAMILY ||
    bare === GEMINI_FLASH_FALLBACK || bare === "gemini-3.7-flash"
    ? GEMINI_FLASH_FAMILY
    : id;
}

/**
 * Settings offers Gemini families by name; Google answers only to their
 * moving -latest aliases (HOLES PROV P3), so "gemini-pro" must never reach
 * the wire as a literal.
 */
const GEMINI_FAMILY_WIRE_ALIASES = Object.freeze({
  "gemini-pro": "gemini-pro-latest",
  "gemini-flash-lite": "gemini-flash-lite-latest",
});

/** @param {unknown} model */
export function resolveGeminiFlashWireModel(model) {
  const preference = normalizeGeminiFlashPreference(model);
  if (preference === GEMINI_FLASH_FAMILY) return GEMINI_FLASH_FALLBACK;
  const bare = /** @type {keyof typeof GEMINI_FAMILY_WIRE_ALIASES} */ (preference.replace(/^models\//i, "").toLowerCase());
  return Object.hasOwn(GEMINI_FAMILY_WIRE_ALIASES, bare) ? GEMINI_FAMILY_WIRE_ALIASES[bare] : preference;
}

const WEAK_EXACT = new Set([
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-20b:free",
]);

/** @param {unknown} model */
export function isGeminiFlashFamily(model) {
  return String(model || "").trim() === GEMINI_FLASH_FAMILY;
}

/** @param {unknown} model */
export function isWeakMaterialsModel(model) {
  const id = String(model || "").trim().toLowerCase();
  if (!id) return false;
  if (WEAK_EXACT.has(id)) return true;
  return id.endsWith(":free");
}

/** @param {unknown} id */
function parseFlashVersion(id) {
  const m = String(id || "").trim().match(/^gemini-(\d+)(?:\.(\d+))?-flash$/i);
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] ? Number(m[2]) : 0 };
}

/** @param {unknown} modelIds */
export function pickStableGeminiFlash(modelIds) {
  let best = null;
  let bestKey = null;
  for (const raw of Array.isArray(modelIds) ? modelIds : []) {
    const id = String(raw || "").replace(/^models\//, "").trim();
    const parsed = parseFlashVersion(id);
    if (!parsed) continue;
    const key = parsed.major * 1000 + parsed.minor;
    if (bestKey === null || key > bestKey) {
      bestKey = key;
      best = id;
    }
  }
  return best;
}
