import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { validateSheetsCredentialReadiness } from "../../src/sheets/credential-readiness.ts";

/*
  A placeholder Sheet is not a broken credential.

  A fresh install ships worker-config.json with `sheetId: "YOUR_SHEET_ID_HERE"`,
  and a dashboard that has not finished Beat 1 sends an empty sheetId — local
  mode then falls back to the stored placeholder. The readiness probe asked
  Google for a spreadsheet literally named YOUR_SHEET_ID_HERE, got a 404, and
  reported the credential itself as broken:

    Discovery worker Google service account file is invalid or cannot access
    the configured Sheet. Google Sheets access check failed for sheetId
    YOUR_SHEET_ID_HERE: HTTP 404 …

  The service-account key was valid the whole time (Emilio, 2026-09-02). The
  probe now runs only against a real sheet id, so "no sheet connected yet"
  stays a setup step instead of masquerading as a credential fault.
*/

const baseRuntimeConfig = {
  googleAccessToken: "",
  googleServiceAccountJson: "",
  googleServiceAccountFile: "",
  googleOAuthTokenJson: "",
  googleOAuthTokenFile: "",
} as never;

function makeServiceAccountJson() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "worker@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

/** Answers the token endpoint; records every other URL it is asked for. */
function tokenOnlyFetch(sheetCalls: string[]) {
  return async (input: unknown) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "active-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    sheetCalls.push(url);
    return new Response('{"error":{"code":404}}', { status: 404 });
  };
}

test("the placeholder sheet id is never probed, and the credential reads healthy", async () => {
  const sheetCalls: string[] = [];
  const status = await validateSheetsCredentialReadiness(
    { ...baseRuntimeConfig, googleServiceAccountJson: makeServiceAccountJson() },
    { sheetId: "YOUR_SHEET_ID_HERE", fetchImpl: tokenOnlyFetch(sheetCalls) as never },
  );

  assert.equal(status.configured, true, "the key is valid; there is just no sheet");
  assert.equal(status.source, "service_account_json");
  assert.deepEqual(sheetCalls, [], "no Sheets request may be made for a placeholder");
  assert.equal(status.sheetAccess, undefined, "nothing was verified, so nothing is claimed");
});

test("a whitespace-only sheet id is treated as no sheet", async () => {
  const sheetCalls: string[] = [];
  const status = await validateSheetsCredentialReadiness(
    { ...baseRuntimeConfig, googleServiceAccountJson: makeServiceAccountJson() },
    { sheetId: "   ", fetchImpl: tokenOnlyFetch(sheetCalls) as never },
  );

  assert.equal(status.configured, true);
  assert.deepEqual(sheetCalls, []);
});

test("a REAL sheet id is still probed, and a 404 still fails closed", async () => {
  const sheetCalls: string[] = [];
  const status = await validateSheetsCredentialReadiness(
    { ...baseRuntimeConfig, googleServiceAccountJson: makeServiceAccountJson() },
    {
      sheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab",
      fetchImpl: tokenOnlyFetch(sheetCalls) as never,
    },
  );

  assert.equal(status.configured, false, "an unreachable real sheet must fail closed");
  assert.equal(sheetCalls.length, 1, "the probe ran");
  assert.match(sheetCalls[0], /sheets\.googleapis\.com/);
});
