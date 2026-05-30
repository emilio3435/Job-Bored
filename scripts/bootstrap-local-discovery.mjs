#!/usr/bin/env node
/**
 * Bootstrap the local real-discovery path for JobBored:
 * - prefer the browser-use discovery worker as the local engine
 * - preserve Hermes as an advanced fallback path
 * - start or reuse a local ngrok tunnel
 * - write a local state file the dashboard can read on localhost
 *
 * Usage:
 *   npm run discovery:bootstrap-local
 *   npm run discovery:bootstrap-local -- --ngrok-authtoken "..."
 *   NGROK_AUTHTOKEN=... npm run discovery:bootstrap-local
 */

import { randomBytes } from "crypto";
import { spawn, spawnSync } from "child_process";
import { createServer } from "net";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { resolveJobBoredPaths } from "./lib/paths.mjs";
import {
  detectCloudflared,
  parseQuickTunnelUrl,
  selectTransport,
  isStableTransport,
  buildQuickTunnelCommand,
  normalizeTransportPreference,
  TRANSPORT_CLOUDFLARE_NAMED,
  TRANSPORT_CLOUDFLARE_QUICK,
  TRANSPORT_NGROK,
} from "./lib/discovery-transport.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const defaultStateFile = join(repoRoot, "discovery-local-bootstrap.json");
const browserUseDiscoveryDir = join(
  repoRoot,
  "integrations",
  "browser-use-discovery",
);
const packagedPaths = resolveJobBoredPaths({ repoRoot });
const browserUseDiscoveryWorkerLogPath = join(
  packagedPaths.workerHome,
  "logs",
  "worker.log",
);
const bundledBrowserCommandPath = join(
  browserUseDiscoveryDir,
  "bin",
  "browser-use-agent-browser.mjs",
);
const browserUseDiscoveryEnvPath = packagedPaths.workerEnv;
const WEBHOOK_SECRET_ENV_KEY = "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET";
const ALLOWED_ORIGINS_ENV_KEY = "BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS";
const ngrokTokenUrl = "https://dashboard.ngrok.com/get-started/your-authtoken";
const defaultCorsOrigin = "http://localhost:8080";
const defaultLocalAllowedOrigins = Object.freeze([
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
]);
const defaultWorkerPort = 8644;
const expectedBrowserUseWorkerService = "browser-use-discovery-worker";
// Named (stable) Cloudflare tunnel config is supplied by the user; we only read
// it. A stable hostname makes keepalive resync a no-op.
const TUNNEL_HOSTNAME_ENV_KEY = "BROWSER_USE_DISCOVERY_TUNNEL_HOSTNAME";
const TUNNEL_NAME_ENV_KEY = "BROWSER_USE_DISCOVERY_TUNNEL_NAME";
const cloudflaredQuickTunnelLogPath = join(
  packagedPaths.workerHome,
  "logs",
  "discovery-tunnel.log",
);

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`bootstrap-local-discovery

Usage:
  npm run discovery:bootstrap-local
  npm run discovery:bootstrap-local -- --ngrok-authtoken "..."
  NGROK_AUTHTOKEN=... npm run discovery:bootstrap-local

Options:
  --route-name         Advanced only. Reuse or create this Hermes route name.
  --engine             auto (default), browser_use_worker, or hermes
  --port               Local webhook port. Defaults to 8644 unless an existing route says otherwise.
  --cors-origin        Suggested browser origin for the Cloudflare Worker command. Default: ${defaultCorsOrigin}
  --worker-name        Override the suggested Cloudflare Worker name.
  --sheet-id           Optional. Included in the suggested Cloudflare relay deploy command.
  --ngrok-authtoken    Optional. Saves ngrok auth if config is missing.
  --ngrok-public-url   Optional. Skip ngrok startup and use this https:// public URL instead.
  --tunnel             Public-URL transport: auto (default), cloudflare-named, cloudflare-quick, or ngrok.
                       auto picks cloudflare-named (if configured) > cloudflare-quick (if cloudflared installed) > ngrok.
  --state-file         Where to write the local bootstrap JSON. Default: ${defaultStateFile}
  --no-start-gateway   Do not auto-start a local discovery server if /health is down.
  --no-start-ngrok     Do not auto-start ngrok if no tunnel is running.
  --json               Print machine-readable JSON.
  --help               Show this message.

What it does:
  1. Reuses the browser-use worker when it is already running.
  2. Otherwise starts the browser-use worker by default, or Hermes when you explicitly choose the advanced Hermes path.
  3. Verifies the local webhook health endpoint.
  4. Reuses or starts an ngrok tunnel for the webhook port.
  5. Writes a local JSON file that JobBored reads on localhost to autofill Settings -> Local worker + ngrok.
`);
  process.exit(code);
}

function fail(message, code = 1) {
  console.error(`discovery:bootstrap-local: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    engine: "auto",
    routeName: "",
    port: String(process.env.BROWSER_USE_DISCOVERY_PORT || "").trim(),
    portExplicit: false,
    corsOrigin: defaultCorsOrigin,
    workerName: "",
    sheetId: "",
    ngrokAuthtoken: "",
    ngrokPublicUrl: "",
    tunnel: "auto",
    stateFile: defaultStateFile,
    autoStartGateway: true,
    autoStartNgrok: true,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") printUsage(0);
    if (arg === "--no-start-gateway") {
      out.autoStartGateway = false;
      continue;
    }
    if (arg === "--no-start-ngrok") {
      out.autoStartNgrok = false;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const next = argv[i + 1];
    if (
      arg === "--engine" ||
      arg === "--route-name" ||
      arg === "--port" ||
      arg === "--cors-origin" ||
      arg === "--worker-name" ||
      arg === "--sheet-id" ||
      arg === "--ngrok-authtoken" ||
      arg === "--ngrok-public-url" ||
      arg === "--tunnel" ||
      arg === "--state-file"
    ) {
      if (!next || next.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      if (arg === "--engine") out.engine = String(next).trim();
      else if (arg === "--route-name") out.routeName = String(next).trim();
      else if (arg === "--port") {
        out.port = String(next).trim();
        out.portExplicit = true;
      } else if (arg === "--cors-origin") out.corsOrigin = String(next).trim();
      else if (arg === "--worker-name") out.workerName = String(next).trim();
      else if (arg === "--sheet-id") out.sheetId = String(next).trim();
      else if (arg === "--ngrok-authtoken") {
        out.ngrokAuthtoken = String(next).trim();
      } else if (arg === "--ngrok-public-url") {
        out.ngrokPublicUrl = String(next).trim();
      } else if (arg === "--tunnel") {
        out.tunnel = String(next).trim();
      } else if (arg === "--state-file") {
        out.stateFile = resolve(String(next).trim());
      }
      i += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }

  if (!out.ngrokAuthtoken) {
    out.ngrokAuthtoken = String(process.env.NGROK_AUTHTOKEN || "").trim();
  }
  if (normalizeTransportPreference(out.tunnel) === "") {
    fail(
      "--tunnel must be one of: auto, cloudflare-named, cloudflare-quick, ngrok",
    );
  }
  return out;
}

function normalizeEnginePreference(raw) {
  const value = String(raw || "auto")
    .trim()
    .toLowerCase();
  if (value === "browser_use_worker" || value === "browser-use-worker") {
    return "browser_use_worker";
  }
  if (value === "hermes") return "hermes";
  if (value === "auto") return "auto";
  fail("--engine must be one of: auto, browser_use_worker, hermes");
}

function ensureNode18() {
  const major = Number.parseInt(String(process.versions.node || "").split(".")[0], 10);
  if (!Number.isFinite(major) || major < 18) {
    fail("Node 18+ required.");
  }
}

function runCommand(command, args, options = {}) {
  const allowFailure = !!options.allowFailure;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    ...options,
  });
  if (result.error) {
    fail(`could not run ${command}: ${result.error.message || result.error}`);
  }
  if (!allowFailure && result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed:\n${String(
        result.stderr || result.stdout || "",
      ).trim()}`,
    );
  }
  return result;
}

function ensureCommand(command, args = ["--help"]) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) {
    fail(`${command} is not installed or not on PATH.`);
  }
}

function parseGoogleSheetId(raw) {
  const s = raw != null ? String(raw).trim() : "";
  if (!s) return "";
  const match = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$|\?|#)/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s) && s !== "YOUR_SHEET_ID_HERE") return s;
  return "";
}

function readSheetIdFromConfig() {
  const configPath = join(repoRoot, "config.js");
  if (!existsSync(configPath)) return "";
  try {
    const text = readFileSync(configPath, "utf8");
    const match = text.match(/sheetId\s*:\s*["'`]([^"'`]+)["'`]/);
    return match && match[1] ? parseGoogleSheetId(match[1]) : "";
  } catch (_) {
    return "";
  }
}

function readExistingBootstrapState(stateFile) {
  const filePath = resolve(String(stateFile || defaultStateFile).trim());
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function quoteShellArg(raw) {
  return `'${String(raw || "").replace(/'/g, `'\"'\"'`)}'`;
}

function sanitizeWorkerName(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/^-+|-+$/g, "");
}

function inferWorkerSuffixFromTarget(targetUrl) {
  try {
    const parsed = new URL(String(targetUrl || "").trim());
    const routeTail = parsed.pathname
      .split("/")
      .filter(Boolean)
      .pop();
    if (routeTail) return routeTail.slice(-6).toLowerCase();
    return parsed.hostname.replace(/[^a-z0-9]+/gi, "-").slice(0, 10);
  } catch (_) {
    return "local";
  }
}

function buildSuggestedWorkerName(targetUrl, explicitWorkerName, existingWorkerName) {
  if (explicitWorkerName) {
    return sanitizeWorkerName(explicitWorkerName) || "jobbored-discovery-relay";
  }
  const reusedWorkerName = sanitizeWorkerName(existingWorkerName);
  if (/^jobbored-discovery-relay-[a-z0-9-]+$/.test(reusedWorkerName)) {
    return reusedWorkerName;
  }
  const suffix = inferWorkerSuffixFromTarget(targetUrl) || "local";
  return (
    sanitizeWorkerName(`jobbored-discovery-relay-${suffix}`) ||
    "jobbored-discovery-relay"
  );
}

function normalizeCorsOrigin(raw) {
  const value = String(raw || "").trim();
  if (!value) return defaultCorsOrigin;
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    fail("--cors-origin must be a valid origin like http://localhost:8080");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail("--cors-origin must use http:// or https://");
  }
  return url.origin;
}

function buildCloudflareRelayDeployCommand(targetUrl, corsOrigin, workerName, sheetId) {
  const parts = ["npm run cloudflare-relay:deploy --"];
  parts.push(`--target-url ${quoteShellArg(targetUrl)}`);
  if (corsOrigin) parts.push(`--cors-origin ${quoteShellArg(corsOrigin)}`);
  if (workerName) parts.push(`--worker-name ${quoteShellArg(workerName)}`);
  if (sheetId) parts.push(`--sheet-id ${quoteShellArg(sheetId)}`);
  return parts.join(" ");
}

function buildHermesPrompt() {
  const skillPath = join(repoRoot, "integrations", "openclaw-command-center", "SKILL.md");
  const contractPath = join(repoRoot, "AGENT_CONTRACT.md");
  return `Handle this as a Command Center discovery webhook. Before doing anything else, read ${skillPath} and ${contractPath}. Then process the payload below. If you can access the target Google Sheet, write or update Pipeline rows using column E dedupe. If you cannot complete the run, explain exactly what credential, API, or endpoint is missing. Payload: {__raw__}`;
}

function parseHermesWebhookList(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const nameMatch = line.match(/^\s*◆\s+(.+?)\s*$/);
    if (nameMatch) {
      current = { name: nameMatch[1].trim(), url: "", description: "" };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const urlMatch = line.match(/^\s*URL:\s*(\S+)\s*$/);
    if (urlMatch) {
      current.url = urlMatch[1].trim();
      continue;
    }
    if (!current.description && line.trim()) {
      current.description = line.trim();
    }
  }
  return out;
}

function normalizeLocalWebhookUrl(raw, explicitPort) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const port = explicitPort || url.port || (url.protocol === "https:" ? "443" : "80");
    url.protocol = "http:";
    url.hostname = "127.0.0.1";
    url.port = port;
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function extractPortFromUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.port) return url.port;
    return url.protocol === "https:" ? "443" : "80";
  } catch (_) {
    return "";
  }
}

function ensureRouteName(routeName) {
  const candidate = String(routeName || "").trim();
  return candidate || `command-center-discovery-${randomBytes(6).toString("hex")}`;
}

function ensureHermesRoute(explicitRouteName) {
  const listResult = runCommand("hermes", ["webhook", "list"]);
  const subscriptions = parseHermesWebhookList(listResult.stdout);
  if (explicitRouteName) {
    const found = subscriptions.find((item) => item.name === explicitRouteName);
    if (found) return { ...found, created: false };
  }
  if (!explicitRouteName) {
    const found = subscriptions.find((item) =>
      /^command-center-discovery-/i.test(item.name || ""),
    );
    if (found) return { ...found, created: false };
  }

  const routeName = ensureRouteName(explicitRouteName);
  const createResult = runCommand("hermes", [
    "webhook",
    "subscribe",
    routeName,
    "--description",
    "Command Center Run discovery webhook",
    "--deliver",
    "log",
    "--secret",
    "INSECURE_NO_AUTH",
    "--prompt",
    buildHermesPrompt(),
  ]);
  if (createResult.status !== 0) {
    fail(
      `could not create Hermes webhook route:\n${String(
        createResult.stderr || createResult.stdout || "",
      ).trim()}`,
    );
  }
  return {
    name: routeName,
    url: "",
    description: "Command Center Run discovery webhook",
    created: true,
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeHealth(healthUrl) {
  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    const data = await res.json().catch(() => ({}));
    const body = data && typeof data === "object" ? data : {};
    return {
      ok: !!res.ok && String(body.status || "").toLowerCase() === "ok",
      reachable: true,
      statusCode: res.status || 0,
      serviceName: String(body.service || "").trim(),
      workerStatus: String(body.status || "").trim(),
      mode: String(body.mode || "").trim(),
      platform: String(body.platform || "").trim(),
      body,
    };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      statusCode: 0,
      serviceName: "",
      workerStatus: "",
      mode: "",
      platform: "",
      body: null,
      error: err && err.message ? err.message : String(err || "error"),
    };
  }
}

function isBrowserUseDiscoveryHealth(healthProbe) {
  return (
    !!healthProbe &&
    !!healthProbe.ok &&
    String(healthProbe.serviceName || "").toLowerCase() ===
      expectedBrowserUseWorkerService
  );
}

function isHermesWebhookHealth(healthProbe) {
  return (
    !!healthProbe &&
    !!healthProbe.ok &&
    String(healthProbe.platform || "").toLowerCase() === "webhook"
  );
}

function startDetached(command, args, extraEnv = {}, options = {}) {
  const logPath =
    options && typeof options.logPath === "string"
      ? options.logPath.trim()
      : "";
  let logFd = null;
  let stdio = "ignore";
  try {
    if (logPath) {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(
        logPath,
        `\n[${new Date().toISOString()}] starting ${command} ${args.join(" ")}\n`,
        "utf8",
      );
      logFd = openSync(logPath, "a");
      stdio = ["ignore", logFd, logFd];
    }
    const child = spawn(command, args, {
      cwd: repoRoot,
      detached: true,
      stdio,
      env: {
        ...process.env,
        ...extraEnv,
      },
    });
    child.unref();
    return child.pid || 0;
  } finally {
    if (logFd !== null) {
      closeSync(logFd);
    }
  }
}

/**
 * Parse a `.env` file into an object. Lines starting with `#` and blank lines
 * are ignored. Values may be wrapped in single or double quotes; quotes are
 * stripped. Inline comments after a value are NOT stripped (to avoid breaking
 * secrets that legitimately contain `#`).
 */
function parseEnvFile(text) {
  const out = {};
  if (typeof text !== "string" || !text) return out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function readBrowserUseDiscoveryEnvFile() {
  if (!existsSync(browserUseDiscoveryEnvPath)) return null;
  try {
    const text = readFileSync(browserUseDiscoveryEnvPath, "utf8");
    return { text, parsed: parseEnvFile(text) };
  } catch (err) {
    fail(
      `could not read ${browserUseDiscoveryEnvPath}: ${
        err && err.message ? err.message : String(err)
      }`,
    );
    return null;
  }
}

function generateWebhookSecret() {
  return randomBytes(32).toString("hex");
}

function upsertBrowserUseDiscoveryEnvValue(key, value) {
  const banner =
    "# JobBored local discovery worker env\n" +
    "# Generated by `npm run discovery:bootstrap-local`. Gitignored.\n" +
    "# Add other BROWSER_USE_DISCOVERY_* env vars below as needed.\n";
  const line = `${key}=${value}\n`;
  mkdirSync(dirname(browserUseDiscoveryEnvPath), { recursive: true });
  if (!existsSync(browserUseDiscoveryEnvPath)) {
    writeFileSync(browserUseDiscoveryEnvPath, `${banner}\n${line}`, "utf8");
    return { mode: "created" };
  }
  const existing = readFileSync(browserUseDiscoveryEnvPath, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  let next;
  if (re.test(existing)) {
    next = existing.replace(re, line.trimEnd());
  } else {
    next = existing.endsWith("\n") ? `${existing}${line}` : `${existing}\n${line}`;
  }
  writeFileSync(browserUseDiscoveryEnvPath, next, "utf8");
  return { mode: re.test(existing) ? "updated" : "appended" };
}

/**
 * Append (or replace) BROWSER_USE_DISCOVERY_WEBHOOK_SECRET in
 * the packaged local worker env file. Creates the file with a sensible banner
 * when it does not exist.
 */
function writeWebhookSecretToEnvFile(secret) {
  return upsertBrowserUseDiscoveryEnvValue(WEBHOOK_SECRET_ENV_KEY, secret);
}

function splitCsvList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function localOriginAliases(origin) {
  const normalized = normalizeCorsOrigin(origin);
  const out = [normalized];
  try {
    const parsed = new URL(normalized);
    const host = String(parsed.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      const alias = new URL(normalized);
      alias.hostname = host === "localhost" ? "127.0.0.1" : "localhost";
      out.push(alias.origin);
    }
  } catch (_) {
    // normalizeCorsOrigin already validated; keep only the normalized value.
  }
  return out;
}

function buildAllowedOriginsValue(corsOrigin) {
  const envFile = readBrowserUseDiscoveryEnvFile();
  const fromEnvFile =
    envFile && envFile.parsed && envFile.parsed[ALLOWED_ORIGINS_ENV_KEY]
      ? envFile.parsed[ALLOWED_ORIGINS_ENV_KEY]
      : "";
  const values = [
    ...defaultLocalAllowedOrigins,
    ...splitCsvList(fromEnvFile),
    ...splitCsvList(process.env[ALLOWED_ORIGINS_ENV_KEY]),
    ...splitCsvList(process.env.DISCOVERY_ALLOWED_ORIGINS),
    ...localOriginAliases(corsOrigin),
  ];
  if (values.includes("*")) return "*";
  return [...new Set(values)].join(",");
}

function writeAllowedOriginsToEnvFile(allowedOrigins) {
  return upsertBrowserUseDiscoveryEnvValue(
    ALLOWED_ORIGINS_ENV_KEY,
    allowedOrigins,
  );
}

/**
 * Resolve the webhook secret bootstrap should use:
 *  1. If process.env has it, reuse it (no .env write).
 *  2. Otherwise, if the packaged local worker env file defines it, reuse.
 *  3. Otherwise, generate a fresh secret AND persist it to that env file so
 *     the next bootstrap run is deterministic.
 *
 * Always returns the same secret value across calls in a single bootstrap
 * invocation; never returns an empty string.
 */
function resolveWebhookSecret() {
  const fromProcess = String(process.env[WEBHOOK_SECRET_ENV_KEY] || "").trim();
  if (fromProcess) {
    return { secret: fromProcess, source: "process_env", wrote: false };
  }
  const file = readBrowserUseDiscoveryEnvFile();
  const fromFile =
    file && file.parsed[WEBHOOK_SECRET_ENV_KEY]
      ? String(file.parsed[WEBHOOK_SECRET_ENV_KEY]).trim()
      : "";
  if (fromFile) {
    return { secret: fromFile, source: "env_file", wrote: false };
  }
  const generated = generateWebhookSecret();
  const writeResult = writeWebhookSecretToEnvFile(generated);
  return {
    secret: generated,
    source: "generated",
    wrote: true,
    writeMode: writeResult.mode,
  };
}

async function probeWorkerAcceptsSecret(port, secret, origin) {
  if (!secret) return { ok: false, reason: "no_secret" };
  const url = `http://127.0.0.1:${port}/webhook`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-discovery-secret": secret,
        "x-discovery-auth-probe": "1",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({
        event: "command-center.discovery",
        schemaVersion: 1,
        sheetId: "bootstrap-probe",
        variationKey: `bootstrap-probe-${Date.now().toString(36)}`,
        requestedAt: new Date().toISOString(),
      }),
    });
    if (res.status === 403) {
      return { ok: false, reason: "origin_not_allowed", status: 403 };
    }
    if (res.status === 401) return { ok: false, reason: "wrong_secret", status: 401 };
    // 200 (auth probe), 202 (older async), 400/409 (older preflight failures)
    // all mean auth passed, which is the only thing we care about here.
    if (
      res.status === 200 ||
      res.status === 202 ||
      res.status === 400 ||
      res.status === 409
    ) {
      return { ok: true, status: res.status };
    }
    return { ok: false, reason: "unexpected_status", status: res.status };
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      message: err && err.message ? err.message : String(err),
    };
  }
}

function findPidsOnPort(port) {
  const result = spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  if (result.status !== 0 && !result.stdout) return [];
  return String(result.stdout || "")
    .split(/\s+/)
    .map((token) => Number.parseInt(token, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function getProcessCommand(pid) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  return String(result.stdout || "").trim();
}

function findProcessesOnPort(port) {
  return findPidsOnPort(port).map((pid) => ({
    pid,
    command: getProcessCommand(pid),
  }));
}

function isKnownBrowserUseWorkerCommand(command) {
  const text = String(command || "").toLowerCase();
  return (
    text.includes("browser-use-discovery") ||
    text.includes("start:discovery-worker")
  );
}

function formatPortProcessList(processes) {
  return processes
    .map((processInfo) => {
      const command = processInfo.command ? ` ${processInfo.command}` : "";
      return `PID ${processInfo.pid}${command}`;
    })
    .join("; ");
}

/**
 * Probe whether a TCP port is free to bind on 127.0.0.1 by briefly opening a
 * listener on it. Resolves false when the bind fails (e.g. EADDRINUSE),
 * regardless of which process holds the port.
 */
function isTcpPortFree(port, { createServerImpl = createServer } = {}) {
  return new Promise((resolveProbe) => {
    const server = createServerImpl();
    let settled = false;
    const finish = (free) => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch (_) {
        // best effort
      }
      resolveProbe(free);
    };
    server.once("error", () => finish(false));
    server.once("listening", () => finish(true));
    try {
      server.listen(port, "127.0.0.1");
    } catch (_) {
      finish(false);
    }
  });
}

/**
 * Scan upward from startPort and return the first free TCP port. Used when the
 * preferred worker port is held by a foreign process (e.g. a Hermes gateway)
 * and we need to relocate the JobBored worker without disturbing it.
 */
async function findAvailableWorkerPort(startPort, options = {}) {
  const maxScan = Number.isFinite(options.maxScan) ? options.maxScan : 100;
  const isPortFree = options.isPortFree || isTcpPortFree;
  const start = Number.parseInt(String(startPort), 10);
  if (!Number.isFinite(start) || start <= 0) {
    fail("findAvailableWorkerPort requires a positive start port");
  }
  for (let candidate = start; candidate < start + maxScan; candidate += 1) {
    if (candidate > 65535) break;
    // eslint-disable-next-line no-await-in-loop
    const free = await isPortFree(candidate, options);
    if (free) return candidate;
  }
  fail(
    `Could not find a free TCP port in the range ${start}-${Math.min(
      start + maxScan - 1,
      65535,
    )} for the browser-use discovery worker. Free a port or rerun with --port.`,
  );
}

/**
 * Decide whether the port is held by a process that is NOT the JobBored
 * browser-use worker. When the worker (or nothing) holds it we keep today's
 * reuse/launch behavior; a foreign listener (e.g. Hermes) means we should
 * relocate the worker to a free port instead of failing.
 */
function portHasForeignListener(port, { findProcesses = findProcessesOnPort } = {}) {
  const processes = findProcesses(port);
  if (!processes.length) return { foreign: false, processes };
  const foreign = processes.filter(
    (processInfo) => !isKnownBrowserUseWorkerCommand(processInfo.command),
  );
  return { foreign: foreign.length > 0, processes, foreignProcesses: foreign };
}

async function killKnownWorkerProcesses(port) {
  const processes = findProcessesOnPort(port);
  const blocked = processes.filter(
    (processInfo) => !isKnownBrowserUseWorkerCommand(processInfo.command),
  );
  if (blocked.length) {
    fail(
      `Port ${port} is occupied by a process that is not the JobBored browser-use discovery worker: ${formatPortProcessList(blocked)}. Stop it manually or rerun with --port to use another worker port.`,
    );
  }
  const known = processes.filter((processInfo) =>
    isKnownBrowserUseWorkerCommand(processInfo.command),
  );
  if (!known.length) return;
  for (const { pid } of known) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (_) {
      // process may already be gone
    }
  }
  // Brief grace period so the OS releases the port before we relaunch.
  await sleep(800);
}

async function ensureWorkerPortIsFreeOrKillKnownStale(port) {
  const processes = findProcessesOnPort(port);
  if (!processes.length) return;
  const blocked = processes.filter(
    (processInfo) => !isKnownBrowserUseWorkerCommand(processInfo.command),
  );
  if (blocked.length) {
    fail(
      `Port ${port} is already in use by a non-JobBored process: ${formatPortProcessList(blocked)}. Stop it manually or rerun with --port to use another worker port.`,
    );
  }
  await killKnownWorkerProcesses(port);
}

async function ensureBrowserUseWorkerHealth(
  port,
  autoStartGateway,
  secret,
  corsOrigin,
  allowedOrigins,
) {
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const initialProbe = await probeHealth(healthUrl);
  const launchEnv = {
    BROWSER_USE_DISCOVERY_RUN_MODE: "local",
    BROWSER_USE_DISCOVERY_PORT: String(port),
    BROWSER_USE_DISCOVERY_HOST: "127.0.0.1",
    BROWSER_USE_DISCOVERY_WORKER_CONFIG: packagedPaths.workerConfig,
    BROWSER_USE_DISCOVERY_CONFIG_PATH: packagedPaths.workerConfig,
    BROWSER_USE_DISCOVERY_WORKER_ENV: packagedPaths.workerEnv,
    BROWSER_USE_DISCOVERY_ENV_FILE: packagedPaths.workerEnv,
    BROWSER_USE_DISCOVERY_STATE_DB_PATH: packagedPaths.workerStateDb,
    BROWSER_USE_DISCOVERY_BROWSER_COMMAND:
      process.env.BROWSER_USE_DISCOVERY_BROWSER_COMMAND ||
      bundledBrowserCommandPath,
    [ALLOWED_ORIGINS_ENV_KEY]: allowedOrigins,
    ...(secret ? { [WEBHOOK_SECRET_ENV_KEY]: secret } : {}),
  };

  if (isBrowserUseDiscoveryHealth(initialProbe)) {
    // /health is auth-free, but the worker may be running with a different
    // (or no) secret than what bootstrap just resolved. Probe /webhook with
    // the resolved secret — if it 401s, restart the worker with the right
    // env so the dashboard's autofilled secret will work.
    const secretProbe = await probeWorkerAcceptsSecret(port, secret, corsOrigin);
    if (secretProbe.ok) {
      return {
        ok: true,
        healthUrl,
        workerLogPath: browserUseDiscoveryWorkerLogPath,
        startedGateway: false,
        secretRestart: false,
        serviceName: initialProbe.serviceName,
        mode: initialProbe.mode,
        platform: initialProbe.platform,
      };
    }
    if (
      secretProbe.reason === "wrong_secret" ||
      secretProbe.reason === "origin_not_allowed"
    ) {
      if (!autoStartGateway) {
        fail(
          secretProbe.reason === "origin_not_allowed"
            ? `Worker on ${healthUrl} is running but does not allow ${corsOrigin}. Stop it (\`lsof -tiTCP:${port}\` then \`kill\`) and rerun, or rerun without \`--no-start-gateway\`.`
            : `Worker on ${healthUrl} is running with a different webhook secret than the one bootstrap resolved. Stop it (\`lsof -tiTCP:${port}\` then \`kill\`) and rerun, or rerun without \`--no-start-gateway\`.`,
        );
      }
      console.log(
        secretProbe.reason === "origin_not_allowed"
          ? `discovery:bootstrap-local: existing worker on :${port} does not allow ${corsOrigin} — restarting it with updated allowed origins...`
          : `discovery:bootstrap-local: existing worker on :${port} rejected the resolved secret — restarting it with the bootstrap secret...`,
      );
      await killKnownWorkerProcesses(port);
      // Fall through to the launch path below.
    } else {
      // Network error against /webhook but /health is fine — treat as healthy
      // and let the dashboard surface any further failure.
      return {
        ok: true,
        healthUrl,
        workerLogPath: browserUseDiscoveryWorkerLogPath,
        startedGateway: false,
        secretRestart: false,
        serviceName: initialProbe.serviceName,
        mode: initialProbe.mode,
        platform: initialProbe.platform,
      };
    }
  } else if (initialProbe.reachable) {
    const detail = [
      initialProbe.statusCode ? `HTTP ${initialProbe.statusCode}` : "",
      initialProbe.serviceName ? `service=${initialProbe.serviceName}` : "",
      initialProbe.workerStatus ? `status=${initialProbe.workerStatus}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const processes = findProcessesOnPort(port);
    const processDetail = processes.length
      ? ` Listener: ${formatPortProcessList(processes)}.`
      : "";
    fail(
      `Port ${port} answered /health but it is not the JobBored browser-use discovery worker${detail ? ` (${detail})` : ""}.${processDetail} Stop the foreign process or rerun with --port to use another worker port.`,
    );
  }
  if (!autoStartGateway) {
    fail(
      `Local discovery health is down at ${healthUrl}. Start the browser-use worker with \`npm run discovery:worker:start-local\`, or use \`--engine hermes\` if you intentionally want the advanced Hermes path, then retry.`,
    );
  }
  await ensureWorkerPortIsFreeOrKillKnownStale(port);
  console.log(
    "discovery:bootstrap-local: starting browser-use discovery worker...",
  );
  startDetached(
    process.execPath,
    [
      "--experimental-strip-types",
      join(
        repoRoot,
        "integrations",
        "browser-use-discovery",
        "src",
        "server.ts",
      ),
    ],
    launchEnv,
    { logPath: browserUseDiscoveryWorkerLogPath },
  );
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(1000);
    const retryProbe = await probeHealth(healthUrl);
    if (isBrowserUseDiscoveryHealth(retryProbe)) {
      return {
        ok: true,
        healthUrl,
        workerLogPath: browserUseDiscoveryWorkerLogPath,
        startedGateway: true,
        secretRestart: false,
        serviceName: retryProbe.serviceName,
        mode: retryProbe.mode,
        platform: retryProbe.platform,
      };
    }
  }
  fail(
    `Local discovery health still is not available at ${healthUrl}. Check the worker log at ${browserUseDiscoveryWorkerLogPath}, start the worker with \`npm run discovery:worker:start-local\`, or rerun bootstrap with \`--engine hermes\` if you intentionally want the advanced Hermes path.`,
  );
}

async function ensureGatewayHealth(port, autoStartGateway) {
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const initialProbe = await probeHealth(healthUrl);
  if (initialProbe.ok) {
    return {
      ok: true,
      healthUrl,
      startedGateway: false,
      serviceName: initialProbe.serviceName,
      mode: initialProbe.mode,
      platform: initialProbe.platform,
    };
  }
  if (!autoStartGateway) {
    fail(
      `Local discovery health is down at ${healthUrl}. Start your local discovery server, or run \`hermes gateway run --replace\` if you intentionally use the advanced Hermes path, then retry.`,
    );
  }
  console.log("discovery:bootstrap-local: starting Hermes gateway...");
  startDetached("hermes", ["gateway", "run", "--replace"]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(1000);
    const retryProbe = await probeHealth(healthUrl);
    if (retryProbe.ok) {
      return {
        ok: true,
        healthUrl,
        startedGateway: true,
        serviceName: retryProbe.serviceName,
        mode: retryProbe.mode,
        platform: retryProbe.platform,
      };
    }
  }
  fail(
    `Local discovery health still is not available at ${healthUrl}. Confirm your local discovery server is running, or verify the Hermes webhook platform is enabled if you intentionally use that path, then rerun this command.`,
  );
}

function hasNgrokConfig() {
  const result = spawnSync("ngrok", ["config", "check"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  return !result.error && result.status === 0;
}

function ensureNgrokAuth(ngrokAuthtoken) {
  if (hasNgrokConfig()) return false;
  if (!ngrokAuthtoken) {
    fail(
      `ngrok is installed but not authenticated yet. Get your token at ${ngrokTokenUrl} and rerun:\n  npm run discovery:bootstrap-local -- --ngrok-authtoken "YOUR_REAL_TOKEN"`,
    );
  }
  const result = runCommand("ngrok", ["config", "add-authtoken", ngrokAuthtoken]);
  if (result.status !== 0) {
    fail(
      `could not save the ngrok authtoken:\n${String(
        result.stderr || result.stdout || "",
      ).trim()}`,
    );
  }
  return true;
}

function normalizeNgrokPublicUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    fail("--ngrok-public-url must be a valid https:// URL");
  }
  if (url.protocol !== "https:") {
    fail("--ngrok-public-url must start with https://");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function getNgrokTunnels() {
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels");
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.tunnels) ? data.tunnels : [];
  } catch (_) {
    return [];
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
  return (
    configAddr === String(port) ||
    configAddr.endsWith(`:${port}`) ||
    configAddr.includes(`localhost:${port}`) ||
    configAddr.includes(`127.0.0.1:${port}`)
  );
}

function pickNgrokPublicUrl(tunnels, port) {
  const httpsMatches = tunnels.filter(
    (tunnel) =>
      String(tunnel && tunnel.public_url ? tunnel.public_url : "").startsWith("https://") &&
      tunnelMatchesPort(tunnel, port),
  );
  if (httpsMatches[0] && httpsMatches[0].public_url) {
    return normalizeNgrokPublicUrl(httpsMatches[0].public_url);
  }
  return "";
}

function describeNgrokTunnels(tunnels) {
  const httpsTunnels = tunnels.filter((tunnel) =>
    String(tunnel && tunnel.public_url ? tunnel.public_url : "").startsWith("https://"),
  );
  if (!httpsTunnels.length) return "";
  return httpsTunnels
    .map((tunnel) => {
      const publicUrl = String(tunnel.public_url || "");
      const addr = String(tunnel.config && tunnel.config.addr ? tunnel.config.addr : "");
      return `${publicUrl}${addr ? ` -> ${addr}` : ""}`;
    })
    .join("; ");
}

async function verifyPublicWorkerIdentity(ngrokPublicUrl) {
  const base = new URL(ngrokPublicUrl);
  base.pathname = "/health";
  base.search = "";
  base.hash = "";
  const health = await probeHealth(base.toString());
  return {
    ...health,
    healthUrl: base.toString(),
    ok: isBrowserUseDiscoveryHealth(health),
  };
}

async function ensureNgrokPublicUrl(port, explicitPublicUrl, autoStartNgrok) {
  if (explicitPublicUrl) {
    return {
      ngrokPublicUrl: normalizeNgrokPublicUrl(explicitPublicUrl),
      startedNgrok: false,
    };
  }

  const currentTunnels = await getNgrokTunnels();
  const existing = pickNgrokPublicUrl(currentTunnels, port);
  if (existing) {
    return { ngrokPublicUrl: existing, startedNgrok: false };
  }
  const existingTunnelSummary = describeNgrokTunnels(currentTunnels);
  if (existingTunnelSummary) {
    fail(
      `ngrok is running, but no https:// tunnel targets port ${port}. Detected: ${existingTunnelSummary}. Stop the wrong tunnel or start one with \`ngrok http ${port}\`.`,
    );
  }

  if (!autoStartNgrok) {
    fail(
      `No ngrok tunnel found for port ${port}. Run \`ngrok http ${port}\` and retry, or pass --ngrok-public-url.`,
    );
  }

  console.log(`discovery:bootstrap-local: starting ngrok on port ${port}...`);
  startDetached("ngrok", ["http", String(port)]);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(1000);
    const current = pickNgrokPublicUrl(await getNgrokTunnels(), port);
    if (current) {
      return { ngrokPublicUrl: current, startedNgrok: true };
    }
  }

  fail(
    `ngrok did not expose an https:// tunnel for port ${port}. Run \`ngrok http ${port}\` manually and retry.`,
  );
}

/**
 * Resolve the user's configured NAMED Cloudflare tunnel, if any. We never
 * create a named tunnel; we only read its hostname (and optional tunnel name)
 * from env or the worker env file. A named tunnel gives a STABLE public
 * hostname bound to the user's own Cloudflare domain.
 *
 * Returns { configured, hostname, tunnelName, publicUrl }.
 */
function readNamedTunnelConfig() {
  const envFile = readBrowserUseDiscoveryEnvFile();
  const fromFile = (key) =>
    envFile && envFile.parsed && envFile.parsed[key]
      ? String(envFile.parsed[key]).trim()
      : "";
  const hostname =
    String(process.env[TUNNEL_HOSTNAME_ENV_KEY] || "").trim() ||
    fromFile(TUNNEL_HOSTNAME_ENV_KEY);
  const tunnelName =
    String(process.env[TUNNEL_NAME_ENV_KEY] || "").trim() ||
    fromFile(TUNNEL_NAME_ENV_KEY);
  if (!hostname) {
    return { configured: false, hostname: "", tunnelName, publicUrl: "" };
  }
  const publicUrl = normalizeNamedTunnelUrl(hostname);
  if (!publicUrl) {
    return { configured: false, hostname: "", tunnelName, publicUrl: "" };
  }
  return { configured: true, hostname, tunnelName, publicUrl };
}

/**
 * Normalize a configured named-tunnel hostname (which may be a bare hostname or
 * a full https:// URL) into a canonical https:// origin URL. Returns "" when it
 * cannot be parsed as a valid https host.
 */
function normalizeNamedTunnelUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(candidate);
  } catch (_) {
    return "";
  }
  if (url.protocol !== "https:") return "";
  if (!url.hostname) return "";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Start a Cloudflare QUICK tunnel (anonymous, zero-signup) for the worker port
 * and poll its log file for the https://<random>.trycloudflare.com URL. Mirrors
 * how ngrok startup polls. The cloudflared process is spawned detached and
 * keeps running after bootstrap exits. Returns { publicUrl, startedTunnel }.
 */
async function ensureCloudflareQuickTunnel(port) {
  const logPath = cloudflaredQuickTunnelLogPath;
  // If a previous run already left a quick-tunnel URL in the log and the tunnel
  // is still up, we still start fresh: quick tunnels rotate and we cannot
  // reattach to an unknown PID's tunnel, so a clean start is the honest path.
  const { command, args } = buildQuickTunnelCommand(port);
  console.log(
    `discovery:bootstrap-local: starting Cloudflare quick tunnel on port ${port}...`,
  );
  startDetached(command, args, {}, { logPath });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(1000);
    let logText = "";
    try {
      logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    } catch (_) {
      logText = "";
    }
    const publicUrl = parseQuickTunnelUrl(logText);
    if (publicUrl) {
      return { publicUrl, startedTunnel: true };
    }
  }

  fail(
    `cloudflared did not expose a quick tunnel for port ${port}. Check ${logPath}, or rerun with \`--tunnel ngrok\` to use the ngrok fallback.`,
  );
}

function buildPublicTargetUrl(localWebhookUrl, ngrokPublicUrl) {
  const local = new URL(localWebhookUrl);
  const ngrok = new URL(ngrokPublicUrl);
  ngrok.pathname = local.pathname || "/";
  ngrok.search = "";
  ngrok.hash = "";
  return ngrok.toString();
}

function inferWizardProgression({
  localWebhookUrl,
  gatewayHealthy,
  ngrokRunning,
}) {
  if (!localWebhookUrl) {
    return {
      currentStepId: "bootstrap",
      nextStepId: "local_health",
      recommendedStepId: "bootstrap",
    };
  }
  if (!gatewayHealthy) {
    return {
      currentStepId: "local_health",
      nextStepId: "local_health",
      recommendedStepId: "local_health",
    };
  }
  if (!ngrokRunning) {
    return {
      currentStepId: "tunnel",
      nextStepId: "tunnel",
      recommendedStepId: "tunnel",
    };
  }
  return {
    currentStepId: "relay_deploy",
    nextStepId: "verify",
    recommendedStepId: "relay_deploy",
  };
}

function buildLocalRemediations(port) {
  const resolvedPort = String(port || "8644").trim() || "8644";
  return {
    noBootstrapFile: [
      "No local bootstrap file is available yet.",
      `Run \`npm run discovery:bootstrap-local\` on localhost, then reload the dashboard so it can read \`${defaultStateFile}\`.`,
    ].join(" "),
    gatewayNotHealthy: [
      "The local discovery server is not healthy yet.",
      "Start the browser-use worker with `npm run discovery:worker:start-local`, or run `hermes gateway run --replace` if you intentionally use the advanced Hermes path, then retry the local health check.",
    ].join(" "),
    ngrokNotAuthenticated: [
      "ngrok is installed but not authenticated.",
      `Get a token from ${ngrokTokenUrl} and run \`ngrok config add-authtoken <YOUR_NGROK_TOKEN>\`, or rerun \`npm run discovery:bootstrap-local -- --ngrok-authtoken "YOUR_REAL_TOKEN"\`.`,
    ].join(" "),
    ngrokNotRunning: [
      "ngrok is authenticated but no tunnel is running.",
      `Start it with \`ngrok http ${resolvedPort}\`, or rerun \`npm run discovery:bootstrap-local\` and let the helper reuse it.`,
    ].join(" "),
  };
}

function buildLocalBootstrapWizard(localWebhookUrl, gatewayHealthy, ngrokRunning) {
  return inferWizardProgression({
    localWebhookUrl,
    gatewayHealthy,
    ngrokRunning,
  });
}

/**
 * Build the `transport` block persisted in the bootstrap state. Captures which
 * public-URL transport bootstrap settled on, the chosen public URL, and whether
 * the transport is stable (so the keepalive can skip resync). The named-tunnel
 * name is persisted ONLY for the named transport so the tunnel autostart service
 * can rebuild `cloudflared tunnel run <name>` without re-reading env. PURE.
 */
function buildTransportState({ kind, publicUrl, tunnelName }) {
  const state = {
    kind,
    publicUrl: String(publicUrl || ""),
    stable: isStableTransport(kind),
  };
  const name = String(tunnelName || "").trim();
  if (kind === TRANSPORT_CLOUDFLARE_NAMED && name) {
    state.tunnelName = name;
  }
  return state;
}

function writeBootstrapState(stateFile, payload) {
  writeFileSync(stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  ensureNode18();
  const args = parseArgs(process.argv.slice(2));
  const enginePreference = normalizeEnginePreference(args.engine);
  ensureCommand("ngrok", ["version"]);

  const defaultPort = String(args.port || defaultWorkerPort).trim();
  if (!/^\d+$/.test(defaultPort)) {
    fail("--port must be numeric");
  }
  const corsOrigin = normalizeCorsOrigin(args.corsOrigin);
  const allowedOrigins = buildAllowedOriginsValue(corsOrigin);
  writeAllowedOriginsToEnvFile(allowedOrigins);

  const initialHealthUrl = `http://127.0.0.1:${defaultPort}/health`;
  const initialHealth = await probeHealth(initialHealthUrl);

  // Resolve the worker secret up front so both paths (already-running and
  // about-to-launch) use the same value. For Hermes/advanced paths the secret
  // is harmless to compute and gets surfaced in the bootstrap state for the
  // dashboard regardless.
  const secretResolution = resolveWebhookSecret();
  if (secretResolution.source === "generated") {
    console.log(
      `discovery:bootstrap-local: generated a new ${WEBHOOK_SECRET_ENV_KEY} and ${secretResolution.writeMode === "created" ? "created" : "updated"} ${browserUseDiscoveryEnvPath}`,
    );
  } else if (secretResolution.source === "env_file") {
    console.log(
      `discovery:bootstrap-local: reusing ${WEBHOOK_SECRET_ENV_KEY} from ${browserUseDiscoveryEnvPath}`,
    );
  } else {
    console.log(
      `discovery:bootstrap-local: reusing ${WEBHOOK_SECRET_ENV_KEY} from process env`,
    );
  }
  const webhookSecret = secretResolution.secret;

  let route = null;
  let port = defaultPort;
  let health;
  let engineKind = "browser_use_worker";

  const preferHermes =
    enginePreference === "hermes" ||
    !!args.routeName ||
    (enginePreference !== "browser_use_worker" &&
      isHermesWebhookHealth(initialHealth));

  if (preferHermes) {
    ensureCommand("hermes");
    route = ensureHermesRoute(args.routeName);
    const inferredPortFromRoute = extractPortFromUrl(route.url);
    port = String(
      args.portExplicit
        ? args.port
        : inferredPortFromRoute || args.port || defaultPort,
    ).trim();
    if (!/^\d+$/.test(port)) {
      fail("--port must be numeric");
    }
    health = await ensureGatewayHealth(port, args.autoStartGateway);
    engineKind = "hermes";
  } else {
    // Free-port coexistence: when the preferred worker port is held by a
    // foreign process (e.g. a Hermes gateway) and the user did NOT pin --port
    // explicitly, relocate the worker to the next free port instead of failing.
    // If our own worker already holds the port, reuse it. An explicit --port is
    // honored exactly with no auto-bump (keeps today's fail-on-foreign path).
    if (!args.portExplicit && !isBrowserUseDiscoveryHealth(initialHealth)) {
      const occupancy = portHasForeignListener(port);
      if (occupancy.foreign) {
        const freePort = await findAvailableWorkerPort(Number.parseInt(port, 10) + 1);
        console.log(
          `discovery:bootstrap-local: port ${port} is held by a foreign process; using free port ${freePort} for the worker instead.`,
        );
        port = String(freePort);
      }
    }
    // Always go through ensureBrowserUseWorkerHealth — it handles the
    // "already running but with wrong secret" case by killing + restarting,
    // so the dashboard's autofilled secret is guaranteed to work afterward.
    health = await ensureBrowserUseWorkerHealth(
      port,
      args.autoStartGateway,
      webhookSecret,
      corsOrigin,
      allowedOrigins,
    );
    engineKind = "browser_use_worker";
  }

  const localWebhookUrl =
    isBrowserUseDiscoveryHealth(health)
      ? `http://127.0.0.1:${port}/webhook`
      : normalizeLocalWebhookUrl(route && route.url ? route.url : "", port) ||
        `http://127.0.0.1:${port}/webhooks/${route ? route.name : "command-center-discovery"}`;
  // Choose the public-URL transport before touching ngrok. An explicit
  // --ngrok-public-url is an ngrok-path override and forces the ngrok branch.
  const namedTunnel = readNamedTunnelConfig();
  const cloudflared = args.ngrokPublicUrl
    ? { installed: false }
    : detectCloudflared();
  const transportPreference = args.ngrokPublicUrl
    ? TRANSPORT_NGROK
    : normalizeTransportPreference(args.tunnel);
  const transportKind = selectTransport({
    preference: transportPreference,
    cloudflaredInstalled: !!cloudflared.installed,
    namedTunnelConfigured: namedTunnel.configured,
    ngrokAvailable: true,
  });

  let ngrokAuthSaved = false;
  // `ngrok` keeps the same shape the rest of the pipeline expects: a public URL
  // and a startedTunnel flag. For Cloudflare transports the URL comes from
  // cloudflared instead of ngrok, but the downstream fields stay populated so
  // the dashboard + relay continue to work unchanged.
  let ngrok;
  let transportStartedTunnel = false;

  if (transportKind === TRANSPORT_CLOUDFLARE_NAMED) {
    if (!namedTunnel.configured) {
      fail(
        `--tunnel cloudflare-named requires a configured named tunnel. Set ${TUNNEL_HOSTNAME_ENV_KEY} (your stable Cloudflare hostname) in the env, or rerun with \`--tunnel auto\`.`,
      );
    }
    // The user runs their named tunnel themselves (or via the tunnel autostart
    // service). We only read its stable hostname here — never create it.
    ngrok = { ngrokPublicUrl: namedTunnel.publicUrl, startedNgrok: false };
  } else if (transportKind === TRANSPORT_CLOUDFLARE_QUICK) {
    if (!cloudflared.installed) {
      fail(
        "--tunnel cloudflare-quick requires the `cloudflared` binary on PATH. Install it (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) or rerun with `--tunnel ngrok`.",
      );
    }
    const quick = await ensureCloudflareQuickTunnel(port);
    transportStartedTunnel = quick.startedTunnel;
    ngrok = { ngrokPublicUrl: quick.publicUrl, startedNgrok: false };
  } else if (args.ngrokPublicUrl) {
    ngrok = await ensureNgrokPublicUrl(port, args.ngrokPublicUrl, false);
  } else {
    ensureCommand("ngrok", ["version"]);
    const existingNgrokPublicUrl = pickNgrokPublicUrl(await getNgrokTunnels(), port);
    if (existingNgrokPublicUrl) {
      ngrok = { ngrokPublicUrl: existingNgrokPublicUrl, startedNgrok: false };
    } else {
      ngrokAuthSaved = ensureNgrokAuth(args.ngrokAuthtoken);
      ngrok = await ensureNgrokPublicUrl(port, "", args.autoStartNgrok);
    }
  }
  const transportStable = isStableTransport(transportKind);
  const publicTargetUrl = buildPublicTargetUrl(localWebhookUrl, ngrok.ngrokPublicUrl);
  let publicHealth = null;
  // A named tunnel may route through the user's Cloudflare edge to the worker;
  // verifying public /health for it is still valid (it proxies to the same
  // local port), but we skip the hard fail for named tunnels since edge config
  // is the user's responsibility and a transient edge delay should not abort
  // the bootstrap that already verified local health.
  if (engineKind === "browser_use_worker" && transportKind !== TRANSPORT_CLOUDFLARE_NAMED) {
    publicHealth = await verifyPublicWorkerIdentity(ngrok.ngrokPublicUrl);
    if (!publicHealth.ok) {
      const detail = [
        publicHealth.statusCode ? `HTTP ${publicHealth.statusCode}` : "",
        publicHealth.serviceName ? `service=${publicHealth.serviceName}` : "",
        publicHealth.workerStatus ? `status=${publicHealth.workerStatus}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      const tunnelLabel =
        transportKind === TRANSPORT_CLOUDFLARE_QUICK
          ? `The Cloudflare quick tunnel ${ngrok.ngrokPublicUrl}`
          : `The ngrok tunnel ${ngrok.ngrokPublicUrl}`;
      const remedy =
        transportKind === TRANSPORT_CLOUDFLARE_QUICK
          ? `Confirm cloudflared is forwarding to port ${port} before saving relay state.`
          : `Confirm \`ngrok http ${port}\` targets the worker port before saving relay state.`;
      fail(
        `${tunnelLabel} did not expose the expected browser-use discovery worker at /health${detail ? ` (${detail})` : ""}. ${remedy}`,
      );
    }
  }
  const sheetId = parseGoogleSheetId(args.sheetId) || readSheetIdFromConfig();
  const existingBootstrapState = readExistingBootstrapState(args.stateFile);
  const workerName = buildSuggestedWorkerName(
    publicTargetUrl,
    args.workerName,
    existingBootstrapState && existingBootstrapState.workerName,
  );
  const cloudflareDeployCommand = buildCloudflareRelayDeployCommand(
    publicTargetUrl,
    corsOrigin,
    workerName,
    sheetId,
  );

  const payload = {
    schemaVersion: 1,
    bootstrapVersion: 2,
    generatedAt: new Date().toISOString(),
    repoRoot,
    routeName:
      route && route.name
        ? route.name
        : engineKind === "browser_use_worker"
          ? "browser-use-discovery"
          : "webhook",
    localWebhookUrl,
    localHealthUrl: health.healthUrl,
    localPort: port,
    tunnelPublicUrl: ngrok.ngrokPublicUrl,
    ngrokPublicUrl: ngrok.ngrokPublicUrl,
    publicTargetUrl,
    transport: buildTransportState({
      kind: transportKind,
      publicUrl: ngrok.ngrokPublicUrl,
      tunnelName: namedTunnel.tunnelName,
    }),
    corsOrigin,
    sheetId,
    workerName,
    cloudflareDeployCommand,
    ngrokTokenUrl,
    // Browser-use worker fail-closes on empty secret. Surface the resolved
    // secret so the dashboard can autofill the Discovery drawer webhook secret
    // and the user never needs to copy/paste it. Only meaningful for the
    // browser-use worker engine; harmless for the Hermes path.
    webhookSecret: engineKind === "browser_use_worker" ? webhookSecret : "",
    webhookSecretSource:
      engineKind === "browser_use_worker" ? secretResolution.source : "",
    diagnostics: {
      gatewayHealthy: true,
      gatewayStarted: !!health.startedGateway,
      healthProbeOk: true,
      engineKind,
      engineLabel:
        engineKind === "browser_use_worker"
          ? "Browser-use worker"
          : "Hermes route",
      localService: health.serviceName || "",
      localMode: health.mode || "",
      localPlatform: health.platform || "",
      ngrokAuthenticated: !!(ngrokAuthSaved || hasNgrokConfig()),
      ngrokConfigured: hasNgrokConfig(),
      ngrokRunning: !!ngrok.ngrokPublicUrl,
      ngrokDetected: !!ngrok.ngrokPublicUrl,
      localBootstrapReadable: true,
      localWebhookUrl,
      localHealthUrl: health.healthUrl,
      localPort: port,
      publicHealthUrl: publicHealth && publicHealth.healthUrl ? publicHealth.healthUrl : "",
      workerLogPath:
        engineKind === "browser_use_worker" ? health.workerLogPath || "" : "",
    },
    wizard: {
      version: 1,
      stepIds: [
        "path_select",
        "detect",
        "bootstrap",
        "local_health",
        "tunnel",
        "relay_deploy",
        "verify",
        "ready",
      ],
      actionIds: [
        "local_bootstrap_refresh",
        "local_health_check",
        "local_tunnel_detect",
        "local_relay_apply",
        "local_verify_end_to_end",
      ],
      ...buildLocalBootstrapWizard(
        localWebhookUrl,
        true,
        !!ngrok.ngrokPublicUrl,
      ),
    },
    remediations: buildLocalRemediations(port),
  };

  writeBootstrapState(args.stateFile, payload);

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...payload,
          webhookSecret: payload.webhookSecret ? "[redacted]" : "",
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  console.log("");
  console.log("Local discovery bootstrap ready.");
  console.log(
    `- Local engine: ${
      engineKind === "browser_use_worker"
        ? "Browser-use worker"
        : "Hermes route"
    }`,
  );
  console.log(`- Local service: ${health.serviceName || "unknown"}`);
  if (route) {
    console.log(`- Hermes route: ${route.name}${route.created ? " (created)" : ""}`);
  }
  console.log(`- Local webhook: ${localWebhookUrl}`);
  console.log(`- Health: ${health.healthUrl}`);
  if (engineKind === "browser_use_worker") {
    const sourceLabel =
      secretResolution.source === "generated"
        ? `generated and saved to ${browserUseDiscoveryEnvPath}`
        : secretResolution.source === "env_file"
          ? `loaded from ${browserUseDiscoveryEnvPath}`
          : "loaded from process env";
    console.log(`- Webhook secret: ${sourceLabel} (dashboard will autofill)`);
    console.log(`- Worker log: ${health.workerLogPath || browserUseDiscoveryWorkerLogPath}`);
    if (health.secretRestart) {
      console.log("- Worker restart: kicked old worker (mismatched secret)");
    }
  }
  console.log(`- ngrok public URL: ${ngrok.ngrokPublicUrl}${ngrok.startedNgrok ? " (started)" : ""}`);
  if (ngrokAuthSaved) {
    console.log("- ngrok auth: authtoken saved to local ngrok config");
  }
  if (health.startedGateway) {
    console.log(
      engineKind === "browser_use_worker"
        ? "- Browser-use worker: started in the background"
        : "- Hermes gateway: started in the background",
    );
  }
  console.log(`- Worker TARGET_URL: ${publicTargetUrl}`);
  console.log(`- Local state file: ${args.stateFile}`);
  console.log("");
  console.log("Next steps:");
  console.log(`1. Reload JobBored on localhost and open Settings -> Local worker + ngrok. It should autofill from ${args.stateFile}.`);
  console.log("2. Click Open relay steps.");
  console.log("3. Run this Cloudflare command:");
  console.log(`   ${cloudflareDeployCommand}`);
  console.log("4. Paste the final workers.dev URL into Discovery webhook URL.");

  // Layer 5 Tier 1 onboarding nudge. When SERPAPI_API_KEY is unset, the
  // discovery worker falls back to Gemini-grounded search + browser-use —
  // which works but yields far fewer matches per run. Most new users miss
  // this because the lane skips silently on an empty key. Emit a visible
  // "recommended next step" hint at the end of bootstrap so it's the last
  // thing they see before running discovery for the first time.
  const envSnapshot = readBrowserUseDiscoveryEnvFile();
  const serpApiKey =
    (envSnapshot && envSnapshot.parsed && envSnapshot.parsed.SERPAPI_API_KEY) ||
    process.env.SERPAPI_API_KEY ||
    "";
  if (!String(serpApiKey).trim()) {
    console.log("");
    console.log(
      "⚡ RECOMMENDED — enable the SerpApi Google Jobs source for high-quality matches",
    );
    console.log(
      "  Without it, the worker runs but produces far fewer matches because it",
    );
    console.log(
      "  falls back to scraping individual career pages that often block scrapers.",
    );
    console.log("  Free tier = 100 searches/month (~20 daily discovery runs).");
    console.log("");
    console.log(
      "  a. Sign up: https://serpapi.com/users/sign_up",
    );
    console.log(
      "  b. Copy your key: https://serpapi.com/manage-api-key",
    );
    console.log(
      `  c. Add to ${browserUseDiscoveryEnvPath}:`,
    );
    console.log("       SERPAPI_API_KEY=your-key-here");
    console.log(
      "  d. Restart the worker: npm run discovery:worker:start-local",
    );
    console.log("");
    console.log(
      "  Full walkthrough: SETUP.md -> Recommended: enable the SerpApi Google Jobs source",
    );
  } else {
    console.log("");
    console.log(
      "✓ SerpApi Google Jobs key detected — high-recall discovery lane is active.",
    );
  }
}

// Only run the CLI entry point when this file is invoked directly
// (`node scripts/bootstrap-local-discovery.mjs`). When imported from a test,
// the helpers below should be testable without the side effects of main().
const __invokedAsCli =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (__invokedAsCli) {
  main().catch((err) => {
    fail(err && err.message ? err.message : String(err));
  });
}

// Test-only exports. Keep the surface narrow — these are not a stable public
// API; they exist so tests can exercise the secret-resolution path without
// running the full bootstrap pipeline.
export {
  parseEnvFile,
  resolveWebhookSecret,
  generateWebhookSecret,
  writeWebhookSecretToEnvFile,
  browserUseDiscoveryEnvPath,
  WEBHOOK_SECRET_ENV_KEY,
  pickNgrokPublicUrl,
  tunnelMatchesPort,
  isBrowserUseDiscoveryHealth,
  isTcpPortFree,
  findAvailableWorkerPort,
  portHasForeignListener,
  buildTransportState,
};
