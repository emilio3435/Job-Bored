/* ============================================================
   scribe.js — JobBored v2 ATS + Cover Letter Workspace (Phase 3)
   ------------------------------------------------------------
   Owner:      Scribe
   Activates:  document.body.classList.contains('jb-v2')
   Region:     <section data-region="scribe">
   Behavior:
     - Renders a split-pane workspace (editor | scorecard) with a
       docked refine strip and tabs (Cover letter / Resume).
     - Reuses every legacy modal action by triggering `click` on
       the existing legacy DOM ids:
         #resumeGenerateRefine   (Refine button)
         #resumeGeneratePrint    (Print/PDF)
         #resumeGenerateCopy     (Copy text)
         #resumeGenerateDone     (Done)
         #resumeGenerateClose    (Close)
       The textarea #resumeGenerateOutput remains the source of
       truth for body text (Refine, Copy, ATS rescore all read it).
     - Edits in the editor are debounced (~600ms idle) and synced
       back into #resumeGenerateOutput so the existing
       scheduleResumeGenerateAtsRefresh() pipeline picks them up.
     - Smoke routine gated behind ?jb-v2-test=scribe instruments
       the dispatch path and asserts each mapped legacy click
       fired. Output to console as a single PASS/FAIL block.

   No new modal is introduced. No legacy data-action attribute
   names are renamed.
   ============================================================ */

(function () {
  "use strict";

  const REGION_SELECTOR = '[data-region="scribe"]';
  const DEBOUNCE_MS = 600;
  const STAGE_TIERS = [
    { min: 75, tier: "high" },
    { min: 50, tier: "mid" },
    { min: 0, tier: "low" },
  ];

  // 6-axis scorecard. Order matches the §SCORECARD CONTENT spec.
  const AXES = [
    { key: "req",     label: "Req",          help: "Required keywords coverage" },
    { key: "exp",     label: "Experience",   help: "Years / level fit" },
    { key: "impact",  label: "Impact",       help: "Outcome-driven phrasing" },
    { key: "parse",   label: "Parseability", help: "ATS-safe structure" },
    { key: "tone",    label: "Tone",         help: "Voice match" },
    { key: "conf",    label: "Confidence",   help: "Concrete claims" },
  ];

  /** @type {{rendered:boolean, smoke:boolean, debounceTimer:any, lastEditAt:number, refining:boolean, refineBaselineText:string}} */
  const state = {
    rendered: false,
    smoke: false,
    debounceTimer: null,
    lastEditAt: 0,
    refining: false,
    refineBaselineText: "",
  };

  function isV2() {
    return !!(document.body && document.body.classList.contains("jb-v2"));
  }

  function getRegion() {
    return document.querySelector(REGION_SELECTOR);
  }

  function tierFor(pct) {
    for (const t of STAGE_TIERS) if (pct >= t.min) return t.tier;
    return "low";
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
            <span class="scribe-topbar__role-target" data-scribe-target>Senior role · Company</span>
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
          </section>

          <aside class="scribe-pane scribe-pane--scorecard" aria-label="ATS match scorecard">
            <article class="jb-sticker scribe-scorecard" id="scribeScorecard">
              <span class="jb-stamp scribe-scorecard__stamp" aria-hidden="true">DRAFT</span>
              <div class="scribe-scorecard__head">
                <jb-fit-ring size="lg" percent="0" id="scribeFitRing" label="Overall match"></jb-fit-ring>
                <div class="scribe-scorecard__heading">
                  <span class="scribe-scorecard__kicker">ATS match</span>
                  <h3 class="scribe-scorecard__title">Per-axis scorecard</h3>
                </div>
              </div>
              <div class="scribe-axes" id="scribeAxes" role="list"></div>
              <footer class="scribe-scorecard__foot">
                <span data-scribe-model>model demo-scorecard-v1 · 0.0s</span>
                <a href="#" data-scribe-audit
                   aria-label="Open audit log for the most recent scorecard run">audit log</a>
              </footer>
            </article>

            <article class="jb-sticker scribe-gaps" aria-labelledby="scribeGapsTitle">
              <h4 class="scribe-gaps__title" id="scribeGapsTitle">Gap callouts</h4>
              <ul class="scribe-gaps__list" id="scribeGaps" role="list"></ul>
            </article>

            <article class="jb-sticker scribe-talking" aria-labelledby="scribeTalkingTitle">
              <h4 class="scribe-talking__title" id="scribeTalkingTitle">Talking points</h4>
              <ul class="scribe-talking__list" id="scribeTalking" role="list"></ul>
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

  function finishRefineSuccess() {
    if (!state.refining) return;
    state.refining = false;
    state.refineBaselineText = "";
    setEditorFromLegacy();
    scoreFromCurrent();
    setStatus("refined", "ok");
  }

  function finishRefineFailure(message) {
    if (!state.refining) return;
    state.refining = false;
    state.refineBaselineText = "";
    setStatus(message || "refine failed", "busy");
  }

  function handleLegacyOutputInput() {
    const ta = getLegacyOutput();
    if (state.refining && ta && ta.value !== state.refineBaselineText) {
      finishRefineSuccess();
      return;
    }
    const since = Date.now() - state.lastEditAt;
    if (since > DEBOUNCE_MS + 50) {
      setEditorFromLegacy();
      scoreFromCurrent();
    }
  }

  // ---------------------------------------------------------
  // Scorecard rendering
  // ---------------------------------------------------------
  function deriveAxisScores(text) {
    // Lightweight heuristic — kept here only as a *fallback* render
    // until the legacy ATS pipeline emits a fresh result. The legacy
    // pipeline owns the real numbers.
    const len = (text || "").length;
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const hasNumbers = /\d/.test(text || "");
    const hasYouVoice = /\byou\b/i.test(text || "");
    const sentenceCount = (text || "").split(/[.!?]+/).filter((s) => s.trim().length).length;
    const seed = Math.min(95, Math.max(5, Math.round(40 + Math.log(1 + wordCount) * 10)));

    return {
      req: Math.min(100, Math.round(seed * 0.95)),
      exp: Math.min(100, Math.round(seed * (hasNumbers ? 1.05 : 0.85))),
      impact: Math.min(100, Math.round(seed * (hasNumbers ? 1.1 : 0.7))),
      parse: Math.min(100, Math.round(70 + Math.min(20, Math.floor(len / 200)))),
      tone: Math.min(100, Math.round(seed * (hasYouVoice ? 1.0 : 0.9))),
      conf: Math.min(100, Math.round(seed * (sentenceCount > 4 ? 1.0 : 0.8))),
    };
  }

  function renderScorecard(scores, meta) {
    const region = getRegion();
    if (!region) return;
    const fit = region.querySelector("#scribeFitRing");
    const axesEl = region.querySelector("#scribeAxes");
    const modelEl = region.querySelector("[data-scribe-model]");
    if (!fit || !axesEl) return;

    const overall = Math.round(
      AXES.reduce((sum, a) => sum + (Number(scores[a.key]) || 0), 0) / AXES.length,
    );
    fit.setAttribute("percent", String(overall));
    fit.setAttribute("label", `Overall ATS match ${overall}%`);

    axesEl.innerHTML = AXES.map((axis) => {
      const pct = Math.max(0, Math.min(100, Number(scores[axis.key]) || 0));
      const tier = tierFor(pct);
      // Build a 7-point spark trail from the value to give visual texture.
      const spark = [
        Math.max(0, pct - 22),
        Math.max(0, pct - 10),
        Math.max(0, pct - 14),
        pct,
        Math.max(0, pct - 4),
        pct,
        pct,
      ].join(",");
      return `
        <div class="scribe-axis" data-tier="${tier}" role="listitem"
             aria-label="${axis.label} ${pct}%" title="${axis.help}">
          <span class="scribe-axis__label">${axis.label}</span>
          <span class="scribe-axis__bar" aria-hidden="true">
            <span class="scribe-axis__fill" style="--scribe-axis-pct:${pct}%"></span>
            <jb-spark
              data="${spark}"
              width="80"
              height="6"
              color="${tier === "high" ? "mint" : tier === "mid" ? "amber" : "navy"}"
              fill="false"
              style="display:none"
            ></jb-spark>
          </span>
          <span class="scribe-axis__value jb-data">${pct}%</span>
        </div>
      `;
    }).join("");

    if (modelEl && meta) {
      modelEl.textContent = `model ${meta.model || "demo-scorecard-v1"} · ${meta.timing || "—"}`;
    }
  }

  function renderGaps(gaps) {
    const region = getRegion();
    if (!region) return;
    const list = region.querySelector("#scribeGaps");
    if (!list) return;
    const items = (gaps || []).slice(0, 3);
    if (!items.length) {
      list.innerHTML =
        '<li><button type="button" class="scribe-gap" disabled aria-disabled="true"><span class="scribe-gap__axis">—</span><span>No gap callouts yet. Generate a draft to see ATS feedback.</span></button></li>';
      return;
    }
    list.innerHTML = items
      .map(
        (g, i) => `
        <li>
          <button type="button" class="scribe-gap"
                  data-scribe-anchor-target="p-${g.anchor || i}"
                  data-scribe-axis="${g.axis || ""}">
            <span class="scribe-gap__axis">${(g.axis || "gap").toUpperCase()}</span>
            <span>${(g.text || "").replace(/</g, "&lt;")}</span>
          </button>
        </li>
      `,
      )
      .join("");
  }

  function renderTalking(points) {
    const region = getRegion();
    if (!region) return;
    const list = region.querySelector("#scribeTalking");
    if (!list) return;
    const items = (points || []).slice(0, 4);
    if (!items.length) {
      list.innerHTML =
        '<li class="scribe-talking__item"><span class="scribe-talking__bullet">·</span><span>Talking points will appear once a draft is scored.</span></li>';
      return;
    }
    list.innerHTML = items
      .map(
        (p) => `
        <li class="scribe-talking__item">
          <span class="scribe-talking__bullet" aria-hidden="true">›</span>
          <span>${String(p).replace(/</g, "&lt;")}</span>
        </li>
      `,
      )
      .join("");
  }

  function defaultGaps(scores) {
    const ranked = AXES.slice()
      .map((a) => ({ ...a, pct: scores[a.key] }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 3);
    return ranked.map((a, i) => ({
      axis: a.label,
      text: `${a.label} reads ${a.pct}%. Add a concrete example or rephrase the matching paragraph.`,
      anchor: i,
    }));
  }

  function defaultTalking() {
    return [
      "Lead with one outcome metric in the opener.",
      "Mirror the role's required keywords in the second paragraph.",
      "Close with availability + a single clear ask.",
    ];
  }

  // ---------------------------------------------------------
  // Anchor flash
  // ---------------------------------------------------------
  function flashAnchor(anchorId) {
    const editor = getEditor();
    if (!editor) return;
    const target =
      editor.querySelector(`[data-scribe-anchor="${anchorId}"]`) ||
      editor.querySelector(`#${anchorId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("jb-mark", "scribe-anchor-flash");
    window.setTimeout(() => {
      target.classList.remove("scribe-anchor-flash");
      window.setTimeout(() => target.classList.remove("jb-mark"), 320);
    }, 900);
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
        const feature = btn.getAttribute("data-feature");
        region.querySelectorAll("[data-scribe-tab]").forEach((b) => {
          const isActive = b === btn;
          b.setAttribute("aria-selected", String(isActive));
        });
        const kicker = region.querySelector("[data-scribe-kicker]");
        if (kicker) {
          kicker.textContent =
            feature === "resume_update" ? "Resume draft" : "Cover letter draft";
        }
        // Reuse legacy draft-tab dispatch so app.js's existing
        // [data-action="draft-tab"] listeners flip the active panel.
        const legacyTab = document.querySelector(
          `[data-action="draft-tab"][data-feature="${feature}"]`,
        );
        if (legacyTab && typeof legacyTab.click === "function") {
          legacyTab.click();
        }
      });
    });
  }

  function wireActions(region) {
    const printBtn = region.querySelector("#scribePrintBtn");
    const copyBtn = region.querySelector("#scribeCopyBtn");
    const doneBtn = region.querySelector("#scribeDoneBtn");
    const refineBtn = region.querySelector("#scribeRefineBtn");
    const refineInput = region.querySelector("#scribeRefineInput");

    if (printBtn) {
      printBtn.addEventListener("click", () => {
        if (!clickLegacy("resumeGeneratePrint")) window.print();
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        // Make sure latest editor text is in the legacy textarea first.
        syncEditorIntoLegacy();
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
        clickLegacy("resumeGenerateDone") || clickLegacy("resumeGenerateClose");
      });
    }
    if (refineBtn) {
      refineBtn.addEventListener("click", () => {
        // Pipe the strip's instructions into the legacy feedback textarea
        // so refineLastResumeGeneration() sees them, then click legacy.
        syncEditorIntoLegacy();
        const fb = document.getElementById("resumeGenerateFeedback");
        if (fb && refineInput) {
          fb.value = refineInput.value;
          fb.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const legacyTa = getLegacyOutput();
        state.refining = true;
        state.refineBaselineText =
          legacyTa && typeof legacyTa.value === "string" ? legacyTa.value : "";
        setStatus("refining…", "busy");
        if (clickLegacy("resumeGenerateRefine")) {
          // Refinement is async (LLM). The legacy pipeline writes back to
          // #resumeGenerateOutput and dispatches input when complete.
        } else {
          state.refining = false;
          state.refineBaselineText = "";
          setStatus("refine handler missing", "busy");
        }
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

  function wireEditor(region) {
    const editor = region.querySelector("#scribeEditor");
    if (!editor) return;

    editor.addEventListener("input", () => {
      editor.dataset.empty = editor.textContent.trim() ? "false" : "true";
      state.lastEditAt = Date.now();
      setStatus("typing…", "busy");
      if (state.debounceTimer) window.clearTimeout(state.debounceTimer);
      state.debounceTimer = window.setTimeout(() => {
        syncEditorIntoLegacy();
        scoreFromCurrent();
        setStatus("scored", "ok");
      }, DEBOUNCE_MS);
    });

    // Gap-callout anchor jumps
    region.addEventListener("click", (e) => {
      const t = e.target.closest("[data-scribe-anchor-target]");
      if (!t) return;
      e.preventDefault();
      flashAnchor(t.getAttribute("data-scribe-anchor-target"));
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
  // Score from current editor text (fallback render only;
  // the legacy ATS pipeline still owns real scoring).
  // ---------------------------------------------------------
  function scoreFromCurrent() {
    const text = plainTextFromEditor(getEditor());
    const start = performance.now();
    const scores = deriveAxisScores(text);
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    renderScorecard(scores, {
      model: "demo-scorecard-v1",
      timing: `${elapsed}s`,
    });
    renderGaps(defaultGaps(scores));
    renderTalking(defaultTalking());
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
      { btn: "#scribeRefineBtn", legacy: "resumeGenerateRefine" },
    ];
    const results = [];
    for (const e of expected) {
      const before = hook.calls.length;
      const el = region.querySelector(e.btn);
      if (!el) {
        results.push({ ...e, ok: false, reason: "button missing" });
        continue;
      }
      el.click();
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
    if (!isV2()) return; // gated: legacy UI runs unchanged
    const region = getRegion();
    if (!region) return;
    if (state.rendered) return;
    render(region);
    wireTabs(region);
    wireActions(region);
    wireEditor(region);
    wireAppearance(region);
    setEditorFromLegacy();
    scoreFromCurrent();

    // Re-pull body when legacy textarea changes elsewhere
    // (e.g. a fresh generation finished).
    const ta = getLegacyOutput();
    if (ta) {
      ta.addEventListener("input", handleLegacyOutputInput);
    }
    document.addEventListener("jb:resume-refine:finished", (e) => {
      if (!state.refining) return;
      const ok = !(e && e.detail && e.detail.ok === false);
      if (ok) finishRefineSuccess();
      else {
        const msg =
          e && e.detail && e.detail.message
            ? String(e.detail.message)
            : "refine failed";
        finishRefineFailure(msg);
      }
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get("jb-v2-test") === "scribe") {
      state.smoke = true;
      installSmokeHook();
      // Defer one tick so wiring is settled.
      window.setTimeout(runSmoke, 50);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Public smoke handle for manual invocation (also gated by URL).
  window.JB_SCRIBE = Object.freeze({
    smoke: runSmoke,
    rescore: scoreFromCurrent,
    syncEditorIntoLegacy: syncEditorIntoLegacy,
    setEditorFromLegacy: setEditorFromLegacy,
  });
})();
