import { existsSync, readFileSync } from "fs";

export function parseDotEnv(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

export function sanitizeSecret(secret) {
  const ok = /^[A-Za-z0-9_\-\.~+/=]+$/.test(secret);
  if (!ok) {
    throw new Error(
      "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET contains characters that are unsafe to embed in a scheduler artifact. Regenerate it with only [A-Za-z0-9_\\-.~+/=].",
    );
  }
  return secret;
}
