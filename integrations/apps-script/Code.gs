/**
 * Command Center — discovery webhook (Google Apps Script)
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Script properties (Project settings > Script properties):
 *   SHEET_ID   — required to append rows (your copy of the template)
 *   WEBHOOK_SECRET — shared secret. When set, every POST must carry it as the
 *                    ?secret= query parameter of the /exec URL you paste into
 *                    the dashboard. Test rows are only written when it is set.
 *   ENABLE_TEST_ROW — set to "true" to append one Pipeline test row (deduped
 *                     by URL) per valid, authenticated POST (for smoke tests)
 *
 * The web app is public ("Anyone"), so it logs only the event name and
 * variationKey, never the request body.
 *
 * @see ../AGENT_CONTRACT.md (repo root) — discovery webhook JSON v1
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonOut_({ ok: false, error: "busy" });
  }
  try {
    var raw = (e.postData && e.postData.contents) || "{}";
    var body;
    var appendedTestRow = false;
    try {
      body = JSON.parse(raw);
    } catch (parseErr) {
      return jsonOut_({ ok: false, error: "invalid json" });
    }

    if (body.event && body.event !== "command-center.discovery") {
      return jsonOut_({ ok: false, error: "unknown event" });
    }

    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty("WEBHOOK_SECRET") || "";
    var sentSecret = (e && e.parameter && e.parameter.secret) || "";
    if (secret && !secretsMatch_(String(sentSecret), String(secret))) {
      return jsonOut_({ ok: false, error: "unauthorized" });
    }

    Logger.log(
      "command-center.discovery variationKey=" + String(body.variationKey || ""),
    );

    var sheetId = props.getProperty("SHEET_ID");
    if (sheetId && body.sheetId && String(body.sheetId) !== String(sheetId)) {
      Logger.log("sheetId mismatch: expected " + sheetId);
      return jsonOut_({ ok: false, error: "sheetId mismatch" });
    }

    if (props.getProperty("ENABLE_TEST_ROW") === "true" && sheetId) {
      if (!secret) {
        Logger.log("ENABLE_TEST_ROW is ignored until WEBHOOK_SECRET is set");
      } else {
        appendedTestRow = appendTestRow_(sheetId, body);
      }
    }

    return jsonOut_({
      ok: true,
      service: "command-center-apps-script-stub",
      mode: "stub",
      received: true,
      appendedTestRow: appendedTestRow,
      realDiscoveryConfigured: false,
      schemaVersion: body.schemaVersion != null ? body.schemaVersion : null,
    });
  } catch (err) {
    Logger.log(err);
    return jsonOut_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Some browsers may send OPTIONS before POST. Apps Script web apps often do not
 * answer CORS preflight; use templates/github-actions/ to POST server-side if needed.
 */
function doGet(e) {
  var payload = { ok: true, service: "command-center-apps-script-stub" };
  var callback =
    e &&
    e.parameter &&
    e.parameter.callback
      ? String(e.parameter.callback)
      : "";
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$\.]{0,120}$/.test(callback)) {
    return javascriptOut_(callback + "(" + JSON.stringify(payload) + ");");
  }
  return jsonOut_(payload);
}

function secretsMatch_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Appends one test row per variationKey; returns false when it already exists. */
function appendTestRow_(sheetId, body) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sh = ss.getSheetByName("Pipeline");
  if (!sh) {
    throw new Error('Sheet "Pipeline" not found');
  }
  var variationKey = String(body.variationKey || "x").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) || "x";
  var link = "https://example.com/command-center-stub-" + variationKey;
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var links = sh.getRange(2, 5, lastRow - 1, 1).getValues();
    for (var i = 0; i < links.length; i++) {
      if (String(links[i][0]) === link) return false;
    }
  }
  sh.appendRow([
    new Date(),
    "[CC test] Discovery ping",
    "Apps Script stub",
    "",
    link,
    "Apps Script",
    "",
    "5",
    "\u2014",
    "test",
    "Test row from Apps Script stub. variationKey=" + variationKey,
    "",
    "New",
    "",
    "",
    "",
    "",
  ]);
  return true;
}

function jsonOut_(obj) {
  var out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

function javascriptOut_(source) {
  var out = ContentService.createTextOutput(String(source || ""));
  out.setMimeType(ContentService.MimeType.JAVASCRIPT);
  return out;
}
