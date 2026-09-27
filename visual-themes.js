/* ============================================
   Preview appearance adapter over the template registry (slice 7)

   The five BYOK preview themes (classic, compact, serif_emphasis, muted,
   high_contrast) are retired. The preview renders the #126 template registry
   families instead, so this module is a thin adapter: it exposes the registry
   list bundled in user-content-store.js under the historical
   CommandCenterVisualThemes shape, and maps the retired ids to their
   families. It loads BEFORE user-content-store.js, so the store is read
   lazily with a static fallback that a test keeps identical to the server
   registry.
   ============================================ */

(function () {
  /**
   * @type {Array<{ id: string, label: string, description: string, default: boolean }>}
   */
  var FALLBACK_FAMILIES = [
    {
      id: "signal",
      label: "Signal",
      description:
        "The default. A Volt name band with a graduated scale, a strip of verified figures, and a logo-labelled log.",
      default: true,
    },
    {
      id: "dossier",
      label: "Dossier",
      description:
        "Every proof point at once. A rail that indexes each employer, and bullets hung on their lead figure.",
      default: false,
    },
    {
      id: "editorial",
      label: "Editorial",
      description:
        "A magazine profile. Bodoni display type, the statement as a pull quote, and a logo-anchored timeline.",
      default: false,
    },
  ];

  /**
   * Retired theme id → registry family. Mirrors VISUAL_THEME_MIGRATION in
   * user-content-store.js (minus the accent half, which this shape cannot
   * carry): serif emphasis is the editorial look, the rest are signal.
   */
  var LEGACY_THEME_TO_FAMILY = {
    classic: "signal",
    compact: "signal",
    serif_emphasis: "editorial",
    muted: "signal",
    high_contrast: "signal",
  };

  function registryFamilies() {
    try {
      var UC =
        typeof window !== "undefined" ? window.CommandCenterUserContent : null;
      if (
        UC &&
        Array.isArray(UC.MATERIALS_TEMPLATE_FAMILIES) &&
        UC.MATERIALS_TEMPLATE_FAMILIES.length
      ) {
        return UC.MATERIALS_TEMPLATE_FAMILIES;
      }
    } catch (_) {
      /* fall through to the bundled list */
    }
    return FALLBACK_FAMILIES;
  }

  function findFamily(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function defaultFamily(list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].default) return list[i];
    }
    return list[0] || null;
  }

  function toTheme(entry) {
    return { id: entry.id, label: entry.label, description: entry.description };
  }

  function getDefaultVisualThemeId() {
    var d = defaultFamily(registryFamilies());
    return d ? d.id : "signal";
  }

  /**
   * @param {string} [themeId] a registry family id, or a retired theme id
   * @returns {{ id: string, label: string, description: string }}
   */
  function resolveVisualTheme(themeId) {
    var list = registryFamilies();
    var id = themeId != null ? String(themeId).trim() : "";
    var found = id ? findFamily(list, id) : null;
    if (!found && LEGACY_THEME_TO_FAMILY[id]) {
      found = findFamily(list, LEGACY_THEME_TO_FAMILY[id]);
    }
    var t = found || defaultFamily(list);
    if (!t) {
      return {
        id: "signal",
        label: "Signal",
        description: "",
      };
    }
    return toTheme(t);
  }

  var api = {
    getDefaultVisualThemeId: getDefaultVisualThemeId,
    resolveVisualTheme: resolveVisualTheme,
  };
  /* A getter: the store loads after this file, so the list is read fresh on
     every access instead of capturing the fallback at load time. */
  Object.defineProperty(api, "VISUAL_THEMES", {
    enumerable: true,
    get: function () {
      return registryFamilies().map(toTheme);
    },
  });

  window.CommandCenterVisualThemes = api;
})();
