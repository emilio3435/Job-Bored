/**
 * The jobbored:// handler's parser (GFX R21, R4).
 *
 * Any web page can fire a jobbored:// link, so the handler trusts nothing in
 * it. Exactly two shapes are accepted, compared as whole strings:
 *
 *   jobbored://open
 *   jobbored://open?beat=<google|ai|resume|details|voice|fit|discovery|payoff>
 *
 * The target is rebuilt from constants, never from the input, and main.mjs
 * hands it only to shell.openExternal. `returnTo` is never accepted (R4), and
 * a refusal reason never echoes the raw URL, so callers can log it.
 */

export const DASHBOARD_URL = "http://localhost:8080/";

/** The onboarding beats, in order (onboarding-flow.js BEAT_IDS). */
export const BEAT_IDS = Object.freeze(["google", "ai", "resume", "details", "voice", "fit", "discovery", "payoff"]);

const BARE = "jobbored://open";
const BEAT_PREFIX = "jobbored://open?beat=";
const MAX_LENGTH = BEAT_PREFIX.length + Math.max(...BEAT_IDS.map((id) => id.length));

/** Prebuilt targets: the only strings this module ever returns. */
const TARGETS = Object.freeze(
  Object.fromEntries(BEAT_IDS.map((id) => [id, `${DASHBOARD_URL}?beat=${id}`])),
);

/**
 * @param {unknown} raw
 * @returns {{ ok: true, target: string } | { ok: false, reason: string }}
 */
export function parseJobBoredUrl(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "not_a_string" };
  if (raw.length === 0 || raw.length > MAX_LENGTH) return { ok: false, reason: "bad_length" };
  if (raw === BARE) return { ok: true, target: DASHBOARD_URL };
  if (!raw.startsWith(BEAT_PREFIX)) return { ok: false, reason: "not_allowed" };
  const beat = raw.slice(BEAT_PREFIX.length);
  if (!Object.hasOwn(TARGETS, beat)) return { ok: false, reason: "unknown_beat" };
  return { ok: true, target: TARGETS[beat] };
}

/**
 * Allows one launch per `intervalMs`; refused attempts don't extend the
 * window, so a page spamming links still gets at most one open every 2 s.
 * @param {{ intervalMs?: number, now?: () => number }} [options]
 */
export function createLaunchGate({ intervalMs = 2_000, now = Date.now } = {}) {
  let last = -Infinity;
  return {
    tryLaunch() {
      const t = now();
      if (t - last < intervalMs) return false;
      last = t;
      return true;
    },
  };
}
