/**
 * W2SQ lane B, claim E4 (AUTH-03): every packaged browser call to the
 * JobBored API goes through one apiFetch() that attaches the hosted token.
 *
 * Promotes `.lane-evidence/ref/probes-E/probe-e-hosted.sh` section C (browser
 * callers that attach the hosted token) into a committed test.
 *
 * Part 1 pins the helper contract on window.JobBoredHostedApiAuth.apiFetch.
 * Part 2 pins each API fetch site to that helper by snippet, so a future
 * bare fetch() to an API route fails loudly here instead of silently
 * dropping auth in hosted mode.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRoot = (name) => readFileSync(join(repoRoot, name), "utf8");

function loadHostedAuth({ config = {}, fetchImpl = null, configCore = null } = {}) {
  const calls = [];
  const stubFetch =
    fetchImpl ||
    (async (input, init) => {
      calls.push({ input, init });
      return { ok: true, status: 200, input, init };
    });
  const windowTarget = { COMMAND_CENTER_CONFIG: config, fetch: stubFetch };
  if (configCore) windowTarget.JobBoredApp = { configCore };
  const sandbox = { window: windowTarget, fetch: stubFetch, console };
  vm.runInNewContext(readRoot("hosted-api-auth.js"), sandbox, {
    filename: "hosted-api-auth.js",
  });
  return { auth: windowTarget.JobBoredHostedApiAuth, calls, windowTarget };
}

describe("E4 apiFetch helper", () => {
  it("exposes apiFetch alongside the header helpers", () => {
    const { auth } = loadHostedAuth();
    assert.equal(typeof auth.apiFetch, "function");
  });

  it("attaches the hosted token as Authorization + X-Api-Token", async () => {
    const { auth, calls } = loadHostedAuth({
      config: { jobBoredApiToken: "  probe-token  " },
    });
    await auth.apiFetch("http://127.0.0.1:3847/api/llm-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "http://127.0.0.1:3847/api/llm-config");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body, "{}");
    assert.equal(calls[0].init.headers.Authorization, "Bearer probe-token");
    assert.equal(calls[0].init.headers["X-Api-Token"], "probe-token");
    assert.equal(calls[0].init.headers["content-type"], "application/json");
  });

  it("reads the token through app-config-core when present", async () => {
    const { auth, calls } = loadHostedAuth({
      config: {},
      configCore: { getJobBoredApiToken: () => "core-token" },
    });
    await auth.apiFetch("http://127.0.0.1:3847/profile", { method: "GET" });
    assert.equal(calls[0].init.headers.Authorization, "Bearer core-token");
    assert.equal(calls[0].init.headers["X-Api-Token"], "core-token");
  });

  it("sends no auth headers when no token is configured (loopback unchanged)", async () => {
    const { auth, calls } = loadHostedAuth({ config: {} });
    await auth.apiFetch("http://127.0.0.1:3847/profile", { method: "GET" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.equal(calls[0].init.headers["X-Api-Token"], undefined);
  });

  it("returns the Response untouched so error codes pass through unchanged", async () => {
    const body = { error: "Unauthorized", code: "UNAUTHORIZED", retryable: false };
    const response = {
      ok: false,
      status: 401,
      json: async () => body,
    };
    const { auth } = loadHostedAuth({
      config: { jobBoredApiToken: "t" },
      fetchImpl: async () => response,
    });
    const out = await auth.apiFetch("http://127.0.0.1:3847/profile", {});
    assert.equal(out, response);
    assert.equal((await out.json()).code, "UNAUTHORIZED");
  });

  it("propagates transport rejections unchanged", async () => {
    const failure = new TypeError("Failed to fetch");
    const { auth } = loadHostedAuth({
      config: { jobBoredApiToken: "t" },
      fetchImpl: async () => {
        throw failure;
      },
    });
    await assert.rejects(auth.apiFetch("http://127.0.0.1:3847/profile", {}), (err) => {
      assert.equal(err, failure);
      return true;
    });
  });
});

describe("E4 every API fetch site routes through apiFetch", () => {
  // [file, snippet that must exist]: the API call with auth attached.
  const SITES = [
    ["pipeline.js", 'apiFetch(base + "/api/applications"'],
    ["posting-enrichment.js", "apiFetch(`${base}/api/scrape-job`"],
    ["fit-profile-wizard.js", 'apiFetch(profileUrl("/profile/template/"'],
    ["fit-profile-wizard.js", 'apiFetch(profileUrl("/profile/from-resume")'],
    ["fit-profile-wizard.js", 'apiFetch(profileUrl("/profile"))'],
    ["fit-profile-wizard.js", 'apiFetch(profileUrl("/profile"),'],
    ["fit-profile-backcompat.js", 'apiFetch(profileApiPath("/profile/rescore")'],
    ["fit-profile-backcompat.js", 'apiFetch(profileApiPath("/profile"),'],
    ["fit-profile-backcompat.js", 'apiFetch(profileApiPath("/profile/migrate")'],
    ["fit-profile-editor.js", 'apiFetch(profileApiPath("/api/brand-logos")'],
    ["fit-profile-editor.js", 'apiFetch(profileApiPath("/api/brand-logos/resolve")'],
    ["fit-profile-editor.js", 'apiFetch(profileApiPath("/api/brand-logos/"'],
    ["oneflow-beat-fit.js", "apiFetch(profileUrl()"],
    ["settings-modal.js", 'apiFetch(jobBoredApiUrl + "/api/llm-config"'],
    ["discovery-drawer.js", 'apiFetch(profileApiPath("/profile")'],
    ["discovery-drawer.js", "apiFetch(`${base}/api/scrape-job`"],
    ["materials-queue.js", 'apiFetch(base + "/api/applications/queue"'],
    ["materials-queue.js", 'apiFetch(base + "/api/applications/" + encodeURIComponent(slug) + "/dismiss"'],
    ["oneflow-beat-resume.js", 'apiFetch(profileUrl("/profile/from-resume")'],
    ["oneflow-beat-resume.js", "apiFetch(profileUrl(`/profile/template/"],
    ["oneflow-beat-ai.js", 'apiFetch(resolveJobBoredApiUrl() + "/api/llm-config"'],
    ["ats-scorecard.js", "const resp = await transport(endpoint, {"],
    ["scraper-ats-config.js", "apiFetch(url, { method: \"GET\", mode: \"cors\" })"],
  ];

  for (const [file, snippet] of SITES) {
    it(`${file} calls the API through apiFetch (${snippet.slice(0, 52)}…)`, () => {
      const source = readRoot(file);
      assert.ok(
        source.includes(snippet),
        `${file} must contain \`${snippet}\` so the hosted token is attached`,
      );
    });
  }

  it("role-materials.js routes its four API helpers through apiFetch", () => {
    const source = readRoot("role-materials.js");
    const hits = source.match(/return apiFetch\(url,/g) || [];
    assert.equal(hits.length, 4);
  });

  it("ats-scorecard.js keeps third-party webhook targets unauthenticated", () => {
    // The hosted token must never leak to a user-configured webhook URL
    // (n8n, Apps Script): only server-mode endpoints get apiFetch.
    const source = readRoot("ats-scorecard.js");
    assert.match(source, /cfg\.mode === "webhook" \? fetch : apiFetch/);
  });

  it("browser matches on API error codes use the lowercase form", () => {
    // Lane E unifies API error-code casing to lowercase snake_case.
    const source = readRoot("role-materials.js");
    assert.ok(source.includes('"resume_required"'));
    assert.ok(!source.includes('"RESUME_REQUIRED"'));
  });
});
