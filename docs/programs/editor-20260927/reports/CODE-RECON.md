# Code recon: the Scribe manual-edit section (Opus agent, 2026-09-27, main 98903e29)

Labels:
- **[C]** confirmed in code or by a headless CSS probe.
- **[I]** inferred.

## Where it lives
- **Mount point:** `index.html:465-481`, `<section data-region="scribe" class="jb-scribe-region">`. This is the last content region, after pipeline and role.
- **Scripts:** `scribe-state.js`, `scribe-score-adapter.js`, `scribe.js`. They depend on the legacy modules `resume-generation.js`, `materials-state.js`, `user-content-store.js`, `resume-generate.js` and `ats-scorecard.js`.
- **CSS:** `scribe.css` (915 lines, region-scoped) and `jb-v2-legacy-hide.css`, which is loaded last.
- **Render:** `scribe.js:147-296` builds the whole workspace as one `innerHTML` string:
  - **Top bar:** "Draft for", the role, a save pill, Cover letter / Resume tabs, an "Appearance" select, and Print / Copy / Done.
  - **Editor pane:** a contenteditable `#scribeEditor`, a word counter, a keyword coverage meter, and the versions rail (`#scribeVersions`, title input, Save version).
  - **Scorecard pane:** a fit ring, Rescore, axes, gaps, evidence and talking points.
  - **Refine strip:** chips ("more specific", "cut to 250 words", plus "+ term" chips), `#scribeRefineInput` and `#scribeRefineBtn`.
- **Layout:** a grid with `min-height:100vh`; editor 1.55fr against scorecard 1fr; the columns stack below 900px.
- **How it opens:**
  1. The role Case renders a Materials section (`role-case.js:446-450`).
  2. `role-materials.js:1028-1161` builds one row per document type: resume, cover_letter, manual_apply_checklist, qa_report. Each row offers Repair, Preview, Download PDF, **Edit** and Open.
  3. **Edit** calls `editInScribe` (`role-materials.js:1514-1535`), which fetches the published `resume.html` / `cover-letter.html`, flattens it to plain text with `htmlToText`, and calls `JB_SCRIBE.openDocument` (`scribe.js:944-987`).
  4. `openDocument` remounts the region inside the Case canvas; `closeDocument` returns it on `jb:role:closed`.
- **Draft buttons:** "Draft cover letter" and "Tailor resume" in the Case docket (`role-case.js:153-172`) run the full server redraft.

## Data model: two stores that never meet
- **A. Browser (IndexedDB `command-center-user-content` v2, store `generatedDrafts`)**
  - Record fields: `id`, `feature` (`cover_letter` / `resume_update`), `mode` (`initial` / `refine`), `jobKey`, `versionNumber`, `text` (plain, at most 60k), `excerpt`, `createdAt`, `parentDraftId`, `userNotes`, `refinementFeedback`, `jobSnapshot`, `title`, `insights`.
  - There is **no HTML, PDF or template** in the record.
  - `scribe-state.js`: autosave debounces for 1500 ms. The first write mints a `mode:"refine"` row; later autosaves overwrite that same row. "Save version" mints a new titled row.
  - The "current" text is the hidden legacy textarea `#resumeGenerateOutput`.
- **B. Server packages** (`server/materials-package.mjs`)
  - Each role gets `resume.html/.pdf/.txt`, `cover-letter.*`, `render-model.json`, `run.json` and `manifest.json`, plus an **immutable `runs/<runId>/` copy of every run**.
  - **No endpoint lists `runs/`.** Only `regenerate` accepts `from: runId` (`materials-regenerate.mjs:84-95`). **[C]**

## Edit-request flows
1. **Scribe Refine (in-browser, bring-your-own-key)**
   - `runRefine` (`scribe.js:549-614`) → `refineLastResumeGeneration` (`resume-generation.js:1036-1159`) → `generateFromBundle`.
   - It is a direct browser call to the provider: a **full regeneration** with the previous draft as context. Not a patch, and not streamed.
   - The result is saved to IndexedDB, then the editor content is replaced wholesale.
2. **Server redraft or repair**
   - `POST /api/applications/:slug/request` takes `{slug, company, title, feature, jobUrl, notes≤4000, resume, jobDescription?, template?}` (`materials-request.mjs:83-137`).
   - `POST …/repair` also exists.
   - Both are queued in a FIFO. The client polls `GET …/manifest` every 3 → 12 s for up to 30 minutes. A stall message appears at 180 s (median run is about 90 s) **[I]**.
   - `POST …/regenerate {template, from?}` re-renders **without an LLM** and needs Chromium.
   - Also: `/dismiss`, `/job-description`, `/files/:filename`, `/api/applications`, `/queue`, `/api/materials/templates`.
   - **No endpoint writes a user-edited document back, and none refines a published package from an instruction.** **[C]**
3. **Rescore:** `scribe-score-adapter.js` → `POST /api/ats-scorecard`. Runs only when clicked.

## Rendering
- **Server:** `templates/materials/{signal,dossier,editorial}` via `materials-render.mjs` (`buildView`, `renderDocument`, `retargetModel`) and `materials-pdf.mjs`. Families come from `materials-templates.mjs` (default: `signal`).
- **Dossier:** no inline preview. Preview opens `…/files/resume.html` in a new tab. There are no PNG previews.
- **Scribe:** renders **plain text only** (`<p data-scribe-anchor>` blocks). Template structure is lost, and there is no live template preview.

## Defects (numbered to match the full report)
1. **[C]** `jb-v2-legacy-hide.css:80-86` forces `display:block !important`, which beats `[hidden]`. An empty, unbound Scribe at least 100vh tall shows at the page bottom after sign-in (probe: display block, height 916px).
2. **[C]** `min-height:100vh` has no override inside the dossier.
3. **[C/I]** Refine is dead in v2: `lastResumeGenerationSession` is never created, so it toasts "Generate a draft first" and reports "made no changes".
4. **[C]** Rescore reports "unbound" in document-bound mode.
5. **[C]** Edits never reach the server package. Preview and PDF keep serving the AI draft.
6. **[I]** Print produces a blank page: the print CSS reveals only a modal that is `display:none !important`.
7. **[C]** Done does nothing visible.
8. **[C]** The tabs don't switch documents. They lack `aria-controls` and arrow-key support.
9. **[C]** The Appearance select is empty.
10. **[I]** Autosave can overwrite the wrong row after an older version is opened.
11. **[C]** Manual edits are labelled "Refined".
12. **[I]** A job-key mismatch empties the version rail for ATS URLs that carry `gh_jid` / `currentjobid`.
13. **[I]** Version-number race: read then write happen in separate transactions.
14. **[C]** Server run history exists but is never shown.
15. **[C]** No diff (only mammoth and pdf.js are vendored), no compare, no chat, and past instructions are never shown.
16. **[C]** The "single undo step" claim is false: replacing `innerHTML` wipes the undo stack.
17. **[C]** "Notes for the next draft" sits far from the redraft buttons, and Repair ignores the notes.
18. **[C]** Primary buttons put `--jb-ink-inverse` on mint, about 2.0:1. DESIGN.md forbids this; they should use `--jb-on-accent`.
19. **[C]** 17 declarations set 10–11px font sizes, below the DESIGN floor.
20. **[C]** Two visual languages: the Case uses navy / parchment `--dsr-*`, while Scribe uses mint stickers.
21. **[C]** Dead or legacy code: the legacy modal pipeline, workshop leftovers, a `HTMLElement.prototype.click` monkey-patch in shipping code, an audit-log `href="#"`, a drifted `SCRIBE.md`, and a no-op unmount.
22. **[C]** `aria-disabled` has no styling. The version list rebuilds its `innerHTML` on every notification.

## Reusable pieces
- **Server:**
  - `callEditor({scorecard,current})`, `callWriter`, `callJsonStage` (`materials-writer.mjs:759-832`). The Writer → Composer → Critic → Editor loop is drawn in `diagrams/materials-writer-composer-loop.mmd` (main checkout, untracked).
  - `regeneratePackage` with `from: runId`; `writePackageRecords` for the run history.
  - `renderDocument`, `buildView`, `retargetModel`, `listFamilies`, `renderPdfIfPossible`, `buildRepairRequestPayload`.
- **Client:**
  - `apiFetch`, `fetchJson`, `postJson`.
  - `startPolling`, `commitManifest`, and the `jb:materials:*` events.
  - `fileUrl`, `fileVersion`, `htmlToText`, `docActionButtons`, `templateBarHtml`.
- **Worth keeping from Scribe:**
  - the truthful save-state machine;
  - the async refine truth rules (in-flight guard, `jb:draft:saved`, `announce`);
  - the `keywordCoverage` meter;
  - the `jb:ats:state` scoring bus.
- **Store:** `saveGeneratedDraft`, `putGeneratedDraft`, `listGeneratedDraftsForJob`, preferences.
- **Design:**
  - `tokens-v2.css` semantics: `--jb-action`, `--jb-on-accent`, `--jb-accent-ink`, type roles, `--jb-shadow-focus`.
  - Components: `<jb-fit-ring>`, `<jb-ai-chip>`, `.jb-sticker`, `.jb-stamp`.
  - `jb-a11y.js` (`JobBoredA11y.live.announce`), the `role-case.css` doc rows, and `css/oneflow.css`.
- **Missing:** no diff library and no streaming helper. Every LLM call is a single non-streaming fetch.

## Constraints
- **CSP** (`scripts/lib/browser-csp-policy.mjs`):
  - `connect-src` allows `127.0.0.1:*` / `localhost:*` plus the AI hosts, so streaming fetch works.
  - `frame-src` allows only `accounts.google.com`, so an **iframe of the :3847 resume.html is blocked**. So is **`img-src http://127.0.0.1` / `blob:`**.
  - There is no `worker-src`.
  - Implication: a preview must use `srcdoc` built client-side, or the CSP must change.
- **Static allowlist:** root JS/CSS, plus `css/`, `partials/`, `vendor/`, `lib/` and similar. `templates/` is **not public**, so the browser can't load the material templates directly. `server/` is dark except `profile-draft-shared.js`.
- **Tests:**
  - Scribe: `scribe*.test.mjs` (7 files, about 105 tests), `ux01-e-scribe`, `draft-generation-stability`, `data-integrity-resume-and-saves`, `materials-preview-fold`, `role-materials*`, `role-case*`, `ux01-e-materials` / `ux01-e-case`.
  - Server: `materials-*` and `application-materials`.
  - Browser: e2e-smoke `case-dossier` and `dossier-layout`; e2e-journey `critical-journey:408-514`; e2e-visual `materials-templates`.
  - **No browser spec checks Scribe at all.**
- **Lint:** `lint:tokens` baseline; `test:materials-contract`.
