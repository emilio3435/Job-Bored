// UX01 C3 — the component kit and the cascade-trap fix.
//
// DS-10: jb-type.css / jb-v2.css element rules were `body.jb-v2 h3` (0,1,1),
// so a lone class rule (0,1,0) such as `.settings-setup-block__title` lost
// its font-size / weight. Wrapping the scope in `:where()` drops the rule to
// (0,0,1) so any class wins.
// DS-05/18/19 · SS-23 · TA-20: one button, chip, field, banner and toast in
// jb-ui.css, token-only, documented in JB-UI.md.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function selectors(css) {
  const out = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith("@")) continue;
    for (const part of sel.split(",")) out.push(part.trim());
  }
  return out;
}

const ELEMENT_RULE = /^body\.jb-v2\s+(h[1-6]|p|small|blockquote|kbd|code|pre|ul|ol)\b/;

describe("C3 · type rules no longer out-rank component classes (DS-10)", () => {
  for (const file of ["jb-type.css", "jb-v2.css"]) {
    it(`${file} scopes element type rules with :where(body.jb-v2)`, () => {
      const offenders = selectors(read(file)).filter((s) => ELEMENT_RULE.test(s));
      assert.deepEqual(offenders, [], `${file} still ships (0,1,1) element rules`);
    });
  }

  it("jb-type.css still styles the headings and body copy", () => {
    const sels = selectors(read("jb-type.css"));
    for (const el of ["h1", "h2", "h3", "h4", "p"]) {
      assert.ok(
        sels.includes(`:where(body.jb-v2) ${el}`),
        `missing :where(body.jb-v2) ${el}`,
      );
    }
  });
});

describe("C3 · component kit in jb-ui.css (DS-05/18/19, SS-23, TA-20)", () => {
  const css = stripComments(read("jb-ui.css"));
  const doc = read("JB-UI.md");
  const KIT = [
    ".jb-btn",
    ".jb-btn--primary",
    ".jb-btn--secondary",
    ".jb-btn--ghost",
    ".jb-btn--accent",
    ".jb-btn--icon",
    ".jb-btn--danger",
    ".jb-btn--sm",
    ".jb-chip",
    ".jb-field",
    ".jb-input",
    ".jb-select",
    ".jb-banner",
    ".jb-toast",
  ];

  for (const cls of KIT) {
    it(`defines and documents ${cls}`, () => {
      const re = new RegExp(`${cls.replace(/[.-]/g, "\\$&")}(?![\\w-])`);
      assert.ok(re.test(css), `jb-ui.css is missing ${cls}`);
      assert.ok(re.test(doc), `JB-UI.md does not document ${cls}`);
    });
  }

  it("drives chips and banners by data-tone", () => {
    for (const tone of ["ok", "warn", "err", "info"]) {
      assert.match(css, new RegExp(`\\.jb-chip\\[data-tone="${tone}"\\]`));
      assert.match(css, new RegExp(`\\.jb-banner\\[data-tone="${tone}"\\]`));
    }
  });

  it("gives the primary button full action styling (TA-20)", () => {
    const block = css.match(/\.jb-btn--primary\s*\{[^}]*\}/);
    assert.ok(block, "no .jb-btn--primary block");
    assert.match(block[0], /background:\s*var\(--jb-action\)/);
    assert.match(block[0], /color:\s*var\(--jb-on-action\)/);
  });

  it("uses tokens only — no raw colour literals in the kit", () => {
    const start = css.indexOf("UX01 C3");
    const kit = start >= 0 ? css.slice(start) : css;
    const literals = kit.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g) || [];
    assert.deepEqual(literals, []);
  });

  it("keeps the kit specificity at one class so surfaces can override it", () => {
    const kitSels = selectors(css).filter((s) => /^\.jb-(btn|chip|field|input|select|banner|toast)/.test(s));
    assert.ok(kitSels.length > 0);
    const heavy = kitSels.filter((s) => /^body/.test(s));
    assert.deepEqual(heavy, []);
  });
});
