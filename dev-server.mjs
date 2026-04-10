import { createServer, request as httpRequest } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_PORT = 8080;
const ROOT = fileURLToPath(new URL(".", import.meta.url));

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

async function handleFixSetup(req, res) {
  if (!isLocalOrigin(req)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, phase: "auth_check", message: "Localhost only." }));
    return;
  }

  const corsHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };

  const phases = [];
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
      message: "Tunnel URL changed — relay update needed.",
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
    message: "Relay needs redeployment to point at the new tunnel URL.",
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
          "Cloudflare auth is needed to update the relay. Run `npx wrangler login` in a terminal, then click Fix setup again.",
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

function normalizePort(port) {
  const parsed = Number.parseInt(String(port ?? DEFAULT_PORT), 10);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < 65536) {
    return parsed;
  }
  return DEFAULT_PORT;
}

export function createDevServer({
  port = DEFAULT_PORT,
  logger = console,
} = {}) {
  const currentPort = normalizePort(port);
  const log =
    logger && typeof logger.log === "function" ? logger.log.bind(logger) : () => {};
  const logError =
    logger && typeof logger.error === "function"
      ? logger.error.bind(logger)
      : () => {};

  return createServer((req, res) => {
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
  });
}

export function startDevServer({ port = DEFAULT_PORT, logger = console } = {}) {
  const requestedPort = normalizePort(port);
  const log =
    logger && typeof logger.log === "function" ? logger.log.bind(logger) : () => {};

  return new Promise((resolve, reject) => {
    const server = createDevServer({ port: requestedPort, logger });
    server.once("error", reject);
    server.listen(requestedPort, () => {
      const address = server.address();
      const actualPort =
        address && typeof address === "object" ? address.port : requestedPort;
      log(`  Dev server listening on http://localhost:${actualPort}`);
      log(`  Proxying /__proxy/local-health → 127.0.0.1:8644/health`);
      log(`  Proxying /__proxy/ngrok-tunnels → 127.0.0.1:4040/api/tunnels`);
      log(`  POST /__proxy/fix-setup → one-click recovery helper`);
      resolve(server);
    });
  });
}

const isMainModule = process.argv[1]
  ? resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  startDevServer({ port: process.env.PORT || DEFAULT_PORT }).catch((error) => {
    console.error("Failed to start dev server:", error);
    process.exitCode = 1;
  });
}
