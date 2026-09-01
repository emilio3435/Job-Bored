import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/* ============================================================
   ONEFLOW L7 — the sweep (spec §7 deletions table, §10 Phase 4).

   WHY a source-level suite: §7's acceptance is "deletions table
   empty". A behavior probe can show the one flow works; only reading
   the repo can show the SECOND onboarding is gone. A stranger cloning
   this repo must find one onboarding, not two, so every claim here is
   about what the tree no longer contains — and each is paired with the
   replacement that carries the deleted surface's job, so nothing is
   deleted without somewhere for the user to go.
   ============================================================ */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const gone = (rel) =>
  assert.equal(existsSync(join(root, rel)), false, `${rel} must be deleted`);

describe("§7 · the enhancements wizard is gone (all 5 steps)", () => {
  it("the module and its suite are deleted", () => {
    gone("enhancements-wizard-ui.js");
    gone("tests/enhancements-wizard.test.mjs");
  });

  it("index.html carries neither its mount nor its script tag", () => {
    const html = read("index.html");
    assert.equal(/enhancementsWizardMount/.test(html), false);
    assert.equal(/enhancements-wizard-ui\.js/.test(html), false);
  });

  it("package.json no longer syntax-checks a file that does not exist", () => {
    assert.equal(
      /enhancements-wizard-ui\.js/.test(read("package.json")),
      false,
    );
  });

  it("no caller is left holding a dead handle", () => {
    for (const file of [
      "app.js",
      "app-compat.js",
      "bridge-registry.js",
      "go-live-wizard-ui.js",
      "eslint.config.mjs",
    ]) {
      const source = read(file);
      assert.equal(
        /requestEnhancementsSetup|JobBoredEnhancements|openEnhancementsWizard/.test(
          source,
        ),
        false,
        `${file} must not reach for the retired wizard`,
      );
    }
  });

  it("the go-live done step no longer offers the retired CTA", () => {
    const source = read("go-live-wizard-ui.js");
    assert.equal(/Maximize your results/.test(source), false);
    assert.equal(/go_live_open_enhancements/.test(source), false);
  });

  it("the three *EnhancementDismissed flags leave the store", () => {
    const store = read("user-content-store.js");
    for (const flag of [
      "serpApiEnhancementDismissed",
      "geminiEnhancementDismissed",
      "aiProviderEnhancementDismissed",
    ]) {
      assert.equal(
        source_has(store, flag),
        false,
        `${flag} has no reader left — spec §7 deletes it`,
      );
    }
  });
});

describe("§7 · Settings → Upgrades carries what the wizard used to list", () => {
  const partial = () => read("partials/settings-modal.html");

  it("is a real tab: button, panel, and schema entry all present", () => {
    const html = partial();
    assert.match(html, /id="settings-tab-upgrades"/);
    assert.match(html, /data-tab-id="upgrades"/);
    assert.match(html, /id="settings-panel-upgrades"/);

    const schema = read("settings-tab-schema.js");
    assert.match(schema, /UPGRADES: "upgrades"/);
    assert.match(schema, /panelId: "settings-panel-upgrades"/);
    assert.match(schema, /buttonId: "settings-tab-upgrades"/);
  });

  it("lists the three more_optional cards the wizard's last step carried", () => {
    const html = partial();
    for (const title of ["ATS scoring", "Company logos", "Browser Use Cloud"]) {
      assert.ok(
        html.includes(title),
        `the Upgrades panel must still offer ${title}`,
      );
    }
    // Each card names WHERE to turn it on — and it has to be a place that
    // exists. The wizard's own pointers had rotted (there is no Settings →
    // General tab, and no Browser Use Cloud switch in Settings at all), so
    // the cards carry the real switches, not the fossil route (§7 fossils).
    assert.match(html, /Turn on: Settings → ATS Scoring\./);
    assert.match(html, /logoDevToken/);
    assert.match(html, /BROWSER_USE_API_KEY/);
    assert.equal(/Settings → General/.test(html), false);
    assert.equal(/Settings → Job Discovery/.test(html), false);
  });

  it("B6's footer line is not a lie — the power-ups it names live here", () => {
    // spec §5 B6: "More power-ups — URL import, grounded search, other
    // devices — live in Settings → Upgrades, each one click, none
    // required." The panel has to actually cover those three.
    const html = partial();
    assert.match(html, /URL import/);
    assert.match(html, /Grounded web search/i);
    assert.match(html, /Other devices/i);
    // Both Gemini-powered ones point at the key that unlocks them.
    assert.match(html, /Settings → AI Providers → Gemini API key/);
    assert.match(read("oneflow-beat-payoff.js"), /Settings → Upgrades/);
  });

  it("stays static — no JS module was resurrected to render it", () => {
    assert.equal(existsSync(join(root, "upgrades-card.js")), false);
  });
});

/** True when `needle` appears outside of a pure comment line. */
function source_has(source, needle) {
  return String(source)
    .split("\n")
    .some(
      (line) => line.includes(needle) && !/^\s*(\/\/|\*|\/\*)/.test(line),
    );
}
