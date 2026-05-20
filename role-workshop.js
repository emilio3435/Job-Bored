/* ============================================================
   role-workshop.js — JobBored v2 PART 03 (The Dossier)
   ------------------------------------------------------------
   Owner:    dossier-df/workshop lane (run dossier-df-20260519T2030Z)
   Renders:  The Workshop card — the editable / actionable half
             of the dossier. Mounts inside [data-mount="workshop"]
             which sits inside the role region rendered by
             role.js.
   Visual:   docs/redesign/dossier-direction-f-wireframe.html

   Public surface
     window.JobBoredDossierWorkshop = { renderWorkshop(mount, vm) }

   Events emitted
     jb:role:writeback     { jobKey, field, value }
       field ∈ { "stage" | "heardBack" | "reply"
                 | "followupAt" | "passed" }
     jb:role:action        { action, jobKey }
       action ∈ { "resume-tailor" | "resume-cover" }
       (preserved contract — also handled by role.js wireDossier)
     jb:ats:modal:open     { jobKey }
     jb:ats:state:request  { jobKey }

   Events listened for
     jb:ats:state          { jobKey, status, result?, error? }
     jb:role:opened        { jobKey }

   Activation: body.jb-v2 only (the role.js shell gates it).
   ============================================================ */

(function (root) {
  "use strict";

  if (!root) return;

  var STAGE_LABELS = {
    "researching":  "Researching",
    "applied":      "Applied",
    "phone-screen": "Phone screen",
    "interviewing": "Interviewing",
    "offer":        "Offer",
  };
  var STAGE_ORDER = ["researching", "applied", "phone-screen", "interviewing", "offer"];

  var LETTER_REGION_SELECTOR = '[data-region="letter"]';
  var ATS_CONTAINER_ATTR = "data-ats-container";

  /* Module state — kept across re-renders so the global
     `jb:ats:state` listener can route to the most recent mount. */
  var ctx = null; // { mount, jobKey }

  /* -------------------- helpers -------------------- */

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeHref(href) {
    var s = String(href || "").trim();
    if (!s) return "";
    if (/^https?:|^mailto:/i.test(s)) return s;
    return "";
  }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function isoFromDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function todayIso() {
    return isoFromDate(new Date());
  }

  function plusDaysIso(daysOffset) {
    var d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return isoFromDate(d);
  }

  function formatDate(iso) {
    if (!iso) return "";
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    return isoFromDate(new Date(t));
  }

  function relativeTime(iso, nowMs) {
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    var diff = (nowMs || Date.now()) - t;
    var future = diff < 0;
    var abs = Math.abs(diff);
    if (abs < 60 * 60 * 1000) {
      var mins = Math.max(1, Math.round(abs / (60 * 1000)));
      return future ? "in " + mins + "m" : mins + "m ago";
    }
    if (abs < 24 * 60 * 60 * 1000) {
      var hrs = Math.round(abs / (60 * 60 * 1000));
      return future ? "in " + hrs + "h" : hrs + "h ago";
    }
    var days = Math.round(abs / (24 * 60 * 60 * 1000));
    if (days <= 1) return future ? "tomorrow" : "yesterday";
    return future ? "in " + days + "d" : days + "d ago";
  }

  function dispatch(name, detail) {
    if (typeof root.CustomEvent !== "function") return;
    try {
      var payload = { detail: detail || {}, bubbles: true };
      var ev1 = new root.CustomEvent(name, payload);
      var ev2 = new root.CustomEvent(name, payload);
      if (typeof document !== "undefined" && document.dispatchEvent) {
        document.dispatchEvent(ev1);
      }
      if (typeof root.dispatchEvent === "function") {
        root.dispatchEvent(ev2);
      }
    } catch (e) { /* swallow */ }
  }

  function smoothScrollTo(selector) {
    if (typeof document === "undefined") return;
    var el = document.querySelector(selector);
    if (!el) return;
    var pref = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try { el.scrollIntoView({ behavior: pref ? "auto" : "smooth", block: "start" }); }
    catch (e) { try { el.scrollIntoView(); } catch (e2) { /* */ } }
  }

  function pickPostingHref(job) {
    if (!job || !Array.isArray(job.links)) return "";
    for (var i = 0; i < job.links.length; i++) {
      var h = safeHref(job.links[i] && job.links[i].href);
      if (h) return h;
    }
    return "";
  }

  /* -------------------- private renderers -------------------- */

  function renderModeDivider() {
    return '' +
      '<div class="mode-divider">' +
        '<div class="mode-divider__rule"></div>' +
        '<div class="mode-divider__label">THE <em>workshop</em> · YOUR MOVES</div>' +
        '<div class="mode-divider__rule"></div>' +
      '</div>';
  }

  function renderWorkshopBar(job) {
    var postingHref = pickPostingHref(job);
    var viewHtml = postingHref
      ? '<a href="' + escapeHtml(postingHref) + '" target="_blank" rel="noopener" class="btn-ghost">View posting ↗</a>'
      : "";
    return '' +
      '<header class="workshop__bar">' +
        '<div class="workshop__eyebrow">Your work · this role</div>' +
        '<div class="workshop__primary">' +
          '<button type="button" class="btn-primary" data-action="resume-tailor">Tailor resume</button>' +
          '<button type="button" class="btn-primary" data-action="resume-cover">Cover letter</button>' +
          viewHtml +
        '</div>' +
      '</header>';
  }

  function renderStageStepper(job) {
    var currentKey = String((job && job.stage) || "").toLowerCase();
    var currentIdx = STAGE_ORDER.indexOf(currentKey);
    var stepsHtml = "";
    for (var i = 0; i < STAGE_ORDER.length; i++) {
      var key = STAGE_ORDER[i];
      var label = STAGE_LABELS[key];
      var cls = "stepper__step";
      if (currentIdx >= 0 && i < currentIdx) cls += " stepper__step--done";
      if (currentIdx === i) cls += " stepper__step--current";
      stepsHtml +=
        '<button type="button" class="' + cls + '"' +
          ' data-stage-value="' + escapeHtml(key) + '"' +
          (currentIdx === i ? ' aria-current="step"' : "") +
        '>' + escapeHtml(label) + '</button>';
    }
    return '' +
      '<div class="ws-card">' +
        '<h4>Stage</h4>' +
        '<div class="stepper">' + stepsHtml + '</div>' +
      '</div>';
  }

  function renderTimelineRows(job) {
    var rows = [];
    var nowMs = Date.now();
    if (job.appliedAt) {
      rows.push({
        label: "Applied",
        rel: relativeTime(job.appliedAt, nowMs),
        date: formatDate(job.appliedAt),
        urgent: false,
      });
    }
    if (job.deadline && job.deadline.dueDate) {
      var days = (typeof job.deadline.daysUntil === "number" && Number.isFinite(job.deadline.daysUntil))
        ? job.deadline.daysUntil
        : null;
      var rel = "";
      if (days != null) {
        rel = days >= 0 ? "in " + days + "d" : Math.abs(days) + "d ago";
      } else {
        rel = relativeTime(job.deadline.dueDate, nowMs);
      }
      var urgent = days != null && days >= 0 && days <= 3;
      rows.push({
        label: "Reply due",
        rel: rel,
        date: formatDate(job.deadline.dueDate),
        urgent: urgent,
      });
    }
    return rows;
  }

  function renderTimeline(job) {
    var rows = renderTimelineRows(job);
    if (!rows.length) return "";
    var rowsHtml = rows.map(function (r) {
      var valCls = "timeline__val" + (r.urgent ? " timeline__val--urgent" : "");
      var relHtml = r.rel ? ' <strong>' + escapeHtml(r.rel) + '</strong>' : "";
      var keyHtml = r.date ? '<span class="timeline__key">' + escapeHtml(r.date) + '</span>' : "";
      return '' +
        '<div class="timeline__row">' +
          '<span class="' + valCls + '">' + escapeHtml(r.label) + relHtml + '</span>' +
          keyHtml +
        '</div>';
    }).join("");
    return '' +
      '<div class="ws-card">' +
        '<h4>Timeline</h4>' +
        '<div class="timeline">' + rowsHtml + '</div>' +
      '</div>';
  }

  function renderAtsCardBody(state) {
    state = state || {};
    var status = state.status || "loading";

    if (status === "success" && state.result) {
      var r = state.result;
      var rawScore = (r.overallScore != null) ? Number(r.overallScore) : null;
      var score = (rawScore != null && Number.isFinite(rawScore)) ? rawScore : null;
      var strengths = Array.isArray(r.topStrengths)
        ? r.topStrengths.map(function (s) { return String(s || "").trim(); }).filter(Boolean).slice(0, 3)
        : [];
      var gapText = "";
      if (Array.isArray(r.criticalGaps) && r.criticalGaps.length) {
        var first = r.criticalGaps[0];
        if (first && first.gap) gapText = String(first.gap).trim();
      }
      var numberHtml = score != null
        ? '<div class="ats-card__number">' + escapeHtml(String(score)) + '<sup>/100</sup></div>'
        : '<div class="ats-card__number">—<sup>/100</sup></div>';
      var linesHtml = '<div class="ats-card__lines">' +
        (strengths.length ? '<div><strong>Strong:</strong> ' + escapeHtml(strengths.join(", ")) + '</div>' : "") +
        (gapText ? '<div><strong>Weak:</strong> ' + escapeHtml(gapText) + '</div>' : "") +
      '</div>';
      return '' +
        '<div class="ats-card">' +
          numberHtml +
          linesHtml +
          '<div class="ats-card__action">' +
            '<button type="button" data-action="ats-modal-open">See full scorecard →</button>' +
          '</div>' +
        '</div>';
    }

    if (status === "error") {
      var errMsg = state.error ? String(state.error) : "";
      return '' +
        '<div class="ats-card ats-card--error">' +
          '<div class="ats-card__lines">' +
            '<div><strong>Couldn\'t score this role</strong></div>' +
            (errMsg ? '<div>' + escapeHtml(errMsg) + '</div>' : "") +
          '</div>' +
          '<div class="ats-card__action">' +
            '<button type="button" data-action="ats-state-retry">Retry</button>' +
          '</div>' +
        '</div>';
    }

    /* loading / idle / unknown — show the progress placeholder */
    return '' +
      '<div class="ats-card ats-card--loading">' +
        '<div class="ats-card__lines">' +
          '<div><strong>Scoring…</strong></div>' +
          '<div class="ats-card__progress" aria-hidden="true"></div>' +
        '</div>' +
      '</div>';
  }

  function renderAtsCard(state) {
    return '' +
      '<div class="ws-card" ' + ATS_CONTAINER_ATTR + '>' +
        '<h4>ATS scorecard</h4>' +
        renderAtsCardBody(state) +
      '</div>';
  }

  function renderWriteBackChips() {
    return '' +
      '<div class="ws-card">' +
        '<h4>Mark progress</h4>' +
        '<div class="writeback">' +
          '<button type="button" class="chip" data-writeback="heardBack">' +
            '<span class="pulse"></span>Heard back' +
          '</button>' +
          '<button type="button" class="chip" data-writeback="reply">' +
            '<span class="pulse"></span>Got reply' +
          '</button>' +
          '<button type="button" class="chip" data-writeback="followupAt">' +
            '<span class="pulse"></span>Followup nudge' +
          '</button>' +
          '<button type="button" class="chip chip--danger" data-writeback="passed">' +
            '<span class="pulse"></span>Mark passed' +
          '</button>' +
        '</div>' +
      '</div>';
  }

  /* -------------------- click delegation -------------------- */

  function handleWriteback(field, jobKey) {
    if (!jobKey || !field) return;
    if (field === "heardBack") {
      dispatch("jb:role:writeback", { jobKey: jobKey, field: "heardBack", value: todayIso() });
    } else if (field === "reply") {
      dispatch("jb:role:writeback", { jobKey: jobKey, field: "reply", value: todayIso() });
    } else if (field === "followupAt") {
      dispatch("jb:role:writeback", { jobKey: jobKey, field: "followupAt", value: plusDaysIso(3) });
    } else if (field === "passed") {
      dispatch("jb:role:writeback", { jobKey: jobKey, field: "passed", value: true });
    }
  }

  function onMountClick(e) {
    if (!ctx || !ctx.mount) return;
    var key = ctx.jobKey || "";
    var t = e.target;
    while (t && t !== ctx.mount) {
      if (t.getAttribute) {
        var stageVal = t.getAttribute("data-stage-value");
        if (stageVal) {
          dispatch("jb:role:writeback", { jobKey: key, field: "stage", value: stageVal });
          return;
        }
        var writeback = t.getAttribute("data-writeback");
        if (writeback) {
          handleWriteback(writeback, key);
          return;
        }
        var action = t.getAttribute("data-action");
        if (action === "resume-tailor" || action === "resume-cover") {
          smoothScrollTo(LETTER_REGION_SELECTOR);
          dispatch("jb:role:action", { action: action, jobKey: key });
          return;
        }
        if (action === "ats-modal-open") {
          dispatch("jb:ats:modal:open", { jobKey: key });
          return;
        }
        if (action === "ats-state-retry") {
          dispatch("jb:ats:state:request", { jobKey: key });
          return;
        }
      }
      t = t.parentNode;
    }
  }

  function wireMount(mount) {
    if (!mount || mount.__workshopWired) return;
    mount.__workshopWired = true;
    mount.addEventListener("click", onMountClick);
  }

  /* -------------------- global listeners (attach once) -------------------- */

  function onAtsState(e) {
    if (!ctx || !ctx.mount) return;
    var detail = (e && e.detail) || {};
    var container = ctx.mount.querySelector("[" + ATS_CONTAINER_ATTR + "]");
    if (!container) return;
    container.innerHTML = '<h4>ATS scorecard</h4>' + renderAtsCardBody(detail);
  }

  function onRoleOpened(e) {
    var key = e && e.detail && e.detail.jobKey;
    if (!key) return;
    /* The bus filters its own replay by cacheKey === jobKey, but we
       always ask. If the bus has nothing matching, the workshop
       stays in its loading placeholder. */
    dispatch("jb:ats:state:request", { jobKey: key });
  }

  if (typeof root.addEventListener === "function") {
    root.addEventListener("jb:ats:state", onAtsState);
    root.addEventListener("jb:role:opened", onRoleOpened);
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("jb:ats:state", onAtsState);
  }

  /* -------------------- public entry -------------------- */

  function renderWorkshop(mount, vm) {
    if (!mount) return;
    var job = (vm && vm.job) || {};
    var jobKey = job.jobKey
      || (root.JobBoredFlowing
          && root.JobBoredFlowing.openRole
          && typeof root.JobBoredFlowing.openRole.get === "function"
          && root.JobBoredFlowing.openRole.get())
      || "";

    mount.innerHTML = '' +
      renderModeDivider() +
      '<aside class="workshop" aria-label="Workshop">' +
        renderWorkshopBar(job) +
        '<div class="workshop__grid">' +
          '<div class="workshop__col workshop__col--track">' +
            renderStageStepper(job) +
            renderTimeline(job) +
          '</div>' +
          '<div class="workshop__col workshop__col--score">' +
            renderAtsCard({ status: "loading" }) +
            renderWriteBackChips() +
          '</div>' +
        '</div>' +
      '</aside>';

    ctx = { mount: mount, jobKey: jobKey };

    wireMount(mount);

    if (jobKey) dispatch("jb:ats:state:request", { jobKey: jobKey });
  }

  /* -------------------- expose -------------------- */

  root.JobBoredDossierWorkshop = {
    renderWorkshop: renderWorkshop,
  };
})(typeof window !== "undefined" ? window : this);
