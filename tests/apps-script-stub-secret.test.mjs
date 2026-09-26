// BEAUDIT D20: the Apps Script discovery stub is a public web app. It must
// not log the discovery profile, must require a shared secret before it
// writes to the Sheet, and must not append the same test row twice.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../integrations/apps-script/Code.gs", import.meta.url), "utf8");

function loadStub(properties) {
  const logs = [];
  const appended = [];
  const links = [];
  const sheet = {
    appendRow(row) {
      appended.push(row);
      links.push(row[4]);
    },
    getLastRow() {
      return links.length + 1;
    },
    getRange(row, col, numRows) {
      return {
        getValues() {
          return links.slice(row - 2, row - 2 + numRows).map((link) => [link]);
        },
      };
    },
  };
  const context = {
    Logger: { log: (message) => logs.push(String(message)) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key) => (key in properties ? properties[key] : null) }),
    },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
    ContentService: {
      MimeType: { JSON: "json", JAVASCRIPT: "js" },
      createTextOutput: (text) => ({ text, setMimeType() {} }),
    },
  };
  vm.runInNewContext(source, context);
  const post = (body, parameter = {}) =>
    JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) }, parameter }).text);
  return { post, logs, appended };
}

const body = {
  event: "command-center.discovery",
  schemaVersion: 1,
  sheetId: "sheet_1234567890",
  variationKey: "var-1",
  discoveryProfile: { targetRoles: "Staff Engineer", resumeText: "PRIVATE RESUME TEXT", email: "user@example.com" },
};

test("D20: the stub logs only the event and variationKey, never the profile", () => {
  const stub = loadStub({ SHEET_ID: "sheet_1234567890" });
  stub.post(body);
  const joined = stub.logs.join("\n");
  assert.doesNotMatch(joined, /PRIVATE RESUME TEXT|user@example\.com|Staff Engineer/);
  assert.match(joined, /var-1/);
});

test("D20: with WEBHOOK_SECRET set, a POST without the secret is refused", () => {
  const stub = loadStub({ SHEET_ID: "sheet_1234567890", WEBHOOK_SECRET: "s3cret-value" });
  assert.deepEqual(stub.post(body), { ok: false, error: "unauthorized" });
  assert.equal(stub.post(body, { secret: "wrong" }).ok, false);
  assert.equal(stub.post(body, { secret: "s3cret-value" }).ok, true);
});

test("D20: test rows need the shared secret", () => {
  const open = loadStub({ SHEET_ID: "sheet_1234567890", ENABLE_TEST_ROW: "true" });
  const res = open.post(body);
  assert.equal(res.ok, true);
  assert.equal(res.appendedTestRow, false);
  assert.equal(open.appended.length, 0);

  const gated = loadStub({ SHEET_ID: "sheet_1234567890", ENABLE_TEST_ROW: "true", WEBHOOK_SECRET: "s3cret-value" });
  assert.equal(gated.post(body, { secret: "s3cret-value" }).appendedTestRow, true);
  assert.equal(gated.appended.length, 1);
});

test("D20: the test row is deduped by URL", () => {
  const stub = loadStub({ SHEET_ID: "sheet_1234567890", ENABLE_TEST_ROW: "true", WEBHOOK_SECRET: "s3cret-value" });
  stub.post(body, { secret: "s3cret-value" });
  const second = stub.post(body, { secret: "s3cret-value" });
  assert.equal(stub.appended.length, 1);
  assert.equal(second.appendedTestRow, false);
  // The note no longer copies profile text into the Sheet.
  assert.doesNotMatch(JSON.stringify(stub.appended[0]), /Staff Engineer/);
});
