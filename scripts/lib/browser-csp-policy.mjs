// Browser Content-Security-Policy for the JobBored dashboard.
//
// F2-D owns this module. F0-A applies it in `dev-server.mjs`
// (`STATIC_SECURITY_HEADERS["content-security-policy"]`, ~449–458).
// Do not duplicate the string in F0-A — import `buildContentSecurityPolicy()`.
//
// Derived from transports the dashboard actually uses:
//   script-src  GIS client + docs.google.com gviz JSONP fallback
//   connect-src Google userinfo / Sheets / Apps Script API / gviz CSV,
//               Clearbit autocomplete, configured AI hosts, local worker,
//               user-owned discovery tunnels, plus extraConnectSrc origins
//   Prefer same-origin proxies for new hosts; only add a connect-src origin
//   when the browser must talk to it directly.

export const REQUIRED_SCRIPT_SRC = Object.freeze([
  "'self'",
  "'unsafe-inline'",
  "https://accounts.google.com",
  "https://docs.google.com",
]);

export const REQUIRED_CONNECT_SRC = Object.freeze([
  "'self'",
  "https://accounts.google.com",
  "https://www.googleapis.com",
  "https://sheets.googleapis.com",
  "https://script.googleapis.com",
  "https://script.google.com",
  "https://script.googleusercontent.com",
  "https://docs.google.com",
  "https://autocomplete.clearbit.com",
  "https://generativelanguage.googleapis.com",
  "https://api.openai.com",
  "https://api.anthropic.com",
  "https://openrouter.ai",
  "https://fonts.gstatic.com",
  "http://127.0.0.1:*",
  "http://localhost:*",
  "https://*.ts.net",
  "https://*.workers.dev",
  "https://*.trycloudflare.com",
  "https://*.ngrok-free.app",
  "https://*.ngrok.app",
  "https://*.ngrok.io",
]);

export const REQUIRED_STYLE_SRC = Object.freeze([
  "'self'",
  "'unsafe-inline'",
  // BEAUDIT G10: the Google Identity Services button loads its stylesheet.
  "https://accounts.google.com/gsi/style",
]);
export const REQUIRED_IMG_SRC = Object.freeze(["'self'", "data:", "https:"]);
export const REQUIRED_FONT_SRC = Object.freeze([
  "'self'",
  "data:",
  "https://fonts.gstatic.com",
]);
export const REQUIRED_FRAME_SRC = Object.freeze(["https://accounts.google.com"]);

/**
 * Accept a full URL or origin. Reject non-http(s) schemes so javascript:
 * / data: values cannot widen connect-src.
 * @param {unknown} raw
 * @returns {string}
 */
export function originForConnectSrc(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

/**
 * @param {{ extraConnectSrc?: unknown[], forMeta?: boolean }} [options]
 * @returns {string}
 */
export function buildContentSecurityPolicy(options = {}) {
  const extra = Array.isArray(options.extraConnectSrc)
    ? options.extraConnectSrc
    : [];
  const extraOrigins = [];
  const seen = new Set(REQUIRED_CONNECT_SRC);
  for (const candidate of extra) {
    const origin = originForConnectSrc(candidate);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    extraOrigins.push(origin);
  }
  const connectSrc = extraOrigins.length
    ? REQUIRED_CONNECT_SRC.concat(extraOrigins)
    : REQUIRED_CONNECT_SRC;
  const directives = [
    "default-src 'self'",
    `script-src ${REQUIRED_SCRIPT_SRC.join(" ")}`,
    `style-src ${REQUIRED_STYLE_SRC.join(" ")}`,
    `img-src ${REQUIRED_IMG_SRC.join(" ")}`,
    `font-src ${REQUIRED_FONT_SRC.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${REQUIRED_FRAME_SRC.join(" ")}`,
  ];
  // BEAUDIT G13: frame-ancestors is ignored inside a <meta> tag — the Pages
  // artifact carries the policy as meta, so the meta variant drops it.
  if (!options.forMeta) {
    directives.push("frame-ancestors 'none'");
  }
  return directives.join("; ");
}

/**
 * BEAUDIT G10: origins the local config.js points the browser at
 * (jobBoredApiUrl, resumeLocalBaseUrl, custom AI base URLs, ...). Reads
 * string literals assigned to keys ending in "Url", bare or quoted, and keeps only http(s)
 * origins, in order, without duplicates.
 *
 * @param {unknown} configText
 * @returns {string[]}
 */
export function extractConfigConnectOrigins(configText) {
  const text = String(configText || "");
  const origins = [];
  // The key may be bare (jobBoredApiUrl:) or quoted ("jobBoredApiUrl": or
  // 'jobBoredApiUrl':); a quoted key must close with the quote it opened.
  const pattern =
    /(?:(["'])[A-Za-z0-9_$]*Url\1|\b[A-Za-z0-9_$]*Url)\s*:\s*(["'`])([^"'`\n]*)\2/g;
  let match;
  while ((match = pattern.exec(text))) {
    const origin = originForConnectSrc(match[3]);
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}
