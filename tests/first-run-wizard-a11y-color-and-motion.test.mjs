// Pin test: a11y color tokens + reduced-motion respect for the first-run
// wizard. Round-2 quality sweep cluster "A11y color tokens + reduced motion".
//
// Evidence trail (audit-results.json from /tmp/qsweep2):
//   - `.first-run-hint`, `.first-run-step-label`, `.first-run-provider-option__desc`,
//     `.first-run-wizard__subtitle` resolved to var(--text-faint) = #7a9aab,
//     ratio 2.79–2.85 against warm-paper cream — fails WCAG AA (need ≥4.5:1).
//     New `--text-soft: #4a6577` measures ~5.6:1 on cream.
//   - `.btn-modal-primary` label was white on #59cb89 mint = 2.03:1 — fails
//     AA for both small and large text. Navy ink on the same mint = 6.13:1.
//   - The wizard's entrance animation + floating whats-next-card animation
//     + progress-bar width transition ignored prefers-reduced-motion.
//
// These are source-shape pins. The CSS is loaded by the browser at runtime,
// so a CSS regression would lower the contrast back below 4.5:1 — these
// pins fail loudly at the source level before that ever ships.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const styleCss = readFileSync(join(repoRoot, "style.css"), "utf8");
const wizardCss = readFileSync(
  join(repoRoot, "css", "legacy-first-run-wizard.css"),
  "utf8",
);

// Pull the body of a single CSS rule by selector (first match wins). The
// wizard CSS has both bare-selector rules and nested .first-run-wizard ...
// overrides; this helper finds them positionally so a stray space won't
// break the match.
function ruleBody(css, selectorLine) {
  const idx = css.indexOf(selectorLine);
  if (idx < 0) return null;
  const open = css.indexOf("{", idx);
  const close = css.indexOf("}", open);
  if (open < 0 || close < 0) return null;
  return css.slice(open + 1, close);
}

describe("first-run wizard — WCAG AA color tokens", () => {
  it("declares --text-soft globally so the wizard hint/desc copy has an AA-compliant ink", () => {
    // The token lives next to --text-faint at the top of style.css so the
    // contrast intent is co-located with the rest of the palette.
    assert.match(
      styleCss,
      /--text-soft:\s*#4a6577\s*;/i,
      "style.css must define --text-soft: #4a6577 (the AA-compliant softer ink)",
    );
  });

  for (const sel of [
    ".first-run-hint",
    ".first-run-step-label",
    ".first-run-provider-option__desc",
    ".first-run-wizard__subtitle",
  ]) {
    it(`${sel} uses var(--text-soft) so it clears 4.5:1 on warm paper`, () => {
      const body = ruleBody(wizardCss, `${sel} {`);
      assert.ok(body, `${sel} rule must exist in legacy-first-run-wizard.css`);
      assert.match(
        body,
        /color:\s*var\(\s*--text-soft\s*,\s*#4a6577\s*\)\s*;/,
        `${sel} must read its color from --text-soft (fallback #4a6577), not --text-faint`,
      );
      // Belt-and-suspenders: make sure we didn't leave the old binding in place.
      assert.doesNotMatch(
        body,
        /color:\s*var\(\s*--text-faint\s*\)/,
        `${sel} must not fall back to --text-faint (2.85:1) for its primary copy`,
      );
    });
  }

  it("does not mass-rebind --text-faint site-wide (non-wizard chrome still uses it intentionally)", () => {
    // --text-faint is reused 9+ times in style.css for filter pill counts,
    // kanban rail decorations, etc. The fix is targeted, not a sweep.
    const matches = styleCss.match(/var\(--text-faint\)/g) || [];
    assert.ok(matches.length >= 5, "non-wizard chrome should still use --text-faint where context names the meaning");
  });
});

describe("first-run wizard — primary CTA label contrast", () => {
  it("scopes a navy ink override for .btn-modal-primary inside .first-run-wizard", () => {
    // The global .btn-modal-primary in legacy-brief.css ships with white
    // text — fine on darker modal backgrounds, but on the wizard's mint
    // primary it's 2.03:1. The wizard-scoped override flips the label to
    // navy (6.13:1) without disturbing the global rule.
    assert.match(
      wizardCss,
      /\.first-run-wizard\s+\.btn-modal-primary\s*\{[^}]*color:\s*var\(\s*--jb-navy\s*,\s*#003851\s*\)\s*;/s,
      "wizard-scoped .btn-modal-primary must set color to var(--jb-navy, #003851)",
    );
  });

  it("does not change the --accent token (the mint background is intentional brand)", () => {
    // The fix is on the label, not the background. The brand mint stays.
    assert.match(
      styleCss,
      /--accent:\s*#59cb89\s*;/i,
      "the brand mint --accent stays #59cb89 — the fix is the label, not the background",
    );
  });
});

describe("first-run wizard — prefers-reduced-motion respect", () => {
  it("kills the wizard panel entrance animation, the whats-next-card animation, and the progress-bar transition", () => {
    // Mirrors legacy-onboarding.css:1123, which is the canonical pattern.
    const idx = wizardCss.indexOf("@media (prefers-reduced-motion: reduce)");
    assert.notEqual(idx, -1, "wizard CSS must carry a prefers-reduced-motion block");
    const block = wizardCss.slice(idx, wizardCss.indexOf("}\n}", idx) + 3);
    assert.match(
      block,
      /\.first-run-panel\s*\{[^}]*animation:\s*none/s,
      "the entrance animation on .first-run-panel must be neutralized under reduced motion",
    );
    assert.match(
      block,
      /\.whats-next-card\s*\{[^}]*animation:\s*none/s,
      "the floating whats-next-card entrance must be neutralized under reduced motion",
    );
    assert.match(
      block,
      /\.first-run-progress-bar__fill\s*\{[^}]*transition:\s*none/s,
      "the progress-bar width transition must be neutralized under reduced motion",
    );
  });
});
