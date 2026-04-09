#!/usr/bin/env node
/**
 * Bootstrap the local real-discovery path for JobBored:
 * - ensure a Hermes webhook route exists
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
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const defaultStateFile = join(repoRoot, "discovery-local-bootstrap.json");
const ngrokTokenUrl = "https://dashboard.ngrok.com/get-started/your-authtoken";
const defaultCorsOrigin = "http://localhost:8080";

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`bootstrap-local-discovery

Usage:
  npm run discovery:bootstrap-local
  npm run discovery:bootstrap-local -- --ngrok-authtoken "..."
  NGROK_AUTHTOKEN=... npm run discovery:bootstrap-local

Options:
  --route-name         Reuse or create this Hermes route name.
  --port               Local webhook port. Defaults to 8644 unless an existing route says otherwise.
  --cors-origin        Suggested browser origin for the Cloudflare Worker command. Default: ${defaultCorsOrigin}
  --worker-name        Override the suggested Cloudflare Worker name.
  --sheet-id           Optional. Included in the suggested Cloudflare relay deploy command.
  --ngrok-authtoken    Optional. Saves ngrok auth if config is missing.
  --ngrok-public-url   Optional. Skip ngrok startup and use this https:// public URL instead.
  --state-file         Where to write the local bootstrap JSON. Default: ${defaultStateFile}
  --no-start-gateway   Do not auto-start Hermes if /health is down.
  --no-start-ngrok     Do not auto-start ngrok if no tunnel is running.
  --json               Print machine-readable JSON.
  --help               Show this message.

What it does:
  1. Reuses or creates a Hermes webhook route for Command Center discovery.
  2. Verifies the local webhook health endpoint.
  3. Reuses or starts an ngrok tunnel for the webhook port.
  4. Writes a local JSON file that JobBored reads on localhost to autofill Settings -> Hermes + ngrok.
`);
  process.exit(code);
}

function fail(message, code = 1) {
  console.error(`discovery:bootstrap-local: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    routeName: "",
    port: "",
    portExplicit: false,
    corsOrigin: defaultCorsOrigin,
    workerName: "",
    sheetId: "",
    ngrokAuthtoken: "",
    ngrokPublicUrl: "",
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
      arg === "--route-name" ||
      arg === "--port" ||
      arg === "--cors-origin" ||
      arg === "--worker-name" ||
      arg === "--sheet-id" ||
      arg === "--ngrok-authtoken" ||
      arg === "--ngrok-public-url" ||
      arg === "--state-file"
    ) {
      if (!next || next.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      if (arg === "--route-name") out.routeName = String(next).trim();
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
  return out;
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

function buildSuggestedWorkerName(targetUrl, explicitWorkerName) {
  if (explicitWorkerName) {
    return sanitizeWorkerName(explicitWorkerName) || "jobbored-discovery-relay";
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
    const res = await fetch(healthUrl, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    const body = data && typeof data === "object" ? data : {};
    return {
      ok: !!res.ok && String(body.status || "").toLowerCase() === "ok",
      serviceName: String(body.service || "").trim(),
      mode: String(body.mode || "").trim(),
    };
  } catch (_) {
    return {
      ok: false,
      serviceName: "",
      mode: "",
    };
  }
}

function isBrowserUseDiscoveryHealth(healthProbe) {
  return (
    !!healthProbe &&
    !!healthProbe.ok &&
    String(healthProbe.serviceName || "").toLowerCase() ===
      "browser-use-discovery-worker"
  );
}

function startDetached(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return child.pid || 0;
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
    };
  }
  if (!autoStartGateway) {
    fail(
      `Local discovery health is down at ${healthUrl}. Start your local discovery server, or run \`hermes gateway run --replace\` if you are still using the Hermes path, then retry.`,
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
      };
    }
  }
  fail(
    `Local discovery health still is not available at ${healthUrl}. Confirm your local discovery server is running, or verify the Hermes webhook platform is enabled if you still use that path, then rerun this command.`,
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
  const anyHttps = tunnels.find((tunnel) =>
    String(tunnel && tunnel.public_url ? tunnel.public_url : "").startsWith("https://"),
  );
  return anyHttps && anyHttps.public_url
    ? normalizeNgrokPublicUrl(anyHttps.public_url)
    : "";
}

async function ensureNgrokPublicUrl(port, explicitPublicUrl, autoStartNgrok) {
  if (explicitPublicUrl) {
    return {
      ngrokPublicUrl: normalizeNgrokPublicUrl(explicitPublicUrl),
      startedNgrok: false,
    };
  }

  const existing = pickNgrokPublicUrl(await getNgrokTunnels(), port);
  if (existing) {
    return { ngrokPublicUrl: existing, startedNgrok: false };
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
      "Start your local discovery server, or run `hermes gateway run --replace` if you are still on the Hermes path, then retry the local health check.",
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

function writeBootstrapState(stateFile, payload) {
  writeFileSync(stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  ensureNode18();
  const args = parseArgs(process.argv.slice(2));
  ensureCommand("hermes");
  ensureCommand("ngrok", ["version"]);

  const defaultPort = String(args.port || "8644").trim();
  if (!/^\d+$/.test(defaultPort)) {
    fail("--port must be numeric");
  }

  const initialHealthUrl = `http://127.0.0.1:${defaultPort}/health`;
  const initialHealth = await probeHealth(initialHealthUrl);

  let route = null;
  let port = defaultPort;
  let health;

  if (isBrowserUseDiscoveryHealth(initialHealth)) {
    health = {
      ok: true,
      healthUrl: initialHealthUrl,
      startedGateway: false,
      serviceName: initialHealth.serviceName,
      mode: initialHealth.mode,
    };
  } else {
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
  }

  const localWebhookUrl =
    isBrowserUseDiscoveryHealth(health)
      ? `http://127.0.0.1:${port}/webhook`
      : normalizeLocalWebhookUrl(route && route.url ? route.url : "", port) ||
        `http://127.0.0.1:${port}/webhooks/${route ? route.name : "command-center-discovery"}`;
  let ngrokAuthSaved = false;
  let ngrok;
  if (args.ngrokPublicUrl) {
    ngrok = await ensureNgrokPublicUrl(port, args.ngrokPublicUrl, false);
  } else {
    const existingNgrokPublicUrl = pickNgrokPublicUrl(await getNgrokTunnels(), port);
    if (existingNgrokPublicUrl) {
      ngrok = { ngrokPublicUrl: existingNgrokPublicUrl, startedNgrok: false };
    } else {
      ngrokAuthSaved = ensureNgrokAuth(args.ngrokAuthtoken);
      ngrok = await ensureNgrokPublicUrl(port, "", args.autoStartNgrok);
    }
  }
  const publicTargetUrl = buildPublicTargetUrl(localWebhookUrl, ngrok.ngrokPublicUrl);
  const corsOrigin = normalizeCorsOrigin(args.corsOrigin);
  const sheetId = parseGoogleSheetId(args.sheetId) || readSheetIdFromConfig();
  const workerName = buildSuggestedWorkerName(publicTargetUrl, args.workerName);
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
    routeName: route ? route.name : "webhook",
    localWebhookUrl,
    localHealthUrl: health.healthUrl,
    localPort: port,
    tunnelPublicUrl: ngrok.ngrokPublicUrl,
    ngrokPublicUrl: ngrok.ngrokPublicUrl,
    publicTargetUrl,
    corsOrigin,
    sheetId,
    workerName,
    cloudflareDeployCommand,
    ngrokTokenUrl,
    diagnostics: {
      gatewayHealthy: true,
      gatewayStarted: !!health.startedGateway,
      healthProbeOk: true,
      localService: health.serviceName || "",
      localMode: health.mode || "",
      ngrokAuthenticated: !!(ngrokAuthSaved || hasNgrokConfig()),
      ngrokConfigured: hasNgrokConfig(),
      ngrokRunning: !!ngrok.ngrokPublicUrl,
      ngrokDetected: !!ngrok.ngrokPublicUrl,
      localBootstrapReadable: true,
      localWebhookUrl,
      localHealthUrl: health.healthUrl,
      localPort: port,
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
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  console.log("");
  console.log("Local discovery bootstrap ready.");
  console.log(`- Local service: ${health.serviceName || "unknown"}`);
  if (route) {
    console.log(`- Hermes route: ${route.name}${route.created ? " (created)" : ""}`);
  }
  console.log(`- Local webhook: ${localWebhookUrl}`);
  console.log(`- Health: ${health.healthUrl}`);
  console.log(`- ngrok public URL: ${ngrok.ngrokPublicUrl}${ngrok.startedNgrok ? " (started)" : ""}`);
  if (ngrokAuthSaved) {
    console.log("- ngrok auth: authtoken saved to local ngrok config");
  }
  if (health.startedGateway) {
    console.log("- Hermes gateway: started in the background");
  }
  console.log(`- Worker TARGET_URL: ${publicTargetUrl}`);
  console.log(`- Local state file: ${args.stateFile}`);
  console.log("");
  console.log("Next steps:");
  console.log(`1. Reload JobBored on localhost and open Settings -> Hermes + ngrok. It should autofill from ${args.stateFile}.`);
  console.log("2. Click Open relay steps.");
  console.log("3. Run this Cloudflare command:");
  console.log(`   ${cloudflareDeployCommand}`);
  console.log("4. Paste the final workers.dev URL into Discovery webhook URL.");
}

main().catch((err) => {
  fail(err && err.message ? err.message : String(err));
});
