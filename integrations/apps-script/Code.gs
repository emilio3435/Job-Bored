/**
 * Command Center — discovery webhook (Google Apps Script)
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Script properties (Project settings > Script properties):
 *   SHEET_ID   — required to append rows (your copy of the template)
 *   ENABLE_TEST_ROW — set to "true" to append one Pipeline row per valid POST (for smoke tests)
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

    Logger.log("command-center.discovery " + JSON.stringify(body));

    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty("SHEET_ID");
    if (sheetId && body.sheetId && String(body.sheetId) !== String(sheetId)) {
      Logger.log("sheetId mismatch: expected " + sheetId);
      return jsonOut_({ ok: false, error: "sheetId mismatch" });
    }

    if (props.getProperty("ENABLE_TEST_ROW") === "true" && sheetId) {
      appendTestRow_(sheetId, body);
      appendedTestRow = true;
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

function appendTestRow_(sheetId, body) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sh = ss.getSheetByName("Pipeline");
  if (!sh) {
    throw new Error('Sheet "Pipeline" not found');
  }
  var profile = body.discoveryProfile || {};
  var note =
    "Test row from Apps Script stub. variationKey=" +
    String(body.variationKey || "") +
    " targetRoles=" +
    String(profile.targetRoles || "").slice(0, 80);
  sh.appendRow([
    new Date(),
    "[CC test] Discovery ping",
    "Apps Script stub",
    "",
    "https://example.com/command-center-stub-" + String(body.variationKey || "x"),
    "Apps Script",
    "",
    "5",
    "\u2014",
    "test",
    note,
    "",
    "New",
    "",
    "",
    "",
    "",
  ]);
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
