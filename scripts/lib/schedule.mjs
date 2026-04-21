import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(__dirname, "..", "..");
export const discoveryRoot = join(repoRoot, "integrations", "browser-use-discovery");
export const stateDir = join(discoveryRoot, "state");
export const envPath = join(discoveryRoot, ".env");
export const scheduleInstalledPath = join(stateDir, "schedule-installed.json");
export const refreshRequestBody =
  '{"event":"discovery.profile.request","schemaVersion":1,"mode":"refresh"}';

export function renderTemplate(template, replacements) {
  let out = template;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
}

export function formatClock(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function writeScheduleBreadcrumb({
  platform,
  artifactPath,
  hour,
  minute,
  port,
}) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    scheduleInstalledPath,
    `${JSON.stringify(
      {
        platform,
        installedAt: new Date().toISOString(),
        artifactPath,
        hour,
        minute,
        port,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export function deleteScheduleBreadcrumb() {
  rmSync(scheduleInstalledPath, { force: true });
}

export function readScheduleBreadcrumb() {
  if (!existsSync(scheduleInstalledPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(scheduleInstalledPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
