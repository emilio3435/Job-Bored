#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KEEP_ALIVE_LABEL = "ai.jobbored.discovery.keepalive";
export const DEFAULT_POLL_INTERVAL_MS = 30_000;
const EXPECTED_WORKER_SERVICE = "browser-use-discovery-worker";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const defaultBootstrapStatePath = resolve(repoRoot, "discovery-local-bootstrap.json");

export function keepAlivePaths({ homeDir = homedir() } = {}) {
  const root = join(homeDir, ".jobbored");
  return {
    root,
    logDir: join(root, "logs"),
    logPath:
      process.env.JOBBORED_KEEP_ALIVE_LOG_PATH ||
      join(root, "logs", "keep-alive.log"),
    statePath:
      process.env.JOBBORED_KEEP_ALIVE_STATE_PATH ||
      join(root, "keep-alive-state.json"),
  };
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function writeJsonFile(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function appendJsonLog(event, data = {}, options = {}) {
  const paths = keepAlivePaths(options);
  mkdirSync(dirname(paths.logPath), { recursive: true });
  appendFileSync(
    paths.logPath,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      jobLabel: KEEP_ALIVE_LABEL,
      event,
      ...data,
    })}\n`,
    "utf8",
  );
}

function normalizeNgrokPublicUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    return "";
  }
  if (url.protocol !== "https:") return "";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/g, "");
}

function resolveLocalPort(bootstrap) {
  const explicit = Number(bootstrap && bootstrap.localPort);
  if (Number.isInteger(explicit) && explicit > 0 && explicit < 65_536) {
    return explicit;
  }
  try {
    const parsed = new URL(String(bootstrap && bootstrap.localWebhookUrl));
    const port = Number(parsed.port);
    if (Number.isInteger(port) && port > 0 && port < 65_536) {
      return port;
    }
  } catch (_) {
    // Fall through to the bundled worker default.
  }
  return 8644;
}

function resolveRelayTargetUrl(bootstrap, ngrokUrl) {
  const publicBase = new URL(ngrokUrl);
  let targetPath = "";
  try {
    const localWebhook = new URL(String(bootstrap && bootstrap.localWebhookUrl));
    targetPath = localWebhook.pathname || "";
  } catch (_) {
    try {
      const previousTarget = new URL(String(bootstrap && bootstrap.publicTargetUrl));
      targetPath = previousTarget.pathname || "";
    } catch {
      targetPath = "";
    }
  }
  publicBase.pathname = targetPath && targetPath !== "/" ? targetPath : "/";
  publicBase.search = "";
  publicBase.hash = "";
  return publicBase.toString();
}

function tunnelMatchesPort(tunnel, port) {
  const addr = String(tunnel && tunnel.config && tunnel.config.addr ? tunnel.config.addr : "");
  return (
    addr === String(port) ||
    addr.endsWith(`:${port}`) ||
    addr.includes(`localhost:${port}`) ||
    addr.includes(`127.0.0.1:${port}`)
  );
}

function pickNgrokPublicUrl(tunnels, port) {
  const matching = tunnels.find((tunnel) => {
    const publicUrl = String(tunnel && tunnel.public_url ? tunnel.public_url : "");
    return publicUrl.startsWith("https://") && tunnelMatchesPort(tunnel, port);
  });
  if (matching) return normalizeNgrokPublicUrl(matching.public_url);
  return "";
}

function summarizeHttpsTunnels(tunnels) {
  return tunnels
    .filter((tunnel) =>
      String(tunnel && tunnel.public_url ? tunnel.public_url : "").startsWith("https://"),
    )
    .map((tunnel) => ({
      publicUrl: String(tunnel.public_url || ""),
      addr: String(tunnel.config && tunnel.config.addr ? tunnel.config.addr : ""),
    }));
}

async function getCurrentNgrokTarget({ fetchImpl = globalThis.fetch, port }) {
  if (typeof fetchImpl !== "function") {
    return { ngrokUrl: "", reason: "fetch_unavailable" };
  }
  try {
    const res = await fetchImpl("http://127.0.0.1:4040/api/tunnels");
    if (!res || !res.ok) return { ngrokUrl: "", reason: "ngrok_api_down" };
    const data = await res.json().catch(() => ({}));
    const tunnels = Array.isArray(data.tunnels) ? data.tunnels : [];
    const ngrokUrl = pickNgrokPublicUrl(tunnels, port);
    if (ngrokUrl) return { ngrokUrl, reason: "" };
    const httpsTunnels = summarizeHttpsTunnels(tunnels);
    return {
      ngrokUrl: "",
      reason: httpsTunnels.length ? "no_matching_tunnel" : "ngrok_url_missing",
      tunnels: httpsTunnels,
    };
  } catch (_) {
    return { ngrokUrl: "", reason: "ngrok_api_down" };
  }
}

function isExpectedWorkerHealthPayload(payload) {
  return (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    String(payload.service || "").toLowerCase() === EXPECTED_WORKER_SERVICE &&
    String(payload.status || "").toLowerCase() === "ok"
  );
}

async function verifyNgrokWorkerIdentity(ngrokUrl, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "fetch_unavailable" };
  }
  let healthUrl;
  try {
    const parsed = new URL(ngrokUrl);
    parsed.pathname = "/health";
    parsed.search = "";
    parsed.hash = "";
    healthUrl = parsed.toString();
  } catch (_) {
    return { ok: false, reason: "invalid_ngrok_url" };
  }
  try {
    const res = await fetchImpl(healthUrl, {
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    const payload = await res.json().catch(() => null);
    if (res && res.ok && isExpectedWorkerHealthPayload(payload)) {
      return { ok: true, healthUrl };
    }
    return {
      ok: false,
      reason: "unexpected_health_identity",
      healthUrl,
      statusCode: res && res.status ? res.status : 0,
      service: payload && payload.service ? String(payload.service) : "",
      workerStatus: payload && payload.status ? String(payload.status) : "",
    };
  } catch (error) {
    return {
      ok: false,
      reason: "health_unreachable",
      healthUrl,
      message: error && error.message ? error.message : String(error || "error"),
    };
  }
}

function buildWranglerTargetSecretArgs({ workerName }) {
  const args = ["secret", "put", "TARGET_URL"];
  if (workerName) {
    args.push("--name", workerName);
  }
  return args;
}

function isSpawnEnoentError(result) {
  const error = result && result.error;
  if (!error) return false;
  return (
    error.code === "ENOENT" ||
    /\bENOENT\b/.test(String(error.message || ""))
  );
}

function runWranglerTargetSecretPut({ spawnSyncImpl, workerName, targetUrl }) {
  if (!workerName) {
    return {
      status: 1,
      stderr: "Missing workerName in discovery-local-bootstrap.json.",
      error: null,
    };
  }
  const args = buildWranglerTargetSecretArgs({ workerName });
  const spawnOptions = {
    cwd: repoRoot,
    encoding: "utf8",
    input: `${targetUrl}\n`,
    env: process.env,
  };
  const result = spawnSyncImpl("wrangler", args, spawnOptions);
  // wrangler is often not globally installed. When the bare call cannot be
  // spawned (ENOENT), retry through `npx --yes wrangler ...` which resolves the
  // locally installed binary. Any other failure is returned as-is.
  if (isSpawnEnoentError(result)) {
    return spawnSyncImpl("npx", ["--yes", "wrangler", ...args], spawnOptions);
  }
  return result;
}

export async function runKeepAliveCheck(options = {}) {
  const homeDir = options.homeDir || homedir();
  const nowIso = options.nowIso || new Date().toISOString();
  const paths = keepAlivePaths({ homeDir });
  const bootstrapStatePath =
    options.bootstrapStatePath || process.env.JOBBORED_DISCOVERY_BOOTSTRAP_STATE || defaultBootstrapStatePath;
  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const logOptions = { homeDir };

  appendJsonLog("check_start", { bootstrapStatePath }, logOptions);

  const bootstrap = readJsonFile(bootstrapStatePath);
  if (!bootstrap) {
    appendJsonLog("bootstrap_state_missing", { bootstrapStatePath }, logOptions);
    return { ok: false, reason: "bootstrap_state_missing" };
  }

  const port = resolveLocalPort(bootstrap);
  const explicitNgrokUrl = normalizeNgrokPublicUrl(options.ngrokPublicUrl);
  const ngrokTarget = explicitNgrokUrl
    ? { ngrokUrl: explicitNgrokUrl, reason: "" }
    : await getCurrentNgrokTarget({ fetchImpl: options.fetchImpl, port });
  const ngrokUrl = ngrokTarget.ngrokUrl;
  if (!ngrokUrl) {
    appendJsonLog(
      "ngrok_url_missing",
      { port, reason: ngrokTarget.reason, tunnels: ngrokTarget.tunnels || [] },
      logOptions,
    );
    return {
      ok: false,
      reason: ngrokTarget.reason || "ngrok_url_missing",
      ...(ngrokTarget.tunnels ? { tunnels: ngrokTarget.tunnels } : {}),
    };
  }

  const health = await verifyNgrokWorkerIdentity(ngrokUrl, {
    fetchImpl: options.fetchImpl,
  });
  if (!health.ok) {
    appendJsonLog("ngrok_health_mismatch", { port, ngrokUrl, health }, logOptions);
    return {
      ok: false,
      reason: "ngrok_health_mismatch",
      ngrokUrl,
      health,
    };
  }

  const targetUrl = resolveRelayTargetUrl(bootstrap, ngrokUrl);
  const previous = readJsonFile(paths.statePath) || {};
  if (
    previous.lastNgrokUrl === ngrokUrl &&
    previous.lastTargetUrl === targetUrl &&
    previous.lastRedeployAt
  ) {
    writeJsonFile(paths.statePath, {
      ...previous,
      schemaVersion: 1,
      jobLabel: KEEP_ALIVE_LABEL,
      lastRunAt: nowIso,
      lastNgrokUrl: ngrokUrl,
      lastTargetUrl: targetUrl,
    });
    appendJsonLog("ngrok_url_unchanged", { ngrokUrl }, logOptions);
    return { ok: true, redeployed: false, lastNgrokUrl: ngrokUrl, targetUrl };
  }

  const workerName = String(bootstrap.workerName || "").trim();
  appendJsonLog("target_secret_update_start", { ngrokUrl, targetUrl, workerName }, logOptions);
  const secretUpdate = runWranglerTargetSecretPut({
    spawnSyncImpl,
    workerName,
    targetUrl,
  });

  if (secretUpdate.error || secretUpdate.status !== 0) {
    appendJsonLog("target_secret_update_failed", {
      ngrokUrl,
      targetUrl,
      status: secretUpdate.status,
      error: secretUpdate.error ? secretUpdate.error.message || String(secretUpdate.error) : "",
      stderr: String(secretUpdate.stderr || "").slice(0, 500),
    }, logOptions);
    return {
      ok: false,
      reason: workerName ? "wrangler_failed" : "worker_name_missing",
    };
  }

  writeJsonFile(paths.statePath, {
    schemaVersion: 1,
    jobLabel: KEEP_ALIVE_LABEL,
    lastRunAt: nowIso,
    lastNgrokUrl: ngrokUrl,
    lastTargetUrl: targetUrl,
    lastRedeployAt: nowIso,
    workerName,
  });
  appendJsonLog("target_secret_update_success", { ngrokUrl, targetUrl, workerName }, logOptions);
  return {
    ok: true,
    redeployed: true,
    targetSecretUpdated: true,
    lastNgrokUrl: ngrokUrl,
    targetUrl,
    lastRedeployAt: nowIso,
  };
}

function parseArgs(argv) {
  const args = {
    once: false,
    intervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--once") {
      args.once = true;
      continue;
    }
    if (arg === "--interval-ms") {
      const next = argv[i + 1];
      const value = Number(next);
      if (!Number.isInteger(value) || value < 1000) {
        throw new Error("--interval-ms must be an integer >= 1000");
      }
      args.intervalMs = value;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`discovery-keep-alive

Usage:
  node scripts/discovery-keep-alive.mjs --once
  node scripts/discovery-keep-alive.mjs --interval-ms 30000
`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

export {
  buildWranglerTargetSecretArgs,
  pickNgrokPublicUrl,
  resolveRelayTargetUrl,
  tunnelMatchesPort,
  verifyNgrokWorkerIdentity,
};

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let stopping = false;
  const stop = () => {
    stopping = true;
    appendJsonLog("shutdown");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  if (args.once) {
    const result = await runKeepAliveCheck();
    if (!result.ok) process.exitCode = 1;
    return;
  }

  appendJsonLog("daemon_start", { intervalMs: args.intervalMs });
  while (!stopping) {
    await runKeepAliveCheck();
    if (!stopping) {
      await sleep(args.intervalMs);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    appendJsonLog("fatal", {
      message: error && error.message ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
