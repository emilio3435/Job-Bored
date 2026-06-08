/* ============================================
   COMMAND CENTER v2 — Settings Modal
   Extracted from app.js (settings-modal cut).

   Classic-global IIFE under window.JobBoredApp.settings — NOT an ES module.
   Loaded AFTER onboarding-wizard.js, BEFORE app.js. Reads app.js helpers via
   lazy core.host.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const settings = root.settings || (root.settings = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function showToast(...args) {
    return host().showToast(...args);
  }

  function closeAuthUserMenu(...args) {
    return host().closeAuthUserMenu(...args);
  }

  function readStoredConfigOverrides(...args) {
    return host().readStoredConfigOverrides(...args);
  }

  function mergeStoredConfigOverridePatch(...args) {
    return host().mergeStoredConfigOverridePatch(...args);
  }

  function writeStoredConfigOverrides(...args) {
    return host().writeStoredConfigOverrides(...args);
  }

  function resolveGeminiModel(...args) {
    return host().resolveGeminiModel(...args);
  }

function isSettingsModalOpen() {
  const modal = document.getElementById("settingsModal");
  return !!(modal && modal.style.display === "flex");
}


function fillOneResumeModelSelect(selectId, optionList, currentValue) {
  const sel = document.getElementById(selectId);
  const opts =
    optionList ||
    (window.CommandCenterResumeModelOptions &&
      window.CommandCenterResumeModelOptions[
        selectId === "settingsResumeGeminiModel"
          ? "gemini"
          : selectId === "settingsResumeOpenAIModel"
            ? "openai"
            : selectId === "settingsResumeOpenRouterModel"
              ? "openrouter"
              : selectId === "settingsResumeLocalModel"
                ? "local"
                : "anthropic"
      ]);
  if (!sel || sel.tagName !== "SELECT" || !Array.isArray(opts)) return;
  const v =
    currentValue != null && String(currentValue).trim() !== ""
      ? String(currentValue).trim()
      : "";
  const values = new Set(opts.map((o) => o.value));
  const isGeminiSelect = selectId === "settingsResumeGeminiModel";
  sel.innerHTML = "";
  opts.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.description) opt.title = o.description;
    sel.appendChild(opt);
  });
  if (v && !values.has(v) && !isGeminiSelect) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = `${v} (saved)`;
    sel.appendChild(opt);
  }
  if (v && [...sel.options].some((o) => o.value === v)) {
    sel.value = v;
  } else if (opts[0]) {
    sel.value = opts[0].value;
  }
  updateModelSelectTooltip(sel, opts);
  if (sel.dataset.modelTooltipBound !== "true") {
    sel.dataset.modelTooltipBound = "true";
    sel.addEventListener("change", () => {
      const latestOptions =
        window.CommandCenterResumeModelOptions &&
        window.CommandCenterResumeModelOptions[
          selectId === "settingsResumeGeminiModel"
            ? "gemini"
            : selectId === "settingsResumeOpenAIModel"
              ? "openai"
              : selectId === "settingsResumeOpenRouterModel"
                ? "openrouter"
                : selectId === "settingsResumeLocalModel"
                  ? "local"
                  : "anthropic"
        ];
      updateModelSelectTooltip(sel, latestOptions || opts);
    });
  }
}

function updateModelSelectTooltip(sel, optionList) {
  if (!sel) return;
  const options = Array.isArray(optionList) ? optionList : [];
  const selected = options.find((o) => o.value === sel.value);
  const title = selected && selected.description ? selected.description : "";
  if (title) sel.title = title;
  else sel.removeAttribute("title");
}

/**
 * @param {string} selectId
 * @param {'cover_letter'|'resume_update'} kind
 * @param {string} [currentId]
 */
function fillDocumentTemplateSelect(selectId, kind, currentId) {
  const DT = window.CommandCenterDocumentTemplates;
  if (!DT || !Array.isArray(DT.DOCUMENT_TEMPLATES)) return;
  const sel = document.getElementById(selectId);
  if (!sel || sel.tagName !== "SELECT") return;
  const list = DT.DOCUMENT_TEMPLATES.filter((t) => t.kind === kind);
  const defaultId = DT.getDefaultTemplateId(kind);
  let v =
    currentId != null && String(currentId).trim() !== ""
      ? String(currentId).trim()
      : defaultId;
  const values = new Set(list.map((t) => t.id));
  sel.innerHTML = "";
  list.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.label;
    if (t.description) opt.title = t.description;
    sel.appendChild(opt);
  });
  if (!values.has(v)) v = defaultId;
  sel.value = v;
}

/**
 * @param {string} selectId
 * @param {string} [currentId]
 */
function fillVisualThemeSelect(selectId, currentId) {
  const VT = window.CommandCenterVisualThemes;
  if (!VT || !Array.isArray(VT.VISUAL_THEMES)) return;
  const sel = document.getElementById(selectId);
  if (!sel || sel.tagName !== "SELECT") return;
  const list = VT.VISUAL_THEMES;
  const defaultId = VT.getDefaultVisualThemeId();
  let v =
    currentId != null && String(currentId).trim() !== ""
      ? String(currentId).trim()
      : defaultId;
  const resolved =
    VT.resolveVisualTheme && typeof VT.resolveVisualTheme === "function"
      ? VT.resolveVisualTheme(v)
      : { id: v };
  v = resolved.id;
  const values = new Set(list.map((t) => t.id));
  sel.innerHTML = "";
  list.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.label;
    if (t.description) opt.title = t.description;
    sel.appendChild(opt);
  });
  if (!values.has(v)) v = defaultId;
  sel.value = v;
}


function fillResumeModelSelectsFromConfig(cfg) {
  const m = window.CommandCenterResumeModelOptions;
  if (!m) return;
  fillOneResumeModelSelect(
    "settingsResumeGeminiModel",
    m.gemini,
    cfg.resumeGeminiModel,
  );
  fillOneResumeModelSelect(
    "settingsResumeOpenAIModel",
    m.openai,
    cfg.resumeOpenAIModel,
  );
  fillOneResumeModelSelect(
    "settingsResumeAnthropicModel",
    m.anthropic,
    cfg.resumeAnthropicModel,
  );
  fillOneResumeModelSelect(
    "settingsResumeOpenRouterModel",
    m.openrouter,
    cfg.resumeOpenRouterModel,
  );
  fillOneResumeModelSelect(
    "settingsResumeLocalModel",
    m.local,
    cfg.resumeLocalModel,
  );
}

async function populateDiscoveryProfileIntoSettingsForm() {
  const UC = window.CommandCenterUserContent;
  if (!UC || typeof UC.getDiscoveryProfile !== "function") return;
  const p = await UC.getDiscoveryProfile();
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v != null ? String(v) : "";
  };
  set("settingsDiscoveryTargetRoles", p.targetRoles);
  set("settingsDiscoveryLocations", p.locations);
  set("settingsDiscoveryRemotePolicy", p.remotePolicy);
  set("settingsDiscoverySeniority", p.seniority);
  set("settingsDiscoveryKeywordsInclude", p.keywordsInclude);
  set("settingsDiscoveryKeywordsExclude", p.keywordsExclude);
  set("settingsDiscoveryMaxLeadsPerRun", p.maxLeadsPerRun);
  // Handle grounded_web checkbox
  const gwEl = document.getElementById("settingsDiscoveryGroundedWeb");
  if (gwEl) gwEl.checked = p.groundedWebEnabled !== false;
}

function populateCommandCenterSettingsForm() {
  const cfg = {
    ...(window.COMMAND_CENTER_CONFIG || {}),
    ...readStoredConfigOverrides(),
  };
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v != null ? String(v) : "";
  };
  const sidRaw = cfg.sheetId != null ? String(cfg.sheetId) : "";
  set("settingsSheetId", host().parseGoogleSheetId(sidRaw) || sidRaw);
  set("settingsOAuthClientId", cfg.oauthClientId);
  set("settingsTitle", host().normalizeDashboardTitle(cfg.title));
  set("settingsDiscoveryWebhookUrl", cfg.discoveryWebhookUrl);
  set("settingsDiscoveryWebhookSecret", cfg.discoveryWebhookSecret);
  set("settingsJobPostingScrapeUrl", cfg.jobPostingScrapeUrl);
  const atsMode = String(cfg.atsScoringMode || "server").toLowerCase();
  set("settingsAtsScoringMode", atsMode === "webhook" ? "webhook" : "server");
  set("settingsAtsScoringServerUrl", cfg.atsScoringServerUrl);
  set("settingsAtsScoringWebhookUrl", cfg.atsScoringWebhookUrl);
  const prov = String(cfg.resumeProvider || "gemini").toLowerCase();
  const sel = document.getElementById("settingsResumeProvider");
  if (sel) {
    const pv = [
      "gemini",
      "openai",
      "anthropic",
      "webhook",
      "openrouter",
      "local",
    ].includes(prov)
      ? prov
      : "gemini";
    sel.value = pv;
  }
  fillResumeModelSelectsFromConfig(cfg);
  set("settingsResumeGeminiApiKey", cfg.resumeGeminiApiKey);
  set("settingsResumeOpenAIApiKey", cfg.resumeOpenAIApiKey);
  set("settingsResumeAnthropicApiKey", cfg.resumeAnthropicApiKey);
  set("settingsResumeOpenRouterApiKey", cfg.resumeOpenRouterApiKey);
  set("settingsResumeLocalBaseUrl", cfg.resumeLocalBaseUrl);
  set("settingsResumeLocalApiKey", cfg.resumeLocalApiKey);
  set("settingsResumeGenerationWebhookUrl", cfg.resumeGenerationWebhookUrl);
  const err = document.getElementById("settingsFormError");
  if (err) {
    err.textContent = "";
    err.style.display = "none";
  }
  host().renderAppsScriptDeployUi();
}

function updateSettingsProviderPanels() {
  const sel = document.getElementById("settingsResumeProvider");
  const v = sel ? sel.value : "gemini";
  const gem = document.getElementById("settingsPanelGemini");
  const oai = document.getElementById("settingsPanelOpenAI");
  const ant = document.getElementById("settingsPanelAnthropic");
  const hook = document.getElementById("settingsPanelWebhook");
  const orouter = document.getElementById("settingsPanelOpenRouter");
  const local = document.getElementById("settingsPanelLocal");
  if (gem) gem.style.display = v === "gemini" ? "block" : "none";
  if (oai) oai.style.display = v === "openai" ? "block" : "none";
  if (ant) ant.style.display = v === "anthropic" ? "block" : "none";
  if (hook) hook.style.display = v === "webhook" ? "block" : "none";
  if (orouter) orouter.style.display = v === "openrouter" ? "block" : "none";
  if (local) local.style.display = v === "local" ? "block" : "none";
}

/**
 * Mount the reusable Download-model control into the local provider panel.
 * Reads the base URL + selected model lazily so the live form values are used.
 * Idempotent — the control no-ops if already bound.
 */
function mountLocalDownloadModelControl() {
  const MD = window.CommandCenterModelDownload;
  const container = document.getElementById("settingsLocalDownloadControl");
  if (!MD || !container || typeof MD.mountDownloadModelControl !== "function") {
    return;
  }
  MD.mountDownloadModelControl({
    container,
    getBaseUrl: () => {
      const el = document.getElementById("settingsResumeLocalBaseUrl");
      return (el && el.value.trim()) || "http://127.0.0.1:11434/v1";
    },
    getModel: () => {
      const el = document.getElementById("settingsResumeLocalModel");
      return (el && el.value.trim()) || "gemma4:e2b";
    },
  });
}

/** Default OAuth Web Client ID for phased Settings (before Google sign-in unlocks full settings). */
const DEFAULT_OAUTH_CLIENT_ID_FOR_PHASED_SETTINGS =
  "555157387171-o05ofv6ihjh3brknkvsm2hr7nup7e88a.apps.googleusercontent.com";

/** Settings should always expose sheet/discovery fields; actions that need auth already gate themselves. */
function isSettingsFullExperienceUnlocked() {
  return true;
}

function maybeSyncSettingsModalModeAfterAuth() {
  const m = document.getElementById("settingsModal");
  if (m && m.style.display === "flex") syncSettingsModalMode();
}

function syncSettingsModalMode() {
  const card = document.querySelector("#settingsModal .settings-modal");
  if (!card) return;
  const full = isSettingsFullExperienceUnlocked();
  card.classList.toggle("settings-modal--oauth-only", !full);
  const modalTitle = document.getElementById("settingsModalTitle");
  if (modalTitle) {
    modalTitle.textContent = full ? "JobBored settings" : "Google OAuth setup";
  }
  const oauthLab = document.getElementById("settingsOAuthClientIdLabel");
  if (oauthLab) {
    oauthLab.textContent = full
      ? "OAuth Client ID (optional)"
      : "OAuth Client ID";
  }
}

function maybeApplyPhasedSettingsDefaultOAuthClientId() {
  if (isSettingsFullExperienceUnlocked()) return;
  const el = document.getElementById("settingsOAuthClientId");
  if (!el) return;
  const v = String(el.value || "").trim();
  if (v) return;
  el.value = DEFAULT_OAUTH_CLIENT_ID_FOR_PHASED_SETTINGS;
}

async function openCommandCenterSettingsModal(opts) {
  closeAuthUserMenu();
  host().resetAppsScriptDeployModalState();
  hideSettingsClearConfirmBar();
  populateCommandCenterSettingsForm();
  maybeApplyPhasedSettingsDefaultOAuthClientId();
  updateSettingsProviderPanels();
  syncSettingsModalMode();
  const modal = document.getElementById("settingsModal");
  if (modal) modal.style.display = "flex";
  // Initialize settings tabs
  const TabSchema = window.JobBoredSettingsTabSchema;
  const Tabs = window.JobBoredSettingsTabs;
  if (Tabs && TabSchema && modal) {
    const defaultTab = (opts && opts.tab) || TabSchema.DEFAULT_TAB;
    Tabs.initSettingsTabs(modal, { defaultTab: defaultTab });
  }
  void host().probeTunnelStaleBadge();
  // Hydrate async-sourced fields AFTER the modal is visible: these read the
  // user-content IndexedDB, and a wedged DB (e.g. a "Clear settings" delete
  // blocked by another tab) must never keep the modal from opening.
  if (isSettingsFullExperienceUnlocked()) {
    try {
      await populateDiscoveryProfileIntoSettingsForm();
      await host().populateAppsScriptDeployStateIntoSettingsForm();
    } catch (e) {
      console.warn("[JobBored] settings modal hydration failed:", e);
    }
  }
}

function hideSettingsClearConfirmBar() {
  const bar = document.getElementById("settingsClearConfirmBar");
  if (bar) bar.hidden = true;
}

function showSettingsClearConfirmBar() {
  const bar = document.getElementById("settingsClearConfirmBar");
  if (!bar) return;
  bar.hidden = false;
  document.getElementById("settingsClearConfirmYes")?.focus();
}

function closeCommandCenterSettingsModal() {
  hideSettingsClearConfirmBar();
  const modal = document.getElementById("settingsModal");
  if (modal) modal.style.display = "none";
}

async function saveCommandCenterSettingsFromForm() {
  const err = document.getElementById("settingsFormError");
  if (err) {
    err.textContent = "";
    err.style.display = "none";
  }
  if (!isSettingsFullExperienceUnlocked()) {
    const oauthEl = document.getElementById("settingsOAuthClientId");
    const oauthClientIdInput = oauthEl ? oauthEl.value.trim() : "";
    if (!oauthClientIdInput) {
      if (err) {
        err.textContent = "Paste your Google OAuth Client ID.";
        err.style.display = "block";
      }
      return;
    }
    try {
      mergeStoredConfigOverridePatch({
        oauthClientId: oauthClientIdInput,
        title: host().normalizeDashboardTitle(
          (() => {
            const el = document.getElementById("settingsTitle");
            return el ? el.value.trim() : "";
          })(),
        ),
      });
    } catch (e) {
      if (err) {
        err.textContent = "Could not save OAuth settings. " + (e.message || "");
        err.style.display = "block";
      }
      return;
    }
    host().syncDiscoveryButtonState();
    if (host().applyOAuthClientChange(oauthClientIdInput)) {
      showToast("OAuth client saved — sign in to continue.", "success");
      closeCommandCenterSettingsModal();
    } else {
      showToast("OAuth client saved — reloading…", "success");
      setTimeout(() => window.location.reload(), 400);
    }
    return;
  }
  const sheetEl = document.getElementById("settingsSheetId");
  const rawSheet = (sheetEl && sheetEl.value.trim()) || "";
  const sheetId = host().parseGoogleSheetId(rawSheet);
  const oauthClientIdInput = (() => {
    const el = document.getElementById("settingsOAuthClientId");
    return el ? el.value.trim() : "";
  })();
  if (!sheetId || sheetId === "YOUR_SHEET_ID_HERE") {
    if (oauthClientIdInput) {
      try {
        mergeStoredConfigOverridePatch({
          oauthClientId: oauthClientIdInput,
          title: host().normalizeDashboardTitle(
            (() => {
              const el = document.getElementById("settingsTitle");
              return el ? el.value.trim() : "";
            })(),
          ),
        });
      } catch (e) {
        if (err) {
          err.textContent =
            "Could not save OAuth settings. " + (e.message || "");
          err.style.display = "block";
        }
        return;
      }
      host().syncDiscoveryButtonState();
      if (host().applyOAuthClientChange(oauthClientIdInput)) {
        showToast("OAuth client saved — sign in to continue.", "success");
        closeCommandCenterSettingsModal();
      } else {
        showToast("OAuth client saved — reloading…", "success");
        setTimeout(() => window.location.reload(), 400);
      }
      return;
    }
    if (err) {
      err.textContent =
        "Paste your spreadsheet’s full URL from the browser bar, or the Sheet ID only (the long id between /d/ and /edit).";
      err.style.display = "block";
    }
    const Tabs = window.JobBoredSettingsTabs;
    if (Tabs) Tabs.activateTabForField("settingsSheetId");
    return;
  }
  if (sheetEl) sheetEl.value = sheetId;
  const val = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  };
  const provEl = document.getElementById("settingsResumeProvider");
  const provider =
    provEl &&
    [
      "gemini",
      "openai",
      "anthropic",
      "webhook",
      "openrouter",
      "local",
    ].includes(provEl.value)
      ? provEl.value
      : "gemini";
  const payload = {
    sheetId,
    oauthClientId: val("settingsOAuthClientId"),
    title: host().normalizeDashboardTitle(val("settingsTitle")),
    discoveryWebhookUrl: val("settingsDiscoveryWebhookUrl"),
    discoveryWebhookSecret: val("settingsDiscoveryWebhookSecret"),
    jobPostingScrapeUrl: val("settingsJobPostingScrapeUrl"),
    atsScoringMode:
      val("settingsAtsScoringMode").toLowerCase() === "webhook"
        ? "webhook"
        : "server",
    atsScoringServerUrl: val("settingsAtsScoringServerUrl"),
    atsScoringWebhookUrl: val("settingsAtsScoringWebhookUrl"),
    resumeProvider: provider,
    resumeGeminiApiKey: val("settingsResumeGeminiApiKey"),
    resumeGeminiModel: val("settingsResumeGeminiModel") || resolveGeminiModel(),
    resumeOpenAIApiKey: val("settingsResumeOpenAIApiKey"),
    resumeOpenAIModel: val("settingsResumeOpenAIModel") || "gpt-4o-mini",
    resumeAnthropicApiKey: val("settingsResumeAnthropicApiKey"),
    resumeAnthropicModel:
      val("settingsResumeAnthropicModel") || "claude-sonnet-4-6",
    resumeOpenRouterApiKey: val("settingsResumeOpenRouterApiKey"),
    resumeOpenRouterModel:
      val("settingsResumeOpenRouterModel") || "openai/gpt-oss-120b:free",
    resumeLocalBaseUrl:
      val("settingsResumeLocalBaseUrl") || "http://127.0.0.1:11434/v1",
    resumeLocalModel: val("settingsResumeLocalModel") || "gemma4:e2b",
    resumeLocalApiKey: val("settingsResumeLocalApiKey"),
    resumeGenerationWebhookUrl: val("settingsResumeGenerationWebhookUrl"),
  };

  // Discovery profile (target roles, locations, keywords, etc.) is owned
  // by the Discovery drawer's Search sub-tab. Saving Settings does not
  // touch the discovery profile — drawer Run discovery writes it instead.

  try {
    writeStoredConfigOverrides(payload);
  } catch (e) {
    if (err) {
      err.textContent =
        "Could not save (storage may be full or disabled). " +
        (e.message || "");
      err.style.display = "block";
    }
    return;
  }
  host().setSHEET_ID(sheetId);
  host().setDashboardSheetLinks();
  const savedWebhookUrl = host().normalizeDiscoveryWebhookIdentity(
    payload.discoveryWebhookUrl,
  );
  if (!savedWebhookUrl) {
    await host().recordDiscoveryEngineState(
      "",
      host().getDiscoveryEngineStateNone(),
      "settings_saved",
    );
  } else {
    const managedUrl = host().getManagedAppsScriptWebhookIdentity();
    const savedState = host().getSavedDiscoveryEngineStateForUrl(savedWebhookUrl);
    await host().recordDiscoveryEngineState(
      savedWebhookUrl,
      savedState && savedState.state
        ? savedState.state
        : managedUrl && managedUrl === savedWebhookUrl
          ? host().getDiscoveryEngineStateStubOnly()
          : host().getDiscoveryEngineStateUnverified(),
      "settings_saved",
    );
  }
  host().syncDiscoveryButtonState();
  showToast("Settings saved — reloading…", "success");
  setTimeout(() => window.location.reload(), 400);
}

/**
 * Nuclear "Clear settings": wipes config, OAuth localStorage, IndexedDB user
 * content, revokes the Google access token, and sets a one-shot flag so the
 * next interactive sign-in forces the consent screen. After reload the user
 * is in a true greenfield state (no auto sign-in, no stale resume/profile).
 *
 * Order matters: revoke uses the in-memory token, so we must revoke BEFORE
 * clearing in-memory auth state.
 */
async function performSettingsClearOverrides() {
  if (!host().canUseLocalStorage()) {
    showToast(
      "This browser blocked local storage — nothing was cleared.",
      "error",
      true,
    );
    return;
  }

  // 1) Revoke Google access token so silent re-auth via prompt:"none" cannot
  //    re-issue from the prior consent grant. Best-effort — network/blocker
  //    failures are non-fatal because we still wipe local state below.
  try {
    if (
      host().getAccessToken() &&
      window.google &&
      google.accounts &&
      google.accounts.oauth2 &&
      typeof google.accounts.oauth2.revoke === "function"
    ) {
      await new Promise((resolve) => {
        try {
          google.accounts.oauth2.revoke(host().getAccessToken(), () => resolve());
        } catch (_) {
          resolve();
        }
        // Hard timeout in case Google never invokes the callback.
        setTimeout(resolve, 1500);
      });
    }
  } catch (_) {
    /* best-effort revoke */
  }

  // 2) Drop in-memory auth + clear OAuth localStorage (both keys).
  try {
    host().clearSessionAuthState();
  } catch (_) {
    /* clearSessionAuthState already calls clearPersisted*; defensive */
  }
  try {
    host().clearPersistedOAuthSession();
  } catch (_) {}
  try {
    host().clearPersistedRuntimeOAuthSession();
  } catch (_) {}

  // 3) Clear stored config overrides (sheet ID, OAuth client ID, webhook URL,
  //    discovery profile, etc.), then write an explicit greenfield mask.
  //
  //    The mask matters when config.js bakes in credentials (sheetId,
  //    oauthClientId, AI provider keys, discovery webhook, etc.): overrides are
  //    merged ON TOP of the file config, so merely removing them lets the
  //    file's values flow right back on reload — the app boots "configured",
  //    sign-in is one silent grant away, the sheet data reappears, AND the
  //    onboarding's provider/discovery steps show pre-filled (so you can't
  //    dogfood a true first run). Explicit empty-string overrides out-merge the
  //    file values across ALL credential keys: getConfig() treats the install
  //    as unconfigured, getOAuthClientId() returns null, and
  //    isResumeGenerationConfigured() returns false, so the app lands in the
  //    true cold-start path (login gate in no-oauth mode + first-run wizard)
  //    with every onboarding step re-armed. Connecting a sheet / re-entering a
  //    key later overwrites the mask via mergeStoredConfigOverridePatch.
  try {
    localStorage.removeItem(host().getCommandCenterConfigOverrideKey());
    localStorage.setItem(
      host().getCommandCenterConfigOverrideKey(),
      JSON.stringify(host().buildGreenfieldOverrideMask()),
    );
  } catch (_) {
    showToast("Could not clear saved settings (storage error).", "error", true);
    return;
  }

  // 4) Clear other JobBored localStorage breadcrumbs that would otherwise
  //    leak across a "greenfield" reset.
  try {
    localStorage.removeItem(host().getDiscoveryTransportSetupKey());
  } catch (_) {}
  try {
    localStorage.removeItem(host().getDiscoveryRunTrackerKey());
  } catch (_) {}

  // 5) Wipe IndexedDB user content (resume, samples, drafts, AI context).
  //    Uses deleteDatabase which fully drops the DB — next openDb call will
  //    re-create the schema empty.
  try {
    if (window.indexedDB && typeof indexedDB.deleteDatabase === "function") {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        try {
          const req = indexedDB.deleteDatabase("command-center-user-content");
          req.onsuccess = finish;
          req.onerror = finish;
          req.onblocked = finish;
        } catch (_) {
          finish();
        }
        // Hard timeout: blocked deletes can hang if another tab holds a connection.
        setTimeout(finish, 1500);
      });
    }
  } catch (_) {
    /* best-effort wipe */
  }

  // 6) Arm the one-shot consent flag so the next signIn() forces Google's
  //    consent screen instead of silently re-issuing a token. This is what
  //    makes "Clear settings" feel like a true greenfield reset for testing.
  try {
    localStorage.setItem(host().getForceConsentPromptKey(), "1");
  } catch (_) {}

  hideSettingsClearConfirmBar();
  window.location.reload();
}

function initCommandCenterSettings() {
  const modal = document.getElementById("settingsModal");
  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    void openCommandCenterSettingsModal();
  });
  document
    .getElementById("setupOpenSettingsBtn")
    ?.addEventListener("click", () => {
      if (!host().getSheetId()) {
        showToast("Create or connect your Pipeline sheet first.", "info");
        return;
      }
      void host().requestDiscoverySetup({
        entryPoint: "setup_screen",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("setupOpenSettingsLaterBtn")
    ?.addEventListener("click", () => {
      void openCommandCenterSettingsModal();
    });
  document
    .getElementById("settingsModalClose")
    ?.addEventListener("click", () => {
      closeCommandCenterSettingsModal();
    });
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeCommandCenterSettingsModal();
    });
  }
  document
    .getElementById("settingsResumeProvider")
    ?.addEventListener("change", () => {
      updateSettingsProviderPanels();
    });
  mountLocalDownloadModelControl();
  document.getElementById("settingsSaveBtn")?.addEventListener("click", () => {
    void saveCommandCenterSettingsFromForm();
  });
  document.getElementById("settingsClearBtn")?.addEventListener("click", () => {
    showSettingsClearConfirmBar();
  });
  document
    .getElementById("settingsClearConfirmCancel")
    ?.addEventListener("click", () => {
      hideSettingsClearConfirmBar();
    });
  document
    .getElementById("settingsClearConfirmYes")
    ?.addEventListener("click", () => {
      performSettingsClearOverrides();
    });
  const sheetField = document.getElementById("settingsSheetId");
  if (sheetField) {
    sheetField.addEventListener("input", () => {
      host().clearAppsScriptDeployStatusIfIdle();
      host().renderAppsScriptDeployUi();
    });
    sheetField.addEventListener("blur", () => {
      const id = host().parseGoogleSheetId(sheetField.value);
      if (id) sheetField.value = id;
      host().clearAppsScriptDeployStatusIfIdle();
      host().renderAppsScriptDeployUi();
    });
  }
  document
    .getElementById("settingsOAuthClientId")
    ?.addEventListener("input", () => {
      host().clearAppsScriptDeployStatusIfIdle();
      host().renderAppsScriptDeployUi();
    });
  document
    .getElementById("settingsDiscoveryWebhookUrl")
    ?.addEventListener("input", () => {
      host().renderDiscoveryEngineStatusUi();
    });
  document
    .getElementById("settingsDiscoveryWebhookUrl")
    ?.addEventListener("blur", () => {
      host().renderDiscoveryEngineStatusUi();
    });
  document
    .getElementById("settingsAppsScriptDeployBtn")
    ?.addEventListener("click", () => {
      void host().deployAppsScriptStubFromSettings();
    });
  document
    .getElementById("settingsAppsScriptRecheckBtn")
    ?.addEventListener("click", () => {
      void host().recheckAppsScriptPublicAccessFromSettings();
    });
  document
    .getElementById("settingsAppsScriptCopyBtn")
    ?.addEventListener("click", () => {
      const cache = host().getAppsScriptDeployStateCache();
      const url =
        cache && typeof cache.webAppUrl === "string"
          ? cache.webAppUrl.trim()
          : "";
      if (!url) {
        showToast("No managed Apps Script URL to copy yet", "info");
        return;
      }
      host().copyTextToClipboard(url);
    });
}

  Object.assign(settings, {
    isSettingsModalOpen,
    fillDocumentTemplateSelect,
    fillVisualThemeSelect,
    fillOneResumeModelSelect,
    fillResumeModelSelectsFromConfig,
    populateDiscoveryProfileIntoSettingsForm,
    populateCommandCenterSettingsForm,
    updateSettingsProviderPanels,
    isSettingsFullExperienceUnlocked,
    maybeSyncSettingsModalModeAfterAuth,
    syncSettingsModalMode,
    maybeApplyPhasedSettingsDefaultOAuthClientId,
    openCommandCenterSettingsModal,
    hideSettingsClearConfirmBar,
    showSettingsClearConfirmBar,
    closeCommandCenterSettingsModal,
    saveCommandCenterSettingsFromForm,
    performSettingsClearOverrides,
    initCommandCenterSettings,
  });

  window.openCommandCenterSettingsModal = openCommandCenterSettingsModal;
  window.closeCommandCenterSettingsModal = closeCommandCenterSettingsModal;
})();
