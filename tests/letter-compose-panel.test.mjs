/**
 * tests/letter-compose-panel.test.mjs
 *
 * Compose panel for the Workshop (v2 letter region). Verifies that:
 *   1. The shell HTML reserves a compose slot above the editor grid.
 *      (The legacy folder slot above Compose has been removed; the
 *      "Versions" sub-block now lives inside the Scorecard rail.)
 *   2. letter.js exposes the document/tone/length controls plus the
 *      new Title input and Version Notes textarea, and wires the
 *      compose actions (generate, advanced). The Suggest button has
 *      been removed.
 *   3. app.js's runResumeGeneration accepts tone/maxWords/silent/
 *      title options and is exported on window so letter.js can call
 *      it.
 *   4. letter.css scopes the .jb-letter-compose styles under the v2
 *      region selector and reuses v2 tokens.
 *   5. The live render produces a usable compose section with default
 *      tone (warm) and default length (~350) and exposes Title +
 *      Version Notes fields.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const letterJs = readFileSync(join(repoRoot, "letter.js"), "utf8");
const letterCss = readFileSync(join(repoRoot, "letter.css"), "utf8");

describe("Workshop compose panel — shell wiring", () => {
  it("shellHtml reserves a compose-slot above the editor grid (folder slot now lives inside the rail)", () => {
    const composeIdx = letterJs.indexOf("<!--compose-slot-->");
    const gridIdx = letterJs.indexOf("'<div class=\"jb-letter-grid\">'");
    const folderIdx = letterJs.indexOf("<!--folder-slot-->");
    assert.ok(composeIdx >= 0, "compose-slot marker must exist");
    assert.ok(gridIdx >= 0, "editor grid marker must exist");
    assert.ok(folderIdx >= 0, "folder-slot marker must exist (now inside the scorecard rail)");
    assert.ok(
      composeIdx < gridIdx,
      "compose-slot must sit above the editor grid",
    );
    assert.ok(
      folderIdx > gridIdx,
      "folder-slot must now live inside the rail (after the editor grid opens)",
    );
  });

  it("render() replaces the compose-slot with composePanelHtml output", () => {
    assert.ok(
      letterJs.includes('.replace("<!--compose-slot-->"'),
      "render() must inject the initial compose panel into the shell",
    );
    assert.ok(
      letterJs.includes("function composePanelHtml("),
      "letter.js must define composePanelHtml()",
    );
    assert.ok(
      letterJs.includes("function refreshComposeDefaultsAsync("),
      "letter.js must define refreshComposeDefaultsAsync() for async profile-source refresh",
    );
  });
});

describe("Workshop compose panel — markup contract", () => {
  it("emits the document/tone/length selects, Title input, and Version Notes textarea", () => {
    assert.ok(letterJs.includes('data-compose-feature'), "compose must emit data-compose-feature select");
    assert.ok(letterJs.includes('data-compose-tone'), "compose must emit data-compose-tone select");
    assert.ok(letterJs.includes('data-compose-length'), "compose must emit data-compose-length select");
    assert.ok(letterJs.includes('data-compose-notes'), "compose must emit data-compose-notes textarea");
    assert.ok(letterJs.includes('data-compose-title'), "compose must emit data-compose-title input");
    assert.ok(letterJs.includes("Version Notes"), "compose must label its notes field 'Version Notes'");
  });

  it("Suggest button + compose-refresh-notes action are gone", () => {
    assert.ok(
      !letterJs.includes('data-action="compose-refresh-notes"'),
      "compose-refresh-notes action must be removed (Suggest button gone)",
    );
    assert.ok(
      !letterJs.includes('action === "compose-refresh-notes"'),
      "click delegate must not branch on compose-refresh-notes any more",
    );
    assert.ok(
      !letterJs.includes("jb-letter-compose__refresh"),
      "the .jb-letter-compose__refresh pill class must be gone from letter.js",
    );
  });

  it("exposes the remaining two compose actions on the click delegate", () => {
    assert.ok(letterJs.includes('data-action="compose-generate"'), "compose must emit a generate action button");
    assert.ok(letterJs.includes('data-action="compose-open-modal"'), "compose must emit an advanced/open-modal action");
    assert.ok(letterJs.includes('action === "compose-generate"'), "click delegate must branch on compose-generate");
    assert.ok(
      letterJs.includes('action === "compose-open-modal"'),
      "click delegate must branch on compose-open-modal",
    );
  });

  it("compose-generate calls runResumeGeneration with silent + title options", () => {
    assert.ok(
      letterJs.includes("root.runResumeGeneration"),
      "compose-generate must call window.runResumeGeneration",
    );
    assert.ok(
      letterJs.includes("silent: true"),
      "compose-generate must pass silent: true so the legacy modal stays closed",
    );
    assert.ok(
      /title:\s*state\.title/.test(letterJs),
      "compose-generate must pass the Title field through to runResumeGeneration",
    );
  });

  it("the cached fit-angle line in Compose summary has been removed", () => {
    assert.ok(
      !letterJs.includes('"jb-letter-compose__fit-label"') &&
        !letterJs.includes("Fit angle ·"),
      "the fit-angle line is now LLM-derived from the latest draft; the cached one must be gone",
    );
  });
});

describe("Workshop compose panel — app.js options pass-through", () => {
  it("runResumeGeneration accepts tone/maxWords/silent options", () => {
    const fnStart = appJs.indexOf("async function runResumeGeneration");
    const fnEnd = appJs.indexOf("async function refineLastResumeGeneration", fnStart);
    const body = appJs.slice(fnStart, fnEnd);
    assert.ok(body.includes("options.tone"), "runResumeGeneration must read options.tone");
    assert.ok(body.includes("options.maxWords"), "runResumeGeneration must read options.maxWords");
    assert.ok(body.includes("options.silent"), "runResumeGeneration must read options.silent");
    assert.ok(
      body.includes("maxWordsOverride") && body.includes("toneOverride"),
      "runResumeGeneration must derive override values from the option fields",
    );
    assert.ok(
      body.includes("profile.preferences = { ...profile.preferences, tone:"),
      "tone override must flow into profile.preferences before bundle build",
    );
  });

  it("exports compose-friendly helpers on window", () => {
    assert.ok(
      /window\.runResumeGeneration\s*=\s*runResumeGeneration/.test(appJs),
      "app.js must expose window.runResumeGeneration for letter.js",
    );
    assert.ok(
      /window\.buildDraftNotesPrefill\s*=\s*buildDraftNotesPrefill/.test(appJs),
      "app.js must expose window.buildDraftNotesPrefill for letter.js",
    );
    assert.ok(
      /window\.getWorkshopProfileSummary\s*=/.test(appJs),
      "app.js must expose window.getWorkshopProfileSummary for compose-panel source dots",
    );
  });
});

describe("Workshop compose panel — CSS surface", () => {
  it("scopes .jb-letter-compose styles under the v2 region selector", () => {
    assert.ok(
      /body\.jb-v2 \[data-region="letter"\] \.jb-letter-compose\b/.test(letterCss),
      "compose styles must be scoped under body.jb-v2 [data-region=\"letter\"]",
    );
    assert.ok(letterCss.includes(".jb-letter-compose__primary"), "primary generate button must be styled");
    assert.ok(letterCss.includes(".jb-letter-compose__select"), "select controls must be styled");
    assert.ok(letterCss.includes(".jb-letter-compose__notes"), "notes textarea must be styled");
    assert.ok(letterCss.includes(".jb-letter-compose__chip"), "must-have chips must be styled");
    assert.ok(
      letterCss.includes('.jb-letter-compose__source[data-present="true"]'),
      "profile-source badges must visually differentiate present vs absent",
    );
  });

  it("reuses v2 tokens (paper, navy, mint, line) instead of ad-hoc hex", () => {
    const start = letterCss.indexOf(".jb-letter-compose");
    assert.ok(start >= 0, "compose block must exist in letter.css");
    const block = letterCss.slice(start);
    assert.ok(block.includes("--jb-paper"), "compose CSS must reference --jb-paper");
    assert.ok(block.includes("--jb-navy"), "compose CSS must reference --jb-navy");
    assert.ok(block.includes("--jb-mint-deep") || block.includes("--jb-mint-soft"),
      "compose CSS must reference the mint tokens");
  });
});

describe("Workshop compose panel — live render smoke", () => {
  it("renders the compose section with default tone=warm and length=350", () => {
    const editor = { textContent: "", innerHTML: "", addEventListener() {} };
    const saveText = { textContent: "" };
    const save = {
      setAttribute() {},
      getAttribute() { return "saved"; },
      querySelector(sel) { return sel === ".jb-letter-save__text" ? saveText : null; },
    };
    const region = {
      innerHTML: "",
      __letterHtml: "",
      __letterCtx: null,
      querySelector(selector) {
        if (selector === "[data-letter-editor]") return editor;
        if (selector === ".jb-letter-save") return save;
        return null;
      },
      querySelectorAll() {
        const rows = [];
        rows.forEach = Array.prototype.forEach.bind(rows);
        return rows;
      },
      addEventListener() {},
    };
    const doc = {
      readyState: "complete",
      body: { classList: { contains(name) { return name === "jb-v2"; } } },
      querySelector(selector) { return selector === '[data-region="letter"]' ? region : null; },
      addEventListener() {},
    };
    const win = {
      location: { hash: "#letter=0" },
      addEventListener() {},
      JobBoredDawn: {
        data: {
          getLetterViewModel() {
            return {
              job: {
                jobKey: "0",
                role: "Platform Engineer",
                company: "Acme",
                jdSnippet: "Go Kubernetes Postgres",
              },
              draft: "I shipped platform work.",
              ats: {
                score: 42, keywordCoverage: 30, toneMatch: 60,
                length: { words: 4, target: [200, 320] },
                hits: [], misses: [], readingLevel: "Grade 8",
              },
            };
          },
        },
      },
      getPipelineJobByIndex() {
        return {
          title: "Platform Engineer",
          company: "Acme",
          _postingEnrichment: {
            fitAngle: "Lead platform reliability work end-to-end.",
            mustHaves: ["Kubernetes", "Go", "Observability"],
          },
        };
      },
      getDraftsForJob() { return []; },
      buildDraftNotesPrefill() {
        return "Angle: Lead platform reliability work end-to-end.\nMust show: Kubernetes; Go; Observability";
      },
      getWorkshopProfileSummary: async () => ({
        hasResume: true, hasLinkedIn: false, hasAdditional: false,
        tone: "warm", defaultMaxWords: 350,
      }),
      Promise,
    };
    vm.runInNewContext(letterJs, {
      window: win,
      document: doc,
      MutationObserver: class { observe() {} },
      console, Date, Number, String, parseInt, isFinite,
      setTimeout, clearTimeout, Promise,
    });
    assert.match(region.innerHTML, /jb-letter-compose\b/, "compose section must render");
    assert.match(region.innerHTML, /data-compose-feature/, "compose must include the document type select");
    assert.match(region.innerHTML, /data-compose-tone/, "compose must include the tone select");
    assert.match(region.innerHTML, /data-compose-length/, "compose must include the length select");
    assert.match(region.innerHTML, /data-compose-notes/, "compose must include the notes textarea");
    assert.match(
      region.innerHTML,
      /<option value="warm" selected>/,
      "default tone must be 'warm' on first render",
    );
    assert.match(
      region.innerHTML,
      /<option value="350" selected>/,
      "default length must be 350 words on first render",
    );
    assert.match(
      region.innerHTML,
      /Kubernetes/,
      "must-have chips must come from job._postingEnrichment.mustHaves",
    );
    assert.doesNotMatch(
      region.innerHTML,
      /jb-letter-compose__fit-label/,
      "the cached fit-angle line must NOT render in compose; it now lives in the scorecard as an LLM insight",
    );
    assert.match(
      region.innerHTML,
      /data-action="compose-generate"/,
      "primary generate button must be present",
    );
    assert.match(
      region.innerHTML,
      /data-compose-title/,
      "Title input must render",
    );
    assert.match(
      region.innerHTML,
      /Version Notes/,
      "Notes textarea must be labeled 'Version Notes'",
    );
  });
});
