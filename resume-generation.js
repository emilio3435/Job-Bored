/* ============================================
   COMMAND CENTER v2 — Resume / Draft Generation
   Extracted from app.js (resume-generation cut).

   Classic-global IIFE under window.JobBoredApp.resumeGeneration — NOT an ES module.
   Loaded AFTER ats-scorecard.js, BEFORE app.js. Reads app.js helpers via lazy core.host.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const resumeGeneration = root.resumeGeneration || (root.resumeGeneration = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function core() {
    return window.JobBoredApp.core;
  }

  function materialsState() {
    return window.JobBoredApp.materialsState;
  }

  function ats() {
    return window.JobBoredApp.ats;
  }

  function escapeHtml(...args) {
    return host().escapeHtml(...args);
  }

  function getPipelineData() {
    return host().getPipelineData();
  }

  function getDraftsForJob(job, feature) {
    return materialsState().getDraftsForJob(job, feature);
  }

  let lastResumeGenerationSession = null;
  let pendingDraftNotesRequest = null;
  let resumeGenerateAtsRefreshTimer = null;

  function getLastResumeGenerationSession() {
    return lastResumeGenerationSession;
  }

  function setLastResumeGenerationSession(value) {
    lastResumeGenerationSession = value;
  }

function renderDraftDeckPanel(job, feature) {
  if (!materialsState().getGeneratedDraftLibraryCache().loaded) {
    return `<p class="draft-deck__empty">…</p>`;
  }
  const drafts = materialsState().getDraftsForJob(job, feature)
    .slice()
    .sort(
      (a, b) => Number(a.versionNumber || 0) - Number(b.versionNumber || 0),
    );
  if (!drafts.length) {
    return `<p class="draft-deck__empty">None yet — generate using the buttons above</p>`;
  }
  const activeIdx = drafts.length - 1; // newest version on top
  const cards = drafts
    .map((d, i) => {
      const rel = activeIdx - i; // 0=front, 1=back-1, 2=back-2, >2=hidden
      const depthClass =
        rel === 0
          ? "draft-deck__card--front"
          : rel === 1
            ? "draft-deck__card--back-1"
            : rel === 2
              ? "draft-deck__card--back-2"
              : "draft-deck__card--hidden";
      const vLabel = `V${Number(d.versionNumber || 0)}`;
      const modeLabel = d.mode === "refine" ? "Refined" : "Initial";
      const excerpt = (d.excerpt || "").slice(0, 110);
      return `<button type="button"
        class="draft-deck__card ${depthClass}"
        data-action="open-draft-version"
        data-draft-id="${escapeHtml(d.id)}"
        data-deck-idx="${i}"
        tabindex="${rel === 0 ? 0 : -1}">
        <span class="draft-deck__card-meta">${escapeHtml(vLabel)} · ${escapeHtml(modeLabel)}</span>
        <span class="draft-deck__card-date">${escapeHtml(materialsState().formatDraftSavedAt(d.createdAt))}</span>
        <p class="draft-deck__card-excerpt">${escapeHtml(excerpt)}${(d.excerpt || "").length > 110 ? "…" : ""}</p>
      </button>`;
    })
    .join("");
  const nav =
    drafts.length > 1
      ? `<div class="draft-deck__nav">
          <button type="button" class="draft-deck__chevron" data-action="draft-deck-shift" data-dir="-1" aria-label="Previous version" title="Previous version">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="draft-deck__position" data-role="draft-position">V${activeIdx + 1} of ${drafts.length}</span>
          <button type="button" class="draft-deck__chevron" data-action="draft-deck-shift" data-dir="1" aria-label="Next version" title="Next version">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>`
      : "";
  return `<div class="draft-deck__stack" data-active-idx="${activeIdx}" data-total="${drafts.length}">${cards}</div>${nav}`;
}

function renderDraftLibraryCardHtml(job, dataIndex) {
  const clDrafts = materialsState().getGeneratedDraftLibraryCache().loaded
    ? materialsState().getDraftsForJob(job, "cover_letter")
    : [];
  const reDrafts = materialsState().getGeneratedDraftLibraryCache().loaded
    ? materialsState().getDraftsForJob(job, "resume_update")
    : [];
  const clCount = clDrafts.length;
  const reCount = reDrafts.length;
  const total = clCount + reCount;
  const countBadge =
    materialsState().getGeneratedDraftLibraryCache().loaded && total
      ? `<span class="draft-deck__count">${total}</span>`
      : "";
  return `<section class="draft-deck" data-index="${dataIndex}">
    <div class="draft-deck__head">
      <p class="draft-deck__kicker">Draft studio</p>
      ${countBadge}
    </div>
    <div class="draft-deck__tabs">
      <button type="button" class="draft-deck__tab draft-deck__tab--active" data-action="draft-tab" data-feature="cover_letter">
        Cover letter${clCount ? `<span class="draft-deck__tab-badge">${clCount}</span>` : ""}
      </button>
      <button type="button" class="draft-deck__tab" data-action="draft-tab" data-feature="resume_update">
        Resume${reCount ? `<span class="draft-deck__tab-badge">${reCount}</span>` : ""}
      </button>
    </div>
    <div class="draft-deck__panels">
      <div class="draft-deck__panel draft-deck__panel--active" data-feature="cover_letter">
        ${renderDraftDeckPanel(job, "cover_letter")}
      </div>
      <div class="draft-deck__panel" data-feature="resume_update">
        ${renderDraftDeckPanel(job, "resume_update")}
      </div>
    </div>
  </section>`;
}

async function resolveVisualThemeIdForModal() {
  const VT = window.CommandCenterVisualThemes;
  const fallback =
    VT && typeof VT.getDefaultVisualThemeId === "function"
      ? VT.getDefaultVisualThemeId()
      : "classic";
  try {
    const UC = materialsState().getUserContent();
    if (!UC) return fallback;
    await UC.openDb();
    const prefs = await UC.getPreferences();
    const raw = prefs.visualThemeId || fallback;
    return VT && typeof VT.resolveVisualTheme === "function"
      ? VT.resolveVisualTheme(raw).id
      : raw;
  } catch (_) {
    return fallback;
  }
}

function formatCoverLetterPreviewHtml(text) {
  if (!text || !String(text).trim()) return "";
  return String(text)
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block) => {
      const escaped = escapeHtml(block);
      const withBreaks = escaped.replace(/\n/g, "<br />");
      return `<p class="doc-preview__p">${withBreaks}</p>`;
    })
    .join("");
}

/** Plain text → safe HTML for resume preview (section headers + lines). */
function formatResumePreviewHtml(text) {
  if (!text || !String(text).trim()) return "";
  const lines = String(text).split("\n");
  const parts = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      parts.push('<div class="doc-preview__gap" aria-hidden="true"></div>');
      continue;
    }
    const esc = escapeHtml(line);
    const upper = t.toUpperCase();
    const isSection =
      t.length >= 3 &&
      t.length <= 56 &&
      t === upper &&
      /^[A-Z0-9\s&/\-–—:,.]+$/.test(t) &&
      !/\d{4}\s*[-–]\s*\d{4}/.test(t);
    if (isSection) {
      parts.push(`<h2 class="doc-preview__section">${esc}</h2>`);
    } else {
      parts.push(`<p class="doc-preview__resume-line">${esc}</p>`);
    }
  }
  return parts.join("");
}

function formatContextDateLabel(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString();
}

function buildGenerationContextUsed(profile) {
  if (!profile || typeof profile !== "object") return null;
  const sourceMeta =
    profile.sourceMeta && typeof profile.sourceMeta === "object"
      ? profile.sourceMeta
      : {};
  return {
    resume: {
      chars: String(profile.resumeText || "").length,
      updatedAt: sourceMeta.resumeUpdatedAt || "",
    },
    linkedIn: {
      chars: String(profile.linkedinProfileText || "").length,
      updatedAt: sourceMeta.linkedinUpdatedAt || "",
    },
    aiDump: {
      chars: String(profile.additionalContextText || "").length,
      updatedAt: sourceMeta.additionalContextUpdatedAt || "",
    },
  };
}

function renderGenerationContextUsed(el, contextUsed) {
  if (!el) return;
  if (!contextUsed) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const mk = (label, v) =>
    `<span class="doc-output-context__chip"><strong>${escapeHtml(label)}</strong>${Number(v.chars || 0).toLocaleString()} chars · ${escapeHtml(formatContextDateLabel(v.updatedAt || ""))}</span>`;
  el.innerHTML = [
    mk("Resume", contextUsed.resume || {}),
    mk("LinkedIn", contextUsed.linkedIn || {}),
    mk("AI dump", contextUsed.aiDump || {}),
  ].join("");
  el.hidden = false;
}

function getResumeGenerateDraftTextForInsights(fallbackBodyText) {
  const modal = document.getElementById("resumeGenerateModal");
  const ta = document.getElementById("resumeGenerateOutput");
  if (
    modal &&
    modal.style.display === "flex" &&
    ta &&
    modal.getAttribute("aria-busy") !== "true"
  ) {
    const v = String(ta.value || "").trim();
    if (v) return v;
  }
  return String(fallbackBodyText || "").trim();
}

function scheduleResumeGenerateAtsRefresh() {
  if (resumeGenerateAtsRefreshTimer) {
    clearTimeout(resumeGenerateAtsRefreshTimer);
  }
  resumeGenerateAtsRefreshTimer = setTimeout(() => {
    resumeGenerateAtsRefreshTimer = null;
    const ta = document.getElementById("resumeGenerateOutput");
    if (!ta || !lastResumeGenerationSession) return;
    renderResumeGenerateInsights(ta.value, lastResumeGenerationSession.job);
  }, 900);
}

function renderDraftHistoryItemHtml(draft, activeDraftId) {
  const metaBits = [
    `V${Number(draft.versionNumber || 0)}`,
    materialsState().getDraftModeLabel(draft.mode),
    materialsState().formatDraftSavedAt(draft.createdAt),
  ];
  const noteBits = [];
  if (draft.userNotes) noteBits.push("Has job notes");
  if (draft.refinementFeedback) noteBits.push("Includes refinement");
  const isActive = draft.id === activeDraftId;
  return `<button type="button" class="draft-history-item${isActive ? " draft-history-item--active" : ""}" data-action="open-saved-draft" data-draft-id="${escapeHtml(draft.id)}" aria-pressed="${isActive ? "true" : "false"}"><span class="draft-history-item__meta">${metaBits.map((bit) => `<span class="draft-history-item__chip">${escapeHtml(bit)}</span>`).join("")}</span><span class="draft-history-item__preview">${escapeHtml(draft.excerpt || "")}</span>${noteBits.length ? `<span class="draft-history-item__notes">${escapeHtml(noteBits.join(" · "))}</span>` : ""}</button>`;
}

function renderResumeGenerateInsights(bodyText, job) {
  const wrap = document.getElementById("resumeGenerateInsights");
  const atsCard = document.getElementById("resumeGenerateAtsCard");
  const atsScore = document.getElementById("resumeGenerateAtsScore");
  const atsSummary = document.getElementById("resumeGenerateAtsSummary");
  const atsHint = document.getElementById("resumeGenerateAtsHint");
  const atsGroups = document.getElementById("resumeGenerateAtsGroups");
  const historyCard = document.getElementById("resumeGenerateHistoryCard");
  const historyCount = document.getElementById("resumeGenerateHistoryCount");
  const historySummary = document.getElementById(
    "resumeGenerateHistorySummary",
  );
  const historyList = document.getElementById("resumeGenerateHistoryList");
  if (!wrap) return;

  const text = getResumeGenerateDraftTextForInsights(bodyText);
  if (!text) {
    wrap.hidden = true;
    if (atsCard) atsCard.hidden = true;
    if (historyCard) historyCard.hidden = true;
    return;
  }

  const session = lastResumeGenerationSession;
  const feature =
    session && session.feature === "resume_update"
      ? "resume_update"
      : "cover_letter";
  const cacheKey = ats().computeAtsScorecardCacheKey(text, job, feature);
  const atsPayload = cacheKey
    ? ats().buildAtsScorecardRequestPayload(text, job, session)
    : null;
  if (atsCard) {
    if (
      !cacheKey ||
      !atsPayload ||
      !atsPayload.job.title ||
      !atsPayload.job.company
    ) {
      atsCard.hidden = true;
    } else {
      if (materialsState().getAtsScorecardState().cacheKey !== cacheKey) {
        ats().startAtsScorecardAnalysis(cacheKey, atsPayload);
      }
      if (materialsState().getAtsScorecardState().status === "loading") {
        if (atsScore) atsScore.textContent = "…";
        if (atsSummary) {
          atsSummary.textContent =
            "Analyzing this draft against the role with structured LLM scoring…";
        }
        if (atsHint) {
          atsHint.hidden = false;
          atsHint.textContent =
            "Scoring the latest text in the editor after generate or refine finishes.";
        }
        if (atsGroups) atsGroups.innerHTML = "";
      } else if (
        materialsState().getAtsScorecardState().status === "success" &&
        materialsState().getAtsScorecardState().result
      ) {
        const scorecard = materialsState().getAtsScorecardState().result;
        if (atsScore) atsScore.textContent = `${scorecard.overallScore}%`;
        if (atsSummary) {
          const conf = Math.round(Number(scorecard.confidence || 0) * 100);
          atsSummary.textContent = `${ats().formatAtsDimensionSummary(
            scorecard,
          )} · confidence ${conf}% · model ${scorecard.model}`;
        }
        if (atsHint) {
          const topGap = scorecard.criticalGaps && scorecard.criticalGaps[0];
          atsHint.textContent = topGap
            ? `Priority fix: ${ats().sanitizeAtsText(topGap.gap)}`
            : "No critical gaps identified for this draft.";
          atsHint.hidden = false;
        }
        if (atsGroups) {
          atsGroups.innerHTML = ats().renderAtsScorecardGroupsHtml(scorecard);
        }
      } else if (materialsState().getAtsScorecardState().status === "error") {
        if (atsScore) atsScore.textContent = "—";
        if (atsSummary) {
          atsSummary.textContent =
            "Could not analyze this draft with ATS scorecard right now.";
        }
        if (atsHint) {
          atsHint.hidden = false;
          atsHint.textContent = materialsState().getAtsScorecardState().error || "Unknown error";
        }
        if (atsGroups) {
          atsGroups.innerHTML =
            '<button type="button" class="btn-modal-secondary doc-insight-card__retry" data-action="retry-ats-scorecard">Retry analysis</button>';
        }
      }
      atsCard.hidden = false;
    }
  }

  const historyFeature =
    session && session.feature ? session.feature : "cover_letter";
  const historyDrafts = job ? materialsState().getDraftsForJob(job, historyFeature) : [];
  if (historyCard) {
    if (historyDrafts.length) {
      if (historyCount) {
        historyCount.textContent = `${historyDrafts.length} version${historyDrafts.length === 1 ? "" : "s"}`;
      }
      if (historySummary) {
        historySummary.textContent =
          "Every generation and refine is auto-saved to this role. Pick any version to reopen or continue from.";
      }
      if (historyList) {
        historyList.innerHTML = historyDrafts
          .map((draft) =>
            renderDraftHistoryItemHtml(
              draft,
              session ? session.savedDraftId || "" : "",
            ),
          )
          .join("");
      }
      historyCard.hidden = false;
    } else {
      if (historyList) historyList.innerHTML = "";
      historyCard.hidden = true;
    }
  }

  wrap.hidden = !!(
    (!atsCard || atsCard.hidden) &&
    (!historyCard || historyCard.hidden)
  );
}

function syncResumeGenerateFooterState() {
  const modal = document.getElementById("resumeGenerateModal");
  const ta = document.getElementById("resumeGenerateOutput");
  const feedback = document.getElementById("resumeGenerateFeedback");
  const refine = document.getElementById("resumeGenerateRefine");
  const copy = document.getElementById("resumeGenerateCopy");
  const print = document.getElementById("resumeGeneratePrint");
  const busy = modal && modal.getAttribute("aria-busy") === "true";
  const hasBody = !!(ta && String(ta.value || "").trim());
  const canRefine = !!(
    !busy &&
    hasBody &&
    lastResumeGenerationSession &&
    lastResumeGenerationSession.bundle &&
    feedback &&
    String(feedback.value || "").trim()
  );
  if (feedback) feedback.disabled = !!busy || !hasBody;
  if (refine) refine.disabled = !canRefine;
  if (copy) copy.disabled = !!busy || !hasBody;
  if (print) print.disabled = !!busy || !hasBody;
}

function openDraftNotesModal(dataIndex, feature, opts) {
  const modal = document.getElementById("draftNotesModal");
  const title = document.getElementById("draftNotesTitle");
  const target = document.getElementById("draftNotesTarget");
  const input = document.getElementById("draftNotesInput");
  const generate = document.getElementById("draftNotesGenerate");
  const job = getPipelineData()[dataIndex];
  if (!modal || !job) return;
  pendingDraftNotesRequest = { dataIndex, feature };
  if (title) {
    title.textContent =
      feature === "cover_letter"
        ? "Notes for this cover letter"
        : "Notes for this resume";
  }
  if (target) {
    target.textContent = `${job.title || "Role"} · ${job.company || "Company"}`;
  }
  /* Prefill the notes input with an AI-derived starter when available
     (drawer-parity enrichment: fitAngle + top must-haves). The user
     can edit/clear before generating. Callers can also pass an
     explicit prefill string via opts.prefillNotes. */
  let prefill = String((opts && opts.prefillNotes) || "").trim();
  if (!prefill) {
    prefill = buildDraftNotesPrefill(job, feature);
  }
  if (input) input.value = prefill;
  if (generate) {
    generate.textContent =
      feature === "cover_letter" ? "Generate cover letter" : "Generate resume";
  }
  modal.style.display = "flex";
  input?.focus();
  /* Place caret at end so the prefill is editable but the user can
     still type their own additions immediately. */
  if (input && prefill && typeof input.setSelectionRange === "function") {
    try { input.setSelectionRange(prefill.length, prefill.length); } catch (_) {}
  }
}

/* Build a short, opinionated "starter notes" string from the
   _postingEnrichment so the user isn't staring at an empty textarea.
   Returns "" when there's no enrichment yet — the modal stays blank,
   matching the legacy behavior. */
function buildDraftNotesPrefill(job, feature) {
  const enr = job && job._postingEnrichment;
  if (!enr) return "";
  const fitAngle = String(enr.fitAngle || "").trim();
  const musts = Array.isArray(enr.mustHaves)
    ? enr.mustHaves
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  if (!fitAngle && !musts.length) return "";
  const lines = [];
  if (feature === "cover_letter") {
    if (fitAngle) lines.push("Angle: " + fitAngle);
    if (musts.length) lines.push("Must show: " + musts.join("; "));
    lines.push(
      "Keep it specific to " + (job.company || "this company") +
      " — avoid generic language.",
    );
  } else {
    /* resume_update */
    if (musts.length) lines.push("Surface evidence of: " + musts.join("; "));
    if (fitAngle) lines.push("Emphasize: " + fitAngle);
    lines.push("Rewrite bullets so the top three lines speak to this JD.");
  }
  return lines.join("\n");
}

async function reviseLetterDraftForJob(dataIndex, options) {
  const UC = materialsState().getUserContent();
  const Bundle = materialsState().getResumeBundle();
  const Gen = materialsState().getResumeGenerate();
  if (!UC || !Bundle || !Gen) {
    throw new Error("Resume modules failed to load");
  }
  const idx = Number(dataIndex);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error("Job not found");
  }
  const job = getPipelineData()[idx];
  if (!job) {
    throw new Error("Job not found");
  }
  if (
    typeof Gen.isResumeGenerationConfigured === "function" &&
    !Gen.isResumeGenerationConfigured()
  ) {
    throw new Error(
      "Configure your selected AI provider in Settings: add an OpenRouter key, local model, Gemini/OpenAI/Anthropic key, or webhook URL (see SETUP.md).",
    );
  }

  const previousDraft = String((options && options.previousDraft) || "").trim();
  const refinementFeedback = String(
    (options && options.refinementFeedback) || "",
  ).trim();
  if (!previousDraft) {
    throw new Error("Add a draft before revising");
  }
  if (!refinementFeedback) {
    throw new Error("Add revision instructions first");
  }

  await UC.openDb();
  const active = await UC.getActiveResume();
  const linkedIn =
    typeof UC.getLinkedInProfile === "function"
      ? await UC.getLinkedInProfile()
      : { text: "" };
  const additional =
    typeof UC.getAdditionalContext === "function"
      ? await UC.getAdditionalContext()
      : { text: "" };
  const hasResume = !!(active && String(active.extractedText || "").trim());
  const hasLinkedIn = !!String(
    linkedIn && linkedIn.text ? linkedIn.text : "",
  ).trim();
  const hasAdditional = !!String(
    additional && additional.text ? additional.text : "",
  ).trim();
  if (!hasResume && !hasLinkedIn && !hasAdditional) {
    throw new Error(
      "Add resume, LinkedIn, or AI context in Profile first (best results use all three).",
    );
  }

  const profile = await Bundle.assembleProfile(UC);
  const contextUsed = buildGenerationContextUsed(profile);
  const userNotes = String((options && options.userNotes) || "").trim();
  const bundle = Bundle.buildResumeContextBundle(
    "cover_letter",
    job,
    profile,
    {
      maxWords: profile.preferences.defaultMaxWords,
      userNotes,
      refinementFeedback,
      previousDraft,
    },
    { sheetId: core().getSHEET_ID() },
  );
  const genResult = await Gen.generateFromBundle(bundle);
  const text = (genResult && genResult.cleanText) || "";
  const insights = (genResult && genResult.insights) || null;
  const insightsError = (genResult && genResult.insightsError) || "";
  let savedDraft = null;
  let saveError = "";
  if (typeof UC.saveGeneratedDraft === "function") {
    try {
      savedDraft = await UC.saveGeneratedDraft({
        feature: "cover_letter",
        mode: "refine",
        text,
        job,
        parentDraftId:
          options && options.parentDraftId ? options.parentDraftId : null,
        userNotes,
        refinementFeedback,
        insights,
        insightsError,
      });
      await host().refreshGeneratedDraftLibraryCache();
      host().renderPipeline();
      if (core().getActiveDetailKey() >= 0) host().refreshDrawerIfOpen(core().getActiveDetailKey());
      try {
        document.dispatchEvent(new CustomEvent("jb:draft:saved", {
          detail: {
            jobKey: String(idx),
            feature: "cover_letter",
            draftId: savedDraft ? savedDraft.id : null,
            mode: "refine",
          },
        }));
      } catch (_e) { /* event dispatch is best-effort */ }
    } catch (draftErr) {
      console.warn("[JobBored] save letter revision draft:", draftErr);
      saveError =
        draftErr && draftErr.message
          ? String(draftErr.message)
          : "Could not save revised draft";
    }
  }
  lastResumeGenerationSession = {
    title: "Cover letter draft",
    feature: "cover_letter",
    bundle,
    contextUsed,
    job,
    dataIndex: idx,
    savedDraftId: savedDraft ? savedDraft.id : null,
    text,
  };
  return {
    text,
    draftId: savedDraft ? savedDraft.id : null,
    feature: "cover_letter",
    mode: "refine",
    saved: !!savedDraft,
    saveError,
  };
}

function closeDraftNotesModal() {
  const modal = document.getElementById("draftNotesModal");
  if (modal) modal.style.display = "none";
  pendingDraftNotesRequest = null;
}

/**
 * @param {string} title
 * @param {string} statusText
 * @param {string} bodyText
 * @param {boolean} isLoading
 * @param {"cover_letter"|"resume_update"} [docKind]
 * @param {{ resume: { chars: number, updatedAt: string }, linkedIn: { chars: number, updatedAt: string }, aiDump: { chars: number, updatedAt: string } } | null} [contextUsed]
 * @param {object | null} [jobForAnalysis]
 */
async function openResumeGenerateModal(
  title,
  statusText,
  bodyText,
  isLoading,
  docKind,
  contextUsed,
  jobForAnalysis,
) {
  const modal = document.getElementById("resumeGenerateModal");
  const kicker = document.getElementById("resumeGenerateKicker");
  const h = document.getElementById("resumeGenerateTitle");
  const meta = document.getElementById("resumeGenerateMeta");
  const st = document.getElementById("resumeGenerateStatus");
  const context = document.getElementById("resumeGenerateContextUsed");
  const ta = document.getElementById("resumeGenerateOutput");
  const preview = document.getElementById("resumeGeneratePreview");
  const skel = document.getElementById("resumeGenerateSkeleton");
  const page = document.getElementById("resumeGeneratePage");
  if (!modal || !h || !ta) return;

  const themeId = await resolveVisualThemeIdForModal();
  if (preview) preview.setAttribute("data-visual-theme", themeId);
  host().fillVisualThemeSelect("resumeGenerateVisualTheme", themeId);

  const kind = docKind === "resume_update" ? "resume_update" : "cover_letter";
  const isLetter = kind === "cover_letter";

  if (kicker) {
    kicker.textContent = isLetter ? "Cover letter" : "Résumé";
  }
  h.textContent = title;
  if (meta) {
    meta.textContent = isLetter
      ? "Letter-style preview · auto-saved per role · copy as plain text or print to PDF"
      : "Résumé-style layout · auto-saved per role · copy as plain text or print to PDF";
  }
  renderGenerationContextUsed(context, contextUsed || null);

  ta.value = bodyText || "";

  const hasBody = !!(bodyText && String(bodyText).trim());
  if (!isLoading) {
    try {
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (_inputErr) {
      /* best-effort: v2 scribe mirrors on textarea input */
    }
  }
  const isError = !isLoading && !!(statusText && !hasBody);

  if (st) {
    st.textContent = statusText || "";
    st.style.display = statusText ? "block" : "none";
    st.classList.toggle("doc-output-status--error", isError);
    st.classList.toggle(
      "doc-output-status--loading",
      !!(isLoading && statusText),
    );
  }

  modal.setAttribute("aria-busy", isLoading ? "true" : "false");
  modal.dataset.docKind = kind;

  if (isLoading) {
    materialsState().setAtsScorecardState({
      cacheKey: "",
      status: "idle",
      result: null,
      error: "",
      payload: null,
    });
    if (resumeGenerateAtsRefreshTimer) {
      clearTimeout(resumeGenerateAtsRefreshTimer);
      resumeGenerateAtsRefreshTimer = null;
    }
    if (skel) skel.hidden = false;
    if (preview) {
      preview.hidden = true;
      preview.innerHTML = "";
    }
    if (page) page.classList.add("doc-paper--loading");
    renderResumeGenerateInsights("", null);
  } else {
    if (skel) skel.hidden = true;
    if (page) page.classList.remove("doc-paper--loading");
    if (preview) {
      if (hasBody) {
        preview.hidden = false;
        preview.className =
          "doc-preview " +
          (isLetter ? "doc-preview--letter" : "doc-preview--resume");
        preview.setAttribute("data-visual-theme", themeId);
        preview.innerHTML = isLetter
          ? formatCoverLetterPreviewHtml(bodyText)
          : formatResumePreviewHtml(bodyText);
      } else {
        preview.hidden = true;
        preview.innerHTML = "";
      }
    }
    renderResumeGenerateInsights(
      bodyText,
      jobForAnalysis ||
        (lastResumeGenerationSession ? lastResumeGenerationSession.job : null),
    );
  }

  modal.style.display = "flex";
  syncResumeGenerateFooterState();
}

function closeResumeGenerateModal() {
  const modal = document.getElementById("resumeGenerateModal");
  if (modal) {
    modal.style.display = "none";
    modal.setAttribute("aria-busy", "false");
  }
}

async function runResumeGeneration(dataIndex, feature, options) {
  const UC = materialsState().getUserContent();
  const Bundle = materialsState().getResumeBundle();
  const Gen = materialsState().getResumeGenerate();
  if (!UC || !Bundle || !Gen) {
    host().showToast("Resume modules failed to load", "error");
    return;
  }

  const job = getPipelineData()[dataIndex];
  if (!job) {
    host().showToast("Job not found", "error");
    return;
  }

  if (
    typeof Gen.isResumeGenerationConfigured === "function" &&
    !Gen.isResumeGenerationConfigured()
  ) {
    host().showToast(
      "Configure your selected AI provider in Settings: add an OpenRouter key, local model, Gemini/OpenAI/Anthropic key, or webhook URL (see SETUP.md).",
      "error",
      true,
    );
    return;
  }

  await UC.openDb();
  const active = await UC.getActiveResume();
  const linkedIn =
    typeof UC.getLinkedInProfile === "function"
      ? await UC.getLinkedInProfile()
      : { text: "" };
  const additional =
    typeof UC.getAdditionalContext === "function"
      ? await UC.getAdditionalContext()
      : { text: "" };
  const hasResume = !!(active && String(active.extractedText || "").trim());
  const hasLinkedIn = !!String(
    linkedIn && linkedIn.text ? linkedIn.text : "",
  ).trim();
  const hasAdditional = !!String(
    additional && additional.text ? additional.text : "",
  ).trim();
  if (!hasResume && !hasLinkedIn && !hasAdditional) {
    host().showToast(
      "Add resume, LinkedIn, or AI context in Profile first (best results use all three).",
      "error",
    );
    host().openMaterialsModal();
    return;
  }

  /* Workshop compose panel can override tone, length, and skip the
     legacy modal entirely. Defaults preserve the existing behavior.
     Declared outside the try so the catch block can branch on it. */
  const silent = !!(options && options.silent);
  try {
    const userNotes =
      options && options.userNotes != null
        ? String(options.userNotes).trim()
        : "";
    const toneOverride =
      options && options.tone != null
        ? String(options.tone).trim().toLowerCase()
        : "";
    const maxWordsOverride =
      options && options.maxWords != null && Number.isFinite(Number(options.maxWords))
        ? Math.max(60, Math.min(1200, Math.floor(Number(options.maxWords))))
        : 0;
    const profile = await Bundle.assembleProfile(UC);
    if (toneOverride) {
      profile.preferences = { ...profile.preferences, tone: toneOverride };
    }
    const contextUsed = buildGenerationContextUsed(profile);
    const title =
      feature === "cover_letter" ? "Cover letter draft" : "Tailored resume";
    const feedbackEl = document.getElementById("resumeGenerateFeedback");
    if (feedbackEl) feedbackEl.value = "";
    if (!silent) {
      await openResumeGenerateModal(
        title,
        "Generating…",
        "",
        true,
        feature,
        contextUsed,
        job,
      );
    }
    const bundle = Bundle.buildResumeContextBundle(
      feature,
      job,
      profile,
      {
        maxWords: maxWordsOverride || profile.preferences.defaultMaxWords,
        userNotes,
      },
      { sheetId: core().getSHEET_ID() },
    );
    lastResumeGenerationSession = {
      title,
      feature,
      bundle,
      contextUsed,
      job,
      dataIndex,
      savedDraftId: null,
      text: "",
    };
    const genResult = await Gen.generateFromBundle(bundle);
    const text = (genResult && genResult.cleanText) || "";
    const insights = (genResult && genResult.insights) || null;
    const insightsError = (genResult && genResult.insightsError) || "";
    const userTitle = options && typeof options.title === "string" ? options.title.trim() : "";
    let savedDraft = null;
    const UC2 = materialsState().getUserContent();
    if (UC2 && typeof UC2.saveGeneratedDraft === "function") {
      try {
        savedDraft = await UC2.saveGeneratedDraft({
          feature,
          mode: "initial",
          text,
          job,
          userNotes,
          title: userTitle,
          insights,
          insightsError,
        });
        await host().refreshGeneratedDraftLibraryCache();
        host().renderPipeline();
        if (core().getActiveDetailKey() >= 0) host().refreshDrawerIfOpen(core().getActiveDetailKey());
        try {
          document.dispatchEvent(new CustomEvent("jb:draft:saved", {
            detail: {
              jobKey: String(dataIndex),
              feature,
              draftId: savedDraft ? savedDraft.id : null,
              mode: "initial",
            },
          }));
        } catch (_e) { /* event dispatch is best-effort */ }
      } catch (draftErr) {
        console.warn("[JobBored] save generated draft:", draftErr);
      }
    }
    lastResumeGenerationSession = {
      ...lastResumeGenerationSession,
      savedDraftId: savedDraft ? savedDraft.id : null,
      text,
    };
    if (silent) {
      host().showToast(
        feature === "cover_letter"
          ? "Cover letter draft generated"
          : "Tailored resume generated",
        "success",
      );
    } else {
      await openResumeGenerateModal(
        title,
        "",
        text,
        false,
        feature,
        contextUsed,
        job,
      );
    }
    return {
      text,
      insights,
      insightsError,
      draftId: savedDraft ? savedDraft.id : null,
      feature,
      mode: "initial",
      saved: !!savedDraft,
    };
  } catch (err) {
    console.error("[JobBored] Resume generation:", err);
    const title =
      feature === "cover_letter" ? "Cover letter draft" : "Tailored resume";
    if (silent) {
      host().showToast(err.message || "Generation failed", "error", true);
      throw err;
    }
    await openResumeGenerateModal(
      title,
      err.message || "Generation failed",
      "",
      false,
      feature,
      null,
      job,
    );
    host().showToast(err.message || "Generation failed", "error", true);
  }
}

async function refineLastResumeGeneration() {
  const Gen = materialsState().getResumeGenerate();
  const feedbackEl = document.getElementById("resumeGenerateFeedback");
  const session = lastResumeGenerationSession;
  const ta = document.getElementById("resumeGenerateOutput");
  const editorDraft =
    ta && String(ta.value || "").trim() ? String(ta.value).trim() : "";
  const draftSource = editorDraft || (session && session.text) || "";
  const feedback =
    feedbackEl && feedbackEl.value != null
      ? String(feedbackEl.value).trim()
      : "";
  if (!Gen || !session || !session.bundle || !draftSource) {
    host().showToast("Generate a draft first", "error");
    return;
  }
  if (!feedback) {
    host().showToast("Add feedback before refining", "error");
    return;
  }
  try {
    lastResumeGenerationSession = {
      ...session,
      text: draftSource,
    };
    const nextBundle = {
      ...session.bundle,
      instructions: {
        ...(session.bundle.instructions || {}),
        refinementFeedback: feedback,
        previousDraft: draftSource,
      },
      meta: {
        ...(session.bundle.meta || {}),
        generatedAt: new Date().toISOString(),
      },
    };
    await openResumeGenerateModal(
      session.title,
      "Refining…",
      "",
      true,
      session.feature,
      session.contextUsed,
      session.job,
    );
    const genResult = await Gen.generateFromBundle(nextBundle);
    const nextText = (genResult && genResult.cleanText) || "";
    const insights = (genResult && genResult.insights) || null;
    const insightsError = (genResult && genResult.insightsError) || "";
    let savedDraft = null;
    const UC = materialsState().getUserContent();
    if (UC && typeof UC.saveGeneratedDraft === "function") {
      try {
        savedDraft = await UC.saveGeneratedDraft({
          feature: session.feature,
          mode: "refine",
          text: nextText,
          job: session.job,
          parentDraftId: session.savedDraftId || null,
          userNotes:
            nextBundle.instructions && nextBundle.instructions.userNotes
              ? nextBundle.instructions.userNotes
              : "",
          refinementFeedback: feedback,
          insights,
          insightsError,
        });
        await host().refreshGeneratedDraftLibraryCache();
        host().renderPipeline();
        if (core().getActiveDetailKey() >= 0) host().refreshDrawerIfOpen(core().getActiveDetailKey());
        try {
          document.dispatchEvent(new CustomEvent("jb:draft:saved", {
            detail: {
              jobKey: session && Number.isFinite(session.dataIndex)
                ? String(session.dataIndex)
                : null,
              feature: session.feature,
              draftId: savedDraft ? savedDraft.id : null,
              mode: "refine",
            },
          }));
        } catch (_e) { /* event dispatch is best-effort */ }
      } catch (draftErr) {
        console.warn("[JobBored] save refined draft:", draftErr);
      }
    }
    lastResumeGenerationSession = {
      ...session,
      bundle: nextBundle,
      savedDraftId: savedDraft ? savedDraft.id : session.savedDraftId || null,
      text: nextText,
    };
    if (feedbackEl) feedbackEl.value = "";
    await openResumeGenerateModal(
      session.title,
      "",
      nextText,
      false,
      session.feature,
      session.contextUsed,
      session.job,
    );
  } catch (err) {
    console.error("[JobBored] Resume refinement:", err);
    await openResumeGenerateModal(
      session.title,
      err.message || "Refinement failed",
      session.text,
      false,
      session.feature,
      session.contextUsed,
      session.job,
    );
    host().showToast(err.message || "Refinement failed", "error", true);
    try {
      document.dispatchEvent(
        new CustomEvent("jb:resume-refine:finished", {
          detail: {
            ok: false,
            message: err.message || "Refinement failed",
          },
        }),
      );
    } catch (_evtErr) {
      /* best-effort: v2 scribe listens for refine completion */
    }
  }
}

async function openSavedDraftVersion(draftId) {
  const draft = materialsState().getDraftByIdFromCache(draftId);
  if (!draft) {
    host().showToast("Saved draft not found", "error");
    return;
  }
  const job =
    getPipelineData().find((row) => materialsState().getJobOpportunityKey(row) === draft.jobKey) ||
    draft.jobSnapshot ||
    null;
  if (!job) {
    host().showToast("Job for this draft is no longer available", "error");
    return;
  }
  const UC = materialsState().getUserContent();
  const Bundle = materialsState().getResumeBundle();
  if (!UC || !Bundle) {
    host().showToast("Resume modules failed to load", "error");
    return;
  }
  try {
    await UC.openDb();
    const profile = await Bundle.assembleProfile(UC);
    const contextUsed = buildGenerationContextUsed(profile);
    const bundle = Bundle.buildResumeContextBundle(
      draft.feature,
      job,
      profile,
      {
        maxWords: profile.preferences.defaultMaxWords,
        userNotes: draft.userNotes || "",
      },
      { sheetId: core().getSHEET_ID() },
    );
    lastResumeGenerationSession = {
      title:
        draft.feature === "cover_letter"
          ? "Cover letter draft"
          : "Tailored resume",
      feature: draft.feature,
      bundle,
      contextUsed,
      job,
      savedDraftId: draft.id,
      text: draft.text,
    };
    const feedbackEl = document.getElementById("resumeGenerateFeedback");
    if (feedbackEl) feedbackEl.value = "";
    await openResumeGenerateModal(
      lastResumeGenerationSession.title,
      "",
      draft.text,
      false,
      draft.feature,
      contextUsed,
      job,
    );
  } catch (err) {
    console.error("[JobBored] open saved draft:", err);
    host().showToast(err.message || "Could not open saved draft", "error", true);
  }
}

async function openLatestSavedDraftForJob(dataIndex, feature) {
  const job = getPipelineData()[dataIndex];
  if (!job) {
    host().showToast("Job not found", "error");
    return;
  }
  const drafts = materialsState().getDraftsForJob(job, feature);
  if (!drafts.length) {
    host().showToast(
      `No saved ${materialsState().getDraftFeatureLabel(feature).toLowerCase()} yet`,
      "info",
    );
    return;
  }
  await openSavedDraftVersion(drafts[0].id);
}
  function initResumeGenerationUi() {
    const genModal = document.getElementById("resumeGenerateModal");
    const genClose = document.getElementById("resumeGenerateClose");
    const genDone = document.getElementById("resumeGenerateDone");
    const genPrint = document.getElementById("resumeGeneratePrint");
    const genCopy = document.getElementById("resumeGenerateCopy");
    const genFeedback = document.getElementById("resumeGenerateFeedback");
    const genRefine = document.getElementById("resumeGenerateRefine");
    const genHistoryList = document.getElementById("resumeGenerateHistoryList");
    const draftNotesModal = document.getElementById("draftNotesModal");
    const draftNotesClose = document.getElementById("draftNotesModalClose");
    const draftNotesSkip = document.getElementById("draftNotesSkip");
    const draftNotesGenerate = document.getElementById("draftNotesGenerate");
    const closeGen = () => closeResumeGenerateModal();
    if (genClose) genClose.addEventListener("click", closeGen);
    if (genDone) genDone.addEventListener("click", closeGen);
    if (genModal) {
    genModal.addEventListener("click", (e) => {
    if (e.target === genModal) closeGen();
    });
    }
    if (genPrint) {
    genPrint.addEventListener("click", () => {
    window.print();
    });
    }
    if (genCopy) {
    genCopy.addEventListener("click", async () => {
    const ta = document.getElementById("resumeGenerateOutput");
    if (!ta || !ta.value) return;
    try {
    await navigator.clipboard.writeText(ta.value);
    host().showToast("Copied to clipboard", "success");
    } catch (_) {
    host().showToast("Could not copy — select text manually", "info");
    }
    });
    }
    if (genFeedback) {
    genFeedback.addEventListener("input", () =>
    syncResumeGenerateFooterState(),
    );
    }
    const genOutput = document.getElementById("resumeGenerateOutput");
    if (genOutput) {
    genOutput.addEventListener("input", () => {
    syncResumeGenerateFooterState();
    scheduleResumeGenerateAtsRefresh();
    });
    }
    if (genRefine) {
    genRefine.addEventListener("click", () => {
    void refineLastResumeGeneration();
    });
    }
    if (genHistoryList) {
    genHistoryList.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="open-saved-draft"]');
    if (!btn) return;
    const draftId = btn.getAttribute("data-draft-id");
    if (draftId) void openSavedDraftVersion(draftId);
    });
    }
    const atsGroups = document.getElementById("resumeGenerateAtsGroups");
    if (atsGroups) {
    atsGroups.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="retry-ats-scorecard"]');
    if (!btn) return;
    const session = lastResumeGenerationSession;
    if (!session || !session.job) return;
    const draft = getResumeGenerateDraftTextForInsights(session.text || "");
    if (!draft) return;
    const feature =
    session.feature === "resume_update" ? "resume_update" : "cover_letter";
    const cacheKey = ats().computeAtsScorecardCacheKey(draft, session.job, feature);
    const payload = ats().buildAtsScorecardRequestPayload(
    draft,
    session.job,
    session,
    );
    ats().startAtsScorecardAnalysis(cacheKey, payload);
    renderResumeGenerateInsights(draft, session.job);
    });
    }
    if (draftNotesModal) {
    draftNotesModal.addEventListener("click", (e) => {
    if (e.target === draftNotesModal) closeDraftNotesModal();
    });
    }
    if (draftNotesClose) {
    draftNotesClose.addEventListener("click", closeDraftNotesModal);
    }
    if (draftNotesSkip) {
    draftNotesSkip.addEventListener("click", () => {
    const req = pendingDraftNotesRequest;
    closeDraftNotesModal();
    if (!req) return;
    void runResumeGeneration(req.dataIndex, req.feature, { userNotes: "" });
    });
    }
    if (draftNotesGenerate) {
    draftNotesGenerate.addEventListener("click", () => {
    const req = pendingDraftNotesRequest;
    const input = document.getElementById("draftNotesInput");
    const userNotes =
    input && input.value != null ? String(input.value).trim() : "";
    closeDraftNotesModal();
    if (!req) return;
    void runResumeGeneration(req.dataIndex, req.feature, { userNotes });
    });
    }

    const genThemeSel = document.getElementById("resumeGenerateVisualTheme");
    if (genThemeSel) {
    genThemeSel.addEventListener("change", async () => {
    const UC = materialsState().getUserContent();
    const id = genThemeSel.value;
    const preview = document.getElementById("resumeGeneratePreview");
    if (preview) preview.setAttribute("data-visual-theme", id);
    if (!UC) return;
    try {
    await UC.openDb();
    await UC.savePreferences({ visualThemeId: id });
    } catch (e) {
    console.warn("[JobBored] save visual theme:", e);
    }
    });
    }
  }


  async function getWorkshopProfileSummary() {
    const UC = materialsState().getUserContent();
    if (!UC) {
      return {
        hasResume: false,
        hasLinkedIn: false,
        hasAdditional: false,
        tone: "warm",
        defaultMaxWords: 350,
      };
    }
    try {
      await UC.openDb();
      const active = await UC.getActiveResume();
      const linkedIn =
        typeof UC.getLinkedInProfile === "function"
          ? await UC.getLinkedInProfile()
          : { text: "" };
      const additional =
        typeof UC.getAdditionalContext === "function"
          ? await UC.getAdditionalContext()
          : { text: "" };
      const prefs =
        typeof UC.getPreferences === "function"
          ? await UC.getPreferences()
          : { tone: "warm", defaultMaxWords: 350 };
      return {
        hasResume: !!(active && String(active.extractedText || "").trim()),
        hasLinkedIn: !!String(linkedIn && linkedIn.text ? linkedIn.text : "").trim(),
        hasAdditional: !!String(
          additional && additional.text ? additional.text : "",
        ).trim(),
        tone: prefs.tone || "warm",
        defaultMaxWords: Number(prefs.defaultMaxWords) || 350,
      };
    } catch (_e) {
      return {
        hasResume: false,
        hasLinkedIn: false,
        hasAdditional: false,
        tone: "warm",
        defaultMaxWords: 350,
      };
    }
  }

  function exposeResumeGenerationWindowApis() {
    if (typeof window === "undefined") return;
    window.openDraftNotesModal = openDraftNotesModal;
    window.reviseLetterDraftForJob = reviseLetterDraftForJob;
    window.getDraftsForJob = getDraftsForJob;
    window.openSavedDraftVersion = openSavedDraftVersion;
    window.getPipelineJobByIndex = function (idx) {
      var n = Number(idx);
      if (!Number.isFinite(n)) return null;
      return getPipelineData()[n] || null;
    };
    window.runResumeGeneration = runResumeGeneration;
    window.buildDraftNotesPrefill = buildDraftNotesPrefill;
    window.getWorkshopProfileSummary = getWorkshopProfileSummary;
  }

  Object.assign(resumeGeneration, {
    renderDraftDeckPanel,
    renderDraftLibraryCardHtml,
    resolveVisualThemeIdForModal,
    formatCoverLetterPreviewHtml,
    formatResumePreviewHtml,
    formatContextDateLabel,
    buildGenerationContextUsed,
    renderGenerationContextUsed,
    getResumeGenerateDraftTextForInsights,
    scheduleResumeGenerateAtsRefresh,
    renderDraftHistoryItemHtml,
    renderResumeGenerateInsights,
    syncResumeGenerateFooterState,
    openDraftNotesModal,
    buildDraftNotesPrefill,
    reviseLetterDraftForJob,
    closeDraftNotesModal,
    openResumeGenerateModal,
    closeResumeGenerateModal,
    runResumeGeneration,
    refineLastResumeGeneration,
    openSavedDraftVersion,
    openLatestSavedDraftForJob,
    getDraftsForJob,
    getLastResumeGenerationSession,
    setLastResumeGenerationSession,
    getWorkshopProfileSummary,
    initResumeGenerationUi,
    exposeResumeGenerationWindowApis,
  });

  exposeResumeGenerationWindowApis();
  initResumeGenerationUi();
})();
