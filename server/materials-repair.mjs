const REPAIRABLE_FEATURES = new Set(["resume", "cover_letter"]);
/** @type {RepairFeature[]} */
const FEATURE_ORDER = ["resume", "cover_letter"];

const RESUME_SPARSE_CODES = new Set([
  "resume_two_page_sparse",
  "resume_second_page_sparse",
]);
const RESUME_EXPAND_CODES = new Set([
  "resume_education_missing",
  "resume_capabilities_missing",
]);
const COVER_EXPAND_CODES = new Set(["cover_letter_too_short"]);
const COVER_COLLAPSE_CODES = new Set([
  "cover_letter_too_long",
  "cover_letter_page_count",
]);

/** @typedef {"resume" | "cover_letter"} RepairFeature */
/** @typedef {"collapse" | "expand" | "expand_or_collapse" | "regenerate"} RepairStrategy */
/** @typedef {{ code: string, message?: unknown }} RepairIssue */
/** @typedef {{ pageCount?: unknown, words?: unknown, pageWords?: unknown[], issues?: unknown[] }} RepairQuality */
/**
 * @typedef {object} RepairManifest
 * @property {unknown} [pending]
 * @property {{ documents?: Partial<Record<RepairFeature, RepairQuality>> }} [quality]
 * @property {unknown} [slug]
 * @property {unknown} [company]
 * @property {unknown} [title]
 * @property {unknown} [jobUrl]
 */

/**
 * @param {string} message
 * @param {number} statusCode
 */
function httpError(message, statusCode) {
  const err = /** @type {Error & { statusCode: number }} */ (new Error(message));
  err.statusCode = statusCode;
  return err;
}

/** @param {unknown} value */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {RepairManifest} manifest
 * @param {RepairFeature} feature
 */
function qualityFor(manifest, feature) {
  return manifest
    && manifest.quality
    && manifest.quality.documents
    && manifest.quality.documents[feature]
    ? manifest.quality.documents[feature]
    : null;
}

/**
 * @param {RepairManifest} manifest
 * @param {RepairFeature} feature
 * @returns {RepairIssue[]}
 */
function issuesFor(manifest, feature) {
  const doc = qualityFor(manifest, feature);
  if (!doc || !Array.isArray(doc.issues)) return [];
  return doc.issues.filter(
    /** @returns {item is RepairIssue} */
    (item) => {
      const issue = /** @type {RepairIssue | null | undefined} */ (item);
      return !!issue && typeof issue.code === "string";
    },
  );
}

/**
 * @param {RepairManifest} manifest
 * @param {unknown} requestedFeature
 * @returns {RepairFeature}
 */
function resolveRepairFeature(manifest, requestedFeature) {
  const requested = cleanString(requestedFeature);
  if (requested) {
    if (!REPAIRABLE_FEATURES.has(requested)) {
      throw httpError("feature must be resume or cover_letter", 400);
    }
    return /** @type {RepairFeature} */ (requested);
  }
  const picked = FEATURE_ORDER.find((feature) => issuesFor(manifest, feature).length);
  if (!picked) {
    throw httpError("No review issues found to repair", 400);
  }
  return picked;
}

/**
 * @param {RepairFeature} feature
 * @param {RepairIssue[]} issues
 * @returns {RepairStrategy}
 */
function strategyFor(feature, issues) {
  const codes = new Set(issues.map((item) => item.code));
  if (feature === "resume") {
    if (codes.has("resume_page_count_high")) return "collapse";
    if ([...RESUME_SPARSE_CODES].some((code) => codes.has(code))) {
      return "expand_or_collapse";
    }
    if ([...RESUME_EXPAND_CODES].some((code) => codes.has(code))) {
      return "expand";
    }
    return "regenerate";
  }
  if ([...COVER_COLLAPSE_CODES].some((code) => codes.has(code))) return "collapse";
  if ([...COVER_EXPAND_CODES].some((code) => codes.has(code))) return "expand";
  return "regenerate";
}

/** @param {RepairFeature} feature */
function featureLabel(feature) {
  return feature === "cover_letter" ? "cover letter" : "resume";
}

/** @param {RepairQuality | null} quality */
function statsLines(quality) {
  /** @type {string[]} */
  const lines = [];
  if (!quality || typeof quality !== "object") return lines;
  if (typeof quality.pageCount === "number" && Number.isFinite(quality.pageCount)) {
    lines.push(`- Current pages: ${quality.pageCount}`);
  }
  if (typeof quality.words === "number" && Number.isFinite(quality.words)) {
    lines.push(`- Current words: ${quality.words}`);
  }
  if (Array.isArray(quality.pageWords) && quality.pageWords.length) {
    lines.push(`- Current page word counts: ${quality.pageWords.join(", ")}`);
  }
  return lines;
}

/** @param {RepairIssue[]} issues */
function issueLines(issues) {
  return issues.map((item) => {
    const message = cleanString(item.message);
    return `- ${item.code}${message ? `: ${message}` : ""}`;
  });
}

/**
 * @param {RepairFeature} feature
 * @param {RepairStrategy} strategy
 */
function directionLines(feature, strategy) {
  if (feature === "resume") {
    if (strategy === "collapse") {
      return [
        "- Collapse the resume to an intentional one-page or two-page version that does not overflow.",
        "- Preserve the strongest verified evidence and remove lower-signal repetition.",
      ];
    }
    if (strategy === "expand") {
      return [
        "- Expand the resume with relevant verified education, capabilities, and role evidence.",
        "- Keep the final layout intentional: one full page or two full pages, with no sparse trailing page.",
      ];
    }
    if (strategy === "expand_or_collapse") {
      return [
        "- Expand the sparse two-page draft into a complete two-page resume when the verified evidence supports it.",
        "- Collapse the draft to one full page when the verified evidence is not enough for a strong second page.",
        "- Restore missing education and capabilities sections when source material supports them.",
      ];
    }
    return [
      "- Regenerate the resume against the quality contract and current job description.",
      "- Keep the final layout intentional: one full page or two full pages.",
    ];
  }

  if (strategy === "collapse") {
    return [
      "- Tighten the cover letter to one polished page.",
      "- Preserve the strongest role-specific evidence and remove repetition.",
    ];
  }
  if (strategy === "expand") {
    return [
      "- Expand the cover letter into one polished page with specific role evidence.",
      "- Use the job description and profile evidence to add substance without padding.",
    ];
  }
  return [
    "- Regenerate the cover letter against the quality contract and current job description.",
    "- Keep the final output to one polished page.",
  ];
}

/**
 * @param {{ feature: RepairFeature, strategy: RepairStrategy, quality: RepairQuality | null, issues: RepairIssue[], userNotes?: unknown }} input
 */
function buildRepairNotes({ feature, strategy, quality, issues, userNotes }) {
  const label = featureLabel(feature);
  const lines = [
    `Goal: Repair the tailored ${label} so it intentionally fits the page target.`,
    "",
    "Success means:",
    ...directionLines(feature, strategy),
    "- Use verified profile, job-description, job-analysis, and prior draft evidence.",
    "- Re-render the HTML and PDF artifacts for this document.",
    "- Update qa-report.md with page count, page word distribution, evidence used, omissions, and caveats.",
    "",
    `Stop when: The regenerated ${label} passes the local materials quality review.`,
    "",
    "Current quality stats:",
    ...statsLines(quality),
    "",
    "Current quality issues:",
    ...issueLines(issues),
  ];
  const extra = cleanString(userNotes);
  if (extra) {
    lines.push("", "Additional user notes:", extra);
  }
  return lines.join("\n");
}

/**
 * @param {RepairManifest} manifest
 * @param {{ feature?: unknown, notes?: unknown, jobUrl?: unknown }} [options]
 */
export function buildRepairRequestPayload(manifest, options = {}) {
  if (!manifest || typeof manifest !== "object") {
    throw httpError("Application manifest is required", 400);
  }
  if (manifest.pending) {
    throw httpError("A materials request is already pending for this role.", 409);
  }
  const feature = resolveRepairFeature(manifest, options.feature);
  const quality = qualityFor(manifest, feature);
  const issues = issuesFor(manifest, feature);
  if (!issues.length) {
    throw httpError(`No review issues found for ${featureLabel(feature)}`, 400);
  }
  const strategy = strategyFor(feature, issues);
  const notes = buildRepairNotes({
    feature,
    strategy,
    quality,
    issues,
    userNotes: options.notes,
  });
  const jobUrl = cleanString(options.jobUrl) || cleanString(manifest.jobUrl);
  return {
    payload: {
      slug: cleanString(manifest.slug),
      company: cleanString(manifest.company),
      title: cleanString(manifest.title),
      feature,
      jobUrl,
      notes,
    },
    repair: {
      feature,
      strategy,
      issueCodes: issues.map((item) => item.code),
    },
  };
}
