/* ============================================================
   letter.js — JobBored v2 Letter editor + ATS scorecard
   ------------------------------------------------------------
   Owner:    Letter (Phase 2.D · flowing-page)
   Renders:  <section data-region="letter">
   Reads:    window.JobBoredDawn.data.getLetterViewModel(jobKey)
   Scores:   window.JobBoredAts.score / .analyze (deterministic)

   Behavior
     - Active only when document.body has class "jb-v2".
     - Job key is read from URL hash: #letter=<jobKey>.
     - On mount + on hashchange the section re-renders.
     - Editor is contenteditable; debounced re-score (1.2s) and
       debounced auto-save (5s) dispatch a `jb:letter:save` event
       on document. We never write to the Sheet ourselves.
     - Tools (Tighten / Add evidence / Honest cut / Trim) and the
       per-miss "Address" buttons log a TODO. Wire-up tomorrow.
   ============================================================ */

(function (root) {
  "use strict";

  var REGION_SELECTOR = '[data-region="letter"]';
  var DEBOUNCE_SCORE_MS = 1200;
  var DEBOUNCE_SAVE_MS = 5000;

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function shouldRun() {
    return !!(document.body && document.body.classList && document.body.classList.contains("jb-v2"));
  }

  function getRegion() {
    return document.querySelector(REGION_SELECTOR);
  }

  function readJobKeyFromHash() {
    var hash = String((root.location && root.location.hash) || "");
    if (!hash) return "";
    // Strip leading "#"
    var raw = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    var parts = raw.split("&");
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (kv[0] === "letter" && kv[1] != null) {
        try { return decodeURIComponent(kv[1]); } catch (e) { return kv[1]; }
      }
    }
    return "";
  }

  function readingLevelFlavor(grade) {
    var n = parseInt(String(grade || "").replace(/[^0-9]/g, ""), 10);
    if (!isFinite(n)) return "balanced";
    if (n <= 8) return "accessible";
    if (n <= 12) return "balanced";
    return "dense";
  }

  function nowHHMM() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? "pm" : "am";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + (m < 10 ? "0" : "") + m + ampm;
  }

  /* ---------- HTML builders ----------------------------------- */

  function noJobHtml() {
    return [
      '<div class="jb-letter-empty">',
      '  <p class="jb-letter-empty__eyebrow">LETTER</p>',
      '  <h1 class="jb-letter-empty__headline">Open a card from the pipeline to draft a letter.</h1>',
      '  <p class="jb-letter-empty__caption">Each role gets its own draft. Scores update as you type — keyword coverage, tone, length.</p>',
      '</div>',
    ].join("");
  }

  function scoreCardHtml(label, value, target) {
    var v = Math.max(0, Math.min(100, Number(value) || 0));
    return [
      '<article class="jb-letter-score" data-score-name="', escapeHtml(label), '">',
      '  <span class="jb-letter-score__label">', escapeHtml(label), '</span>',
      '  <span class="jb-letter-score__value jb-data" data-score-value>', v, '</span>',
      '  <div class="jb-letter-score__bar" role="presentation">',
      '    <span class="jb-letter-score__bar-fill" style="width:', v, '%"></span>',
      target ? '    <span class="jb-letter-score__bar-target" style="left:' + target.from + '%;width:' + (target.to - target.from) + '%"></span>' : '',
      '  </div>',
      '  <span class="jb-letter-score__sub">', escapeHtml(target ? ("target " + target.label) : "0–100"), '</span>',
      '</article>',
    ].join("");
  }

  function chipHtml(term) {
    return '<span class="jb-letter-chip" data-term="' + escapeHtml(term) + '">' + escapeHtml(term) + '</span>';
  }

  function missRowHtml(m) {
    return [
      '<li class="jb-letter-miss" data-term="', escapeHtml(m.term), '">',
      '  <span class="jb-letter-miss__term">', escapeHtml(m.term), '</span>',
      '  <span class="jb-letter-miss__weight" aria-label="JD weight">×', escapeHtml(String(m.weight || 1)), '</span>',
      '  <button type="button" class="jb-letter-miss__btn" data-action="address" data-term="', escapeHtml(m.term), '">Address</button>',
      '</li>',
    ].join("");
  }

  function toolButtonHtml(action, label, hint) {
    return [
      '<button type="button" class="jb-letter-tool" data-action="', action, '" title="', escapeHtml(hint), '">',
      '  <span class="jb-letter-tool__label">', escapeHtml(label), '</span>',
      '  <span class="jb-letter-tool__hint">', escapeHtml(hint), '</span>',
      '</button>',
    ].join("");
  }

  function lengthTargetCard(length) {
    var words = (length && length.words) || 0;
    var lo = (length && length.target && length.target[0]) || 200;
    var hi = (length && length.target && length.target[1]) || 320;
    var max = Math.max(hi * 1.4, words * 1.1, 1);
    var pos = Math.min(100, Math.max(0, (words / max) * 100));
    var fromPct = Math.min(100, (lo / max) * 100);
    var toPct = Math.min(100, (hi / max) * 100);
    return [
      '<article class="jb-letter-score" data-score-name="length">',
      '  <span class="jb-letter-score__label">Length</span>',
      '  <span class="jb-letter-score__value jb-data" data-score-value-words>', words, '</span>',
      '  <div class="jb-letter-score__bar jb-letter-score__bar--length" role="presentation">',
      '    <span class="jb-letter-score__bar-target" style="left:', fromPct, '%;width:', (toPct - fromPct), '%"></span>',
      '    <span class="jb-letter-score__bar-marker" style="left:', pos, '%"></span>',
      '  </div>',
      '  <span class="jb-letter-score__sub">target ', lo, '–', hi, ' words</span>',
      '</article>',
    ].join("");
  }

  function shellHtml(vm) {
    var job = vm.job || {};
    var ats = vm.ats || { score: 0, keywordCoverage: 0, toneMatch: 0, length: { words: 0, target: [200, 320] }, hits: [], misses: [], readingLevel: "Grade 0" };
    var role = job.role || "Untitled role";
    var company = job.company || "Unknown company";
    var jobKey = job.jobKey || "";

    return [
      '<header class="jb-letter-head">',
      '  <p class="jb-letter-eyebrow">LETTER · DRAFT</p>',
      '  <h1 class="jb-letter-headline">', escapeHtml(role), ' <span class="jb-letter-headline__co">at ', escapeHtml(company), '</span></h1>',
      '  <p class="jb-letter-meta">',
      '    <span class="jb-letter-meta__key">', escapeHtml(jobKey), '</span>',
      '    <span class="jb-letter-meta__sep">·</span>',
      '    <span class="jb-letter-save" data-save-state="idle">',
      '      <span class="jb-letter-save__dot" aria-hidden="true"></span>',
      '      <span class="jb-letter-save__text">Saved</span>',
      '    </span>',
      '  </p>',
      '</header>',

      '<div class="jb-letter-grid">',

      /* --- editor pane ---------------------------------------- */
      '  <section class="jb-letter-editor-pane" aria-label="Letter editor">',
      '    <div class="jb-letter-editor-frame">',
      '      <div class="jb-letter-editor"',
      '           contenteditable="true"',
      '           role="textbox"',
      '           aria-multiline="true"',
      '           aria-label="Cover letter draft"',
      '           spellcheck="true"',
      '           data-letter-editor></div>',
      '    </div>',
      '  </section>',

      /* --- scorecard pane ------------------------------------- */
      '  <aside class="jb-letter-scorecard" aria-label="ATS scorecard">',

      '    <div class="jb-letter-score-row">',
      scoreCardHtml("Keyword coverage", ats.keywordCoverage, { from: 60, to: 100, label: "60–100" }),
      scoreCardHtml("Tone match",      ats.toneMatch,        { from: 60, to: 100, label: "60–100" }),
      lengthTargetCard(ats.length),
      '    </div>',

      '    <section class="jb-letter-block jb-letter-block--hits">',
      '      <h2 class="jb-letter-block__title">Matched <span class="jb-letter-block__count" data-hit-count>', (ats.hits || []).length, '</span></h2>',
      '      <div class="jb-letter-chips" data-letter-hits>',
      (ats.hits || []).map(function (h) { return chipHtml(h.term); }).join("") || '<span class="jb-letter-chips__empty">No matches yet — add keywords from the JD.</span>',
      '      </div>',
      '    </section>',

      '    <section class="jb-letter-block jb-letter-block--misses">',
      '      <h2 class="jb-letter-block__title">Missing <span class="jb-letter-block__count" data-miss-count>', (ats.misses || []).length, '</span></h2>',
      '      <ul class="jb-letter-misses" data-letter-misses>',
      (ats.misses || []).map(missRowHtml).join("") || '<li class="jb-letter-misses__empty">All top JD terms are covered.</li>',
      '      </ul>',
      '    </section>',

      '    <section class="jb-letter-block jb-letter-block--reading">',
      '      <span class="jb-letter-pill" data-reading-level data-flavor="', readingLevelFlavor(ats.readingLevel), '">',
      '        <span class="jb-letter-pill__label" data-reading-grade>', escapeHtml(ats.readingLevel || "Grade 0"), '</span>',
      '        <span class="jb-letter-pill__sub" data-reading-flavor>', readingLevelFlavor(ats.readingLevel), '</span>',
      '      </span>',
      '    </section>',

      '    <section class="jb-letter-block jb-letter-block--tools">',
      '      <h2 class="jb-letter-block__title">One-click tools</h2>',
      '      <div class="jb-letter-tools">',
      toolButtonHtml("tighten",     "Tighten",      "Sharpen verbs, cut hedges."),
      toolButtonHtml("add-evidence","Add evidence", "Insert a numeric outcome."),
      toolButtonHtml("honest-cut",  "Honest cut",   "Drop overstatement, keep proof."),
      toolButtonHtml("trim",        "Trim",         "Reduce length toward 250 words."),
      '      </div>',
      '    </section>',

      '  </aside>',
      '</div>',
    ].join("");
  }

  /* ---------- editor + state ---------------------------------- */

  function setSaveState(region, state, atText) {
    var save = region.querySelector(".jb-letter-save");
    if (!save) return;
    save.setAttribute("data-save-state", state);
    var text = save.querySelector(".jb-letter-save__text");
    if (!text) return;
    if (state === "saving") text.textContent = "Saving…";
    else if (state === "saved") text.textContent = "Saved · " + (atText || nowHHMM());
    else if (state === "dirty") text.textContent = "Unsaved";
    else text.textContent = "Saved";
  }

  function readEditorText(editor) {
    if (!editor) return "";
    // Prefer innerText so contenteditable line-breaks are preserved as \n.
    var t = (typeof editor.innerText === "string") ? editor.innerText : editor.textContent;
    return String(t || "");
  }

  function updateScorecard(region, ats) {
    if (!region || !ats) return;

    /* score values */
    var nodes = region.querySelectorAll("[data-score-name]");
    nodes.forEach(function (card) {
      var name = card.getAttribute("data-score-name");
      var valEl = card.querySelector("[data-score-value]");
      var fillEl = card.querySelector(".jb-letter-score__bar-fill");
      if (name === "Keyword coverage") {
        if (valEl) valEl.textContent = String(ats.keywordCoverage);
        if (fillEl) fillEl.style.width = ats.keywordCoverage + "%";
      } else if (name === "Tone match") {
        if (valEl) valEl.textContent = String(ats.toneMatch);
        if (fillEl) fillEl.style.width = ats.toneMatch + "%";
      }
    });

    /* length card */
    var lenCard = region.querySelector('[data-score-name="length"]');
    if (lenCard && ats.length) {
      var w = ats.length.words || 0;
      var wEl = lenCard.querySelector("[data-score-value-words]");
      if (wEl) wEl.textContent = String(w);
      var lo = (ats.length.target && ats.length.target[0]) || 200;
      var hi = (ats.length.target && ats.length.target[1]) || 320;
      var max = Math.max(hi * 1.4, w * 1.1, 1);
      var pos = Math.min(100, Math.max(0, (w / max) * 100));
      var fromPct = Math.min(100, (lo / max) * 100);
      var toPct = Math.min(100, (hi / max) * 100);
      var marker = lenCard.querySelector(".jb-letter-score__bar-marker");
      var target = lenCard.querySelector(".jb-letter-score__bar-target");
      if (marker) marker.style.left = pos + "%";
      if (target) {
        target.style.left = fromPct + "%";
        target.style.width = (toPct - fromPct) + "%";
      }
    }

    /* hits */
    var hitsHost = region.querySelector("[data-letter-hits]");
    var hitCount = region.querySelector("[data-hit-count]");
    var hits = ats.hits || [];
    if (hitCount) hitCount.textContent = String(hits.length);
    if (hitsHost) {
      hitsHost.innerHTML = hits.length
        ? hits.map(function (h) { return chipHtml(h.term); }).join("")
        : '<span class="jb-letter-chips__empty">No matches yet — add keywords from the JD.</span>';
    }

    /* misses */
    var missHost = region.querySelector("[data-letter-misses]");
    var missCount = region.querySelector("[data-miss-count]");
    var misses = ats.misses || [];
    if (missCount) missCount.textContent = String(misses.length);
    if (missHost) {
      missHost.innerHTML = misses.length
        ? misses.map(missRowHtml).join("")
        : '<li class="jb-letter-misses__empty">All top JD terms are covered.</li>';
    }

    /* reading level */
    var pill = region.querySelector("[data-reading-level]");
    var grade = region.querySelector("[data-reading-grade]");
    var flavor = region.querySelector("[data-reading-flavor]");
    if (pill) pill.setAttribute("data-flavor", readingLevelFlavor(ats.readingLevel));
    if (grade) grade.textContent = ats.readingLevel || "Grade 0";
    if (flavor) flavor.textContent = readingLevelFlavor(ats.readingLevel);
  }

  function bindEditorEvents(region, ctx) {
    var editor = region.querySelector("[data-letter-editor]");
    if (!editor) return;

    function reschedule() {
      setSaveState(region, "dirty");
      // re-score (1.2s)
      if (ctx.scoreTimer) clearTimeout(ctx.scoreTimer);
      ctx.scoreTimer = setTimeout(function () {
        try {
          var ats = root.JobBoredAts && root.JobBoredAts.analyze
            ? root.JobBoredAts.analyze({ jd: ctx.jdSnippet, draft: readEditorText(editor) })
            : null;
          if (ats) updateScorecard(region, ats);
        } catch (e) { /* never throw to user */ }
      }, DEBOUNCE_SCORE_MS);

      // auto-save (5s)
      if (ctx.saveTimer) clearTimeout(ctx.saveTimer);
      ctx.saveTimer = setTimeout(function () {
        var draft = readEditorText(editor);
        try {
          setSaveState(region, "saving");
          document.dispatchEvent(new CustomEvent("jb:letter:save", {
            detail: { jobKey: ctx.jobKey, draft: draft },
          }));
          // Optimistic confirm — we don't own the write, so we mark
          // "saved" once the event has been dispatched.
          setSaveState(region, "saved", nowHHMM());
        } catch (e) {
          setSaveState(region, "dirty");
        }
      }, DEBOUNCE_SAVE_MS);
    }

    editor.addEventListener("input", reschedule);
    editor.addEventListener("keyup", function (e) {
      // Surface the dirty state immediately on first keystroke.
      if (region.querySelector(".jb-letter-save").getAttribute("data-save-state") === "saved") {
        setSaveState(region, "dirty");
      }
    });

    /* tools / address — log a TODO until LLM wiring lands. */
    region.addEventListener("click", function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      if (!action) return;
      if (action === "address") {
        var term = btn.getAttribute("data-term");
        // eslint-disable-next-line no-console
        console.log("[letter] TODO address term", { jobKey: ctx.jobKey, term: term });
        return;
      }
      if (action === "tighten" || action === "add-evidence" || action === "honest-cut" || action === "trim") {
        // eslint-disable-next-line no-console
        console.log("[letter] TODO tool", { jobKey: ctx.jobKey, action: action });
      }
    });
  }

  /* ---------- render ------------------------------------------ */

  function clearTimers(ctx) {
    if (!ctx) return;
    if (ctx.scoreTimer) { clearTimeout(ctx.scoreTimer); ctx.scoreTimer = null; }
    if (ctx.saveTimer)  { clearTimeout(ctx.saveTimer);  ctx.saveTimer = null; }
  }

  function render() {
    if (!shouldRun()) return;
    var region = getRegion();
    if (!region) return;

    var jobKey = readJobKeyFromHash();

    if (!jobKey) {
      clearTimers(region.__letterCtx);
      region.__letterCtx = null;
      var emptyHtml = noJobHtml();
      if (region.__letterHtml !== emptyHtml) {
        region.innerHTML = emptyHtml;
        region.__letterHtml = emptyHtml;
      }
      return;
    }

    var dataApi = root.JobBoredDawn && root.JobBoredDawn.data;
    if (!dataApi || typeof dataApi.getLetterViewModel !== "function") {
      // Data layer missing — render empty state but flag it in console.
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[letter] JobBoredDawn.data.getLetterViewModel not available");
      }
      region.innerHTML = noJobHtml();
      region.__letterHtml = "";
      return;
    }

    var vm;
    try {
      vm = dataApi.getLetterViewModel(jobKey);
    } catch (e) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[letter] view-model error", e);
      }
      vm = null;
    }
    if (!vm || !vm.job) {
      region.innerHTML = noJobHtml();
      region.__letterHtml = "";
      return;
    }

    /* Re-render shell only if jobKey changed. */
    if (region.__letterCtx && region.__letterCtx.jobKey === jobKey) {
      // Still update scorecard from latest VM (e.g. JD changed elsewhere).
      updateScorecard(region, vm.ats || {});
      return;
    }

    clearTimers(region.__letterCtx);

    region.innerHTML = shellHtml(vm);
    region.__letterHtml = "letter:" + jobKey;

    var editor = region.querySelector("[data-letter-editor]");
    if (editor) {
      // contenteditable accepts text; preserve line-breaks via <br>.
      var draft = String(vm.draft || "");
      // Use textContent for safety, then replace newlines with <br> for rendering.
      editor.textContent = draft;
      // If draft uses newlines, convert to <br> so the visual matches a paragraph block.
      if (draft.indexOf("\n") !== -1) {
        editor.innerHTML = draft
          .split(/\n{2,}/)
          .map(function (para) {
            return "<p>" + escapeHtml(para).replace(/\n/g, "<br>") + "</p>";
          })
          .join("");
      }
    }

    var ctx = {
      jobKey: jobKey,
      jdSnippet: (vm.job && vm.job.jdSnippet) || "",
      scoreTimer: null,
      saveTimer: null,
    };
    region.__letterCtx = ctx;
    bindEditorEvents(region, ctx);
    setSaveState(region, "saved", nowHHMM());
  }

  /* ---------- observers --------------------------------------- */

  function bindHashListener() {
    if (root.__jbLetterHashBound) return;
    root.__jbLetterHashBound = true;
    root.addEventListener("hashchange", function () { render(); });
  }

  function observeBodyClass() {
    if (!document.body) return;
    var mo = new MutationObserver(function () { render(); });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  function init() {
    root.JobBoredLetter = root.JobBoredLetter || {};
    root.JobBoredLetter.render = render;

    bindHashListener();
    observeBodyClass();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
