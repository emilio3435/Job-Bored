/**
 * The address check for every provider and catalog fetch (HOLES PROV S1).
 *
 * Provider base URLs are caller-supplied by design (Local, xAI, self-hosted),
 * so the server must not fetch one blindly:
 * - The built-in provider origins are fetched as before.
 * - A loopback server (LISTEN_HOST unset or loopback, read the way
 *   server/index.mjs reads it) keeps reaching Ollama on 127.0.0.1 or a LAN
 *   box: only the person at this computer can call it.
 * - A hosted server refuses private, loopback, link-local and cloud-metadata
 *   hosts, by literal and by DNS, at every redirect hop, with the connection
 *   pinned to the checked address (security-boundaries.mjs safeFetch).
 */

import { safeFetch } from "./security-boundaries.mjs";

export const PROVIDER_URL_BLOCKED = "provider_url_blocked";

const HOSTED_REFUSAL =
  "A hosted JobBored server only calls public AI provider addresses, never private, loopback, link-local or cloud-metadata ones.";

/** The fixed endpoints in provider.mjs and judge-models.mjs. */
const TRUSTED_PROVIDER_ORIGINS = new Set([
  "https://generativelanguage.googleapis.com",
  "https://api.openai.com",
  "https://api.anthropic.com",
  "https://openrouter.ai",
  "https://api.x.ai",
]);

const LOOPBACK_LISTEN_HOSTS = new Set(["", "127.0.0.1", "localhost", "::1"]);

/**
 * True when this server listens on loopback only, as server/index.mjs
 * decides it (LISTEN_HOST defaults to 127.0.0.1).
 * @param {NodeJS.ProcessEnv} [env]
 */
export function listenerIsLoopback(env = process.env) {
  return LOOPBACK_LISTEN_HOSTS.has(String(env.LISTEN_HOST || "127.0.0.1").toLowerCase());
}

/** @param {unknown} rawUrl */
function isTrustedProviderUrl(rawUrl) {
  try {
    return TRUSTED_PROVIDER_ORIGINS.has(new URL(String(rawUrl)).origin);
  } catch {
    return false;
  }
}

/** @param {unknown} error */
export function isProviderUrlBlocked(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === PROVIDER_URL_BLOCKED);
}

function blockedError() {
  const error = /** @type {Error & { code: string }} */ (new Error(HOSTED_REFUSAL));
  error.name = "ProviderUrlBlockedError";
  error.code = PROVIDER_URL_BLOCKED;
  return error;
}

/**
 * fetch() for a provider or catalog URL under the policy above. A refused
 * address throws an Error with code "provider_url_blocked" before any
 * request leaves the server.
 * @param {string} rawUrl
 * @param {RequestInit} [init]
 * @param {{ fetchImpl?: typeof globalThis.fetch, env?: NodeJS.ProcessEnv, lookupImpl?: import("./security-boundaries.mjs").LookupAll }} [options]
 * @returns {Promise<Response>}
 */
export async function providerFetch(rawUrl, init = {}, { fetchImpl = globalThis.fetch, env = process.env, lookupImpl } = {}) {
  if (isTrustedProviderUrl(rawUrl) || listenerIsLoopback(env)) return fetchImpl(rawUrl, init);
  try {
    return await safeFetch(String(rawUrl), init, { fetchImpl, ...(lookupImpl ? { lookupImpl } : {}) });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ssrf_blocked") throw blockedError();
    throw error;
  }
}
