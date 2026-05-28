/**
 * legacy-profile-migrator.mjs
 *
 * Migrate the legacy `~/.hermes/job-hunt/profile/` markdown profile into a
 * v1 UserProfile JSON written at `~/.jobbored/profile.json`. Idempotent —
 * a `.migrated.v1` marker file in `~/.jobbored/` prevents re-running.
 *
 * Surface:
 *   - migrateLegacyProfileIfPresent() → { migrated, reason, profile? }
 *   - parseLegacyProfile({preferencesMd, profileMd}) → UserProfile  (pure, testable)
 *
 * The parser is intentionally pragmatic: it doesn't try to be a full markdown
 * AST. It uses regex over the well-known section headings in `job-preferences.md`
 * and `profile.md`. If a section is missing it leaves the corresponding field
 * empty and falls back to safe defaults. The user can edit anything in the
 * Settings → Fit Profile tab after migration.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const SCHEMA_VERSION = 1;

function resolvePaths() {
  const home = homedir();
  return {
    canonical: process.env.JOBBORED_PROFILE_PATH ||
      join(home, ".jobbored", "profile.json"),
    legacyDir: join(home, ".hermes", "job-hunt", "profile"),
    legacyPreferences: join(home, ".hermes", "job-hunt", "profile", "job-preferences.md"),
    legacyProfile: join(home, ".hermes", "job-hunt", "profile", "profile.md"),
    migratedMarker: join(home, ".jobbored", ".migrated.v1"),
  };
}

/**
 * Pull the body of a markdown section (lines after `## Heading` until the next
 * `## ` heading). Case-sensitive heading match.
 */
function sectionBody(md, heading) {
  const lines = md.split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`, "i");
  let inSection = false;
  const out = [];
  for (const line of lines) {
    if (inSection) {
      if (/^##\s+/.test(line)) break;
      out.push(line);
    } else if (headingRe.test(line)) {
      inSection = true;
    }
  }
  return out.join("\n").trim();
}

/** Extract `- bullet` lines from a section body. */
function bulletList(body) {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("**Needs"));
}

/**
 * Extract Acceptable Locations from the "Location preferences" body.
 * Returns city names; ignores phrases like "Remote preferred" and "reject unless".
 */
function parseLocations(body) {
  if (!body) return [];
  const accepted = new Set();
  for (const bullet of bulletList(body)) {
    const lower = bullet.toLowerCase();
    if (lower.startsWith("on-site") || lower.startsWith("workable timezones") || lower.startsWith("scheduling")) continue;
    if (lower.startsWith("remote")) continue;
    // Match "Hybrid acceptable in Philadelphia, PA; Denver, CO; Little Rock, AR."
    // and "Base: Denver, CO."
    const cityMatches = bullet.match(/[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*,\s*[A-Z]{2}/g);
    if (cityMatches) {
      for (const c of cityMatches) accepted.add(c.split(",")[0].trim());
    }
  }
  return [...accepted];
}

/**
 * Best-effort lane → strength mapping. The legacy file uses 4 H3 sections
 * under "## Best-fit titles" — we use those as ranked strengths.
 */
function parseStrengths(preferencesMd) {
  const titlesBody = sectionBody(preferencesMd, "Best-fit titles");
  if (!titlesBody) return defaultStrengths();

  const strengths = [];
  // Split into H3 lanes
  const laneChunks = titlesBody.split(/^###\s+/m).slice(1);
  let rank = 1;
  for (const chunk of laneChunks) {
    const [headerLine, ...rest] = chunk.split(/\r?\n/);
    const name = headerLine.replace(/lane\s*$/i, "").replace(/—.+$/, "").trim() || `Lane ${rank}`;
    const bullets = bulletList(rest.join("\n"));
    if (bullets.length === 0) continue;
    strengths.push({
      name,
      rank: rank++,
      evidence: bullets.slice(0, 3).join("; "),
      keywords: bullets.slice(0, 10),
    });
    if (rank > 6) break;
  }
  return strengths.length > 0 ? strengths : defaultStrengths();
}

function defaultStrengths() {
  return [
    { name: "Primary lane", rank: 1, evidence: "Imported from legacy profile" },
  ];
}

function parseSkipTitles(preferencesMd) {
  const body = sectionBody(preferencesMd, "Avoid / reject titles");
  return bulletList(body)
    .map((line) => line.replace(/\.$/, "").trim())
    .slice(0, 30);
}

function parseNarrative(profileMd) {
  if (!profileMd) return "Imported from legacy profile. Edit me in Settings → Fit Profile to sharpen scoring.";
  const positioning = sectionBody(profileMd, "Positioning anchor");
  if (positioning) {
    const firstPara = positioning.split(/\n\s*\n/)[0].trim();
    if (firstPara.length >= 20) {
      return firstPara.slice(0, 1200);
    }
  }
  // Fall back to the first paragraph of the file
  const firstPara = profileMd.replace(/^#.*$/m, "").trim().split(/\n\s*\n/)[0].trim();
  return (firstPara.length >= 20 ? firstPara : profileMd.slice(0, 800))
    .slice(0, 1200);
}

/**
 * Pure transform from the legacy markdown files into a v1 UserProfile JSON.
 * Exported for unit testing.
 */
export function parseLegacyProfile({ preferencesMd, profileMd }) {
  const strengths = parseStrengths(preferencesMd);
  const skipTitles = parseSkipTitles(preferencesMd);
  const acceptableLocations = parseLocations(sectionBody(preferencesMd, "Location preferences"));
  const narrative = parseNarrative(profileMd || "");

  // Legacy rubric had highest weight on consultant/strategy lane → "Director" seniority
  // is a reasonable default. User edits in Settings if wrong.
  const profile = {
    version: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    starterTemplate: "custom",
    identity: {
      targetRoles: strengths.slice(0, 3).map((s) => s.name).filter(Boolean),
      targetSeniority: "director",
      primaryNarrative: narrative,
    },
    strengths,
    wants: [],
    avoids: [],
    hardConstraints: {
      workMode: acceptableLocations.length > 0 ? "hybrid_ok" : "remote_only",
      acceptableLocations,
      workAuth: "us_citizen",
      skipTitles,
      salaryRequired: false,
    },
    tieBreakers: {
      salaryTransparencyImportance: "medium",
      companyCredibilityImportance: "high",
      applicationComplexityAversion: "medium",
    },
  };
  if (profile.identity.targetRoles.length === 0) {
    profile.identity.targetRoles = ["Director, Strategy"];
  }
  return profile;
}

/**
 * Check legacy files, run the parser, write the canonical JSON, drop a marker.
 * Returns `{migrated: true, profile}` on success, `{migrated: false, reason}`
 * when nothing to do or when the marker is already in place.
 */
export async function migrateLegacyProfileIfPresent() {
  const paths = resolvePaths();

  if (existsSync(paths.migratedMarker)) {
    return { migrated: false, reason: "marker_exists" };
  }
  if (existsSync(paths.canonical)) {
    return { migrated: false, reason: "canonical_already_present" };
  }
  if (!existsSync(paths.legacyPreferences)) {
    return { migrated: false, reason: "no_legacy_files" };
  }

  const preferencesMd = readFileSync(paths.legacyPreferences, "utf8");
  const profileMd = existsSync(paths.legacyProfile)
    ? readFileSync(paths.legacyProfile, "utf8")
    : "";
  const profile = parseLegacyProfile({ preferencesMd, profileMd });

  await mkdir(dirname(paths.canonical), { recursive: true });
  await writeFile(paths.canonical, JSON.stringify(profile, null, 2), "utf8");
  // Marker file — empty, just signals "we ran the migrator already".
  writeFileSync(paths.migratedMarker, new Date().toISOString(), "utf8");

  return { migrated: true, profile };
}
