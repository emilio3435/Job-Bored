#!/usr/bin/env node
/**
 * Keep the JobBored discovery relay healthy when the local ngrok tunnel
 * rotates. Free ngrok plans hand out a new public URL on every restart, which
 * silently breaks the deployed Cloudflare Worker (its TARGET_URL secret still
 * points at the old, dead tunnel).
 *
 * This watchdog:
 *   1. Polls http://127.0.0.1:4040/api/tunnels for the live ngrok URL.
 *   2. If no tunnel is up, optionally restarts ngrok.
 *   3. If the live URL differs from discovery-local-bootstrap.json, updates
 *      ONLY the Worker's TARGET_URL secret (one `wrangler secret put`) and
 *      rewrites the bootstrap state file. No full redeploy.
 *
 * Usage:
 *   npm run discovery:keep-alive               # watch loop (default 30s)
 *   npm run discovery:keep-alive -- --once     # detect + heal once, exit
 *   npm run discovery:keep-alive -- --interval 15
 *   npm run discovery:keep-alive -- --no-start-ngrok
 *   npm run discovery:keep-alive -- --reserved-domain mytunnel.ngrok.app
 *
 * Exits cleanly on SIGINT/SIGTERM so it's safe to run under launchd, pm2, or
 * `concurrently` alongside `npm run start`.
 */

import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const defaultStateFile = join(repoRoot, "discovery-local-bootstrap.json");
const NGROK_API = "http://127.0.0.1:4040/api/tunnels";

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`discovery-keep-alive

Usage:
  npm run discovery:keep-alive
  npm run discovery:keep-alive -- --once
  npm run discovery:keep-alive -- --interval 15
  npm run discovery:keep-alive -- --reserved-domain mytunnel.ngrok.app
  npm run discovery:keep-alive -- --state-file ./discovery-local-bootstrap.json

Options:
  --once               Detect + heal once, then exit. Useful as a pre-flight
                       hook in npm start or a launchd ad-hoc check.
  --interval N         Poll interval in seconds (default 30).
  --port P             Local webhook port (default read from state file, then 8644).
  --no-start-ngrok     Do not auto-start ngrok if no tunnel is running.
  --reserved-domain    Use this stable ngrok domain instead of free rotating URLs.
                       When set, ngrok is launched with --domain=<value> and the
                       watchdog never has to refresh TARGET_URL after the first
                       deploy.
  --state-file         Path to the bootstrap state file. Default:
                       ${defaultStateFile}
  --dry-run            Detect rotations but do NOT update the Worker secret or
                       state file. Logs what it would do.
  --json               Print machine-readable JSON for each tick (for --once
                       this is the single-shot result).
  --help               Show this message.

Behavior:
  - The Worker is found via the workerName already saved in the state file
    (e.g. jobbored-discovery-relay-6d6dab). Without that, this watchdog cannot
    update the right Worker — run \`npm run discovery:bootstrap-local\` and
    \`npm run cloudflare-relay:deploy\` once first.
  - Updating TARGET_URL is one \`wrangler secret put\`. It does NOT redeploy
    the Worker code or change CORS/cron/secret settings. If you need those,
    run the full \`npm run cloudflare-relay:deploy\`.
  - Cloudflare auth is whatever \`npx wrangler\` is already configured for
    (\`wrangler login\` session OR CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
    The watchdog does NOT trigger interactive login — if auth is missing, the
    secret update fails and the watchdog logs the error and waits for the
    next tick.
`);
  process.exit(code);
}

function fail(message, code = 1) {
  console.error(`discovery:keep-alive: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    once: false,
    intervalSec: 30,
    port: "",
    autoStartNgrok: true,
    reservedDomain: "",
    stateFile: defaultStateFile,
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") printUsage(0);
    if (arg === "--once") {
      out.once = true;
      continue;
    }
    if (arg === "--no-start-ngrok") {
      out.autoStartNgrok = false;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const next = argv[i + 1];
    if (
      arg === "--interval" ||
      arg === "--port" ||
      arg === "--reserved-domain" ||
      arg === "--state-file"
    ) {
      if (!next || next.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      if (arg === "--interval") {
        const n = Number.parseInt(String(next).trim(), 10);
        if (!Number.isFinite(n) || n < 5) {
          fail("--interval must be an integer >= 5");
        }
        out.intervalSec = n;
      } else if (arg === "--port") out.port = String(next).trim();
      else if (arg === "--reserved-domain") {
        out.reservedDomain = String(next).trim();
      } else if (arg === "--state-file") {
        out.stateFile = resolve(String(next).trim());
      }
      i += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  return out;
}

function readStateFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`could not parse ${path}: ${err && err.message ? err.message : err}`);
    return null;
  }
}

function writeStateFile(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function tunnelMatchesPort(tunnel, port) {
  const configAddr = String(
    tunnel && tunnel.config && tunnel.config.addr ? tunnel.config.addr : "",
  ).trim();
  const p = String(port).trim();
  return (
    configAddr === p ||
    configAddr.endsWith(`:${p}`) ||
    configAddr.includes(`localhost:${p}`) ||
    configAddr.includes(`127.0.0.1:${p}`)
  );
}

async function fetchNgrokTunnels() {
  try {
    const res = await fetch(NGROK_API);
    if (!res.ok) return { ok: false, tunnels: [], reason: `http_${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, tunnels: Array.isArray(data.tunnels) ? data.tunnels : [] };
  } catch (err) {
    return { ok: false, tunnels: [], reason: "no_api" };
  }
}

function pickPublicUrl(tunnels, port) {
  if (!Array.isArray(tunnels) || tunnels.length === 0) return "";
  const httpsForPort = tunnels.find(
    (t) =>
      String(t && t.public_url ? t.public_url : "").startsWith("https://") &&
      tunnelMatchesPort(t, port),
  );
  if (httpsForPort && httpsForPort.public_url) {
    return normalizeUrl(httpsForPort.public_url);
  }
  const anyHttps = tunnels.find((t) =>
    String(t && t.public_url ? t.public_url : "").startsWith("https://"),
  );
  return anyHttps && anyHttps.public_url ? normalizeUrl(anyHttps.public_url) : "";
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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Combine the live tunnel public origin with the local webhook path so the
 * Worker's TARGET_URL points at the actual /webhooks/<route> on the worker
 * (not at the bare ngrok host).
 */
function buildPublicTargetUrl(tunnelPublicUrl, localWebhookUrl) {
  try {
    const tunnel = new URL(tunnelPublicUrl);
    const local = new URL(localWebhookUrl);
    tunnel.pathname = local.pathname || "/";
    tunnel.search = "";
    tunnel.hash = "";
    return tunnel.toString();
  } catch (_) {
    return "";
  }
}

/**
 * One-shot: read state, probe tunnel, optionally rotate Worker secret. Returns
 * a structured result the caller can log or print as JSON.
 */
async function tick({ args, state }) {
  const port = String(args.port || state.localPort || "8644").trim();
  const localWebhookUrl =
    state.localWebhookUrl ||
    `http://127.0.0.1:${port}/webhooks/${state.routeName || "command-center-discovery"}`;
  const storedTunnel = normalizeUrl(state.tunnelPublicUrl || state.ngrokPublicUrl);
  const storedTarget = normalizeUrl(state.publicTargetUrl);

  const ngrokProbe = await fetchNgrokTunnels();
  let liveTunnel = pickPublicUrl(ngrokProbe.tunnels, port);

  let startedNgrok = false;
  if (!liveTunnel && args.autoStartNgrok && !args.dryRun) {
    const ngrokArgs = ["http"];
    if (args.reservedDomain) ngrokArgs.push(`--domain=${args.reservedDomain}`);
    ngrokArgs.push(String(port));
    startDetached("ngrok", ngrokArgs);
    startedNgrok = true;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(1000);
      const retry = await fetchNgrokTunnels();
      const candidate = pickPublicUrl(retry.tunnels, port);
      if (candidate) {
        liveTunnel = candidate;
        break;
      }
    }
  }

  if (!liveTunnel) {
    return {
      ok: false,
      action: "ngrok_down",
      port,
      storedTunnel,
      liveTunnel: "",
      startedNgrok,
      reason: ngrokProbe.reason || "no_https_tunnel",
      message: args.autoStartNgrok
        ? "ngrok api unreachable and auto-start did not surface a tunnel; will retry next tick."
        : "ngrok api unreachable; pass without --no-start-ngrok to auto-start it.",
    };
  }

  const livePublicTarget = buildPublicTargetUrl(liveTunnel, localWebhookUrl);
  if (!livePublicTarget) {
    return {
      ok: false,
      action: "build_target_failed",
      port,
      liveTunnel,
      reason: "could_not_join_tunnel_with_local_path",
    };
  }

  const rotated =
    !!storedTarget && storedTarget !== livePublicTarget;
  const firstTime = !storedTarget && !!liveTunnel;

  if (!rotated && !firstTime) {
    return {
      ok: true,
      action: "no_change",
      port,
      liveTunnel,
      publicTargetUrl: livePublicTarget,
      startedNgrok,
    };
  }

  const workerName = String(state.workerName || "").trim();
  if (!workerName) {
    return {
      ok: false,
      action: "missing_worker_name",
      port,
      liveTunnel,
      publicTargetUrl: livePublicTarget,
      reason:
        "state file has no workerName; run `npm run discovery:bootstrap-local` and `npm run cloudflare-relay:deploy` first.",
    };
  }

  if (args.dryRun) {
    return {
      ok: true,
      action: "would_rotate",
      port,
      liveTunnel,
      from: storedTarget,
      to: livePublicTarget,
      workerName,
      startedNgrok,
    };
  }

  const updateResult = updateWorkerTargetSecret(workerName, livePublicTarget);
  if (!updateResult.ok) {
    return {
      ok: false,
      action: "wrangler_secret_failed",
      port,
      liveTunnel,
      from: storedTarget,
      to: livePublicTarget,
      workerName,
      reason: updateResult.reason,
      stderr: updateResult.stderr,
    };
  }

  // Persist the new tunnel + target URL so the dashboard's bootstrap reader
  // shows the right values on next reload.
  const nextState = {
    ...state,
    tunnelPublicUrl: liveTunnel,
    ngrokPublicUrl: liveTunnel,
    publicTargetUrl: livePublicTarget,
    diagnostics: {
      ...(state.diagnostics || {}),
      ngrokRunning: true,
      ngrokDetected: true,
    },
    keepAlive: {
      lastRotatedAt: new Date().toISOString(),
      lastFrom: storedTarget,
      lastTo: livePublicTarget,
      workerName,
    },
  };
  writeStateFile(args.stateFile, nextState);

  return {
    ok: true,
    action: rotated ? "rotated" : "first_install",
    port,
    liveTunnel,
    from: storedTarget,
    to: livePublicTarget,
    workerName,
    startedNgrok,
  };
}

/**
 * Update only the TARGET_URL secret on the existing Cloudflare Worker. This
 * is materially cheaper than `cloudflare-relay:deploy`: no temp dir, no code
 * upload, no CORS/cron rewrite, no auth flow change.
 */
function updateWorkerTargetSecret(workerName, targetUrl) {
  const result = spawnSync(
    "npx",
    [
      "--yes",
      "wrangler",
      "secret",
      "put",
      "TARGET_URL",
      "--name",
      workerName,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        WRANGLER_SEND_METRICS: "false",
      },
      input: `${targetUrl}\n`,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (typeof result.status === "number" && result.status === 0) {
    return { ok: true };
  }
  const stderr = String(result.stderr || result.stdout || "").trim();
  return {
    ok: false,
    reason:
      stderr.toLowerCase().includes("auth") ||
      stderr.toLowerCase().includes("login")
        ? "wrangler_auth_missing"
        : "wrangler_failed",
    stderr,
  };
}

function logResult(result, json) {
  const stamp = new Date().toISOString();
  if (json) {
    process.stdout.write(`${JSON.stringify({ at: stamp, ...result })}\n`);
    return;
  }
  switch (result.action) {
    case "no_change":
      console.log(
        `[${stamp}] ok: tunnel unchanged (${result.liveTunnel})`,
      );
      return;
    case "rotated":
      console.log(
        `[${stamp}] ROTATED: ${result.from || "(none)"} -> ${result.to}\n  worker: ${result.workerName}`,
      );
      return;
    case "first_install":
      console.log(
        `[${stamp}] first install: TARGET_URL set to ${result.to} on ${result.workerName}`,
      );
      return;
    case "would_rotate":
      console.log(
        `[${stamp}] dry-run: would rotate ${result.from || "(none)"} -> ${result.to} on ${result.workerName}`,
      );
      return;
    case "ngrok_down":
      console.warn(
        `[${stamp}] ngrok down (${result.reason}): ${result.message}`,
      );
      return;
    case "missing_worker_name":
      console.error(
        `[${stamp}] cannot heal: ${result.reason}`,
      );
      return;
    case "wrangler_secret_failed":
      console.error(
        `[${stamp}] wrangler secret put failed (${result.reason}). stderr:\n${result.stderr}`,
      );
      return;
    case "build_target_failed":
      console.error(
        `[${stamp}] could not build TARGET_URL from tunnel ${result.liveTunnel}`,
      );
      return;
    default:
      console.log(`[${stamp}] ${JSON.stringify(result)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = readStateFile(args.stateFile);
  if (!state) {
    fail(
      `no bootstrap state file at ${args.stateFile}. Run \`npm run discovery:bootstrap-local\` first.`,
    );
  }

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  if (args.once) {
    const result = await tick({ args, state });
    logResult(result, args.json);
    process.exit(result.ok ? 0 : 2);
  }

  if (!args.json) {
    console.log(
      `discovery:keep-alive: watching ngrok every ${args.intervalSec}s (state: ${args.stateFile})`,
    );
    if (args.reservedDomain) {
      console.log(
        `discovery:keep-alive: reserved domain mode -- ngrok will be launched with --domain=${args.reservedDomain}`,
      );
    }
  }

  // Run forever. Re-read state each tick so external bootstrap runs are
  // picked up without restarting the watchdog.
  while (!stopping) {
    const fresh = readStateFile(args.stateFile) || state;
    const result = await tick({ args, state: fresh });
    logResult(result, args.json);
    // Sleep in 1s slices so SIGINT exits within ~1s.
    for (let i = 0; i < args.intervalSec && !stopping; i += 1) {
      await sleep(1000);
    }
  }

  if (!args.json) {
    console.log("discovery:keep-alive: stopping");
  }
}

const __invokedAsCli =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (__invokedAsCli) {
  main().catch((err) => {
    fail(err && err.message ? err.message : String(err));
  });
}

export { tick, pickPublicUrl, buildPublicTargetUrl };
