/**
 * flowing-writes.js — Sheet write-back listener for the flowing-page surface.
 *
 * Owner: BE droid 2.F.
 * Branch: feat/flowing-page.
 *
 * Listens for FE CustomEvents and writes back to the user's Google Sheet:
 *   - `jb:pipeline:move`  -> Pipeline!M{row}  (Status, column M)
 *   - `jb:letter:save`    -> legacy no-op; drafts live in IndexedDB
 *   - `jb:role:note`      -> Pipeline!O{row}  (Notes,  column O)
 *   - `jb:role:writeback` { jobKey, field, value } — multiplexed bridge:
 *       stage/heardBack/reply/followupAt/passed write a column here directly,
 *       while the masthead identity edits title/company/location/salary
 *       (Pipeline columns B/C/D/G) delegate to window.JobBored.editJobField,
 *       which also writes the Edit Lock column Y atomically so re-discovery
 *       preserves the user's edit.
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
 *   Per schemas/pipeline-row.v1.json the Notes column is letter "O"
 *   (sheetIndex 14); column "N" is "Applied Date". Dossier notes are the
 *   only flowing-page write path that owns column O. Cover-letter drafts
 *   are stored in the browser's IndexedDB draft library by app.js.
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
    "new": "New",
    "researching": "Researching",
    "applied": "Applied",
    "phone-screen": "Phone Screen",
    "interviewing": "Interviewing",
    "offer": "Offer",
    "expired": "Expired",
  });

  var STATUS_COLUMN = "M"; // schemas/pipeline-row.v1.json -> status
  var NOTES_COLUMN = "O";  // schemas/pipeline-row.v1.json -> notes
  var FOLLOWUP_COLUMN = "P"; // schemas/pipeline-row.v1.json -> followUpDate
  var LAST_CONTACT_COLUMN = "R"; // schemas/pipeline-row.v1.json -> lastHeardFrom
  var RESPONSE_COLUMN = "S"; // schemas/pipeline-row.v1.json -> responseFlag
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

  function toSheetRowNumber(value) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 2) {
      return Math.floor(value);
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      var n = parseInt(value, 10);
      if (n >= 2) return n;
    }
    return null;
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

  function findCardsForJobKey(jobKey) {
    if (!jobKey || typeof document === "undefined" || !document.querySelector) return [];
    var sel = "[data-stable-key=\"" + String(jobKey).replace(/"/g, "\\\"") + "\"]";
    try {
      if (document.querySelectorAll) return document.querySelectorAll(sel) || [];
      var single = document.querySelector(sel);
      return single ? [single] : [];
    } catch (_) {
      return [];
    }
  }

  function readSheetRowFromDom(jobKey) {
    var cards = findCardsForJobKey(jobKey);
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!card || !card.getAttribute) continue;
      var row = toSheetRowNumber(card.getAttribute("data-sheet-row"));
      if (row) return row;
    }
    return null;
  }

  /**
   * Try to find rendered cards in DOM and pull a link out of them. V2 cards may
   * render before the hidden legacy `.kanban-card`, so scan all key matches.
   * Returns "" when not found.
   * @param {string} jobKey
   */
  function readJobLinkFromDom(jobKey) {
    var cards = findCardsForJobKey(jobKey);
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!card || !card.getAttribute) continue;
      var direct = card.getAttribute("data-job-url")
        || card.getAttribute("data-link")
        || card.getAttribute("data-href")
        || card.getAttribute("data-url");
      if (direct) return direct;
      var a = card.querySelector && card.querySelector("a[href]");
      var href = (a && a.getAttribute("href")) || "";
      if (href) return href;
    }
    return "";
  }

  function readSheetRowFromApp(jobKey) {
    var jb = window.JobBored;
    if (!jb || typeof jb.getPipelineSheetRow !== "function") return null;
    try {
      return toSheetRowNumber(jb.getPipelineSheetRow(jobKey));
    } catch (_) {
      return null;
    }
  }

  function syncStageToApp(jobKey, label) {
    var jb = window.JobBored;
    if (!jb || typeof jb.applyPipelineStageWrite !== "function") return;
    try {
      jb.applyPipelineStageWrite(jobKey, label);
    } catch (_) {
      /* Local UI sync is best-effort; the Sheet write already succeeded. */
    }
  }

  function syncNotesToApp(jobKey, body) {
    var jb = window.JobBored;
    if (!jb || typeof jb.applyPipelineNotesWrite !== "function") return;
    try {
      jb.applyPipelineNotesWrite(jobKey, body);
    } catch (_) {
      /* Local UI sync is best-effort; the Sheet write already succeeded. */
    }
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
    // 1) URL match against column E.
    var asKey = normalizeUrl(String(jobKey));
    if (asKey && /^https?:\/\//.test(asKey)) {
      var map = await getUrlToRowMap(false);
      if (map[asKey]) return map[asKey];
      var fresh = await getUrlToRowMap(true);
      if (fresh[asKey]) return fresh[asKey];
    }
    // 2) The current FE sends numeric `jobKey` values as pipelineData indexes.
    var appRow = readSheetRowFromApp(jobKey);
    if (appRow) return appRow;
    var domRow = readSheetRowFromDom(jobKey);
    if (domRow) return domRow;
    // 3) DOM indirection -> URL match.
    var domLink = readJobLinkFromDom(jobKey);
    var domKey = normalizeUrl(domLink);
    if (domKey) {
      var map2 = await getUrlToRowMap(false);
      if (map2[domKey]) return map2[domKey];
      var fresh2 = await getUrlToRowMap(true);
      if (fresh2[domKey]) return fresh2[domKey];
    }
    // 4) Programmatic fallback for callers that pass a literal sheet row.
    var directRow = toSheetRowNumber(jobKey);
    if (directRow) return directRow;
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
      syncStageToApp(jobKey, label);
      emitResult("succeeded", {
        jobKey: jobKey,
        kind: "pipeline:move",
        fromStage: detail.fromStage,
        toStage: detail.toStage,
        status: label,
      });
    } catch (err) {
      var msg = (err && err.message) || String(err);
      emitResult("failed", { jobKey: jobKey, kind: "pipeline:move", error: msg });
      safeToast("Couldn't save stage change: " + msg, "error");
    }
  }

  /**
   * Write one Pipeline cell for write-back chips that map directly to a Sheet
   * column in schemas/pipeline-row.v1.json.
   * @param {any} jobKey
   * @param {string} column
   * @param {any} value
   * @param {string} kind
   * @param {string} label
   */
  async function writeColumn(jobKey, column, value, kind, label) {
    try {
      var row = await resolveSheetRow(jobKey);
      var range = "Pipeline!" + column + row;
      await sheetsValuesUpdate(range, [[value]]);
      emitResult("succeeded", { jobKey: jobKey, kind: kind });
    } catch (err) {
      var msg = (err && err.message) || String(err);
      emitResult("failed", { jobKey: jobKey, kind: kind, error: msg });
      safeToast("Couldn't save " + label + ": " + msg, "error");
    }
  }

  /**
   * Write a status (column M) from the role write-back event.
   * @param {any} jobKey
   * @param {string} value
   */
  function writeStage(jobKey, value) {
    return moveStage({ jobKey: jobKey, toStage: value });
  }

  /**
   * Write last-contact date (column R).
   * @param {any} jobKey
   * @param {string} value
   */
  function writeHeardBack(jobKey, value) {
    return writeColumn(jobKey, LAST_CONTACT_COLUMN, value || "", "heardBack", "last contact");
  }

  /**
   * Mark the response flag (column S) using the same enum as the drawer select.
   * @param {any} jobKey
   */
  function writeReply(jobKey) {
    return writeColumn(jobKey, RESPONSE_COLUMN, "Yes", "reply", "reply status");
  }

  /**
   * Write follow-up date (column P).
   * @param {any} jobKey
   * @param {string} value
   */
  function writeFollowup(jobKey, value) {
    return writeColumn(jobKey, FOLLOWUP_COLUMN, value || "", "followupAt", "follow-up date");
  }

  /**
   * Mark the role as Passed by writing the existing Status enum (column M).
   * The workshop emits `true`; `false` is intentionally a no-op because there
   * is no contract-safe previous stage to restore.
   * @param {any} jobKey
   * @param {boolean} value
   */
  function writePassed(jobKey, value) {
    if (value !== true) return Promise.resolve();
    return writeColumn(jobKey, STATUS_COLUMN, "Passed", "passed", "passed status");
  }

  /**
   * Legacy letter autosave hook. Kept so older letter.js builds or tests that
   * still dispatch jb:letter:save do not accidentally overwrite dossier notes.
   * Cover-letter drafts are persisted by app.js into IndexedDB.
   * @param {{jobKey:any, draft:string}} payload
   */
  async function saveLetter(payload) {
    var detail = payload || {};
    var jobKey = detail.jobKey;
    emitResult("succeeded", { jobKey: jobKey, kind: "letter", persisted: false });
  }

  /**
   * Write dossier notes into the Notes (column O) cell for the given jobKey.
   * @param {{jobKey:any, body:string}} payload
   */
  async function saveRoleNote(payload) {
    var detail = payload || {};
    var jobKey = detail.jobKey;
    var body = (detail.body == null) ? "" : String(detail.body);
    try {
      var row = await resolveSheetRow(jobKey);
      var range = "Pipeline!" + NOTES_COLUMN + row;
      await sheetsValuesUpdate(range, [[body]]);
      syncNotesToApp(jobKey, body);
      emitResult("succeeded", { jobKey: jobKey, kind: "role:note" });
    } catch (err) {
      var msg = (err && err.message) || String(err);
      emitResult("failed", { jobKey: jobKey, kind: "role:note", error: msg });
      safeToast("Couldn't save notes: " + msg, "error");
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

  function onRoleNoteEvent(e) {
    var payload = (e && e.detail) || {};
    saveRoleNote(payload);
  }

  function onRoleWritebackEvent(e) {
    var detail = (e && e.detail) || {};
    var jobKey = detail.jobKey;
    var field = detail.field;
    var value = detail.value;
    if (!jobKey || !field) return;
    switch (field) {
      case "stage": return writeStage(jobKey, value);
      case "heardBack": return writeHeardBack(jobKey, value);
      case "reply": return writeReply(jobKey, value);
      case "followupAt": return writeFollowup(jobKey, value);
      case "passed": return writePassed(jobKey, value);
      // Identity-field edits (masthead inputs) route to app.js editJobField,
      // which owns pipelineData + getSheetRow + the atomic value+Edit-Lock
      // updateMultipleCells batch + optimistic revert — none of which the
      // single-cell writeColumn path provides. Mirrors the syncStageToApp /
      // syncNotesToApp window.JobBored callback pattern.
      case "title":
      case "company":
      case "location":
      case "salary": {
        var jb = window.JobBored;
        if (jb && typeof jb.editJobField === "function") return jb.editJobField(jobKey, field, value);
        return;
      }
      default:
        try { console.warn("[writeback-bridge] unknown field", field); } catch (_) {}
    }
  }

  function install() {
    if (typeof document === "undefined" || !document.addEventListener) return;
    document.addEventListener("jb:pipeline:move", onMoveEvent);
    document.addEventListener("jb:letter:save", onLetterEvent);
    document.addEventListener("jb:role:note", onRoleNoteEvent);
    if (window && typeof window.addEventListener === "function") {
      window.addEventListener("jb:role:writeback", onRoleWritebackEvent);
    }
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  ns.writes = {
    __installed: true,
    /** Manual entry points for tests / programmatic callers. */
    moveStage: moveStage,
    saveLetter: saveLetter,
    saveRoleNote: saveRoleNote,
    writeStage: writeStage,
    writeHeardBack: writeHeardBack,
    writeReply: writeReply,
    writeFollowup: writeFollowup,
    writePassed: writePassed,
    /** Internals exposed for the self-test below. */
    _internal: {
      stageLabel: stageLabel,
      normalizeUrl: normalizeUrl,
      toSheetRowNumber: toSheetRowNumber,
      resolveSheetRow: resolveSheetRow,
      getUrlToRowMap: getUrlToRowMap,
      sheetsValuesUpdate: sheetsValuesUpdate,
      sheetsValuesGet: sheetsValuesGet,
      readJobLinkFromDom: readJobLinkFromDom,
      readSheetRowFromDom: readSheetRowFromDom,
      _resetCache: function () { rowIndexCache = null; rowIndexCacheAt = 0; },
      _columns: {
        STATUS_COLUMN: STATUS_COLUMN,
        NOTES_COLUMN: NOTES_COLUMN,
        FOLLOWUP_COLUMN: FOLLOWUP_COLUMN,
        LAST_CONTACT_COLUMN: LAST_CONTACT_COLUMN,
        RESPONSE_COLUMN: RESPONSE_COLUMN,
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
    eq(stageLabel("new"), "New", "stageLabel(new)");
    eq(stageLabel("Phone-Screen"), "Phone Screen", "stageLabel(Phone-Screen)");
    eq(stageLabel("offer"), "Offer", "stageLabel(offer)");
    eq(stageLabel("nope"), null, "stageLabel(nope)");
    eq(normalizeUrl("  HTTPS://Foo/Bar  "), "https://foo/bar", "normalizeUrl");
    eq(STATUS_COLUMN, "M", "STATUS_COLUMN");
    eq(NOTES_COLUMN, "O", "NOTES_COLUMN");
    eq(FOLLOWUP_COLUMN, "P", "FOLLOWUP_COLUMN");
    eq(LAST_CONTACT_COLUMN, "R", "LAST_CONTACT_COLUMN");
    eq(RESPONSE_COLUMN, "S", "RESPONSE_COLUMN");
    if (failures.length) {
      try { console.error("[JobBoredFlowing.writes] self-test failures", failures); } catch (_) {}
      return { ok: false, failures: failures };
    }
    try { console.log("[JobBoredFlowing.writes] self-test ok"); } catch (_) {}
    return { ok: true };
  };
})();
