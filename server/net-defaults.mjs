/**
 * Node's happy-eyeballs (network family autoselection) gives each address only
 * 250 ms by default, which is too fast on some networks: fetch (undici) then
 * fails with UND_ERR_CONNECT_TIMEOUT while curl connects fine. Importing this
 * module (first, for its side effect) raises the per-address attempt timeout.
 *
 * Override with JOBBORED_NET_FAMILY_ATTEMPT_MS: a number of milliseconds;
 * 0 leaves Node's default untouched.
 */
import net from "node:net";

export const DEFAULT_FAMILY_ATTEMPT_MS = 2000;

export function applyNetDefaults(env = process.env) {
  const raw = String(env.JOBBORED_NET_FAMILY_ATTEMPT_MS ?? "").trim();
  let ms = DEFAULT_FAMILY_ATTEMPT_MS;
  if (raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) ms = Math.floor(parsed);
  }
  if (ms === 0 || typeof net.setDefaultAutoSelectFamilyAttemptTimeout !== "function") {
    return null;
  }
  net.setDefaultAutoSelectFamilyAttemptTimeout(ms);
  return ms;
}

applyNetDefaults();
