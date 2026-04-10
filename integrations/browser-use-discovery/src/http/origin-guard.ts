export function resolveAllowedOrigin(
  allowedOrigins: readonly string[],
  originHeader: string,
): string {
  const origin = cleanOrigin(originHeader);
  if (!origin) {
    return allowedOrigins.includes("*") ? "*" : "";
  }
  if (allowedOrigins.includes("*")) return "*";
  return allowedOrigins.includes(origin) ? origin : "";
}

export function isOriginAllowed(
  allowedOrigins: readonly string[],
  originHeader: string,
): boolean {
  const origin = cleanOrigin(originHeader);
  if (!origin) return true;
  return !!resolveAllowedOrigin(allowedOrigins, origin);
}

export function buildCorsHeaders(
  allowedOrigins: readonly string[],
  originHeader: string,
): Record<string, string> {
  const allowOrigin = resolveAllowedOrigin(allowedOrigins, originHeader);
  return {
    ...(allowOrigin
      ? {
          "Access-Control-Allow-Origin": allowOrigin,
        }
      : {}),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-discovery-secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function cleanOrigin(value: string): string {
  return typeof value === "string" ? value.trim() : "";
}
