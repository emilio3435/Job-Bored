// Purpose: Pure, unit-testable core for the 3-tier public-URL transport that
// fronts the local JobBored discovery worker.
//
// Tiers (auto-selected, with explicit override):
//   - cloudflare_named  STABLE hostname bound to a Cloudflare domain via a
//                        pre-configured `cloudflared` NAMED tunnel. No URL
//                        rotation, so no keepalive resync is needed. Requires
//                        the user to have set up the named tunnel themselves;
//                        this code only READS that configuration.
//   - cloudflare_quick  Anonymous `cloudflared tunnel --url ...`. Zero signup,
//                        prints a https://<random>.trycloudflare.com URL that
//                        ROTATES on every restart. Default for greenfield users
//                        when cloudflared is installed.
//   - ngrok             Existing behavior. FALLBACK only.
//
// Selection priority:
//   explicit preference > cloudflare_named (if configured)
//     > cloudflare_quick (if cloudflared installed) > ngrok
//
// Everything here is a pure function: subprocess access is injected via
// spawnSyncImpl so callers (and tests) never run cloudflared for real.

import { spawnSync } from "node:child_process";

export const TRANSPORT_CLOUDFLARE_NAMED = "cloudflare_named";
export const TRANSPORT_CLOUDFLARE_QUICK = "cloudflare_quick";
export const TRANSPORT_NGROK = "ngrok";

export const TRANSPORT_KINDS = Object.freeze([
  TRANSPORT_CLOUDFLARE_NAMED,
  TRANSPORT_CLOUDFLARE_QUICK,
  TRANSPORT_NGROK,
]);

/**
 * Normalize a user-supplied transport preference (CLI flag / env) into one of
 * the canonical transport kinds, or "auto" for automatic selection. Accepts the
 * hyphenated CLI spellings (cloudflare-named) and the underscore kind names
 * (cloudflare_named). Returns "" for anything unrecognized so callers can
 * decide whether to error.
 */
export function normalizeTransportPreference(raw) {
  const value = String(raw || "auto")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (value === "" || value === "auto") return "auto";
  if (value === TRANSPORT_CLOUDFLARE_NAMED) return TRANSPORT_CLOUDFLARE_NAMED;
  if (value === TRANSPORT_CLOUDFLARE_QUICK) return TRANSPORT_CLOUDFLARE_QUICK;
  if (value === TRANSPORT_NGROK) return TRANSPORT_NGROK;
  return "";
}

/**
 * Detect whether the `cloudflared` binary is installed and on PATH. Pure with
 * respect to subprocess access — the spawn implementation is injected so tests
 * never shell out. Returns { installed, version? }.
 */
export function detectCloudflared({ spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl("cloudflared", ["--version"], {
    encoding: "utf8",
  });
  if (!result || result.error || result.status !== 0) {
    return { installed: false };
  }
  const text = String(result.stdout || result.stderr || "").trim();
  // Typical output: "cloudflared version 2024.2.1 (built 2024-02-13-...)"
  const match = text.match(/version\s+(\S+)/i);
  return {
    installed: true,
    ...(match && match[1] ? { version: match[1] } : {}),
  };
}

/**
 * Parse the public https://<x>.trycloudflare.com URL out of cloudflared's
 * quick-tunnel output. cloudflared logs the URL inside a boxed banner, e.g.:
 *
 *   2024-02-13T10:30:00Z INF +--------------------------------------------+
 *   2024-02-13T10:30:00Z INF |  https://foo-bar-baz.trycloudflare.com     |
 *   2024-02-13T10:30:00Z INF +--------------------------------------------+
 *
 * Returns the first matching URL, or "" when none is present. PURE.
 */
export function parseQuickTunnelUrl(text) {
  const haystack = String(text || "");
  const match = haystack.match(
    /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i,
  );
  return match ? match[0] : "";
}

/**
 * Select the transport to use given environment facts and an explicit
 * preference. Priority (highest first):
 *   1. explicit preference (when it is a concrete kind, not "auto")
 *   2. cloudflare_named, when a named tunnel is configured
 *   3. cloudflare_quick, when cloudflared is installed
 *   4. ngrok (fallback)
 *
 * An explicit preference is honored as-is — the caller is responsible for
 * surfacing any feasibility problem (e.g. the user asked for cloudflare-named
 * but never configured it). An unrecognized preference is treated as "auto".
 * PURE.
 */
export function selectTransport({
  preference = "auto",
  cloudflaredInstalled = false,
  namedTunnelConfigured = false,
  ngrokAvailable = true,
} = {}) {
  const normalized = normalizeTransportPreference(preference);
  if (
    normalized === TRANSPORT_CLOUDFLARE_NAMED ||
    normalized === TRANSPORT_CLOUDFLARE_QUICK ||
    normalized === TRANSPORT_NGROK
  ) {
    return normalized;
  }
  // normalized is "auto" (or unrecognized -> treat as auto for selection).
  if (namedTunnelConfigured) return TRANSPORT_CLOUDFLARE_NAMED;
  if (cloudflaredInstalled) return TRANSPORT_CLOUDFLARE_QUICK;
  return TRANSPORT_NGROK;
}

/**
 * A transport is "stable" when its public hostname does NOT rotate across
 * restarts, so the keepalive resync can be skipped. Only the Cloudflare NAMED
 * tunnel is stable. PURE.
 */
export function isStableTransport(kind) {
  return kind === TRANSPORT_CLOUDFLARE_NAMED;
}

/**
 * Build the argv for a cloudflare_quick tunnel: an anonymous quick tunnel that
 * exposes the local worker port. The returned { command, args } is consumed by
 * both the bootstrap (spawned detached) and the tunnel-autostart service. PURE
 * so it can be asserted in tests without spawning anything.
 */
export function buildQuickTunnelCommand(port) {
  const resolvedPort = Number.parseInt(String(port), 10);
  if (
    !Number.isInteger(resolvedPort) ||
    resolvedPort <= 0 ||
    resolvedPort > 65535
  ) {
    throw new Error(
      `buildQuickTunnelCommand requires a valid port, got ${port}`,
    );
  }
  return {
    command: "cloudflared",
    args: ["tunnel", "--url", `http://127.0.0.1:${resolvedPort}`],
  };
}

/**
 * Build the argv for a cloudflare_named tunnel run by name. Used by the tunnel
 * autostart service when the chosen transport is the stable named tunnel. The
 * named tunnel's ingress (hostname -> local port) lives in the user's
 * cloudflared config; we only `run` it. PURE.
 */
export function buildNamedTunnelCommand(tunnelName) {
  const name = String(tunnelName || "").trim();
  if (!name) {
    throw new Error("buildNamedTunnelCommand requires a tunnel name");
  }
  return {
    command: "cloudflared",
    args: ["tunnel", "run", name],
  };
}
