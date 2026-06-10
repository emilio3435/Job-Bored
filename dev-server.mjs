import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import childProcess, { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolveJobBoredPaths } from "./scripts/lib/paths.mjs";
import { expandIndexIncludes } from "./scripts/lib/expand-index-includes.mjs";
import { applyDiscoveryWorkerLlmAliases } from "./scripts/lib/llm-env.mjs";
import {
  detectTailscale,
  deriveTailnetDashboardUrl,
  runTailscaleServe,
} from "./scripts/lib/tailscale.mjs";

export const DEFAULT_PORT = 8080;
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const TLS_CACHE_DIR = join(ROOT, "node_modules", ".cache", "command-center-dev-server");
const TLS_CERT_PATH = join(TLS_CACHE_DIR, "localhost-cert.pem");
const TLS_KEY_PATH = join(TLS_CACHE_DIR, "localhost-key.pem");
const TLS_CERT_SUBJECT = "/CN=localhost";
const TLS_CERT_SAN = "subjectAltName=DNS:localhost,IP:127.0.0.1";
const DEFAULT_DISCOVERY_WORKER_PORT = 8644;
const TAILSCALE_SERVE_PORTS = new Set([DEFAULT_PORT, DEFAULT_DISCOVERY_WORKER_PORT]);
const EXPECTED_DISCOVERY_WORKER_SERVICE = "browser-use-discovery-worker";
const DISCOVERY_WORKER_SCRIPT = join(
  ROOT,
  "integrations",
  "browser-use-discovery",
  "src",
  "server.ts",
);
const PACKAGED_PATHS = resolveJobBoredPaths({ repoRoot: ROOT });
const DISCOVERY_WORKER_CONFIG_PATH = PACKAGED_PATHS.workerConfig;
const DISCOVERY_WORKER_STATE_DB_PATH = PACKAGED_PATHS.workerStateDb;
const DISCOVERY_WORKER_BROWSER_COMMAND = join(
  ROOT,
  "integrations",
  "browser-use-discovery",
  "bin",
  "browser-use-agent-browser.mjs",
);

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
    return {
      host: "127.0.0.1",
      port: resolveDiscoveryWorkerPort(searchParams.get("port")),
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
    // If the upstream response already began piping, headers are sent; writing
    // them again throws ERR_HTTP_HEADERS_SENT and crashes the dev stack
    // (concurrently -k then kills web/scrape/discovery). Just end the response.
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(502, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ error: "upstream_unreachable" }));
  });
  upstream.on("timeout", () => {
    upstream.destroy();
    if (res.headersSent) {
      res.end();
      return;
    }
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
  const port = Number.parseInt(String(raw || DEFAULT_DISCOVERY_WORKER_PORT), 10);
  return Number.isInteger(port) && port > 0 && port < 65536
    ? port
    : DEFAULT_DISCOVERY_WORKER_PORT;
}

function extractPortFromUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    const port = Number.parseInt(
      url.port || (url.protocol === "https:" ? "443" : "80"),
      10,
    );
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

function resolveDiscoveryWorkerPort(raw) {
  const explicit = String(raw || "").trim();
  if (explicit) return normalizeDiscoveryWorkerPort(explicit);

  const envPort = String(process.env.BROWSER_USE_DISCOVERY_PORT || "").trim();
  if (envPort) return normalizeDiscoveryWorkerPort(envPort);

  const bootstrap = readBootstrapJson();
  const bootstrapPort = Number.parseInt(String(bootstrap && bootstrap.localPort), 10);
  if (Number.isInteger(bootstrapPort) && bootstrapPort > 0 && bootstrapPort < 65536) {
    return bootstrapPort;
  }
  const urlPort = extractPortFromUrl(bootstrap && bootstrap.localWebhookUrl);
  return urlPort || DEFAULT_DISCOVERY_WORKER_PORT;
}

function isExpectedDiscoveryWorkerPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  return (
    String(payload.service || "").toLowerCase() === EXPECTED_DISCOVERY_WORKER_SERVICE &&
    String(payload.status || "").toLowerCase() === "ok"
  );
}

function classifyDiscoveryWorkerHealthResponse(response, port) {
  const payload = response.json && typeof response.json === "object" ? response.json : null;
  const base = {
    port: normalizeDiscoveryWorkerPort(port),
    statusCode: response.status || 0,
    service: payload && payload.service ? String(payload.service) : "",
    workerStatus: payload && payload.status ? String(payload.status) : "",
  };

  if (isExpectedDiscoveryWorkerPayload(payload) && response.ok) {
    return {
      ok: true,
      ...base,
      mode: payload.mode ? String(payload.mode) : "",
      payload,
      response,
    };
  }

  if (!response.status) {
    return {
      ok: false,
      ...base,
      reason: "worker_down",
      message: `No discovery worker is listening on 127.0.0.1:${base.port}.`,
      response,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      ...base,
      reason: "worker_unhealthy",
      message: `Port ${base.port} answered /health with HTTP ${response.status}, not a healthy discovery worker identity.`,
      response,
    };
  }

  if (!payload) {
    return {
      ok: false,
      ...base,
      reason: "invalid_health_response",
      message: `Port ${base.port} answered /health but did not return JSON worker identity.`,
      response,
    };
  }

  if (String(payload.service || "").toLowerCase() !== EXPECTED_DISCOVERY_WORKER_SERVICE) {
    return {
      ok: false,
      ...base,
      reason: "wrong_service",
      message: `Port ${base.port} is occupied by a different service.`,
      response,
    };
  }

  return {
    ok: false,
    ...base,
    reason: "worker_unhealthy",
    message: `Discovery worker on port ${base.port} did not report status ok.`,
    response,
  };
}

async function probeDiscoveryWorkerHealth(port) {
  const response = await requestLocalJson({
    host: "127.0.0.1",
    port: normalizeDiscoveryWorkerPort(port),
    path: "/health",
  });
  return classifyDiscoveryWorkerHealthResponse(response, port);
}

export function buildDiscoveryWorkerEnv(port, baseEnv = process.env) {
  const fallbackGemini = [
    baseEnv.BROWSER_USE_DISCOVERY_GEMINI_API_KEY,
    baseEnv.DISCOVERY_GEMINI_API_KEY,
    baseEnv.GEMINI_API_KEY,
    baseEnv.ATS_GEMINI_API_KEY,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);
  const env = {
    ...baseEnv,
    BROWSER_USE_DISCOVERY_RUN_MODE: "local",
    BROWSER_USE_DISCOVERY_HOST: "127.0.0.1",
    BROWSER_USE_DISCOVERY_PORT: String(normalizeDiscoveryWorkerPort(port)),
    BROWSER_USE_DISCOVERY_WORKER_CONFIG:
      baseEnv.BROWSER_USE_DISCOVERY_WORKER_CONFIG ||
      baseEnv.BROWSER_USE_DISCOVERY_CONFIG_PATH ||
      DISCOVERY_WORKER_CONFIG_PATH,
    BROWSER_USE_DISCOVERY_CONFIG_PATH:
      baseEnv.BROWSER_USE_DISCOVERY_CONFIG_PATH ||
      baseEnv.BROWSER_USE_DISCOVERY_WORKER_CONFIG ||
      DISCOVERY_WORKER_CONFIG_PATH,
    BROWSER_USE_DISCOVERY_WORKER_ENV:
      baseEnv.BROWSER_USE_DISCOVERY_WORKER_ENV ||
      baseEnv.BROWSER_USE_DISCOVERY_ENV_FILE ||
      PACKAGED_PATHS.workerEnv,
    BROWSER_USE_DISCOVERY_ENV_FILE:
      baseEnv.BROWSER_USE_DISCOVERY_ENV_FILE ||
      baseEnv.BROWSER_USE_DISCOVERY_WORKER_ENV ||
      PACKAGED_PATHS.workerEnv,
    BROWSER_USE_DISCOVERY_STATE_DB_PATH: baseEnv.BROWSER_USE_DISCOVERY_STATE_DB_PATH || DISCOVERY_WORKER_STATE_DB_PATH,
    BROWSER_USE_DISCOVERY_BROWSER_COMMAND:
      baseEnv.BROWSER_USE_DISCOVERY_BROWSER_COMMAND || DISCOVERY_WORKER_BROWSER_COMMAND,
  };
  if (fallbackGemini) {
    env.BROWSER_USE_DISCOVERY_GEMINI_API_KEY = fallbackGemini;
  } else {
    delete env.BROWSER_USE_DISCOVERY_GEMINI_API_KEY;
  }
  return applyDiscoveryWorkerLlmAliases(env);
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
  if (before.statusCode > 0) {
    return {
      ok: false,
      started: false,
      port: resolvedPort,
      reason: before.reason,
      statusCode: before.statusCode,
      service: before.service,
      workerStatus: before.workerStatus,
      message:
        before.message ||
        `Port ${resolvedPort} is occupied by a process that is not the discovery worker.`,
    };
  }

  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", DISCOVERY_WORKER_SCRIPT],
    {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      env: buildDiscoveryWorkerEnv(resolvedPort),
    },
  );
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
    reason: "worker_start_timeout",
    message:
      "Discovery worker did not become healthy with the expected JSON identity after starting.",
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
    const ext = extname(filePath).toLowerCase();
    const ct = MIME[ext] || "application/octet-stream";
    // Only HTML needs string processing (for <!-- @include --> directives).
    // Everything else — including binary assets like images and fonts — must
    // be served as raw bytes. Reading binary files with "utf8" replaces every
    // non-UTF-8 byte with U+FFFD and corrupts the payload on re-encode, which
    // breaks .webp/.png/.ico/.woff* assets even though they exist on disk.
    if (ext === ".html") {
      let data = await readFile(filePath, "utf8");
      if (/<!--\s*@include\s+/.test(data)) {
        data = expandIndexIncludes(data, ROOT);
      }
      res.writeHead(200, { "content-type": ct, "cache-control": "no-cache" });
      res.end(data);
      return;
    }
    const data = await readFile(filePath);
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

function resolveDashboardOrigin(req, currentPort) {
  const headerOrigin = String((req.headers && req.headers.origin) || "").trim();
  if (headerOrigin) {
    try {
      const parsed = new URL(headerOrigin);
      const host = String(parsed.hostname || "")
        .replace(/^\[|\]$/g, "")
        .toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1"
      ) {
        return parsed.origin;
      }
    } catch (_) {
      // Fall through to Host-derived origin.
    }
  }
  const hostHeader = String((req.headers && req.headers.host) || "").trim();
  if (hostHeader) {
    const scheme = req.socket && req.socket.encrypted ? "https" : "http";
    return `${scheme}://${hostHeader}`;
  }
  return `http://127.0.0.1:${normalizePort(currentPort)}`;
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

function parseJsonObjectFromScriptOutput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    // Some helpers print progress before their --json payload. Keep the
    // helper output human-friendly while letting the dev server consume the
    // final JSON object deterministically.
  }
  const likelyStarts = [];
  const schemaStart = text.indexOf('{\n  "schemaVersion"');
  if (schemaStart >= 0) likelyStarts.push(schemaStart);
  const okStart = text.indexOf('{\n  "ok"');
  if (okStart >= 0) likelyStarts.push(okStart);
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") likelyStarts.push(i);
  }
  for (const start of [...new Set(likelyStarts)]) {
    try {
      return JSON.parse(text.slice(start));
    } catch (_) {
      // Try the next object-looking boundary.
    }
  }
  return null;
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
  const workerPort = resolveDiscoveryWorkerPort(options.workerPort);
  const dashboardOrigin = String(options.dashboardOrigin || "").trim();

  emit("starting_worker", { message: "Running bootstrap to start worker and tunnel..." });
  const bootstrapArgs = ["--json", "--port", String(workerPort)];
  if (dashboardOrigin) {
    bootstrapArgs.push("--cors-origin", dashboardOrigin);
  }
  const bootstrapResult = await runScript(
    join(ROOT, "scripts", "bootstrap-local-discovery.mjs"),
    bootstrapArgs,
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

  const bootstrapData = parseJsonObjectFromScriptOutput(bootstrapResult.stdout);
  if (!bootstrapData) {
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

  const url = new URL(req.url || "/", "http://localhost");
  const workerPort = resolveDiscoveryWorkerPort(url.searchParams.get("port"));
  const result = await terminateKnownStaleListeners({
    ports: [workerPort, 4040],
    workerPort,
  });

  res.writeHead(200, corsHeaders);
  res.end(JSON.stringify({ ok: result.blocked.length === 0, ...result }));
}

function listListeningPids(port) {
  const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  });
  return String(lsof.stdout || "")
    .split(/\s+/)
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

function getProcessCommand(pid) {
  const ps = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  return String(ps.stdout || "").trim();
}

function listListeningProcesses(port) {
  return listListeningPids(port).map((pid) => ({
    pid,
    command: getProcessCommand(pid),
  }));
}

function isKnownJobBoredWorkerCommand(command) {
  const text = String(command || "").toLowerCase();
  return (
    text.includes("browser-use-discovery") ||
    text.includes("start:discovery-worker")
  );
}

function isKnownNgrokCommandForPort(command, workerPort) {
  const text = String(command || "").toLowerCase();
  if (!text.includes("ngrok")) return false;
  const port = String(normalizeDiscoveryWorkerPort(workerPort));
  return (
    new RegExp(`\\b${port}\\b`).test(text) ||
    text.includes(`localhost:${port}`) ||
    text.includes(`127.0.0.1:${port}`)
  );
}

function isKnownManagedListener(processInfo, port, workerPort) {
  const command = processInfo && processInfo.command ? processInfo.command : "";
  if (port === workerPort) return isKnownJobBoredWorkerCommand(command);
  if (port === 4040) return isKnownNgrokCommandForPort(command, workerPort);
  return false;
}

async function terminateKnownStaleListeners({
  ports = [DEFAULT_DISCOVERY_WORKER_PORT, 4040],
  workerPort = DEFAULT_DISCOVERY_WORKER_PORT,
  healthyDiscoveryWorkerPort = null,
  currentPid = process.pid,
  findProcesses = listListeningProcesses,
  killPid = (pid) => process.kill(pid, "SIGTERM"),
  waitAfterKillMs = 600,
} = {}) {
  const killedProcesses = [];
  const blocked = [];
  let skippedHealthyWorker = false;

  for (const port of ports) {
    if (port === healthyDiscoveryWorkerPort) {
      skippedHealthyWorker = true;
      continue;
    }
    let processes = [];
    try {
      processes = findProcesses(port) || [];
    } catch {
      processes = [];
    }
    for (const processInfo of processes) {
      const pid = Number(processInfo && processInfo.pid);
      if (!Number.isInteger(pid) || pid <= 0 || pid === currentPid) continue;
      const command = String(processInfo.command || "");
      if (!isKnownManagedListener({ pid, command }, port, workerPort)) {
        blocked.push({
          port,
          pid,
          command,
          action:
            port === workerPort
              ? `Stop the foreign listener on port ${workerPort}, or rerun with --port to use another worker port.`
              : "Stop the foreign ngrok/listener on port 4040 before automatic recovery can continue.",
        });
        continue;
      }
      try {
        killPid(pid);
        killedProcesses.push({ port, pid, command });
      } catch {
        /* ignore */
      }
    }
  }

  if (killedProcesses.length && waitAfterKillMs > 0) {
    await new Promise((r) => setTimeout(r, waitAfterKillMs));
  }
  return {
    killed: killedProcesses.length,
    killedProcesses,
    blocked,
    skippedHealthyWorker,
  };
}

export async function killFullBootStalePorts({
  ports = [DEFAULT_DISCOVERY_WORKER_PORT, 4040],
  workerPort = DEFAULT_DISCOVERY_WORKER_PORT,
  healthyDiscoveryWorkerPort = null,
  currentPid = process.pid,
  findProcesses = listListeningProcesses,
  killPid = (pid) => process.kill(pid, "SIGTERM"),
  waitAfterKillMs = 600,
} = {}) {
  return terminateKnownStaleListeners({
    ports,
    workerPort,
    healthyDiscoveryWorkerPort,
    currentPid,
    findProcesses,
    killPid,
    waitAfterKillMs,
  });
}

/**
 * One-call greenfield boot: kill stale → start discovery worker → run
 * fix-setup (which bootstraps ngrok + deploys/refreshes the relay). Returns
 * a single summary so the dashboard can show "Discovery is ready" instead of
 * walking the user through 8 wizard steps.
 */
async function handleFullBoot(req, res, discoveryWorkerStarter, options = {}) {
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
  const url = new URL(req.url || "/", "http://localhost");
  const workerPort = resolveDiscoveryWorkerPort(url.searchParams.get("port"));

  // 1. Kill any stale process holding 8644 / 4040.
  try {
    let healthyDiscoveryWorkerPort = null;
    try {
      const health = await probeDiscoveryWorkerHealth(workerPort);
      if (health && health.ok) {
        healthyDiscoveryWorkerPort = workerPort;
      }
    } catch {
      healthyDiscoveryWorkerPort = null;
    }
    const cleanup = await killFullBootStalePorts({
      ports: [workerPort, 4040],
      workerPort,
      healthyDiscoveryWorkerPort,
    });
    emit("kill_stale", cleanup);
    if (cleanup.blocked && cleanup.blocked.length) {
      res.writeHead(409, corsHeaders);
      res.end(
        JSON.stringify({
          ok: false,
          phase: "kill_stale",
          reason: "foreign_listener",
          message:
            "A foreign process is using a required local port. Stop it manually or choose another discovery worker port.",
          phases,
        }),
      );
      return;
    }
  } catch (e) {
    emit("kill_stale", { killed: 0, warning: e && e.message });
  }

  // 2. Start the discovery worker if not already running.
  try {
    const starter =
      typeof discoveryWorkerStarter === "function"
        ? discoveryWorkerStarter
        : defaultDiscoveryWorkerStarter;
    const startResult = await starter({ port: workerPort });
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

  // Tailscale transport: a running worker is all that's needed — tailscale
  // serve proxies straight to the local worker port, so skip the ngrok
  // bootstrap + Cloudflare relay phases entirely.
  if (url.searchParams.get("skip_tunnel") === "1") {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ ok: true, phases }));
    return;
  }

  // 3. Hand off to the existing fix-setup flow which bootstraps ngrok and
  //    deploys/refreshes the Cloudflare relay.
  return handleFixSetup(req, res, {
    extraPhases: phases,
    workerPort,
    dashboardOrigin: options.dashboardOrigin,
  });
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
  if (!isLocalOrigin(req)) {
    res.writeHead(403, {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    });
    res.end(JSON.stringify({ ok: false, reason: "forbidden" }));
    return;
  }
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
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
          tailscale: { installed: false },
          vercel: { installed: false },
          netlify: { installed: false },
          gh: { installed: false },
          node: { version: process.version, ok: true },
        },
        missing: ["Install doctor failed. Check the terminal and try again."],
      }),
    );
  }
}

function runTailscaleStatus(args) {
  try {
    return childProcess.spawnSync("tailscale", args, {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
      windowsHide: true,
    });
  } catch (error) {
    return { status: 1, stdout: "", stderr: "", error };
  }
}

function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(String(raw || "").trim() || "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function valueMentionsTailscaleServePort(value, port) {
  if (typeof value === "number") return value === port;
  if (typeof value === "string") {
    const text = value.trim();
    return text === String(port) || text.includes(`:${port}`);
  }
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => valueMentionsTailscaleServePort(item, port));
  }
  return Object.entries(value).some(([key, child]) => {
    if (key === String(port) || key.includes(`:${port}`)) return true;
    return valueMentionsTailscaleServePort(child, port);
  });
}

function readTailscaleServeStatus(ports = [DEFAULT_PORT]) {
  const serving = {};
  for (const port of ports) {
    if (TAILSCALE_SERVE_PORTS.has(port)) serving[String(port)] = false;
  }

  const result = runTailscaleStatus(["serve", "status", "--json"]);
  if (result.error || result.status !== 0) return serving;

  const parsed = parseJsonObject(result.stdout);
  for (const key of Object.keys(serving)) {
    const port = Number.parseInt(key, 10);
    serving[key] = parsed
      ? valueMentionsTailscaleServePort(parsed, port)
      : valueMentionsTailscaleServePort(result.stdout, port);
  }
  return serving;
}

function tailscaleRecommendation(detection, serving) {
  if (!detection.installed) return "needs_install";
  if (!detection.loggedIn) return "needs_login";
  if (!serving["8080"]) return "needs_serve";
  return "ready";
}

async function handleTailscaleState(req, res) {
  if (!isLocalOrigin(req)) {
    res.writeHead(403, {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    });
    res.end(JSON.stringify({ ok: false, reason: "forbidden" }));
    return;
  }
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };

  const detection = detectTailscale({ spawnSync: childProcess.spawnSync });
  const serving =
    detection.installed && detection.loggedIn
      ? readTailscaleServeStatus([DEFAULT_PORT])
      : { "8080": false };
  const body = {
    installed: detection.installed,
    loggedIn: detection.loggedIn,
    version: detection.version,
    dnsName: detection.dnsName,
    dashboardUrl: deriveTailnetDashboardUrl(detection),
    serving,
    recommendation: tailscaleRecommendation(detection, serving),
  };
  res.writeHead(200, corsHeaders);
  res.end(JSON.stringify(body));
}

async function handleTailscaleServe(req, res) {
  if (!isLocalOrigin(req)) {
    res.writeHead(403, {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    });
    res.end(JSON.stringify({ ok: false, reason: "forbidden" }));
    return;
  }
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };

  let body = {};
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const parsed = raw ? JSON.parse(raw) : {};
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    body = {};
  }
  const port = Object.hasOwn(body, "port") ? body.port : DEFAULT_PORT;
  const result = runTailscaleServe({
    port,
    spawnSync: childProcess.spawnSync,
  });
  res.writeHead(200, corsHeaders);
  res.end(JSON.stringify(result));
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
  let body = {};
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    body = {};
  }
  try {
    const { installKeepAlive } = await import("./scripts/install-keep-alive.mjs");
    const result = installKeepAlive({
      schedule: body && typeof body.schedule === "string" ? body.schedule : "auto",
    });
    res.writeHead(200, corsHeaders);
    if (result.ok) {
      res.end(
        JSON.stringify({
          ok: true,
          installedAt: result.installedAt,
          jobLabel: result.jobLabel,
          logPath: result.logPath,
        }),
      );
    } else {
      res.end(JSON.stringify({ ok: false, reason: result.reason || "internal_error" }));
    }
  } catch (_) {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
  }
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
  try {
    const { uninstallKeepAlive } = await import("./scripts/uninstall-keep-alive.mjs");
    const result = uninstallKeepAlive();
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ ok: true, removed: !!result.removed }));
  } catch (_) {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
  }
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
  try {
    const { getKeepAliveStatus } = await import("./scripts/install-keep-alive.mjs");
    const status = getKeepAliveStatus();
    const response = { installed: !!status.installed };
    if (status.lastRunAt) response.lastRunAt = status.lastRunAt;
    if (status.lastNgrokUrl) response.lastNgrokUrl = status.lastNgrokUrl;
    if (status.jobLabel) response.jobLabel = status.jobLabel;
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify(response));
  } catch (_) {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ installed: false }));
  }
}

// Worker-autostart: keep the local browser-use discovery worker running across
// reboot (start at login/boot, restart on crash). Mirrors the keep-alive
// handlers above.
async function handleInstallWorkerAutostart(req, res) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "forbidden" }));
    return;
  }
  let body = {};
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    body = {};
  }
  try {
    const { installDiscoveryWorkerAutostart } = await import(
      "./scripts/install-discovery-worker-autostart.mjs"
    );
    const result = installDiscoveryWorkerAutostart({
      schedule:
        body && typeof body.schedule === "string" ? body.schedule : "auto",
    });
    res.writeHead(200, corsHeaders);
    if (result.ok) {
      res.end(
        JSON.stringify({
          ok: true,
          installedAt: result.installedAt,
          jobLabel: result.jobLabel,
          logPath: result.logPath,
          port: result.port,
        }),
      );
    } else {
      res.end(
        JSON.stringify({
          ok: false,
          reason: result.reason || "internal_error",
          ...(result.actionable ? { actionable: result.actionable } : {}),
        }),
      );
    }
  } catch (_) {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
  }
}

async function handleUninstallWorkerAutostart(req, res) {
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
    const { uninstallDiscoveryWorkerAutostart } = await import(
      "./scripts/uninstall-discovery-worker-autostart.mjs"
    );
    const result = uninstallDiscoveryWorkerAutostart();
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ ok: true, removed: !!result.removed }));
  } catch (_) {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
  }
}

async function handleWorkerAutostartStatus(req, res) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ installed: false, reason: "forbidden" }));
    return;
  }
  try {
    const { getDiscoveryWorkerAutostartStatus } = await import(
      "./scripts/install-discovery-worker-autostart.mjs"
    );
    const status = getDiscoveryWorkerAutostartStatus();
    const response = { installed: !!status.installed };
    if (status.jobLabel) response.jobLabel = status.jobLabel;
    if (status.port) response.port = status.port;
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify(response));
  } catch (_) {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ installed: false }));
  }
}

// ============================================================================
// Discovery auto-detect & silent-recover lane
// ----------------------------------------------------------------------------
// GET /__proxy/discovery-state
//
// Aggregates the current health of the local discovery stack so the browser
// can skip the wizard when everything is fine and silently auto-recover when
// it isn't.
//
// Response (locked):
//   {
//     ok: true,
//     worker:  { up: boolean, port: number, lastSeenAt?: string },
//     ngrok:   { up: boolean, url?: string },
//     relay:   { configuredUrl?: string, reachable: boolean },
//     recommendation: "ready" | "auto_recoverable" | "needs_human",
//     recoverableHint?: string
//   }
//
// Recommendation rules:
//   ready              — worker up + ngrok up + relay reachable (or relay not
//                        configured but webhook URL is locally usable)
//   auto_recoverable   — worker down OR ngrok down OR ngrok rotated; the
//                        existing /__proxy/full-boot can fix all of these
//   needs_human        — anything else (e.g. unknown state, missing CLI auth)
// ============================================================================
async function handleDiscoveryState(req, res, options = {}) {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  if (!isLocalOrigin(req)) {
    res.writeHead(403, corsHeaders);
    res.end(JSON.stringify({ ok: false, reason: "forbidden" }));
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const workerPort = resolveDiscoveryWorkerPort(url.searchParams.get("port"));
  const dashboardOrigin = String(options.dashboardOrigin || "").trim();

  // Probe in parallel — every probe is best-effort and short-timeout.
  const [workerHealth, ngrokInfo, keepAliveStatus, workerCors] = await Promise.all([
    probeWorkerIdentity(workerPort, 1500),
    probeNgrokTunnel(1500, workerPort),
    safeKeepAliveStatus(),
    probeDiscoveryWorkerCors(workerPort, dashboardOrigin, 1500),
  ]);

  const workerUp = !!(workerHealth && workerHealth.ok);
  const workerOriginAllowed =
    !dashboardOrigin ||
    !workerUp ||
    !workerCors ||
    workerCors.ok !== false;
  const lastNgrokUrl =
    (keepAliveStatus && keepAliveStatus.lastNgrokUrl) || undefined;
  const ngrokUp = !!(ngrokInfo && ngrokInfo.up);
  const liveNgrokUrl = ngrokInfo && ngrokInfo.url;

  const ngrokRotated =
    !!(lastNgrokUrl && liveNgrokUrl && lastNgrokUrl !== liveNgrokUrl);

  // Check the relay (if its target URL is the live ngrok URL). We don't
  // know the relay URL from the dev-server side, so we only mark relay
  // reachable if ngrok is up — the keep-alive job is responsible for
  // pointing the relay at the live URL.
  const relayInfo = {
    configuredUrl: lastNgrokUrl,
    reachable: ngrokUp && !ngrokRotated,
  };

  let recommendation;
  let recoverableHint;
  if (workerUp && !workerOriginAllowed) {
    recommendation = "auto_recoverable";
    recoverableHint = "origin_not_allowed";
  } else if (workerUp) {
    // ngrok is retired: the dashboard reaches the worker over Tailscale or
    // directly, so worker-up + origin-allowed is "ready". A missing/rotated
    // tunnel is no longer a recovery condition and must not force setup or
    // intercept runs (which caused the "Setting up local discovery…" popup).
    recommendation = "ready";
  } else if (
    workerHealth &&
    (workerHealth.reason === "wrong_service" ||
      workerHealth.reason === "invalid_health_response" ||
      workerHealth.reason === "worker_unhealthy")
  ) {
    recommendation = "needs_human";
    recoverableHint = workerHealth.reason;
  } else {
    recommendation = "auto_recoverable";
    recoverableHint = "worker_down";
  }

  const body = {
    ok: true,
    worker: {
      up: workerUp,
      port: workerPort,
      ...(dashboardOrigin ? { dashboardOrigin } : {}),
      ...(workerUp && workerCors
        ? {
            originAllowed: workerOriginAllowed,
            ...(workerCors.status ? { corsStatus: workerCors.status } : {}),
          }
        : {}),
      ...(workerHealth && !workerHealth.ok
        ? {
            reason: workerHealth.reason,
            statusCode: workerHealth.statusCode,
            service: workerHealth.service,
            workerStatus: workerHealth.workerStatus,
            message: workerHealth.message,
            listeners: workerHealth.listeners || [],
          }
        : {}),
    },
    ngrok: {
      up: ngrokUp,
      ...(liveNgrokUrl ? { url: liveNgrokUrl } : {}),
      ...(ngrokInfo && ngrokInfo.reason ? { reason: ngrokInfo.reason } : {}),
      ...(ngrokInfo && ngrokInfo.tunnels ? { tunnels: ngrokInfo.tunnels } : {}),
    },
    relay: relayInfo,
    recommendation,
    ...(recoverableHint ? { recoverableHint } : {}),
  };

  res.writeHead(200, corsHeaders);
  res.end(JSON.stringify(body));
}

async function probeDiscoveryWorkerCors(port, origin, timeoutMs) {
  if (!origin) return { ok: true };
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch (_) {}
  }, timeoutMs);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: "OPTIONS",
      signal: ctrl.signal,
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-discovery-secret",
      },
    });
    const allowOrigin = String(
      resp.headers.get("access-control-allow-origin") || "",
    ).trim();
    return {
      ok: resp.ok && (allowOrigin === "*" || allowOrigin === origin),
      status: resp.status || 0,
      allowOrigin,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error && error.message ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort local worker probe with a hard timeout. A response only counts
 * as healthy when /health returns the expected discovery-worker JSON identity.
 */
async function probeWorkerIdentity(port, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch (_) {}
  }, timeoutMs);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "GET",
      signal: ctrl.signal,
    });
    const json = await resp.json().catch(() => null);
    const result = classifyDiscoveryWorkerHealthResponse(
      {
        ok: resp.ok,
        status: resp.status || 0,
        json,
        text: "",
      },
      port,
    );
    if (!result.ok && result.reason !== "worker_down") {
      result.listeners = listListeningProcesses(port);
    }
    return result;
  } catch (error) {
    return classifyDiscoveryWorkerHealthResponse(
      {
        ok: false,
        status: 0,
        json: null,
        text: "",
        error: error && error.message ? error.message : String(error || "error"),
      },
      port,
    );
  } finally {
    clearTimeout(timer);
  }
}

function tunnelMatchesPort(tunnel, port) {
  const configAddr = String(
    tunnel &&
      tunnel.config &&
      Object.prototype.hasOwnProperty.call(tunnel.config, "addr")
      ? tunnel.config.addr
      : "",
  ).trim();
  const resolvedPort = String(normalizeDiscoveryWorkerPort(port));
  return (
    configAddr === resolvedPort ||
    configAddr.endsWith(`:${resolvedPort}`) ||
    configAddr.includes(`localhost:${resolvedPort}`) ||
    configAddr.includes(`127.0.0.1:${resolvedPort}`)
  );
}

/**
 * Hit the local ngrok inspector API and return { up, url? } only for a tunnel
 * whose config.addr points at the resolved discovery worker port. Tolerates
 * ngrok being down entirely.
 */
async function probeNgrokTunnel(timeoutMs, workerPort) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch (_) {}
  }, timeoutMs);
  try {
    const resp = await fetch("http://127.0.0.1:4040/api/tunnels", {
      method: "GET",
      signal: ctrl.signal,
    });
    if (!resp.ok) return { up: false };
    const json = await resp.json().catch(() => null);
    const tunnels = (json && Array.isArray(json.tunnels) && json.tunnels) || [];
    const httpsTunnels = tunnels
      .filter((t) => t && typeof t.public_url === "string" && t.public_url.startsWith("https://"))
      .map((t) => ({
        publicUrl: t.public_url,
        addr: String(t.config && t.config.addr ? t.config.addr : ""),
      }));
    const match = tunnels.find(
      (t) =>
        t &&
        typeof t.public_url === "string" &&
        t.public_url.startsWith("https://") &&
        tunnelMatchesPort(t, workerPort),
    );
    if (match) {
      return { up: true, url: match.public_url };
    }
    return {
      up: false,
      reason: httpsTunnels.length ? "no_matching_tunnel" : "ngrok_down",
      ...(httpsTunnels.length ? { tunnels: httpsTunnels } : {}),
    };
  } catch (_) {
    return { up: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the keep-alive status without throwing if the script/state file
 * doesn't exist yet. Mirrors the same import pattern used in
 * handleKeepAliveStatus.
 */
async function safeKeepAliveStatus() {
  try {
    const { getKeepAliveStatus } = await import("./scripts/install-keep-alive.mjs");
    return getKeepAliveStatus();
  } catch (_) {
    return null;
  }
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
      handleFixSetup(req, res, {
        workerPort: resolveDiscoveryWorkerPort(url.searchParams.get("port")),
        dashboardOrigin: resolveDashboardOrigin(req, currentPort),
      }).catch((err) => {
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
      handleFullBoot(req, res, discoveryWorkerStarter, {
        dashboardOrigin: resolveDashboardOrigin(req, currentPort),
      }).catch((err) => {
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

    if (req.method === "GET" && pathname === "/__proxy/tailscale-state") {
      handleTailscaleState(req, res).catch((err) => {
        logError("  Tailscale-state error:", err);
        if (!res.headersSent) {
          res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(
            JSON.stringify({
              installed: false,
              loggedIn: false,
              version: null,
              dnsName: null,
              dashboardUrl: null,
              serving: { "8080": false },
              recommendation: "needs_install",
            }),
          );
        }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/__proxy/tailscale-serve") {
      handleTailscaleServe(req, res).catch((err) => {
        logError("  Tailscale-serve error:", err);
        if (!res.headersSent) {
          res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(
            JSON.stringify({
              ok: false,
              alreadyServing: false,
              url: null,
              error: "tailscale serve failed.",
            }),
          );
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

    if (req.method === "POST" && pathname === "/__proxy/install-worker-autostart") {
      handleInstallWorkerAutostart(req, res).catch((err) => {
        logError("  Install-worker-autostart error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
        }
      });
      return;
    }

    if (req.method === "DELETE" && pathname === "/__proxy/install-worker-autostart") {
      handleUninstallWorkerAutostart(req, res).catch((err) => {
        logError("  Uninstall-worker-autostart error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
        }
      });
      return;
    }

    if (req.method === "GET" && pathname === "/__proxy/install-worker-autostart/status") {
      handleWorkerAutostartStatus(req, res).catch((err) => {
        logError("  Worker-autostart-status error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
        }
      });
      return;
    }
    // === end greenfield-automation seams ===

    // === discovery auto-detect lane ===
    if (req.method === "GET" && pathname === "/__proxy/discovery-state") {
      handleDiscoveryState(req, res, {
        dashboardOrigin: resolveDashboardOrigin(req, currentPort),
      }).catch((err) => {
        logError("  Discovery-state error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ ok: false, reason: "internal_error" }));
        }
      });
      return;
    }
    // === end discovery auto-detect lane ===

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
      const workerPort = resolveDiscoveryWorkerPort();
      log(`  Proxying /__proxy/local-health → 127.0.0.1:${workerPort}/health`);
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
  let runningServer;
  startDevServer({
    port: process.env.PORT || DEFAULT_PORT,
    tls: process.env.COMMAND_CENTER_TLS || process.env.HTTPS,
  }).then((server) => {
    runningServer = server;
    return runningServer;
  }).catch((error) => {
    console.error("Failed to start dev server:", error);
    process.exitCode = 1;
  });
}
