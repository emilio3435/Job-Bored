/**
 * tests/letter-draft-folder.test.mjs
 *
 * Wiring contract for the Part 04 "draft folder" strip added to the v2
 * letter region. Drafts saved by app.js's runResumeGeneration must surface
 * in letter.js's `[data-region="letter"]` without the user opening the
 * legacy resume-generate modal.
 *
 * Failure messages point at the specific seam (app.js bridge / event
 * dispatch / letter.js folder render / click handler) so regressions can
 * be diagnosed quickly.
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

describe("Letter region — draft folder bridge (app.js exports)", () => {
  it("exposes window.getDraftsForJob so letter.js can list saved drafts", () => {
    assert.ok(
      /window\.getDraftsForJob\s*=\s*getDraftsForJob/.test(appJs),
      "app.js must assign window.getDraftsForJob = getDraftsForJob so letter.js can read the cache",
    );
  });

  it("exposes window.openSavedDraftVersion for the fullscreen ⤢ affordance", () => {
    assert.ok(
      /window\.openSavedDraftVersion\s*=\s*openSavedDraftVersion/.test(appJs),
      "app.js must expose openSavedDraftVersion so the folder card ⤢ button opens the legacy modal",
    );
  });

  it("exposes window.getPipelineJobByIndex so letter.js can map stableKey → job object", () => {
    assert.ok(
      /window\.getPipelineJobByIndex\s*=\s*function/.test(appJs),
      "app.js must expose getPipelineJobByIndex(idx) → pipelineData[idx] for the v2 letter region",
    );
  });

  it("exposes reviseLetterDraftForJob so letter.js can run in-page AI revisions", () => {
    assert.ok(
      /window\.reviseLetterDraftForJob\s*=\s*reviseLetterDraftForJob/.test(appJs),
      "app.js must expose reviseLetterDraftForJob for the letter region one-click tools",
    );
  });
});

describe("Letter region — jb:draft:saved dispatch", () => {
  it("runResumeGeneration dispatches jb:draft:saved after the initial save", () => {
    const fnStart = appJs.indexOf("async function runResumeGeneration");
    assert.ok(fnStart >= 0, "runResumeGeneration must exist");
    const fnEnd = appJs.indexOf("async function refineLastResumeGeneration", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);
    assert.ok(
      fnBody.includes('"jb:draft:saved"'),
      "runResumeGeneration must dispatch a 'jb:draft:saved' CustomEvent after saveGeneratedDraft",
    );
    assert.ok(
      fnBody.includes('mode: "initial"'),
      "initial-save dispatch must include mode: 'initial' in detail",
    );
    assert.ok(
      /jobKey:\s*String\(dataIndex\)/.test(fnBody),
      "initial-save dispatch jobKey must be String(dataIndex) so it matches letter.js's stableKey",
    );
  });

  it("refineLastResumeGeneration dispatches jb:draft:saved after the refine save", () => {
    const fnStart = appJs.indexOf("async function refineLastResumeGeneration");
    assert.ok(fnStart >= 0, "refineLastResumeGeneration must exist");
    const fnEnd = appJs.indexOf("async function openSavedDraftVersion", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);
    assert.ok(
      fnBody.includes('"jb:draft:saved"'),
      "refineLastResumeGeneration must dispatch a 'jb:draft:saved' CustomEvent so the folder updates",
    );
    assert.ok(
      fnBody.includes('mode: "refine"'),
      "refine dispatch must include mode: 'refine' in detail",
    );
  });

  it("runResumeGeneration stashes dataIndex on the session so refine can use it as jobKey", () => {
    const fnStart = appJs.indexOf("async function runResumeGeneration");
    const fnEnd = appJs.indexOf("async function refineLastResumeGeneration", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);
    assert.ok(
      /lastResumeGenerationSession\s*=\s*\{[\s\S]*?dataIndex,/.test(fnBody),
      "runResumeGeneration must persist dataIndex on lastResumeGenerationSession so refine's dispatch can derive a jobKey",
    );
  });
});

describe("Letter region — folder rendering (letter.js)", () => {
  it("declares the folder HTML builder with the documented CSS classes", () => {
    assert.ok(
      letterJs.includes("function folderHtml("),
      "letter.js must define folderHtml() to render the draft strip",
    );
    assert.ok(
      letterJs.includes("function draftCardHtml("),
      "letter.js must define draftCardHtml() to render individual draft cards",
    );
    assert.ok(
      letterJs.includes("jb-letter-folder__card"),
      "letter.js must emit .jb-letter-folder__card so the CSS in letter.css can style it",
    );
    assert.ok(
      letterJs.includes('data-region-folder'),
      "letter.js must mark the folder root with data-region-folder for selective re-render",
    );
  });

  it("renders separate lanes for cover_letter and resume_update", () => {
    assert.ok(
      letterJs.includes('data-feature="cover_letter"'),
      "folderHtml must label the cover-letter lane with data-feature=cover_letter",
    );
    assert.ok(
      letterJs.includes('data-feature="resume_update"'),
      "folderHtml must label the résumé lane with data-feature=resume_update",
    );
  });

  it("renders a hidden empty-state shell when there are zero drafts (hero CTAs own the entry)", () => {
    // The "+ Cover letter" and "+ Tailor résumé" buttons used to live in
    // the empty-state. They were intentionally removed to eliminate the
    // duplication with the Workshop hero CTAs above, which now own the
    // "start a draft" entry point. The empty shell stays in the DOM but
    // is hidden so the strip doesn't render a second blank card.
    assert.ok(
      letterJs.includes("jb-letter-folder--empty"),
      "letter.js must still render the .jb-letter-folder--empty shell when no drafts exist",
    );
    assert.ok(
      letterJs.includes("jb-letter-folder--empty\" hidden"),
      "empty-state shell must be hidden — hero CTAs (data-action=resume-cover / resume-tailor) own the entry point now",
    );
    assert.ok(
      !letterJs.includes('data-action="new-cover-letter"'),
      "folder strip must NOT duplicate the cover-letter CTA — it lives in the Workshop hero (data-action=resume-cover)",
    );
    assert.ok(
      !letterJs.includes('data-action="new-resume"'),
      "folder strip must NOT duplicate the resume CTA — it lives in the Workshop hero (data-action=resume-tailor)",
    );
  });

  it("each draft card carries the data-actions required for the click handler", () => {
    assert.ok(
      letterJs.includes('data-action="load-draft"'),
      "draftCardHtml must set data-action=load-draft so clicking a card swaps the editor body",
    );
    assert.ok(
      letterJs.includes('data-action="open-draft-fullscreen"'),
      "draftCardHtml must include a data-action=open-draft-fullscreen affordance for the legacy modal",
    );
    assert.ok(
      letterJs.includes("data-draft-id="),
      "draftCardHtml must include data-draft-id so the click handler can resolve the draft id",
    );
  });

  it("shellHtml inserts a folder slot between the head and the editor grid", () => {
    const headIdx = letterJs.indexOf("'</header>'");
    const gridIdx = letterJs.indexOf("'<div class=\"jb-letter-grid\">'");
    assert.ok(headIdx >= 0 && gridIdx >= 0, "shellHtml must contain the head and grid markers");
    assert.ok(gridIdx > headIdx, "the editor grid must come after the head");
    const between = letterJs.slice(headIdx, gridIdx);
    assert.ok(
      between.includes("folder-slot"),
      "shellHtml must reserve a <!--folder-slot--> placeholder between </header> and the editor grid",
    );
  });
});

describe("Letter region — click delegation (letter.js)", () => {
  it("load-draft branch resolves the draft via getDraftsForJob + getPipelineJobByIndex", () => {
    assert.ok(
      letterJs.includes('action === "load-draft"'),
      "click handler must branch on action === 'load-draft'",
    );
    assert.ok(
      letterJs.includes("loadDraftIntoEditor("),
      "load-draft branch must call loadDraftIntoEditor() to swap the contenteditable body",
    );
    assert.ok(
      letterJs.includes("root.getPipelineJobByIndex"),
      "load-draft branch must look up the pipeline job via root.getPipelineJobByIndex",
    );
  });

  it("open-draft-fullscreen branch calls window.openSavedDraftVersion and stops propagation", () => {
    assert.ok(
      letterJs.includes('action === "open-draft-fullscreen"'),
      "click handler must branch on action === 'open-draft-fullscreen'",
    );
    assert.ok(
      letterJs.includes("root.openSavedDraftVersion"),
      "open-draft-fullscreen branch must invoke root.openSavedDraftVersion(id)",
    );
  });

  it("new-cover-letter and new-resume branches call openDraftNotesModal", () => {
    assert.ok(
      letterJs.includes('action === "new-cover-letter"'),
      "click handler must branch on action === 'new-cover-letter'",
    );
    assert.ok(
      letterJs.includes('action === "new-resume"'),
      "click handler must branch on action === 'new-resume'",
    );
    assert.ok(
      letterJs.includes("root.openDraftNotesModal"),
      "new-* branches must invoke root.openDraftNotesModal(idx, feature)",
    );
  });

  it("legacy per-miss revision plumbing has been removed", () => {
    /* The Missing keywords block, One-click tools strip, and Custom
       revision textarea are all gone. Their consumer reviseWithAi()
       and the matching action branches are gone too. AI generation
       lives only in the Compose panel now. */
    assert.ok(
      !letterJs.includes("function reviseWithAi("),
      "reviseWithAi() must be removed — no remaining consumers in the rail",
    );
    assert.ok(
      !letterJs.includes('action === "address"'),
      "the address action branch must be removed",
    );
    assert.ok(
      !letterJs.includes('action === "tighten"'),
      "the tighten action branch must be removed",
    );
  });
});

describe("Letter region — AI revision bridge (app.js)", () => {

  it("the app bridge saves AI revisions as generated draft refine versions", () => {
    const fnStart = appJs.indexOf("async function reviseLetterDraftForJob");
    assert.ok(fnStart >= 0, "reviseLetterDraftForJob must exist");
    const fnEnd = appJs.indexOf("// Exposed for the v2 dossier", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);
    assert.ok(
      fnBody.includes("previousDraft") && fnBody.includes("refinementFeedback"),
      "reviseLetterDraftForJob must pass previousDraft and refinementFeedback into the bundle",
    );
    assert.ok(
      fnBody.includes('mode: "refine"'),
      "reviseLetterDraftForJob must save revisions as refine versions",
    );
    assert.ok(
      fnBody.includes('"jb:draft:saved"'),
      "reviseLetterDraftForJob must dispatch jb:draft:saved after saving",
    );
  });
});

describe("Letter region — render smoke", () => {
  it("renders the Compose panel and per-miss Address controls in the live shell HTML", () => {
    const editor = {
      textContent: "",
      innerHTML: "",
      addEventListener() {},
    };
    const saveText = { textContent: "" };
    const save = {
      setAttribute() {},
      querySelector(selector) {
        return selector === ".jb-letter-save__text" ? saveText : null;
      },
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
    const document = {
      readyState: "complete",
      body: {
        classList: {
          contains(name) {
            return name === "jb-v2";
          },
        },
      },
      querySelector(selector) {
        return selector === '[data-region="letter"]' ? region : null;
      },
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
                score: 42,
                keywordCoverage: 30,
                toneMatch: 60,
                length: { words: 4, target: [200, 320] },
                hits: [],
                misses: [{ term: "Kubernetes", weight: 2 }],
                readingLevel: "Grade 8",
              },
            };
          },
        },
      },
      getPipelineJobByIndex() {
        return { title: "Platform Engineer", company: "Acme" };
      },
      getDraftsForJob() {
        return [];
      },
    };
    vm.runInNewContext(letterJs, {
      window: win,
      document,
      MutationObserver: class {
        observe() {}
      },
      console,
      Date,
      Number,
      String,
      parseInt,
      isFinite,
      setTimeout,
      clearTimeout,
    });
    /* One-click tools (tighten/add-evidence/honest-cut/trim/manual-revise)
       and the Custom-revision textarea were removed from the right rail.
       Generation/revision now lives in the Compose panel above the editor;
       the only AI-revision touchpoint left in the rail is the per-miss
       Address button on each missing-keyword row. The Missing keywords
       block itself has since been removed entirely — deterministic
       token-match scoring was replaced by LLM per-draft insights. */
    assert.doesNotMatch(region.innerHTML, /data-action="tighten"/);
    assert.doesNotMatch(region.innerHTML, /data-action="manual-revise"/);
    assert.doesNotMatch(region.innerHTML, /data-letter-revision-instructions/);
    assert.doesNotMatch(region.innerHTML, /data-action="address"/);
    assert.doesNotMatch(region.innerHTML, /jb-letter-block--misses/);
    assert.doesNotMatch(region.innerHTML, /data-letter-misses/);
    assert.match(region.innerHTML, /data-action="compose-generate"/);
  });
});

describe("Letter region — live update on draft save", () => {
  it("listens for jb:draft:saved and triggers a re-render that promotes the new draft", () => {
    assert.ok(
      letterJs.includes('"jb:draft:saved"'),
      "letter.js must subscribe to the jb:draft:saved CustomEvent",
    );
    assert.ok(
      letterJs.includes("pendingActiveDraftId"),
      "letter.js must track pendingActiveDraftId so the freshly saved draft auto-loads on next render",
    );
  });

  it("render() refreshes the folder in place when jobKey is unchanged (no editor flicker)", () => {
    assert.ok(
      letterJs.includes("renderFolderInto("),
      "letter.js must define renderFolderInto for selective re-render",
    );
  });
});

describe("Letter region — CSS surface (letter.css)", () => {
  it("defines paper-card folder styles scoped under body.jb-v2 [data-region=\"letter\"]", () => {
    assert.ok(
      letterCss.includes(".jb-letter-folder__card"),
      "letter.css must style .jb-letter-folder__card",
    );
    assert.ok(
      letterCss.includes(".jb-letter-folder__card.is-active"),
      "letter.css must style the active draft card (.is-active)",
    );
    assert.ok(
      letterCss.includes(".jb-letter-folder--empty"),
      "letter.css must style the empty-state shell",
    );
    assert.ok(
      /body\.jb-v2 \[data-region="letter"\] \.jb-letter-folder/.test(letterCss),
      "folder styles must be scoped under body.jb-v2 [data-region=\"letter\"]",
    );
  });

  it("reuses v2 tokens (paper, line, ink, amber, shadow) rather than ad-hoc hex", () => {
    const folderBlockStart = letterCss.indexOf(".jb-letter-folder");
    assert.ok(folderBlockStart >= 0);
    const folderBlock = letterCss.slice(folderBlockStart);
    assert.ok(folderBlock.includes("--jb-paper"), "folder CSS must reference --jb-paper");
    assert.ok(folderBlock.includes("--jb-amber"), "active card must use --jb-amber");
    assert.ok(folderBlock.includes("--jb-shadow-pencil"), "cards must use --jb-shadow-pencil for the paper look");
  });
});
