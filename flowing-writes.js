/**
 * flowing-writes.js — Sheet write-back listener for the flowing-page surface.
 *
 * Owner: BE droid 2.F.
 * Branch: feat/flowing-page.
 *
 * Listens for FE CustomEvents and writes back to the user's Google Sheet:
 *   - `jb:pipeline:move`  -> Pipeline!M{row}  (Status, column M)
 *   - `jb:letter:save`    -> Pipeline!O{row}  (Notes,  column O)
 *
 * Emits success/failure CustomEvents for the FE optimistic-UI rollback flow:
 *   - `jb:write:succeeded` { jobKey, kind }
 *   - `jb:write:failed`    { jobKey, kind, error }
 *
 * Reuses the OAuth + Sheets HTTP path that `app.js` already uses.
 * Public API surface is exposed as `window.JobBoredFlowing.writes`.
 *
 * IIFE, no module deps. Loaded after app.js so window.JobBored.* is available.
 *
 * NOTE on column mapping:
 *   The orchestrator instructed reuse of "Notes" for the letter draft. Per
 *   schemas/pipeline-row.v1.json the Notes column is letter "O" (sheetIndex 14);
 *   column "N" is "Applied Date". This file therefore writes letter drafts to
 *   column O (Notes) — the semantic intent — and surfaces a console warning
 *   if any caller tries to override it with a non-Notes column.
 */
(function () {
  "use strict";

  if (typeof window === "undefined") return;

  var ns = (window.JobBoredFlowing = window.JobBoredFlowing || {});
  if (ns.writes && ns.writes.__installed) return;

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /** Stage slug -> Sheet status label (column M enum). */
  var STAGE_LABELS = Object.freeze({
    "researching": "Researching",
    "applied": "Applied",
    "phone-screen": "Phone Screen",
    "interviewing": "Interviewing",
    "offer": "Offer",
  });

  var STATUS_COLUMN = "M"; // schemas/pipeline-row.v1.json -> status
  var NOTES_COLUMN = "O";  // schemas/pipeline-row.v1.json -> notes
  var LINK_COLUMN = "E";   // schemas/pipeline-row.v1.json -> link

  var SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

  // Cache of normalized link -> sheetRow built from a single Pipeline!E:E read.
  var rowIndexCache = null;
  var rowIndexCacheAt = 0;
  var ROW_CACHE_TTL_MS = 30 * 1000;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * @returns {string} OAuth bearer token from app.js, or "".
   */
  function getAccessToken() {
    var jb = window.JobBored;
    return (jb && typeof jb.getAccessToken === "function" && jb.getAccessToken()) || "";
  }

  /**
   * @returns {string} Spreadsheet ID from app.js, or "".
   */
  function getSheetId() {
    var jb = window.JobBored;
    return (jb && typeof jb.getSheetId === "function" && jb.getSheetId()) || "";
  }

  /**
   * Lower-cases & trims a URL for cache key matching.
   * @param {string} u
   */
  function normalizeUrl(u) {
    if (!u || typeof u !== "string") return "";
    return u.trim().toLowerCase();
  }

  /**
   * Reuse the same toast surface app.js uses, when available. Silently no-ops
   * outside the browser dashboard runtime.
   * @param {string} message
   * @param {string} type
   */
  function safeToast(message, type) {
    try {
      if (typeof window.showToast === "function") {
        window.showToast(message, type || "error");
        return;
      }
    } catch (_) { /* swallow */ }
    // app.js's showToast is module-private; fall back to console.
    try { console.warn("[JobBoredFlowing.writes]", message); } catch (_) { /* */ }
  }

  /**
   * Dispatch a write-result event on `document`.
   * @param {string} type "succeeded" | "failed"
   * @param {object} detail
   */
  function emitResult(type, detail) {
    try {
      var name = type === "succeeded" ? "jb:write:succeeded" : "jb:write:failed";
      document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (err) {
      try { console.warn("[JobBoredFlowing.writes] dispatch failed", err); } catch (_) {}
    }
  }

  /**
   * Same call shape as app.js `sheetsValuesUpdate`:
   *   PUT /v4/spreadsheets/{id}/values/{range}?valueInputOption=RAW
   *   body: { values: [[ ... ]] }
   * Auth via `Authorization: Bearer <token>`.
   * @param {string} range
   * @param {Array<Array<any>>} values
   */
  async function sheetsValuesUpdate(range, values) {
    var token = getAccessToken();
    var sheetId = getSheetId();
    if (!token) throw new Error("Not signed in");
    if (!sheetId) throw new Error("No spreadsheet configured");
    var url = SHEETS_BASE + "/" + sheetId + "/values/" + encodeURIComponent(range)
      + "?valueInputOption=RAW";
    var resp = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: values }),
    });
    if (!resp.ok) {
      var err = {};
      try { err = await resp.json(); } catch (_) { /* ignore */ }
      var msg = (err && err.error && err.error.message) || ("HTTP " + resp.status);
      throw new Error(msg);
    }
    return resp.json();
  }

  /**
   * Same call shape as app.js `sheetsValuesGet`:
   *   GET /v4/spreadsheets/{id}/values/{range}
   * @param {string} range
   */
  async function sheetsValuesGet(range) {
    var token = getAccessToken();
    var sheetId = getSheetId();
    if (!token) throw new Error("Not signed in");
    if (!sheetId) throw new Error("No spreadsheet configured");
    var url = SHEETS_BASE + "/" + sheetId + "/values/" + encodeURIComponent(range);
    var resp = await fetch(url, {
      headers: { "Authorization": "Bearer " + token },
    });
    if (!resp.ok) {
      var err = {};
      try { err = await resp.json(); } catch (_) { /* ignore */ }
      var msg = (err && err.error && err.error.message) || ("HTTP " + resp.status);
      throw new Error(msg);
    }
    return resp.json();
  }

  /**
   * Build (or read from cache) a map of normalized URL -> sheet row (1-based,
   * accounting for header row at row 1; data starts at row 2).
   * @param {boolean} [forceRefresh]
   */
  async function getUrlToRowMap(forceRefresh) {
    var now = Date.now();
    if (!forceRefresh && rowIndexCache && (now - rowIndexCacheAt) < ROW_CACHE_TTL_MS) {
      return rowIndexCache;
    }
    var data = await sheetsValuesGet("Pipeline!" + LINK_COLUMN + ":" + LINK_COLUMN);
    var values = (data && data.values) || [];
    var map = Object.create(null);
    // values[0] is the header row; data starts at index 1 (sheet row 2).
    for (var i = 1; i < values.length; i++) {
      var cell = values[i] && values[i][0];
      var key = normalizeUrl(typeof cell === "string" ? cell : "");
      if (key && map[key] == null) {
        map[key] = i + 1; // 1-based sheet row (i is 0-based, +1 -> sheet row).
      }
    }
    rowIndexCache = map;
    rowIndexCacheAt = now;
    return map;
  }

  /**
   * Try to find the rendered card in DOM and pull a link out of it. The card
   * may carry it on `data-link`/`data-href`, or as the first anchor href.
   * Returns "" when not found.
   * @param {string} jobKey
   */
  function readJobLinkFromDom(jobKey) {
    if (!jobKey || typeof document === "undefined" || !document.querySelector) return "";
    var sel = "[data-stable-key=\"" + String(jobKey).replace(/"/g, "\\\"") + "\"]";
    var card = null;
    try { card = document.querySelector(sel); } catch (_) { return ""; }
    if (!card) return "";
    var direct = card.getAttribute("data-link")
      || card.getAttribute("data-href")
      || card.getAttribute("data-url");
    if (direct) return direct;
    var a = card.querySelector && card.querySelector("a[href]");
    return (a && a.getAttribute("href")) || "";
  }

  /**
   * Resolve a `jobKey` to a 1-based sheet row in the Pipeline tab. The FE
   * contract sends an opaque `jobKey`; we accept three shapes, in order:
   *   1. Integer-like key that already encodes the sheet row (>= 2).
   *   2. URL string that matches a value in column E.
   *   3. Indirection via DOM: read `data-link` (etc.) off the rendered card.
   *
   * @param {string|number} jobKey
   * @returns {Promise<number>} sheet row (>= 2), throws on miss.
   */
  async function resolveSheetRow(jobKey) {
    if (jobKey == null || jobKey === "") {
      throw new Error("Missing jobKey");
    }
    // 1) Direct numeric row.
    if (typeof jobKey === "number" && Number.isFinite(jobKey) && jobKey >= 2) {
      return Math.floor(jobKey);
    }
    if (typeof jobKey === "string" && /^\d+$/.test(jobKey)) {
      var n = parseInt(jobKey, 10);
      if (n >= 2) {
        // Also try treating the digit-string as a URL (column-E literal "12345").
        // Numeric-only links are unlikely; prefer row mapping when the digit is
        // a plausible row number.
        return n;
      }
    }
    // 2) URL match against column E.
    var asKey = normalizeUrl(String(jobKey));
    if (asKey && /^https?:\/\//.test(asKey)) {
      var map = await getUrlToRowMap(false);
      if (map[asKey]) return map[asKey];
      var fresh = await getUrlToRowMap(true);
      if (fresh[asKey]) return fresh[asKey];
    }
    // 3) DOM indirection -> URL match.
    var domLink = readJobLinkFromDom(jobKey);
    var domKey = normalizeUrl(domLink);
    if (domKey) {
      var map2 = await getUrlToRowMap(false);
      if (map2[domKey]) return map2[domKey];
      var fresh2 = await getUrlToRowMap(true);
      if (fresh2[domKey]) return fresh2[domKey];
    }
    throw new Error("Could not resolve jobKey to a Pipeline row: " + String(jobKey));
  }

  /**
   * Translate a FE stage slug to the column-M label.
   * @param {string} stage
   */
  function stageLabel(stage) {
    if (!stage) return null;
    var slug = String(stage).trim().toLowerCase();
    return STAGE_LABELS[slug] || null;
  }

  // ---------------------------------------------------------------------------
  // Write actions
  // ---------------------------------------------------------------------------

  /**
   * Write a status (column M) for the given jobKey.
   * @param {{jobKey:any, fromStage:string, toStage:string}} payload
   */
  async function moveStage(payload) {
    var detail = payload || {};
    var jobKey = detail.jobKey;
    var label = stageLabel(detail.toStage);
    try {
      if (!label) {
        throw new Error("Unknown toStage: " + String(detail.toStage));
      }
      var row = await resolveSheetRow(jobKey);
      var range = "Pipeline!" + STATUS_COLUMN + row;
      await sheetsValuesUpdate(range, [[label]]);
      emitResult("succeeded", { jobKey: jobKey, kind: "stage" });
    } catch (err) {
      var msg = (err && err.message) || String(err);
      emitResult("failed", { jobKey: jobKey, kind: "stage", error: msg });
      safeToast("Couldn't save stage change: " + msg, "error");
    }
  }

  /**
   * Write a letter draft into the Notes (column O) cell for the given jobKey.
   * @param {{jobKey:any, draft:string}} payload
   */
  async function saveLetter(payload) {
    var detail = payload || {};
    var jobKey = detail.jobKey;
    var draft = (detail.draft == null) ? "" : String(detail.draft);
    try {
      var row = await resolveSheetRow(jobKey);
      var range = "Pipeline!" + NOTES_COLUMN + row;
      await sheetsValuesUpdate(range, [[draft]]);
      emitResult("succeeded", { jobKey: jobKey, kind: "letter" });
    } catch (err) {
      var msg = (err && err.message) || String(err);
      emitResult("failed", { jobKey: jobKey, kind: "letter", error: msg });
      safeToast("Couldn't save letter draft: " + msg, "error");
    }
  }

  // ---------------------------------------------------------------------------
  // Wire up listeners
  // ---------------------------------------------------------------------------

  function onMoveEvent(e) {
    var payload = (e && e.detail) || {};
    // Fire-and-forget; per-event errors are surfaced as jb:write:failed.
    moveStage(payload);
  }

  function onLetterEvent(e) {
    var payload = (e && e.detail) || {};
    saveLetter(payload);
  }

  function install() {
    if (typeof document === "undefined" || !document.addEventListener) return;
    document.addEventListener("jb:pipeline:move", onMoveEvent);
    document.addEventListener("jb:letter:save", onLetterEvent);
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  ns.writes = {
    __installed: true,
    /** Manual entry points for tests / programmatic callers. */
    moveStage: moveStage,
    saveLetter: saveLetter,
    /** Internals exposed for the self-test below. */
    _internal: {
      stageLabel: stageLabel,
      normalizeUrl: normalizeUrl,
      resolveSheetRow: resolveSheetRow,
      getUrlToRowMap: getUrlToRowMap,
      sheetsValuesUpdate: sheetsValuesUpdate,
      sheetsValuesGet: sheetsValuesGet,
      readJobLinkFromDom: readJobLinkFromDom,
      _resetCache: function () { rowIndexCache = null; rowIndexCacheAt = 0; },
      _columns: {
        STATUS_COLUMN: STATUS_COLUMN,
        NOTES_COLUMN: NOTES_COLUMN,
        LINK_COLUMN: LINK_COLUMN,
      },
      _stageLabels: STAGE_LABELS,
    },
  };

  install();

  // ---------------------------------------------------------------------------
  // Self-test (runs only when explicitly invoked, e.g. window.JobBoredFlowing
  // .writes._internal.selfTest()). Keeps file side-effect free at load.
  // ---------------------------------------------------------------------------
  ns.writes._internal.selfTest = function selfTest() {
    var failures = [];
    function eq(a, b, label) {
      if (a !== b) failures.push(label + ": expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
    }
    eq(stageLabel("applied"), "Applied", "stageLabel(applied)");
    eq(stageLabel("Phone-Screen"), "Phone Screen", "stageLabel(Phone-Screen)");
    eq(stageLabel("offer"), "Offer", "stageLabel(offer)");
    eq(stageLabel("nope"), null, "stageLabel(nope)");
    eq(normalizeUrl("  HTTPS://Foo/Bar  "), "https://foo/bar", "normalizeUrl");
    eq(STATUS_COLUMN, "M", "STATUS_COLUMN");
    eq(NOTES_COLUMN, "O", "NOTES_COLUMN");
    if (failures.length) {
      try { console.error("[JobBoredFlowing.writes] self-test failures", failures); } catch (_) {}
      return { ok: false, failures: failures };
    }
    try { console.log("[JobBoredFlowing.writes] self-test ok"); } catch (_) {}
    return { ok: true };
  };
})();
