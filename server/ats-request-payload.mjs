const ATS_EVENT = "command-center.ats-scorecard";
const ATS_FEATURES = new Set(["cover_letter", "resume_update"]);
const ATS_TOP_LEVEL_KEYS = new Set([
  "event",
  "schemaVersion",
  "feature",
  "docText",
  "job",
  "profile",
  "instructions",
  "meta",
]);
const ATS_JOB_KEYS = new Set([
  "title",
  "company",
  "url",
  "fitAssessment",
  "talkingPoints",
  "notes",
  "postingEnrichment",
]);
const ATS_POSTING_ENRICHMENT_KEYS = new Set([
  "description",
  "requirements",
  "skills",
  "mustHaves",
  "responsibilities",
  "toolsAndStack",
]);
const ATS_PROFILE_KEYS = new Set([
  "candidateProfileText",
  "resumeSourceText",
  "linkedinProfileText",
  "additionalContextText",
]);
const ATS_INSTRUCTIONS_KEYS = new Set(["userNotes", "refinementFeedback"]);
const ATS_META_KEYS = new Set(["sheetId", "generatedAt"]);

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedKeys(obj, allowedKeys, pathLabel) {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Invalid ${pathLabel} field "${key}".`);
    }
  }
}

function readRequiredObject(obj, key, pathLabel) {
  if (!hasOwn(obj, key)) throw new Error(`${pathLabel} is required.`);
  const value = obj[key];
  if (!isPlainObject(value)) throw new Error(`${pathLabel} must be an object.`);
  return value;
}

function readOptionalObject(obj, key, pathLabel) {
  if (!hasOwn(obj, key)) return undefined;
  const value = obj[key];
  if (!isPlainObject(value)) throw new Error(`${pathLabel} must be an object.`);
  return value;
}

function enforceMaxLength(value, pathLabel, maxLength) {
  if (typeof maxLength === "number" && value.length > maxLength) {
    throw new Error(`${pathLabel} must be at most ${maxLength} characters.`);
  }
  return value;
}

function readRequiredString(obj, key, pathLabel, options = {}) {
  if (!hasOwn(obj, key)) throw new Error(`${pathLabel} is required.`);
  return readStringValue(obj[key], pathLabel, options);
}

function readOptionalString(obj, key, pathLabel, options = {}) {
  if (!hasOwn(obj, key)) return undefined;
  return readStringValue(obj[key], pathLabel, options);
}

function readOptionalNullableString(obj, key, pathLabel, options = {}) {
  if (!hasOwn(obj, key)) return undefined;
  if (obj[key] === null) return null;
  return readStringValue(obj[key], pathLabel, options);
}

function readStringValue(value, pathLabel, options = {}) {
  const { maxLength, minLength = 0, trim = true, validate } = options;
  if (typeof value !== "string") throw new Error(`${pathLabel} must be a string.`);
  const normalized = trim ? value.trim() : value;
  if (normalized.length < minLength) {
    throw new Error(`${pathLabel} must be at least ${minLength} characters.`);
  }
  if (typeof validate === "function") validate(normalized, pathLabel);
  return enforceMaxLength(normalized, pathLabel, maxLength);
}

function readRequiredSchemaVersion(obj) {
  if (!hasOwn(obj, "schemaVersion")) {
    throw new Error("schemaVersion is required.");
  }
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion !== 1) {
    throw new Error("Invalid schemaVersion. Expected 1.");
  }
  return 1;
}

function readRequiredFeature(obj) {
  const feature = readRequiredString(obj, "feature", "feature");
  if (!ATS_FEATURES.has(feature)) {
    throw new Error('Invalid feature. Expected "cover_letter" or "resume_update".');
  }
  return feature;
}

function readStringArray(value, pathLabel, maxItems, maxItemLength) {
  if (!Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an array of strings.`);
  }
  return value.slice(0, maxItems).map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${pathLabel}[${index}] must be a string.`);
    }
    return enforceMaxLength(item.trim(), `${pathLabel}[${index}]`, maxItemLength);
  });
}

function readOptionalStringArray(obj, key, pathLabel, maxItems, maxItemLength) {
  if (!hasOwn(obj, key)) return undefined;
  return readStringArray(obj[key], pathLabel, maxItems, maxItemLength);
}

function assertDateTime(value, pathLabel) {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${pathLabel} must be a valid date-time string.`);
  }
}

function normalizePostingEnrichment(raw) {
  assertAllowedKeys(raw, ATS_POSTING_ENRICHMENT_KEYS, "ATS request.job.postingEnrichment");
  const out = {};
  const description = readOptionalString(
    raw,
    "description",
    "job.postingEnrichment.description",
    { maxLength: 25000 },
  );
  if (description !== undefined) out.description = description;
  const requirements = readOptionalStringArray(
    raw,
    "requirements",
    "job.postingEnrichment.requirements",
    60,
    500,
  );
  if (requirements !== undefined) out.requirements = requirements;
  const skills = readOptionalStringArray(
    raw,
    "skills",
    "job.postingEnrichment.skills",
    60,
    300,
  );
  if (skills !== undefined) out.skills = skills;
  const mustHaves = readOptionalStringArray(
    raw,
    "mustHaves",
    "job.postingEnrichment.mustHaves",
    30,
    500,
  );
  if (mustHaves !== undefined) out.mustHaves = mustHaves;
  const responsibilities = readOptionalStringArray(
    raw,
    "responsibilities",
    "job.postingEnrichment.responsibilities",
    30,
    500,
  );
  if (responsibilities !== undefined) out.responsibilities = responsibilities;
  const toolsAndStack = readOptionalStringArray(
    raw,
    "toolsAndStack",
    "job.postingEnrichment.toolsAndStack",
    40,
    300,
  );
  if (toolsAndStack !== undefined) out.toolsAndStack = toolsAndStack;
  return out;
}

function normalizeJob(raw) {
  assertAllowedKeys(raw, ATS_JOB_KEYS, "ATS request.job");
  const out = {
    title: readRequiredString(raw, "title", "job.title", { maxLength: 300, minLength: 1 }),
    company: readRequiredString(raw, "company", "job.company", {
      maxLength: 300,
      minLength: 1,
    }),
  };
  const url = readOptionalString(raw, "url", "job.url", { maxLength: 3000 });
  if (url !== undefined) out.url = url;
  const fitAssessment = readOptionalString(
    raw,
    "fitAssessment",
    "job.fitAssessment",
    { maxLength: 4000 },
  );
  if (fitAssessment !== undefined) out.fitAssessment = fitAssessment;
  const talkingPoints = readOptionalString(
    raw,
    "talkingPoints",
    "job.talkingPoints",
    { maxLength: 4000 },
  );
  if (talkingPoints !== undefined) out.talkingPoints = talkingPoints;
  const notes = readOptionalString(raw, "notes", "job.notes", { maxLength: 8000 });
  if (notes !== undefined) out.notes = notes;
  const postingEnrichment = readOptionalObject(
    raw,
    "postingEnrichment",
    "job.postingEnrichment",
  );
  if (postingEnrichment !== undefined) {
    out.postingEnrichment = normalizePostingEnrichment(postingEnrichment);
  }
  return out;
}

function normalizeProfile(raw) {
  assertAllowedKeys(raw, ATS_PROFILE_KEYS, "ATS request.profile");
  const out = {};
  const candidateProfileText = readOptionalString(
    raw,
    "candidateProfileText",
    "profile.candidateProfileText",
    { maxLength: 40000 },
  );
  if (candidateProfileText !== undefined) out.candidateProfileText = candidateProfileText;
  const resumeSourceText = readOptionalString(
    raw,
    "resumeSourceText",
    "profile.resumeSourceText",
    { maxLength: 30000 },
  );
  if (resumeSourceText !== undefined) out.resumeSourceText = resumeSourceText;
  const linkedinProfileText = readOptionalString(
    raw,
    "linkedinProfileText",
    "profile.linkedinProfileText",
    { maxLength: 30000 },
  );
  if (linkedinProfileText !== undefined) out.linkedinProfileText = linkedinProfileText;
  const additionalContextText = readOptionalString(
    raw,
    "additionalContextText",
    "profile.additionalContextText",
    { maxLength: 30000 },
  );
  if (additionalContextText !== undefined) out.additionalContextText = additionalContextText;
  return out;
}

function normalizeInstructions(raw) {
  assertAllowedKeys(raw, ATS_INSTRUCTIONS_KEYS, "ATS request.instructions");
  const out = {};
  const userNotes = readOptionalString(raw, "userNotes", "instructions.userNotes", {
    maxLength: 4000,
  });
  if (userNotes !== undefined) out.userNotes = userNotes;
  const refinementFeedback = readOptionalString(
    raw,
    "refinementFeedback",
    "instructions.refinementFeedback",
    { maxLength: 2000 },
  );
  if (refinementFeedback !== undefined) out.refinementFeedback = refinementFeedback;
  return out;
}

function normalizeMeta(raw) {
  assertAllowedKeys(raw, ATS_META_KEYS, "ATS request.meta");
  const out = {};
  const sheetId = readOptionalNullableString(raw, "sheetId", "meta.sheetId");
  if (sheetId !== undefined) out.sheetId = sheetId;
  const generatedAt = readOptionalString(raw, "generatedAt", "meta.generatedAt", {
    validate: assertDateTime,
  });
  if (generatedAt !== undefined) out.generatedAt = generatedAt;
  return out;
}

export function normalizeAtsRequestPayload(raw) {
  if (!isPlainObject(raw)) {
    throw new Error("ATS request body must be an object.");
  }
  assertAllowedKeys(raw, ATS_TOP_LEVEL_KEYS, "ATS request");

  const payload = {
    event: readRequiredString(raw, "event", "event"),
    schemaVersion: readRequiredSchemaVersion(raw),
    feature: readRequiredFeature(raw),
    docText: readRequiredString(raw, "docText", "docText", {
      minLength: 20,
      maxLength: 50000,
    }),
    job: normalizeJob(readRequiredObject(raw, "job", "job")),
  };

  if (payload.event !== ATS_EVENT) {
    throw new Error('Invalid event. Expected "command-center.ats-scorecard".');
  }

  const profile = readOptionalObject(raw, "profile", "profile");
  if (profile !== undefined) payload.profile = normalizeProfile(profile);

  const instructions = readOptionalObject(raw, "instructions", "instructions");
  if (instructions !== undefined) payload.instructions = normalizeInstructions(instructions);

  const meta = readOptionalObject(raw, "meta", "meta");
  if (meta !== undefined) payload.meta = normalizeMeta(meta);

  return payload;
}
