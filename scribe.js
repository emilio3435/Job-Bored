/* ============================================================
   scribe.js — JobBored v2 ATS + Cover Letter Workspace (Phase 3)
   ------------------------------------------------------------
   Owner:      Scribe
   Activates:  document.body.classList.contains('jb-v2'), observed
               (NOT sampled once — the flag script in index.html
               adds the class from a DOMContentLoaded listener,
               after this deferred script has already run, and the
               settings toggle adds it later still).
   Region:     <section data-region="scribe">
   Behavior:
     - Renders a split-pane workspace (editor | scorecard) with a
       docked refine strip and tabs (Cover letter / Resume), bound
       to the LIVE generation session: the role label, the document
       tab and the version rail all follow
       getLastResumeGenerationSession().
     - Reuses the legacy modal actions by triggering `click` on the
       existing legacy DOM ids:
         #resumeGeneratePrint    (Print/PDF)
         #resumeGenerateCopy     (Copy text)
         #resumeGenerateDone     (Done)
         #resumeGenerateClose    (Close)
       The textarea #resumeGenerateOutput remains the source of
       truth for body text, and syncEditorIntoLegacy() is the ONLY
       writer into it.
     - Edits are debounced (~600ms idle) into #resumeGenerateOutput.
       Print / Copy / Done flush that debounce SYNCHRONOUSLY first,
       so no export or close can carry stale text.
     - Refine awaits JobBoredApp.resumeGeneration
       .refineLastResumeGeneration() — the real async generate+save
       — instead of guessing completion with a timer.
     - Scoring belongs to scribe-score-adapter.js (the real
       jb:ats:state bus). This file owns no scoring heuristic.
     - Persistence belongs to scribe-state.js (autosave + named
       versions through CommandCenterUserContent).
     - Smoke routine gated behind ?jb-v2-test=scribe instruments
       the dispatch path and asserts each mapped action fired.

   No new modal is introduced. No legacy data-action attribute
   names are renamed.
   ============================================================ */

(function () {
  "use strict";

  const REGION_SELECTOR = '[data-region="scribe"]';
  const DEBOUNCE_MS = 600;

  /** @type {{rendered:boolean, smoke:boolean, debounceTimer:any, lastEditAt:number,
   *          refineInFlight:boolean, refineCalls:number, unsubscribe:null|Function,
   *          bodyObserver:any, score:any}} */
  const state = {
    rendered: false,
    smoke: false,
    debounceTimer: null,
    lastEditAt: 0,
    refineInFlight: false,
    refineCalls: 0,
    unsubscribe: null,
    bodyObserver: null,
    score: null,
  };

  function isV2() {
    return !!(document.body && document.body.classList.contains("jb-v2"));
  }

  function getRegion() {
    return document.querySelector(REGION_SELECTOR);
  }

  // ---------------------------------------------------------
  // Lane collaborators (lazy — a missing module degrades the
  // workspace honestly instead of throwing).
  // ---------------------------------------------------------
  function scribeState() {
    return window.JobBoredScribeState || null;
  }

  function scribeScore() {
    return window.JobBoredScribeScore || null;
  }

  function resumeGenerationApi() {
    const app = window.JobBoredApp;
    return app && app.resumeGeneration ? app.resumeGeneration : null;
  }

  /* jb-v2's a11y primitive ships in two shapes across the reconciled
     branches: `live.announce(message)` and a flat
     `announce(document, message, options)`. Feature-detecting only one of
     them makes a missing screen-reader announcement a SILENT no-op —
     nothing throws and no test fails, the refine outcome simply never
     reaches anybody who cannot see the pane. Try the namespaced form
     first, then the flat one; never both. */
  function announce(message) {
    const a11y = window.JobBoredA11y;
    if (!a11y) return;
    if (a11y.live && typeof a11y.live.announce === "function") {
      a11y.live.announce(message);
      return;
    }
    if (typeof a11y.announce === "function") {
      a11y.announce(document, message);
    }
  }

  function errorMessage(err) {
    if (!err) return "unknown error";
    return String(err.message || err) || "unknown error";
  }

  // ---------------------------------------------------------
  // Smoke instrumentation: monkey-patch HTMLElement.click so
  // ?jb-v2-test=scribe can record legacy dispatches.
  // ---------------------------------------------------------
  function installSmokeHook() {
    if (window.__JB_SCRIBE_HOOK__) return window.__JB_SCRIBE_HOOK__;
    const calls = [];
    const origClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
      try {
        if (this && this.id) calls.push({ id: this.id, t: Date.now() });
      } catch (_) {
        /* noop */
      }
      return origClick.apply(this, arguments);
    };
    const hook = {
      calls,
      reset() {
        calls.length = 0;
      },
    };
    window.__JB_SCRIBE_HOOK__ = hook;
    return hook;
  }

  // ---------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------
  function render(region) {
    region.innerHTML = `
      <section class="scribe-workspace" aria-label="Cover letter workspace">
        <header class="scribe-topbar" role="toolbar" aria-label="Cover letter actions">
          <div class="scribe-topbar__role">
            <span class="scribe-topbar__role-name">Draft for</span>
            <span class="scribe-topbar__role-target" data-scribe-target data-bound="false">No role bound yet</span>
            <span class="scribe-save" data-scribe-save data-state="idle">no local changes</span>
          </div>

          <div class="scribe-tabs" role="tablist" aria-label="Document">
            <button type="button" class="scribe-tab" role="tab" aria-selected="true"
                    data-scribe-tab="cover_letter" data-feature="cover_letter">Cover letter</button>
            <button type="button" class="scribe-tab" role="tab" aria-selected="false"
                    data-scribe-tab="resume_update" data-feature="resume_update">Resume</button>
          </div>

          <div class="scribe-topbar__actions">
            <label class="scribe-appearance">
              <span>Appearance</span>
              <select id="scribeAppearance" aria-label="Preview appearance theme"></select>
            </label>
            <button type="button" class="scribe-btn" id="scribePrintBtn"
                    aria-label="Print or save as PDF">Print / PDF</button>
            <button type="button" class="scribe-btn" id="scribeCopyBtn"
                    aria-label="Copy plain text">Copy text</button>
            <button type="button" class="scribe-btn scribe-btn--primary" id="scribeDoneBtn"
                    aria-label="Done">Done</button>
          </div>
        </header>

        <div class="scribe-split">
          <section class="scribe-pane scribe-pane--editor" aria-label="Editor">
            <article class="jb-sticker scribe-editor">
              <div class="scribe-editor__head">
                <span class="scribe-editor__kicker" data-scribe-kicker>Cover letter draft</span>
                <span class="scribe-editor__counter" data-scribe-counter>0 words</span>
              </div>
              <div
                class="scribe-editor__doc"
                id="scribeEditor"
                role="textbox"
                aria-multiline="true"
                aria-label="Cover letter draft body"
                contenteditable="true"
                data-empty="true"
                data-placeholder="Generate or paste a draft to begin…"
              ></div>
            </article>

            <article class="jb-sticker scribe-versions" aria-labelledby="scribeVersionsTitle">
              <div class="scribe-versions__head">
                <h4 class="scribe-versions__title" id="scribeVersionsTitle">Saved versions</h4>
              </div>
              <ul class="scribe-versions__list" id="scribeVersions" role="list">
                <li class="scribe-versions__empty">No saved versions yet for this role.</li>
              </ul>
              <div class="scribe-versions__save">
                <input
                  type="text"
                  class="scribe-versions__input"
                  id="scribeVersionTitle"
                  aria-label="Name this version"
                  placeholder="Name this version (optional)"
                />
                <button type="button" class="scribe-btn" id="scribeSaveVersionBtn">Save version</button>
              </div>
            </article>
          </section>

          <aside class="scribe-pane scribe-pane--scorecard" aria-label="ATS match scorecard">
            <article class="jb-sticker scribe-scorecard" id="scribeScorecard" data-score-state="absent">
              <span class="jb-stamp scribe-scorecard__stamp" aria-hidden="true">DRAFT</span>
              <div class="scribe-scorecard__head">
                <jb-fit-ring size="lg" id="scribeFitRing"
                             label="Overall ATS match not available" data-unscored="true"></jb-fit-ring>
                <div class="scribe-scorecard__heading">
                  <span class="scribe-scorecard__kicker">ATS match</span>
                  <h3 class="scribe-scorecard__title">Per-axis scorecard</h3>
                </div>
                <button type="button" class="scribe-btn scribe-scorecard__rescore" id="scribeRescoreBtn">
                  Rescore
                </button>
              </div>
              <p class="scribe-scorecard__note" data-scribe-score-note>
                Scoring is not connected in this session.
              </p>
              <div class="scribe-axes" id="scribeAxes" role="list"></div>
              <footer class="scribe-scorecard__foot">
                <span data-scribe-model>no score on record</span>
                <a href="#" data-scribe-audit
                   aria-label="Open audit log for the most recent scorecard run">audit log</a>
              </footer>
            </article>

            <article class="jb-sticker scribe-gaps" aria-labelledby="scribeGapsTitle">
              <h4 class="scribe-gaps__title" id="scribeGapsTitle">Gap callouts</h4>
              <ul class="scribe-gaps__list" id="scribeGaps" role="list">
                <li class="scribe-gaps__empty">Gap callouts appear once this draft is scored.</li>
              </ul>
            </article>

            <article class="jb-sticker scribe-evidence" aria-labelledby="scribeEvidenceTitle">
              <h4 class="scribe-evidence__title" id="scribeEvidenceTitle">Evidence</h4>
              <ul class="scribe-evidence__list" id="scribeEvidence" role="list">
                <li class="scribe-evidence__empty">Evidence appears once this draft is scored.</li>
              </ul>
            </article>

            <article class="jb-sticker scribe-talking" aria-labelledby="scribeTalkingTitle">
              <h4 class="scribe-talking__title" id="scribeTalkingTitle">Talking points</h4>
              <ul class="scribe-talking__list" id="scribeTalking" role="list">
                <li class="scribe-talking__item">
                  <span class="scribe-talking__bullet" aria-hidden="true">·</span>
                  <span>Talking points appear once this draft is scored.</span>
                </li>
              </ul>
            </article>
          </aside>
        </div>

        <hr class="jb-divider-dashed" aria-hidden="true" />
        <footer class="scribe-strip" aria-label="Refine this draft">
          <div class="scribe-strip__head">
            <span class="scribe-strip__label">Refine this draft</span>
            <span class="scribe-status" data-scribe-status>idle</span>
            <div class="scribe-strip__chips" role="group" aria-label="Quick refinements">
              <button type="button" class="scribe-chip" data-scribe-chip="more specific">more specific</button>
              <button type="button" class="scribe-chip" data-scribe-chip="cut to 250 words">cut to 250 words</button>
              <button type="button" class="scribe-chip" data-scribe-chip="emphasize Python">emphasize Python</button>
              <jb-ai-chip variant="tip">AI applies your edits as a single undo step</jb-ai-chip>
            </div>
          </div>
          <div class="scribe-strip__row">
            <textarea
              id="scribeRefineInput"
              class="scribe-strip__textarea"
              rows="2"
              placeholder="Make the opening more specific, emphasize Python, cut this to 250 words…"
              aria-label="Refine instructions"
            ></textarea>
            <button type="button" class="scribe-btn scribe-btn--primary" id="scribeRefineBtn">Refine</button>
          </div>
        </footer>
      </section>
    `;
    state.rendered = true;
  }

  // ---------------------------------------------------------
  // Sync helpers — bridge to legacy textarea + buttons
  // ---------------------------------------------------------
  function getLegacyOutput() {
    return document.getElementById("resumeGenerateOutput");
  }

  function getEditor() {
    return document.getElementById("scribeEditor");
  }

  function plainTextFromEditor(editor) {
    if (!editor) return "";
    // Convert <p>…</p> blocks to newlines.
    const clone = editor.cloneNode(true);
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    clone.querySelectorAll("p, h3").forEach((p) => {
      p.appendChild(document.createTextNode("\n\n"));
    });
    return (clone.textContent || "")
      .replace(/\u00A0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function htmlFromPlainText(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return "";
    const blocks = trimmed.split(/\n{2,}/);
    return blocks
      .map((block, idx) => {
        const safe = String(block)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br />");
        return `<p data-scribe-anchor="p-${idx}">${safe}</p>`;
      })
      .join("");
  }

  function setEditorFromLegacy() {
    const editor = getEditor();
    const ta = getLegacyOutput();
    if (!editor) return;
    const text = ta && typeof ta.value === "string" ? ta.value : "";
    const html = htmlFromPlainText(text);
    editor.innerHTML = html;
    editor.dataset.empty = html ? "false" : "true";
    updateCounter(editor);
    // Text that arrived FROM the legacy pipeline is already persisted
    // there; it is the baseline for "unsaved", not a pending edit.
    const st = scribeState();
    if (st) st.setBaselineText(plainTextFromEditor(editor));
    refreshScore();
  }

  function syncEditorIntoLegacy() {
    const editor = getEditor();
    const ta = getLegacyOutput();
    if (!editor || !ta) return;
    const text = plainTextFromEditor(editor);
    if (ta.value !== text) {
      ta.value = text;
      // Fire input so app.js scheduleResumeGenerateAtsRefresh runs.
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    updateCounter(editor);
  }

  /**
   * Flush the debounced editor write SYNCHRONOUSLY. Every export path
   * (Print / Copy / Done) and Refine calls this first: the legacy Done
   * handler closes the modal, so an edit still sitting in the debounce
   * would be dropped on the floor.
   */
  function flushEditor() {
    if (state.debounceTimer) {
      window.clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    syncEditorIntoLegacy();
    const st = scribeState();
    if (st) void st.flush(plainTextFromEditor(getEditor()));
  }

  function updateCounter(editor) {
    const region = getRegion();
    if (!region) return;
    const counter = region.querySelector("[data-scribe-counter]");
    if (!counter) return;
    const text = plainTextFromEditor(editor);
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    counter.textContent = `${words} word${words === 1 ? "" : "s"}`;
  }

  // ---------------------------------------------------------
  // Status pip
  // ---------------------------------------------------------
  function setStatus(text, stateName) {
    const region = getRegion();
    if (!region) return;
    const el = region.querySelector("[data-scribe-status]");
    if (!el) return;
    el.textContent = text;
    if (stateName) el.setAttribute("data-state", stateName);
    else el.removeAttribute("data-state");
  }

  // ---------------------------------------------------------
  // Role binding, save state, version rail (scribe-state.js)
  // ---------------------------------------------------------
  function selectTab(feature, dispatchLegacy) {
    const region = getRegion();
    if (!region) return;
    region.querySelectorAll("[data-scribe-tab]").forEach((b) => {
      b.setAttribute("aria-selected", String(b.getAttribute("data-feature") === feature));
    });
    const kicker = region.querySelector("[data-scribe-kicker]");
    if (kicker) {
      kicker.textContent = feature === "resume_update" ? "Resume draft" : "Cover letter draft";
    }
    if (!dispatchLegacy) return;
    // Reuse legacy draft-tab dispatch so app.js's existing
    // [data-action="draft-tab"] listeners flip the active panel.
    const legacyTab = document.querySelector(
      `[data-action="draft-tab"][data-feature="${feature}"]`,
    );
    if (legacyTab && typeof legacyTab.click === "function") legacyTab.click();
  }

  function renderBinding() {
    const region = getRegion();
    if (!region) return;
    const target = region.querySelector("[data-scribe-target]");
    const st = scribeState();
    const binding = st ? st.getBinding() : null;
    if (target) {
      target.textContent = binding ? binding.roleLabel : "No role bound yet";
      target.setAttribute("data-bound", binding && binding.bound ? "true" : "false");
    }
    if (binding) selectTab(binding.feature, false);
  }

  function saveLabel(save) {
    switch (save.state) {
      case "saving":
        return "saving…";
      case "saved":
        return save.truncated ? "saved · truncated at 60,000 characters" : "saved";
      case "failed":
        return `save failed · ${save.error || "unknown error"}`;
      case "unsaved":
        if (save.reason === "empty") return "unsaved · the draft is empty";
        if (save.reason === "unbound") return "unsaved · no role bound";
        if (save.reason === "rebound") return "unsaved · the bound role changed";
        return "unsaved changes";
      default:
        return "no local changes";
    }
  }

  function renderSaveState() {
    const region = getRegion();
    if (!region) return;
    const pill = region.querySelector("[data-scribe-save]");
    if (!pill) return;
    const st = scribeState();
    const save = st ? st.getSaveState() : { state: "idle" };
    pill.setAttribute("data-state", save.state);
    pill.textContent = saveLabel(save);
  }

  function renderVersions() {
    const region = getRegion();
    if (!region) return;
    const list = region.querySelector("#scribeVersions");
    if (!list) return;
    const st = scribeState();
    const versions = st ? st.getVersionsState() : { loaded: true, items: [] };
    if (!versions.loaded) {
      list.innerHTML = '<li class="scribe-versions__empty">Loading saved versions…</li>';
      return;
    }
    if (!versions.items.length) {
      list.innerHTML = '<li class="scribe-versions__empty">No saved versions yet for this role.</li>';
      return;
    }
    list.innerHTML = versions.items
      .map(
        (version) => `
        <li>
          <button type="button" class="scribe-version" data-scribe-version="${version.id}"
                  aria-pressed="${version.active ? "true" : "false"}">
            <span class="scribe-version__num jb-data">V${version.versionNumber}</span>
            <span class="scribe-version__label">${String(version.label).replace(/</g, "&lt;")}</span>
            <span class="scribe-version__at">${String(version.savedAt).replace(/</g, "&lt;")}</span>
          </button>
        </li>
      `,
      )
      .join("");
  }

  function renderStateViews() {
    renderBinding();
    renderSaveState();
    renderVersions();
  }

  function refreshScore() {
    const score = scribeScore();
    if (score && typeof score.refresh === "function") score.refresh();
  }

  // ---------------------------------------------------------
  // Wiring (delegates to existing legacy ids — no rename of
  // legacy data-action attribute names)
  // ---------------------------------------------------------
  function clickLegacy(id) {
    const el = document.getElementById(id);
    if (el && typeof el.click === "function") {
      el.click();
      return true;
    }
    return false;
  }

  function wireTabs(region) {
    region.querySelectorAll("[data-scribe-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectTab(btn.getAttribute("data-feature"), true);
      });
    });
  }

  function setRefineBusy(busy) {
    const region = getRegion();
    if (!region) return;
    const btn = region.querySelector("#scribeRefineBtn");
    if (!btn) return;
    btn.setAttribute("aria-disabled", busy ? "true" : "false");
  }

  /**
   * Refine truth: refineLastResumeGeneration() is async and resolves
   * only after generation AND the draft save; jb:draft:saved corroborates.
   * We await it. The old fixed 350ms snapshot captured the modal's
   * "Refining…" placeholder and reported success while the LLM call was
   * still in flight.
   */
  function runRefine(region) {
    if (state.refineInFlight) return;
    const refineInput = region.querySelector("#scribeRefineInput");

    flushEditor();
    const fb = document.getElementById("resumeGenerateFeedback");
    if (fb && refineInput) {
      fb.value = refineInput.value;
      fb.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const rg = resumeGenerationApi();
    if (!rg || typeof rg.refineLastResumeGeneration !== "function") {
      // Clicking the legacy button here would start work whose completion
      // we cannot observe — exactly the lie this lane removes.
      setStatus("refine unavailable", "err");
      announce("Refine is unavailable in this session.");
      return;
    }

    const ta = getLegacyOutput();
    const before = ta && typeof ta.value === "string" ? ta.value : "";
    let sawDraftSaved = false;
    const onDraftSaved = () => {
      sawDraftSaved = true;
    };
    document.addEventListener("jb:draft:saved", onDraftSaved);

    state.refineInFlight = true;
    state.refineCalls += 1;
    setRefineBusy(true);
    setStatus("refining…", "busy");

    let pending;
    try {
      pending = rg.refineLastResumeGeneration();
    } catch (err) {
      finishRefine(onDraftSaved);
      setStatus(`refine failed · ${errorMessage(err)}`, "err");
      announce("Refine failed.");
      return;
    }

    Promise.resolve(pending).then(
      () => {
        finishRefine(onDraftSaved);
        const after = getLegacyOutput();
        const nextText = after && typeof after.value === "string" ? after.value : "";
        if (sawDraftSaved || nextText !== before) {
          setEditorFromLegacy();
          setStatus("refined", "ok");
          announce("Refine finished and the draft was updated.");
        } else {
          // resume-generation.js resolves without doing anything when there
          // is no session, no bundle or no feedback. That is not a refine.
          setStatus("refine made no changes", "warn");
          announce("Refine finished without changing the draft.");
        }
      },
      (err) => {
        finishRefine(onDraftSaved);
        setStatus(`refine failed · ${errorMessage(err)}`, "err");
        announce("Refine failed.");
      },
    );
  }

  function finishRefine(onDraftSaved) {
    document.removeEventListener("jb:draft:saved", onDraftSaved);
    state.refineInFlight = false;
    setRefineBusy(false);
  }

  function wireActions(region) {
    const printBtn = region.querySelector("#scribePrintBtn");
    const copyBtn = region.querySelector("#scribeCopyBtn");
    const doneBtn = region.querySelector("#scribeDoneBtn");
    const refineBtn = region.querySelector("#scribeRefineBtn");
    const rescoreBtn = region.querySelector("#scribeRescoreBtn");
    const saveVersionBtn = region.querySelector("#scribeSaveVersionBtn");
    const refineInput = region.querySelector("#scribeRefineInput");

    if (printBtn) {
      printBtn.addEventListener("click", () => {
        flushEditor();
        if (!clickLegacy("resumeGeneratePrint")) window.print();
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        flushEditor();
        if (!clickLegacy("resumeGenerateCopy")) {
          // Fallback: copy plain text directly.
          const text = plainTextFromEditor(getEditor());
          if (text && navigator.clipboard) {
            void navigator.clipboard.writeText(text);
          }
        }
      });
    }
    if (doneBtn) {
      doneBtn.addEventListener("click", () => {
        flushEditor();
        clickLegacy("resumeGenerateDone") || clickLegacy("resumeGenerateClose");
      });
    }
    if (refineBtn) {
      refineBtn.addEventListener("click", () => runRefine(region));
    }
    if (rescoreBtn) {
      rescoreBtn.addEventListener("click", () => {
        flushEditor();
        const score = scribeScore();
        if (score && typeof score.requestRescore === "function") score.requestRescore();
      });
    }
    if (saveVersionBtn) {
      saveVersionBtn.addEventListener("click", () => {
        const st = scribeState();
        if (!st) return;
        const titleEl = region.querySelector("#scribeVersionTitle");
        const title = titleEl ? titleEl.value : "";
        if (titleEl) titleEl.value = "";
        syncEditorIntoLegacy();
        void st.saveVersion(plainTextFromEditor(getEditor()), title);
      });
    }

    region.querySelectorAll("[data-scribe-chip]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const text = chip.getAttribute("data-scribe-chip") || "";
        if (!refineInput) return;
        const cur = (refineInput.value || "").trim();
        refineInput.value = cur ? `${cur}; ${text}` : text;
        refineInput.focus();
      });
    });
  }

  function wireVersions(region) {
    region.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-scribe-version]");
      if (!btn) return;
      e.preventDefault();
      const st = scribeState();
      if (!st) return;
      void st.openVersion(btn.getAttribute("data-scribe-version")).then((opened) => {
        if (opened) setEditorFromLegacy();
      });
    });
  }

  function wireEditor(region) {
    const editor = region.querySelector("#scribeEditor");
    if (!editor) return;

    editor.addEventListener("input", () => {
      editor.dataset.empty = editor.textContent.trim() ? "false" : "true";
      state.lastEditAt = Date.now();
      setStatus("typing…", "busy");
      const st = scribeState();
      if (st) st.noteEditorChange(plainTextFromEditor(editor));
      if (state.debounceTimer) window.clearTimeout(state.debounceTimer);
      state.debounceTimer = window.setTimeout(() => {
        state.debounceTimer = null;
        syncEditorIntoLegacy();
        refreshScore();
        setStatus("synced", "ok");
      }, DEBOUNCE_MS);
    });
  }

  function wireAppearance(region) {
    const sel = region.querySelector("#scribeAppearance");
    const legacy = document.getElementById("resumeGenerateVisualTheme");
    if (!sel) return;
    function copyOptions() {
      sel.innerHTML = "";
      if (legacy) {
        for (const opt of legacy.options) {
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.textContent;
          sel.appendChild(o);
        }
        sel.value = legacy.value;
      } else {
        sel.innerHTML = '<option value="default">Default</option>';
      }
    }
    copyOptions();
    sel.addEventListener("change", () => {
      if (legacy) {
        legacy.value = sel.value;
        legacy.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  // ---------------------------------------------------------
  // Smoke routine — gated behind ?jb-v2-test=scribe
  // ---------------------------------------------------------
  function runSmoke() {
    const hook = installSmokeHook();
    hook.reset();
    const region = getRegion();
    if (!region) {
      console.log("[scribe smoke] FAIL — region missing");
      return;
    }
    const expected = [
      { btn: "#scribePrintBtn", legacy: "resumeGeneratePrint" },
      { btn: "#scribeCopyBtn", legacy: "resumeGenerateCopy" },
      { btn: "#scribeDoneBtn", legacy: "resumeGenerateDone" },
      // Refine no longer proxies a legacy click: it awaits the real
      // async refineLastResumeGeneration(), so the probe watches the
      // call itself rather than a button dispatch.
      { btn: "#scribeRefineBtn", legacy: "resumeGeneration.refineLastResumeGeneration" },
    ];
    const results = [];
    for (const e of expected) {
      const before = hook.calls.length;
      const refinesBefore = state.refineCalls;
      const el = region.querySelector(e.btn);
      if (!el) {
        results.push({ ...e, ok: false, reason: "button missing" });
        continue;
      }
      el.click();
      if (e.btn === "#scribeRefineBtn") {
        const fired = state.refineCalls > refinesBefore;
        results.push({ ...e, ok: fired, reason: fired ? "" : "refine API never called" });
        continue;
      }
      const after = hook.calls.slice(before);
      const fired = after.some((c) => c.id === e.legacy);
      results.push({ ...e, ok: fired, reason: fired ? "" : "legacy id never clicked" });
    }
    const failed = results.filter((r) => !r.ok);
    const banner = failed.length === 0 ? "PASS" : "FAIL";
    console.log(`[scribe smoke] ${banner}`);
    console.table(results);
    window.__JB_SCRIBE_SMOKE_RESULTS__ = results;
  }

  // ---------------------------------------------------------
  // Boot
  // ---------------------------------------------------------
  function boot() {
    if (!isV2()) {
      // The jb-v2 class lands AFTER this deferred script runs (the flag
      // script in index.html adds it from a DOMContentLoaded listener,
      // and settings-jb-v2-tab.js adds it later still). Sampling once
      // here left the workspace permanently empty — observe instead,
      // exactly like dawn.js observeBodyOnly().
      observeBodyForFlag();
      return;
    }
    const region = getRegion();
    if (!region) return;
    if (state.rendered) return;
    render(region);
    wireTabs(region);
    wireActions(region);
    wireEditor(region);
    wireVersions(region);
    wireAppearance(region);

    const st = scribeState();
    if (st) {
      st.refresh();
      state.unsubscribe = st.subscribe(renderStateViews);
    }
    renderStateViews();

    setEditorFromLegacy();

    const score = scribeScore();
    if (score && typeof score.mount === "function") {
      state.score = score.mount(region, { getText: () => plainTextFromEditor(getEditor()) });
    }

    // Re-pull body when legacy textarea changes elsewhere
    // (e.g. a fresh generation finished).
    const ta = getLegacyOutput();
    if (ta) {
      ta.addEventListener("input", () => {
        // Only mirror back if this update did NOT originate from us.
        const since = Date.now() - state.lastEditAt;
        if (since > DEBOUNCE_MS + 50) {
          setEditorFromLegacy();
        }
      });
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("jb-v2-test") === "scribe") {
      state.smoke = true;
      installSmokeHook();
      // Defer one tick so wiring is settled.
      window.setTimeout(runSmoke, 50);
    }
  }

  function observeBodyForFlag() {
    if (state.bodyObserver || !document.body || typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(() => {
      if (!isV2()) return;
      observer.disconnect();
      state.bodyObserver = null;
      boot();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    state.bodyObserver = observer;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Public smoke handle for manual invocation (also gated by URL).
  window.JB_SCRIBE = Object.freeze({
    smoke: runSmoke,
    // jb-v2-boot-contract.js's default "scribe" adapter calls exactly this
    // name and guards on it, so without the export the F2-A remount reports
    // a mount it never performed. boot() is already idempotent (it returns
    // early on state.rendered) and still gates on body.jb-v2, so handing it
    // out cannot double-render or mount behind the flag.
    boot: boot,
    flushEditor: flushEditor,
    syncEditorIntoLegacy: syncEditorIntoLegacy,
    setEditorFromLegacy: setEditorFromLegacy,
  });
})();
