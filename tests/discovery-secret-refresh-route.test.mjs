import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   The 401 self-heal must read the secret from a route that answers.

   `discovery-local-bootstrap.json` carries the worker secret, so the
   static-path guard (#75) denies it — 403 for every browser. Every
   "reload and it autofills" path, including the auth_required retry in
   verifyDiscoveryWebhookWithSharedModel, read that file and therefore
   never refreshed anything. The dev server already resolves the same
   secret behind the origin-guarded GET /__proxy/discovery-webhook-secret
   (the route Beat 5 uses). The refresh reads that instead.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configOverridesJs = readFileSync(join(repoRoot, "config-overrides.js"), "utf8");

const SECRET = "0123456789abcdef0123456789abcdef";
const OVERRIDE_KEY = "command_center_config_overrides";

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function loadConfigOverrides({ savedUrl, savedSecret = "", secretRoute }) {
  const fetchCalls = [];
  const localStorage = makeStorage();
  localStorage.setItem(
    OVERRIDE_KEY,
    JSON.stringify({ discoveryWebhookUrl: savedUrl, discoveryWebhookSecret: savedSecret }),
  );
  const window = {
    COMMAND_CENTER_CONFIG: {},
    JobBoredApp: {},
    location: { hostname: "localhost", port: "8080", search: "", href: "http://localhost:8080/" },
    history: { replaceState() {} },
  };
  const ctx = vm.createContext({
    window,
    document: { getElementById: () => null },
    console,
    URL,
    URLSearchParams,
    localStorage,
    sessionStorage: makeStorage(),
    async fetch(url) {
      fetchCalls.push(String(url));
      if (/\/__proxy\/discovery-webhook-secret$/.test(String(url))) {
        if (typeof secretRoute === "function") return secretRoute();
        return { ok: true, status: 200, json: async () => secretRoute };
      }
      // The static guard's answer for the secret-bearing JSON (#75).
      return { ok: false, status: 403, json: async () => ({ ok: false }) };
    },
  });
  vm.runInContext(configOverridesJs, ctx, { filename: "config-overrides.js" });
  const overrides = window.JobBoredApp.configOverrides;
  const stored = () => JSON.parse(localStorage.getItem(OVERRIDE_KEY) || "{}");
  overrides.host = {
    normalizeDiscoveryWebhookIdentity: (u) => String(u || "").trim(),
    getDiscoveryWebhookUrl: () => stored().discoveryWebhookUrl || "",
    getDiscoveryWebhookSecret: () => stored().discoveryWebhookSecret || "",
    isLocalWebhookCandidateUrl: (u) => /127\.0\.0\.1|localhost/.test(String(u)),
    buildDiscoveryTunnelTargetUrl: () => "",
    inferCloudflareWorkerNameFromOpenWorkerUrl: () => "",
  };
  return { overrides, fetchCalls, stored };
}

describe("refreshDiscoveryWebhookSecretFromBootstrapForEndpoint — the route that answers", () => {
  it("reads /__proxy/discovery-webhook-secret and persists the secret for a Tailscale endpoint", async () => {
    const url = "https://emilios-mac.tailnet.ts.net/webhook";
    const env = loadConfigOverrides({
      savedUrl: url,
      secretRoute: { ok: true, secret: SECRET, source: "env_file", wrote: false },
    });

    const refreshed = await env.overrides.refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(url);

    assert.equal(refreshed, SECRET, "the retry gets the worker's real secret");
    assert.equal(env.stored().discoveryWebhookSecret, SECRET, "and it is persisted for the next run");
    assert.ok(
      env.fetchCalls.some((u) => /\/__proxy\/discovery-webhook-secret$/.test(u)),
      "the guarded route is what was read",
    );
    assert.equal(
      env.fetchCalls.some((u) => /discovery-local-bootstrap\.json/.test(u)),
      false,
      "the 403'd static file is no longer on the path",
    );
  });

  it("replaces a stale saved secret — a 401 already proved the old one wrong", async () => {
    const url = "https://emilios-mac.tailnet.ts.net/webhook";
    const env = loadConfigOverrides({
      savedUrl: url,
      savedSecret: "stale-stale-stale",
      secretRoute: { ok: true, secret: SECRET, source: "env_file", wrote: false },
    });

    const refreshed = await env.overrides.refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(url);

    assert.equal(refreshed, SECRET);
    assert.equal(env.stored().discoveryWebhookSecret, SECRET);
  });

  it("leaves a Cloudflare relay alone — the relay injects its own secret", async () => {
    const url = "https://jobbored-relay.example.workers.dev/webhook";
    const env = loadConfigOverrides({
      savedUrl: url,
      secretRoute: { ok: true, secret: SECRET, source: "env_file", wrote: false },
    });

    const refreshed = await env.overrides.refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(url);

    assert.equal(refreshed, "");
    assert.equal(env.stored().discoveryWebhookSecret, "", "nothing written");
  });

  it("returns '' without throwing when the dev server is not there to answer", async () => {
    const url = "https://emilios-mac.tailnet.ts.net/webhook";
    const env = loadConfigOverrides({
      savedUrl: url,
      secretRoute: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    const refreshed = await env.overrides.refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(url);

    assert.equal(refreshed, "");
  });
});
