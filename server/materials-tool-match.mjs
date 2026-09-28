/**
 * Tool-name matching that does not mistake plain English for a tool.
 *
 * Some tool names are ordinary words: "Go" in "go-to strategist", "R" in
 * "R&D", "Meta" in "meta-analysis", "Segment" in "a customer segment".
 * Those names match only in their own capitalisation, as a whole word,
 * and never joined to a hyphen. Every other tool matches as a whole word,
 * case-insensitively, as before.
 */

/* Lower-cased tool names that are also everyday words. */
const AMBIGUOUS = new Set([
  "go", "r", "meta", "mode", "hex", "segment", "sheets", "slack", "zoom", "notion",
  "spark", "rust", "excel", "retool", "looker", "gpt", "grok", "flink",
]);

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} tool the canonical spelling ("Go", "Google Ads")
 * @returns {RegExp}
 */
export function toolPattern(tool) {
  const name = String(tool || "");
  if (AMBIGUOUS.has(name.toLowerCase())) {
    /* Exact case; not part of a hyphenated word or a longer word. */
    return new RegExp(`(?<![\\w&-])${escapeRegExp(name)}(?![\\w&-])`);
  }
  return new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
}

/**
 * The first place the tool appears in the text, or null.
 * @param {string} tool
 * @param {string} text
 * @param {string} [canonical] the spelling to require for an ambiguous
 *   name when `tool` is stored lower-case ("go" → "Go")
 */
export function findTool(tool, text, canonical) {
  const spelled = canonical || tool;
  return toolPattern(spelled).exec(String(text || ""));
}
