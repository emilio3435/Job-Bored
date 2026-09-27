/**
 * W2SQ lane B review-fix: apiFetch() attaches the hosted API token only to
 * the JobBored API's own origin (configured API base, the local API default,
 * or the page's own origin). Any other origin gets a plain fetch with the
 * caller's init untouched, so a future caller passing a third-party URL
 * (a job page, a user webhook, a CDN) never leaks the token.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "hosted-api-auth.js"), "utf8");

const PAGE = "https://jobs.example.com/app/index.html";

function load({ config = {}, location = PAGE } = {}) {
  const calls = [];
  const stubFetch = async (input, init) => {
    calls.push({ input, init });
    return { ok: true, status: 200 };
  };
  const windowTarget = { COMMAND_CENTER_CONFIG: config, fetch: stubFetch };
  if (location) {
    const u = new URL(location);
    windowTarget.location = {
      href: u.href,
      origin: u.origin,
      protocol: u.protocol,
      hostname: u.hostname,
    };
  }
  const sandbox = { window: windowTarget, fetch: stubFetch, URL, console };
  vm.runInNewContext(source, sandbox, { filename: "hosted-api-auth.js" });
  return { auth: windowTarget.JobBoredHostedApiAuth, calls };
}

function tokenOf(init) {
  const h = (init && init.headers) || {};
  return { bearer: h.Authorization, xApi: h["X-Api-Token"] };
}

describe("apiFetch token origin scoping", () => {
  it("attaches the token to a same-origin absolute URL", async () => {
    const { auth, calls } = load({ config: { jobBoredApiToken: "tok" } });
    await auth.apiFetch("https://jobs.example.com/api/applications", { method: "GET" });
    assert.deepEqual(tokenOf(calls[0].init), { bearer: "Bearer tok", xApi: "tok" });
  });

  it("attaches the token to the configured jobBoredApiUrl origin", async () => {
    const { auth, calls } = load({
      config: { jobBoredApiToken: "tok", jobBoredApiUrl: "https://api.example.net/base/" },
    });
    await auth.apiFetch("https://api.example.net/api/llm-config", { method: "POST" });
    assert.deepEqual(tokenOf(calls[0].init), { bearer: "Bearer tok", xApi: "tok" });
  });

  it("attaches the token to the configured jobPostingScrapeUrl origin", async () => {
    const { auth, calls } = load({
      config: { jobBoredApiToken: "tok", jobPostingScrapeUrl: "https://scraper.example.org" },
    });
    await auth.apiFetch(new URL("https://scraper.example.org/api/scrape-job"), {});
    assert.deepEqual(tokenOf(calls[0].init), { bearer: "Bearer tok", xApi: "tok" });
  });

  it("attaches the token to a relative URL (resolved against location.href)", async () => {
    const { auth, calls } = load({ config: { jobBoredApiToken: "tok" } });
    await auth.apiFetch("/profile", { method: "GET" });
    assert.equal(calls[0].input, "/profile");
    assert.deepEqual(tokenOf(calls[0].init), { bearer: "Bearer tok", xApi: "tok" });
  });

  it("does not attach the token to a third-party origin and leaves init untouched", async () => {
    const { auth, calls } = load({
      config: { jobBoredApiToken: "tok", jobBoredApiUrl: "https://api.example.net" },
    });
    const init = { method: "GET", headers: { accept: "text/html" } };
    await auth.apiFetch("https://boards.thirdparty.example/job/123", init);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init, init);
    assert.deepEqual(calls[0].init.headers, { accept: "text/html" });
  });

  it("does not attach the token to a third-party URL object", async () => {
    const { auth, calls } = load({ config: { jobBoredApiToken: "tok" } });
    await auth.apiFetch(new URL("https://cdn.thirdparty.example/lib.js"));
    assert.equal(calls[0].init, undefined);
  });

  it("reads the URL from a Request-like input", async () => {
    const { auth, calls } = load({ config: { jobBoredApiToken: "tok" } });
    await auth.apiFetch({ url: "https://hooks.thirdparty.example/x" }, { method: "POST" });
    assert.equal(tokenOf(calls[0].init).bearer, undefined);
    await auth.apiFetch({ url: "https://jobs.example.com/api/x" }, { method: "POST" });
    assert.equal(tokenOf(calls[1].init).bearer, "Bearer tok");
  });

  it("adds nothing when no token is configured", async () => {
    const { auth, calls } = load({ config: { jobBoredApiUrl: "https://api.example.net" } });
    await auth.apiFetch("https://api.example.net/api/x", { method: "GET" });
    await auth.apiFetch("/profile", { method: "GET" });
    for (const c of calls) {
      assert.deepEqual(tokenOf(c.init), { bearer: undefined, xApi: undefined });
    }
  });
});

describe("apiFetch token origin scoping — other configured API bases", () => {
  it("attaches the token to the atsScoringServerUrl origin in server mode", async () => {
    const { auth, calls } = load({
      config: { jobBoredApiToken: "tok", atsScoringServerUrl: "https://ats.example.io/api" },
    });
    await auth.apiFetch("https://ats.example.io/api/ats-scorecard", { method: "POST" });
    assert.equal(tokenOf(calls[0].init).bearer, "Bearer tok");
  });

  it("does not attach the token to a user webhook in ATS webhook mode", async () => {
    const { auth, calls } = load({
      config: {
        jobBoredApiToken: "tok",
        atsScoringMode: "webhook",
        atsScoringWebhookUrl: "https://hooks.example.io/ats",
        atsScoringServerUrl: "https://hooks.example.io",
      },
    });
    await auth.apiFetch("https://hooks.example.io/ats", { method: "POST" });
    assert.equal(tokenOf(calls[0].init).bearer, undefined);
  });

  it("attaches the token to the local API default on a hosted page", async () => {
    const { auth, calls } = load({ config: { jobBoredApiToken: "tok" } });
    await auth.apiFetch("http://127.0.0.1:3847/profile", { method: "GET" });
    assert.equal(tokenOf(calls[0].init).bearer, "Bearer tok");
  });
});
