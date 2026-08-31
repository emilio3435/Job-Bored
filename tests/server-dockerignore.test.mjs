import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dockerignorePath = join(repoRoot, "server", ".dockerignore");
const dockerfilePath = join(repoRoot, "server", "Dockerfile");

const CONTEXT_SECRET_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.secret",
  "nested/.env",
  "nested/.env.local",
];

/** @param {string} text */
function parseDockerignorePatterns(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/**
 * Convert a dockerignore glob to a regex. Patterns without a slash match at any
 * depth, matching Docker's gitignore-like rules.
 * @param {string} pattern
 */
function dockerPatternToRegExp(pattern) {
  const anyDepth = !pattern.includes("/");
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}\//g, "(?:.*/)?")
    .replace(/{{GLOBSTAR}}/g, ".*");
  if (anyDepth) {
    return new RegExp(`(?:^|/)${body}$`);
  }
  return new RegExp(`^${body}$`);
}

/**
 * @param {string[]} patterns
 * @param {string} relativePath
 */
function dockerignoreExcludes(patterns, relativePath) {
  const file = relativePath.replace(/^\.\//, "").replace(/\\/g, "/");
  let excluded = false;
  for (const raw of patterns) {
    const negate = raw.startsWith("!");
    const pattern = negate ? raw.slice(1) : raw;
    if (dockerPatternToRegExp(pattern).test(file)) {
      excluded = !negate;
    }
  }
  return excluded;
}

describe("F0D-F10-DOCKER server image context", () => {
  it("has a .dockerignore that keeps .env files out of COPY context", () => {
    assert.equal(
      existsSync(dockerignorePath),
      true,
      "server/.dockerignore must exist so Docker does not send .env files",
    );
    const dockerignore = readFileSync(dockerignorePath, "utf8");
    const dockerfile = readFileSync(dockerfilePath, "utf8");
    assert.match(
      dockerfile,
      /COPY\s+\.\s+\./,
      "Dockerfile copies the build context; ignore rules must cover that COPY",
    );
    const patterns = parseDockerignorePatterns(dockerignore);
    const leaked = CONTEXT_SECRET_FILES.filter(
      (file) => !dockerignoreExcludes(patterns, file),
    );
    assert.deepEqual(
      leaked,
      [],
      `these files would be sent in the Docker context: ${leaked.join(", ")}`,
    );
  });
});
