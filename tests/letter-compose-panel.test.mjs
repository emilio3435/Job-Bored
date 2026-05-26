/**
 * tests/letter-compose-panel.test.mjs
 *
 * Compose panel for the Workshop (v2 letter region). Verifies that:
 *   1. The shell HTML reserves a compose slot between the folder strip
 *      and the editor grid.
 *   2. letter.js exposes the prefill + select/tone/length controls and
 *      wires the compose actions (generate, suggest, advanced).
 *   3. app.js's runResumeGeneration accepts the tone/maxWords/silent
 *      options the compose panel emits and is exported on window so
 *      letter.js can call it.
 *   4. letter.css scopes the .jb-letter-compose styles under the v2
 *      region selector and reuses v2 tokens.
 *   5. The live render produces a usable compose section with default
 *      tone (warm) and default length (~350).
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
  it("shellHtml reserves a compose-slot between the folder strip and the editor grid", () => {
    const folderIdx = letterJs.indexOf("<!--folder-slot-->");
    const composeIdx = letterJs.indexOf("<!--compose-slot-->");
    const gridIdx = letterJs.indexOf("'<div class=\"jb-letter-grid\">'");
    assert.ok(folderIdx >= 0, "folder-slot marker must exist");
    assert.ok(composeIdx >= 0, "compose-slot marker must exist");
    assert.ok(gridIdx >= 0, "editor grid marker must exist");
    assert.ok(
      composeIdx > folderIdx && composeIdx < gridIdx,
      "compose-slot must sit between the folder slot and the editor grid",
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
  it("emits the document/tone/length selects with documented data attrs", () => {
    assert.ok(letterJs.includes('data-compose-feature'), "compose must emit data-compose-feature select");
    assert.ok(letterJs.includes('data-compose-tone'), "compose must emit data-compose-tone select");
    assert.ok(letterJs.includes('data-compose-length'), "compose must emit data-compose-length select");
    assert.ok(letterJs.includes('data-compose-notes'), "compose must emit data-compose-notes textarea");
  });

  it("exposes the three compose actions on the click delegate", () => {
    assert.ok(letterJs.includes('data-action="compose-generate"'), "compose must emit a generate action button");
    assert.ok(letterJs.includes('data-action="compose-refresh-notes"'), "compose must emit a refresh-notes action");
    assert.ok(letterJs.includes('data-action="compose-open-modal"'), "compose must emit an advanced/open-modal action");
    assert.ok(letterJs.includes('action === "compose-generate"'), "click delegate must branch on compose-generate");
    assert.ok(
      letterJs.includes('action === "compose-refresh-notes"'),
      "click delegate must branch on compose-refresh-notes",
    );
    assert.ok(
      letterJs.includes('action === "compose-open-modal"'),
      "click delegate must branch on compose-open-modal",
    );
  });

  it("compose-generate calls runResumeGeneration with the silent option", () => {
    assert.ok(
      letterJs.includes("root.runResumeGeneration"),
      "compose-generate must call window.runResumeGeneration",
    );
    assert.ok(
      letterJs.includes("silent: true"),
      "compose-generate must pass silent: true so the legacy modal stays closed",
    );
  });

  it("notes prefill uses the app.js buildDraftNotesPrefill helper", () => {
    assert.ok(
      letterJs.includes("root.buildDraftNotesPrefill"),
      "compose must source notes prefill from buildDraftNotesPrefill",
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
    assert.match(
      region.innerHTML,
      /Lead platform reliability/,
      "fit-angle copy must surface in the compose summary",
    );
    assert.match(
      region.innerHTML,
      /data-action="compose-generate"/,
      "primary generate button must be present",
    );
  });
});
