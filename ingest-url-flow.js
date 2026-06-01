/* ============================================
   COMMAND CENTER v2 — Ingest URL Flow
   Extracted from app.js (ingest-url-flow cut).

   Classic-global IIFE under window.JobBoredDiscovery.ingestUrlFlow — NOT an ES module.
   Loaded BEFORE app.js (after discovery-drawer.js when present).
   Paste-a-job URL ingest, manual fallback modal, async polling, auto-enrich.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const ingestUrlFlow = root.ingestUrlFlow || (root.ingestUrlFlow = {});

  const statusApi = window.JobBoredDiscovery.status;
  const MAX_POLL_ERRORS = 3;

  function host() {
    return ingestUrlFlow.host || {};
  }

  function h(name, ...args) {
    const fn = host()[name];
    return typeof fn === "function" ? fn(...args) : undefined;
  }

const INGEST_URL_TIMEOUT_MS = 60000;
const INGEST_URL_ASYNC_TIMEOUT_MS = 10 * 60 * 1000;
const INGEST_URL_ASYNC_POLL_MS = 3000;
const INGEST_URL_BLOCKED_HOST_LABELS = {
  "linkedin.com": "LinkedIn",
  "indeed.com": "Indeed",
  "glassdoor.com": "Glassdoor",
  "ziprecruiter.com": "ZipRecruiter",
};

function resolveIngestUrlEndpoint(baseUrl) {
  const base = String(baseUrl || "").trim();
  if (!base) return "";
  try {
    const u = new URL(base);
    const path = (u.pathname || "").replace(/\/+$/, "");
    const replaced = path.replace(
      /\/(?:webhook|discovery|discovery-profile|ingest-url)$/i,
      "/ingest-url",
    );
    if (replaced !== path) {
      u.pathname = replaced;
    } else if (path === "") {
      u.pathname = "/ingest-url";
    } else {
      u.pathname = path + "/ingest-url";
    }
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch (_) {
    return base.replace(/\/+$/, "") + "/ingest-url";
  }
}

function isParseableUrl(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function aggregatorLabelForHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^www\./, "");
  for (const key in INGEST_URL_BLOCKED_HOST_LABELS) {
    if (h === key || h.endsWith("." + key)) {
      return INGEST_URL_BLOCKED_HOST_LABELS[key];
    }
  }
  return host || "this site";
}

function reportIngestProgress(onProgress, progress, label, step) {
  if (typeof onProgress !== "function") return;
  try {
    onProgress({
      progress: Math.max(0, Math.min(100, Number(progress) || 0)),
      label: String(label || ""),
      step: step || "",
    });
  } catch (_) {
    // Progress callbacks are UI sugar; ingest should not depend on them.
  }
}

function getDuplicatePipelineIndexFromIngest(url, data) {
  const rowNumber = Number(data && data.rowNumber);
  if (Number.isFinite(rowNumber) && rowNumber >= 2) {
    const fromRow = rowNumber - 2;
    if (h("getPipelineData")[fromRow]) return fromRow;
  }
  const normalized = h("normalizeLeadUrlClient", url || "");
  if (!normalized) return -1;
  return h("getPipelineData").findIndex((job) => {
    if (!job || !job.link) return false;
    return h("normalizeLeadUrlClient", job.link) === normalized;
  });
}

function focusPipelineJobByIndex(dataIndex) {
  if (!Number.isInteger(dataIndex) || dataIndex < 0) return false;
  const pipelineApi = window.JobBoredPipeline;
  if (pipelineApi && typeof pipelineApi.focusJob === "function") {
    try {
      if (pipelineApi.focusJob(String(dataIndex))) return true;
    } catch (_) {
      /* fall through */
    }
  }
  const selectors = [
    `[data-stable-key="${String(dataIndex).replace(/"/g, '\\"')}"]`,
    `[data-index="${String(dataIndex).replace(/"/g, '\\"')}"]`,
  ];
  for (const selector of selectors) {
    const card = document.querySelector(selector);
    if (!card) continue;
    card.classList.add("duplicate-focus", "is-highlighted");
    card.setAttribute("data-selected", "true");
    try {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_) {
      card.scrollIntoView();
    }
    setTimeout(() => {
      card.classList.remove("duplicate-focus", "is-highlighted");
    }, 2400);
    return true;
  }
  return false;
}

function clearPipelineRevealFilters() {
  if (typeof document === "undefined") return false;
  let rendered = false;
  if (h("getCurrentSearch")) {
    h("setCurrentSearch", "");
    rendered = true;
  }
  const legacySearch = document.getElementById("searchInput");
  if (legacySearch && legacySearch.value) legacySearch.value = "";

  if (h("getFavoritesOnly")) {
    h("setFavoritesOnly", false);
    rendered = true;
    h("syncPipelineFilterControls");
    h("notifyPipelineFiltersChanged");
  }

  let v2SearchChanged = false;
  document.querySelectorAll("[data-pipeline-search]").forEach((input) => {
    if (input && input.value) {
      input.value = "";
      v2SearchChanged = true;
    }
  });
  document.querySelectorAll('[data-region="pipeline"]').forEach((region) => {
    if (region && region.__pipeState && region.__pipeState.search) {
      region.__pipeState.search = "";
      v2SearchChanged = true;
    }
  });

  if (rendered && typeof host().renderPipeline === "function") {
    h("renderPipeline");
  }
  if (
    v2SearchChanged &&
    window.JobBoredPipeline &&
    typeof window.JobBoredPipeline.scheduleRender === "function"
  ) {
    window.JobBoredPipeline.scheduleRender();
  }
  return rendered || v2SearchChanged;
}

function revealPipelineJobByIndex(dataIndex) {
  const idx = Number(dataIndex);
  if (!Number.isInteger(idx) || idx < 0 || !h("getPipelineData")[idx]) return false;
  clearPipelineRevealFilters();
  const focused = focusPipelineJobByIndex(idx);
  if (!focused && typeof setTimeout === "function") {
    setTimeout(() => {
      focusPipelineJobByIndex(idx);
    }, 120);
  }
  return focused;
}

function createIngestVerificationError(result, endpointUrl, fallbackMessage) {
  const message =
    (result && result.message) ||
    fallbackMessage ||
    "Could not reach the discovery worker.";
  const err = new Error(message);
  err.discoveryVerificationResult = result || null;
  err.endpointUrl = endpointUrl || "";
  return err;
}

function classifyIngestEndpointFailure({
  endpointUrl,
  status,
  data,
  responseText,
  responseUrl,
}) {
  const verifyApi = h("getDiscoveryWizardVerifyApi");
  if (verifyApi && typeof verifyApi.summarizeResult === "function") {
    return verifyApi.summarizeResult({
      context: "ingest_url",
      status,
      data,
      responseText,
      responseUrl: responseUrl || endpointUrl,
      endpointUrl,
    });
  }
  return {
    ok: false,
    kind: status === 401 ? "auth_required" : "invalid_endpoint",
    engineState: "none",
    httpStatus: Number(status) || 0,
    message:
      status === 401
        ? "The discovery worker needs a webhook secret."
        : "The ingest endpoint returned an error.",
    detail: responseText || "",
    layer: "upstream",
  };
}

function classifyIngestNetworkFailure(endpointUrl, err) {
  const verifyApi = h("getDiscoveryWizardVerifyApi");
  if (verifyApi && typeof verifyApi.createVerificationResult === "function") {
    return verifyApi.createVerificationResult({
      ok: false,
      kind: "network_error",
      engineState: "none",
      httpStatus: 0,
      message: "Can't reach the endpoint.",
      detail:
        "The browser lost the ingest connection. Likely causes: CORS, Cloudflare Access, a stale tunnel, or the worker being offline. Tried: " +
        endpointUrl,
      layer: "browser",
    });
  }
  return {
    ok: false,
    kind: "network_error",
    engineState: "none",
    httpStatus: 0,
    message: "Can't reach the endpoint.",
    detail: err && err.message ? err.message : String(err || ""),
    layer: "browser",
  };
}

function formatDiscoveryVerificationError(result, fallback) {
  if (!result || typeof result !== "object") return fallback || "";
  const detail =
    result.detail && result.detail !== result.message ? " " + result.detail : "";
  return String(result.message || fallback || "Discovery endpoint failed") + detail;
}

function showIngestDiscoveryError(err) {
  const result = err && err.discoveryVerificationResult;
  if (!result) return false;
  h("showDiscoveryVerificationToast", result, {
    context: "ingest_url",
    endpointUrl: err.endpointUrl || "",
  });
  return true;
}

async function appendManualPipelineRowDirect(manual) {
  const src = manual && typeof manual === "object" ? manual : {};
  const title = String(src.title || "").trim();
  const company = String(src.company || "").trim();
  const location = String(src.location || "").trim();
  const url = String(src.url || "").trim();
  const description = String(src.description || "").trim();
  const fitScore = Number.isFinite(Number(src.fitScore))
    ? Math.max(0, Math.min(10, Number(src.fitScore)))
    : "";

  if (!h("getSHEET_ID")) throw new Error("missing_sheet");
  if (!h("getAccessToken")) {
    h("showSheetAccessGate", "signin");
    throw new Error("signed_out");
  }
  if (!title) throw new Error("missing_title");
  if (!company) throw new Error("missing_company");
  if (url && !isParseableUrl(url)) throw new Error("invalid_url");

  const existingIndex = url
    ? getDuplicatePipelineIndexFromIngest(url, { rowNumber: NaN })
    : -1;
  if (existingIndex >= 0) {
    return {
      ok: false,
      reason: "duplicate",
      rowNumber: h("getSheetRow", existingIndex),
    };
  }

  const row = [
    new Date().toISOString().slice(0, 10),
    title,
    company,
    location,
    url,
    "Manual",
    "",
    fitScore === "" ? "" : String(fitScore),
    "",
    "",
    "",
    "",
    "New",
    "",
    description,
    "",
    "",
    "",
    "",
    "",
  ];
  await h("sheetsValuesAppend", "Pipeline!A:T", [row]);
  if (typeof host().loadAllData === "function") {
    await h("loadAllData").catch(() => {});
  }
  return {
    ok: true,
    strategy: "manual_sheet_append",
    lead: { title, company, location, url },
  };
}

async function ingestJobUrl(url, options = {}) {
  const value = String(url || "").trim();
  const onProgress = options && options.onProgress;
  if (!isParseableUrl(value)) {
    throw new Error("invalid_url");
  }

  reportIngestProgress(onProgress, 10, "Sending the URL to the ingest worker", "worker");
  const data = await handleIngestUrlSubmit(value, options.manual, {
    onProgress,
  });
  reportIngestProgress(onProgress, 44, "Adding the opportunity to Pipeline", "pipeline");

  const handled = handleIngestUrlResponse(data, value, {
    awaitAutoEnrich: true,
    onProgress,
  });
  if (handled && typeof handled.then === "function") {
    await handled;
  }
  if (data && data.ok === false) {
    return data;
  }

  reportIngestProgress(onProgress, 100, "Pipeline updated", "done");
  return data;
}

/**
 * POST to the worker's /ingest-url endpoint.
 * @param {string} url — pasted job URL
 * @param {object} [manualOverride] — { title, company, location, description, fitScore }
 * @returns {Promise<object>} parsed response
 */
async function handleIngestUrlSubmit(url, manualOverride, options = {}) {
  const webhook = await h("resolveDiscoveryRunWebhookUrl");
  if (!webhook) {
    if (manualOverride && typeof manualOverride === "object") {
      return appendManualPipelineRowDirect({ ...manualOverride, url });
    }
    throw new Error("missing_discovery_webhook");
  }

  const endpoint = resolveIngestUrlEndpoint(webhook);
  if (!endpoint) {
    h("showToast", "Invalid discovery webhook URL", "error");
    throw new Error("invalid_endpoint");
  }

  let activeDiscoverySecret = h("getDiscoveryWebhookSecret");
  function buildDiscoveryWorkerHeaders() {
    const headers = { "content-type": "application/json" };
    if (activeDiscoverySecret) {
      headers["x-discovery-secret"] = activeDiscoverySecret;
    }
    return headers;
  }

  async function buildRequestBody(options = {}) {
    const body = {
      event: "ingest.url.request",
      schemaVersion: 1,
      url: String(url || "").trim(),
    };
    if (!manualOverride) {
      body.async = true;
    }
    const sheetId = h("getSheetId");
    if (sheetId) body.sheetId = sheetId;
    const dashboardGoogleAccessToken =
      await h("getFreshDiscoveryRequestGoogleAccessToken", {
        force: options.forceGoogleTokenRefresh === true,
      });
    if (dashboardGoogleAccessToken) {
      body.googleAccessToken = dashboardGoogleAccessToken;
    }
    if (manualOverride && typeof manualOverride === "object") {
      body.manual = {
        title: String(manualOverride.title || "").trim(),
        company: String(manualOverride.company || "").trim(),
        location: String(manualOverride.location || "").trim(),
        description: String(manualOverride.description || "").trim(),
        fitScore: Number.isFinite(manualOverride.fitScore)
          ? manualOverride.fitScore
          : 5,
      };
    }
    return body;
  }

  async function postRequestBody(body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      INGEST_URL_TIMEOUT_MS,
    );
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: buildDiscoveryWorkerHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const responseText = await res.text().catch(() => "");
      let data = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (_) {
        data = null;
      }
      if (!res.ok && !data) {
        throw createIngestVerificationError(
          classifyIngestEndpointFailure({
            endpointUrl: endpoint,
            status: res.status,
            data,
            responseText,
            responseUrl: res.url || endpoint,
          }),
          endpoint,
          "Ingest endpoint returned HTTP " + res.status,
        );
      }
      if (!res.ok && h("isIngestSheetAuthFailure", data)) {
        return data;
      }
      if (!res.ok) {
        throw createIngestVerificationError(
          classifyIngestEndpointFailure({
            endpointUrl: endpoint,
            status: res.status,
            data,
            responseText,
            responseUrl: res.url || endpoint,
          }),
          endpoint,
          data && data.message
            ? data.message
            : "Ingest endpoint returned HTTP " + res.status,
        );
      }
      return data;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error("timeout");
      }
      if (err && err.discoveryVerificationResult) {
        throw err;
      }
      if (h("isFetchNetworkError", err)) {
        throw createIngestVerificationError(
          classifyIngestNetworkFailure(endpoint, err),
          endpoint,
          "Could not reach the ingest endpoint.",
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function resolveAsyncIngestResponse(data) {
    if (
      !data ||
      data.ok !== true ||
      data.kind !== "accepted_async" ||
      !data.runId
    ) {
      return data;
    }

    const statusPath = statusApi.resolveAcceptedRunStatusPath(data, endpoint);
    const statusUrl = statusApi.buildRunStatusUrl(statusPath, endpoint);
    if (!statusUrl) {
      throw new Error("timeout");
    }

    const pollAfterMs = Math.max(
      1000,
      Number(data.pollAfterMs) || INGEST_URL_ASYNC_POLL_MS,
    );
    const deadline = Date.now() + INGEST_URL_ASYNC_TIMEOUT_MS;
    let pollErrors = 0;
    reportIngestProgress(
      options.onProgress,
      32,
      "Browser Use is reading the posting",
      "scrape",
    );

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollAfterMs));
      let res;
      try {
        res = await fetch(statusUrl, {
          method: "GET",
          mode: "cors",
          headers: statusApi.buildDiscoveryStatusPollHeaders(statusUrl),
        });
      } catch (err) {
        pollErrors += 1;
        if (pollErrors >= MAX_POLL_ERRORS) {
          throw createIngestVerificationError(
            classifyIngestNetworkFailure(statusUrl, err),
            statusUrl,
            "Could not reach the ingest status endpoint.",
          );
        }
        continue;
      }
      if (!res.ok) {
        pollErrors += 1;
        if (pollErrors >= MAX_POLL_ERRORS) {
          throw createIngestVerificationError(
            classifyIngestEndpointFailure({
              endpointUrl: statusUrl,
              status: res.status,
              data: null,
              responseText: await res.text().catch(() => ""),
              responseUrl: res.url || statusUrl,
            }),
            statusUrl,
            "Ingest status endpoint returned HTTP " + res.status,
          );
        }
        continue;
      }
      pollErrors = 0;
      const status = await res.json().catch(() => null);
      const state = String((status && status.status) || "").toLowerCase();
      const terminal =
        !!(status && status.terminal) ||
        state === "completed" ||
        state === "partial" ||
        state === "empty" ||
        state === "failed";
      if (!terminal) {
        reportIngestProgress(
          options.onProgress,
          52,
          "Still reading the posting",
          "scrape",
        );
        continue;
      }
      if (status && status.ingestResult) {
        return status.ingestResult;
      }
      if (state === "failed") {
        throw new Error((status && (status.error || status.message)) || "worker_error");
      }
      throw new Error("worker_error");
    }

    throw new Error("timeout");
  }

  const initialBody = await buildRequestBody();
  let data;
  try {
    data = await resolveAsyncIngestResponse(await postRequestBody(initialBody));
  } catch (err) {
    if (
      err &&
      err.discoveryVerificationResult &&
      err.discoveryVerificationResult.kind === "auth_required"
    ) {
      const refreshedSecret =
        await h("refreshDiscoveryWebhookSecretFromBootstrapForEndpoint", endpoint);
      if (refreshedSecret && refreshedSecret !== activeDiscoverySecret) {
        activeDiscoverySecret = refreshedSecret;
        data = await resolveAsyncIngestResponse(await postRequestBody(initialBody));
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
  if (h("isIngestSheetAuthFailure", data)) {
    const retryBody = await buildRequestBody({
      forceGoogleTokenRefresh: true,
    });
    if (retryBody.googleAccessToken) {
      data = await resolveAsyncIngestResponse(await postRequestBody(retryBody));
    }
    if (h("isIngestSheetAuthFailure", data)) {
      h("clearPersistedRuntimeOAuthSession");
      if (h("getOAuthClientId")) h("showSheetAccessGate", "signin");
      data = {
        ...data,
        message:
          "Google session expired while adding this job. Sign in again, then click Add to Pipeline.",
      };
    }
  }
  return data;
}

function getIngestManualModalEls() {
  return {
    modal: document.getElementById("ingestManualModal"),
    form: document.getElementById("ingestManualForm"),
    explain: document.getElementById("ingestManualModalExplain"),
    error: document.getElementById("ingestManualModalError"),
    urlField: document.getElementById("ingestManualUrl"),
    title: document.getElementById("ingestManualTitle"),
    company: document.getElementById("ingestManualCompany"),
    location: document.getElementById("ingestManualLocation"),
    description: document.getElementById("ingestManualDescription"),
    fit: document.getElementById("ingestManualFitScore"),
    fitLabel: document.getElementById("ingestManualFitScoreValue"),
    submit: document.getElementById("ingestManualSubmit"),
    cancel: document.getElementById("ingestManualCancel"),
    close: document.getElementById("ingestManualModalClose"),
  };
}

function setIngestManualModalError(message) {
  const els = getIngestManualModalEls();
  if (!els.error) return;
  if (!message) {
    els.error.style.display = "none";
    els.error.textContent = "";
    return;
  }
  els.error.style.display = "";
  els.error.textContent = message;
}

function openIngestManualModal({ url, message }) {
  const els = getIngestManualModalEls();
  if (!els.modal || !els.form) return;
  els.form.reset();
  if (els.urlField) els.urlField.value = url || "";
  if (els.fit) els.fit.value = "5";
  if (els.fitLabel) els.fitLabel.textContent = "5";
  if (els.explain) {
    els.explain.textContent =
      message || "We couldn't auto-scrape this URL — fill in what you can.";
  }
  setIngestManualModalError("");
  els.modal.style.display = "flex";
  if (els.title) {
    setTimeout(() => els.title.focus(), 0);
  }
}

function closeIngestManualModal() {
  const els = getIngestManualModalEls();
  if (els.modal) els.modal.style.display = "none";
  setIngestManualModalError("");
}

async function refreshPipelineAfterIngest(options = {}) {
  const url = String((options && options.url) || "").trim();
  const data = options && typeof options.data === "object" ? options.data : {};
  const onProgress = options && options.onProgress;
  const shouldLocate =
    !!url || Number.isFinite(Number(data && data.rowNumber));
  const attempts = shouldLocate ? 4 : 1;
  let idx = -1;

  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (typeof host().loadAllData === "function") {
        await h("loadAllData");
      }
      if (shouldLocate) {
        idx = getDuplicatePipelineIndexFromIngest(url, data);
        if (idx >= 0) {
          revealPipelineJobByIndex(idx);
          return true;
        }
      }
      if (attempt < attempts - 1) {
        reportIngestProgress(onProgress, 88, "Refreshing Pipeline", "refresh");
        await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 500));
      }
    }
  } catch (err) {
    console.warn("[JobBored] post-ingest refresh failed:", err);
    return false;
  }

  return false;
}

// Auto-enrich a freshly-ingested row so the card doesn't live on as
// "View / linkedin.com" placeholders. Reuses fetchJobPostingEnrichment (the
// same scraper + LLM pipeline the drawer runs on click) then patches the
// sheet's Title/Company/Location cells when the LLM inferred better values.
// All errors are non-fatal — row stays in Pipeline regardless, user can edit
// manually or wait for drawer-open enrichment to retry.
async function autoEnrichIngestedRow(url, persistedLead, options = {}) {
  if (!url) return;
  const onProgress = options && options.onProgress;

  // Collect every URL candidate we know about. The backend normalizes URLs
  // before writing (strips utm_*, trailing slashes, etc.) so the raw pasted
  // `url` often ≠ `h("getPipelineData")[i].link`. Try both and fall back to a loose
  // hostname+path match if strict matching misses.
  const trim = (value) => String(value || "").trim();
  const candidates = [
    trim(url),
    trim(persistedLead && (persistedLead.url || persistedLead.link)),
    trim(persistedLead && persistedLead.canonicalUrl),
    trim(persistedLead && persistedLead.finalUrl),
  ].filter(Boolean);
  if (candidates.length === 0) return;

  function looseUrlKey(value) {
    try {
      const u = new URL(value);
      // Hostname without www + pathname without trailing slash. Ignores
      // protocol, query, hash. Good enough to match "https://www.linkedin.com/
      // jobs/view/123?utm_source=foo" and "https://linkedin.com/jobs/view/123".
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      const path = u.pathname.replace(/\/+$/, "");
      return host + path;
    } catch {
      return "";
    }
  }
  const looseKeys = candidates.map(looseUrlKey).filter(Boolean);

  function findRowIndex() {
    for (const cand of candidates) {
      const strictIdx = h("getPipelineData").findIndex(
        (job) => job && trim(job.link) === cand,
      );
      if (strictIdx >= 0) return strictIdx;
    }
    for (const key of looseKeys) {
      const looseIdx = h("getPipelineData").findIndex(
        (job) => job && looseUrlKey(job.link || "") === key,
      );
      if (looseIdx >= 0) return looseIdx;
    }
    return -1;
  }

  try {
    // 1. Wait for pipeline to refresh so the new row is in h("getPipelineData").
    //    Google Sheets has eventual consistency on read-after-write, so
    //    retry up to 4x with short backoff (total ~6s) before giving up.
    reportIngestProgress(onProgress, 54, "Finding the new Pipeline row", "refresh");
    let idx = -1;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (typeof host().loadAllData === "function") {
        await h("loadAllData").catch(() => {});
      }
      idx = findRowIndex();
      if (idx >= 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 500));
    }
    if (idx < 0) {
      console.warn(
        "[JobBored] auto-enrich: row not found after 4 retries. URL candidates:",
        candidates,
      );
      reportIngestProgress(onProgress, 88, "Refreshing Pipeline", "refresh");
      void refreshPipelineAfterIngest();
      return;
    }
    revealPipelineJobByIndex(idx);

    // 2. Visible progress signal — takes 3-8s typically.
    if (typeof showToast === "function") {
      h("showToast", "Fetching job details…", "info");
    }
    reportIngestProgress(
      onProgress,
      70,
      "Scraping the posting and asking Gemini for details",
      "enrich",
    );

    // 3. Fire the same enrichment the drawer uses. Populates
    //    h("getPipelineData")[idx]._postingEnrichment with inferredTitle/Company/
    //    Location + the full LLM bundle (which ALSO writes to localStorage
    //    cache keyed by job.link, so the drawer picks it up instantly on
    //    open regardless of subsequent loadAllData() re-hydrations).
    await h("fetchJobPostingEnrichment", idx).catch((err) => {
      console.warn("[JobBored] auto-enrich enrichment call:", err);
    });

    const job = h("getPipelineData")[idx];
    const enr = job && job._postingEnrichment;
    if (!enr) {
      reportIngestProgress(onProgress, 88, "Refreshing Pipeline", "refresh");
      void refreshPipelineAfterIngest();
      return;
    }

    // 5. Compute cell updates. Only replace placeholders ("View", "Linkedin",
    //    "Job at <host>", empty) — never overwrite values the user has
    //    typed/edited since paste.
    const sheetRow = typeof host().getSheetRow === "function" ? h("getSheetRow", idx) : null;
    if (!sheetRow) return;

    const isPlaceholderTitle = (value) => {
      const v = String(value || "").trim();
      if (!v) return true;
      if (/^view$/i.test(v)) return true;
      if (/^job at /i.test(v)) return true;
      // URL-slug-derived titles land as Title Case with no real role noun.
      // Leave them alone unless inferred title is clearly richer.
      return false;
    };
    const isPlaceholderCompany = (value) => {
      const v = String(value || "").trim();
      if (!v) return true;
      if (/^unknown company$/i.test(v)) return true;
      // Aggregator-hostname names we wrote as URL-only fallbacks.
      const aggr = /^(linkedin|indeed|glassdoor|ziprecruiter|monster|simplyhired|careerbuilder|wellfound|google|angel|dice|builtin)$/i;
      return aggr.test(v);
    };

    const inferredTitle = String(enr.inferredTitle || "").trim();
    const inferredCompany = String(enr.inferredCompany || "").trim();
    const inferredLocation = String(enr.inferredLocation || "").trim();

    const updates = [];
    reportIngestProgress(onProgress, 84, "Updating inferred job details", "write");
    if (inferredTitle && isPlaceholderTitle(job.title)) {
      updates.push({ range: `Pipeline!B${sheetRow}`, value: inferredTitle });
      job.title = inferredTitle;
    }
    if (inferredCompany && isPlaceholderCompany(job.company)) {
      updates.push({ range: `Pipeline!C${sheetRow}`, value: inferredCompany });
      job.company = inferredCompany;
    }
    if (inferredLocation && !String(job.location || "").trim()) {
      updates.push({ range: `Pipeline!D${sheetRow}`, value: inferredLocation });
      job.location = inferredLocation;
    }
    // Replace the aggregator-hostname favicon the worker wrote at ingest
    // time (e.g. LinkedIn/Indeed favicon) with a company-specific logo
    // resolved via Clearbit autocomplete. Fires in parallel with the
    // other updates so the sheet write batches together.
    //
    // Gating: we update the logo when EITHER the company name was just
    // promoted (definite stale-logo signal — ignore the placeholder
    // regex entirely), OR the existing Logo URL cell still matches a
    // known aggregator-favicon pattern. User-edited logos (custom hosts
    // outside the aggregator regex) stay untouched when the company
    // didn't change.
    const companyPromotedThisRun = updates.some(
      (u) => u.range === `Pipeline!C${sheetRow}`,
    );
    const shouldUpdateLogo =
      inferredCompany &&
      (companyPromotedThisRun || h("isPlaceholderLogoUrl", job.logoUrl));
    console.info("[JobBored] auto-enrich logo check:", {
      inferredCompany,
      existingLogoUrl: job.logoUrl,
      companyPromotedThisRun,
      isPlaceholder: h("isPlaceholderLogoUrl", job.logoUrl),
      shouldUpdateLogo,
    });
    if (shouldUpdateLogo) {
      const newLogoUrl = await h("resolveCompanyLogoUrl", inferredCompany);
      console.info("[JobBored] auto-enrich resolved logo:", newLogoUrl);
      if (newLogoUrl) {
        updates.push({ range: `Pipeline!T${sheetRow}`, value: newLogoUrl });
        job.logoUrl = newLogoUrl;
        // In-memory bump so the next renderPipeline reflects the real
        // logo even before the sheet round-trip completes. Without
        // this, the card can stay as the LinkedIn "in" icon for ~2s
        // while the sheet write + re-read propagates.
        if (typeof host().renderPipeline === "function") h("renderPipeline");
      }
    }

    if (updates.length === 0) {
      // Nothing to promote — drawer enrichment did run and is cached, so
      // drawer open will be instant next time. Just re-render so the card
      // picks up any _postingEnrichment-derived display tweaks.
      if (typeof host().renderPipeline === "function") h("renderPipeline");
      reportIngestProgress(onProgress, 92, "Pipeline refreshed", "refresh");
      return;
    }

    const ok = await h("updateMultipleCells", updates).catch(() => false);
    if (!ok) {
      // Non-fatal — the row is already in the sheet, just with placeholders.
      // Re-render anyway so the in-memory title/company update is visible
      // locally, even if it doesn't persist to Sheets.
      if (typeof host().renderPipeline === "function") h("renderPipeline");
      reportIngestProgress(onProgress, 92, "Pipeline refreshed", "refresh");
      return;
    }

    // Sheet patched. Refresh again so the pipeline reflects the real values.
    reportIngestProgress(onProgress, 92, "Refreshing Pipeline", "refresh");
    if (typeof host().loadAllData === "function") {
      await h("loadAllData").catch(() => {});
    }
    if (typeof showToast === "function") {
      h("showToast", "Details filled in: " + inferredTitle, "success");
    }
  } catch (err) {
    console.warn("[JobBored] autoEnrichIngestedRow:", err);
  }
}

function handleIngestUrlResponse(data, url, options = {}) {
  if (!data || typeof data !== "object") {
    h("showToast", "Unexpected response from worker", "error", true);
    return data;
  }
  if (data.ok === true) {
    const title =
      (data.lead && (data.lead.title || data.lead.role)) || "job";
    const strategy = (data && data.strategy) || "";
    const verb =
      data.updated === true || data.appended === false ? "Updated" : "Added";
    h("showToast", verb + ": " + title, "success");
    closeIngestManualModal();
    // For url_only rows we only have URL-derived placeholder title/company.
    // Fire the drawer enrichment pipeline now (scrape + LLM) and promote the
    // sheet row's B/C/D cells with the LLM-inferred real values. Other
    // strategies (ats_api / jsonld / cheerio_dom / manual_fill) already have
    // clean fields — just refresh.
    if (strategy === "url_only") {
      const enrich = autoEnrichIngestedRow(url, data.lead, {
        onProgress: options.onProgress,
      });
      if (options.awaitAutoEnrich) {
        return enrich.then(() => data);
      }
      void enrich;
    } else {
      reportIngestProgress(options.onProgress, 82, "Refreshing Pipeline", "refresh");
      const refresh = refreshPipelineAfterIngest({
        url,
        data,
        onProgress: options.onProgress,
      });
      if (options.awaitAutoEnrich) {
        return refresh.then(() => data);
      }
      void refresh;
    }
    return data;
  }
  if (data.ok === false) {
    switch (data.reason) {
      case "blocked_aggregator":
      case "scrape_failed": {
        const hint =
          (typeof data.hint === "string" && data.hint.trim()) ||
          (typeof data.message === "string" && data.message.trim()) ||
          "We couldn't read a complete posting from this URL.";
        const label =
          data.reason === "blocked_aggregator"
            ? aggregatorLabelForHost(data.host) + " did not expose a complete posting. "
            : "";
        h("showToast", label + hint, "warning", true);
        return data;
      }
      case "duplicate": {
        const row = data.rowNumber;
        const suffix = Number.isFinite(row) && row >= 2 ? " (row " + row + ")" : "";
        const existingIndex = getDuplicatePipelineIndexFromIngest(url, data);
        const focused = focusPipelineJobByIndex(existingIndex);
        h("showToast",
          "Already in Pipeline" + suffix + (focused ? " — focused the existing card." : ""),
          "info",
        );
        closeIngestManualModal();
        return data;
      }
      case "invalid_url":
      case "private_network": {
        h("showToast",
          data.message || "Could not ingest URL: " + data.reason,
          "error",
        );
        return data;
      }
      case "low_quality_extraction": {
        h("showToast",
          data.message ||
            "The worker could not read a complete posting from that link.",
          "warning",
          true,
        );
        return data;
      }
      default: {
        h("showToast",
          data.message || "Unexpected response from worker",
          "error",
          true,
        );
        return data;
      }
    }
  }
  h("showToast", "Unexpected response from worker", "error", true);
  return data;
}

function setIngestSubmitLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.dataset.originalLabel = button.textContent || "";
    button.textContent = "Adding…";
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }
}

function setIngestSubmitProgressLabel(button, update) {
  if (!button || !update || typeof update !== "object") return;
  const step = String(update.step || "");
  if (step === "scrape") {
    button.textContent = "Reading posting...";
  } else if (step === "refresh") {
    button.textContent = "Refreshing...";
  } else if (step === "pipeline" || step === "write") {
    button.textContent = "Adding...";
  }
}

async function submitIngestFromToolbar() {
  const input = document.getElementById("ingestUrlInput");
  const button = document.getElementById("ingestUrlSubmit");
  if (!input) return;
  const url = String(input.value || "").trim();
  if (!url) {
    h("showToast", "Paste a job URL first", "error");
    input.focus();
    return;
  }
  if (!isParseableUrl(url)) {
    h("showToast", "That doesn't look like a valid http(s) URL", "error");
    input.focus();
    if (typeof input.select === "function") input.select();
    return;
  }
  setIngestSubmitLoading(button, true);
  try {
    const data = await handleIngestUrlSubmit(url, undefined, {
      onProgress: (update) => setIngestSubmitProgressLabel(button, update),
    });
    handleIngestUrlResponse(data, url);
    if (data && data.ok === true) {
      input.value = "";
    }
  } catch (err) {
    if (err && err.message === "missing_discovery_webhook") {
      h("showToast",
        "No ingest worker is connected. Use Add manually, or connect a discovery worker.",
        "warning",
        true,
        {
          label: "Add manually",
          onClick: () => {
            openIngestManualModal({
              url,
              message:
                "No ingest worker is connected. Fill in the details and JobBored will append the row directly to Pipeline.",
            });
          },
        },
      );
    } else if (err && err.message === "timeout") {
      h("showToast", "Ingest timed out — try again", "error");
    } else if (err && err.message === "invalid_endpoint") {
      // toast already shown
    } else if (showIngestDiscoveryError(err)) {
      // Verifier copy + action already shown.
    } else {
      console.error("[JobBored] ingest-url submit failed:", err);
      h("showToast", "Network error — could not reach worker", "error");
    }
  } finally {
    setIngestSubmitLoading(button, false);
  }
}

async function submitIngestFromManualModal() {
  const els = getIngestManualModalEls();
  if (!els.form) return;
  const url = (els.urlField && els.urlField.value.trim()) || "";
  const title = (els.title && els.title.value.trim()) || "";
  const company = (els.company && els.company.value.trim()) || "";
  const location = (els.location && els.location.value.trim()) || "";
  const description =
    (els.description && els.description.value.trim()) || "";
  const fitScoreRaw = els.fit ? Number(els.fit.value) : 5;
  const fitScore = Number.isFinite(fitScoreRaw) ? fitScoreRaw : 5;

  setIngestManualModalError("");
  if (!title) {
    setIngestManualModalError("Title is required.");
    if (els.title) els.title.focus();
    return;
  }
  if (!company) {
    setIngestManualModalError("Company is required.");
    if (els.company) els.company.focus();
    return;
  }
  if (url && !isParseableUrl(url)) {
    setIngestManualModalError("URL is invalid.");
    return;
  }

  setIngestSubmitLoading(els.submit, true);
  try {
    const manualPayload = {
      title,
      company,
      location,
      description,
      fitScore,
    };
    const data = url
      ? await handleIngestUrlSubmit(url, manualPayload)
      : await appendManualPipelineRowDirect(manualPayload);
    if (data && data.ok === true) {
      handleIngestUrlResponse(data, url);
      const toolbarInput = document.getElementById("ingestUrlInput");
      if (toolbarInput) toolbarInput.value = "";
      return;
    }
    if (data && data.ok === false && data.reason === "duplicate") {
      handleIngestUrlResponse(data, url);
      return;
    }
    setIngestManualModalError(
      (data && data.message) ||
        "Worker rejected the manual entry. Check the fields and try again.",
    );
  } catch (err) {
    if (err && err.message === "missing_discovery_webhook") {
      try {
        const direct = await appendManualPipelineRowDirect({
          title,
          company,
          location,
          description,
          fitScore,
          url,
        });
        handleIngestUrlResponse(direct, url);
        return;
      } catch (directErr) {
        setIngestManualModalError(
          directErr && directErr.message === "signed_out"
            ? "Sign in with Google so JobBored can append this row to Pipeline."
            : "Could not append directly to Pipeline.",
        );
      }
    } else if (err && err.message === "timeout") {
      setIngestManualModalError("Request timed out. Try again.");
    } else if (err && err.message === "signed_out") {
      setIngestManualModalError(
        "Sign in with Google so JobBored can append this row to Pipeline.",
      );
    } else if (err && err.message === "missing_sheet") {
      setIngestManualModalError(
        "Connect your Pipeline sheet before adding manual rows.",
      );
    } else if (err && err.discoveryVerificationResult) {
      setIngestManualModalError(
        formatDiscoveryVerificationError(
          err.discoveryVerificationResult,
          "Could not reach the ingest worker.",
        ),
      );
      showIngestDiscoveryError(err);
    } else {
      console.error("[JobBored] manual-fill submit failed:", err);
      setIngestManualModalError("Network error — could not reach worker.");
    }
  } finally {
    setIngestSubmitLoading(els.submit, false);
  }
}

function initIngestUrlFlow() {
  const form = document.getElementById("ingestUrlForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitIngestFromToolbar();
    });
  }

  const els = getIngestManualModalEls();
  if (els.form) {
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitIngestFromManualModal();
    });
  }
  if (els.fit && els.fitLabel) {
    els.fit.addEventListener("input", () => {
      els.fitLabel.textContent = String(els.fit.value);
    });
  }
  if (els.cancel) {
    els.cancel.addEventListener("click", () => closeIngestManualModal());
  }
  if (els.close) {
    els.close.addEventListener("click", () => closeIngestManualModal());
  }
  // Explicit "Add manually" escape hatch in the hero card footnote. Lets
  // users skip URL paste entirely (e.g. posting only exists on a site we
  // can't link to, or they want to track a job they heard about verbally).
  const manualOpenBtn = document.getElementById("ingestManualModalOpenBtn");
  if (manualOpenBtn) {
    manualOpenBtn.addEventListener("click", () => {
      openIngestManualModal({
        url: "",
        message:
          "No URL handy? Fill in the basics and we'll track it in your Pipeline.",
      });
    });
  }
  if (els.modal) {
    els.modal.addEventListener("click", (e) => {
      if (e.target === els.modal) closeIngestManualModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.modal.style.display === "flex") {
        closeIngestManualModal();
      }
    });
  }
}

  Object.assign(ingestUrlFlow, {
    resolveIngestUrlEndpoint,
    isParseableUrl,
    ingestJobUrl,
    handleIngestUrlSubmit,
    handleIngestUrlResponse,
    initIngestUrlFlow,
  });
})();
