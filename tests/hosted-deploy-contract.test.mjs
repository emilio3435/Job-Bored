/**
 * BEAUDIT E5/E6 hosted deploy contract: the image needs python3 (logo
 * resolver) on Node 24 without shipping secrets, and render.yaml must mint
 * JOBBORED_API_TOKEN, accept the dashboard origins, and build
 * reproducibly — otherwise the hosted API boots with no auth and no CORS.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

describe("E5/E6 hosted deploy contract", () => {
  it("E5: the Dockerfile installs python3 on Node 24", () => {
    const dockerfile = read("server/Dockerfile");
    assert.match(dockerfile, /^FROM node:24-alpine/m);
    assert.match(dockerfile, /apk add --no-cache python3/);
  });

  it("E5: the Docker context never ships secrets or state", () => {
    const ignore = read("server/.dockerignore");
    for (const pattern of [".env", "*.log"]) {
      assert.ok(
        ignore.split("\n").map((line) => line.trim()).includes(pattern),
        `server/.dockerignore must exclude ${pattern}`,
      );
    }
  });

  it("E6: render.yaml mints the API token and accepts dashboard origins", () => {
    const render = read("render.yaml");
    assert.match(render, /key: JOBBORED_API_TOKEN/);
    assert.match(render, /generateValue: true/);
    assert.match(render, /key: COMMAND_CENTER_ALLOWED_ORIGINS/);
    assert.match(render, /sync: false/);
  });

  it("E6: render.yaml builds reproducibly from the lockfile", () => {
    const render = read("render.yaml");
    assert.match(render, /buildCommand: npm ci --omit=dev/);
  });
});
