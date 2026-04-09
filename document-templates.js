/* ============================================
   Cover letter & résumé layout templates (prompt instructions)
   ============================================ */

(function () {
  /** @typedef {'cover_letter'|'resume_update'} TemplateKind */

  /**
   * @type {Array<{
   *   id: string,
   *   kind: TemplateKind,
   *   label: string,
   *   description: string,
   *   promptInstructions: string
   * }>}
   */
  const DOCUMENT_TEMPLATES = [
    {
      id: "cover_classic_paragraphs",
      kind: "cover_letter",
      label: "Classic paragraphs",
      description:
        "Three flowing paragraphs: why this role, your fit, and close.",
      promptInstructions: `Use exactly three paragraphs separated by a blank line. Paragraph 1: specific interest in this role and company (no generic praise). Paragraph 2: 2–3 concrete ties between your experience and their needs, using evidence from the JSON. Paragraph 3: concise close with clear next step. Optional greeting line only if it fits; otherwise start with the first paragraph. Stay within maxWords in profile.instructions.`,
    },
    {
      id: "cover_concise_bullets",
      kind: "cover_letter",
      label: "Concise + bullets",
      description: "Short intro, then scannable bullets for fit.",
      promptInstructions: `Start with 2–3 sentences on why this role and company. Then a blank line, then 3–5 short bullet lines (use leading "- " or "• "). Each bullet must cite a concrete fact from the resume or job JSON. End with one closing sentence. No long prose blocks. Respect maxWords in profile.instructions.`,
    },
    {
      id: "cover_narrative_hook",
      kind: "cover_letter",
      label: "Narrative hook",
      description: "Story-led opening, then skills alignment.",
      promptInstructions: `Open with a brief narrative hook (4–6 sentences max) that connects a real moment or theme from your background to this opportunity. Then a blank line, then one paragraph mapping your strengths to the role using specifics from the JSON. End with a short forward-looking close. Tone should match profile.preferences. Respect maxWords in profile.instructions.`,
    },
    {
      id: "resume_traditional_sections",
      kind: "resume_update",
      label: "Traditional sections",
      description:
        "SUMMARY, EXPERIENCE, EDUCATION, SKILLS (ATS-friendly order).",
      promptInstructions: `Output plain text only. Use these section headings in ALL CAPS on their own lines, in this order: SUMMARY, EXPERIENCE, EDUCATION, SKILLS. Under EXPERIENCE use reverse-chronological entries; each job: title line, then company and dates if known from source material, then bullet lines with "- " for achievements. Do not invent employers or degrees. Keep facts truthful; tighten wording for the target job.`,
    },
    {
      id: "resume_compact_one_page",
      kind: "resume_update",
      label: "Compact one-page",
      description: "Tighter spacing, fewer bullets, emphasis on impact.",
      promptInstructions: `Optimize for a dense one-page feel: short SUMMARY (2–3 lines max), then EXPERIENCE with at most 3–4 bullets per role (prioritize impact metrics when present in source text). Use ALL CAPS section headings: SUMMARY, EXPERIENCE, EDUCATION, SKILLS. Omit filler; no tables. Plain text only. Do not fabricate metrics.`,
    },
    {
      id: "resume_impact_bullets",
      kind: "resume_update",
      label: "Impact-first bullets",
      description: "Lead bullets with strong verbs and outcomes.",
      promptInstructions: `Use ALL CAPS headings: SUMMARY, EXPERIENCE, EDUCATION, SKILLS. SUMMARY: 2–3 lines focused on value proposition for this role. EXPERIENCE: each role gets bullets that start with a strong past-tense verb and include outcome or scope when the source material supports it; if a fact is not in the resume text, do not invent it. Prefer 4–6 bullets for the most recent role, fewer for older roles. Plain text only.`,
    },
  ];

  /** @param {TemplateKind} kind */
  function getDefaultTemplateId(kind) {
    const t = DOCUMENT_TEMPLATES.find((x) => x.kind === kind);
    return t
      ? t.id
      : kind === "cover_letter"
        ? "cover_classic_paragraphs"
        : "resume_traditional_sections";
  }

  /**
   * @param {TemplateKind} kind
   * @param {string} [templateId]
   */
  function resolveTemplate(kind, templateId) {
    const id = templateId && String(templateId).trim();
    const found = id
      ? DOCUMENT_TEMPLATES.find((x) => x.id === id && x.kind === kind)
      : null;
    const t = found || DOCUMENT_TEMPLATES.find((x) => x.kind === kind);
    if (!t) {
      return {
        id: getDefaultTemplateId(kind),
        kind,
        label: "Default",
        description: "",
        promptInstructions:
          "Follow profile.preferences and instructions.maxWords.",
      };
    }
    return {
      id: t.id,
      kind: t.kind,
      label: t.label,
      description: t.description,
      promptInstructions: t.promptInstructions,
    };
  }

  window.CommandCenterDocumentTemplates = {
    DOCUMENT_TEMPLATES,
    getDefaultTemplateId,
    resolveTemplate,
  };
})();
