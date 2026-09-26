// BEAUDIT A9: a run authorized only by the dashboard's short-lived Google
// access token (about 3600 s) must end, and write its DiscoveryRuns row,
// inside that token's life.
// BEAUDIT A15: mergedUserProfile secrets are stripped at every depth.
import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_ACCESS_TOKEN_SAFE_RUN_MS,
  handleDiscoveryWebhook,
} from "../../src/webhook/handle-discovery-webhook.ts";

const SECRET = "hardening-secret";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrSt";

function request(body: Record<string, unknown>) {
  return {
    method: "POST",
    headers: { "x-discovery-secret": SECRET },
    bodyText: JSON.stringify({
      event: "command-center.discovery",
      schemaVersion: 1,
      sheetId: SHEET_ID,
      variationKey: "var-hardening",
      requestedAt: new Date().toISOString(),
      discoveryProfile: { targetRoles: "Engineer" },
      ...body,
    }),
  };
}

function deps(capture: (request: Record<string, unknown>, runDeps: Record<string, unknown>) => void, extraRuntime: Record<string, unknown> = {}) {
  return {
    runSynchronously: true,
    maxRunDurationMs: 60 * 60 * 1000,
    runDiscovery: async (req: Record<string, unknown>, _trigger: unknown, runDeps: Record<string, unknown>) => {
      capture(req, runDeps);
      throw new Error("stop after capture");
    },
    runDependencies: {
      runtimeConfig: {
        webhookSecret: SECRET,
        runMode: "local",
        ...extraRuntime,
      },
      maxRunDurationMs: 60 * 60 * 1000,
      loadStoredWorkerConfig: async () => ({ sheetId: SHEET_ID, companies: [{ name: "Acme" }] }),
      now: () => new Date(),
    },
  } as never;
}

test("A9: a run carried by a request googleAccessToken is capped below the token's life", async () => {
  let seen = 0;
  await handleDiscoveryWebhook(
    request({ googleAccessToken: "dashboard-token" }),
    deps((_req, runDeps) => {
      seen = Number(runDeps.maxRunDurationMs);
    }),
  );
  assert.ok(seen > 0);
  assert.ok(seen <= GOOGLE_ACCESS_TOKEN_SAFE_RUN_MS, `maxRunDurationMs ${seen} must be <= ${GOOGLE_ACCESS_TOKEN_SAFE_RUN_MS}`);
  assert.ok(GOOGLE_ACCESS_TOKEN_SAFE_RUN_MS < 3600 * 1000);
});

test("A9: a run on the worker's own credential keeps the configured duration", async () => {
  let seen = 0;
  await handleDiscoveryWebhook(
    request({}),
    deps(
      (_req, runDeps) => {
        seen = Number(runDeps.maxRunDurationMs);
      },
      { googleAccessToken: "worker-level-token" },
    ),
  );
  assert.equal(seen, 60 * 60 * 1000);
});

test("A15: nested secret keys in mergedUserProfile never reach the run", async () => {
  let seenProfile: Record<string, unknown> | undefined;
  await handleDiscoveryWebhook(
    request({
      googleAccessToken: "dashboard-token",
      mergedUserProfile: {
        identity: { name: "Ada", apiKey: "sk-nested", contact: { password: "p" } },
        resume: { text: "full resume text", updatedAt: "2026-09-01" },
        history: [{ company: "Acme", secret: "s" }],
        targetRoles: ["Engineer"],
      },
    }),
    deps((req) => {
      seenProfile = req.mergedUserProfile as Record<string, unknown>;
    }),
  );
  assert.ok(seenProfile);
  const serialized = JSON.stringify(seenProfile);
  for (const leaked of ["sk-nested", "full resume text", "\"password\"", "\"secret\""]) {
    assert.equal(serialized.includes(leaked), false, `leaked ${leaked}: ${serialized}`);
  }
  assert.deepEqual((seenProfile as { identity: { name: string } }).identity.name, "Ada");
  assert.deepEqual((seenProfile as { resume: { updatedAt: string } }).resume.updatedAt, "2026-09-01");
  assert.deepEqual((seenProfile as { history: Array<{ company: string }> }).history[0].company, "Acme");
});
