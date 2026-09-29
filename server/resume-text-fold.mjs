/** Match-only text normalization. `map[i]` is the UTF-16 offset in the raw input that produced `text[i]`. */
/** @type {Record<string, string>} */
const LIGATURES = { æ: "ae", Æ: "AE", œ: "oe", Œ: "OE" };
const DASHES = /[‐‑‒–—―−]/gu;
const SINGLE_QUOTES = /[‘’‚‛]/gu;
const DOUBLE_QUOTES = /[“”„‟]/gu;
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/u;
const COMPAT_DIGIT = /\p{N}/u;

/**
 * @param {string} value
 * @returns {{text: string, map: number[]}}
 */
export function foldForMatch(value) {
  const raw = String(value ?? "");
  const text = [];
  const map = [];
  for (let offset = 0; offset < raw.length;) {
    const char = String.fromCodePoint(raw.codePointAt(offset) ?? 0);
    const nextOffset = offset + char.length;
    if (INVISIBLE.test(char)) {
      offset = nextOffset;
      continue;
    }
    const normalizedDigit = char.normalize("NFKC");
    const isCompatibilityDigit = COMPAT_DIGIT.test(char) && !/^[0-9]$/u.test(char) && /^[0-9]$/u.test(normalizedDigit);
    const previous = offset > 0 ? String.fromCodePoint(raw.codePointAt(offset - 1) ?? 0) : "";
    const next = nextOffset < raw.length ? String.fromCodePoint(raw.codePointAt(nextOffset) ?? 0) : "";
    const inNumericToken = /\p{N}/u.test(previous) || /\p{N}/u.test(next);
    const normalized = isCompatibilityDigit && inNumericToken ? char : (LIGATURES[char] ?? char.normalize("NFKC"));
    const folded = normalized.replace(DASHES, "-").replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').toLowerCase();
    for (const unit of folded) {
      const output = /\s/u.test(unit) ? " " : unit;
      if (output === " " && text.at(-1) === " ") continue;
      text.push(output);
      for (let i = 0; i < output.length; i += 1) map.push(offset);
    }
    offset = nextOffset;
  }
  return { text: text.join(""), map };
}

/** Join a hard wrap only when its continuation starts with a lowercase letter. */
/** @param {string} value */
export function joinSoftWrap(value) {
  return String(value ?? "")
    .replace(/(?<!\p{L})(\p{L}+)-?\r?\n(?=\p{Ll})/gu, (match, word) =>
      /^\p{Lu}/u.test(word) ? match : word);
}

const NUMBER_TOKEN_RE = /(?:[$€£+−-])?\p{N}+(?:[.,]\p{N}+)*(?:\s*[-–—]\s*\p{N}+(?:[.,]\p{N}+)*)?(?:[kmbt%])?/giu;

/** Numeric values are matched as maximal tokens, including their currency, decimal, range, and suffix. */
/** @param {string} value */
export function findNumberTokens(value) {
  return [...String(value ?? "").matchAll(NUMBER_TOKEN_RE)].map((match) => ({
    value: match[0], start: match.index, end: match.index + match[0].length,
  }));
}

/** @param {string} source @param {string} value */
export function containsNumberToken(source, value) {
  const wanted = foldForMatch(value).text;
  return findNumberTokens(source).some((token) => foldForMatch(token.value).text === wanted);
}

/** Literal locator for employer names, dates, and numbers; it intentionally has no fuzzy tier. */
/** @param {string} source @param {string} value @param {{kind?: "name" | "date" | "number"}} [options] */
export function locateLiteral(source, value, { kind = "name" } = {}) {
  const haystack = String(source ?? "");
  const needle = String(value ?? "");
  if (!needle) return null;
  if (kind === "number") {
    const wanted = foldForMatch(needle).text;
    const token = findNumberTokens(haystack).find((candidate) => foldForMatch(candidate.value).text === wanted);
    return token ? { tier: token.value === needle ? "exact" : "folded", start: token.start, end: token.end } : null;
  }
  const exact = haystack.indexOf(needle);
  if (exact >= 0) {
    return { tier: "exact", start: exact, end: exact + needle.length };
  }
  const foldedSource = foldForMatch(haystack);
  const foldedNeedle = foldForMatch(needle).text;
  const folded = foldedSource.text.indexOf(foldedNeedle);
  if (folded < 0) return null;
  return { tier: "folded", start: foldedSource.map[folded], end: foldedSource.map[folded + foldedNeedle.length - 1] + 1 };
}
