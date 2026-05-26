/* ============================================================
   flowing-chrome-brand.test.mjs
   ------------------------------------------------------------
   Locks the v2 top-bar brand contract:
     - The blank mint-green square is gone; .page-top__brand-mark
       now hosts the rocket-mascot face SVG (same face as favicon).
     - The inline "Job/Bored" text wordmark is replaced by the
       official brand-kit wordmark inlined as a transparent SVG
       (no <rect> background).
     - The legacy `.page-top__brand-em` span is fully removed.
   Pure static-analysis (no jsdom available in this repo).
   ============================================================ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const chromeJs = readFileSync(join(repoRoot, "flowing-chrome.js"), "utf8");
const chromeCss = readFileSync(join(repoRoot, "flowing-chrome.css"), "utf8");

/* Pull out the buildBrand function body so each assertion targets
   the chrome's brand cluster construction directly, not random
   strings elsewhere in the file. */
function brandFnBody() {
  const start = chromeJs.indexOf("function buildBrand(");
  assert.ok(start > 0, "buildBrand() must be declared");
  const end = chromeJs.indexOf("function buildNav(", start);
  assert.ok(end > start, "buildBrand() body must precede buildNav()");
  return chromeJs.slice(start, end);
}

describe("v2 top-bar brand — official assets", () => {
  it("buildBrand returns an <a class='page-top__brand'> wiring up the mark + wordmark SVGs", () => {
    const body = brandFnBody();
    assert.match(body, /class:\s*"page-top__brand"/);
    assert.match(body, /aria-label":\s*"JobBored — home"/);
    assert.match(body, /page-top__brand-mark/);
    /* buildBrand splices in the rocket mascot picture (webp + 1x/2x
       PNG) and the inline wordmark SVG via module-scope constants. */
    assert.match(body, /MASCOT_ROCKET_WEBP/);
    assert.match(body, /MASCOT_ROCKET_PNG/);
    assert.match(body, /MASCOT_ROCKET_PNG2/);
    assert.match(body, /WORDMARK_SVG/);
    /* The wordmark SVG itself (defined at module scope) carries the
       BEM class so the chrome CSS can target it. */
    assert.match(chromeJs, /class="page-top__brand-wordmark"/);
  });

  it("the brand mark is the rocket-pack mascot served as a transparent retina <picture> (no tile, no inline-face SVG)", () => {
    /* Regression guard: the chrome went through three earlier shapes
       we never want to return to:
         1. `<span class="page-top__brand-mark">` with no children →
            blank mint-green square.
         2. Inline mascot-face SVG on a mint tile → tile + tiny face.
         3. Raw brand-kit PNG with its parchment canvas baked in →
            low-quality on retina + parchment rectangle that clashed
            with the chrome background at small sizes.
       The current shape uses a <picture> with WebP + 1x/2x PNG
       built from the brand kit and trimmed to transparent. */
    const body = brandFnBody();
    assert.match(
      body,
      /<picture\s+class="page-top__brand-mark">/,
      ".page-top__brand-mark must be a <picture>, not <span>/<img>/inline SVG",
    );
    assert.match(
      body,
      /<source\s+type="image\/webp"\s+srcset="\'?\s*\+\s*MASCOT_ROCKET_WEBP/,
      "<picture> must offer the WebP variant first for sharpness",
    );
    assert.match(
      body,
      /srcset="\'?\s*\+\s*MASCOT_ROCKET_PNG\s*\+\s*\'\s*1x,\s*\'\s*\+\s*MASCOT_ROCKET_PNG2\s*\+\s*\'\s*2x/,
      "<img> must declare a 1x/2x srcset so retina users get the @2x asset",
    );

    /* Asset paths must resolve to the chrome-asset directory; the
       raw brand-kit PNG (with the off-cream canvas) must NOT be
       referenced in the chrome anymore. */
    assert.match(
      chromeJs,
      /var\s+MASCOT_ROCKET_WEBP\s*=\s*["']assets\/chrome\/jobbored-mascot-rocket\.webp["']/,
    );
    assert.match(
      chromeJs,
      /var\s+MASCOT_ROCKET_PNG\s*=\s*["']assets\/chrome\/jobbored-mascot-rocket\.png["']/,
    );
    assert.match(
      chromeJs,
      /var\s+MASCOT_ROCKET_PNG2\s*=\s*["']assets\/chrome\/jobbored-mascot-rocket@2x\.png["']/,
    );
    /* The chrome may MENTION the original brand-kit PNG in its header
       doc-comment (documenting what the trimmed assets were built
       from), but must NOT reference it from runtime code. Strip out
       block comments before asserting. */
    const chromeJsCodeOnly = chromeJs.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(
      chromeJsCodeOnly,
      /jobbored-square-rocket-light\.png/,
      "the chrome runtime code must not reference the original off-cream brand-kit PNG (comments are fine)",
    );

    /* Defense in depth: previous indirections gone. */
    assert.doesNotMatch(chromeJs, /MASCOT_FACE_SVG/);
    assert.doesNotMatch(chromeJs, /MASCOT_ROCKET_SRC\b/);
  });

  it("the rocket-pack picture assets actually exist on disk", () => {
    /* Locks the build invariant: if someone removes the trimmed
       assets, this test fails immediately, before the browser
       silently 404s. */
    const assetDir = join(repoRoot, "assets", "chrome");
    for (const file of [
      "jobbored-mascot-rocket.webp",
      "jobbored-mascot-rocket.png",
      "jobbored-mascot-rocket@2x.png",
    ]) {
      const bytes = readFileSync(join(assetDir, file));
      assert.ok(bytes.length > 1000, file + " must exist and be non-trivial");
    }
  });

  it("the wordmark SVG matches the brand kit (Futura/Caveat fonts, two <text> elements, no background <rect>)", () => {
    assert.match(chromeJs, /var\s+WORDMARK_SVG\s*=/);
    /* Brand-kit fonts (light/dark SVGs at exports/01-wordmark) */
    assert.match(chromeJs, /Futura[^"]*Avenir Next[^"]*Century Gothic/);
    assert.match(chromeJs, /Caveat[^"]*Bradley Hand/);
    /* Two text elements: "Job" + "Bored" */
    assert.match(chromeJs, />Job</);
    assert.match(chromeJs, />Bored</);
    /* "Job" inherits the navy via currentColor; "Bored" uses the
       mint-deep CSS variable explicitly via inline style. */
    assert.match(chromeJs, /fill="currentColor"/);
    assert.match(chromeJs, /style="fill:var\(--jb-mint-deep[^)]*\)"/);
    /* Transparent — no background rect like the brand-kit SVG had. */
    const wordmarkBlockMatch = chromeJs.match(/var\s+WORDMARK_SVG\s*=([\s\S]*?);\n/);
    assert.ok(wordmarkBlockMatch, "wordmark string literal must be findable");
    assert.doesNotMatch(
      wordmarkBlockMatch[1],
      /<rect[^>]*fill=/,
      "the inlined wordmark must NOT carry a background <rect> (transparent over the parchment chrome)",
    );
  });

  it("removes all references to the legacy .page-top__brand-em span", () => {
    /* The old chrome built `<span class="page-top__brand-em">Bored</span>`
       next to a text node "Job". Both are gone now — the wordmark SVG
       carries the typography. */
    assert.doesNotMatch(
      chromeJs,
      /page-top__brand-em/,
      "no JS may still construct .page-top__brand-em",
    );
    assert.doesNotMatch(
      chromeCss,
      /page-top__brand-em/,
      "no CSS rule may still target .page-top__brand-em",
    );
    /* And the literal "Job" / "Bored" string-node injection (old shape)
       is gone too. */
    assert.doesNotMatch(
      brandFnBody(),
      /createTextNode\(\s*"Job"\s*\)/,
      'the inline document.createTextNode("Job") shape must be gone',
    );
  });

  it("CSS sizes the mascot picture flat (no tile) and lets the wordmark inherit navy", () => {
    /* The mark is a <picture> served flat — no mint-tile background.
       That was the previous "blank square" shape. */
    const markRuleMatch = chromeCss.match(/\.page-top__brand-mark\s*\{[\s\S]*?\n\}/);
    assert.ok(markRuleMatch, ".page-top__brand-mark rule must exist");
    const markRule = markRuleMatch[0];
    assert.doesNotMatch(
      markRule,
      /background:\s*var\(--jb-mint\)/,
      "the mascot mark must NOT use a mint tile background anymore",
    );
    assert.match(markRule, /width:\s*\d+px/);
    assert.match(markRule, /height:\s*\d+px/);

    /* The inner <img> must use object-fit so the transparent mascot
       scales without distortion as the wrapper size changes. */
    assert.match(
      chromeCss,
      /\.page-top__brand-mark\s*>\s*img\s*\{[\s\S]*?object-fit:\s*contain/,
      ".page-top__brand-mark > img must declare object-fit: contain",
    );

    /* The wordmark scales by height and inherits the navy. */
    assert.match(chromeCss, /\.page-top__brand-wordmark\s*\{[\s\S]*?height:\s*\d+px/);
    assert.match(chromeCss, /\.page-top__brand-wordmark\s*\{[\s\S]*?color:\s*var\(--jb-navy\)/);
  });

  it("mobile breakpoint (<=430px) hides the wordmark and keeps the mark tappable", () => {
    /* Find the narrowest media query that targets the wordmark. */
    const narrowBlock = chromeCss.match(
      /@media\s*\(max-width:\s*430px\)\s*\{[\s\S]*?\n\}/,
    );
    assert.ok(narrowBlock, "must declare a <=430px media query for the chrome");
    assert.match(narrowBlock[0], /\.page-top__brand-wordmark[\s\S]*?display:\s*none/);
    assert.match(narrowBlock[0], /\.page-top__brand-mark/);
  });
});
