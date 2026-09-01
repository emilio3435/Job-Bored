/**
 * F2B-PROFILE02-RESUME — staged browser resume text to a non-persisting
 * analysis route. The helper must prefer request-body resumeText, never write
 * it to disk, and must ignore accidental secret fields in the body.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = pathToFileURL(join(repoRoot, "server/profile-from-resume.mjs")).href;

const temps = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function loadModule() {
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

describe("F2B-PROFILE02-RESUME — resolveResumeTextForAnalysis", () => {
  it("prefers staged request resumeText over disk and does not persist it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jobbored-f2b-resume-"));
    temps.push(dir);
    const diskPath = join(dir, "resume.txt");
    writeFileSync(diskPath, "DISK RESUME THAT MUST LOSE", "utf8");
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = join(dir, "missing-worker.json");

    const mod = await loadModule();
    assert.equal(
      typeof mod.resolveResumeTextForAnalysis,
      "function",
      "server/profile-from-resume.mjs must export resolveResumeTextForAnalysis",
    );
    const result = await mod.resolveResumeTextForAnalysis({
      resumeText: "  Browser-local staged resume.  ",
      apiKey: "sk-secret-must-not-be-kept",
      geminiApiKey: "AIza-secret",
    });
    assert.equal(result.source, "staged_request");
    assert.equal(result.text, "Browser-local staged resume.");
    assert.equal(result.path, null);
    assert.equal(
      existsSync(join(dir, "staged-resume.txt")),
      false,
      "staged text must not be written next to the lookup dir",
    );
    assert.equal(
      readFileSync(diskPath, "utf8"),
      "DISK RESUME THAT MUST LOSE",
      "disk resume must remain untouched",
    );
  });

  it("falls back to stored resume when the body has no staged text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jobbored-f2b-resume-stored-"));
    temps.push(dir);
    const workerPath = join(dir, "worker-config.json");
    writeFileSync(
      workerPath,
      JSON.stringify({
        candidateProfile: { resumeText: "Stored worker resume text for fallback." },
      }),
      "utf8",
    );
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = workerPath;
    const mod = await loadModule();
    const result = await mod.resolveResumeTextForAnalysis({});
    assert.equal(result.source, "worker_config");
    assert.match(result.text, /Stored worker resume text/);
  });

  it("ignores secret-looking body fields and never treats them as resume text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jobbored-f2b-resume-secrets-"));
    temps.push(dir);
    mkdirSync(dir, { recursive: true });
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = join(dir, "nope.json");
    const mod = await loadModule();
    const result = await mod.resolveResumeTextForAnalysis({
      apiKey: "sk-live-not-a-resume",
      googleAccessToken: "ya29.not-a-resume",
    });
    if (result) {
      assert.notEqual(result.source, "staged_request");
      assert.notEqual(result.text, "sk-live-not-a-resume");
      assert.notEqual(result.text, "ya29.not-a-resume");
    } else {
      assert.equal(result, null);
    }
  });
});
