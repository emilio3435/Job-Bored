import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

export const DEFAULT_PORT = 8080;
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const TLS_CACHE_DIR = join(ROOT, "node_modules", ".cache", "command-center-dev-server");
const TLS_CERT_PATH = join(TLS_CACHE_DIR, "localhost-cert.pem");
const TLS_KEY_PATH = join(TLS_CACHE_DIR, "localhost-key.pem");
const TLS_CERT_SUBJECT = "/CN=localhost";
const TLS_CERT_SAN = "subjectAltName=DNS:localhost,IP:127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
};

const PROXY_ROUTES = {
  "/__proxy/ngrok-tunnels": {
    host: "127.0.0.1",
    port: 4040,
    path: "/api/tunnels",
  },
};

function parseLocalProxyRoute(pathname, searchParams) {
  const match = PROXY_ROUTES[pathname];
  if (match) return match;
  if (pathname === "/__proxy/local-health") {
    const port = parseInt(searchParams.get("port") || "8644", 10);
    return {
      host: "127.0.0.1",
      port: port > 0 && port < 65536 ? port : 8644,
      path: "/health",
    };
  }
  return null;
}

function proxyRequest(target, _req, res) {
  const opts = {
    hostname: target.host,
    port: target.port,
    path: target.path,
    method: "GET",
    timeout: 3000,
  };
  const upstream = httpRequest(opts, (upRes) => {
    const headers = { ...upRes.headers };
    headers["access-control-allow-origin"] = "*";
    delete headers["transfer-encoding"];
    res.writeHead(upRes.statusCode || 502, headers);
    upRes.pipe(res);
  });
  upstream.on("error", () => {
    res.writeHead(502, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ error: "upstream_unreachable" }));
  });
  upstream.on("timeout", () => {
    upstream.destroy();
    res.writeHead(504, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ error: "upstream_timeout" }));
  });
  upstream.end();
}

function requestLocalJson(target, { method = "GET", body = null, timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    const opts = {
      hostname: target.host,
      port: target.port,
      path: target.path,
      method,
      timeout,
      headers: body
        ? {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          }
        : undefined,
    };
    const upstream = httpRequest(opts, (upRes) => {
      let text = "";
      upRes.setEncoding("utf8");
      upRes.on("data", (chunk) => {
        text += chunk;
      });
      upRes.on("end", () => {
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({
          ok: !!upRes.statusCode && upRes.statusCode >= 200 && upRes.statusCode < 300,
          status: upRes.statusCode || 0,
          json,
          text,
        });
      });
    });
    upstream.on("error", (error) => {
      resolve({
        ok: false,
        status: 0,
        json: null,
        text: "",
        error: error && error.message ? error.message : String(error || "error"),
      });
    });
    upstream.on("timeout", () => {
      upstream.destroy();
      resolve({ ok: false, status: 0, json: null, text: "", error: "timeout" });
    });
    if (body) upstream.write(body);
    upstream.end();
  });
}

function normalizeDiscoveryWorkerPort(raw) {
  const port = Number.parseInt(String(raw || "8644"), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 8644;
}

async function probeDiscoveryWorkerHealth(port) {
  const response = await requestLocalJson({
    host: "127.0.0.1",
    port: normalizeDiscoveryWorkerPort(port),
    path: "/health",
  });
  const payload = response.json && typeof response.json === "object" ? response.json : {};
  return {
    ok:
      response.ok &&
      String(payload.status || "").toLowerCase() === "ok" &&
      String(payload.service || "").toLowerCase() === "browser-use-discovery-worker",
    response,
  };
}

async function defaultDiscoveryWorkerStarter({ port = 8644 } = {}) {
  const resolvedPort = normalizeDiscoveryWorkerPort(port);
  const before = await probeDiscoveryWorkerHealth(resolvedPort);
  if (before.ok) {
    return {
      ok: true,
      alreadyRunning: true,
      started: false,
      port: resolvedPort,
    };
  }

  const child = spawn("npm", ["run", "start:discovery-worker"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const health = await probeDiscoveryWorkerHealth(resolvedPort);
    if (health.ok) {
      return {
        ok: true,
        alreadyRunning: false,
        started: true,
        port: resolvedPort,
        pid: child.pid || 0,
      };
    }
  }

  return {
    ok: false,
    started: true,
    port: resolvedPort,
    pid: child.pid || 0,
    message: "Discovery worker did not become healthy after starting.",
  };
}

async function serveStatic(urlPath, res) {
  let filePath = join(ROOT, urlPath === "/" ? "index.html" : urlPath);
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const ct = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": ct, "cache-control": "no-cache" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

function isLocalOrigin(req) {
  const addr = req.socket.remoteAddress || "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr === "localhost"
  );
}

function readBootstrapJson() {
  const filePath = join(ROOT, "discovery-local-bootstrap.json");
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function runScript(scriptPath, args) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => {
      resolve({ ok: false, code: 1, stdout, stderr: stderr || err.message });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code: code ?? 1, stdout, stderr });
    });
  });
}

async function handleFixSetup(req, res, options = {}) {
  if (!isLocalOrigin(req)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, phase: "auth_check", message: "Localhost only." }));
    return;
  }

  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };

  // Allow callers (e.g. handleFullBoot) to inject earlier phases so the
  // dashboard sees one continuous timeline.
  const phases = Array.isArray(options.extraPhases) ? [...options.extraPhases] : [];
  const emit = (phase, detail) => phases.push({ phase, ...detail });

  const previousBootstrap = readBootstrapJson();

  emit("starting_worker", { message: "Running bootstrap to start worker and tunnel..." });
  const bootstrapResult = await runScript(
    join(ROOT, "scripts", "bootstrap-local-discovery.mjs"),
    ["--json"],
  );

  if (!bootstrapResult.ok) {
    emit("bootstrap_failed", {
      message: "Bootstrap script failed.",
      detail: bootstrapResult.stderr.slice(0, 500),
    });
    res.writeHead(500, corsHeaders);
    res.end(JSON.stringify({ ok: false, phases }));
    return;
  }

  let bootstrapData;
  try {
    bootstrapData = JSON.parse(bootstrapResult.stdout);
  } catch {
    emit("bootstrap_failed", { message: "Bootstrap output was not valid JSON." });
    res.writeHead(500, corsHeaders);
    res.end(JSON.stringify({ ok: false, phases }));
    return;
  }

  emit("starting_ngrok", {
    message: "Worker and tunnel are up.",
    tunnelPublicUrl: bootstrapData.tunnelPublicUrl || bootstrapData.ngrokPublicUrl || "",
    localWebhookUrl: bootstrapData.localWebhookUrl || "",
  });

  const oldTunnel = previousBootstrap && previousBootstrap.tunnelPublicUrl
    ? previousBootstrap.tunnelPublicUrl
    : "";
  const newTunnel = bootstrapData.tunnelPublicUrl || bootstrapData.ngrokPublicUrl || "";
  const tunnelChanged = !!oldTunnel && !!newTunnel && oldTunnel !== newTunnel;

  if (tunnelChanged) {
    emit("tunnel_rotated", {
      message:
        "ngrok gave your local setup a new public URL. The relay now needs to be updated.",
      oldTunnel,
      newTunnel,
    });
  }

  const needsRelayRedeploy = tunnelChanged;

  if (!needsRelayRedeploy) {
    emit("verified", { message: "Setup restored. No relay update needed." });
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ ok: true, phases, bootstrap: bootstrapData }));
    return;
  }

  emit("relay_redeploy_needed", {
    message:
      "Redeploying the relay so it points at the new ngrok URL. Your saved Worker URL will stay the same.",
  });

  const targetUrl = bootstrapData.publicTargetUrl || "";
  const workerName = bootstrapData.workerName || "";
  const corsOrigin = bootstrapData.corsOrigin || "http://localhost:8080";
  const sheetId = bootstrapData.sheetId || "";

  if (!targetUrl) {
    emit("needs_manual_redeploy", {
      message: "Cannot determine the relay target URL. Redeploy manually.",
    });
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({
      ok: true,
      relayRedeployed: false,
      phases,
      bootstrap: bootstrapData,
    }));
    return;
  }

  emit("redeploying_relay", { message: "Redeploying Cloudflare relay..." });

  const deployArgs = [
    "--json",
    "--target-url", targetUrl,
    "--no-verify",
  ];
  if (corsOrigin) { deployArgs.push("--cors-origin", corsOrigin); }
  if (workerName) { deployArgs.push("--worker-name", workerName); }
  if (sheetId) { deployArgs.push("--sheet-id", sheetId); }

  const deployResult = await runScript(
    join(ROOT, "scripts", "deploy-cloudflare-relay.mjs"),
    deployArgs,
  );

  if (!deployResult.ok) {
    const stderrLower = (deployResult.stderr || "").toLowerCase();
    if (
      stderrLower.includes("not authenticated") ||
      stderrLower.includes("wrangler login") ||
      stderrLower.includes("cloudflare_api_token")
    ) {
      emit("needs_cloudflare_auth", {
        message:
          "Cloudflare auth is needed to update the relay behind your saved Worker URL. Run `npx wrangler login` in a terminal, then click Fix setup again.",
      });
      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({
        ok: true,
        relayRedeployed: false,
        needsAuth: true,
        phases,
        bootstrap: bootstrapData,
      }));
      return;
    }

    emit("relay_deploy_failed", {
      message: "Relay deploy failed.",
      detail: deployResult.stderr.slice(0, 500),
    });
    res.writeHead(500, corsHeaders);
    res.end(JSON.stringify({
      ok: false,
      relayRedeployed: false,
      phases,
      bootstrap: bootstrapData,
    }));
    return;
  }

  let deployData;
  try {
    deployData = JSON.parse(deployResult.stdout);
  } catch {
    deployData = null;
  }

  emit("verified", {
    message: "Setup fully restored — worker, tunnel, and relay are all up.",
    workerUrl: deployData && deployData.workerUrl ? deployData.workerUrl : "",
  });

  res.writeHead(200, corsHeaders);
  res.end(JSON.stringify({
    ok: true,
    relayRedeployed: true,
    phases,
    bootstrap: bootstrapData,
    deploy: deployData,
  }));
}

/**
 * Kill any stale processes squatting on the ports we need (worker 8644, ngrok
 * 4040). Idempotent: if nothing is squatting, returns ok with empty list.
 *
 * Why this exists: greenfield users frequently have a previous Hermes/python
 * gateway, a stranded ngrok, or a half-dead discovery worker from a prior
 * crash holding 8644. Without this they get cryptic "EADDRINUSE" errors.
 */
async function handleKillStale(req, res) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ ok: false, message: "Localhost only." }));
    return;
  }

  const ports = [8644, 4040];
  const killed = [];
  for (const port of ports) {
    try {
      const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        encoding: "utf8",
      });
      const pids = String(lsof.stdout || "")
        .split(/\s+/)
        .filter((s) => /^\d+$/.test(s))
        .map(Number);
      for (const pid of pids) {
        // Don't kill ourselves (the dev-server) — port 8080 is not in the list,
        // but be defensive in case someone extends this list later.
        if (pid === process.pid) continue;
        try {
          process.kill(pid, "SIGTERM");
          killed.push({ port, pid });
        } catch {
          /* already dead — ignore */
        }
      }
    } catch {
      /* lsof unavailable on some systems — skip silently */
    }
  }

  // Brief pause so OS releases the sockets before the caller starts new procs.
  if (killed.length) await new Promise((r) => setTimeout(r, 600));

  res.writeHead(200, corsHeaders);
  res.end(JSON.stringify({ ok: true, killed }));
}

/**
 * One-call greenfield boot: kill stale → start discovery worker → run
 * fix-setup (which bootstraps ngrok + deploys/refreshes the relay). Returns
 * a single summary so the dashboard can show "Discovery is ready" instead of
 * walking the user through 8 wizard steps.
 */
async function handleFullBoot(req, res, discoveryWorkerStarter) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ ok: false, message: "Localhost only." }));
    return;
  }

  const phases = [];
  const emit = (phase, detail) => phases.push({ phase, ...detail });

  // 1. Kill any stale process holding 8644 / 4040.
  try {
    const ports = [8644, 4040];
    let killed = 0;
    for (const port of ports) {
      const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        encoding: "utf8",
      });
      const pids = String(lsof.stdout || "")
        .split(/\s+/)
        .filter((s) => /^\d+$/.test(s))
        .map(Number);
      for (const pid of pids) {
        if (pid === process.pid) continue;
        try {
          process.kill(pid, "SIGTERM");
          killed += 1;
        } catch {
          /* ignore */
        }
      }
    }
    if (killed) await new Promise((r) => setTimeout(r, 600));
    emit("kill_stale", { killed });
  } catch (e) {
    emit("kill_stale", { killed: 0, warning: e && e.message });
  }

  // 2. Start the discovery worker if not already running.
  try {
    const starter =
      typeof discoveryWorkerStarter === "function"
        ? discoveryWorkerStarter
        : defaultDiscoveryWorkerStarter;
    const startResult = await starter({ port: 8644 });
    emit("start_worker", startResult || {});
    if (!startResult || !startResult.ok) {
      res.writeHead(502, corsHeaders);
      res.end(
        JSON.stringify({
          ok: false,
          phase: "start_worker",
          message:
            (startResult && startResult.message) ||
            "Discovery worker failed to start.",
          phases,
        }),
      );
      return;
    }
  } catch (e) {
    emit("start_worker", { ok: false, error: e && e.message });
    res.writeHead(500, corsHeaders);
    res.end(
      JSON.stringify({
        ok: false,
        phase: "start_worker",
        message: e && e.message ? e.message : String(e),
        phases,
      }),
    );
    return;
  }

  // 3. Hand off to the existing fix-setup flow which bootstraps ngrok and
  //    deploys/refreshes the Cloudflare relay.
  return handleFixSetup(req, res, { extraPhases: phases });
}

// ============================================================================
// Greenfield-automation swarm — Phase 0 stubs (NOT_IMPLEMENTED)
// ----------------------------------------------------------------------------
// These return 501 until the swarm workers fill them in. Frontend must treat
// 501 as "feature not yet available" and degrade to existing manual flow.
//
// Locked contracts (do not widen without orchestrator approval):
//
//   POST /__proxy/oauth-bootstrap
//     Body:    { projectId?: string, applicationName?: string }
//     Success: { ok:true, clientId:string, clientSecret?:string, source:"gcloud" }
//     Failure: { ok:false, reason:"gcloud_missing"|"not_logged_in"
//                       |"api_disabled"|"user_declined"|"internal_error",
//                actionable:string }
//
//   POST /__proxy/install-doctor
//     Body:    {}
//     Success: { ok:boolean,
//                tools:{
//                  gcloud:{ installed:boolean, loggedIn:boolean, version?:string },
//                  wrangler:{ installed:boolean, loggedIn:boolean, version?:string },
//                  ngrok:{ installed:boolean, hasAuthToken:boolean, version?:string },
//                  node:{ version:string, ok:boolean }
//                },
//                missing:string[] }
//
//   POST /__proxy/install-keep-alive
//     Body:    { schedule?:"macos_launchd"|"linux_systemd_user"|"auto" }
//     Success: { ok:true, installedAt:string, jobLabel:string, logPath:string }
//     Failure: { ok:false, reason:string }
//
//   DELETE /__proxy/install-keep-alive
//     Success: { ok:true, removed:boolean }
//
//   GET /__proxy/install-keep-alive/status
//     Success: { installed:boolean, lastRunAt?:string,
//                lastNgrokUrl?:string, jobLabel?:string }
// ============================================================================

// Owner: Backend Worker A
async function handleOAuthBootstrap(req, res) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "forbidden", actionable: "Localhost only." }));
    return;
  }
  try {
    const rawBody = await new Promise((resolve) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => resolve(body));
      req.on("error", () => resolve(""));
    });
    let payload = {};
    try {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      payload = {};
    }
    const { runOAuthBootstrap } = await import("./scripts/oauth-bootstrap.mjs");
    const result = runOAuthBootstrap({
      projectId: typeof payload.projectId === "string" ? payload.projectId : "",
      applicationName:
        typeof payload.applicationName === "string" ? payload.applicationName : "",
    });
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify(result));
  } catch {
    res.writeHead(500, corsHeaders);
    res.end(
      JSON.stringify({
        ok: false,
        reason: "internal_error",
        actionable: "OAuth bootstrap failed. Check the terminal and try again.",
      }),
    );
  }
}

// Owner: Backend Worker A
async function handleInstallDoctor(req, res) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "forbidden" }));
    return;
  }
  try {
    const { runInstallDoctor } = await import("./scripts/install-doctor.mjs");
    const result = runInstallDoctor();
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify(result));
  } catch {
    res.writeHead(500, corsHeaders);
    res.end(
      JSON.stringify({
        ok: false,
        tools: {
          gcloud: { installed: false, loggedIn: false },
          wrangler: { installed: false, loggedIn: false },
          ngrok: { installed: false, hasAuthToken: false },
          node: { version: process.version, ok: true },
        },
        missing: ["Install doctor failed. Check the terminal and try again."],
      }),
    );
  }
}

// Owner: Backend Worker B
async function handleInstallKeepAlive(req, res) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "forbidden" }));
    return;
  }
  res.writeHead(501, corsHeaders);
  res.end(
    JSON.stringify({
      ok: false,
      reason: "not_implemented",
    }),
  );
}

// Owner: Backend Worker B
async function handleUninstallKeepAlive(req, res) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "forbidden" }));
    return;
  }
  res.writeHead(501, corsHeaders);
  res.end(JSON.stringify({ ok: false, reason: "not_implemented" }));
}

// Owner: Backend Worker B
async function handleKeepAliveStatus(req, res) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ installed: false, reason: "forbidden" }));
    return;
  }
  res.writeHead(501, corsHeaders);
  res.end(
    JSON.stringify({
      installed: false,
      reason: "not_implemented",
    }),
  );
}

async function handleStartDiscoveryWorker(req, res, discoveryWorkerStarter) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ ok: false, message: "Localhost only." }));
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const port = normalizeDiscoveryWorkerPort(url.searchParams.get("port"));
  try {
    const starter =
      typeof discoveryWorkerStarter === "function"
        ? discoveryWorkerStarter
        : defaultDiscoveryWorkerStarter;
    const result = await starter({ port });
    res.writeHead(result && result.ok ? 200 : 502, corsHeaders);
    res.end(JSON.stringify(result || { ok: false, message: "No starter result." }));
  } catch (error) {
    res.writeHead(500, corsHeaders);
    res.end(
      JSON.stringify({
        ok: false,
        message:
          error && error.message
            ? error.message
            : String(error || "Failed to start discovery worker."),
      }),
    );
  }
}

function normalizePort(port) {
  const parsed = Number.parseInt(String(port ?? DEFAULT_PORT), 10);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < 65536) {
    return parsed;
  }
  return DEFAULT_PORT;
}

function normalizeBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function ensureLocalTlsMaterial() {
  if (!existsSync(TLS_CERT_PATH) || !existsSync(TLS_KEY_PATH)) {
    mkdirSync(TLS_CACHE_DIR, { recursive: true });
    const result = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        TLS_KEY_PATH,
        "-out",
        TLS_CERT_PATH,
        "-sha256",
        "-days",
        "365",
        "-nodes",
        "-subj",
        TLS_CERT_SUBJECT,
        "-addext",
        TLS_CERT_SAN,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    if (result.status !== 0 || result.error) {
      const detail = (
        result.error
          ? result.error.message
          : `${result.stderr || ""}\n${result.stdout || ""}`
      ).trim();
      throw new Error(
        `Failed to generate the local TLS certificate via openssl. ${
          detail || "Ensure OpenSSL is installed and retry."
        }`,
      );
    }
  }

  return {
    key: readFileSync(TLS_KEY_PATH),
    cert: readFileSync(TLS_CERT_PATH),
    keyPath: TLS_KEY_PATH,
    certPath: TLS_CERT_PATH,
  };
}

function createRequestHandler({ currentPort, logger, discoveryWorkerStarter }) {
  const log =
    logger && typeof logger.log === "function" ? logger.log.bind(logger) : () => {};
  const logError =
    logger && typeof logger.error === "function"
      ? logger.error.bind(logger)
      : () => {};

  return (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${currentPort}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "OPTIONS" && pathname.startsWith("/__proxy/")) {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-max-age": "86400",
      });
      res.end();
      return;
    }

    if (req.method === "POST" && pathname === "/__proxy/fix-setup") {
      handleFixSetup(req, res).catch((err) => {
        logError("  Fix-setup error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, message: "Internal error." }));
        }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/__proxy/start-discovery-worker") {
      handleStartDiscoveryWorker(req, res, discoveryWorkerStarter).catch((err) => {
        logError("  Discovery-worker start error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, message: "Internal error." }));
        }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/__proxy/kill-stale") {
      handleKillStale(req, res).catch((err) => {
        logError("  Kill-stale error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, message: "Internal error." }));
        }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/__proxy/full-boot") {
      handleFullBoot(req, res, discoveryWorkerStarter).catch((err) => {
        logError("  Full-boot error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, message: "Internal error." }));
        }
      });
      return;
    }

    // === Greenfield-automation swarm seams (Phase 0 stubs) ===
    // Worker A owns: handleOAuthBootstrap, handleInstallDoctor
    // Worker B owns: handleInstallKeepAlive, handleUninstallKeepAlive,
    //               handleKeepAliveStatus
    if (req.method === "POST" && pathname === "/__proxy/oauth-bootstrap") {
      handleOAuthBootstrap(req, res).catch((err) => {
        logError("  OAuth-bootstrap error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
        }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/__proxy/install-doctor") {
      handleInstallDoctor(req, res).catch((err) => {
        logError("  Install-doctor error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
        }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/__proxy/install-keep-alive") {
      handleInstallKeepAlive(req, res).catch((err) => {
        logError("  Install-keep-alive error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
        }
      });
      return;
    }

    if (req.method === "DELETE" && pathname === "/__proxy/install-keep-alive") {
      handleUninstallKeepAlive(req, res).catch((err) => {
        logError("  Uninstall-keep-alive error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
        }
      });
      return;
    }

    if (req.method === "GET" && pathname === "/__proxy/install-keep-alive/status") {
      handleKeepAliveStatus(req, res).catch((err) => {
        logError("  Keep-alive-status error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
        }
      });
      return;
    }
    // === end greenfield-automation seams ===

    const target = parseLocalProxyRoute(pathname, url.searchParams);
    if (target) {
      proxyRequest(target, req, res);
      return;
    }

    const ts = new Date().toLocaleTimeString();
    log(`  HTTP  ${ts} ${req.socket.remoteAddress} ${req.method} ${pathname}`);

    serveStatic(pathname, res).then(() => {
      log(`  HTTP  ${ts} ${req.socket.remoteAddress} Returned ${res.statusCode} in ${0} ms`);
    });
  };
}

export function createDevServer({
  port = DEFAULT_PORT,
  logger = console,
  tls = false,
  discoveryWorkerStarter,
} = {}) {
  const currentPort = normalizePort(port);
  const useTls = normalizeBooleanFlag(tls);
  const requestHandler = createRequestHandler({
    currentPort,
    logger,
    discoveryWorkerStarter,
  });

  if (useTls) {
    const tlsMaterial = ensureLocalTlsMaterial();
    return createHttpsServer(
      {
        key: tlsMaterial.key,
        cert: tlsMaterial.cert,
      },
      requestHandler,
    );
  }

  return createHttpServer(requestHandler);
}

export function startDevServer({
  port = DEFAULT_PORT,
  logger = console,
  tls = false,
  discoveryWorkerStarter,
} = {}) {
  const requestedPort = normalizePort(port);
  const useTls = normalizeBooleanFlag(tls);
  const log =
    logger && typeof logger.log === "function" ? logger.log.bind(logger) : () => {};

  return new Promise((resolve, reject) => {
    const server = createDevServer({
      port: requestedPort,
      logger,
      tls: useTls,
      discoveryWorkerStarter,
    });
    server.once("error", reject);
    server.listen(requestedPort, () => {
      const address = server.address();
      const actualPort =
        address && typeof address === "object" ? address.port : requestedPort;
      log(`  Dev server listening on ${useTls ? "https" : "http"}://localhost:${actualPort}`);
      if (useTls) {
        log(`  Local TLS certificate: ${TLS_CERT_PATH}`);
      }
      log(`  Proxying /__proxy/local-health → 127.0.0.1:8644/health`);
      log(`  Proxying /__proxy/ngrok-tunnels → 127.0.0.1:4040/api/tunnels`);
      log(`  POST /__proxy/fix-setup → one-click recovery helper`);
      log(`  POST /__proxy/start-discovery-worker → starts local discovery worker`);
      resolve(server);
    });
  });
}

const isMainModule = process.argv[1]
  ? resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  startDevServer({
    port: process.env.PORT || DEFAULT_PORT,
    tls: process.env.COMMAND_CENTER_TLS || process.env.HTTPS,
  }).catch((error) => {
    console.error("Failed to start dev server:", error);
    process.exitCode = 1;
  });
}
