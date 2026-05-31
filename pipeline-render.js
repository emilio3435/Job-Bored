/* ============================================
   COMMAND CENTER v2 — Pipeline Render
   Extracted from app.js (pipeline-render cut).

   Classic-global IIFE under window.JobBoredApp.pipelineRender — NOT an ES module.
   Loaded BEFORE app.js. Kanban board, detail drawer, filter/sort, card listeners.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const pipelineRender = root.pipelineRender || (root.pipelineRender = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function core() {
    return window.JobBoredApp.core;
  }

  function companyLogo() {
    return window.JobBoredApp.companyLogo;
  }

  function keywordMatch() {
    return window.JobBoredApp.keywordMatch;
  }

  function resumeGeneration() {
    return window.JobBoredApp.resumeGeneration;
  }

  function expiredReview() {
    return window.JobBoredApp.expiredReview;
  }

  function postingEnrichment() {
    return window.JobBoredApp.postingEnrichment;
  }

  const STAGE_ORDER = [
    "New",
    "Researching",
    "Applied",
    "Phone Screen",
    "Interviewing",
    "Offer",
    "Rejected",
    "Passed",
    "Expired",
  ];
  const STAGE_ARCHIVE = new Set(["Rejected", "Passed", "Expired"]);

function renderAll() {
  renderPipeline();
  host().renderBrief();
}

function renderStats() {
  // Momentum metrics are now rendered as part of renderBrief()
}

function animateNumber(id, value) {
  const el = document.getElementById(id);
  if (el.textContent === "—" || el.textContent === "0") {
    el.textContent = value;
    return;
  }
  const start = parseInt(el.textContent) || 0;
  if (start === value) return;
  const duration = 400;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (value - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// --- Pipeline ---
function normalizeStatusStr(status) {
  return (status || "").trim().toLowerCase();
}

/** Inbox: not yet in downstream stages (New, Researching, or blank). */
function isInboxJob(job) {
  const s = normalizeStatusStr(job.status);
  if (!s) return true;
  return s === "new" || s === "researching";
}

// ---- Pipeline Board helpers ----

function stageToCssKey(stage) {
  return stage.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Location + salary — shared strip (list card, board card, drawer header).
 * @param {"card"|"kanban"|"drawer"} variant
 */
function renderRoleFactsHtml(job, variant = "card") {
  const rawSalary = String(job.salary ?? "").trim();
  const salaryStr =
    rawSalary.includes("<") ||
    rawSalary.includes("&lt;") ||
    rawSalary.includes("&gt;") ||
    rawSalary.length > 120
      ? ""
      : rawSalary;
  const showSalary = salaryStr && salaryStr.toLowerCase() !== "not listed";
  const loc = job.location ? String(job.location).trim() : "";
  if (!loc && !showSalary) return "";
  const mod =
    variant === "drawer"
      ? "role-facts--drawer"
      : variant === "kanban"
        ? "role-facts--kanban"
        : "role-facts--card";
  const parts = [];
  if (loc) {
    parts.push(
      `<div class="role-fact"><span class="role-fact__label">Location</span><span class="role-fact__value">${host().escapeHtml(loc)}</span></div>`,
    );
  }
  if (showSalary) {
    parts.push(
      `<div class="role-fact"><span class="role-fact__label">Salary</span><span class="role-fact__value role-fact__value--salary">${host().escapeHtml(salaryStr)}</span></div>`,
    );
  }
  return `<div class="role-facts ${mod}" role="group" aria-label="Location and compensation">${parts.join("")}</div>`;
}

function groupByStage(data) {
  const byStage = new Map(STAGE_ORDER.map((s) => [s, []]));
  for (const job of data) {
    const raw = (job.status || "").trim();
    const key =
      STAGE_ORDER.find((s) => s.toLowerCase() === raw.toLowerCase()) || "New";
    byStage.get(key).push(job);
  }
  return byStage;
}

function renderKanbanCard(job, index) {
  const dataIndex = core().getPipelineData().indexOf(job);
  const stableKey = dataIndex >= 0 ? dataIndex : index;
  const title = job.title || "Untitled Role";
  const company = job.company || "Unknown Company";
  const roleFactsHtml = renderRoleFactsHtml(job, "kanban");
  const isViewed = core().getViewedJobKeys().has(stableKey);

  // First 3 tags from the sheet Tags column
  const tagChips = job.tags
    ? job.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((t) => `<span class="kanban-card__tag">${host().escapeHtml(t)}</span>`)
        .join("")
    : "";

  const stageClass = `kanban-card--stage-${stageToCssKey((job.status || "new").trim() || "new")}`;
  const isFavorite = !!job.favorite;
  const isDismissed = !!job.dismissedAt;
  const cardModClasses = [
    stageClass,
    isViewed ? "kanban-card--viewed" : "",
    isFavorite ? "kanban-card--favorited" : "",
    isDismissed ? "kanban-card--dismissed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const favBtnHtml = `<button type="button" class="card-action-btn card-action-btn--fav${isFavorite ? " is-active" : ""}" data-action="toggle-favorite" data-key="${stableKey}" aria-label="${isFavorite ? "Unfavorite" : "Favorite"}" aria-pressed="${isFavorite}" title="${isFavorite ? "Unfavorite" : "Favorite"}">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFavorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  </button>`;
  const dismissBtnHtml = isDismissed
    ? `<button type="button" class="card-action-btn card-action-btn--restore" data-action="restore" data-key="${stableKey}" aria-label="Restore" title="Restore">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 7 3 12 8 12"/><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/></svg>
  </button>`
    : `<button type="button" class="card-action-btn card-action-btn--dismiss" data-action="dismiss" data-key="${stableKey}" aria-label="Dismiss" title="Dismiss">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>`;

  const _attrEsc = (v) => `"${host().escapeHtml(String(v))}"`;
  const _pair = (k, v) => (v == null || v === "" ? "" : `${k}=${_attrEsc(v)}`);
  const jdRaw = (job._postingEnrichment && job._postingEnrichment.description) || job.fitAssessment || "";
  const repliedFlag = /^(yes|replied|y)$/i.test(String(job.responseFlag || "")) ? "yes" : "";
  const contactsJson = job.contact && String(job.contact).trim()
    ? JSON.stringify([{ name: String(job.contact).trim() }])
    : "";
  // Pull the AI enrichment fields the drawer uses (gemini scrape + LLM) so
  // the v2 Dossier can render the same intelligence. Strings get clipped to
  // safe lengths so the data attribute payload stays reasonable.
  const _enr = (job && job._postingEnrichment) || null;
  const _clip = (s, n) => (s ? String(s).slice(0, n) : "");
  const _arrJson = (a) => {
    if (!Array.isArray(a) || !a.length) return "";
    const out = a
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 16);
    return out.length ? JSON.stringify(out) : "";
  };
  const _enrPair = (attr, value) => _pair(attr, value || "");
  const v2Attrs = [
    _pair("data-jd-snippet", jdRaw ? String(jdRaw).slice(0, 4000) : ""),
    _pair("data-notes", job.notes || ""),
    _pair("data-location", job.location || ""),
    _pair("data-salary", job.salary || ""),
    _pair("data-job-url", job.link || ""),
    _pair("data-source", job.source || ""),
    _pair("data-applied-at", job.appliedDate || ""),
    _pair("data-found-at", job.dateFoundRaw || ""),
    _pair("data-follow-up", job.followUpDate || ""),
    _pair("data-tags", job.tags || ""),
    _pair("data-fit", Number.isFinite(job.fitScore) ? String(job.fitScore) : ""),
    _pair("data-replied", repliedFlag),
    _pair("data-talking-points", job.talkingPoints || ""),
    _pair("data-contacts", contactsJson),
    _pair("data-company-tagline", (_enr && _enr.aboutCompany) || ""),
    _pair("data-employment", (_enr && _enr.employmentType) || ""),
    // Drawer-parity AI enrichment fields, surfaced so the v2 Dossier can
    // render the same content (postingSummary, fitAngle, structured lists).
    _enrPair("data-role-in-one-line", _enr && _clip(_enr.roleInOneLine, 240)),
    _enrPair("data-posting-summary",  _enr && _clip(_enr.postingSummary, 1200)),
    _enrPair("data-fit-angle",        _enr && _clip(_enr.fitAngle, 800)),
    _enrPair("data-fit-assessment",   _clip(job.fitAssessment, 800)),
    _enrPair("data-must-haves",       _enr && _arrJson(_enr.mustHaves)),
    _enrPair("data-nice-to-haves",    _enr && _arrJson(_enr.niceToHaves)),
    _enrPair("data-responsibilities", _enr && _arrJson(_enr.responsibilities)),
    _enrPair("data-tools-and-stack",  _enr && _arrJson(_enr.toolsAndStack)),
    _pair(
      "data-ats-fit-score",
      _enr && Number.isFinite(Number(_enr.atsFitScore))
        ? String(Math.max(0, Math.min(100, Math.round(Number(_enr.atsFitScore)))))
        : "",
    ),
    _enrPair("data-ats-fit-rationale", _enr && _clip(_enr.atsFitRationale, 500)),
    _enrPair("data-extra-keywords",   _enr && _arrJson(_enr.extraKeywords)),
    _enrPair("data-ai-talking-points",_enr && _arrJson(_enr.talkingPoints)),
    _enrPair(
      "data-enrichment-status",
      job && job._enrichmentLoading
        ? "loading"
        : (_enr && _enr.scrapedAt && !_enr.llmError ? "ready" : ""),
    ),
  ].filter(Boolean).join(" ");

  return `
    <article class="kanban-card ${cardModClasses}" role="button" tabindex="0" data-action="open-detail" data-stable-key="${stableKey}" ${dataIndex >= 0 ? `data-index="${dataIndex}"` : ""} ${v2Attrs} style="animation-delay:${index * 30}ms">
      ${isViewed ? `<span class="kanban-card__viewed-dot" aria-label="Previously viewed" title="Previously viewed"></span>` : ""}
      <div class="kanban-card__actions" aria-label="Card actions">
        ${favBtnHtml}
        ${dismissBtnHtml}
      </div>
      <div class="kanban-card__identity">
        ${companyLogo().renderLogoHtml(job, "kanban")}
        <div class="kanban-card__identity-text">
          <span class="kanban-card__title">${host().escapeHtml(title)}</span>
          <span class="kanban-card__company">${host().escapeHtml(company)}</span>
        </div>
      </div>
      ${roleFactsHtml}
      ${tagChips ? `<div class="kanban-card__tags">${tagChips}</div>` : ""}
    </article>`;
}

function applyLegacyKanbanCap(jobs) {
  const cap = typeof window !== "undefined" ? window.JobBoredCompanyCap : null;
  if (!cap || typeof cap.capCardsByFit !== "function") return { visible: jobs, hidden: [] };
  const kept = cap.capCardsByFit(jobs, (job) => !!(job && job.favorite));
  const hidden = cap.summarizeHidden(jobs, kept);
  return { visible: kept, hidden: hidden };
}

function renderLegacyKanbanHiddenAffordance(hidden) {
  if (!Array.isArray(hidden) || hidden.length === 0) return "";
  const label = hidden
    .map((entry) => `+${entry.hidden} from ${host().escapeHtml(entry.company)}`)
    .join(" · ");
  return `<p class="stage-lane__hidden" title="${host().escapeHtml(label)} — hidden so one company can’t dominate this column. Star a role to keep it pinned.">${label} hidden</p>`;
}

function renderStageLane(stage, jobs) {
  const isExpanded = core().getExpandedStages().has(stage);
  const isArchive = STAGE_ARCHIVE.has(stage);
  const cssKey = stageToCssKey(stage);
  const { visible: visibleJobs, hidden } = applyLegacyKanbanCap(jobs);
  const hiddenHtml = renderLegacyKanbanHiddenAffordance(hidden);

  return `
    <section class="stage-lane${isArchive ? " stage-lane--archive" : ""}${isExpanded ? " stage-lane--expanded" : ""}" data-stage="${host().escapeHtml(stage)}">
      <button type="button" class="stage-lane__header" data-action="toggle-stage" data-stage="${host().escapeHtml(stage)}">
        <span class="stage-dot stage-dot--${cssKey}" aria-hidden="true"></span>
        <span class="stage-lane__name">${host().escapeHtml(stage)}</span>
        <span class="stage-lane__count">${visibleJobs.length}</span>
        <svg class="stage-lane__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="stage-lane__body">
        <div class="stage-lane__scroll-area">
          <button type="button" class="stage-lane__nav stage-lane__nav--prev" data-action="scroll-stage" data-dir="prev" data-stage="${host().escapeHtml(stage)}" aria-label="Scroll left" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="stage-lane__track" id="track-${cssKey}">
            ${visibleJobs.map((job, i) => renderKanbanCard(job, i)).join("")}
          </div>
          <button type="button" class="stage-lane__nav stage-lane__nav--next" data-action="scroll-stage" data-dir="next" data-stage="${host().escapeHtml(stage)}" aria-label="Scroll right">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        ${hiddenHtml}
        <div class="stage-lane__indicator">
          <div class="stage-indicator-thumb" id="thumb-${cssKey}"></div>
        </div>
      </div>
    </section>`;
}

function renderPipelineBoard(data) {
  const byStage = groupByStage(data);
  const lanes = STAGE_ORDER.filter((stage) => byStage.get(stage).length > 0)
    .map((stage) => renderStageLane(stage, byStage.get(stage)))
    .join("");
  return lanes ? `<div class="pipeline-board">${lanes}</div>` : "";
}

// ---- Detail drawer ----

function handleDetailEscape(e) {
  if (e.key === "Escape") closeJobDetail();
}

function renderStageStepper(job, dataIndex) {
  const stages = [
    "New",
    "Researching",
    "Applied",
    "Phone Screen",
    "Interviewing",
    "Offer",
    "Rejected",
    "Passed",
    "Expired",
  ];
  const normalized = (job.status || "").trim().toLowerCase();
  const curIdx = stages.findIndex((s) => s.toLowerCase() === normalized);
  const activeIdx = curIdx >= 0 ? curIdx : 0;
  const isTerminal = activeIdx >= 6; // Rejected, Passed, or Expired

  return `<div class="stage-stepper-wrap">
    <button type="button" class="stage-stepper__chevron stage-stepper__chevron--left" data-action="scroll-stage" data-dir="-1" aria-label="Scroll left">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="stage-stepper" role="group" aria-label="Pipeline stage">${stages
      .map((s, i) => {
        let cls = "stage-step";
        if (i === activeIdx) cls += " stage-step--active";
        else if (!isTerminal && i < activeIdx) cls += " stage-step--done";
        else if (isTerminal && i < 6 && i < activeIdx)
          cls += " stage-step--done";
        if (i >= 6) cls += " stage-step--terminal";
        const connector =
          i > 0
            ? `<span class="stage-step__line${i <= activeIdx && !isTerminal ? " stage-step__line--done" : ""}"></span>`
            : "";
        return `${connector}<button type="button" class="${cls}" data-action="stage-step" data-stage="${host().escapeHtml(s)}" data-index="${dataIndex}" title="Move to ${host().escapeHtml(s)}"><span class="stage-step__dot"></span><span class="stage-step__label">${host().escapeHtml(s)}</span></button>`;
      })
      .join("")}</div>
    <button type="button" class="stage-stepper__chevron stage-stepper__chevron--right" data-action="scroll-stage" data-dir="1" aria-label="Scroll right">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>`;
}

function renderDrawerContent(job, stableKey) {
  const dataIndex = core().getPipelineData().indexOf(job);
  const enr = job._postingEnrichment;
  const draftLibraryHtml =
    dataIndex >= 0 ? resumeGeneration().renderDraftLibraryCardHtml(job, dataIndex) : "";

  // ── Stage stepper ──
  const stepperHtml = host().isSignedIn() ? renderStageStepper(job, dataIndex) : "";

  // ── Notes (prominent, left column) ──
  const notesHtml = host().isSignedIn()
    ? `<div class="drawer-notes">
    <label class="drawer-section__label" for="drawer-notes-${stableKey}">Notes</label>
    <textarea id="drawer-notes-${stableKey}" class="drawer-notes__input" data-action="notes" data-index="${dataIndex}" placeholder="Interview prep, recruiter name, next steps&#8230;">${host().escapeHtml(job.notes || "")}</textarea>
  </div>`
    : "";

  // ── AI / role content (reused from card logic) ──
  const sheetTags = job.tags
    ? job.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const tags = (() => {
    const m = new Map();
    const add = (raw) => {
      const t = String(raw || "").trim();
      if (t) {
        const k = t.toLowerCase();
        if (!m.has(k)) m.set(k, t);
      }
    };
    sheetTags.forEach(add);
    if (enr && Array.isArray(enr.skills)) enr.skills.forEach(add);
    if (enr && Array.isArray(enr.extraKeywords)) enr.extraKeywords.forEach(add);
    return [...m.values()];
  })();

  const hookText = (() => {
    const oneLine = enr && String(enr.roleInOneLine || "").trim();
    if (oneLine) return oneLine;
    const fitAngle = enr && String(enr.fitAngle || "").trim();
    if (fitAngle)
      return fitAngle.length > 120
        ? `${fitAngle.slice(0, 117).trim()}…`
        : fitAngle;
    const fitAssess = String(job.fitAssessment || "").trim();
    if (fitAssess)
      return fitAssess.length > 120
        ? `${fitAssess.slice(0, 117).trim()}…`
        : fitAssess;
    return "";
  })();
  const hookHtml = hookText
    ? `<p class="drawer-hook">${host().escapeHtml(hookText)}</p>`
    : "";

  const ctxHtml = job.dateFoundRaw
    ? `<p class="drawer-context drawer-context--date">${host().escapeHtml(job.dateFoundRaw)}</p>`
    : "";

  // AI Summary
  const aiText = String(enr?.postingSummary || "").trim();
  const aiHtml = aiText
    ? `<div class="drawer-ai-section"><span class="drawer-section__label">AI Summary</span><p class="drawer-ai-text">${host().escapeHtml(aiText)}</p></div>`
    : "";

  // Fit — always show full text, no truncation
  const fitAngle = enr && String(enr.fitAngle || "").trim();
  const fitAssessment = String(job.fitAssessment || "").trim();
  const fitText = fitAngle || fitAssessment;
  const fitHtml = fitText
    ? `<div class="drawer-ai-section"><span class="drawer-section__label">Fit</span><p class="drawer-ai-text">${host().escapeHtml(fitText)}</p></div>`
    : "";
  const profileMatchBadgeHtml = keywordMatch().renderProfileMatchBadgeHtml(job, dataIndex);

  // Tags
  const SKILL_MAX = 14;
  const vis = tags.slice(0, SKILL_MAX);
  const extraN = tags.length - vis.length;
  const extraChips =
    extraN > 0
      ? tags
          .slice(SKILL_MAX)
          .map((t) => `<span class="skill-chip">${host().escapeHtml(t)}</span>`)
          .join("")
      : "";
  const tagsHtml =
    tags.length > 0
      ? `<div class="drawer-ai-section"><span class="drawer-section__label">Tags &amp; skills</span><div class="card-tags card-skills-tags" data-tags-wrap="${stableKey}">${vis.map((t) => `<span class="skill-chip">${host().escapeHtml(t)}</span>`).join("")}${extraN > 0 ? `<span class="card-tags-extra">${extraChips}</span><button type="button" class="tag-more-btn" data-action="toggle-tags" data-tags-key="${stableKey}" aria-expanded="false">+${extraN} more</button>` : ""}</div></div>`
      : "";

  // Must-haves
  const mustArr =
    enr && Array.isArray(enr.mustHaves)
      ? enr.mustHaves.map((x) => String(x).trim()).filter(Boolean)
      : [];
  const mustHtml = mustArr.length
    ? `<div class="drawer-ai-section"><span class="drawer-section__label">Must-haves</span><ul class="card-peek__list">${mustArr
        .slice(0, 8)
        .map(
          (r) =>
            `<li>${host().escapeHtml(r.length > 200 ? r.slice(0, 200) + "…" : r)}</li>`,
        )
        .join("")}</ul></div>`
    : "";

  // Source
  const srcHtml = job.source
    ? `<p class="card-peek__source">via ${host().escapeHtml(job.source)}</p>`
    : "";

  // Talking points
  const tpFromEnr =
    enr && Array.isArray(enr.talkingPoints) && enr.talkingPoints.length > 0
      ? enr.talkingPoints.map((p) => String(p).trim()).filter(Boolean)
      : null;
  const tpFromSheet = job.talkingPoints
    ? job.talkingPoints
        .split("\n")
        .map((l) => l.replace(/^[•\-\*]\s*/, "").trim())
        .filter(Boolean)
    : [];
  const tpLabel =
    tpFromEnr && tpFromEnr.length
      ? "Talking points (from posting + AI)"
      : "Talking points";
  const tpList = tpFromEnr && tpFromEnr.length ? tpFromEnr : tpFromSheet;
  const tpHtml =
    tpList.length > 0
      ? `<div class="drawer-ai-section"><span class="drawer-section__label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${host().escapeHtml(tpLabel)}</span><ul class="talking-points-list">${tpList.map((p) => `<li>${host().escapeHtml(p)}</li>`).join("")}</ul></div>`
      : "";

  // Structured lists
  const hasAiStructure =
    enr &&
    (String(enr.postingSummary || "").trim().length > 0 ||
      (Array.isArray(enr.mustHaves) && enr.mustHaves.length > 0));
  const listSec = (label, items, cls) => {
    const arr = Array.isArray(items)
      ? items.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (!arr.length) return "";
    return `<div class="posting-struct ${cls || ""}"><span class="posting-snippet-label">${host().escapeHtml(label)}</span><ul class="posting-req-list">${arr
      .slice(0, 12)
      .map(
        (r) =>
          `<li>${host().escapeHtml(r.length > 500 ? r.slice(0, 500) + "…" : r)}</li>`,
      )
      .join("")}</ul></div>`;
  };
  const structHtml =
    enr && hasAiStructure
      ? [
          listSec(
            "Responsibilities",
            enr.responsibilities,
            "posting-struct--resp",
          ),
          listSec("Nice-to-haves", enr.niceToHaves, "posting-struct--nice"),
          listSec("Tools & stack", enr.toolsAndStack, "posting-struct--tools"),
        ].join("")
      : "";

  // Enrichment loading skeleton (shown while auto-fetch is in flight)
  // _d() injects staggered animation-delay so bones shimmer in a cascade
  const _d = (ms) => `style="animation-delay:${ms}ms"`;
  const enrichmentSkeleton = `<div class="drawer-enrichment-skeleton" aria-busy="true" aria-label="Loading AI insights">

    <div class="enr-skel-card">
      <div class="enr-skel-card__head">
        <div class="enr-skel-bone enr-skel-card__arrow" ${_d(0)}></div>
        <div class="enr-skel-bone enr-skel-card__title" ${_d(40)}></div>
      </div>
      <div class="enr-skel-card__body">

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w92" ${_d(80)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w65" ${_d(120)}></div>
        </div>

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-section__label" ${_d(160)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w100" ${_d(200)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w92"  ${_d(240)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w83"  ${_d(280)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w56"  ${_d(320)}></div>
        </div>

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-section__label" ${_d(360)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w83" ${_d(400)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w65" ${_d(440)}></div>
        </div>

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-section__label" ${_d(480)}></div>
          <div class="enr-skel-chips">
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--sm" ${_d(520)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--md" ${_d(550)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--xs" ${_d(580)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--lg" ${_d(610)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--sm" ${_d(640)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--xs" ${_d(670)}></div>
          </div>
        </div>

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-section__label" ${_d(700)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w92" ${_d(730)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w74" ${_d(760)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w83" ${_d(790)}></div>
        </div>

      </div>
    </div>

    <div class="enr-skel-tp">
      <div class="enr-skel-bone enr-skel-tp__label" ${_d(820)}></div>
      <div class="enr-skel-tp__item">
        <div class="enr-skel-bone enr-skel-tp__bullet" ${_d(850)}></div>
        <div class="enr-skel-bone enr-skel-tp__text enr-skel-line--w83" ${_d(850)}></div>
      </div>
      <div class="enr-skel-tp__item">
        <div class="enr-skel-bone enr-skel-tp__bullet" ${_d(880)}></div>
        <div class="enr-skel-bone enr-skel-tp__text enr-skel-line--w92" ${_d(880)}></div>
      </div>
      <div class="enr-skel-tp__item">
        <div class="enr-skel-bone enr-skel-tp__bullet" ${_d(910)}></div>
        <div class="enr-skel-bone enr-skel-tp__text enr-skel-line--w65" ${_d(910)}></div>
      </div>
      <div class="enr-skel-tp__item">
        <div class="enr-skel-bone enr-skel-tp__bullet" ${_d(940)}></div>
        <div class="enr-skel-bone enr-skel-tp__text enr-skel-line--w74" ${_d(940)}></div>
      </div>
    </div>

  </div>`;

  const llmWarn =
    enr && enr.llmError
      ? `<p class="posting-llm-warn">${host().escapeHtml(enr.llmError)}</p>`
      : "";

  // ── Right column: compact property panel ──
  const normalized = (job.status || "").trim().toLowerCase();

  const followUpVal = job.followUpDate || "";
  const followUpIsOverdue = followUpVal && new Date(followUpVal) < new Date();

  const respSel = host().selectedResponseSheetValue(job);

  const stageOptions = STAGE_ORDER.map((s) => {
    const sel = s.toLowerCase() === normalized || (!normalized && s === "New");
    return `<option value="${host().escapeHtml(s)}"${sel ? " selected" : ""}>${host().escapeHtml(s)}</option>`;
  }).join("");

  const propsHtml = host().isSignedIn()
    ? `<div class="drawer-props">
    <div class="drawer-prop">
      <svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      <span class="drawer-prop__key">Stage</span>
      <select class="drawer-prop__val status-select" data-action="status-select" data-index="${dataIndex}">${stageOptions}</select>
    </div>
    <div class="drawer-prop">
      <svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="drawer-prop__key">Follow-up</span>
      <input type="date" class="drawer-prop__val followup-input" data-action="followup" data-index="${dataIndex}" value="${host().escapeHtml(followUpVal)}" />
      ${followUpIsOverdue ? '<span class="overdue-badge">overdue</span>' : ""}
    </div>
    <div class="drawer-prop">
      <svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span class="drawer-prop__key">Last contact</span>
      <input type="text" class="drawer-prop__val last-heard-input" data-action="last-heard" data-index="${dataIndex}" value="${host().escapeHtml(job.lastHeardFrom || "")}" placeholder="e.g. Jan 12" autocomplete="off" />
    </div>
    <div class="drawer-prop">
      <svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="drawer-prop__key">Reply</span>
      <select class="drawer-prop__val response-select" data-action="response-flag" data-index="${dataIndex}">
        <option value="">Not set</option>
        <option value="Yes"${respSel === "Yes" ? " selected" : ""}>Yes</option>
        <option value="No"${respSel === "No" ? " selected" : ""}>No</option>
        <option value="Unknown"${respSel === "Unknown" ? " selected" : ""}>Not sure</option>
      </select>
    </div>
    ${job.appliedDate ? `<div class="drawer-prop"><svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg><span class="drawer-prop__key">Applied</span><span class="drawer-prop__val drawer-prop__val--static">${host().escapeHtml(job.appliedDate)}</span></div>` : ""}
  </div>`
    : "";

  // Assemble
  const aboutHasContent = aiHtml || fitHtml || tagsHtml || mustHtml || srcHtml;
  const aboutSection = aboutHasContent
    ? `<details class="drawer-about" open><summary class="drawer-about__toggle">About this role</summary><div class="drawer-about__body">${hookHtml}${ctxHtml}${aiHtml}${fitHtml}${tagsHtml}${mustHtml}${srcHtml}</div></details>`
    : `${hookHtml}${ctxHtml}`;

  // While enrichment is in-flight and no cached data exists yet, show only the
  // skeleton — suppress talking points and structured sections so nothing
  // appears before LLM data is ready.
  const mainColContent =
    job._enrichmentLoading && !enr
      ? enrichmentSkeleton
      : `${aboutSection}${tpHtml}${structHtml}${llmWarn}`;

  return `<div class="drawer-content">
    ${stepperHtml}
    ${profileMatchBadgeHtml}
    <div class="drawer-columns">
      <div class="drawer-col drawer-col--main">
        ${mainColContent}
      </div>
      <div class="drawer-col drawer-col--props">
        ${propsHtml}
        <div class="drawer-inputs">
          ${notesHtml}
        </div>
        ${draftLibraryHtml}
      </div>
    </div>
  </div>`;
}

function openJobDetail(stableKey) {
  closeJobDetail();
  const job = core().getPipelineData()[stableKey];
  if (!job) return;
  core().setActiveDetailKey(stableKey);
  host().markJobViewed(stableKey);

  const overlay = document.createElement("div");
  overlay.className = "detail-overlay";
  overlay.id = "detailOverlay";
  const drawerActionsHtml = (() => {
    const coverBtn =
      stableKey >= 0
        ? `<button type="button" class="drawer-btn drawer-btn--cover" data-action="resume-cover" data-index="${stableKey}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Cover letter
        </button>`
        : "";
    const tailorBtn =
      stableKey >= 0
        ? `<button type="button" class="drawer-btn drawer-btn--tailor" data-action="resume-tailor" data-index="${stableKey}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Tailor resume
        </button>`
        : "";
    const viewBtn = host().safeHref(job.link)
      ? `<a href="${host().escapeHtml(host().safeHref(job.link))}" target="_blank" rel="noopener" class="drawer-btn drawer-btn--view">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          View posting
        </a>`
      : "";
    if (!viewBtn && !coverBtn && !tailorBtn) return "";
    return `<div class="detail-drawer__actions">${coverBtn}${tailorBtn}${viewBtn}</div>`;
  })();

  overlay.innerHTML = `
    <button class="detail-overlay__backdrop" data-action="close-detail" aria-label="Close detail panel"></button>
    <aside class="detail-drawer" role="complementary" aria-label="${host().escapeHtml(job.title || "Job detail")}">
      <div class="detail-drawer__head">
        ${companyLogo().renderLogoHtml(job, "drawer")}
        <div class="detail-drawer__head-main">
          <h2 class="detail-drawer__head-title">${host().escapeHtml(job.title || "Job detail")}</h2>
          ${
            job.company
              ? `<p class="detail-drawer__head-company">${host().escapeHtml(job.company)}</p>`
              : ""
          }
          ${renderRoleFactsHtml(job, "drawer")}
        </div>
        <button type="button" class="detail-drawer__close" data-action="close-detail" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${drawerActionsHtml}
      <div class="detail-drawer__body">
        ${renderDrawerContent(job, stableKey)}
      </div>
    </aside>`;

  document.body.appendChild(overlay);
  document.body.classList.add("detail-open");

  attachCardListeners();

  overlay.querySelectorAll('[data-action="close-detail"]').forEach((el) => {
    el.addEventListener("click", closeJobDetail);
  });
  document.addEventListener("keydown", handleDetailEscape);

  // Auto-fetch enrichment only when the scraper is configured and the job hasn't been scraped yet.
  // Guard against host().getJobPostingScrapeUrl() returning null to avoid a noisy toast on every open.
  if (
    job.link &&
    !postingEnrichment().isUsableCachedEnrichment(job._postingEnrichment) &&
    host().getJobPostingScrapeUrl()
  ) {
    host().fetchJobPostingEnrichment(stableKey).catch(() => {});
  }
}

function closeJobDetail() {
  const overlay = document.getElementById("detailOverlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", handleDetailEscape);
  document.body.classList.remove("detail-open");
  core().setActiveDetailKey(-1);
}

function refreshDrawerIfOpen(dataIndex) {
  const overlay = document.getElementById("detailOverlay");
  if (!overlay || core().getActiveDetailKey() !== dataIndex) return;
  const job = core().getPipelineData()[dataIndex];
  if (!job) return;
  const body = overlay.querySelector(".detail-drawer__body");
  if (!body) return;

  // Capture scroll position so re-render doesn't jump
  const drawer = overlay.querySelector(".detail-drawer");
  const scrollTop = drawer ? drawer.scrollTop : 0;

  body.innerHTML = renderDrawerContent(job, dataIndex);

  attachCardListeners();

  // Re-wire close buttons that are inside the body (backdrop/head close are already wired)
  overlay.querySelectorAll('[data-action="close-detail"]').forEach((el) => {
    el.addEventListener("click", closeJobDetail);
  });

  if (drawer) drawer.scrollTop = scrollTop;
}

function updateTrackIndicator(track) {
  const cssKey = track.id.replace("track-", "");
  const thumb = document.getElementById(`thumb-${cssKey}`);
  const bar = thumb ? thumb.parentElement : null;
  if (!thumb || !bar) return;
  const { scrollLeft, scrollWidth, clientWidth } = track;
  if (scrollWidth <= clientWidth + 2) {
    bar.style.visibility = "hidden";
    return;
  }
  bar.style.visibility = "";
  const ratio = clientWidth / scrollWidth;
  const pos = scrollLeft / (scrollWidth - clientWidth);
  thumb.style.width = `${ratio * 100}%`;
  thumb.style.left = `${pos * (100 - ratio * 100)}%`;
}

function updateNavVisibility(track) {
  const lane = track.closest(".stage-lane");
  if (!lane) return;
  const { scrollLeft, scrollWidth, clientWidth } = track;
  const noScroll = scrollWidth <= clientWidth + 2;
  const atStart = scrollLeft < 2;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - 2;
  const prev = lane.querySelector(
    '[data-action="scroll-stage"][data-dir="prev"]',
  );
  const next = lane.querySelector(
    '[data-action="scroll-stage"][data-dir="next"]',
  );
  if (prev) prev.disabled = atStart || noScroll;
  if (next) next.disabled = atEnd || noScroll;
}

function attachBoardListeners() {
  // Stage collapse toggle + indicator init on expand
  document.querySelectorAll('[data-action="toggle-stage"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const stage = btn.dataset.stage;
      const lane = btn.closest(".stage-lane");
      if (!lane) return;
      const nowExpanded = lane.classList.toggle("stage-lane--expanded");
      if (nowExpanded) {
        core().getExpandedStages().add(stage);
        const track = document.getElementById(`track-${stageToCssKey(stage)}`);
        if (track) {
          updateTrackIndicator(track);
          updateNavVisibility(track);
        }
      } else {
        core().getExpandedStages().delete(stage);
      }
    });
  });

  // Horizontal chevron navigation
  document.querySelectorAll('[data-action="scroll-stage"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      // Board scroll buttons (inside a stage-lane with data-stage)
      if (btn.dataset.stage) {
        const track = document.getElementById(
          `track-${stageToCssKey(btn.dataset.stage)}`,
        );
        if (!track) return;
        const card = track.querySelector(".kanban-card");
        const step = card ? card.offsetWidth + 12 : 228;
        track.scrollBy({
          left: btn.dataset.dir === "next" ? step : -step,
          behavior: "smooth",
        });
        return;
      }
      // Drawer stepper chevrons (inside stage-stepper-wrap)
      const stepper = btn.closest(".stage-stepper-wrap");
      if (stepper) {
        const inner = stepper.querySelector(".stage-stepper");
        if (inner)
          inner.scrollBy({
            left: parseInt(btn.dataset.dir, 10) * 80,
            behavior: "smooth",
          });
      }
    });
  });

  // Scroll indicator + nav state on scroll
  document.querySelectorAll(".stage-lane__track").forEach((track) => {
    updateTrackIndicator(track);
    updateNavVisibility(track);
    track.addEventListener(
      "scroll",
      () => {
        updateTrackIndicator(track);
        updateNavVisibility(track);
      },
      { passive: true },
    );
  });

  // Detail drawer — click or keyboard Enter/Space on the card
  document.querySelectorAll('[data-action="open-detail"]').forEach((el) => {
    el.addEventListener("click", () => {
      const key = parseInt(el.dataset.stableKey, 10);
      if (!Number.isNaN(key)) openJobDetail(key);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const key = parseInt(el.dataset.stableKey, 10);
        if (!Number.isNaN(key)) openJobDetail(key);
      }
    });
  });

  // Card action buttons (favorite / dismiss / restore) — stop propagation
  // so clicks don't bubble into the card's open-detail handler.
  document
    .querySelectorAll('[data-action="toggle-favorite"]')
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = parseInt(btn.dataset.key, 10);
        if (!Number.isNaN(key)) host().toggleFavorite(key);
      });
    });
  document.querySelectorAll('[data-action="dismiss"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = parseInt(btn.dataset.key, 10);
      if (!Number.isNaN(key)) host().dismissJob(key);
    });
  });
  document.querySelectorAll('[data-action="restore"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = parseInt(btn.dataset.key, 10);
      if (!Number.isNaN(key)) host().restoreJob(key);
    });
  });
}

// ---- Board filtering & sort (pure functions) ----

/**
 * Filter jobs by search term and sort by the specified mode.
 * Returns a new array; does not mutate the input.
 *
 * @param {Array} jobs - Array of pipeline job objects
 * @param {string} search - Search query (empty string means no filtering)
 * @param {string} sort - Sort mode: "fit" | "date" | "company" | "priority"
 * @returns {Array} - New filtered and sorted array
 */
function filterAndSortJobs(jobs, search, sort) {
  let data = [...jobs];

  if (!core().getShowDismissed()) data = data.filter((j) => !j.dismissedAt);
  if (core().getFavoritesOnly()) data = data.filter((j) => j.favorite);

  if (search) {
    const q = search.toLowerCase();
    data = data.filter((r) => {
      return [
        r.title,
        r.company,
        r.tags,
        r.location,
        r.source,
        r.notes,
        r.lastHeardFrom,
        r.responseFlag,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }

  switch (sort) {
    case "fit":
      data.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));
      break;
    case "date":
      data.sort((a, b) => {
        const da = a.dateFound ? a.dateFound.getTime() : 0;
        const db = b.dateFound ? b.dateFound.getTime() : 0;
        return db - da;
      });
      break;
    case "company":
      data.sort((a, b) => (a.company || "").localeCompare(b.company || ""));
      break;
    case "priority": {
      const priorityOrder = { "🔥": 0, "⚡": 1, "—": 2, "↓": 3 };
      data.sort(
        (a, b) =>
          (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2),
      );
      break;
    }
  }

  return data;
}

function renderPipeline() {
  const container = document.getElementById("jobCards");
  const emptyState = document.getElementById("emptyState");
  const roleCountEl = document.getElementById("roleCount");

  // Board view: apply only search+sort, stages shown as collapsible lanes
  const data = filterAndSortJobs(
    core().getPipelineData(),
    core().getCurrentSearch(),
    core().getCurrentSort(),
  );
  expiredReview().renderExpiredReviewButton();

  roleCountEl.textContent = `${data.length} of ${core().getPipelineData().length}`;

  if (data.length === 0 && !core().getDataLoadFailed()) {
    container.innerHTML = "";
    emptyState.style.display = "block";
    const emptyTitle =
      document.getElementById("emptyStateTitle") ||
      emptyState.querySelector("h3");
    const emptyP =
      document.getElementById("emptyStateBody") ||
      emptyState.querySelector("p");
    const emptyActions = document.getElementById("emptyStateActions");
    if (emptyTitle && emptyP) {
      if (core().getPipelineData().length === 0) {
        emptyTitle.textContent = "Your pipeline is empty";
        emptyP.textContent =
          "Paste a job URL above, or click Add manually, and your roles will land here.";
        if (emptyActions) {
          emptyActions.innerHTML = "";
          emptyActions.style.display = "none";
          emptyActions.setAttribute("aria-hidden", "true");
        }
      } else {
        emptyTitle.textContent = "No roles match";
        emptyP.textContent = "Clear the search box or try a different term.";
        if (emptyActions) {
          emptyActions.innerHTML = "";
          emptyActions.style.display = "none";
          emptyActions.setAttribute("aria-hidden", "true");
        }
      }
    }
    return;
  }

  emptyState.style.display = "none";
  if (data.length === 0) return;

  container.innerHTML = renderPipelineBoard(data);
  attachBoardListeners();
  host().notifyPipelineRendered();
}

function renderCardActions(job, indexForNotesId) {
  const dataIndex = core().getPipelineData().indexOf(job);

  if (!host().isSignedIn()) {
    return `
      <div class="card-actions card-actions--anon">
        <button type="button" class="btn-google-signin btn-google-signin--card" data-action="signin">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          <span>Continue with Google</span>
        </button>
      </div>
    `;
  }

  const statuses = [
    "New",
    "Researching",
    "Applied",
    "Phone Screen",
    "Interviewing",
    "Offer",
    "Rejected",
    "Passed",
    "Expired",
  ];
  const normalized = (job.status || "").trim().toLowerCase();
  const hasStatusMatch = statuses.some((s) => s.toLowerCase() === normalized);

  const options = statuses
    .map((s) => {
      const isSel =
        (hasStatusMatch && s.toLowerCase() === normalized) ||
        (!hasStatusMatch && s === "New");
      return `<option value="${host().escapeHtml(s)}"${isSel ? " selected" : ""}>${host().escapeHtml(s)}</option>`;
    })
    .join("");

  const appliedDateHtml = job.appliedDate
    ? `
    <div class="action-meta">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      <span>Applied ${host().escapeHtml(job.appliedDate)}</span>
    </div>
  `
    : "";

  const followUpVal = job.followUpDate || "";
  const followUpIsOverdue = followUpVal && new Date(followUpVal) < new Date();
  const followUpHtml = `
    <div class="action-meta ${followUpIsOverdue ? "overdue" : ""}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <label class="followup-label" for="followup-${indexForNotesId}">Follow-up</label>
      <input type="date" id="followup-${indexForNotesId}" class="followup-input" data-action="followup" data-index="${dataIndex}" value="${host().escapeHtml(followUpVal)}" />
      ${followUpIsOverdue ? '<span class="overdue-badge">overdue</span>' : ""}
    </div>
  `;

  const respSel = host().selectedResponseSheetValue(job);
  const contactStatusHtml = `
    <div class="contact-status-row">
      <div class="contact-status-field">
        <label class="field-label" for="last-heard-${indexForNotesId}">Last contact</label>
        <input type="text" id="last-heard-${indexForNotesId}" class="last-heard-input" data-action="last-heard" data-index="${dataIndex}" value="${host().escapeHtml(job.lastHeardFrom || "")}" placeholder="e.g. Jan 12 or &ldquo;recruiter emailed&rdquo;" autocomplete="off" />
      </div>
      <div class="contact-status-field">
        <label class="field-label" for="response-${indexForNotesId}">Did they reply?</label>
        <select id="response-${indexForNotesId}" class="response-select" data-action="response-flag" data-index="${dataIndex}">
          <option value="">Not set</option>
          <option value="Yes"${respSel === "Yes" ? " selected" : ""}>Yes</option>
          <option value="No"${respSel === "No" ? " selected" : ""}>No</option>
          <option value="Unknown"${respSel === "Unknown" ? " selected" : ""}>Not sure</option>
        </select>
      </div>
    </div>
  `;

  return `
    <div class="card-actions">
      <div class="status-field">
        <label class="field-label" for="status-${dataIndex}-${indexForNotesId}">Pipeline stage</label>
        <select id="status-${dataIndex}-${indexForNotesId}" class="status-select" data-action="status-select" data-index="${dataIndex}">
          ${options}
        </select>
      </div>
      <div class="card-actions__tools">
        ${appliedDateHtml}
        ${followUpHtml}
      </div>
      ${contactStatusHtml}
      <div class="notes-wrapper">
        <label class="notes-label" for="notes-${dataIndex}-${indexForNotesId}">Notes</label>
        <textarea id="notes-${dataIndex}-${indexForNotesId}" class="notes-textarea" data-action="notes" data-index="${dataIndex}" placeholder="Interview prep, recruiter name, next step…">${host().escapeHtml(job.notes || "")}</textarea>
      </div>
    </div>
  `;
}

function attachCardListeners() {
  // Extra tags "+N"
  document.querySelectorAll('[data-action="toggle-tags"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest("[data-tags-wrap]");
      if (!wrap) return;
      const on = wrap.classList.toggle("card-tags--expanded");
      btn.setAttribute("aria-expanded", on ? "true" : "false");
    });
  });

  // Pipeline stage select
  document.querySelectorAll('[data-action="status-select"]').forEach((sel) => {
    sel.addEventListener("change", async () => {
      const dataIndex = parseInt(sel.dataset.index, 10);
      const newStatus = sel.value;
      sel.disabled = true;
      const ok = await host().updateJobStatus(dataIndex, newStatus);
      if (ok) {
        refreshDrawerIfOpen(dataIndex);
      }
      sel.disabled = false;
    });
  });
  // Stage stepper clicks (drawer)
  document.querySelectorAll('[data-action="stage-step"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const dataIndex = parseInt(btn.dataset.index, 10);
      const newStage = btn.dataset.stage;
      btn.disabled = true;
      const ok = await host().updateJobStatus(dataIndex, newStage);
      if (ok) {
        refreshDrawerIfOpen(dataIndex);
        renderPipeline();
      }
      btn.disabled = false;
    });
  });

  // Profile match modal
  document
    .querySelectorAll('[data-action="open-profile-match"]')
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        if (!Number.isNaN(idx) && core().getPipelineData()[idx]) {
          keywordMatch().openProfileMatchModal(core().getPipelineData()[idx], idx);
        }
      });
    });

  // Notes blur saves
  document.querySelectorAll('[data-action="notes"]').forEach((textarea) => {
    let originalValue = textarea.value;

    textarea.addEventListener("focus", () => {
      originalValue = textarea.value;
    });

    textarea.addEventListener("blur", async () => {
      const newValue = textarea.value.trim();
      if (newValue === originalValue.trim()) return; // No change

      const dataIndex = parseInt(textarea.dataset.index, 10);
      textarea.classList.add("saving");
      await host().updateJobNotes(dataIndex, newValue);
      textarea.classList.remove("saving");
      originalValue = newValue;
    });
  });

  // Follow-up date changes
  document.querySelectorAll('[data-action="followup"]').forEach((input) => {
    input.addEventListener("change", async () => {
      const dataIndex = parseInt(input.dataset.index, 10);
      await host().updateFollowUpDate(dataIndex, input.value);
    });
  });

  // Last contact (column R)
  document.querySelectorAll('[data-action="last-heard"]').forEach((input) => {
    let originalValue = input.value;
    input.addEventListener("focus", () => {
      originalValue = input.value;
    });
    input.addEventListener("blur", async () => {
      const newValue = input.value.trim();
      if (newValue === originalValue.trim()) return;
      const dataIndex = parseInt(input.dataset.index, 10);
      input.classList.add("saving");
      await host().updateLastHeardFrom(dataIndex, newValue);
      input.classList.remove("saving");
      originalValue = newValue;
    });
  });

  // Did they reply? (column S)
  document.querySelectorAll('[data-action="response-flag"]').forEach((sel) => {
    sel.addEventListener("change", async () => {
      const dataIndex = parseInt(sel.dataset.index, 10);
      sel.disabled = true;
      await host().updateJobResponseFlag(dataIndex, sel.value);
      sel.disabled = false;
    });
  });

  // Sign-in prompt clicks
  document.querySelectorAll('[data-action="signin"]').forEach((el) => {
    el.addEventListener("click", () => host().signIn());
  });

  document.querySelectorAll('[data-action="resume-cover"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const dataIndex = parseInt(btn.dataset.index, 10);
      if (!Number.isNaN(dataIndex))
        resumeGeneration().openDraftNotesModal(dataIndex, "cover_letter");
    });
  });

  document.querySelectorAll('[data-action="resume-tailor"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const dataIndex = parseInt(btn.dataset.index, 10);
      if (!Number.isNaN(dataIndex))
        resumeGeneration().openDraftNotesModal(dataIndex, "resume_update");
    });
  });

  document
    .querySelectorAll('[data-action="open-draft-version"]')
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const draftId = btn.dataset.draftId;
        if (draftId) void resumeGeneration().openSavedDraftVersion(draftId);
      });
    });

  document.querySelectorAll('[data-action="draft-tab"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const feature = btn.dataset.feature;
      const deck = btn.closest(".draft-deck");
      if (!deck) return;
      deck
        .querySelectorAll(".draft-deck__tab")
        .forEach((t) =>
          t.classList.toggle(
            "draft-deck__tab--active",
            t.dataset.feature === feature,
          ),
        );
      deck
        .querySelectorAll(".draft-deck__panel")
        .forEach((p) =>
          p.classList.toggle(
            "draft-deck__panel--active",
            p.dataset.feature === feature,
          ),
        );
      const activePanel = deck.querySelector(
        `.draft-deck__panel[data-feature="${feature}"]`,
      );
      const activeStack = activePanel?.querySelector(".draft-deck__stack");
      if (activePanel && activeStack) {
        updateDraftDeckState(
          activePanel,
          parseInt(activeStack.dataset.activeIdx || "0", 10),
        );
      }
    });
  });

  const updateDraftDeckState = (panel, targetIdx) => {
    if (!panel) return;
    const stack = panel.querySelector(".draft-deck__stack");
    if (!stack) return;
    const total = parseInt(stack.dataset.total || "0", 10);
    if (!total) return;
    const bounded = Math.max(0, Math.min(total - 1, targetIdx));
    stack.dataset.activeIdx = String(bounded);
    stack.querySelectorAll(".draft-deck__card").forEach((card) => {
      const rel = bounded - parseInt(card.dataset.deckIdx, 10);
      card.className = "draft-deck__card";
      if (rel === 0) {
        card.classList.add("draft-deck__card--front");
        card.tabIndex = 0;
      } else if (rel === 1) {
        card.classList.add("draft-deck__card--back-1");
        card.tabIndex = -1;
      } else if (rel === 2) {
        card.classList.add("draft-deck__card--back-2");
        card.tabIndex = -1;
      } else {
        card.classList.add("draft-deck__card--hidden");
        card.tabIndex = -1;
      }
    });
    const pos = panel.querySelector('[data-role="draft-position"]');
    if (pos) pos.textContent = `V${bounded + 1} of ${total}`;
    const prevBtn = panel.querySelector(
      '[data-action="draft-deck-shift"][data-dir="-1"]',
    );
    const nextBtn = panel.querySelector(
      '[data-action="draft-deck-shift"][data-dir="1"]',
    );
    if (prevBtn) prevBtn.disabled = bounded <= 0;
    if (nextBtn) nextBtn.disabled = bounded >= total - 1;
  };

  document
    .querySelectorAll('[data-action="draft-deck-shift"]')
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = btn.closest(".draft-deck__panel");
        if (!panel) return;
        const stack = panel.querySelector(".draft-deck__stack");
        if (!stack) return;
        const currentIdx = parseInt(stack.dataset.activeIdx || "0", 10);
        const dir = parseInt(btn.dataset.dir || "0", 10);
        if (!dir) return;
        updateDraftDeckState(panel, currentIdx + dir);
      });
    });

  document.querySelectorAll(".draft-deck__panel").forEach((panel) => {
    const stack = panel.querySelector(".draft-deck__stack");
    if (!stack) return;
    updateDraftDeckState(panel, parseInt(stack.dataset.activeIdx || "0", 10));
  });
}
  Object.assign(pipelineRender, {
    renderAll,
    renderStats,
    animateNumber,
    normalizeStatusStr,
    isInboxJob,
    stageToCssKey,
    renderRoleFactsHtml,
    groupByStage,
    renderKanbanCard,
    applyLegacyKanbanCap,
    renderLegacyKanbanHiddenAffordance,
    renderStageLane,
    renderPipelineBoard,
    handleDetailEscape,
    renderStageStepper,
    renderDrawerContent,
    openJobDetail,
    closeJobDetail,
    refreshDrawerIfOpen,
    updateTrackIndicator,
    updateNavVisibility,
    attachBoardListeners,
    filterAndSortJobs,
    renderPipeline,
    renderCardActions,
    attachCardListeners,
  });
})();
