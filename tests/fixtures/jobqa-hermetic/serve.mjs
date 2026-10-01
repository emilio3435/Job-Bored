#!/usr/bin/env node
/**
 * JOBQA hermetic fixture: the whole onboarding wizard on synthetic data,
 * for a desktop browser, with nothing real behind it.
 *
 *   node tests/fixtures/jobqa-hermetic/serve.mjs [--seed existing|empty]
 *        [--web-port 18680] [--api-port 18681] [--root <empty temp dir>]
 *   node tests/fixtures/jobqa-hermetic/serve.mjs manifest --root <dir>
 *
 * What is real: this worktree's browser code, and the server's affected
 * profile handlers (read-only parsing, contact suggestions, the onboarding
 * commit, profile/resume/voice stores, the queue lister) mounted on a temp
 * store by path. What is MOCKED: Google sign-in and userinfo, Sheets, AI
 * providers, the LLM settings store and grading checks. Everything else is
 * refused and logged.
 *
 * Isolation: HOME and USERPROFILE are never changed and the real home is
 * never read or written; the store lives under os.tmpdir(). server/index.mjs
 * and dev-server.mjs are never loaded. The live stack (8080, 3847) and the
 * discovery worker (8644) are refused as ports and as request targets.
 */

import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readdir, readFile, appendFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { readIndexHtml } from "../../../scripts/lib/expand-index-includes.mjs";
import { createFixtureApi } from "./fixture-api.mjs";
import { manifestOf, seedStore, storePaths } from "./profiles.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const LIVE_PORTS = new Set([8080, 3847, 8644]);
const MARKER = ".jobqa-fixture";

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ command: string, seed: string, webPort: number, apiPort: number, root: string }} */
  const args = { command: "serve", seed: "existing", webPort: 18680, apiPort: 18681, root: "" };
  const rest = [...argv];
  if (rest[0] === "manifest") args.command = String(rest.shift());
  while (rest.length) {
    const flag = rest.shift();
    const value = rest.shift();
    if (flag === "--seed") args.seed = String(value);
    else if (flag === "--web-port") args.webPort = Number(value);
    else if (flag === "--api-port") args.apiPort = Number(value);
    else if (flag === "--root") args.root = resolve(String(value));
    else throw new Error(`Unknown option ${flag}`);
  }
  return args;
}

/** Refuse any root inside the real ~/.jobbored or ~/.hermes (read from the passwd entry, not $HOME). @param {string} root */
function assertSafeRoot(root) {
  const realHome = userInfo().homedir;
  for (const forbidden of [join(realHome, ".jobbored"), join(realHome, ".hermes")]) {
    if (root === forbidden || root.startsWith(forbidden + sep)) {
      throw new Error(`Refusing ${root}: it is inside ${forbidden}.`);
    }
  }
  if (root === realHome) throw new Error(`Refusing ${root}: that is the real home folder.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "manifest") {
    if (!args.root) throw new Error("manifest needs --root <fixture root>");
    assertSafeRoot(args.root);
    process.stdout.write(`${JSON.stringify(await manifestOf(join(args.root, "store")), null, 2)}\n`);
    return;
  }
  if (args.seed !== "existing" && args.seed !== "empty") throw new Error('--seed must be "existing" or "empty"');
  for (const port of [args.webPort, args.apiPort]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid port ${port}`);
    if (LIVE_PORTS.has(port)) throw new Error(`Refusing port ${port}: it belongs to the live stack.`);
  }

  let root = args.root;
  if (root) {
    assertSafeRoot(root);
    await mkdir(root, { recursive: true });
    const entries = await readdir(root);
    if (entries.length && !entries.includes(MARKER)) {
      throw new Error(`Refusing ${root}: it is not empty and not a JOBQA fixture root.`);
    }
  } else {
    root = await mkdtemp(join(tmpdir(), "jobqa-fixture-"));
  }
  assertSafeRoot(root);
  await writeFile(join(root, MARKER), "JOBQA hermetic fixture root: synthetic data only.\n");
  const storeDir = join(root, "store");
  const paths = storePaths(storeDir);
  if (!existsSync(paths.profile) && !existsSync(paths.resume)) await seedStore(paths, /** @type {any} */ (args.seed));

  const webOrigins = [`http://127.0.0.1:${args.webPort}`, `http://localhost:${args.webPort}`];
  const apiOrigins = [`http://127.0.0.1:${args.apiPort}`, `http://localhost:${args.apiPort}`];
  const egressFile = join(root, "egress.jsonl");
  /** @type {Array<Record<string, unknown>>} */
  const events = [];
  /** @param {Record<string, unknown>} entry */
  function record(entry) {
    const stamped = { at: new Date().toISOString(), ...entry };
    events.push(stamped);
    if (events.length > 2000) events.shift();
    if (entry.kind !== "api") appendFile(egressFile, `${JSON.stringify(stamped)}\n`).catch(() => {});
  }

  /* Node-side guard: the fixture process talks to its own two ports only. */
  const nodeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    const own = (target.hostname === "127.0.0.1" || target.hostname === "localhost") &&
      [String(args.webPort), String(args.apiPort)].includes(target.port);
    if (own) return nodeFetch(input, init);
    record({ kind: "server_refused", method: (init && init.method) || "GET", origin: target.origin, path: target.pathname });
    throw new TypeError(`Blocked by the JOBQA fixture: ${target.origin}${target.pathname}`);
  };

  const api = createFixtureApi({ paths, webOrigins, log: record });
  const apiServer = await listen(api, args.apiPort);

  const stubsTemplate = await readFile(join(HERE, "browser-stubs.js"), "utf8");
  const stubsJs = stubsTemplate.replace(
    "/*JOBQA_CONFIG*/ {}",
    JSON.stringify({ seed: args.seed, apiOrigins, webOrigin: webOrigins[0] }),
  );
  const gsiJs = await readFile(join(HERE, "gsi-stub.js"), "utf8");
  const configJs = (await readFile(join(REPO_ROOT, "config.example.js"), "utf8"))
    .replace(/jobBoredApiUrl:\s*""/, `jobBoredApiUrl: "${apiOrigins[0]}"`)
    .replace(/jobPostingScrapeUrl:\s*""/, `jobPostingScrapeUrl: "${apiOrigins[0]}"`);
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigins.join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /__jobqa__/csp-report",
  ].join("; ");

  const webServer = createServer((req, res) => {
    handleWeb(req, res).catch((err) => {
      record({ kind: "web_error", path: req.url, message: String(err && err.message) });
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("JOBQA fixture error");
    });
  });

  /** @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
  async function handleWeb(req, res) {
    const url = new URL(req.url || "/", webOrigins[0]);
    const path = decodeURIComponent(url.pathname);
    const method = req.method || "GET";
    const send = (/** @type {number} */ status, /** @type {string} */ type, /** @type {string | Buffer} */ body) => {
      res.writeHead(status, { "content-type": type, "content-security-policy": csp, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(method === "HEAD" ? undefined : body);
    };
    const sendJson = (/** @type {number} */ status, /** @type {unknown} */ body) => send(status, "application/json", JSON.stringify(body));

    if (path === "/__jobqa__/stubs.js") return send(200, "application/javascript", stubsJs);
    if (path === "/__jobqa__/gsi.js") return send(200, "application/javascript", gsiJs);
    if (path === "/__jobqa__/state") {
      return sendJson(200, {
        fixture: "jobqa-hermetic",
        seed: args.seed,
        root,
        store: storeDir,
        web: webOrigins[0],
        api: apiOrigins[0],
        manifest: await manifestOf(storeDir),
        refused: events.filter((e) => e.kind === "refused" || e.kind === "server_refused" || e.kind === "csp"),
        mocked: events.filter((e) => e.kind === "mocked").length,
        recent: events.slice(-60),
      });
    }
    if ((path === "/__jobqa__/egress" || path === "/__jobqa__/csp-report") && method === "POST") {
      const body = await readBody(req, 64 * 1024);
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        parsed = {};
      }
      if (path === "/__jobqa__/csp-report") {
        const report = /** @type {any} */ (parsed)["csp-report"] || parsed;
        const blocked = String(report["blocked-uri"] || "");
        record({ kind: "csp", directive: report["violated-directive"] || report["effective-directive"], blocked: blocked.split("?")[0] });
      } else {
        const entry = /** @type {Record<string, unknown>} */ (parsed);
        record({ kind: String(entry.kind || "refused"), method: entry.method, origin: entry.origin, path: entry.path });
      }
      res.writeHead(204);
      return res.end();
    }
    if (path === "/config.js") return send(200, "application/javascript", configJs);
    if (path.startsWith("/__proxy/")) {
      /* Host actions (restart workers, write env files, install agents) never run here. */
      if (path === "/__proxy/ping") return sendJson(200, { ok: true, fixtureMock: true, service: "jobqa-fixture" });
      if (path === "/__proxy/discovery-state") {
        return sendJson(200, { ok: true, fixtureMock: true, recommendation: "ready", worker: { up: false, originAllowed: true }, ngrok: {} });
      }
      if (path === "/__proxy/discovery-env-key" && method === "POST") {
        record({ kind: "mocked", method, origin: webOrigins[0], path });
        return sendJson(200, { ok: true, fixtureMock: true, note: "No env file was written: the JOBQA fixture mocks this save." });
      }
      record({ kind: "refused", method, origin: webOrigins[0], path });
      return sendJson(403, { ok: false, hermetic: true, error: "Host actions are disabled in the JOBQA fixture." });
    }
    if (path === "/profile" || path.startsWith("/profile/") || path === "/api/leads/chat") {
      return proxyToApi(req, res);
    }
    if (method !== "GET" && method !== "HEAD") return sendJson(405, { ok: false, reason: "fixture_method_not_allowed" });
    if (path === "/" || path === "/index.html") {
      let html = readIndexHtml(REPO_ROOT);
      const gsiTag = '<script src="https://accounts.google.com/gsi/client" async></script>';
      html = html.includes(gsiTag)
        ? html.replace(gsiTag, '<script src="/__jobqa__/gsi.js" async></script>')
        : html.replace("</head>", '<script src="/__jobqa__/gsi.js" async></script>\n</head>');
      html = html.replace(/<meta charset="UTF-8" \/>/i, (tag) => `${tag}\n    <script src="/__jobqa__/stubs.js"></script>`);
      return send(200, "text/html; charset=utf-8", html);
    }
    const relative = normalize(path).replace(/^[/\\]+/, "");
    if (!relative || relative.split(/[/\\]/).some((part) => part.startsWith("."))) return sendJson(404, { ok: false });
    const full = join(REPO_ROOT, relative);
    if (!full.startsWith(REPO_ROOT + sep) || !existsSync(full)) return sendJson(404, { ok: false, reason: "not_found" });
    try {
      return send(200, contentTypeOf(full), await readFile(full));
    } catch {
      return sendJson(404, { ok: false, reason: "not_found" });
    }
  }

  /** Same-origin /profile* calls go to the fixture API, never to 3847. @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
  function proxyToApi(req, res) {
    return new Promise((done) => {
      const upstream = httpRequest(
        {
          host: "127.0.0.1",
          port: args.apiPort,
          method: req.method,
          path: req.url,
          headers: {
            ...(req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : {}),
            ...(req.headers.origin ? { origin: req.headers.origin } : {}),
          },
        },
        (upRes) => {
          res.writeHead(upRes.statusCode || 502, { "content-type": upRes.headers["content-type"] || "application/json", "cache-control": "no-store" });
          upRes.pipe(res);
          upRes.on("end", () => done(undefined));
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "fixture_api_unreachable" }));
        done(undefined);
      });
      req.pipe(upstream);
    });
  }

  await listen(webServer, args.webPort);
  const baseline = await manifestOf(storeDir);
  process.stdout.write(
    [
      "",
      "JOBQA hermetic fixture: synthetic data only. Google sign-in, Sheets and AI providers are MOCKED.",
      `  Fresh person (Alex Example):     ${webOrigins[0]}/?fixtureAccount=b`,
      `  Saved person (Morgan Existing):  ${webOrigins[0]}/?fixtureAccount=a`,
      `  API (real handlers, temp store): ${apiOrigins[0]}`,
      `  Seed: ${args.seed}    Temp root: ${root}`,
      `  State, refused and mocked calls: ${webOrigins[0]}/__jobqa__/state`,
      `  Store manifest now: ${baseline.digest} (${baseline.files.length} files)`,
      `    re-check: node tests/fixtures/jobqa-hermetic/serve.mjs manifest --root ${root}`,
      "  Mock AI keys: fixture-ok · fixture-slow (4 s) · fixture-fail (provider error) · anything else is rejected as invalid",
      "  Mock Google Client ID: any value ending in .apps.googleusercontent.com",
      "  Stop with Ctrl+C. The temp root is kept for inspection.",
      "",
    ].join("\n"),
  );

  const stop = () => {
    webServer.close();
    apiServer.close();
    manifestOf(storeDir)
      .then((after) => {
        process.stdout.write(`\nStopped. Store manifest: ${after.digest} (${after.files.length} files). Root kept: ${root}\n`);
      })
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

/** @param {import("node:http").IncomingMessage} req @param {number} limit */
function readBody(req, limit) {
  return new Promise((done, fail) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

/** An Express app's listen returns its http.Server; an http.Server returns itself. @param {any} server @param {number} port */
function listen(server, port) {
  return new Promise((done, fail) => {
    const listening = server.listen(port, "127.0.0.1");
    listening.once("listening", () => done(listening));
    listening.once("error", (/** @type {any} */ err) => {
      fail(err && err.code === "EADDRINUSE" ? new Error(`Port ${port} is already in use; choose another with --web-port/--api-port.`) : err);
    });
  });
}

const TYPES = /** @type {Record<string, string>} */ ({
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
});

/** @param {string} file */
function contentTypeOf(file) {
  return TYPES[extname(file).toLowerCase()] || "application/octet-stream";
}

main().catch((err) => {
  process.stderr.write(`JOBQA fixture refused to start: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
