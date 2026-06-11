import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const STATUS_TOKEN_PARAM = "statusToken";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Constant-time compare without leaking input length: hash both sides to a
// fixed-width 32-byte SHA-256 digest first, then timingSafeEqual on the
// digests. This prevents an attacker from learning the expected secret length
// via a length-based early return.
function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function createRunStatusToken(
  webhookSecret: string,
  runId: string,
): string {
  const secret = asText(webhookSecret);
  const normalizedRunId = asText(runId);
  if (!secret || !normalizedRunId) return "";
  return createHmac("sha256", secret)
    .update(`run-status:${normalizedRunId}`)
    .digest("base64url");
}

export function appendRunStatusToken(
  statusPath: string,
  statusToken: string,
): string {
  const token = asText(statusToken);
  if (!token) return statusPath;
  const rawPath = asText(statusPath);
  if (!rawPath) return rawPath;

  try {
    const isAbsolute =
      rawPath.startsWith("http://") || rawPath.startsWith("https://");
    const url = new URL(rawPath, "http://worker.local");
    url.searchParams.set(STATUS_TOKEN_PARAM, token);
    return isAbsolute ? url.toString() : `${url.pathname}${url.search}`;
  } catch {
    const separator = rawPath.includes("?") ? "&" : "?";
    return `${rawPath}${separator}${STATUS_TOKEN_PARAM}=${encodeURIComponent(token)}`;
  }
}

export function hasValidRunStatusToken(input: {
  webhookSecret: string;
  runId: string;
  providedToken?: string | null;
}): boolean {
  const expected = createRunStatusToken(input.webhookSecret, input.runId);
  const provided = asText(input.providedToken);
  if (!expected || !provided) return false;
  return safeEqual(expected, provided);
}
