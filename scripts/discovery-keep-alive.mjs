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

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const defaultBootstrapStatePath = join(repoRoot, "discovery-local-bootstrap.json");
const relayTemplateDir = join(repoRoot, "integrations", "cloudflare-relay-template");

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

  const fallback = tunnels.find((tunnel) =>
    String(tunnel && tunnel.public_url ? tunnel.public_url : "").startsWith("https://"),
  );
  return fallback ? normalizeNgrokPublicUrl(fallback.public_url) : "";
}

async function getCurrentNgrokUrl({ fetchImpl = globalThis.fetch, port }) {
  if (typeof fetchImpl !== "function") return "";
  try {
    const res = await fetchImpl("http://127.0.0.1:4040/api/tunnels");
    if (!res || !res.ok) return "";
    const data = await res.json().catch(() => ({}));
    const tunnels = Array.isArray(data.tunnels) ? data.tunnels : [];
    return pickNgrokPublicUrl(tunnels, port);
  } catch (_) {
    return "";
  }
}

function buildWranglerDeployArgs({ workerName, targetUrl }) {
  const args = ["deploy"];
  if (workerName) {
    args.push("--name", workerName);
  }
  args.push("--var", `DISCOVERY_TARGET:${targetUrl}`);
  return args;
}

function runWranglerDeploy({ spawnSyncImpl, workerName, targetUrl }) {
  const args = buildWranglerDeployArgs({ workerName, targetUrl });
  return spawnSyncImpl("wrangler", args, {
    cwd: relayTemplateDir,
    encoding: "utf8",
    env: process.env,
  });
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
  const ngrokUrl =
    normalizeNgrokPublicUrl(options.ngrokPublicUrl) ||
    (await getCurrentNgrokUrl({ fetchImpl: options.fetchImpl, port }));
  if (!ngrokUrl) {
    appendJsonLog("ngrok_url_missing", { port }, logOptions);
    return { ok: false, reason: "ngrok_url_missing" };
  }

  const previous = readJsonFile(paths.statePath) || {};
  if (previous.lastNgrokUrl === ngrokUrl && previous.lastRedeployAt) {
    writeJsonFile(paths.statePath, {
      ...previous,
      schemaVersion: 1,
      jobLabel: KEEP_ALIVE_LABEL,
      lastRunAt: nowIso,
      lastNgrokUrl: ngrokUrl,
    });
    appendJsonLog("ngrok_url_unchanged", { ngrokUrl }, logOptions);
    return { ok: true, redeployed: false, lastNgrokUrl: ngrokUrl };
  }

  const workerName = String(bootstrap.workerName || "").trim();
  appendJsonLog("redeploy_start", { ngrokUrl, workerName }, logOptions);
  const deploy = runWranglerDeploy({
    spawnSyncImpl,
    workerName,
    targetUrl: ngrokUrl,
  });

  if (deploy.error || deploy.status !== 0) {
    appendJsonLog("redeploy_failed", {
      ngrokUrl,
      status: deploy.status,
      error: deploy.error ? deploy.error.message || String(deploy.error) : "",
      stderr: String(deploy.stderr || "").slice(0, 500),
    }, logOptions);
    return { ok: false, reason: "wrangler_failed" };
  }

  writeJsonFile(paths.statePath, {
    schemaVersion: 1,
    jobLabel: KEEP_ALIVE_LABEL,
    lastRunAt: nowIso,
    lastNgrokUrl: ngrokUrl,
    lastRedeployAt: nowIso,
    workerName,
  });
  appendJsonLog("redeploy_success", { ngrokUrl, workerName }, logOptions);
  return {
    ok: true,
    redeployed: true,
    lastNgrokUrl: ngrokUrl,
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
