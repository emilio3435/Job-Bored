import assert from "node:assert/strict";
import test from "node:test";

import { getSheetValues, resolveAccessToken } from "../../src/sheets/sheets-client.ts";
import { createPipelineWriter } from "../../src/sheets/pipeline-writer.ts";

const networkError = () => Object.assign(new TypeError("fetch failed"), {
  cause: Object.assign(new Error("socket closed"), { code: "ECONNRESET" }),
});

test("request-scoped expired Google sign-in has a fixed safe write error", async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("sensitive-google-body", { status });
    }) as typeof fetch;
    const writer = createPipelineWriter({ googleAccessToken: "request-token" } as never, {
      fetchImpl, retryBaseMs: 0, requestScopedGoogleAccessToken: true,
    });
    await assert.rejects(writer.write("sheet-id", []), (error: Error) => {
      assert.equal(error.message, "The Google sign-in from the dashboard expired during the run; reopen the dashboard and press Retry write.");
      assert.doesNotMatch(JSON.stringify(error), /sensitive-google-body/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("Sheets transport reports the cause and host after bounded network retries", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; throw networkError(); }) as typeof fetch;
  await assert.rejects(
    getSheetValues("sheet-id", "Pipeline!A1", "stub", fetchImpl, { retries: 2, retryBaseMs: 0 }),
    (error: Error) => {
      assert.match(error.message, /Google Sheets.*ECONNRESET.*sheets\.googleapis\.com/i);
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("OAuth token exchange retries a transient network failure", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1) throw networkError();
    return new Response(JSON.stringify({ access_token: "stub-token", expires_in: 3600 }), { status: 200 });
  }) as typeof fetch;
  const token = await resolveAccessToken({
    googleAccessToken: "",
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleOAuthTokenJson: JSON.stringify({
      token: "expired", expiry: "2020-01-01T00:00:00Z",
      refresh_token: "stub-refresh", client_id: "stub-client", client_secret: "stub-secret",
    }),
    googleOAuthTokenFile: "",
  } as never, fetchImpl, () => new Date("2026-09-28T00:00:00Z"), "scope");
  assert.equal(token, "stub-token");
  assert.equal(calls, 2);
});

test("invalid_grant names reauthorization steps without exposing credentials", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch;
  await assert.rejects(
    resolveAccessToken({
      googleAccessToken: "",
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleOAuthTokenJson: JSON.stringify({
        token: "expired", expiry: "2020-01-01T00:00:00Z",
        refresh_token: "stub-refresh", client_id: "stub-client", client_secret: "stub-secret",
      }),
      googleOAuthTokenFile: "",
    } as never, fetchImpl, () => new Date("2026-09-28T00:00:00Z"), "scope"),
    (error: Error) => {
      assert.match(error.message, /expired|revoked/i);
      assert.match(error.message, /reconnect|reauthoriz/i);
      assert.doesNotMatch(error.message, /stub-secret|stub-refresh/);
      return true;
    },
  );
});
