#!/usr/bin/env node
/**
 * Deploy the repo's Cloudflare Worker relay with as little manual work as possible.
 *
 * Usage:
 *   npm run cloudflare-relay:deploy -- --target-url "https://script.google.com/macros/s/.../exec"
 *   npm run cloudflare-relay:deploy -- --target-url "..." --cors-origin "https://your-site.example" --worker-name "jobbored-discovery-relay-abc123"
 *
 * Auth:
 *   - `npx wrangler login`, or
 *   - `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
 */
import { spawnSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const templateDir = join(repoRoot, "templates", "cloudflare-worker");
const workerTemplatePath = join(templateDir, "worker.js");
const wranglerTemplatePath = join(templateDir, "wrangler.toml");
const cloudflareApiBase = "https://api.cloudflare.com/client/v4";

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`deploy-cloudflare-relay

Usage:
  # Run from the Job-Bored repo root
  npm run cloudflare-relay:deploy -- --target-url "https://script.google.com/macros/s/.../exec"
  npm run cloudflare-relay:deploy -- --target-url "..." --cors-origin "https://your-site.example"
  npm run cloudflare-relay:deploy -- --target-url "..." --worker-name "jobbored-discovery-relay-abc123"
  npm run cloudflare-relay:deploy -- --target-url "..." --workers-subdomain "your-account-subdomain"

Options:
  --target-url     Required. Public HTTPS downstream webhook URL.
  --cors-origin    Optional. Exact browser origin for CORS. Defaults to "*" if omitted.
  --worker-name    Optional. Cloudflare Worker name. Defaults to a stable JobBored relay name.
  --account-id     Optional. Cloudflare account id. Otherwise uses CLOUDFLARE_ACCOUNT_ID or wrangler whoami.
  --workers-subdomain Optional. Override the account-level workers.dev subdomain to create when using API-token auth.
  --sheet-id       Optional. When provided, ALSO uploaded as the Worker's REFRESH_SHEET_ID secret so the
                   daily cron knows which sheet's worker-config to refresh. Included in the final
                   printed verify command either way.
  --cron           Optional. Cron expression for the daily refresh trigger. Defaults to "0 8 * * *"
                   (08:00 UTC daily). The Worker's scheduled() handler POSTs {mode:"refresh"} to
                   <TARGET_URL origin>/discovery-profile at each fire.
  --discovery-secret Optional. Uploaded as the Worker's DISCOVERY_SECRET. The relay
                   then injects it as x-discovery-secret on the upstream POST.
                   Falls back to DISCOVERY_WEBHOOK_SECRET / BROWSER_USE_DISCOVERY_WEBHOOK_SECRET env.
  --no-auto-login  Do not launch \`wrangler login\` automatically when auth is missing.
  --no-verify      Do not run the webhook verification step automatically after deploy.
  --json           Print machine-readable JSON on success.
  --help           Show this message.

Auth:
  - Run: npx wrangler login
  - Or set both: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
  - For fully non-interactive first-time setup, add CLOUDFLARE_API_TOKEN. The helper will reuse your existing workers.dev subdomain or create one automatically.
  - Optional override: set CLOUDFLARE_WORKERS_SUBDOMAIN or pass --workers-subdomain
  - For the dashboard/browser path, use the open workers.dev URL and keep Cloudflare Access disabled on it
`);
  process.exit(code);
}

function fail(message, code = 1) {
  console.error(`cloudflare-relay: ${message}`);
  process.exit(code);
}

const DEFAULT_CRON = "0 8 * * *";
// Five space-separated fields, each either a literal or a glob/range/step.
// Keeps the worker from being handed a malformed crontab that silently
// disables the scheduled() handler.
const CRON_FIELD_RE = /^(\*|\?|[0-9A-Za-z*/,\-]+)$/;

function validateCronExpression(raw) {
  const value = String(raw || "").trim();
  if (!value) return DEFAULT_CRON;
  const fields = value.split(/\s+/);
  if (fields.length !== 5) {
    fail(
      `--cron must be a 5-field cron expression (minute hour day-of-month month day-of-week). Got ${fields.length} fields.`,
    );
  }
  for (const field of fields) {
    if (!CRON_FIELD_RE.test(field)) {
      fail(`--cron field "${field}" contains unsupported characters.`);
    }
  }
  return value;
}

function parseArgs(argv) {
  const out = {
    targetUrl: "",
    corsOrigin: "",
    workerName: "",
    accountId: "",
    workersSubdomain: "",
    sheetId: "",
    discoverySecret: "",
    cron: DEFAULT_CRON,
    autoLogin: true,
    autoVerify: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") printUsage(0);
    if (arg === "--no-auto-login") {
      out.autoLogin = false;
      continue;
    }
    if (arg === "--no-verify") {
      out.autoVerify = false;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const next = argv[i + 1];
    if (
      arg === "--target-url" ||
      arg === "--cors-origin" ||
      arg === "--worker-name" ||
      arg === "--account-id" ||
      arg === "--workers-subdomain" ||
      arg === "--sheet-id" ||
      arg === "--discovery-secret" ||
      arg === "--cron"
    ) {
      if (!next || next.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      if (arg === "--target-url") out.targetUrl = next;
      else if (arg === "--cors-origin") out.corsOrigin = next;
      else if (arg === "--worker-name") out.workerName = next;
      else if (arg === "--account-id") out.accountId = next;
      else if (arg === "--workers-subdomain") out.workersSubdomain = next;
      else if (arg === "--sheet-id") out.sheetId = next;
      else if (arg === "--discovery-secret") out.discoverySecret = next;
      else if (arg === "--cron") out.cron = next;
      i += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  if (!out.discoverySecret) {
    out.discoverySecret =
      process.env.DISCOVERY_WEBHOOK_SECRET ||
      process.env.BROWSER_USE_DISCOVERY_WEBHOOK_SECRET ||
      "";
  }
  out.cron = validateCronExpression(out.cron);
  return out;
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
    const parsed = new URL(targetUrl);
    const scriptId = parsed.pathname.match(/\/macros\/s\/([^/]+)/i);
    if (scriptId && scriptId[1]) {
      return scriptId[1].slice(-6).toLowerCase();
    }
    return parsed.hostname.replace(/[^a-z0-9]+/gi, "-").slice(0, 10);
  } catch (_) {
    return "";
  }
}

function normalizeTargetUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch (_) {
    fail("--target-url must be a valid https:// URL");
  }
  if (url.protocol !== "https:") {
    fail("--target-url must start with https://");
  }
  return url.toString();
}

function isLocalOnlyHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

function classifyTargetUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) {
    return {
      kind: "missing",
      ok: false,
      detail: "No downstream TARGET_URL was provided.",
    };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return {
      kind: "invalid",
      ok: false,
      detail: "--target-url must be a valid URL.",
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      kind: "invalid",
      ok: false,
      detail: "--target-url must start with https://",
    };
  }
  if (isLocalOnlyHost(parsed.hostname)) {
    return {
      kind: "local_only",
      ok: false,
      detail:
        "TARGET_URL must be public. A localhost or private-network URL cannot be reached from Cloudflare.",
    };
  }
  if (/\.workers\.dev$/i.test(parsed.hostname) || /(^|\.)cloudflareworkers\.com$/i.test(parsed.hostname)) {
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (/\/forward$/i.test(pathname)) {
      return {
        kind: "worker_forward",
        ok: false,
        detail:
          "TARGET_URL must be the downstream webhook. Use the open workers.dev URL in the dashboard, not /forward.",
      };
    }
    return {
      kind: "worker_open",
      ok: false,
      detail:
        "TARGET_URL should be the downstream webhook, not a browser-facing workers.dev URL. Save the open Worker URL in Command Center instead.",
    };
  }
  if (
    /(^|\.)script\.google\.com$/i.test(parsed.hostname) &&
    /\/macros\/s\/[^/]+\/(?:exec|dev)\/?$/i.test(parsed.pathname)
  ) {
    return {
      kind: "apps_script_exec",
      ok: true,
      detail: "",
    };
  }
  return {
    kind: "generic_https",
    ok: true,
    detail: "",
  };
}

function describeTargetUrlProblem(targetUrl) {
  const classification = classifyTargetUrl(targetUrl);
  if (classification.ok) return null;
  switch (classification.kind) {
    case "local_only":
      return "The target URL is local-only. Use a public HTTPS downstream webhook instead.";
    case "worker_forward":
      return "The target URL is a workers.dev /forward URL. Use the downstream webhook as TARGET_URL and keep the open Worker URL for the dashboard.";
    case "worker_open":
      return "The target URL is a workers.dev URL. TARGET_URL should be the downstream webhook, not the browser-facing Worker URL.";
    case "invalid":
      return classification.detail;
    default:
      return classification.detail || "The target URL is invalid.";
  }
}

function normalizeCorsOrigin(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    fail("--cors-origin must be a valid origin like https://your-site.example");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail("--cors-origin must use http:// or https://");
  }
  return url.origin;
}

function buildAuthGuidanceMessage({ autoLogin, accountId, apiToken }) {
  if (apiToken && accountId) {
    return {
      mode: "api-token",
      detail: "Cloudflare API token and account id are present.",
      steps: [],
    };
  }

  if (autoLogin) {
    return {
      mode: "browser-login",
      detail:
        "Using the browser-login path. The helper will try `wrangler login` in an interactive terminal if Wrangler still needs to finish sign-in.",
      steps: [
        "Finish the browser login prompt if Wrangler opens one.",
        "If that does not work, rerun with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.",
      ],
    };
  }

  return {
    mode: "manual-login",
    detail:
      "Cloudflare auth is missing. Run `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.",
    steps: [
      "Run `npx wrangler login` in an interactive terminal.",
      "Or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for a non-interactive path.",
    ],
  };
}

function buildSubdomainGuidanceMessage({ workersSubdomain, apiToken }) {
  if (workersSubdomain) {
    return {
      detail: `Using workers.dev subdomain "${workersSubdomain}".`,
      steps: [],
      kind: "ready",
    };
  }
  return {
    detail: apiToken
      ? "The helper can reuse or create a workers.dev subdomain automatically."
      : "Wrangler may ask you to choose a workers.dev subdomain once in the terminal.",
    steps: apiToken
      ? ["Let the helper reuse or create the account subdomain automatically."]
      : ["If prompted, choose a workers.dev subdomain once in the terminal."],
    kind: apiToken ? "needs_creation" : "needs_prompt",
  };
}

function normalizeWorkersSubdomain(raw) {
  const value = sanitizeWorkerName(raw);
  if (!value) return "";
  if (value.length < 3) {
    fail("--workers-subdomain must be at least 3 characters after sanitizing");
  }
  return value;
}

function getCompatibilityDate() {
  if (!existsSync(wranglerTemplatePath)) return "2024-01-01";
  const text = readFileSync(wranglerTemplatePath, "utf8");
  const match = text.match(/compatibility_date\s*=\s*"([^"]+)"/);
  return match && match[1] ? match[1] : "2024-01-01";
}

function parseWranglerWhoAmI() {
  const result = spawnSync("npx", ["--yes", "wrangler", "whoami", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      WRANGLER_SEND_METRICS: "false",
    },
  });
  if (result.status !== 0) {
    return null;
  }
  try {
    return JSON.parse(String(result.stdout || "").trim());
  } catch (_) {
    return null;
  }
}

function tryAutoLogin() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  console.log(
    "cloudflare-relay: Cloudflare auth missing. Opening `wrangler login` in your browser...",
  );
  const result = spawnSync("npx", ["--yes", "wrangler", "login"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      WRANGLER_SEND_METRICS: "false",
    },
  });
  return result.status === 0;
}

function resolveAccountId(explicitAccountId, autoLogin) {
  const envAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  if (explicitAccountId) return explicitAccountId;
  if (envAccountId) return envAccountId;

  let whoami = parseWranglerWhoAmI();
  if (!whoami && autoLogin) {
    const loggedIn = tryAutoLogin();
    if (loggedIn) {
      whoami = parseWranglerWhoAmI();
    }
  }
  if (!whoami) {
    fail(
      autoLogin
        ? "not authenticated. Automatic `wrangler login` was unavailable or did not finish successfully. Run `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`."
        : "not authenticated. Run `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.",
    );
  }

  const accounts = Array.isArray(whoami.accounts) ? whoami.accounts : [];
  if (accounts.length === 1 && accounts[0] && accounts[0].id) {
    return String(accounts[0].id);
  }
  if (accounts.length > 1) {
    const list = accounts
      .map((account) => `${account.name || "Unnamed"} (${account.id || "no-id"})`)
      .join(", ");
    fail(
      `multiple Cloudflare accounts detected. Re-run with --account-id or set CLOUDFLARE_ACCOUNT_ID. Accounts: ${list}`,
    );
  }
  fail(
    "could not determine Cloudflare account id. Set CLOUDFLARE_ACCOUNT_ID or re-run with --account-id.",
  );
}

function getCloudflareApiToken() {
  return String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
}

function isWorkersSubdomainConflict(status, message) {
  if (status === 409) return true;
  const lowered = String(message || "").toLowerCase();
  return (
    lowered.includes("already exists") ||
    lowered.includes("already taken") ||
    lowered.includes("has already been taken") ||
    lowered.includes("not available") ||
    lowered.includes("unavailable") ||
    lowered.includes("conflict")
  );
}

function buildWorkersSubdomainCandidates(explicitSubdomain, workerName, accountId) {
  const found = new Set();
  const push = (value) => {
    const normalized = normalizeWorkersSubdomain(value);
    if (normalized) found.add(normalized);
  };
  push(explicitSubdomain);
  push(workerName);
  const shortAccountId = String(accountId || "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase()
    .slice(-6);
  if (shortAccountId) {
    push(`${workerName}-${shortAccountId}`);
    push(`jobbored-${shortAccountId}`);
  }
  push("jobbored-relay");
  return [...found];
}

async function callCloudflareApi(accountId, apiToken, method, path, body) {
  const response = await fetch(`${cloudflareApiBase}/accounts/${accountId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    payload = null;
  }

  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const errorMessage =
    errors
      .map((error) => String(error && error.message ? error.message : "").trim())
      .filter(Boolean)
      .join("; ") ||
    rawText.trim() ||
    `HTTP ${response.status}`;

  return {
    ok: response.ok && (!payload || payload.success !== false),
    status: response.status,
    payload,
    errorMessage,
  };
}

async function getWorkersSubdomain(accountId, apiToken) {
  const result = await callCloudflareApi(
    accountId,
    apiToken,
    "GET",
    "/workers/subdomain",
  );
  if (result.ok) {
    return String(result.payload?.result?.subdomain || "").trim().toLowerCase();
  }
  if (result.status === 404) {
    return "";
  }
  fail(`Cloudflare API could not read your workers.dev subdomain: ${result.errorMessage}`);
}

async function createWorkersSubdomain(accountId, apiToken, subdomain) {
  const result = await callCloudflareApi(
    accountId,
    apiToken,
    "PUT",
    "/workers/subdomain",
    { subdomain },
  );
  if (result.ok) {
    return {
      ok: true,
      subdomain: String(result.payload?.result?.subdomain || subdomain)
        .trim()
        .toLowerCase(),
      errorMessage: "",
    };
  }
  return {
    ok: false,
    subdomain: "",
    conflict: isWorkersSubdomainConflict(result.status, result.errorMessage),
    errorMessage: result.errorMessage,
  };
}

async function ensureWorkersSubdomain(
  accountId,
  apiToken,
  explicitSubdomain,
  workerName,
) {
  if (!apiToken) return "";

  const existing = await getWorkersSubdomain(accountId, apiToken);
  if (existing) {
    console.log(
      `cloudflare-relay: using existing workers.dev subdomain "${existing}"...`,
    );
    return existing;
  }

  const candidates = buildWorkersSubdomainCandidates(
    explicitSubdomain,
    workerName,
    accountId,
  );
  for (const candidate of candidates) {
    console.log(
      `cloudflare-relay: creating workers.dev subdomain "${candidate}"...`,
    );
    const created = await createWorkersSubdomain(accountId, apiToken, candidate);
    if (created.ok) {
      return created.subdomain;
    }
    if (created.conflict) {
      continue;
    }
    fail(
      `Cloudflare could not create a workers.dev subdomain automatically: ${created.errorMessage}`,
    );
  }

  fail(
    explicitSubdomain
      ? `workers.dev subdomain "${explicitSubdomain}" was unavailable. Pick another one with --workers-subdomain and retry.`
      : "Cloudflare could not auto-pick an available workers.dev subdomain. Re-run with --workers-subdomain to choose one explicitly.",
  );
}

function collectWorkersDevUrls(value, found) {
  if (value == null) return;
  if (typeof value === "string") {
    const matches = value.match(/https:\/\/[^\s"']+\.workers\.dev\/?/gi);
    if (matches) {
      for (const match of matches) found.add(match.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWorkersDevUrls(item, found);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectWorkersDevUrls(item, found);
    }
  }
}

function parseUrlsFromJsonLines(filePath) {
  const found = new Set();
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      collectWorkersDevUrls(JSON.parse(trimmed), found);
    } catch (_) {
      collectWorkersDevUrls(trimmed, found);
    }
  }
  return [...found];
}

function runWrangler(args, options = {}) {
  const env = {
    ...process.env,
    FORCE_COLOR: "0",
    WRANGLER_SEND_METRICS: "false",
  };
  if (options.outputFile) {
    env.WRANGLER_OUTPUT_FILE_PATH = options.outputFile;
  }
  const result = spawnSync("npx", ["--yes", "wrangler", ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env,
    input: options.input,
    stdio:
      options.stdio ||
      (options.input != null ? ["pipe", "inherit", "inherit"] : "inherit"),
  });
  if (typeof result.status === "number" && result.status === 0) {
    return result;
  }
  fail(options.failureMessage || `wrangler ${args.join(" ")} failed`);
}

function runVerify(workerUrl, sheetId) {
  if (!workerUrl || !sheetId) return null;
  console.log("");
  console.log("cloudflare-relay: verifying deployed Worker...");
  const result = spawnSync(
    "node",
    [
      join("scripts", "verify-discovery-webhook.mjs"),
      "--url",
      workerUrl,
      "--sheet-id",
      sheetId,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    },
  );
  return typeof result.status === "number" ? result.status === 0 : false;
}

function tryReadStatusUrl(configPath) {
  const result = spawnSync(
    "npx",
    ["--yes", "wrangler", "deployments", "status", "--json", "--config", configPath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        WRANGLER_SEND_METRICS: "false",
      },
    },
  );
  if (result.status !== 0) return "";
  const found = new Set();
  try {
    collectWorkersDevUrls(JSON.parse(String(result.stdout || "").trim()), found);
  } catch (_) {
    collectWorkersDevUrls(String(result.stdout || ""), found);
  }
  return [...found][0] || "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(workerTemplatePath)) {
    fail("templates/cloudflare-worker/worker.js not found.");
  }

  const targetUrl = normalizeTargetUrl(args.targetUrl);
  const targetClassification = classifyTargetUrl(targetUrl);
  if (!targetClassification.ok) {
    fail(describeTargetUrlProblem(targetUrl));
  }
  const corsOrigin = normalizeCorsOrigin(args.corsOrigin);
  const accountId = resolveAccountId(
    String(args.accountId || "").trim(),
    args.autoLogin,
  );
  const workerName =
    sanitizeWorkerName(args.workerName) ||
    sanitizeWorkerName(
      `jobbored-discovery-relay-${inferWorkerSuffixFromTarget(targetUrl) || "main"}`,
    ) ||
    "jobbored-discovery-relay";
  const apiToken = getCloudflareApiToken();
  const requestedWorkersSubdomain = normalizeWorkersSubdomain(
    args.workersSubdomain || process.env.CLOUDFLARE_WORKERS_SUBDOMAIN || "",
  );
  let accountWorkersSubdomain = "";

  const authGuidance = buildAuthGuidanceMessage({
    autoLogin: args.autoLogin,
    accountId,
    apiToken,
  });

  if (!apiToken && requestedWorkersSubdomain) {
    console.log(
      "cloudflare-relay: --workers-subdomain was provided, but automatic subdomain creation requires CLOUDFLARE_API_TOKEN. The helper will continue, and Wrangler may still prompt you once in the terminal.",
    );
  }

  if (apiToken) {
    accountWorkersSubdomain = await ensureWorkersSubdomain(
      accountId,
      apiToken,
      requestedWorkersSubdomain,
      workerName,
    );
  }

  const tempDir = mkdtempSync(join(tmpdir(), "jobbored-cloudflare-relay-"));

  try {
    const workerPath = join(tempDir, "worker.js");
    const configPath = join(tempDir, "wrangler.json");
    const deployOutputPath = join(tempDir, "wrangler-deploy.ndjson");
    const secretOutputPath = join(tempDir, "wrangler-secret.ndjson");

    copyFileSync(workerTemplatePath, workerPath);
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          name: workerName,
          main: "./worker.js",
          compatibility_date: getCompatibilityDate(),
          account_id: accountId,
          workers_dev: true,
          // Daily refresh cron — fires the worker's scheduled() handler
          // which POSTs {mode:"refresh"} to <TARGET_URL origin>/discovery-profile.
          // Default 08:00 UTC. Override with --cron.
          triggers: { crons: [args.cron] },
          ...(corsOrigin ? { vars: { CORS_ORIGIN: corsOrigin } } : {}),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(`cloudflare-relay: deploying worker "${workerName}"...`);
    runWrangler(["deploy", "--config", configPath], {
      cwd: tempDir,
      outputFile: deployOutputPath,
      failureMessage:
        "wrangler deploy failed. If this is your first Worker and you are using browser login, finish the one-time workers.dev subdomain prompt in the terminal. For fully non-interactive setup, use CLOUDFLARE_API_TOKEN and let the helper create the subdomain automatically.",
    });

    console.log("cloudflare-relay: setting TARGET_URL secret...");
    runWrangler(["secret", "put", "TARGET_URL", "--config", configPath], {
      cwd: tempDir,
      input: `${targetUrl}\n`,
      outputFile: secretOutputPath,
      failureMessage:
        "wrangler secret put TARGET_URL failed. Check your Cloudflare auth and account permissions.",
    });

    if (args.discoverySecret) {
      console.log("cloudflare-relay: setting DISCOVERY_SECRET secret...");
      runWrangler(
        ["secret", "put", "DISCOVERY_SECRET", "--config", configPath],
        {
          cwd: tempDir,
          input: `${args.discoverySecret}\n`,
          outputFile: secretOutputPath,
          failureMessage:
            "wrangler secret put DISCOVERY_SECRET failed. Check your Cloudflare auth and account permissions.",
        },
      );
    }

    if (args.sheetId) {
      console.log("cloudflare-relay: setting REFRESH_SHEET_ID secret...");
      runWrangler(
        ["secret", "put", "REFRESH_SHEET_ID", "--config", configPath],
        {
          cwd: tempDir,
          input: `${args.sheetId}\n`,
          outputFile: secretOutputPath,
          failureMessage:
            "wrangler secret put REFRESH_SHEET_ID failed. Check your Cloudflare auth and account permissions.",
        },
      );
    }

    const workerUrl =
      parseUrlsFromJsonLines(secretOutputPath)[0] ||
      parseUrlsFromJsonLines(deployOutputPath)[0] ||
      tryReadStatusUrl(configPath) ||
      (accountWorkersSubdomain
        ? `https://${workerName}.${accountWorkersSubdomain}.workers.dev/`
        : "");

    if (!workerUrl) {
      fail(
        "deploy succeeded, but the workers.dev URL could not be detected from Wrangler output. Open the Worker in Cloudflare and copy the workers.dev URL manually.",
      );
    }

    const payload = {
      ok: true,
      workerName,
      workerUrl,
      targetUrl,
      targetClassification: targetClassification.kind,
      corsOrigin: corsOrigin || "*",
      cron: args.cron,
      refreshSheetIdUploaded: !!args.sheetId,
      auth: {
        mode: authGuidance.mode,
        accountId,
        workersSubdomain: accountWorkersSubdomain || "",
        hasApiToken: !!apiToken,
      },
      verified: null,
      subdomain: buildSubdomainGuidanceMessage({
        workersSubdomain: accountWorkersSubdomain,
        apiToken,
      }),
    };

    if (args.sheetId && args.autoVerify) {
      payload.verified = runVerify(workerUrl, args.sheetId);
      if (payload.verified === false) {
        console.log("");
        console.log(
          "cloudflare-relay: verify step failed. The Worker may still need a moment to propagate; rerun the verify command below after a short wait.",
        );
      }
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log("");
      console.log("cloudflare-relay: OK");
      console.log(`Worker name: ${workerName}`);
      console.log(`Worker URL: ${workerUrl}`);
      console.log(`Target URL: ${targetUrl}`);
      console.log(`Target classification: ${targetClassification.kind}`);
      console.log(`CORS origin: ${corsOrigin || "*"}`);
      console.log(`Daily refresh cron: ${args.cron}`);
      if (args.sheetId) {
        console.log(`REFRESH_SHEET_ID secret: uploaded (${args.sheetId})`);
      } else {
        console.log(
          "REFRESH_SHEET_ID secret: not set — cron will fall back to the worker's default sheetId. Re-run with --sheet-id to pin it.",
        );
      }
      console.log(authGuidance.detail);
      for (const step of authGuidance.steps) {
        console.log(`- ${step}`);
      }
      const subdomainGuidance = buildSubdomainGuidanceMessage({
        workersSubdomain: accountWorkersSubdomain,
        apiToken,
      });
      if (subdomainGuidance.detail) {
        console.log(subdomainGuidance.detail);
      }
      console.log(
        "Note: use the open workers.dev URL in Command Center and keep Cloudflare Access disabled on it.",
      );
      if (args.sheetId) {
        console.log("");
        console.log(
          `Verify: npm run test:discovery-webhook -- --url "${workerUrl}" --sheet-id "${args.sheetId}"`,
        );
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
