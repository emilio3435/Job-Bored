/* ============================================================
   role-brief.js — JobBored v2 PART 03 · The Brief (Direction F)
   ------------------------------------------------------------
   Owner:    dossier-df/brief lane (run dossier-df-20260519T2030Z)
   Renders:  the parchment editorial Brief card mounted at
             [data-mount="brief"] inside [data-region="role"].
   Reads:    the role view-model produced by
             window.JobBoredDawn.data.getRoleViewModel(jobKey)
             and forwarded by role.js's renderDossier.
   Visual:   docs/redesign/dossier-direction-f-wireframe.html
   Events:
     EMITS    jb:role:note { jobKey, body }
              (via [data-action="notes"] blur, wired by role.js's
              wireDossier — preserved contract)

   Activation: body.jb-v2 only. Off-flag: no-op.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var STAGE_LABELS = {
    "researching":  "Researching",
    "applied":      "Applied",
    "phone-screen": "Phone screen",
    "interviewing": "Interviewing",
    "offer":        "Offer",
  };

  function shouldRun() {
    return !!(typeof document !== "undefined"
      && document.body
      && document.body.classList
      && document.body.classList.contains("jb-v2"));
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toRoman(n) {
    if (!Number.isFinite(n) || n < 1) return "";
    var ones = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"];
    var tens = ["", "x", "xx", "xxx"];
    var hundreds = Math.floor(n / 100);
    if (hundreds > 0) return String(n);
    return tens[Math.floor(n / 10) % 4] + ones[n % 10];
  }

  function countWords(s) {
    if (!s) return 0;
    var m = String(s).match(/\S+/g);
    return m ? m.length : 0;
  }

  function jdTotalWords(sections) {
    if (!Array.isArray(sections)) return 0;
    var total = 0;
    sections.forEach(function (section) {
      if (!section) return;
      total += countWords(section.body);
      if (Array.isArray(section.bullets)) {
        section.bullets.forEach(function (b) { total += countWords(b); });
      }
    });
    return total;
  }

  function pickHook(job) {
    if (job.companyTagline) return String(job.companyTagline).trim();
    if (Array.isArray(job.jdSections) && job.jdSections.length) {
      var first = job.jdSections[0];
      if (first) {
        if (first.body) return String(first.body).trim();
        if (Array.isArray(first.bullets) && first.bullets[0]) return String(first.bullets[0]).trim();
      }
    }
    if (job.jdSnippet) return String(job.jdSnippet).trim();
    return "";
  }

  function pickLede(job, hookText) {
    if (!Array.isArray(job.jdSections) || !job.jdSections.length) return "";
    var first = job.jdSections[0];
    if (!first || !first.body) return "";
    var body = String(first.body).trim();
    if (!body || body === hookText) return "";
    return body;
  }

  /* -------------------- masthead -------------------- */

  function renderMasthead(job) {
    var eyebrowParts = [];
    if (job.employment) eyebrowParts.push(String(job.employment).trim());
    var eyebrowText = eyebrowParts.filter(Boolean).join(" · ");
    var eyebrow = eyebrowText
      ? '<div class="brief__eyebrow">' + escapeHtml(eyebrowText) + '</div>'
      : "";

    var title = job.role
      ? '<h1 class="brief__title">' + escapeHtml(job.role) + '</h1>'
      : "";

    var company = job.company
      ? '<p class="brief__company">' + escapeHtml(job.company) + '</p>'
      : "";

    var factSpans = [];
    if (job.location) factSpans.push('<span>' + escapeHtml(job.location) + '</span>');
    if (job.salary)   factSpans.push('<span>' + escapeHtml(job.salary) + '</span>');
    if (job.source)   factSpans.push('<span>via ' + escapeHtml(job.source) + '</span>');
    var factsInner = "";
    for (var i = 0; i < factSpans.length; i++) {
      if (i > 0) factsInner += '<span class="dot">·</span>';
      factsInner += factSpans[i];
    }
    var facts = factSpans.length
      ? '<div class="brief__facts">' + factsInner + '</div>'
      : "";

    var stageKey = job.stage || "";
    var stageLabel = STAGE_LABELS[stageKey] || (stageKey ? String(stageKey) : "");
    var stageChip = stageLabel
      ? '<button type="button" class="brief__stage-chip" data-action="brief-stage-chip" aria-label="Open stage controls in workshop">' +
          escapeHtml(stageLabel) +
          '<span class="caret" aria-hidden="true">▾</span>' +
        '</button>'
      : "";

    if (!eyebrow && !title && !company && !facts && !stageChip) return "";

    return '<header class="brief__masthead">' +
      '<div>' + eyebrow + title + company + facts + '</div>' +
      stageChip +
    '</header>';
  }

  /* -------------------- left column -------------------- */

  function renderHook(hookText) {
    if (!hookText) return "";
    return '<p class="brief__hook">' + escapeHtml(hookText) + '</p>';
  }

  function renderLede(job, hookText) {
    var lede = pickLede(job, hookText);
    if (!lede) return "";
    var totalWords = jdTotalWords(job.jdSections);
    var tag = "Compressed by JobBored AI";
    if (totalWords > 0) {
      tag += " · from " + totalWords + " word" + (totalWords === 1 ? "" : "s");
    }
    return '<div class="brief__lede-block">' +
      '<p class="brief__lede">' + escapeHtml(lede) + '</p>' +
      '<div class="brief__lede-tag">' + escapeHtml(tag) + '</div>' +
    '</div>';
  }

  function renderRawPosting(job) {
    if (!Array.isArray(job.jdSections) || job.jdSections.length <= 1) return "";
    var rest = job.jdSections.slice(1);
    var detailsHtml = "";
    var renderedIndex = 0;
    for (var i = 0; i < rest.length; i++) {
      var section = rest[i];
      if (!section) continue;
      var heading = section.heading ? String(section.heading).trim() : "";
      var bullets = Array.isArray(section.bullets) ? section.bullets.filter(Boolean) : [];
      var body = section.body ? String(section.body).trim() : "";
      if (!heading && !body && !bullets.length) continue;
      renderedIndex += 1;
      var openAttr = renderedIndex === 1 ? " open" : "";
      var roman = toRoman(renderedIndex);
      var countText = bullets.length + " bullet" + (bullets.length === 1 ? "" : "s");
      var bodyHtml = "";
      if (body) bodyHtml += '<p>' + escapeHtml(body) + '</p>';
      if (bullets.length) {
        bodyHtml += '<ul>' + bullets.map(function (b) {
          return '<li>' + escapeHtml(b) + '</li>';
        }).join("") + '</ul>';
      }
      var headingLabel = heading || ("Section " + renderedIndex);
      detailsHtml += '<details' + openAttr + '>' +
        '<summary>' +
          '<span class="roman">' + escapeHtml(roman) + '.</span>' +
          '<span>' + escapeHtml(headingLabel) + '</span>' +
          '<span class="count">' + escapeHtml(countText) + '</span>' +
          '<span class="toggle" aria-hidden="true">+</span>' +
        '</summary>' +
        '<div class="body">' + bodyHtml + '</div>' +
      '</details>';
    }
    if (!detailsHtml) return "";
    return '<section class="jd">' +
      '<h3 class="section-label">Raw posting</h3>' +
      detailsHtml +
    '</section>';
  }

  /* -------------------- right column -------------------- */

  function renderSkim(job) {
    var rows = [];
    var tags = Array.isArray(job.tags) ? job.tags.filter(Boolean) : [];
    if (tags.length) {
      rows.push({ key: "Stack", val: tags.slice(0, 3).join(" · ") });
    }
    if (job.salary)   rows.push({ key: "Comp", val: String(job.salary) });
    if (job.location) rows.push({ key: "Location", val: String(job.location) });
    if (Number.isFinite(job.fitScore)) {
      var pct = Math.max(0, Math.min(100, Math.round(job.fitScore * 10)));
      rows.push({ key: "ATS fit", val: pct, score: true });
    }
    if (!rows.length) return "";
    var inner = rows.map(function (r) {
      if (r.score) {
        return '<li>' +
          '<span class="key">' + escapeHtml(r.key) + '</span>' +
          '<span class="val val--score">' + escapeHtml(String(r.val)) +
            '<sup style="font-size:0.55em;color:var(--mute);font-family:var(--mono);">/100</sup>' +
          '</span>' +
        '</li>';
      }
      return '<li>' +
        '<span class="key">' + escapeHtml(r.key) + '</span>' +
        '<span class="val">' + escapeHtml(String(r.val)) + '</span>' +
      '</li>';
    }).join("");
    return '<ul class="skim">' + inner + '</ul>';
  }

  function renderTalkingPoints(job) {
    if (!Array.isArray(job.jdSections) || !job.jdSections.length) return "";
    var first = job.jdSections[0];
    var bullets = first && Array.isArray(first.bullets) ? first.bullets.filter(Boolean) : [];
    if (!bullets.length) return "";
    var items = bullets.map(function (b) {
      return '<li>' + escapeHtml(b) + '</li>';
    }).join("");
    return '<section class="points">' +
      '<h3 class="section-label">Talking points</h3>' +
      '<ul>' + items + '</ul>' +
    '</section>';
  }

  function renderMarginalia(job) {
    var body = (job.notes && job.notes.body) ? String(job.notes.body) : "";
    return '<div class="brief-notes">' +
      '<h3 class="section-label">Marginalia</h3>' +
      '<textarea data-action="notes" placeholder="Interview prep, recruiter name, links you\u2019ve gathered, next steps\u2026">' +
        escapeHtml(body) +
      '</textarea>' +
    '</div>';
  }

  /* -------------------- wiring -------------------- */

  function wireBrief(briefRoot) {
    var chip = briefRoot.querySelector('[data-action="brief-stage-chip"]');
    if (chip) {
      chip.addEventListener("click", function (e) {
        e.preventDefault();
        var target = document.querySelector(".workshop .stepper")
          || document.querySelector(".workshop");
        if (!target) return;
        var prefersReduced = root.matchMedia
          && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
        try {
          target.scrollIntoView({
            behavior: prefersReduced ? "auto" : "smooth",
            block: "start",
          });
        } catch (err) {
          target.scrollIntoView();
        }
      });
    }
  }

  /* -------------------- public render -------------------- */

  function renderBrief(briefRoot, vm) {
    if (!briefRoot) return;
    if (!shouldRun()) return;
    var job = (vm && vm.job) || {};

    var hookText = pickHook(job);
    var mastheadHtml = renderMasthead(job);
    var hookHtml = renderHook(hookText);
    var ledeHtml = renderLede(job, hookText);
    var rawHtml = renderRawPosting(job);
    var skimHtml = renderSkim(job);
    var pointsHtml = renderTalkingPoints(job);
    var marginaliaHtml = renderMarginalia(job);

    briefRoot.innerHTML = mastheadHtml +
      '<div class="brief__body">' +
        '<div class="brief__col brief__col--main">' +
          hookHtml + ledeHtml + rawHtml +
        '</div>' +
        '<div class="brief__col brief__col--side">' +
          skimHtml + pointsHtml + marginaliaHtml +
        '</div>' +
      '</div>';

    wireBrief(briefRoot);
  }

  /* -------------------- expose -------------------- */

  root.JobBoredDossierBrief = root.JobBoredDossierBrief || {};
  root.JobBoredDossierBrief.renderBrief = renderBrief;

  // Re-render on script load if a role is already open.
  // role.js loads (with defer) before this file and may have called
  // renderDossier synchronously without our renderer registered yet.
  try {
    var flowing = root.JobBoredFlowing;
    var roleApi = flowing && flowing.role;
    var openRole = flowing && flowing.openRole;
    if (roleApi && typeof roleApi.renderForKey === "function"
      && openRole && typeof openRole.get === "function") {
      var key = openRole.get();
      if (key) roleApi.renderForKey(key);
    }
  } catch (e) { /* */ }
})(typeof window !== "undefined" ? window : this);
