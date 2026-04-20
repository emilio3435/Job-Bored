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

  var els = {};
  var bound = false;
  var runInFlight = false;

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
      spinner: qs("settingsProfileSpinner"),
      error: qs("settingsProfileError"),
      results: qs("settingsProfileResults"),
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
      if (
        path === "/webhook" ||
        path === "/discovery" ||
        path === "/discovery-profile"
      ) {
        u.pathname = "/discovery-profile";
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
      return (
        '<li class="settings-profile-company">' +
        '<div class="settings-profile-company-head">' +
        '<span class="settings-profile-company-name">' +
        name +
        "</span>" +
        (meta.length
          ? '<div class="settings-profile-company-meta">' +
            meta.join("") +
            "</div>"
          : "") +
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
        setError(serverMessage + detail);
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

      renderResults(data);
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
    }
  }

  function bind() {
    if (bound) return;
    cacheElements();
    if (!els.runBtn) return;
    if (els.file) els.file.addEventListener("change", handleFileChange);
    if (els.clearBtn) els.clearBtn.addEventListener("click", handleClearResume);
    els.runBtn.addEventListener("click", handleRun);
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
  };
})();
