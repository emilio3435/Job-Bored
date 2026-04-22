/**
 * Feature B / Layer 5 — Settings → Profile tab controller.
 *
 * Drives the discovery-profile UI: client-side resume extraction, form
 * capture, POST /discovery-profile, and rendering of the inferred profile +
 * company shortlist. Raw resume text stays in-memory; the textarea holds
 * the only copy and is never persisted to localStorage.
 */
(function () {
  "use strict";

  var DISCOVERY_PROFILE_EVENT = "discovery.profile.request";
  var DISCOVERY_PROFILE_SCHEMA_VERSION = 1;
  var RUN_TIMEOUT_MS = 90_000;
  var AUTO_REFRESH_STORAGE_KEY = "settings_profile_auto_refresh";
  var AUTO_REFRESH_VALID_HOURS = [6, 12, 24];
  var SCHEDULE_LOCAL_STORAGE_KEY = "settings_profile_schedule_local";
  var SCHEDULE_CLOUD_STORAGE_KEY = "settings_profile_schedule_cloud";
  var SCHEDULE_SAVE_DEBOUNCE_MS = 600;
  var SCHEDULE_GITHUB_FILENAME = "command-center-discovery.yml";
  // Verbatim copy of templates/github-actions/command-center-discovery.yml.
  // Stored as an array of lines to avoid any JS template-literal collision
  // with GitHub's own ${{ ... }} expression syntax.
  var GITHUB_ACTIONS_TEMPLATE = [
    "# Command Center — POST discovery webhook from GitHub Actions (no browser CORS)",
    "#",
    "# Copy this file to: .github/workflows/command-center-discovery.yml",
    "# Set repository secrets (see templates/github-actions/README.md)",
    "",
    "name: Command Center discovery ping",
    "",
    "on:",
    "  workflow_dispatch:",
    "  schedule:",
    "    # Daily 14:00 UTC — change to your timezone preference",
    "    - cron: \"0 14 * * *\"",
    "",
    "jobs:",
    "  discovery:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: POST discovery webhook",
    "        env:",
    "          WEBHOOK_URL: ${{ secrets.COMMAND_CENTER_DISCOVERY_WEBHOOK_URL }}",
    "          SHEET_ID: ${{ secrets.COMMAND_CENTER_SHEET_ID }}",
    "        run: |",
    "          set -euo pipefail",
    "          if [ -z \"${WEBHOOK_URL:-}\" ] || [ -z \"${SHEET_ID:-}\" ]; then",
    "            echo \"Set secrets COMMAND_CENTER_DISCOVERY_WEBHOOK_URL and COMMAND_CENTER_SHEET_ID\"",
    "            exit 1",
    "          fi",
    "          VAR_KEY=\"gh-${{ github.run_id }}-${{ github.run_attempt }}-$(date +%s)\"",
    "          REQ_AT=\"$(date -u +\"%Y-%m-%dT%H:%M:%SZ\")\"",
    "          BODY=$(jq -n \\",
    "            --arg v \"$VAR_KEY\" \\",
    "            --arg s \"$SHEET_ID\" \\",
    "            --arg t \"$REQ_AT\" \\",
    "            '{",
    "              event: \"command-center.discovery\",",
    "              schemaVersion: 1,",
    "              sheetId: $s,",
    "              variationKey: $v,",
    "              requestedAt: $t,",
    "              discoveryProfile: {}",
    "            }')",
    "          curl -sS -X POST \"$WEBHOOK_URL\" \\",
    "            -H \"Content-Type: application/json\" \\",
    "            -d \"$BODY\" \\",
    "            -w \"\\nHTTP %{http_code}\\n\"",
    "",
  ].join("\n");

  var els = {};
  var bound = false;
  var runInFlight = false;
  var autoRefreshTimerId = null;
  var lastStatus = null;

  function qs(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    els = {
      file: qs("settingsProfileResumeFile"),
      textarea: qs("settingsProfileResumeText"),
      status: qs("settingsProfileResumeStatus"),
      clearBtn: qs("settingsProfileResumeClear"),
      targetRoles: qs("settingsProfileFormTargetRoles"),
      skills: qs("settingsProfileFormSkills"),
      seniority: qs("settingsProfileFormSeniority"),
      years: qs("settingsProfileFormYears"),
      locations: qs("settingsProfileFormLocations"),
      remotePolicy: qs("settingsProfileFormRemotePolicy"),
      industries: qs("settingsProfileFormIndustries"),
      persist: qs("settingsProfilePersist"),
      runBtn: qs("settingsProfileRunBtn"),
      refreshBtn: qs("settingsProfileRefreshBtn"),
      spinner: qs("settingsProfileSpinner"),
      error: qs("settingsProfileError"),
      results: qs("settingsProfileResults"),
      statusPanel: qs("settingsProfileStatus"),
      autoRefreshToggle: qs("settingsProfileAutoRefreshToggle"),
      autoRefreshCadence: qs("settingsProfileAutoRefreshCadence"),
      autoRefreshHint: qs("settingsProfileAutoRefreshHint"),
      scheduleLocalEnable: qs("settingsProfileScheduleLocalEnable"),
      scheduleLocalTime: qs("settingsProfileScheduleLocalTime"),
      scheduleLocalOsHint: qs("settingsProfileScheduleLocalOsHint"),
      scheduleLocalCommand: qs("settingsProfileScheduleLocalCommand"),
      scheduleLocalCopyInstall: qs("settingsProfileScheduleLocalCopyInstall"),
      scheduleLocalCopyUninstall: qs("settingsProfileScheduleLocalCopyUninstall"),
      scheduleLocalBadge: qs("settingsProfileScheduleLocalBadge"),
      scheduleLocalArtifact: qs("settingsProfileScheduleLocalArtifact"),
      scheduleLocalError: qs("settingsProfileScheduleLocalError"),
      scheduleCloudEnable: qs("settingsProfileScheduleCloudEnable"),
      scheduleCloudTime: qs("settingsProfileScheduleCloudTime"),
      scheduleCloudLocalPreview: qs("settingsProfileScheduleCloudLocalPreview"),
      scheduleCloudDownload: qs("settingsProfileScheduleCloudDownload"),
      scheduleCloudBadge: qs("settingsProfileScheduleCloudBadge"),
      scheduleCloudError: qs("settingsProfileScheduleCloudError"),
    };
  }

  function setStatus(text, kind) {
    if (!els.status) return;
    els.status.textContent = String(text || "");
    els.status.dataset.kind = kind || "info";
  }

  function setError(message) {
    if (!els.error) return;
    if (!message) {
      els.error.textContent = "";
      els.error.hidden = true;
      els.error.style.display = "none";
      return;
    }
    els.error.textContent = String(message);
    els.error.hidden = false;
    els.error.style.display = "";
  }

  function setRunning(running) {
    runInFlight = !!running;
    if (els.runBtn) {
      els.runBtn.disabled = runInFlight;
      els.runBtn.textContent = runInFlight
        ? "Discovering…"
        : "Discover companies";
    }
    if (els.spinner) {
      els.spinner.hidden = !runInFlight;
    }
  }

  async function handleFileChange(event) {
    var file = event && event.target && event.target.files
      ? event.target.files[0]
      : null;
    if (!file) return;
    var ingest = window.CommandCenterResumeIngest;
    if (!ingest || typeof ingest.extractTextFromFile !== "function") {
      setStatus("Resume parser not loaded. Reload the page.", "error");
      return;
    }
    setStatus("Extracting " + file.name + "…", "info");
    try {
      var text = await ingest.extractTextFromFile(file);
      if (els.textarea) els.textarea.value = text || "";
      var charCount = (text || "").length;
      setStatus(
        charCount > 0
          ? "Extracted " + charCount.toLocaleString() + " characters from " + file.name + "."
          : "No text found in " + file.name + ". Try pasting manually.",
        charCount > 0 ? "ok" : "warn",
      );
    } catch (err) {
      var message = err && err.message ? err.message : String(err);
      setStatus("Extraction failed: " + message, "error");
    }
  }

  function handleClearResume() {
    if (els.textarea) els.textarea.value = "";
    if (els.file) els.file.value = "";
    setStatus("Resume cleared.", "info");
  }

  function readForm() {
    var form = {};
    function take(key, el) {
      if (!el) return;
      var value = String(el.value || "").trim();
      if (value) form[key] = value;
    }
    take("targetRoles", els.targetRoles);
    take("skills", els.skills);
    take("seniority", els.seniority);
    take("locations", els.locations);
    take("remotePolicy", els.remotePolicy);
    take("industries", els.industries);

    if (els.years) {
      var raw = String(els.years.value || "").trim();
      if (raw) {
        var n = Number(raw);
        if (Number.isFinite(n) && n >= 0) form.yearsOfExperience = n;
      }
    }
    return form;
  }

  function hasAnyFormField(form) {
    if (!form) return false;
    for (var key in form) {
      if (Object.prototype.hasOwnProperty.call(form, key)) {
        var value = form[key];
        if (typeof value === "string" && value.trim() !== "") return true;
        if (typeof value === "number" && Number.isFinite(value)) return true;
      }
    }
    return false;
  }

  /**
   * Derive the /discovery-profile endpoint from the user's existing
   * discoveryWebhookUrl. The same worker exposes /webhook, /discovery, and
   * /discovery-profile; the dashboard stores whichever the user pasted in,
   * so we swap the trailing path. If none recognized, append /discovery-profile.
   */
  function resolveProfileEndpoint(baseUrl) {
    var base = String(baseUrl || "").trim();
    if (!base) return "";
    try {
      var u = new URL(base);
      var path = (u.pathname || "").replace(/\/+$/, "");
      // Replace only the trailing recognized segment so path-prefixed deployments
      // (/api/webhook -> /api/discovery-profile) resolve to the sibling endpoint
      // rather than a nested /api/webhook/discovery-profile 404.
      var replaced = path.replace(
        /\/(?:webhook|discovery|discovery-profile)$/i,
        "/discovery-profile",
      );
      if (replaced !== path) {
        u.pathname = replaced;
      } else if (path === "") {
        u.pathname = "/discovery-profile";
      } else {
        u.pathname = path + "/discovery-profile";
      }
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch (_) {
      return base.replace(/\/+$/, "") + "/discovery-profile";
    }
  }

  function readSettingValue(id) {
    var el = qs(id);
    return el && typeof el.value === "string" ? el.value.trim() : "";
  }

  function resolveWebhookConfig() {
    var url =
      readSettingValue("settingsDiscoveryWebhookUrl") ||
      (window.COMMAND_CENTER_CONFIG &&
      typeof window.COMMAND_CENTER_CONFIG.discoveryWebhookUrl === "string"
        ? window.COMMAND_CENTER_CONFIG.discoveryWebhookUrl.trim()
        : "");
    var secret =
      readSettingValue("settingsDiscoveryWebhookSecret") ||
      (window.COMMAND_CENTER_CONFIG &&
      typeof window.COMMAND_CENTER_CONFIG.discoveryWebhookSecret === "string"
        ? window.COMMAND_CENTER_CONFIG.discoveryWebhookSecret.trim()
        : "");
    var sheetId =
      readSettingValue("settingsSheetId") ||
      (window.COMMAND_CENTER_CONFIG &&
      typeof window.COMMAND_CENTER_CONFIG.sheetId === "string"
        ? window.COMMAND_CENTER_CONFIG.sheetId.trim()
        : "");
    return { url: url, secret: secret, sheetId: sheetId };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderResults(payload) {
    if (!els.results) return;
    if (!payload || payload.ok !== true) {
      els.results.hidden = true;
      els.results.innerHTML = "";
      return;
    }
    var profile = payload.profile || {};
    var companies = Array.isArray(payload.companies) ? payload.companies : [];
    var persisted = payload.persisted === true;

    var profileRows = [];
    function row(label, value) {
      if (!value || (Array.isArray(value) && value.length === 0)) return;
      var display = Array.isArray(value) ? value.join(", ") : String(value);
      profileRows.push(
        '<div class="settings-profile-profile-row">' +
          '<span class="settings-profile-profile-label">' +
          escapeHtml(label) +
          "</span>" +
          '<span class="settings-profile-profile-value">' +
          escapeHtml(display) +
          "</span>" +
          "</div>",
      );
    }
    row("Target roles", profile.targetRoles);
    row("Skills", profile.skills);
    row("Seniority", profile.seniority);
    if (Number.isFinite(profile.yearsOfExperience)) {
      row("Years of experience", String(profile.yearsOfExperience));
    }
    row("Locations", profile.locations);
    row("Remote policy", profile.remotePolicy);
    row("Industries", profile.industries);

    var companyCards = companies.map(function (c) {
      var name = escapeHtml(c && c.name ? c.name : "(unnamed)");
      var meta = [];
      if (c && Array.isArray(c.domains) && c.domains.length) {
        meta.push(
          '<span class="settings-profile-company-domains">' +
            escapeHtml(c.domains.join(", ")) +
            "</span>",
        );
      }
      if (c && Array.isArray(c.geoTags) && c.geoTags.length) {
        meta.push(
          '<span class="settings-profile-company-tag">' +
            escapeHtml(c.geoTags.join(", ")) +
            "</span>",
        );
      }
      if (c && Array.isArray(c.roleTags) && c.roleTags.length) {
        meta.push(
          '<span class="settings-profile-company-tag">' +
            escapeHtml(c.roleTags.join(", ")) +
            "</span>",
        );
      }
      var aliases =
        c && Array.isArray(c.aliases) && c.aliases.length
          ? '<div class="settings-profile-company-aliases">aka ' +
            escapeHtml(c.aliases.join(", ")) +
            "</div>"
          : "";
      var companyKey =
        c && typeof c.companyKey === "string" && c.companyKey
          ? c.companyKey
          : "";
      var skipButton = companyKey
        ? '<button type="button" class="settings-profile-skip-btn" ' +
          'data-company-key="' +
          escapeHtml(companyKey) +
          '" data-company-name="' +
          escapeHtml(c && c.name ? c.name : companyKey) +
          '" title="Skip this company — it won\'t re-appear on refresh">' +
          "Skip</button>"
        : "";
      return (
        '<li class="settings-profile-company" data-company-key="' +
        escapeHtml(companyKey) +
        '">' +
        '<div class="settings-profile-company-head">' +
        '<span class="settings-profile-company-name">' +
        name +
        "</span>" +
        (meta.length
          ? '<div class="settings-profile-company-meta">' +
            meta.join("") +
            "</div>"
          : "") +
        skipButton +
        "</div>" +
        aliases +
        "</li>"
      );
    });

    var persistBadge = persisted
      ? '<span class="settings-profile-badge settings-profile-badge--ok">Written to worker-config</span>'
      : '<span class="settings-profile-badge">Preview only</span>';

    els.results.innerHTML =
      '<div class="settings-profile-results-head">' +
      '<h5 class="settings-profile-block__title">Inferred profile</h5>' +
      persistBadge +
      "</div>" +
      (profileRows.length
        ? '<div class="settings-profile-profile">' +
          profileRows.join("") +
          "</div>"
        : '<p class="settings-field-hint">No profile fields inferred.</p>') +
      '<h5 class="settings-profile-block__title">Company shortlist (' +
      companies.length +
      ")</h5>" +
      (companyCards.length
        ? '<ul class="settings-profile-company-list">' +
          companyCards.join("") +
          "</ul>"
        : '<p class="settings-field-hint">No companies were inferred. Add more detail to the resume or form.</p>');

    els.results.hidden = false;
  }

  async function handleRun() {
    if (runInFlight) return;
    setError("");

    var resumeText = els.textarea ? String(els.textarea.value || "").trim() : "";
    var form = readForm();
    if (!resumeText && !hasAnyFormField(form)) {
      setError(
        "Add resume text (upload or paste) or fill at least one form field before running.",
      );
      return;
    }

    var config = resolveWebhookConfig();
    var endpoint = resolveProfileEndpoint(config.url);
    if (!endpoint) {
      setError(
        "No discovery webhook URL configured. Set it in the Discovery tab first.",
      );
      return;
    }

    var payload = {
      event: DISCOVERY_PROFILE_EVENT,
      schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
      persist: !!(els.persist && els.persist.checked),
    };
    if (resumeText) payload.resumeText = resumeText;
    if (hasAnyFormField(form)) payload.form = form;
    if (config.sheetId) payload.sheetId = config.sheetId;

    setRunning(true);
    if (els.results) {
      els.results.hidden = true;
      els.results.innerHTML = "";
    }
    // Tell the Runs modal (if open) that a manual run is now in flight so
    // it can show a ghost row at the top until the real row lands in the
    // sheet. Listener: runs-tab.js. Best-effort — document may be missing
    // in tests; ignore failures.
    dispatchDiscoveryRunEvent("jobbored:discovery-run-started", { trigger: "manual" });

    var runOk = false;
    var controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, RUN_TIMEOUT_MS)
      : null;

    try {
      var headers = { "Content-Type": "application/json" };
      if (config.secret) headers["x-discovery-secret"] = config.secret;

      // Surface the resolved endpoint in the console so future misrouting bugs
      // are one F12-open away from diagnosis.
      try {
        console.info("[settings-profile-tab] POST", endpoint);
      } catch (_) {
        // console may be unavailable in unusual embeddings
      }

      var res = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });
      var responseText = await res.text().catch(function () {
        return "";
      });
      var data = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (_) {
        data = null;
      }

      if (!res.ok) {
        var serverMessage =
          data && typeof data.message === "string"
            ? data.message
            : "Request failed with HTTP " + res.status + ".";
        var detail =
          data && typeof data.detail === "string" ? " — " + data.detail : "";
        // Suffix the attempted endpoint so a resolver bug (request landed on
        // the wrong path) is visible in the UI itself rather than requiring
        // the user to open DevTools.
        setError(serverMessage + detail + " [endpoint=" + endpoint + "]");
        return;
      }

      if (!data || data.ok !== true) {
        setError(
          data && typeof data.message === "string"
            ? data.message
            : "Unexpected response from worker.",
        );
        return;
      }

      runOk = true;
      renderResults(data);
      refreshStatusPanel();
    } catch (err) {
      if (err && err.name === "AbortError") {
        setError(
          "Request timed out after " +
            Math.round(RUN_TIMEOUT_MS / 1000) +
            "s. Worker may be cold-starting — try again.",
        );
      } else {
        var message = err && err.message ? err.message : String(err);
        setError("Request failed: " + message);
      }
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      setRunning(false);
      dispatchDiscoveryRunEvent("jobbored:discovery-run-finished", {
        trigger: "manual",
        ok: runOk,
      });
    }
  }

  // Best-effort CustomEvent dispatcher used by handleRun / handleRefresh.
  // Keeps runs-tab.js decoupled from this module's fetch internals.
  function dispatchDiscoveryRunEvent(name, detail) {
    try {
      if (typeof document === "undefined") return;
      if (typeof CustomEvent !== "function") return;
      document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (_) {
      // Swallow — this is purely a UX nicety for the Runs modal.
    }
  }

  // Shared helper for POSTing to /discovery-profile from non-run paths.
  // Returns parsed response or throws.
  async function postProfileEndpoint(payload, timeoutMs) {
    var config = resolveWebhookConfig();
    var endpoint = resolveProfileEndpoint(config.url);
    if (!endpoint) {
      throw new Error(
        "No discovery webhook URL configured. Set it in the Discovery tab first.",
      );
    }
    var headers = { "Content-Type": "application/json" };
    if (config.secret) headers["x-discovery-secret"] = config.secret;
    var body = Object.assign(
      {
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
      },
      payload || {},
    );
    if (config.sheetId && !body.sheetId) body.sheetId = config.sheetId;

    var controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, timeoutMs || RUN_TIMEOUT_MS)
      : null;

    try {
      console.info("[settings-profile-tab] POST", endpoint, "mode=" + (body.mode || "manual"));
      var res = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
      var text = await res.text().catch(function () {
        return "";
      });
      var data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        data = null;
      }
      if (!res.ok) {
        var message =
          (data && typeof data.message === "string"
            ? data.message
            : "Request failed with HTTP " + res.status) +
          (data && typeof data.detail === "string" ? " — " + data.detail : "") +
          " [endpoint=" + endpoint + "]";
        throw new Error(message);
      }
      return data;
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  }

  async function handleRefresh() {
    if (runInFlight) return;
    setError("");
    setRunning(true);
    if (els.results) {
      els.results.hidden = true;
      els.results.innerHTML = "";
    }
    dispatchDiscoveryRunEvent("jobbored:discovery-run-started", {
      trigger: "manual",
      mode: "refresh",
    });
    var refreshOk = false;
    try {
      var data = await postProfileEndpoint({ mode: "refresh" });
      if (!data || data.ok !== true) {
        setError(
          (data && data.message) ||
            "Refresh failed — no response from the worker.",
        );
        return;
      }
      refreshOk = true;
      renderResults(data);
      refreshStatusPanel();
    } catch (err) {
      if (err && err.name === "AbortError") {
        setError(
          "Refresh timed out after " +
            Math.round(RUN_TIMEOUT_MS / 1000) +
            "s. Worker may be cold-starting — try again.",
        );
      } else {
        setError("Refresh failed: " + (err && err.message ? err.message : err));
      }
    } finally {
      setRunning(false);
      dispatchDiscoveryRunEvent("jobbored:discovery-run-finished", {
        trigger: "manual",
        mode: "refresh",
        ok: refreshOk,
      });
    }
  }

  async function handleSkipCompany(companyKey, companyName, buttonEl) {
    if (!companyKey) return;
    if (buttonEl && buttonEl.disabled) return;
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = "Skipping…";
    }
    try {
      await postProfileEndpoint(
        {
          mode: "skip_company",
          skipCompanyKeys: [companyKey],
        },
        15000,
      );
      // Visually remove the skipped company from the rendered list so the UI
      // reflects the new negative-list entry without requiring a refresh.
      var row =
        buttonEl && buttonEl.closest ? buttonEl.closest(".settings-profile-company") : null;
      if (row && row.parentNode) row.parentNode.removeChild(row);
    } catch (err) {
      setError(
        "Could not skip " +
          (companyName || companyKey) +
          ": " +
          (err && err.message ? err.message : err),
      );
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = "Skip";
      }
    }
  }

  // ── Daily refresh status panel ─────────────────────────────────────
  // Short-circuit the worker to get a read-only snapshot of stored profile,
  // negative list, and last-refresh timestamp. Called on tab activation and
  // after every successful run/refresh so the panel reflects reality without
  // requiring a page reload.

  function formatRelativeAbsolute(isoDate) {
    if (!isoDate) return "";
    try {
      var d = new Date(isoDate);
      if (isNaN(d.getTime())) return isoDate;
      return (
        d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }) +
        " " +
        d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      );
    } catch (_) {
      return isoDate;
    }
  }

  function renderStatusPanel(status) {
    if (!els.statusPanel) return;
    if (!status) {
      els.statusPanel.hidden = true;
      els.statusPanel.innerHTML = "";
      return;
    }
    var auto = readAutoRefreshState();
    var storedValue = status.hasStoredProfile
      ? escapeHtml(
          status.resumeTextLength.toLocaleString() +
            " char resume" +
            (status.profileUpdatedAt
              ? " · updated " + formatRelativeAbsolute(status.profileUpdatedAt)
              : ""),
        )
      : '<span class="settings-profile-status__value--muted">Not saved yet — run Discover below to store one</span>';
    var lastRefreshValue = status.lastRefreshAt
      ? escapeHtml(
          formatRelativeAbsolute(status.lastRefreshAt) +
            (status.lastRefreshSource
              ? " (via " + status.lastRefreshSource + ")"
              : ""),
        )
      : '<span class="settings-profile-status__value--muted">Never</span>';
    var autoValue = auto.enabled
      ? escapeHtml("Every " + auto.intervalHours + "h (this tab only)")
      : '<span class="settings-profile-status__value--muted">Off</span>';
    var negativeValue = status.negativeCompanyCount
      ? escapeHtml(status.negativeCompanyCount + " skipped")
      : '<span class="settings-profile-status__value--muted">None</span>';
    var companyValue = escapeHtml(String(status.companyCount || 0));

    els.statusPanel.innerHTML =
      '<div class="settings-profile-status__head">📅 Daily refresh</div>' +
      '<div class="settings-profile-status__grid">' +
      '<span class="settings-profile-status__label">Stored profile</span>' +
      '<span class="settings-profile-status__value">' + storedValue + "</span>" +
      '<span class="settings-profile-status__label">Companies</span>' +
      '<span class="settings-profile-status__value">' + companyValue + "</span>" +
      '<span class="settings-profile-status__label">Auto-refresh</span>' +
      '<span class="settings-profile-status__value">' + autoValue + "</span>" +
      '<span class="settings-profile-status__label">Skipped</span>' +
      '<span class="settings-profile-status__value">' + negativeValue + "</span>" +
      '<span class="settings-profile-status__label">Last refresh</span>' +
      '<span class="settings-profile-status__value">' + lastRefreshValue + "</span>" +
      "</div>";
    els.statusPanel.hidden = false;
  }

  async function refreshStatusPanel() {
    if (!els.statusPanel) return;
    var config = resolveWebhookConfig();
    // Require both URL + sheetId; without sheetId the worker rejects status.
    if (!config.url || !config.sheetId) {
      renderStatusPanel(null);
      return;
    }
    try {
      var data = await postProfileEndpoint({ mode: "status" }, 10000);
      if (data && data.ok === true && data.status) {
        lastStatus = data.status;
        renderStatusPanel(lastStatus);
      }
    } catch (err) {
      // Non-fatal — status panel is a convenience. Keep the UI clean.
      try {
        console.info(
          "[settings-profile-tab] status fetch failed:",
          err && err.message ? err.message : err,
        );
      } catch (_) {
        // ignore
      }
    }
  }

  // ── Auto-refresh while tab is open ────────────────────────────────
  // Path A of the daily-refresh cadence options. Fires handleRefresh() at
  // the user-selected cadence (6/12/24h) while the dashboard tab is open.
  // State persists in localStorage so returning to the tab resumes the
  // schedule at the correct offset. Idempotent with Cloudflare cron — both
  // can be enabled; extra fires just overwrite the same company list.

  function readAutoRefreshState() {
    // Default to enabled so new users get passive discovery cadence for free.
    // The fallback only fires when AUTO_REFRESH_STORAGE_KEY has no record, so
    // users who previously chose "off" keep that choice — localStorage
    // distinguishes "no record" from "record with enabled:false".
    var fallback = { enabled: true, intervalHours: 12, lastFiredAt: 0 };
    try {
      var raw = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return fallback;
      var hours = Number(parsed.intervalHours);
      if (!AUTO_REFRESH_VALID_HOURS.includes(hours)) hours = 12;
      return {
        enabled: parsed.enabled === true,
        intervalHours: hours,
        lastFiredAt:
          typeof parsed.lastFiredAt === "number" && Number.isFinite(parsed.lastFiredAt)
            ? parsed.lastFiredAt
            : 0,
      };
    } catch (_) {
      return fallback;
    }
  }

  function writeAutoRefreshState(patch) {
    var current = readAutoRefreshState();
    var next = Object.assign({}, current, patch || {});
    if (!AUTO_REFRESH_VALID_HOURS.includes(Number(next.intervalHours))) {
      next.intervalHours = 12;
    }
    try {
      localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, JSON.stringify(next));
    } catch (_) {
      // Private mode / storage full — ignore; auto-refresh becomes session-only.
    }
    return next;
  }

  function applyAutoRefreshUiFromState() {
    var state = readAutoRefreshState();
    if (els.autoRefreshToggle) els.autoRefreshToggle.checked = state.enabled;
    if (els.autoRefreshCadence)
      els.autoRefreshCadence.value = String(state.intervalHours);
    updateAutoRefreshHint();
  }

  function updateAutoRefreshHint() {
    if (!els.autoRefreshHint) return;
    var state = readAutoRefreshState();
    if (!state.enabled) {
      els.autoRefreshHint.textContent =
        "Zero-infra cadence. Runs in this browser tab only; closing the tab pauses the schedule.";
      return;
    }
    var intervalMs = state.intervalHours * 3600 * 1000;
    var nextAt = state.lastFiredAt ? state.lastFiredAt + intervalMs : Date.now();
    var when = new Date(nextAt);
    els.autoRefreshHint.textContent =
      "Enabled. Next fire around " +
      when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
      ". Closing this tab pauses the schedule.";
  }

  function clearAutoRefreshTimer() {
    if (autoRefreshTimerId !== null) {
      window.clearTimeout(autoRefreshTimerId);
      autoRefreshTimerId = null;
    }
  }

  function scheduleAutoRefresh(delayMs) {
    clearAutoRefreshTimer();
    var state = readAutoRefreshState();
    if (!state.enabled) return;
    var wait = Math.max(0, Number(delayMs) || 0);
    autoRefreshTimerId = window.setTimeout(async function () {
      autoRefreshTimerId = null;
      // Skip this tick if a run is already in flight; reschedule for the
      // next interval. Guards against double-firing when the user kicks off
      // a manual run that overlaps the scheduled fire.
      if (!runInFlight) {
        try {
          await handleRefresh();
        } catch (_) {
          // handleRefresh already surfaces errors in the UI; swallow here so
          // the timer loop keeps running through transient failures.
        }
      }
      writeAutoRefreshState({ lastFiredAt: Date.now() });
      updateAutoRefreshHint();
      // After the run completes, refresh the status panel so lastRefreshAt
      // is reflected in the UI without a page reload.
      refreshStatusPanel();
      var current = readAutoRefreshState();
      if (current.enabled) {
        scheduleAutoRefresh(current.intervalHours * 3600 * 1000);
      }
    }, wait);
  }

  function initAutoRefresh() {
    applyAutoRefreshUiFromState();
    var state = readAutoRefreshState();
    if (!state.enabled) return;
    var intervalMs = state.intervalHours * 3600 * 1000;
    var elapsed = state.lastFiredAt ? Date.now() - state.lastFiredAt : intervalMs;
    var delay = elapsed >= intervalMs ? 0 : intervalMs - elapsed;
    scheduleAutoRefresh(delay);
  }

  function handleAutoRefreshToggleChange() {
    var enabled = !!(els.autoRefreshToggle && els.autoRefreshToggle.checked);
    writeAutoRefreshState({ enabled });
    updateAutoRefreshHint();
    if (enabled) {
      var state = readAutoRefreshState();
      var intervalMs = state.intervalHours * 3600 * 1000;
      var elapsed = state.lastFiredAt ? Date.now() - state.lastFiredAt : intervalMs;
      scheduleAutoRefresh(elapsed >= intervalMs ? 0 : intervalMs - elapsed);
    } else {
      clearAutoRefreshTimer();
    }
    refreshStatusPanel();
  }

  function handleAutoRefreshCadenceChange() {
    if (!els.autoRefreshCadence) return;
    var hours = Number(els.autoRefreshCadence.value);
    if (!AUTO_REFRESH_VALID_HOURS.includes(hours)) hours = 12;
    writeAutoRefreshState({ intervalHours: hours });
    updateAutoRefreshHint();
    var state = readAutoRefreshState();
    if (state.enabled) {
      scheduleAutoRefresh(hours * 3600 * 1000);
    }
    refreshStatusPanel();
  }

  // ── Schedule card: Tier 2 (local OS) + Tier 3 (GitHub Actions) ─────
  // Tier 1 (browser tab auto-refresh) lives in the auto-refresh block above.
  // These helpers are pure where possible so the client tests can import
  // them via window.JobBoredSettingsProfileTab.schedule and exercise the
  // OS-detection / YAML-download / install-command code paths without a DOM.

  function detectOs(userAgent, platform) {
    var ua = String(userAgent || "").toLowerCase();
    var pl = String(platform || "").toLowerCase();
    if (pl.indexOf("win") !== -1 || ua.indexOf("windows") !== -1) return "win32";
    if (pl.indexOf("mac") !== -1 || pl.indexOf("darwin") !== -1 || ua.indexOf("mac os") !== -1) {
      return "darwin";
    }
    if (pl.indexOf("linux") !== -1 || ua.indexOf("linux") !== -1) return "linux";
    return "other";
  }

  function clampHour(hour, fallback) {
    var n = Number(hour);
    if (Number.isFinite(n) && n >= 0 && n <= 23 && Math.floor(n) === n) return n;
    return fallback;
  }

  function clampMinute(minute, fallback) {
    var n = Number(minute);
    if (Number.isFinite(n) && n >= 0 && n <= 59 && Math.floor(n) === n) return n;
    return fallback;
  }

  function parseTimeString(value) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
    if (!m) return null;
    var hour = clampHour(Number(m[1]), null);
    var minute = clampMinute(Number(m[2]), null);
    if (hour === null || minute === null) return null;
    return { hour: hour, minute: minute };
  }

  function formatTimeString(hour, minute) {
    var h = String(clampHour(hour, 0)).padStart(2, "0");
    var m = String(clampMinute(minute, 0)).padStart(2, "0");
    return h + ":" + m;
  }

  function buildInstallCommand(platform, hour, minute) {
    var h = clampHour(hour, 8);
    var m = clampMinute(minute, 0);
    return (
      "npm run schedule:install -- --hour " + String(h) + " --minute " + String(m)
    );
  }

  function buildUninstallCommand() {
    return "npm run schedule:uninstall";
  }

  function describeOsArtifact(platform) {
    switch (platform) {
      case "darwin":
        return "macOS detected — the install command will register a launchd agent in ~/Library/LaunchAgents.";
      case "linux":
        return "Linux detected — the install command will register a systemd user timer (or crontab as fallback).";
      case "win32":
        return "Windows detected — the install command will register a Task Scheduler task. Run it from a Command Prompt or PowerShell in the repo folder.";
      default:
        return "Unrecognized OS — Tier 2 may not be supported here. Tier 3 (GitHub Actions) is a good alternative.";
    }
  }

  function formatCronLine(hour, minute) {
    var h = clampHour(hour, 14);
    var m = clampMinute(minute, 0);
    return String(m) + " " + String(h) + " * * *";
  }

  function buildGithubActionsYaml(hour, minute, template) {
    var source =
      typeof template === "string" && template
        ? template
        : GITHUB_ACTIONS_TEMPLATE;
    var h = clampHour(hour, 14);
    var m = clampMinute(minute, 0);
    var cron = formatCronLine(h, m);
    var hh = String(h).padStart(2, "0");
    var mm = String(m).padStart(2, "0");
    var out = source.replace(
      /- cron: "[^"]*"/,
      '- cron: "' + cron + '"',
    );
    out = out.replace(
      /# Daily [0-9]{1,2}:[0-9]{2} UTC[^\n]*/,
      "# Daily " +
        hh +
        ":" +
        mm +
        " UTC — matches the time picked in Settings → Profile → Schedule",
    );
    return out;
  }

  function formatLocalTimeFromUtc(utcHour, utcMinute, referenceDate) {
    var h = clampHour(utcHour, 14);
    var m = clampMinute(utcMinute, 0);
    var base = referenceDate instanceof Date ? referenceDate : new Date();
    var d = new Date(
      Date.UTC(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        h,
        m,
        0,
        0,
      ),
    );
    return formatTimeString(d.getHours(), d.getMinutes());
  }

  function readScheduleState(storageKey, defaults) {
    var fallback = {
      enabled: false,
      hour: defaults.hour,
      minute: defaults.minute,
    };
    try {
      var raw = localStorage.getItem(storageKey);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return fallback;
      return {
        enabled: parsed.enabled === true,
        hour: clampHour(parsed.hour, defaults.hour),
        minute: clampMinute(parsed.minute, defaults.minute),
      };
    } catch (_) {
      return fallback;
    }
  }

  function writeScheduleState(storageKey, patch, defaults) {
    var current = readScheduleState(storageKey, defaults);
    var next = {
      enabled: patch && patch.enabled != null ? !!patch.enabled : current.enabled,
      hour: clampHour(patch && patch.hour, current.hour),
      minute: clampMinute(patch && patch.minute, current.minute),
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (_) {
      // Private mode / quota — state becomes session-only; non-fatal.
    }
    return next;
  }

  function readLocalScheduleState() {
    return readScheduleState(SCHEDULE_LOCAL_STORAGE_KEY, { hour: 8, minute: 0 });
  }

  function writeLocalScheduleState(patch) {
    return writeScheduleState(SCHEDULE_LOCAL_STORAGE_KEY, patch, {
      hour: 8,
      minute: 0,
    });
  }

  function readCloudScheduleState() {
    return readScheduleState(SCHEDULE_CLOUD_STORAGE_KEY, { hour: 14, minute: 0 });
  }

  function writeCloudScheduleState(patch) {
    return writeScheduleState(SCHEDULE_CLOUD_STORAGE_KEY, patch, {
      hour: 14,
      minute: 0,
    });
  }

  function renderLocalBadge(statusResponse) {
    if (!els.scheduleLocalBadge) return;
    var badge = els.scheduleLocalBadge;
    var artifact = els.scheduleLocalArtifact;
    var installed =
      statusResponse && statusResponse.installed === true ? true : false;
    var artifactPath =
      statusResponse &&
      statusResponse.installedArtifact &&
      typeof statusResponse.installedArtifact.path === "string"
        ? statusResponse.installedArtifact.path
        : "";
    if (installed) {
      badge.textContent = "Installed";
      badge.classList.add("settings-profile-badge--ok");
      badge.setAttribute("data-state", "installed");
      if (artifact) {
        if (artifactPath) {
          artifact.textContent = "Artifact: " + artifactPath;
          artifact.hidden = false;
        } else {
          artifact.textContent = "";
          artifact.hidden = true;
        }
      }
    } else {
      badge.textContent = "Not installed yet";
      badge.classList.remove("settings-profile-badge--ok");
      badge.setAttribute("data-state", "not_installed");
      if (artifact) {
        artifact.textContent = "";
        artifact.hidden = true;
      }
    }
  }

  function renderCloudBadge(enabled) {
    if (!els.scheduleCloudBadge) return;
    var badge = els.scheduleCloudBadge;
    if (enabled) {
      badge.textContent = "Advisory — verify in your GitHub Actions tab";
      badge.setAttribute("data-state", "advisory");
    } else {
      badge.textContent = "Advisory";
      badge.setAttribute("data-state", "idle");
    }
  }

  function applyLocalUiFromState() {
    var state = readLocalScheduleState();
    if (els.scheduleLocalEnable) els.scheduleLocalEnable.checked = state.enabled;
    if (els.scheduleLocalTime) {
      els.scheduleLocalTime.value = formatTimeString(state.hour, state.minute);
    }
    var platform = detectOs(
      typeof navigator !== "undefined" ? navigator.userAgent : "",
      typeof navigator !== "undefined" ? navigator.platform : "",
    );
    if (els.scheduleLocalOsHint) {
      els.scheduleLocalOsHint.textContent = describeOsArtifact(platform);
    }
    if (els.scheduleLocalCommand) {
      els.scheduleLocalCommand.textContent = buildInstallCommand(
        platform,
        state.hour,
        state.minute,
      );
    }
  }

  function applyCloudUiFromState() {
    var state = readCloudScheduleState();
    if (els.scheduleCloudEnable) els.scheduleCloudEnable.checked = state.enabled;
    if (els.scheduleCloudTime) {
      els.scheduleCloudTime.value = formatTimeString(state.hour, state.minute);
    }
    if (els.scheduleCloudLocalPreview) {
      var local = formatLocalTimeFromUtc(state.hour, state.minute);
      els.scheduleCloudLocalPreview.textContent =
        formatTimeString(state.hour, state.minute) +
        " UTC is about " +
        local +
        " in your local time today.";
    }
    renderCloudBadge(state.enabled);
  }

  // Debounced schedule-save by mode so rapid time-picker changes coalesce
  // into a single POST, and cross-tier changes don't cancel each other.
  var scheduleSaveTimers = { local: null, github: null };

  function setScheduleError(kind, message) {
    var el = kind === "local" ? els.scheduleLocalError : els.scheduleCloudError;
    if (!el) return;
    if (!message) {
      el.textContent = "";
      el.hidden = true;
      el.style.display = "none";
      return;
    }
    el.textContent = String(message);
    el.hidden = false;
    el.style.display = "";
  }

  function postScheduleSave(mode, state) {
    var payload = {
      mode: "schedule-save",
      schedule: {
        enabled: !!state.enabled,
        hour: state.hour,
        minute: state.minute,
        mode: mode,
      },
    };
    return postProfileEndpoint(payload, 15000);
  }

  function scheduleSaveDebounced(mode, state) {
    var bucket = mode === "github" ? "github" : "local";
    if (scheduleSaveTimers[bucket] !== null) {
      window.clearTimeout(scheduleSaveTimers[bucket]);
    }
    scheduleSaveTimers[bucket] = window.setTimeout(function () {
      scheduleSaveTimers[bucket] = null;
      postScheduleSave(mode, state)
        .catch(function (err) {
          setScheduleError(
            bucket === "github" ? "github" : "local",
            "Couldn't save schedule: " + (err && err.message ? err.message : err),
          );
        })
        .then(function () {
          // Refresh the installed-status badge so enable/disable and
          // time changes reflect in the UI without a page reload.
          return fetchScheduleStatus();
        });
    }, SCHEDULE_SAVE_DEBOUNCE_MS);
  }

  function postScheduleSaveImmediate(mode, state) {
    var bucket = mode === "github" ? "github" : "local";
    if (scheduleSaveTimers[bucket] !== null) {
      window.clearTimeout(scheduleSaveTimers[bucket]);
      scheduleSaveTimers[bucket] = null;
    }
    return postScheduleSave(mode, state)
      .catch(function (err) {
        setScheduleError(
          bucket === "github" ? "github" : "local",
          "Couldn't save schedule: " + (err && err.message ? err.message : err),
        );
      })
      .then(function () {
        // Refresh the installed-status badge so enable/disable and
        // time changes reflect in the UI without a page reload.
        return fetchScheduleStatus();
      });
  }

  var scheduleStatusRetryTimerId = null;
  var scheduleStatusRetryAttempt = 0;
  var SCHEDULE_STATUS_RETRY_DELAYS_MS = [300, 800, 2000, 5000];

  async function fetchScheduleStatus() {
    var config = resolveWebhookConfig();
    if (!config.url || !config.sheetId) {
      // The webhook/sheet config isn't populated yet — common right after a
      // hard refresh when app.js hydrates COMMAND_CENTER_CONFIG async. Retry
      // on a short schedule so the badge settles on the real state instead
      // of locking to "Not installed". After the last retry budget, render
      // null (gray) and wait for the next mount.
      renderLocalBadge(null);
      if (scheduleStatusRetryTimerId !== null) {
        window.clearTimeout(scheduleStatusRetryTimerId);
        scheduleStatusRetryTimerId = null;
      }
      if (scheduleStatusRetryAttempt < SCHEDULE_STATUS_RETRY_DELAYS_MS.length) {
        var delay = SCHEDULE_STATUS_RETRY_DELAYS_MS[scheduleStatusRetryAttempt];
        scheduleStatusRetryAttempt += 1;
        scheduleStatusRetryTimerId = window.setTimeout(function () {
          scheduleStatusRetryTimerId = null;
          fetchScheduleStatus();
        }, delay);
      }
      return null;
    }
    scheduleStatusRetryAttempt = 0;
    if (scheduleStatusRetryTimerId !== null) {
      window.clearTimeout(scheduleStatusRetryTimerId);
      scheduleStatusRetryTimerId = null;
    }
    try {
      var data = await postProfileEndpoint({ mode: "schedule-status" }, 10000);
      if (data && data.ok === true) {
        renderLocalBadge(data);
      }
      return data;
    } catch (err) {
      // Non-fatal — don't surface an error toast for a convenience badge.
      try {
        console.info(
          "[settings-profile-tab] schedule-status fetch failed:",
          err && err.message ? err.message : err,
        );
      } catch (_) {
        // ignore
      }
      return null;
    }
  }

  async function copyToClipboard(text) {
    var value = String(text || "");
    if (!value) return false;
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_) {
        // fall through to legacy path
      }
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  function downloadBlob(filename, contents, mimeType) {
    var blob = new Blob([contents], {
      type: mimeType || "application/octet-stream",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on next tick so the browser has time to start the download.
    window.setTimeout(function () {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // ignore
      }
    }, 0);
  }

  function handleScheduleLocalTimeChange() {
    if (!els.scheduleLocalTime) return;
    var parsed = parseTimeString(els.scheduleLocalTime.value);
    if (!parsed) return;
    var state = writeLocalScheduleState({
      hour: parsed.hour,
      minute: parsed.minute,
    });
    applyLocalUiFromState();
    setScheduleError("local", "");
    if (state.enabled) {
      scheduleSaveDebounced("local", state);
    }
  }

  function handleScheduleLocalEnableChange() {
    if (!els.scheduleLocalEnable) return;
    var enabled = !!els.scheduleLocalEnable.checked;
    var state = writeLocalScheduleState({ enabled: enabled });
    applyLocalUiFromState();
    setScheduleError("local", "");
    postScheduleSaveImmediate("local", state);
  }

  async function handleScheduleLocalCopyInstall() {
    var state = readLocalScheduleState();
    var platform = detectOs(
      typeof navigator !== "undefined" ? navigator.userAgent : "",
      typeof navigator !== "undefined" ? navigator.platform : "",
    );
    var cmd = buildInstallCommand(platform, state.hour, state.minute);
    var ok = await copyToClipboard(cmd);
    if (els.scheduleLocalCopyInstall) {
      var original = "Copy install command";
      els.scheduleLocalCopyInstall.textContent = ok ? "Copied ✓" : "Copy failed";
      window.setTimeout(function () {
        if (els.scheduleLocalCopyInstall) {
          els.scheduleLocalCopyInstall.textContent = original;
        }
      }, 1500);
    }
  }

  async function handleScheduleLocalCopyUninstall() {
    var ok = await copyToClipboard(buildUninstallCommand());
    if (els.scheduleLocalCopyUninstall) {
      var original = "Copy uninstall command";
      els.scheduleLocalCopyUninstall.textContent = ok ? "Copied ✓" : "Copy failed";
      window.setTimeout(function () {
        if (els.scheduleLocalCopyUninstall) {
          els.scheduleLocalCopyUninstall.textContent = original;
        }
      }, 1500);
    }
  }

  function handleScheduleCloudTimeChange() {
    if (!els.scheduleCloudTime) return;
    var parsed = parseTimeString(els.scheduleCloudTime.value);
    if (!parsed) return;
    var state = writeCloudScheduleState({
      hour: parsed.hour,
      minute: parsed.minute,
    });
    applyCloudUiFromState();
    setScheduleError("github", "");
    if (state.enabled) {
      scheduleSaveDebounced("github", state);
    }
  }

  function handleScheduleCloudEnableChange() {
    if (!els.scheduleCloudEnable) return;
    var enabled = !!els.scheduleCloudEnable.checked;
    var state = writeCloudScheduleState({ enabled: enabled });
    applyCloudUiFromState();
    setScheduleError("github", "");
    postScheduleSaveImmediate("github", state);
  }

  function handleScheduleCloudDownload() {
    var state = readCloudScheduleState();
    var yaml = buildGithubActionsYaml(state.hour, state.minute);
    downloadBlob(SCHEDULE_GITHUB_FILENAME, yaml, "text/yaml");
  }

  function initSchedule() {
    if (!els.scheduleLocalTime && !els.scheduleCloudTime) return;
    applyLocalUiFromState();
    applyCloudUiFromState();
    // Kick off a background status fetch; badge updates when it resolves.
    fetchScheduleStatus();
  }

  // Pull the user's active resume from the Resume tab's IndexedDB store so
  // the Profile tab stops asking for a re-upload every session. No-ops if
  // the store hasn't loaded yet, the user has no resume on file, or the
  // textarea already has content (don't clobber a freshly-pasted resume).
  async function autoPopulateResumeFromStore() {
    if (!els.textarea) return;
    if (String(els.textarea.value || "").trim()) return;
    var store = window.CommandCenterUserContent;
    if (!store || typeof store.getActiveResume !== "function") return;
    try {
      var active = await store.getActiveResume();
      var text = active && active.extractedText
        ? String(active.extractedText).trim()
        : "";
      if (!text) return;
      if (String(els.textarea.value || "").trim()) return; // user typed while we waited
      els.textarea.value = text;
      var chars = text.length;
      setStatus(
        "Loaded resume from Resume tab (" +
          chars.toLocaleString() +
          " characters). You can edit or clear it before discovering.",
        "info",
      );
    } catch (err) {
      // Non-fatal — the user can always paste or upload manually.
      try {
        console.info(
          "[settings-profile-tab] auto-populate resume failed:",
          err && err.message ? err.message : err,
        );
      } catch (_) {
        // ignore
      }
    }
  }

  function bind() {
    if (bound) return;
    cacheElements();
    if (!els.runBtn) return;
    // Fire-and-forget: populate resume from the Resume tab's store. Runs in
    // parallel with the rest of bind(); UI stays responsive.
    autoPopulateResumeFromStore();
    if (els.file) els.file.addEventListener("change", handleFileChange);
    if (els.clearBtn) els.clearBtn.addEventListener("click", handleClearResume);
    els.runBtn.addEventListener("click", handleRun);
    if (els.refreshBtn) els.refreshBtn.addEventListener("click", handleRefresh);
    if (els.autoRefreshToggle) {
      els.autoRefreshToggle.addEventListener(
        "change",
        handleAutoRefreshToggleChange,
      );
    }
    if (els.autoRefreshCadence) {
      els.autoRefreshCadence.addEventListener(
        "change",
        handleAutoRefreshCadenceChange,
      );
    }
    // Delegated click handler for per-company Skip buttons rendered inside
    // els.results. Survives re-renders without needing to re-bind per row.
    if (els.results) {
      els.results.addEventListener("click", function (event) {
        var target =
          event && event.target && event.target.closest
            ? event.target.closest(".settings-profile-skip-btn")
            : null;
        if (!target) return;
        var key = target.getAttribute("data-company-key");
        var name = target.getAttribute("data-company-name") || key;
        if (key) handleSkipCompany(key, name, target);
      });
    }
    if (els.scheduleLocalEnable) {
      els.scheduleLocalEnable.addEventListener(
        "change",
        handleScheduleLocalEnableChange,
      );
    }
    if (els.scheduleLocalTime) {
      els.scheduleLocalTime.addEventListener(
        "change",
        handleScheduleLocalTimeChange,
      );
      els.scheduleLocalTime.addEventListener(
        "input",
        handleScheduleLocalTimeChange,
      );
    }
    if (els.scheduleLocalCopyInstall) {
      els.scheduleLocalCopyInstall.addEventListener(
        "click",
        handleScheduleLocalCopyInstall,
      );
    }
    if (els.scheduleLocalCopyUninstall) {
      els.scheduleLocalCopyUninstall.addEventListener(
        "click",
        handleScheduleLocalCopyUninstall,
      );
    }
    if (els.scheduleCloudEnable) {
      els.scheduleCloudEnable.addEventListener(
        "change",
        handleScheduleCloudEnableChange,
      );
    }
    if (els.scheduleCloudTime) {
      els.scheduleCloudTime.addEventListener(
        "change",
        handleScheduleCloudTimeChange,
      );
      els.scheduleCloudTime.addEventListener(
        "input",
        handleScheduleCloudTimeChange,
      );
    }
    if (els.scheduleCloudDownload) {
      els.scheduleCloudDownload.addEventListener(
        "click",
        handleScheduleCloudDownload,
      );
    }
    initAutoRefresh();
    initSchedule();
    refreshStatusPanel();
    bound = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.JobBoredSettingsProfileTab = {
    bind: bind,
    resolveProfileEndpoint: resolveProfileEndpoint,
    refreshStatusPanel: refreshStatusPanel,
    autoRefresh: {
      readAutoRefreshState: readAutoRefreshState,
      writeAutoRefreshState: writeAutoRefreshState,
      STORAGE_KEY: AUTO_REFRESH_STORAGE_KEY,
      VALID_HOURS: AUTO_REFRESH_VALID_HOURS,
    },
    schedule: {
      detectOs: detectOs,
      buildInstallCommand: buildInstallCommand,
      buildUninstallCommand: buildUninstallCommand,
      describeOsArtifact: describeOsArtifact,
      formatCronLine: formatCronLine,
      buildGithubActionsYaml: buildGithubActionsYaml,
      formatLocalTimeFromUtc: formatLocalTimeFromUtc,
      parseTimeString: parseTimeString,
      formatTimeString: formatTimeString,
      readLocalScheduleState: readLocalScheduleState,
      writeLocalScheduleState: writeLocalScheduleState,
      readCloudScheduleState: readCloudScheduleState,
      writeCloudScheduleState: writeCloudScheduleState,
      renderLocalBadge: renderLocalBadge,
      renderCloudBadge: renderCloudBadge,
      STORAGE_KEYS: {
        local: SCHEDULE_LOCAL_STORAGE_KEY,
        cloud: SCHEDULE_CLOUD_STORAGE_KEY,
      },
      GITHUB_ACTIONS_TEMPLATE: GITHUB_ACTIONS_TEMPLATE,
    },
  };
})();
