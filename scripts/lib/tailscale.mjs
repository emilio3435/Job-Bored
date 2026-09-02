import childProcess from "node:child_process";

const TAILSCALE_COMMAND = "tailscale";
/** Where the CLI lives when PATH does not carry it (a dev server launched
 *  from launchd, an IDE terminal, or a lean shell): try these in order.
 *  Seen live 2026-09-02 — "Tailscale isn't installed yet" with it running. */
const TAILSCALE_CANDIDATES = [
  TAILSCALE_COMMAND,
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];
const ALLOWED_SERVE_PORTS = new Set([8080, 8644]);

function spawnTailscale(spawnSync, command, args) {
  try {
    return spawnSync(command, args, {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
      windowsHide: true,
    });
  } catch (error) {
    return { status: 1, stdout: "", stderr: "", error };
  }
}

function isMissingBinary(result) {
  const code = result && result.error && result.error.code;
  return code === "ENOENT" || code === "EACCES";
}

/** The candidate that answered last time, per spawnSync (tests inject their
 *  own; the real one is remembered for the process). */
const resolvedCommandBySpawn = new WeakMap();

/** Run the CLI: the bare command first; only when the binary is missing from
 *  PATH try the well-known install locations with the same arguments, and
 *  remember the one that answered. The happy path costs no extra spawn. */
function runTailscaleCommand(spawnSync, args) {
  const remembered = resolvedCommandBySpawn.get(spawnSync);
  const order = remembered
    ? [remembered, ...TAILSCALE_CANDIDATES.filter((c) => c !== remembered)]
    : TAILSCALE_CANDIDATES;
  let first = null;
  for (const candidate of order) {
    const result = spawnTailscale(spawnSync, candidate, args);
    if (!isMissingBinary(result)) {
      resolvedCommandBySpawn.set(spawnSync, candidate);
      return result;
    }
    if (!first) first = result;
  }
  // Nothing answered: surface the bare command's ENOENT, the clearest signal.
  return first || spawnTailscale(spawnSync, TAILSCALE_COMMAND, args);
}

function firstLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function trimTrailingDot(value) {
  const text = String(value || "").trim().replace(/\.+$/g, "");
  return text || null;
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

function resolveTailnet(status) {
  const currentTailnet = status && status.CurrentTailnet;
  if (typeof currentTailnet === "string") {
    return trimTrailingDot(currentTailnet);
  }
  if (currentTailnet && typeof currentTailnet === "object" && !Array.isArray(currentTailnet)) {
    return trimTrailingDot(currentTailnet.Name || currentTailnet.MagicDNSSuffix);
  }
  return trimTrailingDot(status && status.MagicDNSSuffix);
}

function normalizePort(port) {
  const parsed = Number.parseInt(String(port ?? ""), 10);
  return Number.isInteger(parsed) ? parsed : NaN;
}

function outputText(result) {
  return `${String((result && result.stdout) || "")}\n${String(
    (result && result.stderr) || "",
  )}`.trim();
}

function isAlreadyServing(result) {
  const text = outputText(result).toLowerCase();
  return text.includes("already") && text.includes("serv");
}

function errorText(result, fallback) {
  if (result && result.error && result.error.message) return result.error.message;
  return firstLine(result && result.stderr) || firstLine(result && result.stdout) || fallback;
}

export function detectTailscale({ spawnSync = childProcess.spawnSync } = {}) {
  const versionResult = runTailscaleCommand(spawnSync, ["version"]);
  const installed = !versionResult.error && versionResult.status === 0;
  if (!installed) {
    return {
      installed: false,
      version: null,
      loggedIn: false,
      dnsName: null,
      tailnet: null,
    };
  }

  const statusResult = runTailscaleCommand(spawnSync, ["status", "--json"]);
  const status = statusResult.status === 0 ? parseJsonObject(statusResult.stdout) : null;
  const dnsName = trimTrailingDot(status && status.Self && status.Self.DNSName);
  const tailnet = resolveTailnet(status);
  const loggedIn = !!(
    status &&
    (dnsName || tailnet || status.Self)
  );

  return {
    installed: true,
    version: firstLine(versionResult.stdout) || firstLine(versionResult.stderr) || null,
    loggedIn,
    dnsName,
    tailnet,
  };
}

export function deriveTailnetDashboardUrl(detect) {
  const dnsName = trimTrailingDot(detect && detect.dnsName);
  return dnsName ? `https://${dnsName}` : null;
}

export function runTailscaleServe({ port, spawnSync = childProcess.spawnSync } = {}) {
  const normalizedPort = normalizePort(port);
  if (!ALLOWED_SERVE_PORTS.has(normalizedPort)) {
    return {
      ok: false,
      alreadyServing: false,
      url: null,
      error: "Port must be one of 8080, 8644.",
    };
  }

  const result = runTailscaleCommand(spawnSync, ["serve", "--bg", String(normalizedPort)]);
  const alreadyServing = isAlreadyServing(result);
  const ok = !result.error && (result.status === 0 || alreadyServing);
  if (!ok) {
    return {
      ok: false,
      alreadyServing: false,
      url: null,
      error: errorText(result, "tailscale serve failed."),
    };
  }

  const detection = detectTailscale({ spawnSync });
  return {
    ok: true,
    alreadyServing,
    url: deriveTailnetDashboardUrl(detection),
    error: null,
  };
}
