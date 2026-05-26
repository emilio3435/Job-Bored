/**
 * tests/lattice-rich-card.test.mjs
 *
 * Contract test for the rich-card variant in lattice.js (the active v2
 * pipeline kanban). The rich card is gated by localStorage flag
 * `jb_latticeRichCard` (default ON) and decorates the bare card with:
 *
 *   - a stage rail (::before, NOT box-shadow, so it survives hover/
 *     focus/dragging/selected — the .jb-sticker primitive owns box-shadow)
 *   - a stage chip + seniority chip + source label (identity strip)
 *   - an AI one-line "hook" when _postingEnrichment.roleInOneLine exists
 *   - an inline employment tag in the meta row
 *   - a dedicated must-haves row (NOT inside the truncated chips container)
 *
 * The flag's purpose is to let us turn the experiment off cleanly, so this
 * test asserts:
 *   1. Both rich and non-rich code paths exist in source
 *   2. Each adaptive sub-element is gated by its data field
 *   3. The stage rail uses ::before (not box-shadow)
 *   4. The must-haves row is its own container, not packed into chips
 *   5. CSS provides stage colors for every stage in the JS STAGES list
 *
 * This is source-level inspection (matches the pattern used by
 * tests/pipeline-filter-controls.test.mjs). No DOM/jsdom required.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const latticeJs = readFileSync(join(repoRoot, "lattice.js"), "utf8");
const latticeCss = readFileSync(join(repoRoot, "lattice.css"), "utf8");
const jbUiCss = readFileSync(join(repoRoot, "jb-ui.css"), "utf8");

describe("lattice rich kanban card (flag: jb_latticeRichCard)", () => {
  it("exposes a default-on flag with a kill switch via localStorage", () => {
    assert.ok(
      latticeJs.includes("isLatticeRichCardEnabled"),
      "lattice.js should define isLatticeRichCardEnabled() so the flag is consultable",
    );
    assert.ok(
      latticeJs.includes('"jb_latticeRichCard"'),
      "flag must be stored under the documented localStorage key jb_latticeRichCard",
    );
    assert.ok(
      latticeJs.match(/getItem\("jb_latticeRichCard"\)\s*!==\s*"0"/),
      "flag must default to ON — only an explicit '0' disables the rich card",
    );
  });

  it("locks rich-only classes behind the flag", () => {
    assert.ok(
      latticeJs.includes("(rich ? \" jb-lat__card--rich\" : \"\")"),
      "the jb-lat__card--rich modifier must only attach when rich is true",
    );
    assert.ok(
      latticeJs.includes("(rich ? \" jb-lat__card--stage-\" + stageKey : \"\")"),
      "the per-stage modifier class must also be gated by the flag",
    );
  });

  it("stage rail uses ::before, not box-shadow (sticker primitive owns box-shadow)", () => {
    // box-shadow on .jb-sticker / hover / focus-within / selected / dragging
    // would clobber any stage rail expressed as a box-shadow. The rail
    // MUST be a ::before pseudo so it survives every interactive state.
    assert.ok(
      latticeCss.match(/\.jb-lat__card--rich::before\s*\{[^}]*content:\s*""/),
      "rich card stage rail must be drawn via ::before content",
    );
    assert.ok(
      latticeCss.match(/\.jb-lat__card--rich::before[^}]*background:\s*var\(--jb-lat-stage\)/),
      "the ::before rail must pull its color from the --jb-lat-stage custom prop",
    );

    // Regression guard: ensure we did not reintroduce the broken
    // box-shadow-based rail on the rich card root.
    const richRootBlock = latticeCss.match(
      /\.jb-lat__card--rich\s*\{[^}]*\}/,
    );
    assert.ok(richRootBlock, "rich root rule block must exist in lattice.css");
    assert.ok(
      !/box-shadow:\s*inset\s+3px/.test(richRootBlock[0]),
      "rich card must NOT use box-shadow for the stage rail — .jb-sticker:hover/focus/selected overrides box-shadow and would erase it",
    );

    // Sanity: .jb-sticker really does override box-shadow on hover/focus,
    // which is the underlying reason the rail can't live there. If a
    // future jb-ui.css refactor removes those overrides, this regression
    // guard will fire and tell us why.
    assert.ok(
      jbUiCss.match(/\.jb-sticker:hover[^}]*box-shadow:/),
      "regression guard: .jb-sticker:hover sets box-shadow; rail must remain on ::before to survive",
    );
  });

  it("covers every STAGES value with a stage-color custom property", () => {
    // Pull the JS STAGES list to keep CSS in sync with the runtime stage set.
    const stagesMatch = latticeJs.match(/STAGES\s*=\s*\[([^\]]+)\]/);
    assert.ok(stagesMatch, "lattice.js should define a STAGES array");
    const stages = stagesMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean)
      .map((s) => s.toLowerCase().replace(/\s+/g, "-"));

    for (const css of stages) {
      assert.ok(
        latticeCss.includes(`.jb-lat__card--stage-${css}`),
        `lattice.css is missing a stage color rule for stage "${css}" — every STAGES entry needs a --jb-lat-stage assignment`,
      );
    }
  });

  it("each adaptive sub-element is gated by its data field (no empty rows)", () => {
    // Hook only when roleInOneLine exists
    assert.ok(
      latticeJs.includes("if (rich && enr && enr.roleInOneLine)"),
      "hook should only build when _postingEnrichment.roleInOneLine is present",
    );
    assert.ok(
      latticeJs.match(/hookText\s*\?\s*el\("p",\s*\{\s*class:\s*"jb-lat__hook"/),
      "hookText must gate the <p class='jb-lat__hook'> element",
    );

    // Employment tag only when enrichment provides employmentType
    assert.ok(
      latticeJs.includes('empType ? el("span", { class: "jb-lat__tag jb-lat__tag--employment"'),
      "employment tag must be conditional on empType truthiness",
    );

    // Source label is derived; chip is omitted if derivation returns ""
    assert.ok(
      latticeJs.includes("function deriveSource(job)"),
      "deriveSource(job) helper should exist to fall back from job.source to URL host",
    );
    assert.ok(
      latticeJs.includes('sourceLabel\n                ? el("span", { class: "jb-lat__source"'),
      "source chip must be conditional on sourceLabel truthiness",
    );

    // Must-haves on own row, only when present
    assert.ok(
      latticeJs.match(/rich && mustHaves\.length\s*\?\s*el\("div",\s*\{\s*class:\s*"jb-lat__musts"/),
      "must-haves row must be conditional on mustHaves.length",
    );
  });

  it("must-haves row is separate from the truncated chips container", () => {
    // The .jb-lat__chips container has max-height: 22px and overflow:
    // hidden. If we packed must-haves into it, they'd be silently
    // clipped when user tags also exist. The must-haves row owns its
    // own container so it can flex-wrap.
    assert.ok(
      latticeCss.match(/\.jb-lat__musts\s*\{[^}]*flex-wrap:\s*wrap/),
      ".jb-lat__musts must use flex-wrap so multi-line must-haves render fully",
    );
    assert.ok(
      latticeCss.match(/\.jb-lat__chips\s*\{[^}]*max-height:\s*22px/),
      "regression guard: .jb-lat__chips still has the 22px clip — must-haves must NOT be packed into it",
    );
    // Make sure must-haves are NOT being appended into .jb-lat__chips
    assert.ok(
      !latticeJs.match(/\.jb-lat__chips[^"]*"\s*\)[^}]*mustHaves/s),
      "regression guard: must-haves must not be appended into the .jb-lat__chips container",
    );
  });

  it("seniority detection covers the common title patterns", () => {
    // Sanity check the regex list — the user-visible chip depends on this.
    const expected = [
      "Principal",
      "Staff",
      "Senior",
      "Lead",
      "Director",
      "VP",
      "Manager",
      "Junior",
      "Intern",
      "Head of",
    ];
    for (const label of expected) {
      assert.ok(
        latticeJs.includes(`label: "${label}"`),
        `detectSeniority should recognize "${label}" titles`,
      );
    }
  });

  it("source derivation collapses known ATS hosts to brand names", () => {
    // These are the brand collapses that let the source chip read as
    // "Greenhouse" instead of "boards.greenhouse.io". We check both the
    // regex source (escaped) and the brand return string so a refactor
    // that drops either side will fire this guard.
    const expected = [
      { host: /greenhouse\\\.io/,   brand: '"Greenhouse"' },
      { host: /lever\\\.co/,        brand: '"Lever"' },
      { host: /ashbyhq\\\.com/,     brand: '"Ashby"' },
      { host: /workable\\\.com/,    brand: '"Workable"' },
      { host: /linkedin\\\.com/,    brand: '"LinkedIn"' },
      { host: /indeed\\\.com/,      brand: '"Indeed"' },
    ];
    for (const { host, brand } of expected) {
      assert.ok(
        host.test(latticeJs),
        `deriveSource() is missing a host pattern matching ${host}`,
      );
      assert.ok(
        latticeJs.includes(brand),
        `deriveSource() should return the brand label ${brand}`,
      );
    }
  });

  it("focused-column compact mode hides the new rich rows", () => {
    // When a column is focused, non-selected cards collapse to one line.
    // The rich rows must hide along with .jb-lat__meta / __foot / __detail
    // or compact mode breaks visually.
    const compactRule = latticeCss.match(
      /\.jb-lat__col--focused[^{]*\.jb-lat__card:not\(\[data-selected="true"\]\)[^{]*\.jb-lat__(?:strip|hook|musts)[\s\S]*?\{\s*display:\s*none/,
    );
    assert.ok(
      compactRule,
      "rich rows (.jb-lat__strip, .jb-lat__hook, .jb-lat__musts) must hide in focused compact mode",
    );
  });
});
