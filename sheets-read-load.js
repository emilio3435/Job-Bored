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

  /* ------------------------------------------------------------------
     UX01 C21 — a failed load never looks empty.
     loadState is the single record of "what did the last read do":
       dataLoaded    true once any load succeeded this page life
       lastSyncedAt  epoch ms of the last good read (0 = never)
       lastFailure   { status, kind } of the last failed read, or null
     Events (window AND document; lane C gates its empty copy on them):
       jb:data:loaded       { rows, count, first, lastSyncedAt }
       jb:data:load-failed  { status, kind, lastSyncedAt, hasLastGood }
     ------------------------------------------------------------------ */
  const loadState = {
    dataLoaded: false,
    lastSyncedAt: 0,
    lastFailure: null,
    loading: false,
  };
  let lastReadFailure = null;
  let syncTicker = null;
  let connectivityWired = false;

  function emitDataEvent(type, detail) {
    try {
      if (typeof CustomEvent !== "function") return;
      const make = () => new CustomEvent(type, { detail });
      if (typeof window.dispatchEvent === "function") window.dispatchEvent(make());
      if (typeof document.dispatchEvent === "function") document.dispatchEvent(make());
    } catch (_) {
      /* events are best-effort; never break a load */
    }
  }

  function isOnline() {
    const nav =
      (window && window.navigator) ||
      (typeof navigator !== "undefined" ? navigator : null);
    return !nav || nav.onLine !== false;
  }

  function signedInEmail() {
    try {
      const a = window.JobBoredApp && window.JobBoredApp.auth;
      return a && typeof a.getUserEmail === "function" ? a.getUserEmail() || "" : "";
    } catch (_) {
      return "";
    }
  }

  /** Plain words for a failed read. Never prints Google's raw sentence,
   *  a status code, or a file name (SS-09, SS-10). */
  function describeLoadFailure(failure) {
    const f = failure || {};
    const status = Number(f.status) || 0;
    const email = String(f.email || "").trim();
    if (f.kind === "offline" || (status === 0 && f.kind !== "unknown")) {
      return {
        kind: "offline",
        title: "You’re offline",
        detail:
          "JobBored can’t reach Google right now. It will try again when your connection comes back.",
      };
    }
    if (status === 401) {
      return {
        kind: "session",
        title: "Your Google session ended",
        detail: "Sign in again to keep syncing with your Sheet.",
      };
    }
    if (status === 403) {
      const who = email || "This Google account";
      return {
        kind: "forbidden",
        title: `${who} can’t open this Sheet`,
        detail: email
          ? `Ask the Sheet’s owner to share it with ${email}, or switch to the account that owns it.`
          : "Ask the Sheet’s owner to share it with you, or switch to the account that owns it.",
      };
    }
    if (status === 404) {
      return {
        kind: "not-found",
        title: "That Sheet doesn’t exist",
        detail:
          "The Sheet link in Settings doesn’t point at a Google Sheet any more. Paste the right link in Settings.",
      };
    }
    return {
      kind: "unknown",
      title: "Couldn’t reach your Sheet",
      detail: "Google didn’t answer. Try again in a moment.",
    };
  }

  function formatSyncedAgo(at, now) {
    const t = Number(at) || 0;
    if (!t) return "Not synced yet";
    const diff = Math.max(0, (Number(now) || Date.now()) - t);
    if (diff < 60000) return "Synced just now";
    if (diff < 3600000) return `Synced ${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `Synced ${Math.floor(diff / 3600000)} h ago`;
    return `Synced ${Math.floor(diff / 86400000)} d ago`;
  }

  function getLoadState() {
    return {
      dataLoaded: loadState.dataLoaded,
      lastSyncedAt: loadState.lastSyncedAt,
      lastFailure: loadState.lastFailure ? { ...loadState.lastFailure } : null,
      loading: loadState.loading,
    };
  }

  /* ---- sync bar: "Synced 2 min ago" + Refresh, and the failure banner ---- */

  function makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function clearChildren(el) {
    if (typeof el.replaceChildren === "function") {
      el.replaceChildren();
      return;
    }
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function ensureSyncBar() {
    if (typeof document.createElement !== "function" || !document.body) return null;
    const existing = document.getElementById("jbSyncBar");
    if (existing) return existing;
    const bar = makeEl("div", "jb-sync");
    bar.setAttribute("id", "jbSyncBar");
    bar.setAttribute("data-state", "ok");
    bar.hidden = true;

    const row = makeEl("div", "jb-sync__row");
    const label = makeEl("span", "jb-sync__label", "Not synced yet");
    label.setAttribute("id", "jbSyncLabel");
    const refresh = makeEl("button", "jb-sync__refresh", "Refresh");
    refresh.setAttribute("type", "button");
    refresh.setAttribute("id", "jbSyncRefreshBtn");
    refresh.setAttribute("aria-label", "Refresh from your Google Sheet");
    refresh.addEventListener("click", () => {
      void loadAllData();
    });
    row.appendChild(label);
    row.appendChild(refresh);
    bar.appendChild(row);

    const banner = makeEl("div", "jb-sync__banner");
    banner.setAttribute("id", "jbSyncBanner");
    banner.setAttribute("role", "alert");
    banner.hidden = true;
    bar.appendChild(banner);

    const anchor =
      typeof document.querySelector === "function"
        ? document.querySelector('[data-region="today"]')
        : null;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(bar, anchor);
    } else {
      document.body.appendChild(bar);
    }
    return bar;
  }

  function renderSyncLabel() {
    const label = document.getElementById("jbSyncLabel");
    if (label) label.textContent = formatSyncedAgo(loadState.lastSyncedAt, Date.now());
  }

  function startSyncTicker() {
    if (syncTicker || typeof setInterval !== "function") return;
    syncTicker = setInterval(renderSyncLabel, 30000);
  }

  function setSyncBusy(busy) {
    const bar = document.getElementById("jbSyncBar");
    if (bar) bar.setAttribute("aria-busy", busy ? "true" : "false");
    const btn = document.getElementById("jbSyncRefreshBtn");
    if (btn) {
      btn.textContent = busy ? "Refreshing…" : "Refresh";
      if (busy) btn.setAttribute("disabled", "");
      else btn.removeAttribute("disabled");
    }
  }

  function renderSyncBanner(failure) {
    const bar = ensureSyncBar();
    if (!bar) return;
    const banner = document.getElementById("jbSyncBanner");
    if (!banner) return;
    if (!failure) {
      banner.hidden = true;
      bar.setAttribute("data-state", "ok");
      return;
    }
    const copy = describeLoadFailure({ ...failure, email: signedInEmail() });
    bar.setAttribute("data-state", copy.kind === "offline" ? "offline" : "failed");
    bar.hidden = false;
    clearChildren(banner);
    const text = makeEl("div", "jb-sync__banner-text");
    text.appendChild(makeEl("strong", "jb-sync__banner-title", copy.title));
    const since = loadState.lastSyncedAt
      ? ` You’re seeing what was ${formatSyncedAgo(loadState.lastSyncedAt, Date.now()).replace(/^Synced /, "synced ")}.`
      : "";
    text.appendChild(makeEl("span", "jb-sync__banner-detail", copy.detail + since));
    banner.appendChild(text);

    const actions = makeEl("div", "jb-sync__banner-actions");
    const retry = makeEl("button", "jb-sync__btn jb-sync__btn--primary", "Retry");
    retry.setAttribute("type", "button");
    retry.addEventListener("click", () => {
      void loadAllData();
    });
    actions.appendChild(retry);
    const h = host();
    if (copy.kind === "forbidden") {
      const sid = normalizeActiveSheetId(h.getActiveSheetId && h.getActiveSheetId());
      if (sid) {
        const open = makeEl("a", "jb-sync__btn", "Open Sheet");
        open.setAttribute(
          "href",
          `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sid)}/edit`,
        );
        open.setAttribute("target", "_blank");
        open.setAttribute("rel", "noopener");
        actions.appendChild(open);
      }
    }
    if (copy.kind === "forbidden" || copy.kind === "not-found") {
      const settings = makeEl("button", "jb-sync__btn", "Open Settings");
      settings.setAttribute("type", "button");
      settings.addEventListener("click", () => {
        if (typeof window.openCommandCenterSettingsModal === "function") {
          window.openCommandCenterSettingsModal();
        }
      });
      actions.appendChild(settings);
    }
    if (copy.kind === "session") {
      const signIn = makeEl("button", "jb-sync__btn", "Sign in");
      signIn.setAttribute("type", "button");
      signIn.addEventListener("click", () => {
        if (typeof h.showSheetAccessGate === "function") h.showSheetAccessGate("signin");
      });
      actions.appendChild(signIn);
    }
    banner.appendChild(actions);
    banner.hidden = false;
  }

  function hideSyncBar() {
    const bar = document.getElementById && document.getElementById("jbSyncBar");
    if (bar) bar.hidden = true;
  }

  function wireConnectivity() {
    if (connectivityWired || typeof window.addEventListener !== "function") return;
    connectivityWired = true;
    window.addEventListener("offline", () => {
      if (!loadState.dataLoaded) return;
      renderSyncBanner({ status: 0, kind: "offline" });
    });
    window.addEventListener("online", () => {
      if (!loadState.dataLoaded) return;
      void loadAllData().then((ok) => {
        const w = window.JobBoredApp && window.JobBoredApp.sheetsWrite;
        if (ok && w && typeof w.flushPendingFavorites === "function") {
          void w.flushPendingFavorites();
        }
      });
    });
  }

  function recordLoadSuccess(pipelineData) {
    const first = !loadState.dataLoaded;
    loadState.dataLoaded = true;
    loadState.lastSyncedAt = Date.now();
    loadState.lastFailure = null;
    try {
      if (document.documentElement && document.documentElement.dataset) {
        document.documentElement.dataset.jbDataLoaded = "true";
      }
    } catch (_) {
      /* dataset is a convenience hook for CSS; ignore */
    }
    const bar = ensureSyncBar();
    if (bar) bar.hidden = false;
    renderSyncBanner(null);
    renderSyncLabel();
    startSyncTicker();
    wireConnectivity();
    emitDataEvent("jb:data:loaded", {
      rows: pipelineData,
      count: Array.isArray(pipelineData) ? pipelineData.length : 0,
      first,
      lastSyncedAt: loadState.lastSyncedAt,
    });
  }

  function recordLoadFailure() {
    const failure = lastReadFailure ||
      (isOnline() ? { status: 0, kind: "unknown" } : { status: 0, kind: "offline" });
    loadState.lastFailure = failure;
    emitDataEvent("jb:data:load-failed", {
      status: failure.status,
      kind: failure.kind,
      lastSyncedAt: loadState.lastSyncedAt,
      hasLastGood: loadState.dataLoaded,
    });
    return failure;
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

  let usedPublicSheetFallback = false;

  function getUsedPublicSheetFallback() {
    return usedPublicSheetFallback;
  }

  function setUsedPublicSheetFallback(value) {
    usedPublicSheetFallback = !!value;
  }

  function knownMissingSheetsApiScope(h) {
    if (!h || typeof h.hasGrantedOauthScope !== "function") return false;
    const writeScope =
      (typeof h.getGoogleSheetsScope === "function" &&
        h.getGoogleSheetsScope()) ||
      "https://www.googleapis.com/auth/spreadsheets";
    const readonlyScope =
      "https://www.googleapis.com/auth/spreadsheets.readonly";
    return (
      !h.hasGrantedOauthScope(writeScope) &&
      !h.hasGrantedOauthScope(readonlyScope)
    );
  }

  async function fetchSheetViaSheetsAPI(sheetName, isRetry) {
    const h = host();
    const accessToken = h.getAccessToken();
    const sheetId = normalizeActiveSheetId(h.getActiveSheetId());
    if (!accessToken || !sheetId) return null;
    if (knownMissingSheetsApiScope(h)) return null;
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
      lastReadFailure = { status: 401, kind: "session" };
      if (h.getAccessToken()) {
        h.clearSessionAuthState();
        h.showToast("Your Google session ended — sign in again", "error", true, {
          label: "Sign in",
          onClick: () => h.showSheetAccessGate("signin"),
        });
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
      lastReadFailure = { status: resp.status, kind: "http" };
      return null;
    }
    const data = await resp.json();
    return data.values != null ? data.values : [];
  }

  async function fetchSheetCSV(sheetName) {
    const h = host();
    const accessToken = h.getAccessToken();
    const sheetId = normalizeActiveSheetId(h.getActiveSheetId());
    usedPublicSheetFallback = false;

    if (accessToken && !knownMissingSheetsApiScope(h)) {
      try {
        const apiRows = await fetchSheetViaSheetsAPI(sheetName);
        if (apiRows !== null) {
          usedPublicSheetFallback = false;
          return apiRows;
        }
      } catch (e) {
        console.warn("[JobBored] Sheets API read:", e);
        // fetch() rejects only when the request never got an answer:
        // offline, DNS, or a blocked connection. Say so in plain words.
        lastReadFailure = { status: 0, kind: "offline" };
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
      usedPublicSheetFallback = true;
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
        usedPublicSheetFallback = true;
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
        matchScore:
          row[20] != null && String(row[20]).trim() !== "" && Number.isFinite(Number(row[20]))
            ? Number(row[20])
            : null,
        favorite: row[21] === "★",
        dismissedAt: row[22] ? String(row[22]).trim() || null : null,
        _editLock: row[24] != null ? String(row[24]).trim() : "",
      });
    }

    return results;
  }

  async function loadAllData() {
    const h = host();
    lastReadFailure = null;
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
      hideSyncBar();
      return false;
    }

    if (!normalizeActiveSheetId(h.getActiveSheetId())) {
      hideSyncBar();
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
    loadState.loading = true;
    setSyncBusy(true);

    try {
      const pipelineRows = await fetchSheetCSV("Pipeline");

      if (!pipelineRows) {
        startupLog("sheets-read:load:fetch-failed", {
          initialAccessResolved: !!h.getInitialSheetAccessResolved(),
          hasAccessToken: !!h.getAccessToken(),
        }, "error");
        const failure = recordLoadFailure();
        if (!h.getInitialSheetAccessResolved()) {
          if (!h.getAccessToken() && h.getOAuthClientId()) {
            h.showSheetAccessGate("signin");
          } else if (!h.getOAuthClientId()) {
            h.showSheetAccessGate("no-oauth");
          } else {
            h.showSheetAccessGate("error");
          }
        } else {
          // Mid-session: keep the last good board, say what broke, offer Retry.
          renderSyncBanner(failure);
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
      recordLoadSuccess(pipelineData);
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
      const failure = recordLoadFailure();
      if (!h.getInitialSheetAccessResolved()) {
        h.showSheetAccessGate(
          !h.getAccessToken() && h.getOAuthClientId() ? "signin" : "error",
        );
      } else {
        renderSyncBanner(failure);
        showErrorState();
      }
      h.setDataLoadFailed(true);
      return false;
    } finally {
      if (refreshBtn) refreshBtn.classList.remove("loading");
      loadState.loading = false;
      setSyncBusy(false);
    }
  }

  function showErrorState() {
    const h = host();
    const jobCards = document.getElementById("jobCards");
    const errorState = document.getElementById("errorState");
    const errorOpenDirect = document.getElementById("errorOpenDirect");
    const errorViewSheet = document.getElementById("errorViewSheet");
    const errorHint = document.getElementById("errorStateHint");

    // SS-01: a failed refresh after a good load must not wipe the board —
    // the sync banner above carries the error and the Retry. Only a load
    // that never succeeded falls back to the legacy error block.
    if (loadState.dataLoaded) {
      if (errorState) errorState.style.display = "none";
      return;
    }
    if (jobCards) jobCards.innerHTML = "";
    if (errorState) errorState.style.display = "block";
    if (errorOpenDirect) {
      // SS-10: the primary action retries instead of reopening this page.
      errorOpenDirect.textContent = "Retry";
      errorOpenDirect.href = "#";
      errorOpenDirect.target = "";
      if (
        typeof errorOpenDirect.addEventListener === "function" &&
        !errorOpenDirect._jbRetryWired
      ) {
        errorOpenDirect.addEventListener("click", (e) => {
          if (e && typeof e.preventDefault === "function") e.preventDefault();
          void loadAllData();
        });
        errorOpenDirect._jbRetryWired = true;
      }
    }
    if (errorViewSheet) {
      errorViewSheet.href = `https://docs.google.com/spreadsheets/d/${h.getActiveSheetId()}`;
    }
    if (errorHint) {
      const copy = describeLoadFailure({
        ...(loadState.lastFailure || { status: 0, kind: "unknown" }),
        email: signedInEmail(),
      });
      errorHint.textContent = `${copy.title}. ${copy.detail}`;
    }
  }

  function hideErrorState() {
    document.getElementById("errorState").style.display = "none";
  }

  Object.assign(sheetsRead, {
    parseCSV,
    parsePipelineCSV,
    fetchSheetCSV,
    getUsedPublicSheetFallback,
    setUsedPublicSheetFallback,
    loadAllData,
    describeLoadFailure,
    formatSyncedAgo,
    getLoadState,
    showErrorState,
    hideErrorState,
    applyFavoriteCache,
    favoriteCacheKeyForJob,
    setPendingFavorite,
    clearPendingFavorite,
  });
})();
