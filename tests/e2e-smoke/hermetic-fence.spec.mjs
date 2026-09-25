/**
 * hermetic-fence.spec.mjs — UX01 C1 regression (incident 2026-09-25, FD-19).
 *
 * The dev server's same-origin `/__proxy/*` handlers act on the host: they
 * restart the live :8644 discovery worker, rewrite .env files and install
 * launchd agents. `/profile*` proxies to the local API. A browser suite that
 * lets those requests through edits the tester's machine.
 *
 * installHermeticNetworkFence must answer every such request in the browser.
 * startHermeticApp's server spy records any that still arrive and refuses
 * them with 599, so even the red run of this spec never executes a real
 * handler.
 */

import { test, expect } from "@playwright/test";
import {
  HOST_SPY_REFUSED_STATUS,
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

test.beforeEach(() => {
  app.hostRequests.length = 0;
});

async function sameOriginFetch(page, path, init) {
  return page.evaluate(
    async ({ path: target, init: options }) => {
      const response = await fetch(target, options);
      return { status: response.status, body: await response.text() };
    },
    { path, init },
  );
}

test("should never let an unstubbed /__proxy/start-discovery-worker reach the server", async ({
  page,
}) => {
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });

  const result = await sameOriginFetch(
    page,
    "/__proxy/start-discovery-worker?port=8644",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );

  expect(
    app.hostRequests,
    "a /__proxy/* request reached the in-process server",
  ).toEqual([]);
  expect(result.status).not.toBe(HOST_SPY_REFUSED_STATUS);
  expect(result.status).toBe(503);
  expect(JSON.parse(result.body)).toMatchObject({ ok: false, hermetic: true });
  expect(fence.hostPathRequests).toContain(
    "POST /__proxy/start-discovery-worker",
  );
});

test("should answer every host-mutating /__proxy and /profile path in the fence", async ({
  page,
}) => {
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });

  const probes = [
    ["/__proxy/fix-setup", "POST"],
    ["/__proxy/discovery-env-key", "POST"],
    ["/__proxy/install-keep-alive", "POST"],
    ["/__proxy/local-health", "GET"],
    ["/profile", "POST"],
    ["/profile/resume", "GET"],
  ];
  for (const [path, method] of probes) {
    const result = await sameOriginFetch(page, path, {
      method,
      ...(method === "POST"
        ? { headers: { "content-type": "application/json" }, body: "{}" }
        : {}),
    });
    expect(result.status, `${method} ${path}`).not.toBe(HOST_SPY_REFUSED_STATUS);
  }

  // Boot's own discovery-state and GET /profile probes stay stubbed too.
  const state = await sameOriginFetch(page, "/__proxy/discovery-state");
  expect(state.status).toBe(200);
  const profile = await sameOriginFetch(page, "/profile");
  expect(profile.status).toBe(404);

  expect(
    app.hostRequests,
    "no host path may reach the in-process server",
  ).toEqual([]);
  expect(fence.unexpectedExternal).toEqual([]);
});
