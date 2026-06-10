/* ============================================
   COMMAND CENTER v2 — Keyword / Profile Match
   Extracted from app.js (keyword-profile-match cut).

   Classic-global IIFE under window.JobBoredApp.keywordMatch — NOT an ES module.
   Loaded BEFORE app.js. Reads app.js helpers via lazy core.host.

   Owns candidateProfileMatchCache state internally; app.js no longer holds it.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const keywordMatch = root.keywordMatch || (root.keywordMatch = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function core() {
    return window.JobBoredApp.core;
  }

  function escapeHtml(...args) {
    return host().escapeHtml(...args);
  }

  function getUserContent() {
    return host().getUserContent();
  }

  function getResumeBundle() {
    return host().getResumeBundle();
  }

  function renderPipeline(...args) {
    return host().renderPipeline(...args);
  }

  function refreshDrawerIfOpen(...args) {
    return host().refreshDrawerIfOpen(...args);
  }

  // Module-owned profile-match cache (was app.js `let candidateProfileMatchCache`).
  let candidateProfileMatchCache = {
    loaded: false,
    rawText: "",
    normalizedText: "",
    tokenSet: new Set(),
  };

  function getCandidateProfileMatchCache() {
    return candidateProfileMatchCache;
  }

  function setCandidateProfileMatchCache(next) {
    candidateProfileMatchCache = next;
  }

  const KEYWORD_STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
    "using",
    "your",
    "our",
    "their",
    "you",
    "we",
    "will",
    "have",
    "has",
    "had",
    "this",
    "that",
    "these",
    "those",
    "years",
    "year",
    "plus",
    "strong",
    "ability",
    "abilities",
    "experience",
    "experienced",
    "knowledge",
    "understanding",
    "background",
    "preferred",
    "required",
    "requirement",
    "requirements",
  ]);

  const KEYWORD_ALIAS_GROUPS = [
    ["javascript", "js"],
    ["typescript", "ts"],
    ["nodejs", "node js", "node.js"],
    ["react", "reactjs", "react.js"],
    ["ci cd", "ci/cd", "continuous integration", "continuous delivery"],
    ["machine learning", "ml"],
    ["artificial intelligence", "ai"],
    ["kubernetes", "k8s"],
    ["postgresql", "postgres"],
    ["amazon web services", "aws"],
    ["google cloud platform", "gcp", "google cloud"],
    ["microsoft azure", "azure"],
  ];

  function normalizeKeywordSearchText(text) {
    let s = String(text || "").toLowerCase();
    s = s.replace(/\bc\+\+\b/g, "cplusplus");
    s = s.replace(/\bc#\b/g, "csharp");
    s = s.replace(/\bci\/cd\b/g, "ci cd");
    s = s.replace(/\bnode\.js\b/g, "nodejs");
    s = s.replace(/\breact\.js\b/g, "react");
    s = s.replace(/&/g, " and ");
    s = s.replace(/[’']/g, "");
    s = s.replace(/[^a-z0-9+#.%/\-\s]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function buildKeywordSearchIndex(text) {
    const normalizedText = normalizeKeywordSearchText(text);
    return {
      rawText: String(text || ""),
      normalizedText,
      tokenSet: new Set(normalizedText.split(" ").filter(Boolean)),
    };
  }

  function keywordTextContainsPhrase(normalizedHaystack, normalizedNeedle) {
    const hay = ` ${String(normalizedHaystack || "")} `;
    const needle = ` ${String(normalizedNeedle || "").trim()} `;
    return !!needle.trim() && hay.includes(needle);
  }

  function searchIndexHasToken(searchIndex, token) {
    const tokenSet =
      searchIndex && searchIndex.tokenSet instanceof Set
        ? searchIndex.tokenSet
        : new Set();
    if (!token) return false;
    if (tokenSet.has(token)) return true;
    if (token.endsWith("ies") && tokenSet.has(`${token.slice(0, -3)}y`)) {
      return true;
    }
    if (token.endsWith("s") && tokenSet.has(token.slice(0, -1))) return true;
    if (tokenSet.has(`${token}s`)) return true;
    return false;
  }

  function getSignificantKeywordTokens(text) {
    return normalizeKeywordSearchText(text)
      .split(" ")
      .filter(Boolean)
      .filter((token) => token.length > 1 || /\d/.test(token))
      .filter((token) => !KEYWORD_STOP_WORDS.has(token));
  }

  function expandKeywordVariants(text) {
    const base = normalizeKeywordSearchText(text);
    const variants = new Set(base ? [base] : []);
    KEYWORD_ALIAS_GROUPS.forEach((group) => {
      const normalizedGroup = group
        .map((v) => normalizeKeywordSearchText(v))
        .filter(Boolean);
      if (
        normalizedGroup.some((variant) =>
          keywordTextContainsPhrase(base, variant),
        )
      ) {
        normalizedGroup.forEach((variant) => variants.add(variant));
      }
    });
    if (keywordTextContainsPhrase(base, "product manager")) {
      variants.add("product management");
    }
    if (keywordTextContainsPhrase(base, "product management")) {
      variants.add("product manager");
    }
    return [...variants];
  }

  function stripRequirementLeadIn(text) {
    return String(text || "")
      .replace(/^(must[-\s]?have|required|requirements?)\s*[:\-]\s*/i, "")
      .replace(
        /^(?:\d+\+?\s+years?\s+of\s+)?(?:experience|expertise|proficiency|knowledge|familiarity|background|ability|comfortable|comfort|track record)\s+(?:with|in|using|building|leading|managing|supporting|to)\s+/i,
        "",
      )
      .trim();
  }

  function collectSearchTermsFromTextItem(text, category) {
    const cleaned = String(text || "")
      .replace(/^[•*\-]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return [];
    const phrases = new Set();
    const maybeAdd = (candidate) => {
      const label = String(candidate || "")
        .replace(/^[•*\-]\s*/, "")
        .replace(/^[,:;\-\s]+|[,:;\-\s]+$/g, "")
        .trim();
      if (!label) return;
      const normalized = normalizeKeywordSearchText(label);
      if (!normalized) return;
      const tokens = getSignificantKeywordTokens(label);
      const wordCount = normalized.split(" ").filter(Boolean).length;
      if (category === "requirements" && wordCount > 8 && tokens.length > 3) {
        return;
      }
      if (!tokens.length && wordCount > 3) return;
      phrases.add(label);
    };

    if (category !== "requirements" || cleaned.split(/\s+/).length <= 8) {
      maybeAdd(cleaned);
    }

    const stripped = stripRequirementLeadIn(cleaned);
    stripped
      .split(/[;,|]/)
      .flatMap((part) => part.split(/\b(?:and|or)\b/gi))
      .map((part) => part.trim())
      .forEach(maybeAdd);

    return [...phrases];
  }

  function collectJobKeywordGroups(job) {
    const enr = job && job._postingEnrichment;
    const empty = {
      mustHaves: [],
      skills: [],
      toolsAndStack: [],
      requirements: [],
      all: [],
    };
    if (!enr) return empty;
    const groups = {};
    const defs = [
      { key: "mustHaves", limit: 20 },
      { key: "skills", limit: 24 },
      { key: "toolsAndStack", limit: 24 },
      { key: "requirements", limit: 20 },
    ];
    defs.forEach(({ key, limit }) => {
      const map = new Map();
      const arr = Array.isArray(enr[key]) ? enr[key] : [];
      arr.forEach((item) => {
        collectSearchTermsFromTextItem(item, key).forEach((termLabel) => {
          const normalized = normalizeKeywordSearchText(termLabel);
          if (!normalized || map.has(normalized)) return;
          map.set(normalized, {
            label:
              termLabel.length > 72
                ? `${termLabel.slice(0, 69).trim()}…`
                : termLabel,
            fullLabel: termLabel,
            normalized,
            variants: expandKeywordVariants(termLabel),
            tokens: getSignificantKeywordTokens(termLabel),
            category: key,
          });
        });
      });
      groups[key] = [...map.values()].slice(0, limit);
    });
    groups.all = [
      ...groups.mustHaves,
      ...groups.skills,
      ...groups.toolsAndStack,
      ...groups.requirements,
    ];
    return groups;
  }

  function evaluateKeywordTerm(term, searchIndex) {
    const normalizedText =
      searchIndex && typeof searchIndex.normalizedText === "string"
        ? searchIndex.normalizedText
        : "";
    const variants =
      term && Array.isArray(term.variants) && term.variants.length
        ? term.variants
        : [term.normalized];
    const exact = variants.some((variant) =>
      keywordTextContainsPhrase(normalizedText, variant),
    );
    const tokenMatches = (term.tokens || []).filter((token) =>
      searchIndexHasToken(searchIndex, token),
    );
    let status = "missing";
    if (
      exact ||
      ((term.tokens || []).length && tokenMatches.length === term.tokens.length)
    ) {
      status = "found";
    } else if (
      tokenMatches.length &&
      tokenMatches.length >=
        Math.max(1, Math.ceil((term.tokens || []).length / 2))
    ) {
      status = "partial";
    }
    return {
      ...term,
      status,
    };
  }

  function analyzeKeywordGroupsAgainstText(groups, text) {
    const searchIndex = buildKeywordSearchIndex(text);
    const analyzed = {
      mustHaves: (groups.mustHaves || []).map((term) =>
        evaluateKeywordTerm(term, searchIndex),
      ),
      skills: (groups.skills || []).map((term) =>
        evaluateKeywordTerm(term, searchIndex),
      ),
      toolsAndStack: (groups.toolsAndStack || []).map((term) =>
        evaluateKeywordTerm(term, searchIndex),
      ),
      requirements: (groups.requirements || []).map((term) =>
        evaluateKeywordTerm(term, searchIndex),
      ),
    };
    const deduped = new Map();
    [
      ...analyzed.mustHaves,
      ...analyzed.skills,
      ...analyzed.toolsAndStack,
      ...analyzed.requirements,
    ].forEach((term) => {
      const prev = deduped.get(term.normalized);
      const rank =
        term.status === "found" ? 2 : term.status === "partial" ? 1 : 0;
      const prevRank = !prev
        ? -1
        : prev.status === "found"
          ? 2
          : prev.status === "partial"
            ? 1
            : 0;
      if (!prev || rank > prevRank) deduped.set(term.normalized, term);
    });
    const uniqueTerms = [...deduped.values()];
    const foundCount = uniqueTerms.filter(
      (term) => term.status === "found",
    ).length;
    const partialCount = uniqueTerms.filter(
      (term) => term.status === "partial",
    ).length;
    const missingTerms = uniqueTerms.filter((term) => term.status === "missing");
    const percentage = uniqueTerms.length
      ? Math.round(((foundCount + partialCount * 0.5) / uniqueTerms.length) * 100)
      : 0;
    return {
      groups: analyzed,
      uniqueTerms,
      foundCount,
      partialCount,
      missingTerms,
      totalTerms: uniqueTerms.length,
      percentage,
    };
  }

  function sortTermsForDisplay(terms) {
    const order = { missing: 0, partial: 1, found: 2 };
    return [...(terms || [])].sort((a, b) => {
      const statusDelta = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      if (statusDelta !== 0) return statusDelta;
      return String(a.label || "").localeCompare(String(b.label || ""));
    });
  }

  function renderMatchItemsHtml(terms, itemClassName) {
    const cls = itemClassName || "match-checklist__item";
    return sortTermsForDisplay(terms)
      .map((term) => {
        const label = term.label || term.fullLabel || "";
        return `<li class="${cls} ${cls}--${escapeHtml(term.status)}"><span class="${cls}__status" aria-hidden="true"></span><span class="${cls}__label">${escapeHtml(label)}</span><span class="${cls}__meta">${term.status === "found" ? "Found" : term.status === "partial" ? "Partial" : "Missing"}</span></li>`;
      })
      .join("");
  }

  function renderProfileMatchBadgeHtml(job, dataIndex) {
    const groups = collectJobKeywordGroups(job);
    const hasTerms =
      groups.mustHaves.length ||
      groups.skills.length ||
      groups.toolsAndStack.length;
    if (!hasTerms) return "";

    if (!candidateProfileMatchCache.loaded) {
      return `<div class="profile-match-badge profile-match-badge--loading" aria-label="Profile match loading">
      <div class="profile-match-badge__ring profile-match-badge__ring--empty">
        <span class="profile-match-badge__pct">…</span>
      </div>
      <div class="profile-match-badge__text">
        <span class="profile-match-badge__label">Profile match</span>
        <span class="profile-match-badge__hint">Loading your profile…</span>
      </div>
    </div>`;
    }

    if (!candidateProfileMatchCache.rawText.trim()) {
      return `<div class="profile-match-badge profile-match-badge--empty" aria-label="Profile match unavailable">
      <div class="profile-match-badge__ring profile-match-badge__ring--empty">
        <span class="profile-match-badge__pct">–</span>
      </div>
      <div class="profile-match-badge__text">
        <span class="profile-match-badge__label">Profile match</span>
        <span class="profile-match-badge__hint">Add resume in Profile to see fit</span>
      </div>
    </div>`;
    }

    const analysis = analyzeKeywordGroupsAgainstText(
      {
        mustHaves: groups.mustHaves,
        skills: groups.skills,
        toolsAndStack: groups.toolsAndStack,
        requirements: [],
        all: [...groups.mustHaves, ...groups.skills, ...groups.toolsAndStack],
      },
      candidateProfileMatchCache.rawText,
    );
    const pct = analysis.percentage;
    const ringClass =
      pct >= 70
        ? "profile-match-badge__ring--high"
        : pct >= 40
          ? "profile-match-badge__ring--mid"
          : "profile-match-badge__ring--low";
    const hint =
      analysis.missingTerms.length > 0
        ? `${analysis.missingTerms.length} gap${analysis.missingTerms.length !== 1 ? "s" : ""} · click to review`
        : "Strong match · click to review";

    return `<button type="button" class="profile-match-badge" data-action="open-profile-match" data-index="${dataIndex}" aria-label="Profile match ${pct}% — click to see breakdown">
    <div class="profile-match-badge__ring ${ringClass}">
      <span class="profile-match-badge__pct">${pct}%</span>
    </div>
    <div class="profile-match-badge__text">
      <span class="profile-match-badge__label">Profile match</span>
      <span class="profile-match-badge__hint">${escapeHtml(hint)}</span>
    </div>
    <svg class="profile-match-badge__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
  </button>`;
  }

  function openProfileMatchModal(job, _dataIndex) {
    const existing = document.getElementById("profileMatchModal");
    if (existing) existing.remove();

    const content = renderProfileMatchSectionHtml(job);
    if (!content) return;

    const title = escapeHtml(`${job.title || "Role"} · ${job.company || ""}`);
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay profile-match-modal-overlay";
    overlay.id = "profileMatchModal";
    overlay.innerHTML = `
    <div class="profile-match-modal" role="dialog" aria-modal="true" aria-label="Profile match breakdown">
      <div class="profile-match-modal__head">
        <div class="profile-match-modal__title-group">
          <p class="profile-match-modal__kicker">Profile match</p>
          <h3 class="profile-match-modal__title">${title}</h3>
        </div>
        <button type="button" class="profile-match-modal__close" data-action="close-profile-match" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="profile-match-modal__body">
        ${content}
      </div>
    </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay
      .querySelector('[data-action="close-profile-match"]')
      .addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
  }

  function renderProfileMatchSectionHtml(job) {
    const groups = collectJobKeywordGroups(job);
    const hasTerms =
      groups.mustHaves.length ||
      groups.skills.length ||
      groups.toolsAndStack.length;
    if (!hasTerms) return "";
    if (!candidateProfileMatchCache.loaded) {
      return `<section class="profile-match-card"><div class="profile-match-card__head"><div><p class="profile-match-card__kicker">Profile match</p><h4 class="profile-match-card__title">Comparing your profile to the role</h4></div></div><p class="profile-match-card__summary">Loading your resume, LinkedIn, and AI context…</p></section>`;
    }
    if (!candidateProfileMatchCache.rawText.trim()) {
      return `<section class="profile-match-card"><div class="profile-match-card__head"><div><p class="profile-match-card__kicker">Profile match</p><h4 class="profile-match-card__title">Comparing your profile to the role</h4></div></div><p class="profile-match-card__summary">Add resume, LinkedIn, or AI context in Profile to see the job-fit gap instantly.</p></section>`;
    }
    const analysis = analyzeKeywordGroupsAgainstText(
      {
        mustHaves: groups.mustHaves,
        skills: groups.skills,
        toolsAndStack: groups.toolsAndStack,
        requirements: [],
        all: [...groups.mustHaves, ...groups.skills, ...groups.toolsAndStack],
      },
      candidateProfileMatchCache.rawText,
    );
    const summary =
      analysis.totalTerms > 0
        ? `${analysis.foundCount} found · ${analysis.partialCount} partial · ${analysis.missingTerms.length} missing`
        : "No structured keywords available yet.";
    const missingPreview = analysis.missingTerms
      .slice(0, 4)
      .map((term) => term.label)
      .join(", ");
    return `<section class="profile-match-card"><div class="profile-match-card__head"><div><p class="profile-match-card__kicker">Profile match</p><h4 class="profile-match-card__title">Comparing your profile to the role</h4></div><div class="profile-match-card__score">${analysis.percentage}%</div></div><p class="profile-match-card__summary">${escapeHtml(summary)}</p>${missingPreview ? `<p class="profile-match-card__hint">Gap to close: ${escapeHtml(missingPreview)}</p>` : ""}<div class="profile-match-card__groups">${groups.mustHaves.length ? `<div class="profile-match-card__group"><p class="profile-match-card__group-label">Must-haves</p><ul class="match-checklist">${renderMatchItemsHtml(analysis.groups.mustHaves, "match-checklist__item")}</ul></div>` : ""}${groups.skills.length ? `<div class="profile-match-card__group"><p class="profile-match-card__group-label">Skills</p><ul class="match-checklist">${renderMatchItemsHtml(analysis.groups.skills, "match-checklist__item")}</ul></div>` : ""}${groups.toolsAndStack.length ? `<div class="profile-match-card__group"><p class="profile-match-card__group-label">Tools &amp; stack</p><ul class="match-checklist">${renderMatchItemsHtml(analysis.groups.toolsAndStack, "match-checklist__item")}</ul></div>` : ""}</div></section>`;
  }

  async function refreshCandidateProfileMatchCache() {
    const UC = getUserContent();
    const Bundle = getResumeBundle();
    if (!UC || !Bundle || typeof Bundle.assembleProfile !== "function") {
      candidateProfileMatchCache = {
        loaded: true,
        rawText: "",
        normalizedText: "",
        tokenSet: new Set(),
      };
      return candidateProfileMatchCache;
    }
    try {
      await UC.openDb();
      const profile = await Bundle.assembleProfile(UC);
      const rawText = [
        profile.resumeText || "",
        profile.linkedinProfileText || "",
        profile.additionalContextText || "",
      ]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join("\n\n");
      candidateProfileMatchCache = {
        loaded: true,
        ...buildKeywordSearchIndex(rawText),
      };
    } catch (err) {
      console.warn("[JobBored] profile match cache:", err);
      candidateProfileMatchCache = {
        loaded: true,
        rawText: "",
        normalizedText: "",
        tokenSet: new Set(),
      };
    }
    return candidateProfileMatchCache;
  }

  function scheduleCandidateProfileMatchRefresh(shouldRender) {
    void refreshCandidateProfileMatchCache().then(() => {
      if (!shouldRender) return;
      renderPipeline();
      const activeDetailKey = core().getActiveDetailKey();
      if (activeDetailKey >= 0) refreshDrawerIfOpen(activeDetailKey);
    });
  }

  Object.assign(keywordMatch, {
    // public render/interaction API (wrapped by app.js)
    renderProfileMatchBadgeHtml,
    openProfileMatchModal,
    renderProfileMatchSectionHtml,
    renderMatchItemsHtml,
    refreshCandidateProfileMatchCache,
    scheduleCandidateProfileMatchRefresh,
    // analysis helpers (available for shared/doc-match callers)
    collectJobKeywordGroups,
    analyzeKeywordGroupsAgainstText,
    buildKeywordSearchIndex,
    normalizeKeywordSearchText,
    getSignificantKeywordTokens,
    // cache accessors (delegated to from core bridge)
    getCandidateProfileMatchCache,
    setCandidateProfileMatchCache,
  });
})();
