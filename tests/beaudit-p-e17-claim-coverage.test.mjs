/**
 * BEAUDIT E17: the green suite missed the audit's claims. This file adds the
 * coverage the register row asks for (the rebinding half lives in
 * beaudit-p-loopback-host-guard.test.mjs):
 *
 *   E4  caller coverage: every packaged browser file that calls the API must
 *       attach the hosted token. Only the caller inventory runs here; the
 *       coverage itself is a todo with no body (see below), because a source
 *       grep for helper names proves nothing about outgoing headers.
 *   E2  a `provider:"local"` pin must reach ATS as openai_compatible.
 *   E5  the server/ image layout (Dockerfile build context) must boot and
 *       save a profile without leaking filesystem paths.
 *   E7  scrape-route validation errors must carry the documented envelope.
 *   E9  Gemini's REST JSON is lowerCamelCase (urlContextMetadata).
 *
 * The fixes for E2, E4, E5, E7 and E9 belong to other lanes (Q, B, O, L; spec
 * §3), outside lane P's fence, so E17 is deferred to them. Lane Q has
 * landed E2 and E9, so their assertions are hard tests. Each target
 * assertion for E5 and E7 still runs as a
 * node:test `todo`: it executes, reports its failure, and does not fail the
 * floor. The harness assertions around it are hard. Set BEAUDIT_E17_STRICT=1
 * to turn every todo into a hard test; the integration runner does that once
 * the owning lane lands, then deletes the todo marker.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { scrapeJobPosting } from "../server/shared/job-scraper-core.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = join(REPO_ROOT, "server");
const API_PORT = 19008;
const AUX_PORT = 19009;
const STRICT = process.env.BEAUDIT_E17_STRICT === "1";

/** @param {string} owner */
function target(owner) {
  return STRICT ? {} : { todo: `target behavior; fix owned by ${owner}` };
}

/**
 * Boot server/index.mjs from `cwd` with a scrubbed env: no ambient provider
 * keys, a throwaway HOME, loopback only.
 * @param {string} cwd
 * @param {Record<string, string>} extraEnv
 */
async function startApi(cwd, extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), "beaudit-e17-home-"));
  mkdirSync(join(home, ".jobbored"), { recursive: true });
  let output = "";
  const child = spawn(process.execPath, ["index.mjs"], {
    cwd,
    env: {
      PATH: process.env.PATH || "",
      HOME: home,
      USERPROFILE: home,
      PORT: String(API_PORT),
      LISTEN_HOST: "127.0.0.1",
      JOBBORED_LLM_CONFIG_PATH: join(home, ".jobbored", "llm.json"),
      JOBBORED_PROFILE_PATH: join(home, ".jobbored", "profile.json"),
      HERMES_APPLICATIONS_ROOT: join(home, "applications"),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (c) => (output += String(c)));
  child.stderr.on("data", (c) => (output += String(c)));
  const baseUrl = `http://127.0.0.1:${API_PORT}`;
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode != null) break;
    const res = await fetch(`${baseUrl}/health`).catch(() => null);
    if (res && res.ok) return { child, baseUrl, home, output: () => output };
    await sleep(150);
  }
  child.kill();
  rmSync(home, { recursive: true, force: true });
  throw new Error(`E17 API failed to start from ${cwd}: ${output.slice(-1500)}`);
}

/** @param {{ child: import("node:child_process").ChildProcess, home: string }} h */
async function stopApi(h) {
  if (!h) return;
  if (h.child.exitCode == null) {
    const exited = new Promise((r) => h.child.once("exit", r));
    h.child.kill();
    await exited;
  }
  rmSync(h.home, { recursive: true, force: true });
}

/** @param {Response} res */
async function readJson(res) {
  const text = await res.text();
  try {
    return { text, body: JSON.parse(text) };
  } catch {
    return { text, body: null };
  }
}

// ---------------------------------------------------------------- E4
/** Browser-side references to routes served by server/index.mjs. */
const API_CALL_PATTERN =
  /\/api\/(?:scrape-job|ats-scorecard|llm-config|applications|brand-logos|profile)|["'`]\/profile\b|jobBoredApiUrl|getJobBoredApiUrl/;

/** @param {string} source */
function callsApi(source) {
  return /\bfetch\s*\(/.test(source) && API_CALL_PATTERN.test(source);
}

function packagedBrowserApiCallers() {
  return readdirSync(REPO_ROOT)
    .filter((name) => name.endsWith(".js") && !/^config(\.|-)/.test(name))
    .filter((name) => name !== "hosted-api-auth.js")
    .filter((name) => callsApi(readFileSync(join(REPO_ROOT, name), "utf8")))
    .sort();
}

describe("BEAUDIT E17/E4 hosted-auth caller coverage", () => {
  it("the caller scan tells an API caller from a non-caller", () => {
    assert.equal(callsApi('fetch(base + "/api/scrape-job", {method:"POST"})'), true);
    assert.equal(callsApi("fetch(cfg.jobBoredApiUrl + '/profile')"), true);
    assert.equal(callsApi('fetch("https://sheets.googleapis.com/v4")'), false);
    assert.equal(callsApi('const u = "/api/scrape-job";'), false);
  });

  it("finds the packaged API callers and the helper the page loads", () => {
    const callers = packagedBrowserApiCallers();
    for (const expected of ["posting-enrichment.js", "settings-modal.js", "oneflow-beat-ai.js"]) {
      assert.ok(callers.includes(expected), `${expected} calls the API: ${callers.join(", ")}`);
    }
    const indexHtml = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
    assert.match(indexHtml, /<script src="hosted-api-auth\.js"/);
  });

  // Scaffolding only; this claims no coverage. The owning lane (wave-2 lane
  // B, E4: one apiFetch()) replaces it with a behavior test: drive each caller
  // from packagedBrowserApiCallers() against a recording fetch with a hosted
  // token configured and assert the outgoing request carries X-Api-Token (or
  // Authorization: Bearer); as the negative control, with no token configured
  // the same request carries neither header.
  it.todo(
    "every packaged API caller attaches the hosted token to its outgoing request (lane B)",
  );
});

// ---------------------------------------------------------------- E2
describe("BEAUDIT E17/E2 a local pin reaches ATS", () => {
  /** @type {Awaited<ReturnType<typeof startApi>>} */
  let api;
  /** @type {import("node:http").Server} */
  let provider;
  /** @type {string[]} */
  const providerCalls = [];

  before(async () => {
    provider = createServer((req, res) => {
      providerCalls.push(`${req.method} ${req.url}`);
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    });
    await new Promise((r) => provider.listen(AUX_PORT, "127.0.0.1", r));
    api = await startApi(SERVER_DIR);
  });

  after(async () => {
    await stopApi(api);
    await new Promise((r) => provider.close(r));
  });

  it("the API accepts the pin exactly as onboarding builds it for Local", async () => {
    const res = await fetch(`${api.baseUrl}/api/llm-config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "local",
        model: "gemma4:e2b",
        apiKey: "",
        baseUrl: `http://127.0.0.1:${AUX_PORT}/v1`,
      }),
    });
    const { text } = await readJson(res);
    assert.equal(res.status, 200, text);
  });

  it(
    "ATS reads the local pin as openai_compatible and is configured",
    async () => {
      const { body } = await readJson(await fetch(`${api.baseUrl}/health`));
      assert.equal(body.atsProvider, "openai_compatible", JSON.stringify(body));
      assert.equal(body.atsConfigured, true, JSON.stringify(body));
    },
  );

  it(
    "an ATS scorecard request reaches the local model",
    async () => {
      const example = JSON.parse(
        readFileSync(join(REPO_ROOT, "examples", "ats-scorecard-request.v1.json"), "utf8"),
      );
      const res = await fetch(`${api.baseUrl}/api/ats-scorecard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(example),
      });
      const { text } = await readJson(res);
      assert.notEqual(res.status, 503, text);
      assert.ok(
        providerCalls.some((call) => /^POST \/v1\/chat\/completions/.test(call)),
        `local model never called; ATS answered ${res.status} ${text.slice(0, 300)}`,
      );
    },
  );
});

// ---------------------------------------------------------------- E5
/** Copy server/ the way the Dockerfile's `COPY . .` sees it through .dockerignore. */
function buildDockerContext() {
  const ignore = readFileSync(join(SERVER_DIR, ".dockerignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const matchers = ignore.map((pattern) => {
    const re = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    return (/** @type {string} */ name) => re.test(name);
  });
  const root = mkdtempSync(join(tmpdir(), "beaudit-e17-docker-"));
  const app = join(root, "app");
  cpSync(SERVER_DIR, app, {
    recursive: true,
    filter: (src) => {
      if (src === SERVER_DIR) return true;
      const top = src.slice(SERVER_DIR.length + 1).split(/[\\/]/)[0];
      return !matchers.some((m) => m(top) || m(basename(src)));
    },
  });
  // npm ci --omit=dev in the image; reuse the checkout's install.
  symlinkSync(join(SERVER_DIR, "node_modules"), join(app, "node_modules"), "dir");
  return { root, app };
}

describe("BEAUDIT E17/E5 the server/ image layout boots", () => {
  /** @type {{ root: string, app: string }} */
  let ctx;
  /** @type {Awaited<ReturnType<typeof startApi>>} */
  let api;

  before(async () => {
    ctx = buildDockerContext();
    api = await startApi(ctx.app);
  });

  after(async () => {
    await stopApi(api);
    if (ctx) rmSync(ctx.root, { recursive: true, force: true });
  });

  it("the build context keeps env files out and boots to a healthy /health", async () => {
    assert.equal(existsSync(join(ctx.app, "index.mjs")), true);
    assert.deepEqual(
      readdirSync(ctx.app).filter((name) => name.startsWith(".env")),
      [],
    );
    const res = await fetch(`${api.baseUrl}/health`);
    assert.equal(res.status, 200);
    const { body } = await readJson(res);
    assert.equal(body.ok, true);
  });

  it(
    "the image saves a starter profile and never returns a filesystem path",
    target("wave-2 lane O (E5: vendor the schema into server/)"),
    async () => {
      const templateRes = await fetch(`${api.baseUrl}/profile/template/engineer`, {
        method: "POST",
      });
      const templateText = await templateRes.text();
      assert.equal(templateRes.status, 200, templateText.slice(0, 300));
      // POST /profile takes the profile object, not the {ok, template}
      // transport envelope — the wizard unwraps data.template before saving,
      // and the schema requires top-level version/identity/strengths.
      const { template } = JSON.parse(templateText);
      const res = await fetch(`${api.baseUrl}/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(template),
      });
      const { text } = await readJson(res);
      assert.doesNotMatch(text, new RegExp(ctx.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(text, /ENOENT/);
      assert.ok(res.status >= 200 && res.status < 300, `POST /profile ${res.status} ${text.slice(0, 300)}`);
    },
  );

  it(
    "the logo routes answer without a 500 when the resolver is absent",
    target("wave-2 lane O (E5: 501 LOGOS_UNAVAILABLE or ship python3)"),
    async () => {
      const res = await fetch(`${api.baseUrl}/api/brand-logos`);
      const { text } = await readJson(res);
      assert.notEqual(res.status, 500, text.slice(0, 300));
      assert.doesNotMatch(text, new RegExp(ctx.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    },
  );
});

// ---------------------------------------------------------------- E7
describe("BEAUDIT E17/E7 scrape-route validation error shape", () => {
  /** @type {Awaited<ReturnType<typeof startApi>>} */
  let api;

  before(async () => {
    api = await startApi(SERVER_DIR);
  });

  after(async () => {
    await stopApi(api);
  });

  const cases = [
    { label: "missing url", body: "{}" },
    { label: "non-http scheme", body: JSON.stringify({ url: "file:///etc/passwd" }) },
    { label: "private target", body: JSON.stringify({ url: `http://127.0.0.1:${AUX_PORT}/.env` }) },
  ];

  /** @param {string} body */
  async function postScrape(body) {
    const res = await fetch(`${api.baseUrl}/api/scrape-job`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    return { res, ...(await readJson(res)) };
  }

  for (const c of cases) {
    it(`${c.label}: 400 JSON with a string error, never HTML`, async () => {
      const { res, text, body } = await postScrape(c.body);
      assert.equal(res.status, 400, text);
      assert.match(res.headers.get("content-type") || "", /application\/json/);
      assert.doesNotMatch(text, /<html|<!DOCTYPE/i);
      assert.equal(typeof body?.error, "string", text);
    });

    it(
      `${c.label}: carries the documented { error, code } envelope`,
      target("wave-1 lane L (E7: one sendApiError())"),
      async () => {
        const { text, body } = await postScrape(c.body);
        assert.equal(typeof body?.code, "string", text);
        assert.ok(body.code.length > 0, text);
      },
    );
  }

  it(
    "an unknown API route answers a JSON 404, not HTML",
    target("wave-1 lane L (E7: JSON 404)"),
    async () => {
      const res = await fetch(`${api.baseUrl}/api/does-not-exist`);
      const { text, body } = await readJson(res);
      assert.equal(res.status, 404, text);
      assert.match(res.headers.get("content-type") || "", /application\/json/, text.slice(0, 200));
      assert.equal(typeof body?.code, "string", text.slice(0, 200));
    },
  );
});

// ---------------------------------------------------------------- E9
const CAMEL_FIXTURE = JSON.parse(
  readFileSync(join(REPO_ROOT, "tests", "fixtures", "gemini-url-context-camelcase.json"), "utf8"),
);
const LISTING_HTML = `<!doctype html><html><head><title>Careers at Acme</title></head>
<body><main><h1>Careers at Acme</h1><p>See open positions</p><ul>
<li>Account Executive</li><li>Software Engineer</li><li>Product Designer</li>
<li>Data Scientist</li><li>Recruiter</li><li>Solutions Consultant</li>
<li>Engineering Manager</li><li>Support Engineer</li><li>Brand Designer</li>
<li>Technical Account Manager</li><li>Sales Director</li><li>IT Engineer</li>
</ul></main></body></html>`;

/** @param {unknown} body @param {string} [raw] */
function fakeResponse(body, raw) {
  const bytes = new TextEncoder().encode(raw ?? JSON.stringify(body));
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    arrayBuffer: async () => bytes.buffer,
  };
}

describe("BEAUDIT E17/E9 Gemini URL Context in REST lowerCamelCase", () => {
  it("the fixture is the REST casing (urlContextMetadata, no snake_case keys)", () => {
    const text = JSON.stringify(CAMEL_FIXTURE);
    assert.match(text, /"urlContextMetadata"/);
    assert.match(text, /"urlRetrievalStatus":"URL_RETRIEVAL_STATUS_SUCCESS"/);
    assert.doesNotMatch(text, /url_context_metadata|url_retrieval_status/);
  });

  it("control: the same response in snake_case passes, so casing is the only variable", async () => {
    const snake = structuredClone(CAMEL_FIXTURE);
    const candidate = snake.candidates[0];
    candidate.url_context_metadata = {
      url_metadata: candidate.urlContextMetadata.urlMetadata.map(
        (/** @type {{ retrievedUrl: string, urlRetrievalStatus: string }} */ row) => ({
          retrieved_url: row.retrievedUrl,
          url_retrieval_status: row.urlRetrievalStatus,
        }),
      ),
    };
    delete candidate.urlContextMetadata;
    const result = await scrapeJobPosting("https://jobs.example.com/roles/staff-backend", {
      geminiApiKey: "test-gemini-key",
      fetchImpl: async (/** @type {string} */ url) =>
        /generativelanguage\.googleapis\.com/.test(url)
          ? fakeResponse(snake)
          : fakeResponse({}, LISTING_HTML),
    });
    assert.equal(result.method, "gemini-url-context");
  });

  it(
    "the server scraper accepts a camelCase success response",
    async () => {
      /** @type {string[]} */
      const calls = [];
      const result = await scrapeJobPosting("https://jobs.example.com/roles/staff-backend", {
        geminiApiKey: "test-gemini-key",
        fetchImpl: async (/** @type {string} */ url) => {
          calls.push(String(url));
          if (/generativelanguage\.googleapis\.com/.test(url)) return fakeResponse(CAMEL_FIXTURE);
          return fakeResponse({}, LISTING_HTML);
        },
      });
      assert.ok(calls.some((u) => /generativelanguage/.test(u)), "Gemini lane never ran");
      assert.equal(result.method, "gemini-url-context");
      assert.match(result.description, /Kafka pipelines/);
    },
  );

  it(
    "the browser copy reads urlContextMetadata too",
    () => {
      const browser = readFileSync(join(REPO_ROOT, "job-posting-insights.js"), "utf8");
      assert.ok(/urlContextMetadata/.test(browser), "job-posting-insights.js never reads urlContextMetadata");
      assert.ok(/urlRetrievalStatus/.test(browser), "job-posting-insights.js never reads urlRetrievalStatus");
    },
  );
});
