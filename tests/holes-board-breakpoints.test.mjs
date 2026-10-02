/**
 * HOLES BOARD — B16: the board sheets switch layout on one breakpoint scale.
 *
 * pipeline.css, flowing-chrome.css, today.css and dawn.css switched at
 * 430/560/600/640/720/760/768/1023/1100/1280px, so the chrome, the board and
 * the brief changed shape at slightly different widths. tokens-v2.css now
 * names the scale (--jb-bp-xs … --jb-bp-xl). var() cannot be used inside
 * @media and there is no CSS build step, so each query writes the token's
 * literal value; these checks keep every width query in those sheets on it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { stripComments } from "../tools/lint-tokens.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/** A sheet with its comments blanked; newlines are kept, so line numbers hold. */
const read = (name) => stripComments(readFileSync(join(repoRoot, name), "utf8"));

const BOARD_SHEETS = ["pipeline.css", "flowing-chrome.css", "today.css", "dawn.css"];
const BREAKPOINT_NAMES = ["--jb-bp-xs", "--jb-bp-sm", "--jb-bp-md", "--jb-bp-lg", "--jb-bp-xl"];

/** --jb-bp-* name → value (e.g. "760px"), in source order. */
function breakpointTokens() {
  const tokens = new Map();
  for (const m of read("tokens-v2.css").matchAll(/(--jb-bp-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

/** Every width feature in a sheet's @media preludes, as { where: "file:line", value }. */
function widthQueries(name) {
  const src = read(name);
  const out = [];
  for (const media of src.matchAll(/@media([^{]*)\{/g)) {
    const where = `${name}:${src.slice(0, media.index).split("\n").length}`;
    for (const f of media[1].matchAll(/\(\s*(?:min-|max-)?width\s*:\s*([^)]*?)\s*\)/g)) {
      out.push({ where, value: f[1] });
    }
    /* Range syntax, e.g. (width <= 760px), would slip past the scan above;
       report the whole prelude so it is rewritten as (max-width: …). */
    if (/[<>]/.test(media[1])) out.push({ where, value: media[1].trim() });
  }
  return out;
}

describe("B16 · one breakpoint scale for the board sheets", () => {
  it("should define --jb-bp-xs, -sm, -md, -lg and -xl in tokens-v2.css as ascending px widths", () => {
    const tokens = breakpointTokens();
    assert.deepEqual([...tokens.keys()], BREAKPOINT_NAMES, "tokens-v2.css must define exactly the five --jb-bp-* tokens, smallest first");
    const widths = [...tokens.values()].map((value) => {
      assert.match(value, /^\d+px$/, `breakpoint ${value} must be a whole px width, the unit @media literals use`);
      return Number.parseInt(value, 10);
    });
    for (let i = 1; i < widths.length; i++) {
      assert.ok(widths[i] > widths[i - 1], `${BREAKPOINT_NAMES[i]} (${widths[i]}px) must be wider than ${BREAKPOINT_NAMES[i - 1]} (${widths[i - 1]}px)`);
    }
  });

  it("should use only --jb-bp-* values in every width media query of pipeline, flowing-chrome, today and dawn", () => {
    const scale = [...breakpointTokens().values()];
    const offenders = [];
    for (const sheet of BOARD_SHEETS) {
      const queries = widthQueries(sheet);
      assert.ok(queries.length > 0, `${sheet} has no width media query; the scan no longer reads it`);
      for (const q of queries) if (!scale.includes(q.value)) offenders.push(`${q.where} ${q.value}`);
    }
    assert.deepEqual(
      offenders,
      [],
      `width media queries off the breakpoint scale (${scale.join(" / ") || "no --jb-bp-* tokens defined"}):\n  ${offenders.join("\n  ")}`,
    );
  });
});
