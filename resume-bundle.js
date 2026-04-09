/* ============================================
   Context bundle — job + profile for generation
   ============================================ */

(function () {
  /**
   * @param {object} job — pipeline row from app.js parsePipelineCSV
   * @returns {object}
   */
  function jobToBundleJob(job) {
    const e = job._postingEnrichment;
    return {
      title: job.title || null,
      company: job.company || null,
      fit: job.fitScore != null ? job.fitScore : null,
      fitAssessment: job.fitAssessment || null,
      talkingPoints: job.talkingPoints || null,
      notes: job.notes || null,
      url: job.link || null,
      tags: job.tags || null,
      location: job.location || null,
      salary: job.salary || null,
      status: job.status || null,
      source: job.source || null,
      contact: job.contact || null,
      postingEnrichment: e
        ? {
            description: e.description
              ? truncateForPrompt(e.description, 12000)
              : null,
            requirements: Array.isArray(e.requirements)
              ? e.requirements.slice(0, 40)
              : [],
            skills: Array.isArray(e.skills) ? e.skills.slice(0, 50) : [],
            postingSummary: e.postingSummary || null,
            roleInOneLine: e.roleInOneLine || null,
            mustHaves: Array.isArray(e.mustHaves)
              ? e.mustHaves.slice(0, 20)
              : [],
            niceToHaves: Array.isArray(e.niceToHaves)
              ? e.niceToHaves.slice(0, 16)
              : [],
            responsibilities: Array.isArray(e.responsibilities)
              ? e.responsibilities.slice(0, 16)
              : [],
            toolsAndStack: Array.isArray(e.toolsAndStack)
              ? e.toolsAndStack.slice(0, 24)
              : [],
            fitAngle: e.fitAngle || null,
            talkingPointsFromPosting: Array.isArray(e.talkingPoints)
              ? e.talkingPoints
              : [],
            extraKeywords: Array.isArray(e.extraKeywords)
              ? e.extraKeywords
              : [],
          }
        : null,
    };
  }

  /**
   * @param {string} text
   * @param {number} maxChars
   * @returns {string}
   */
  function truncateForPrompt(text, maxChars) {
    if (!text || text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n… [truncated]";
  }

  const SAMPLE_EXCERPT_CHARS = 8000;
  const RESUME_EXCERPT_CHARS = 24000;
  const LINKEDIN_EXCERPT_CHARS = 24000;
  const ADDITIONAL_CONTEXT_CHARS = 30000;
  const USER_NOTES_CHARS = 4000;
  const REFINEMENT_FEEDBACK_CHARS = 2000;
  const PREVIOUS_DRAFT_CHARS = 16000;

  /**
   * @param {string} resumeText
   * @param {string} linkedinText
   * @param {string} additionalContextText
   * @returns {string}
   */
  function buildCombinedProfileText(
    resumeText,
    linkedinText,
    additionalContextText,
  ) {
    const r = String(resumeText || "").trim();
    const l = String(linkedinText || "").trim();
    const a = String(additionalContextText || "").trim();
    const parts = [];
    if (r) parts.push(`RESUME\n${r}`);
    if (l) parts.push(`LINKEDIN_PROFILE\n${l}`);
    if (a) parts.push(`AI_CONTEXT_DUMP\n${a}`);
    return parts.join("\n\n");
  }

  /**
   * @param {typeof window.CommandCenterUserContent} store
   * @returns {Promise<{ resumeText: string, linkedinProfileText: string, additionalContextText: string, sourceMeta: { resumeUpdatedAt: string, linkedinUpdatedAt: string, additionalContextUpdatedAt: string }, writingSampleExcerpts: Array<{title: string, text: string}>, preferences: object }>}
   */
  async function assembleProfile(store) {
    const prefs = await store.getPreferences();
    const active = await store.getActiveResume();
    const linkedIn =
      typeof store.getLinkedInProfile === "function"
        ? await store.getLinkedInProfile()
        : { text: "", updatedAt: "" };
    const additional =
      typeof store.getAdditionalContext === "function"
        ? await store.getAdditionalContext()
        : { text: "", updatedAt: "" };
    const samples = await store.listWritingSamples();

    const resumeText =
      active && active.extractedText ? active.extractedText : "";
    const linkedinProfileText = linkedIn && linkedIn.text ? linkedIn.text : "";
    const additionalContextText =
      additional && additional.text ? additional.text : "";

    const writingSampleExcerpts = samples.map((s) => ({
      title: s.title || "Sample",
      text: truncateForPrompt(s.extractedText || "", SAMPLE_EXCERPT_CHARS),
    }));

    const DT = window.CommandCenterDocumentTemplates;
    const coverDefault =
      DT && typeof DT.getDefaultTemplateId === "function"
        ? DT.getDefaultTemplateId("cover_letter")
        : "cover_classic_paragraphs";
    const resumeDefault =
      DT && typeof DT.getDefaultTemplateId === "function"
        ? DT.getDefaultTemplateId("resume_update")
        : "resume_traditional_sections";

    return {
      resumeText,
      linkedinProfileText,
      additionalContextText,
      sourceMeta: {
        resumeUpdatedAt:
          active && active.createdAt ? String(active.createdAt) : "",
        linkedinUpdatedAt:
          linkedIn && linkedIn.updatedAt ? String(linkedIn.updatedAt) : "",
        additionalContextUpdatedAt:
          additional && additional.updatedAt
            ? String(additional.updatedAt)
            : "",
      },
      writingSampleExcerpts,
      preferences: {
        tone: prefs.tone,
        defaultMaxWords: prefs.defaultMaxWords,
        industriesToEmphasize: prefs.industriesToEmphasize || "",
        wordsToAvoid: prefs.wordsToAvoid || "",
        voiceNotes: prefs.voiceNotes || "",
        profileMergePreference: prefs.profileMergePreference || "merge",
        coverLetterTemplateId: prefs.coverLetterTemplateId || coverDefault,
        resumeTemplateId: prefs.resumeTemplateId || resumeDefault,
      },
    };
  }

  /**
   * @param {'cover_letter'|'resume_update'} feature
   * @param {object} job
   * @param {Awaited<ReturnType<typeof assembleProfile>>} profile
   * @param {{ maxWords?: number, userNotes?: string, refinementFeedback?: string, previousDraft?: string }} instructions
   * @param {{ sheetId?: string|null }} [extra]
   */
  function buildResumeContextBundle(
    feature,
    job,
    profile,
    instructions,
    extra,
  ) {
    const maxWords =
      instructions && instructions.maxWords != null
        ? instructions.maxWords
        : profile.preferences.defaultMaxWords || 350;
    const userNotes = truncateForPrompt(
      String(
        instructions && instructions.userNotes != null
          ? instructions.userNotes
          : "",
      ).trim(),
      USER_NOTES_CHARS,
    );
    const refinementFeedback = truncateForPrompt(
      String(
        instructions && instructions.refinementFeedback != null
          ? instructions.refinementFeedback
          : "",
      ).trim(),
      REFINEMENT_FEEDBACK_CHARS,
    );
    const previousDraft = truncateForPrompt(
      String(
        instructions && instructions.previousDraft != null
          ? instructions.previousDraft
          : "",
      ).trim(),
      PREVIOUS_DRAFT_CHARS,
    );

    const kind = feature === "cover_letter" ? "cover_letter" : "resume_update";
    const templateId =
      kind === "cover_letter"
        ? profile.preferences.coverLetterTemplateId
        : profile.preferences.resumeTemplateId;
    const DT = window.CommandCenterDocumentTemplates;
    const resolved =
      DT && typeof DT.resolveTemplate === "function"
        ? DT.resolveTemplate(kind, templateId)
        : {
            id:
              kind === "cover_letter"
                ? "cover_classic_paragraphs"
                : "resume_traditional_sections",
            label: "Default",
            description: "",
            promptInstructions: "",
          };

    const resumeTextForPrompt = truncateForPrompt(
      profile.resumeText || "",
      RESUME_EXCERPT_CHARS,
    );
    const linkedinTextForPrompt = truncateForPrompt(
      profile.linkedinProfileText || "",
      LINKEDIN_EXCERPT_CHARS,
    );
    const additionalContextForPrompt = truncateForPrompt(
      profile.additionalContextText || "",
      ADDITIONAL_CONTEXT_CHARS,
    );
    const combinedProfileText = buildCombinedProfileText(
      resumeTextForPrompt,
      linkedinTextForPrompt,
      additionalContextForPrompt,
    );

    return {
      feature,
      job: jobToBundleJob(job),
      profile: {
        /** Backward-compatible field consumed by existing webhook handlers. */
        resumeText: combinedProfileText,
        /** Raw resume only (non-merged). */
        resumeSourceText: resumeTextForPrompt,
        linkedinProfileText: linkedinTextForPrompt,
        additionalContextText: additionalContextForPrompt,
        /** Explicit merged field for providers/prompts that prefer one input. */
        candidateProfileText: combinedProfileText,
        sourceMeta: {
          resumeUpdatedAt:
            (profile.sourceMeta && profile.sourceMeta.resumeUpdatedAt) || "",
          linkedinUpdatedAt:
            (profile.sourceMeta && profile.sourceMeta.linkedinUpdatedAt) || "",
          additionalContextUpdatedAt:
            (profile.sourceMeta &&
              profile.sourceMeta.additionalContextUpdatedAt) ||
            "",
        },
        writingSampleExcerpts: profile.writingSampleExcerpts,
        preferences: profile.preferences,
      },
      instructions: {
        maxWords,
        userNotes,
        refinementFeedback,
        previousDraft,
      },
      template: {
        id: resolved.id,
        label: resolved.label,
        promptInstructions: resolved.promptInstructions,
        description: resolved.description || "",
      },
      meta: {
        sheetId: extra && extra.sheetId != null ? extra.sheetId : null,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  window.CommandCenterResumeBundle = {
    jobToBundleJob,
    assembleProfile,
    buildResumeContextBundle,
    truncateForPrompt,
  };
})();
