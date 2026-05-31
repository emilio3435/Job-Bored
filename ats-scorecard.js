/* ============================================
   COMMAND CENTER v2 — ATS Scorecard
   Extracted from app.js (ats-scorecard cut).

   Classic-global IIFE under window.JobBoredApp.ats — NOT an ES module.
   Loaded BEFORE app.js. Reads app.js helpers via lazy core.host.

   Owns ATS scorecard fetch/normalize/render/modal flow; state lives in
   materials-state.js (setAtsScorecardState / getAtsScorecardState).
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const ats = root.ats || (root.ats = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function core() {
    return window.JobBoredApp.core;
  }

  function materialsState() {
    return window.JobBoredApp.materialsState;
  }

  function keywordMatch() {
    return window.JobBoredApp.keywordMatch;
  }

  function escapeHtml(...args) {
    return host().escapeHtml(...args);
  }

  function getAtsScorecardState() {
    return materialsState().getAtsScorecardState();
  }

  function setAtsScorecardState(next) {
    return materialsState().setAtsScorecardState(next);
  }

  function renderDocMatchGroupHtml(title, terms) {
    if (!terms || !terms.length) return "";
    return `<div class="doc-match-group"><p class="doc-match-group__label">${escapeHtml(title)}</p><ul class="doc-match-list">${keywordMatch().renderMatchItemsHtml(terms, "doc-match-item")}</ul></div>`;
  }

  function hashStringForCache(raw) {
    const s = String(raw || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function computeAtsScorecardCacheKey(text, job, feature) {
    const t = String(text || "").trim();
    const j = job && typeof job === "object" ? job : null;
    if (!t || !j) return "";
    const title = String(j.title || "").trim();
    const company = String(j.company || "").trim();
    if (!title || !company) return "";
    const enr =
      j._postingEnrichment && typeof j._postingEnrichment === "object"
        ? j._postingEnrichment
        : {};
    const jobKey = host().getJobOpportunityKey(j);
    const atsCfg = host().getAtsScoringConfig();
    const transportPart =
      atsCfg.mode === "webhook"
        ? `webhook|${String(atsCfg.webhookUrl || "").trim()}`
        : `server|${String(atsCfg.serverUrl || "").trim()}`;
    return [
      feature === "resume_update" ? "resume_update" : "cover_letter",
      jobKey,
      hashStringForCache(t),
      hashStringForCache(transportPart),
      hashStringForCache(
        `${title}|${company}|${String(enr.description || "")}|${String(
          (enr.requirements || []).join("||"),
        )}`,
      ),
    ].join("|");
  }

  function normalizeAtsScorecardResult(raw, fallbackModel) {
    const input = raw && typeof raw === "object" ? raw : {};
    const ds =
      input.dimensionScores && typeof input.dimensionScores === "object"
        ? input.dimensionScores
        : {};
    const toScore = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    };
    const toSeverity = (v) => {
      const x = String(v || "").toLowerCase();
      return x === "high" || x === "low" || x === "medium" ? x : "medium";
    };
    const toSourceType = (v) => {
      const x = String(v || "").toLowerCase();
      return ["resume", "cover_letter", "job", "profile"].includes(x)
        ? x
        : "profile";
    };
    return {
      schemaVersion: 1,
      overallScore: toScore(input.overallScore),
      dimensionScores: {
        requirementsCoverage: toScore(ds.requirementsCoverage),
        experienceRelevance: toScore(ds.experienceRelevance),
        impactClarity: toScore(ds.impactClarity),
        atsParseability: toScore(ds.atsParseability),
        toneFit: toScore(ds.toneFit),
      },
      topStrengths: Array.isArray(input.topStrengths)
        ? input.topStrengths
            .map((x) => String(x || "").trim())
            .filter(Boolean)
            .slice(0, 8)
        : [],
      criticalGaps: Array.isArray(input.criticalGaps)
        ? input.criticalGaps
            .map((x) => ({
              gap: String((x && x.gap) || "").trim(),
              whyItMatters: String((x && x.whyItMatters) || "").trim(),
              severity: toSeverity(x && x.severity),
            }))
            .filter((x) => x.gap && x.whyItMatters)
            .slice(0, 10)
        : [],
      evidence: Array.isArray(input.evidence)
        ? input.evidence
            .map((x) => ({
              claim: String((x && x.claim) || "").trim(),
              sourceSnippet: String((x && x.sourceSnippet) || "").trim(),
              sourceType: toSourceType(x && x.sourceType),
            }))
            .filter((x) => x.claim && x.sourceSnippet)
            .slice(0, 10)
        : [],
      rewriteSuggestions: Array.isArray(input.rewriteSuggestions)
        ? input.rewriteSuggestions
            .map((x) => ({
              targetSection: String((x && x.targetSection) || "").trim(),
              before: String((x && x.before) || "").trim(),
              after: String((x && x.after) || "").trim(),
              rationale: String((x && x.rationale) || "").trim(),
            }))
            .filter((x) => x.targetSection && x.after)
            .slice(0, 8)
        : [],
      confidence: (() => {
        const n = Number(input.confidence);
        return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
      })(),
      model: String(input.model || fallbackModel || "unknown"),
    };
  }

  function buildAtsScorecardRequestPayload(text, job, session) {
    const clip = (v, max) =>
      String(v || "")
        .trim()
        .slice(0, max);
    const clipArr = (arr, maxItems, maxChars) =>
      Array.isArray(arr)
        ? arr
            .slice(0, maxItems)
            .map((x) => clip(x, maxChars))
            .filter(Boolean)
        : [];
    const bundle = session && session.bundle ? session.bundle : null;
    const feature =
      session && session.feature === "resume_update"
        ? "resume_update"
        : "cover_letter";
    const sourceJob = bundle && bundle.job ? bundle.job : job || {};
    const postingEnrichment =
      sourceJob && sourceJob.postingEnrichment
        ? sourceJob.postingEnrichment
        : job && job._postingEnrichment
          ? {
              description: job._postingEnrichment.description || "",
              requirements: Array.isArray(job._postingEnrichment.requirements)
                ? job._postingEnrichment.requirements
                : [],
              skills: Array.isArray(job._postingEnrichment.skills)
                ? job._postingEnrichment.skills
                : [],
              mustHaves: Array.isArray(job._postingEnrichment.mustHaves)
                ? job._postingEnrichment.mustHaves
                : [],
              responsibilities: Array.isArray(
                job._postingEnrichment.responsibilities,
              )
                ? job._postingEnrichment.responsibilities
                : [],
              toolsAndStack: Array.isArray(job._postingEnrichment.toolsAndStack)
                ? job._postingEnrichment.toolsAndStack
                : [],
            }
          : null;
    const payload = {
      event: "command-center.ats-scorecard",
      schemaVersion: 1,
      feature,
      docText: clip(text, 18000),
      job: {
        title: clip(
          (sourceJob && sourceJob.title) || (job && job.title) || "",
          300,
        ),
        company: clip(
          (sourceJob && sourceJob.company) || (job && job.company) || "",
          300,
        ),
        url: clip((sourceJob && sourceJob.url) || (job && job.link) || "", 3000),
        fitAssessment: clip(
          (sourceJob && sourceJob.fitAssessment) ||
            (job && job.fitAssessment) ||
            "",
          2500,
        ),
        talkingPoints: clip(
          (sourceJob && sourceJob.talkingPoints) ||
            (job && job.talkingPoints) ||
            "",
          2500,
        ),
        notes: clip(
          (sourceJob && sourceJob.notes) || (job && job.notes) || "",
          3000,
        ),
      },
    };
    if (postingEnrichment) {
      payload.job.postingEnrichment = {
        description: clip(postingEnrichment.description || "", 7000),
        requirements: clipArr(postingEnrichment.requirements, 35, 350),
        skills: clipArr(postingEnrichment.skills, 40, 180),
        mustHaves: clipArr(postingEnrichment.mustHaves, 20, 350),
        responsibilities: clipArr(postingEnrichment.responsibilities, 20, 350),
        toolsAndStack: clipArr(postingEnrichment.toolsAndStack, 24, 180),
      };
    }
    if (bundle && bundle.profile) {
      payload.profile = {
        candidateProfileText: clip(
          bundle.profile.candidateProfileText || "",
          10000,
        ),
        resumeSourceText: clip(bundle.profile.resumeSourceText || "", 8000),
        linkedinProfileText: clip(
          bundle.profile.linkedinProfileText || "",
          5000,
        ),
        additionalContextText: clip(
          bundle.profile.additionalContextText || "",
          5000,
        ),
      };
    }
    if (bundle && bundle.instructions) {
      payload.instructions = {
        userNotes: clip(bundle.instructions.userNotes || "", 1200),
        refinementFeedback: clip(
          bundle.instructions.refinementFeedback || "",
          1200,
        ),
      };
    }
    if (bundle && bundle.meta) {
      payload.meta = {};
      if (Object.prototype.hasOwnProperty.call(bundle.meta, "sheetId")) {
        payload.meta.sheetId = bundle.meta.sheetId ?? null;
      }
      if (bundle.meta.generatedAt) {
        payload.meta.generatedAt = String(bundle.meta.generatedAt).trim();
      }
    }
    return payload;
  }

  async function fetchAtsScorecard(payload) {
    const cfg = host().getAtsScoringConfig();
    const endpoint = host().getAtsScorecardApiUrl();
    if (!endpoint) {
      throw new Error(
        cfg.mode === "webhook"
          ? 'Set "ATS scorecard webhook URL" in Settings.'
          : 'Set "ATS scorecard server URL" in Settings or run local server.',
      );
    }
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await resp.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (_) {
      data = null;
    }
    if (!resp.ok) {
      let fallback = `ATS scorecard failed (${resp.status})`;
      if (resp.status === 413) {
        fallback =
          "ATS request was too large for the endpoint. Reduce ATS payload size or increase server body limit.";
      }
      const cleanedRaw =
        raw && /<html|<!doctype/i.test(raw)
          ? fallback
          : sanitizeAtsText(raw).slice(0, 500);
      const msg =
        (data && (data.error || data.message)) || cleanedRaw || fallback;
      throw new Error(String(msg).slice(0, 500));
    }
    if (!data || typeof data !== "object") {
      throw new Error("ATS endpoint returned invalid JSON.");
    }
    return normalizeAtsScorecardResult(
      data,
      cfg.mode === "webhook" ? "webhook" : "server",
    );
  }

  function renderAtsBulletGroupHtml(title, rows) {
    if (!rows || !rows.length) return "";
    return `<div class="doc-match-group"><p class="doc-match-group__label">${escapeHtml(title)}</p><ul class="doc-match-list">${rows.join("")}</ul></div>`;
  }

  function sanitizeAtsText(raw) {
    let text = String(raw || "");
    if (!text) return "";
    text = text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/[*_`>#-]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text;
  }

  function renderAtsInsightRow(title, detail, meta, status) {
    const tone =
      status === "high"
        ? "missing"
        : status === "medium"
          ? "partial"
          : status === "low"
            ? "found"
            : status || "partial";
    const safeTitle = sanitizeAtsText(title);
    const safeDetail = sanitizeAtsText(detail);
    const safeMeta = sanitizeAtsText(meta);
    return `<li class="doc-match-item doc-match-item--${escapeHtml(tone)}"><span class="doc-match-item__status" aria-hidden="true"></span><span class="doc-match-item__label"><span class="doc-match-item__title">${escapeHtml(safeTitle)}</span>${safeDetail ? `<span class="doc-match-item__detail">${escapeHtml(safeDetail)}</span>` : ""}</span><span class="doc-match-item__meta">${escapeHtml(safeMeta || "")}</span></li>`;
  }

  function renderAtsScorecardGroupsHtml(scorecard) {
    const strengths = renderAtsBulletGroupHtml(
      "Top strengths",
      (scorecard.topStrengths || []).map((s) =>
        renderAtsInsightRow(s, "", "Strength", "found"),
      ),
    );
    const gaps = renderAtsBulletGroupHtml(
      "Critical gaps",
      (scorecard.criticalGaps || []).map((g) =>
        renderAtsInsightRow(
          g.gap,
          g.whyItMatters,
          g.severity || "medium",
          g.severity || "medium",
        ),
      ),
    );
    const suggestions = renderAtsBulletGroupHtml(
      "Rewrite suggestions",
      (scorecard.rewriteSuggestions || [])
        .slice(0, 4)
        .map((s) =>
          renderAtsInsightRow(
            s.targetSection,
            `After: ${s.after}${s.rationale ? ` · Why: ${s.rationale}` : ""}`,
            "Suggested line",
            "partial",
          ),
        ),
    );
    const evidence = renderAtsBulletGroupHtml(
      "Evidence checks",
      (scorecard.evidence || [])
        .slice(0, 4)
        .map((e) =>
          renderAtsInsightRow(
            e.claim,
            e.sourceSnippet,
            e.sourceType || "source",
            "found",
          ),
        ),
    );
    return [strengths, gaps, suggestions, evidence].filter(Boolean).join("");
  }

  function formatAtsDimensionSummary(scorecard) {
    const d = scorecard.dimensionScores || {};
    return [
      `Req ${Number(d.requirementsCoverage || 0)}%`,
      `Experience ${Number(d.experienceRelevance || 0)}%`,
      `Impact ${Number(d.impactClarity || 0)}%`,
      `Parseability ${Number(d.atsParseability || 0)}%`,
      `Tone ${Number(d.toneFit || 0)}%`,
    ].join(" · ");
  }

  let dossierAtsModalKeydownHandler = null;

  function renderDossierAtsModalBodyHtml() {
    if (getAtsScorecardState().status === "loading") {
      return `<section class="doc-insight-card"><div class="doc-insight-card__head"><div><p class="doc-insight-card__kicker">ATS match</p><h4 class="doc-insight-card__title">Full scorecard</h4></div><strong class="doc-insight-card__score">...</strong></div><p class="doc-insight-card__summary">Analyzing this draft against the role with structured LLM scoring...</p><p class="doc-insight-card__hint">Scoring the latest text in the editor after generate or refine finishes.</p><div class="doc-insight-card__groups"></div></section>`;
    }
    if (getAtsScorecardState().status === "error") {
      return `<section class="doc-insight-card"><div class="doc-insight-card__head"><div><p class="doc-insight-card__kicker">ATS match</p><h4 class="doc-insight-card__title">Full scorecard</h4></div><strong class="doc-insight-card__score">--</strong></div><p class="doc-insight-card__summary">Could not analyze this draft with ATS scorecard right now.</p><p class="doc-insight-card__hint">${escapeHtml(getAtsScorecardState().error || "Unknown error")}</p><div class="doc-insight-card__groups"></div></section>`;
    }
    if (
      getAtsScorecardState().status === "success" &&
      getAtsScorecardState().result
    ) {
      const scorecard = getAtsScorecardState().result;
      const conf = Math.round(Number(scorecard.confidence || 0) * 100);
      const topGap = scorecard.criticalGaps && scorecard.criticalGaps[0];
      const hint = topGap
        ? `Priority fix: ${sanitizeAtsText(topGap.gap)}`
        : "No critical gaps identified for this draft.";
      return `<section class="doc-insight-card"><div class="doc-insight-card__head"><div><p class="doc-insight-card__kicker">ATS match</p><h4 class="doc-insight-card__title">Full scorecard</h4></div><strong class="doc-insight-card__score">${escapeHtml(String(scorecard.overallScore || 0))}%</strong></div><p class="doc-insight-card__summary">${escapeHtml(formatAtsDimensionSummary(scorecard))} · confidence ${conf}% · model ${escapeHtml(String(scorecard.model || ""))}</p><p class="doc-insight-card__hint">${escapeHtml(hint)}</p><div class="doc-insight-card__groups">${renderAtsScorecardGroupsHtml(scorecard)}</div></section>`;
    }
    return `<section class="doc-insight-card"><div class="doc-insight-card__head"><div><p class="doc-insight-card__kicker">ATS match</p><h4 class="doc-insight-card__title">Full scorecard</h4></div><strong class="doc-insight-card__score">--</strong></div><p class="doc-insight-card__summary">No ATS scorecard is cached for this role yet.</p><p class="doc-insight-card__hint">Generate or refine a resume or cover letter first.</p><div class="doc-insight-card__groups"></div></section>`;
  }

  function getDossierAtsModal() {
    let modal = document.getElementById("dossierAtsScorecardModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "dossierAtsScorecardModal";
    modal.className = "modal-overlay dossier-ats-modal";
    modal.hidden = true;
    modal.style.display = "none";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "dossierAtsScorecardTitle");
    modal.innerHTML = `
    <div class="modal-card modal-card--doc doc-output-card dossier-ats-modal__card">
      <div class="settings-modal-head">
        <div>
          <p class="doc-insight-card__kicker">ATS match</p>
          <h3 id="dossierAtsScorecardTitle">Full ATS scorecard</h3>
        </div>
        <button type="button" class="settings-modal-close" data-action="close-dossier-ats-modal" aria-label="Close">&times;</button>
      </div>
      <div class="dossier-ats-modal__body" data-dossier-ats-modal-body></div>
    </div>`;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeDossierAtsModal();
    });
    const closeBtn = modal.querySelector('[data-action="close-dossier-ats-modal"]');
    if (closeBtn) closeBtn.addEventListener("click", closeDossierAtsModal);
    document.body.appendChild(modal);
    return modal;
  }

  function openDossierAtsModal(jobKey) {
    const wantKey = jobKey ? String(jobKey) : "";
    if (wantKey && wantKey !== getAtsScorecardState().cacheKey) return;
    const modal = getDossierAtsModal();
    const body = modal.querySelector("[data-dossier-ats-modal-body]");
    if (body) body.innerHTML = renderDossierAtsModalBodyHtml();
    modal.dataset.jobKey = getAtsScorecardState().cacheKey || "";
    modal.hidden = false;
    modal.style.display = "flex";
    if (!dossierAtsModalKeydownHandler) {
      dossierAtsModalKeydownHandler = (e) => {
        if (e.key === "Escape") closeDossierAtsModal();
      };
      document.addEventListener("keydown", dossierAtsModalKeydownHandler);
    }
  }

  function closeDossierAtsModal() {
    const modal = document.getElementById("dossierAtsScorecardModal");
    if (modal) {
      modal.style.display = "none";
      modal.hidden = true;
    }
    if (dossierAtsModalKeydownHandler) {
      document.removeEventListener("keydown", dossierAtsModalKeydownHandler);
      dossierAtsModalKeydownHandler = null;
    }
  }

  window.addEventListener("jb:ats:modal:open", (e) => {
    openDossierAtsModal(e?.detail?.jobKey);
  });

  function startAtsScorecardAnalysis(cacheKey, payload) {
    setAtsScorecardState({
      ...getAtsScorecardState(),
      cacheKey,
      status: "loading",
      result: null,
      error: "",
      payload,
    });
    void (async () => {
      try {
        const result = await fetchAtsScorecard(payload);
        if (getAtsScorecardState().cacheKey !== cacheKey) return;
        setAtsScorecardState({
          ...getAtsScorecardState(),
          status: "success",
          result,
          error: "",
        });
      } catch (err) {
        if (getAtsScorecardState().cacheKey !== cacheKey) return;
        setAtsScorecardState({
          ...getAtsScorecardState(),
          status: "error",
          result: null,
          error:
            err && err.message ? String(err.message) : "ATS scorecard failed",
        });
      }
      const session = core().getLastResumeGenerationSession();
      host().renderResumeGenerateInsights(
        payload.docText,
        session ? session.job : null,
      );
    })();
  }

  Object.assign(ats, {
    renderDocMatchGroupHtml,
    computeAtsScorecardCacheKey,
    buildAtsScorecardRequestPayload,
    normalizeAtsScorecardResult,
    fetchAtsScorecard,
    sanitizeAtsText,
    renderAtsScorecardGroupsHtml,
    formatAtsDimensionSummary,
    openDossierAtsModal,
    closeDossierAtsModal,
    startAtsScorecardAnalysis,
  });
})();
