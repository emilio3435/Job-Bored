/**
 * load-user-profile.ts
 *
 * Loads the canonical UserProfile from disk and validates it against the
 * schema. Used once per discovery run.
 *
 * Lookup order:
 *   1. $JOBBORED_PROFILE_PATH (override, useful for tests)
 *   2. ~/.jobbored/profile.json (canonical)
 *
 * Returns null when no profile is present. The scorer falls back to the
 * legacy heuristic in that case.
 */

import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import type { UserProfile } from "../contracts/user-profile.ts";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(moduleDir, "..", "contracts", "user-profile.schema.json");
// JSON import-assertions are not stable in --experimental-strip-types,
// so read the schema at module load instead.
const schemaJson = JSON.parse(readFileSync(schemaPath, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile<UserProfile>(schemaJson);

function resolveProfilePath(): string {
  const override = process.env.JOBBORED_PROFILE_PATH;
  if (override && override.trim()) return override.trim();
  return join(homedir(), ".jobbored", "profile.json");
}

function parseAndValidate(raw: string, path: string): UserProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
  if (!validate(parsed)) {
    throw new Error(
      `Profile at ${path} failed schema validation: ${ajv.errorsText(validate.errors)}`,
    );
  }
  return parsed as UserProfile;
}

export async function loadUserProfile(): Promise<UserProfile | null> {
  const path = resolveProfilePath();
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return parseAndValidate(raw, path);
}

export function loadUserProfileSync(): UserProfile | null {
  const path = resolveProfilePath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  return parseAndValidate(raw, path);
}

export { resolveProfilePath };

/**
 * Validate an in-memory candidate against the UserProfile schema. Returns
 * the same object (cast) on pass, or null + log on fail. Used by the worker
 * to accept-or-reject a payload-supplied `mergedUserProfile` from the
 * discovery webhook.
 */
export function validateProfileCandidate(
  candidate: unknown,
): UserProfile | null {
  if (!candidate || typeof candidate !== "object") return null;
  if (!validate(candidate)) {
    return null;
  }
  return candidate as UserProfile;
}
