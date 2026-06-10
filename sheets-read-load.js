/* ============================================
   COMMAND CENTER v2 — Sheets Read / Load
   Extracted from app.js (sheets-read-load cut).

   Classic-global IIFE under window.JobBoredApp.sheetsRead — NOT an ES module.
   Loaded BEFORE app.js. CSV/JSONP/Sheets API fetch, pipeline parse, loadAllData,
   sheet access error UI, and pending-favorites cache hydration on load.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const sheetsRead = root.sheetsRead || (root.sheetsRead = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function startupLog(label, detail, level = "info") {
    const logger = window.JobBoredStartupLog;
    if (logger && typeof logger.mark === "function") {
      logger.mark(label, detail, level);
      return;
    }
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "info";
    if (window.console && typeof console[method] === "function") {
      console[method]("[JobBored startup]", label, detail || "");
    }
  }

  // localStorage-backed pending favorites map. Keyed by the job link (or by a
  // link-less synthetic key built from title|company so manually-entered rows
  // without a link still persist). Survives across refresh so a user who
  // clicked the star but hadn't yet signed in / whose Sheet write failed
  // still sees their pick on next load. Cleared per-row once the Sheet write
  // succeeds (canonical column V holds "★").
  const PENDING_FAVORITES_STORAGE_KEY = "jobbored.favorites.pending";

  function favoriteCacheKeyForJob(job) {
    if (!job) return "";
    const link = job.link ? String(job.link).trim() : "";
    if (link) return link;
    const title = job.title ? String(job.title).trim().toLowerCase() : "";
    const company = job.company ? String(job.company).trim().toLowerCase() : "";
    if (!title && !company) return "";
    return `synthetic::${company}::${title}`;
  }

  function loadPendingFavorites() {
    try {
      const raw = localStorage.getItem(PENDING_FAVORITES_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function savePendingFavorites(map) {
    try {
      localStorage.setItem(PENDING_FAVORITES_STORAGE_KEY, JSON.stringify(map || {}));
    } catch {
      // Quota exceeded or storage disabled — silent best-effort.
    }
  }

  function setPendingFavorite(cacheKey, favorite) {
    if (!cacheKey) return;
    const map = loadPendingFavorites();
    map[cacheKey] = !!favorite;
    savePendingFavorites(map);
  }

  function clearPendingFavorite(cacheKey) {
    if (!cacheKey) return;
    const map = loadPendingFavorites();
    if (!(cacheKey in map)) return;
    delete map[cacheKey];
    savePendingFavorites(map);
  }

  /** Layer pending (unwritten / unsynced) favorites into freshly-parsed jobs.
   *  Called after parsePipelineCSV so a user whose Sheet write failed or who
   *  toggled while auth-gated still sees their pick after refresh. Entries
   *  that match the canonical Sheet state are dropped from the cache. */
  function applyFavoriteCache(jobs) {
    if (!jobs || !jobs.length) return;
    const map = loadPendingFavorites();
    if (!map || !Object.keys(map).length) return;
    let dirty = false;
    for (const job of jobs) {
      const cacheKey = favoriteCacheKeyForJob(job);
      if (!cacheKey || !(cacheKey in map)) continue;
      const pending = !!map[cacheKey];
      if (pending === !!job.favorite) {
        delete map[cacheKey];
        dirty = true;
      } else {
        job.favorite = pending;
      }
    }
    if (dirty) savePendingFavorites(map);
  }

  function parseCSV(text) {
    const rows = [];
    let current = "";
    let inQuotes = false;
    let row = [];
    let fieldStart = true;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (fieldStart && ch === '"') {
        inQuotes = true;
        fieldStart = false;
        continue;
      }

      fieldStart = false;

      if (inQuotes) {
        if (ch === '"') {
          if (next === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === ",") {
          row.push(current.trim());
          current = "";
          fieldStart = true;
        } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
          row.push(current.trim());
          if (row.some((cell) => cell !== "")) {
            rows.push(row);
          }
          row = [];
          current = "";
          fieldStart = true;
          if (ch === "\r") i++;
        } else if (ch === "\r") {
          row.push(current.trim());
          if (row.some((cell) => cell !== "")) {
            rows.push(row);
          }
          row = [];
          current = "";
          fieldStart = true;
        } else {
          current += ch;
        }
      }
    }

    row.push(current.trim());
    if (row.some((cell) => cell !== "")) {
      rows.push(row);
    }

    return rows;
  }

  function normalizeActiveSheetId(raw) {
    const value = raw == null ? "" : String(raw).trim();
    if (
      !value ||
      value === "null" ||
      value === "undefined" ||
      value === "YOUR_SHEET_ID_HERE"
    ) {
      return "";
    }
    return value;
  }

  let _jsonpCounter = 0;

  function fetchSheetJSONP(sheetName) {
    return new Promise((resolve, reject) => {
      const sheetId = normalizeActiveSheetId(host().getActiveSheetId());
      if (!sheetId) {
        reject(new Error(`No Sheet ID configured for ${sheetName}`));
        return;
      }
      const callbackName = `__commandCenter_cb_${++_jsonpCounter}`;
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&sheet=${encodeURIComponent(sheetName)}`;

      console.log(`[JobBored] JSONP fetch: ${sheetName}`);

      const timeout = setTimeout(() => {
        cleanup();
        console.error(`[JobBored] JSONP timeout for ${sheetName}`);
        reject(new Error(`Timeout fetching ${sheetName}`));
      }, 15000);

      function cleanup() {
        clearTimeout(timeout);
        delete window[callbackName];
        const el = document.getElementById(`jsonp-${callbackName}`);
        if (el) el.remove();
      }

      window[callbackName] = function (response) {
        cleanup();
        if (!response || !response.table) {
          reject(new Error(`Invalid response for ${sheetName}`));
          return;
        }
        console.log(
          `[JobBored] ${sheetName} loaded via JSONP (${response.table.rows ? response.table.rows.length : 0} rows)`,
        );
        resolve(response.table);
      };

      const script = document.createElement("script");
      script.id = `jsonp-${callbackName}`;
      script.src = url;
      script.onerror = () => {
        cleanup();
        console.error(`[JobBored] JSONP script error for ${sheetName}`);
        reject(new Error(`Script load failed for ${sheetName}`));
      };
      document.head.appendChild(script);
    });
  }



  function parseGvizDate(val) {
    if (!val) return null;
    if (typeof val === "string" && val.startsWith("Date(")) {
      const parts = val.match(/Date\((\d+),(\d+),(\d+)\)/);
      if (parts)
        return new Date(
          parseInt(parts[1]),
          parseInt(parts[2]),
          parseInt(parts[3]),
        );
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  async function fetchSheetViaSheetsAPI(sheetName, isRetry) {
    const h = host();
    const accessToken = h.getAccessToken();
    const sheetId = normalizeActiveSheetId(h.getActiveSheetId());
    if (!accessToken || !sheetId) return null;
    const name = String(sheetName);
    const needsQuote = /[^A-Za-z0-9_]/.test(name) || /^\d/.test(name);
    const a1 = needsQuote ? `'${name.replace(/'/g, "''")}'!A:ZZ` : `${name}!A:ZZ`;
    const encRange = encodeURIComponent(a1);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encRange}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (resp.status === 401) {
      if (!isRetry) {
        const ok = await h.refreshAccessTokenSilently();
        if (ok) return fetchSheetViaSheetsAPI(sheetName, true);
      }
      // Mirror updateSheetCell (sheets-writeback.js): the token is dead and
      // could not be refreshed, so surface it honestly instead of letting
      // the caller silently downgrade to unauthenticated reads. Concurrent
      // reads race here at boot — only the first one clears and toasts.
      if (h.getAccessToken()) {
        h.clearSessionAuthState();
        h.showToast("Session expired — please sign in again", "error", true);
      }
      return null;
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error(
        "[JobBored] Sheets API read failed:",
        resp.status,
        err.error || err,
      );
      const msg =
        (err.error && err.error.message) ||
        `Sheets API ${resp.status} on ${name}`;
      h.recordSheetAccessError({ message: msg, status: resp.status });
      return null;
    }
    const data = await resp.json();
    return data.values != null ? data.values : [];
  }

  async function fetchSheetCSV(sheetName) {
    const h = host();
    const accessToken = h.getAccessToken();
    const sheetId = normalizeActiveSheetId(h.getActiveSheetId());

    if (accessToken) {
      try {
        const apiRows = await fetchSheetViaSheetsAPI(sheetName);
        if (apiRows !== null) {
          return apiRows;
        }
      } catch (e) {
        console.warn("[JobBored] Sheets API read:", e);
      }
      if (!h.getAccessToken()) {
        // The session expired mid-read (401 + failed silent refresh cleared
        // auth state above). Skip the unauthenticated JSONP/CSV fallback: on
        // a public sheet it would render a zombie "signed-in" dashboard
        // where reads work and every write fails. loadAllData's signed-out
        // branches route to the sign-in gate instead.
        return null;
      }
    }

    if (!sheetId) {
      console.warn(
        `[JobBored] No Sheet ID configured; skipping ${sheetName} fetch`,
      );
      return null;
    }

    try {
      const table = await fetchSheetJSONP(sheetName);
      const headers = table.cols.map((c) => c.label || c.id);
      const rows = [headers];
      for (const row of table.rows || []) {
        const cells = [];
        for (let i = 0; i < headers.length; i++) {
          const cell = row.c ? row.c[i] : null;
          if (!cell || cell.v === null || cell.v === undefined) {
            cells.push("");
          } else if (typeof cell.v === "string" && cell.v.startsWith("Date(")) {
            const d = parseGvizDate(cell.v);
            cells.push(d ? d.toISOString().split("T")[0] : cell.f || "");
          } else if (cell.f) {
            cells.push(cell.f);
          } else {
            cells.push(String(cell.v));
          }
        }
        rows.push(cells);
      }
      return rows;
    } catch (err) {
      console.error(`[JobBored] JSONP failed for ${sheetName}:`, err.message);
    }

    const csvUrls = [
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/pub?gid=0&single=true&output=csv`,
    ];

    for (const url of csvUrls) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const text = await resp.text();
        if (!text || text.length < 10) continue;
        if (text.trim().startsWith("<!") || text.trim().startsWith("<html"))
          continue;
        console.log(`[JobBored] ${sheetName} loaded via CSV fallback`);
        return parseCSV(text);
      } catch (e) {
        continue;
      }
    }

    console.error(`[JobBored] All fetch attempts failed for ${sheetName}`);
    return null;
  }

  function isDiscoveryAutomationNotesString(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (/^Discovered\s+via\s+variationKey\b/i.test(t)) return true;
    if (
      /^Discovered\s+via\s+/i.test(t) &&
      /\bvariationKey\b/i.test(t) &&
      /\b(direct-source|direct\s+source)\b/i.test(t)
    ) {
      return true;
    }
    if (
      /^Discovered\s+via\s+/i.test(t) &&
      /\bvariationKey\b/i.test(t) &&
      /\bYC\b/i.test(t)
    ) {
      return true;
    }
    return false;
  }

  function sanitizePipelineNotesFromSheet(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    if (isDiscoveryAutomationNotesString(s)) return "";
    return s;
  }

  function parsePipelineCSV(rows) {
    if (!rows || rows.length < 2) return [];

    const dataRows = rows.slice(1);
    const results = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const title = row[1] || null;
      const company = row[2] || null;

      if (!title && !company) continue;
      if (!company && !row[4] && !row[7]) continue;

      const fitScoreRaw = row[7];
      let fitScore = null;
      if (fitScoreRaw) {
        const parsed = parseFloat(fitScoreRaw);
        if (!isNaN(parsed)) fitScore = parsed;
      }

      let dateFound = null;
      const dateRaw = row[0] || null;
      if (dateRaw) {
        const d = new Date(dateRaw);
        if (!isNaN(d.getTime())) dateFound = d;
      }

      results.push({
        _rawIndex: i,
        dateFound: dateFound,
        dateFoundRaw: dateRaw,
        title: title ? title.trim() : null,
        company: company,
        location: row[3] || null,
        link: row[4] || null,
        source: row[5] || null,
        salary: row[6] || null,
        fitScore: fitScore,
        priority: row[8] || null,
        tags: row[9] || null,
        fitAssessment: row[10] || null,
        contact: row[11] || null,
        status: row[12] || null,
        appliedDate: row[13] || null,
        notes: sanitizePipelineNotesFromSheet(row[14]) || null,
        _rawNotes: row[14] || null,
        followUpDate: row[15] || null,
        talkingPoints: row[16] || null,
        lastHeardFrom:
          row[17] != null && String(row[17]).trim() !== ""
            ? String(row[17]).trim()
            : null,
        responseFlag:
          row[18] != null && String(row[18]).trim() !== ""
            ? String(row[18]).trim()
            : null,
        logoUrl: row[19] ? String(row[19]).trim() : null,
        favorite: row[21] === "★",
        dismissedAt: row[22] ? String(row[22]).trim() || null : null,
        _editLock: row[24] != null ? String(row[24]).trim() : "",
      });
    }

    return results;
  }

  async function loadAllData() {
    const h = host();
    startupLog("sheets-read:load:start", {
      hasOAuthClientId: !!h.getOAuthClientId(),
      hasAccessToken: !!h.getAccessToken(),
      sheetIdState: normalizeActiveSheetId(h.getActiveSheetId())
        ? "present"
        : "missing",
      initialAccessResolved: !!h.getInitialSheetAccessResolved(),
    });
    if (h.getOAuthClientId() && !h.getAccessToken()) {
      startupLog("sheets-read:load:signed-out", {
        hasOAuthClientId: true,
      }, "warn");
      h.setPipelineRawRows(null);
      h.setPipelineData([]);
      h.setDashboardDataHydrated(false);
      h.showSheetAccessGate("signin");
      return false;
    }

    if (!normalizeActiveSheetId(h.getActiveSheetId())) {
      startupLog("sheets-read:load:missing-sheet-id", {
        hasAccessToken: !!h.getAccessToken(),
        hasOAuthClientId: !!h.getOAuthClientId(),
      }, "warn");
      h.setPipelineRawRows(null);
      h.setPipelineData([]);
      h.setDashboardDataHydrated(false);
      h.setDataLoadFailed(false);
      if (!h.getInitialSheetAccessResolved()) {
        if (h.getAccessToken() && h.getOAuthClientId()) {
          h.revealSetupScreenAfterAuth();
        } else if (h.getOAuthClientId()) {
          h.showSheetAccessGate("signin");
        } else {
          h.showSheetAccessGate("no-oauth");
        }
      }
      return false;
    }

    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) refreshBtn.classList.add("loading");

    try {
      const pipelineRows = await fetchSheetCSV("Pipeline");

      if (!pipelineRows) {
        startupLog("sheets-read:load:fetch-failed", {
          initialAccessResolved: !!h.getInitialSheetAccessResolved(),
          hasAccessToken: !!h.getAccessToken(),
        }, "error");
        if (!h.getInitialSheetAccessResolved()) {
          if (!h.getAccessToken() && h.getOAuthClientId()) {
            h.showSheetAccessGate("signin");
          } else if (!h.getOAuthClientId()) {
            h.showSheetAccessGate("no-oauth");
          } else {
            h.showSheetAccessGate("error");
          }
        } else {
          showErrorState();
        }
        h.setDataLoadFailed(true);
        return false;
      }

      h.setDataLoadFailed(false);
      hideErrorState();

      h.setPipelineRawRows(pipelineRows);
      const pipelineData = parsePipelineCSV(pipelineRows);
      h.applyEnrichmentCache(pipelineData);
      applyFavoriteCache(pipelineData);
      h.setPipelineData(pipelineData);
      console.log(`[JobBored] Pipeline: ${pipelineData.length} jobs`);
      startupLog("sheets-read:load:parsed", {
        rowCount: Array.isArray(pipelineRows) ? pipelineRows.length : 0,
        jobCount: pipelineData.length,
      });

      h.setDashboardDataHydrated(true);
      h.renderPipeline();
      h.renderBrief();
      h.updateLastRefresh();
      h.maybeAutoOpenExpiredReviewModal();
      if (!h.getInitialSheetAccessResolved()) {
        if (h.getOAuthClientId() && !h.getAccessToken()) {
          h.setPipelineRawRows(null);
          h.setPipelineData([]);
          h.setDashboardDataHydrated(false);
          h.showSheetAccessGate("signin");
          return true;
        }
        h.setInitialSheetAccessResolved(true);
        h.revealDashboardShell();
        h.runPostAccessBootstrapOnce();
      }
      startupLog("sheets-read:load:complete", {
        jobCount: pipelineData.length,
        dashboardHydrated: true,
      });
      return true;
    } catch (err) {
      console.error("[JobBored] Error loading data:", err);
      startupLog(
        "sheets-read:load:error",
        { message: err && err.message ? err.message : String(err) },
        "error",
      );
      if (!h.getInitialSheetAccessResolved()) {
        h.showSheetAccessGate(
          !h.getAccessToken() && h.getOAuthClientId() ? "signin" : "error",
        );
      } else {
        showErrorState();
      }
      h.setDataLoadFailed(true);
      return false;
    } finally {
      if (refreshBtn) refreshBtn.classList.remove("loading");
    }
  }

  function showErrorState() {
    const h = host();
    const jobCards = document.getElementById("jobCards");
    const errorState = document.getElementById("errorState");
    const errorOpenDirect = document.getElementById("errorOpenDirect");
    const errorViewSheet = document.getElementById("errorViewSheet");
    const errorHint = document.getElementById("errorStateHint");

    jobCards.innerHTML = "";
    errorState.style.display = "block";
    errorOpenDirect.href = window.location.href;
    errorViewSheet.href = `https://docs.google.com/spreadsheets/d/${h.getActiveSheetId()}`;
    if (errorHint) {
      // Prefer the real Sheets API error recorded during the failed read
      // (e.g. "The caller does not have permission") over a generic guess.
      const lastApiError =
        typeof h.getLastSheetAccessError === "function"
          ? String(h.getLastSheetAccessError() || "")
          : "";
      if (lastApiError) {
        errorHint.textContent = lastApiError;
      } else if (h.getOAuthClientId()) {
        errorHint.textContent =
          "Confirm you’re signed in with Google and the Sheet ID is correct.";
      } else {
        errorHint.textContent =
          "Publish the sheet for public read access, or add an OAuth client in Settings.";
      }
    }
  }

  function hideErrorState() {
    document.getElementById("errorState").style.display = "none";
  }

  Object.assign(sheetsRead, {
    parseCSV,
    parsePipelineCSV,
    fetchSheetCSV,
    loadAllData,
    showErrorState,
    hideErrorState,
    applyFavoriteCache,
    favoriteCacheKeyForJob,
    setPendingFavorite,
    clearPendingFavorite,
  });
})();
