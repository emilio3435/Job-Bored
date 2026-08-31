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

  /** @type {{rendered:boolean, smoke:boolean, debounceTimer:any, lastEditAt:number, session:any, refineBound:boolean}} */
  const state = {
    rendered: false,
    smoke: false,
    debounceTimer: null,
    lastEditAt: 0,
    session: null,
    refineBound: false,
  };

  function getSession() {
    if (state.session) return state.session;
    const factory = window.JobBoredScribeSession;
    if (!factory || typeof factory.create !== "function") return null;
    state.session = factory.create();
    return state.session;
  }

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
            <span class="scribe-topbar__role-target" data-scribe-target>No role selected</span>
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
                <span data-scribe-model>model no document to score · —</span>
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
    const session = getSession();
    if (session) {
      const snap = session.snapshot();
      const current = snap.document || {};
      session.setDocument({
        feature: current.feature || "cover_letter",
        versionNumber: current.versionNumber,
        draftId: current.draftId,
        text,
      });
    }
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

  // ---------------------------------------------------------
  // Scorecard rendering
  // ---------------------------------------------------------
  function renderScorecard(scores, meta) {
    const region = getRegion();
    if (!region) return;
    const fit = region.querySelector("#scribeFitRing");
    const axesEl = region.querySelector("#scribeAxes");
    const modelEl = region.querySelector("[data-scribe-model]");
    if (!fit || !axesEl) return;

    const overallFromMeta = meta && Number.isFinite(Number(meta.overall));
    const overall = overallFromMeta
      ? Math.max(0, Math.min(100, Math.round(Number(meta.overall))))
      : Math.round(
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
      modelEl.textContent = `model ${meta.model || "unscored"} · ${meta.timing || "—"}`;
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
        flushForExport();
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
        flushForExport();
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
        const session = getSession();
        if (session) {
          session.noteUnsavedText(plainTextFromEditor(getEditor()));
          session.beginRefine({ feedback: refineInput ? refineInput.value : "" });
        }
        setStatus("refining…", "busy");
        if (!clickLegacy("resumeGenerateRefine")) {
          if (session) session.completeRefine({ ok: false, error: "refine handler missing" });
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
        const session = getSession();
        if (session) session.noteUnsavedText(plainTextFromEditor(editor));
        paintFromSession();
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
  // Score from session: real ATS evidence, or a labeled empty /
  // unavailable state. Never paint an unlabeled demo heuristic.
  // ---------------------------------------------------------
  function paintFromSession() {
    const session = getSession();
    const visible = session
      ? session.visibleScorecard()
      : {
          overall: 0,
          axes: { req: 0, exp: 0, impact: 0, parse: 0, tone: 0, conf: 0 },
          model: "ATS evidence unavailable",
          source: "unavailable",
          gaps: [],
          talking: [],
        };
    renderScorecard(visible.axes, {
      overall: visible.overall,
      model: visible.model,
      timing: visible.source === "ats" ? "evidence" : "—",
    });
    renderGaps(visible.gaps);
    renderTalking(visible.talking);
  }

  function applyRoleLabel() {
    const region = getRegion();
    if (!region) return;
    const el = region.querySelector("[data-scribe-target]");
    if (!el) return;
    const session = getSession();
    el.textContent = session ? session.roleLabel() : "No role selected";
  }

  function flushForExport() {
    syncEditorIntoLegacy();
    const session = getSession();
    if (!session) return;
    session.noteUnsavedText(plainTextFromEditor(getEditor()));
    const persist = getPersistFn();
    void session.flush(persist ? { persist } : {});
  }

  function getPersistFn() {
    const UC = window.CommandCenterUserContent;
    const session = getSession();
    if (!session || !UC || typeof UC.saveGeneratedDraft !== "function") return null;
    return async (payload) => {
      const saved = await UC.saveGeneratedDraft({
        feature: payload.feature || "cover_letter",
        mode: "edit",
        text: payload.text,
        job: session.snapshot().role,
        parentDraftId: payload.parentDraftId,
      });
      if (!saved) return {};
      return { draftId: saved.id, versionNumber: saved.versionNumber };
    };
  }

  function onDraftSaved(evt) {
    const detail = (evt && evt.detail) || {};
    const session = getSession();
    if (!session) return;
    const snap = session.snapshot();
    if (snap.refine.status !== "refining") return;
    if (detail.mode && detail.mode !== "refine") return;
    setEditorFromLegacy();
    session.completeRefine({
      ok: true,
      text: plainTextFromEditor(getEditor()),
      draftId: detail.draftId,
      versionNumber: detail.versionNumber,
    });
    paintFromSession();
    setStatus("refined", "ok");
  }

  function onRefineFailed(evt) {
    const detail = (evt && evt.detail) || {};
    const session = getSession();
    if (!session) return;
    if (session.snapshot().refine.status !== "refining") return;
    const error = String(detail.error || "refine failed");
    session.completeRefine({ ok: false, error });
    setStatus(error, "error");
  }

  function onAtsState(evt) {
    const detail = (evt && evt.detail) || {};
    const session = getSession();
    if (!session) return;
    session.bindAtsEvidence({
      jobKey: detail.jobKey,
      status: detail.status,
      result: detail.result,
      error: detail.error,
    });
    paintFromSession();
  }

  function onRoleOpened(evt) {
    const detail = (evt && evt.detail) || {};
    const session = getSession();
    if (!session) return;
    let title = "";
    let company = "";
    try {
      const recents = window.JobBoredFlowing && window.JobBoredFlowing.recents;
      const list = recents && typeof recents.list === "function" ? recents.list() : [];
      const hit = (list || []).find((row) => row && row.jobKey === detail.jobKey);
      if (hit) {
        title = hit.role || hit.title || "";
        company = hit.company || "";
      }
    } catch (_e) {
      /* recents are optional */
    }
    session.bindRole({
      jobKey: detail.jobKey,
      title,
      company,
    });
    applyRoleLabel();
    paintFromSession();
  }

  function onRoleClosed() {
    const session = getSession();
    if (session) session.clearRole();
    applyRoleLabel();
    paintFromSession();
  }

  function bindSessionEvents() {
    if (state.refineBound) return;
    state.refineBound = true;
    window.addEventListener("jb:draft:saved", onDraftSaved);
    document.addEventListener("jb:draft:saved", onDraftSaved);
    window.addEventListener("jb:draft:refine:failed", onRefineFailed);
    document.addEventListener("jb:draft:refine:failed", onRefineFailed);
    window.addEventListener("jb:ats:state", onAtsState);
    document.addEventListener("jb:ats:state", onAtsState);
    window.addEventListener("jb:role:opened", onRoleOpened);
    document.addEventListener("jb:role:opened", onRoleOpened);
    window.addEventListener("jb:role:closed", onRoleClosed);
    document.addEventListener("jb:role:closed", onRoleClosed);
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
    bindSessionEvents();
    setEditorFromLegacy();
    applyRoleLabel();
    paintFromSession();

    // Re-pull body when legacy textarea changes elsewhere
    // (e.g. a fresh generation finished).
    const ta = getLegacyOutput();
    if (ta) {
      ta.addEventListener("input", () => {
        // Only mirror back if this update did NOT originate from us.
        const since = Date.now() - state.lastEditAt;
        if (since > DEBOUNCE_MS + 50) {
          setEditorFromLegacy();
          paintFromSession();
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Public smoke handle for manual invocation (also gated by URL).
  window.JB_SCRIBE = Object.freeze({
    smoke: runSmoke,
    rescore: paintFromSession,
    syncEditorIntoLegacy: syncEditorIntoLegacy,
    setEditorFromLegacy: setEditorFromLegacy,
    getSelectedRole: function () {
      const session = getSession();
      return session ? session.snapshot().role : null;
    },
    getDocument: function () {
      const session = getSession();
      return session ? session.snapshot().document : null;
    },
    bindRole: function (input) {
      const session = getSession();
      if (!session) return null;
      const role = session.bindRole(input);
      applyRoleLabel();
      paintFromSession();
      return role;
    },
    bindDocument: function (input) {
      const session = getSession();
      if (!session) return null;
      const doc = session.setDocument(input);
      if (input && input.text != null) {
        const ta = getLegacyOutput();
        if (ta) ta.value = String(input.text);
        setEditorFromLegacy();
      }
      applyRoleLabel();
      paintFromSession();
      return doc;
    },
    bindAtsEvidence: function (input) {
      const session = getSession();
      if (!session) return null;
      const ats = session.bindAtsEvidence(input);
      paintFromSession();
      return ats;
    },
  });
})();
