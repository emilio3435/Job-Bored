export function slugifyCompanyName(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function compactCompanyTokens(raw: string): string[] {
  const base = slugifyCompanyName(raw);
  const tokens = new Set<string>([base]);
  const stripped = base.replace(
    /-(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|labs|systems|technologies|technology|solutions|software|ai)$/i,
    "",
  );
  if (stripped) tokens.add(stripped);
  const compact = base.replace(/-/g, "");
  if (compact) tokens.add(compact);
  return [...tokens].filter(Boolean);
}

export function extractTokenFromBoardHint(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length) {
      return decodeURIComponent(parts[parts.length - 1]).replace(
        /\.json$/i,
        "",
      );
    }
    return url.hostname.split(".")[0];
  } catch {
    return value
      .replace(/^https?:\/\//i, "")
      .split(/[/?#]/)[0]
      .replace(/^www\./i, "");
  }
}

export function toPlainText(input: string): string {
  return stripHtml(input).replace(/\s+/g, " ").trim();
}

export function looksLikeCompensation(text: string): boolean {
  return /[$€£¥₹₩]|(?:usd|cad|eur|gbp|aud|nzd|chf|sgd|hkd|jpy|inr|sek|nok|dkk|brl|mxn)\b|salary|compensation|pay range|\bote\b|equity\s+(?:range|grant|package|vesting|refresh)|per\s+(?:hour|year|annum)|\/(?:hour|yr|year|annum)|\b\d{2,3}k\b|\b\d{2,3}(?:,\d{3})?(?:\s*-\s*|\s+to\s+)\d{2,3}(?:,\d{3})?\b/i.test(
    text,
  );
}

export function sanitizeCompensationText(input: string): string {
  const text = toPlainText(input);
  if (!text) return "";
  if (!looksLikeCompensation(text)) return "";
  if (text.length > 120) return "";
  return text;
}

export function stripHtml(input: string): string {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
