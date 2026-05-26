import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(__dirname, "..", "..");
export const discoveryRoot = join(repoRoot, "integrations", "browser-use-discovery");
export const stateDir = join(discoveryRoot, "state");
export const envPath = join(discoveryRoot, ".env");
export const scheduleInstalledPath = join(stateDir, "schedule-installed.json");
export const expiredCleanupScheduleInstalledPath = join(
  stateDir,
  "expired-cleanup-schedule-installed.json",
);
export const workerConfigPath = join(stateDir, "worker-config.json");

export function normalizeSheetIdCandidate(value) {
  const raw = value != null ? String(value).trim() : "";
  if (!raw || raw === "YOUR_SHEET_ID_HERE") return "";
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$|\?|#)/);
  if (match && match[1]) return match[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(raw) ? raw : "";
}

export function readWorkerConfigSheetId() {
  if (!existsSync(workerConfigPath)) return "";
  try {
    const parsed = JSON.parse(readFileSync(workerConfigPath, "utf8"));
    const direct = normalizeSheetIdCandidate(parsed && parsed.sheetId);
    if (direct) return direct;
    const payloads = [parsed && parsed.config, parsed && parsed.default, parsed && parsed.workerConfig];
    for (const payload of payloads) {
      const candidate = normalizeSheetIdCandidate(payload && payload.sheetId);
      if (candidate) return candidate;
    }
  } catch {
    return "";
  }
  return "";
}

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
  sheetId,
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
        ...(sheetId ? { sheetId } : {}),
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

export function writeExpiredCleanupScheduleBreadcrumb({
  platform,
  artifactPath,
  hour,
  minute,
  sheetId,
  writeMode = false,
  cadence = "daily",
}) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    expiredCleanupScheduleInstalledPath,
    `${JSON.stringify(
      {
        platform,
        installedAt: new Date().toISOString(),
        artifactPath,
        hour,
        minute,
        cadence,
        mode: writeMode ? "write" : "dry-run",
        ...(sheetId ? { sheetId } : {}),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export function deleteExpiredCleanupScheduleBreadcrumb() {
  rmSync(expiredCleanupScheduleInstalledPath, { force: true });
}

export function readExpiredCleanupScheduleBreadcrumb() {
  if (!existsSync(expiredCleanupScheduleInstalledPath)) return null;
  try {
    const parsed = JSON.parse(
      readFileSync(expiredCleanupScheduleInstalledPath, "utf8"),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
