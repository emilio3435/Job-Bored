/**
 * ONE-FLOW spec §5 B3 — the server half of the resume dual write.
 *
 * Two claims, both of which the old module actively refused:
 *
 *  1. Request-body `resumeText` is PERSISTED to ~/.jobbored/resume.txt.
 *     Before this, a browser-staged resume was analyzed and thrown away,
 *     so `/profile/from-resume` found nothing on the next call and the
 *     fit-profile wizard fell back to a template — the teardown's
 *     "resume uploaded in wizard 1 is invisible to wizard 2" bug.
 *  2. The drafting prompt no longer orders the model to leave `wants`
 *     and `avoids` empty, so all six profile sections come back drafted
 *     and B4 is a confirmation screen rather than a data-entry form.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = pathToFileURL(join(repoRoot, "server/profile-from-resume.mjs")).href;

const temps = [];
const savedEnv = {};

function useTempHome() {
  const dir = mkdtempSync(join(tmpdir(), "jobbored-l1-home-"));
  temps.push(dir);
  for (const key of ["HOME", "USERPROFILE"]) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    process.env[key] = dir;
  }
  return dir;
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(savedEnv)) delete savedEnv[key];
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function loadModule() {
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

describe("L1 §5 B3 — staged resume text is persisted for the next reader", () => {
  it("writes request-body resumeText to ~/.jobbored/resume.txt", async () => {
    const home = useTempHome();
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = join(home, "missing-worker.json");
    const mod = await loadModule();
    const result = await mod.resolveResumeTextForAnalysis({
      resumeText: "  Browser-staged resume body.  ",
    });
    const target = join(home, ".jobbored", "resume.txt");
    assert.equal(result.source, "staged_request");
    assert.equal(result.text, "Browser-staged resume body.");
    assert.equal(
      existsSync(target),
      true,
      "the browser upload must survive as the file /profile/from-resume reads next time",
    );
    assert.equal(readFileSync(target, "utf8"), "Browser-staged resume body.");
    assert.equal(result.path, target, "the caller is told where it landed");
  });

  it("still prefers the body over anything already on disk", async () => {
    const home = useTempHome();
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = join(home, "missing-worker.json");
    mkdirSync(join(home, ".jobbored"), { recursive: true });
    writeFileSync(join(home, ".jobbored", "resume.txt"), "STALE RESUME", "utf8");
    const mod = await loadModule();
    const result = await mod.resolveResumeTextForAnalysis({ resumeText: "Fresh upload." });
    assert.equal(result.text, "Fresh upload.");
    assert.equal(readFileSync(join(home, ".jobbored", "resume.txt"), "utf8"), "Fresh upload.");
  });

  it("never persists a body with no resumeText", async () => {
    const home = useTempHome();
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = join(home, "missing-worker.json");
    const mod = await loadModule();
    await mod.resolveResumeTextForAnalysis({
      apiKey: "sk-live-not-a-resume",
      googleAccessToken: "ya29.not-a-resume",
    });
    assert.equal(
      existsSync(join(home, ".jobbored", "resume.txt")),
      false,
      "secret-looking body fields are still never mistaken for a resume",
    );
  });

  it("returns the draft even when the disk write is impossible", async () => {
    const home = useTempHome();
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = join(home, "missing-worker.json");
    // A FILE where the .jobbored directory needs to be: mkdir must fail.
    writeFileSync(join(home, ".jobbored"), "not a directory", "utf8");
    const mod = await loadModule();
    const result = await mod.resolveResumeTextForAnalysis({ resumeText: "Undroppable." });
    assert.equal(result.text, "Undroppable.", "a failed cache must never cost the user their draft");
    assert.equal(result.path, null);
  });
});

describe("L1 §5 B3 — the drafting prompt returns all six sections", () => {
  it("no longer orders the model to leave wants and avoids empty", async () => {
    const mod = await loadModule();
    const prompt = mod.__test.SYSTEM_PROMPT;
    assert.equal(typeof prompt, "string");
    assert.equal(
      /leave \[\]/.test(prompt),
      false,
      "spec §5 B3: the wizard no longer fills these in — the draft does",
    );
  });

  it("asks for wants and avoids explicitly", async () => {
    const mod = await loadModule();
    const prompt = mod.__test.SYSTEM_PROMPT;
    assert.match(prompt, /^- wants:/m);
    assert.match(prompt, /^- avoids:/m);
    assert.match(prompt, /resume/i);
  });

  it("keeps wants and avoids in the returned profile", async () => {
    const mod = await loadModule();
    const profile = mod.__test.clampToUserProfile({
      version: 1,
      identity: {
        targetRoles: ["Staff Engineer"],
        targetSeniority: "ic_staff",
        primaryNarrative: "I build the systems other teams build on top of, and I want more of that.",
      },
      strengths: [{ name: "Distributed systems", rank: 1 }],
      wants: ["High-autonomy teams"],
      avoids: ["Pure on-call roles"],
      hardConstraints: { workMode: "any" },
    });
    assert.deepEqual(profile.wants, ["High-autonomy teams"]);
    assert.deepEqual(profile.avoids, ["Pure on-call roles"]);
  });
});
