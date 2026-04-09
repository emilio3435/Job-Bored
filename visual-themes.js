/* ============================================
   Preview / print visual themes (not LLM output)
   Affects #resumeGeneratePreview only — not generation or webhooks.
   ============================================ */

(function () {
  /**
   * @type {Array<{ id: string, label: string, description: string }>}
   */
  const VISUAL_THEMES = [
    {
      id: "classic",
      label: "Classic",
      description:
        "Default look: balanced spacing and teal section accents for résumés.",
    },
    {
      id: "compact",
      label: "Compact",
      description: "Tighter line height and padding — fits more on screen.",
    },
    {
      id: "serif_emphasis",
      label: "Serif emphasis",
      description:
        "Stronger serif for letters; slightly larger body for reading.",
    },
    {
      id: "muted",
      label: "Muted",
      description: "Neutral gray accents instead of teal; understated rules.",
    },
    {
      id: "high_contrast",
      label: "High contrast",
      description: "Darker text and stronger accents — good for print/PDF.",
    },
  ];

  function getDefaultVisualThemeId() {
    return VISUAL_THEMES[0] ? VISUAL_THEMES[0].id : "classic";
  }

  /**
   * @param {string} [themeId]
   * @returns {{ id: string, label: string, description: string }}
   */
  function resolveVisualTheme(themeId) {
    const id = themeId != null ? String(themeId).trim() : "";
    const found = id ? VISUAL_THEMES.find((t) => t.id === id) : null;
    const t = found || VISUAL_THEMES[0];
    if (!t) {
      return {
        id: "classic",
        label: "Classic",
        description: "",
      };
    }
    return { id: t.id, label: t.label, description: t.description };
  }

  window.CommandCenterVisualThemes = {
    VISUAL_THEMES,
    getDefaultVisualThemeId,
    resolveVisualTheme,
  };
})();
