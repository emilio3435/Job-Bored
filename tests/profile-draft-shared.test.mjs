import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ============================================================
   profile-draft-shared.js — the single source for Fit Profile
   drafting, consumed by the browser (B3 serverless fallback) and
   the server (POST /profile/from-resume). These probes pin the
   parser/clamp behavior AND the no-drift lock: the server module
   must re-export these exact bindings, never a local copy.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(
  pathToFileURL(join(repoRoot, "server", "profile-draft-shared.js")).href
);
const shared = globalThis.JobBoredProfileDraft;

describe("profile-draft-shared · namespace", () => {
  it("publishes the drafting surface", () => {
    for (const key of [
      "SYSTEM_PROMPT",
      "MAX_RESUME_INPUT_CHARS",
      "buildUserPrompt",
      "parseJsonSafe",
      "clampToUserProfile",
    ]) {
      assert.ok(shared[key] !== undefined, key);
    }
    assert.equal(shared.MAX_RESUME_INPUT_CHARS, 60_000);
    assert.match(shared.SYSTEM_PROMPT, /UserProfile v1/);
  });
});

describe("profile-draft-shared · buildUserPrompt", () => {
  it("wraps the resume in markers", () => {
    const prompt = shared.buildUserPrompt("Jane — engineer.");
    assert.ok(prompt.includes("── BEGIN RESUME ──"));
    assert.ok(prompt.includes("Jane — engineer."));
  });

  it("clips past the cap with an omission note", () => {
    const prompt = shared.buildUserPrompt("x".repeat(60_005));
    assert.ok(prompt.includes("[resume truncated — 5 characters omitted]"));
  });
});

describe("profile-draft-shared · parseJsonSafe", () => {
  it("parses plain JSON", () => {
    assert.deepEqual(shared.parseJsonSafe('{"a":1}'), { a: 1 });
  });

  it("strips markdown fences", () => {
    assert.deepEqual(
      shared.parseJsonSafe('```json\n{"a":1}\n```'),
      { a: 1 },
    );
  });

  it("recovers JSON embedded in prose", () => {
    assert.deepEqual(
      shared.parseJsonSafe('Here you go: {"a":{"b":[1,2]}} thanks!'),
      { a: { b: [1, 2] } },
    );
  });

  it("throws on empty and non-JSON", () => {
    assert.throws(() => shared.parseJsonSafe("   "), /empty JSON payload/);
    assert.throws(() => shared.parseJsonSafe("no braces here"));
  });
});

describe("profile-draft-shared · clampToUserProfile", () => {
  it("safe-defaults a hostile payload without throwing", () => {
    const profile = shared.clampToUserProfile({
      identity: { targetSeniority: "bogus", primaryNarrative: "short" },
      strengths: [{ name: "x" }, { name: "  " }],
      hardConstraints: { workMode: "nope" },
    });
    assert.equal(profile.version, 1);
    assert.equal(profile.identity.targetSeniority, "any");
    assert.deepEqual(profile.identity.targetRoles, ["Open to discussion"]);
    assert.ok(profile.identity.primaryNarrative.length >= 20);
    assert.deepEqual(profile.strengths, [{ name: "Add a strength", rank: 1 }]);
    assert.equal(profile.hardConstraints.workMode, "any");
    assert.equal(profile.hardConstraints.salaryRequired, false);
    assert.equal(profile.hardConstraints.workAuth, "us_authorized");
    assert.equal(profile.starterTemplate, "custom");
  });

  it("keeps valid fields and renumbers strengths 1..n", () => {
    const profile = shared.clampToUserProfile({
      identity: {
        targetRoles: ["Staff Engineer"],
        targetSeniority: "ic_staff",
        primaryNarrative:
          "I build the systems other teams build on top of, and I want more of that.",
        yearsRelevantExperience: 99,
      },
      strengths: [
        { name: "Distributed systems", rank: 7, keywords: ["k8s"] },
        { name: "API design", rank: 2 },
      ],
      wants: ["High-autonomy teams"],
      hardConstraints: { workMode: "remote_only" },
    });
    assert.equal(profile.identity.targetSeniority, "ic_staff");
    assert.equal(profile.identity.yearsRelevantExperience, 60);
    assert.deepEqual(
      profile.strengths.map((s) => s.rank),
      [1, 2],
    );
    assert.deepEqual(profile.wants, ["High-autonomy teams"]);
    assert.equal(profile.hardConstraints.workMode, "remote_only");
  });
});

describe("profile-draft-shared · server parity lock", () => {
  it("the server re-exports these exact bindings", async () => {
    const mod = await import(
      pathToFileURL(join(repoRoot, "server", "profile-from-resume.mjs")).href
    );
    assert.equal(
      mod.__test.SYSTEM_PROMPT,
      shared.SYSTEM_PROMPT,
      "one prompt — a fix here fixes both paths",
    );
    assert.equal(mod.__test.clampToUserProfile, shared.clampToUserProfile);
    assert.equal(mod.__test.parseJsonSafe, shared.parseJsonSafe);
  });

  it("the server keeps no local copies", () => {
    const source = readFileSync(
      join(repoRoot, "server", "profile-from-resume.mjs"),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /^const SYSTEM_PROMPT = `/m,
      "the prompt lives in the shared module, not the server",
    );
    assert.doesNotMatch(
      source,
      /^function clampToUserProfile\(raw\) {/m,
      "the clamp lives in the shared module, not the server",
    );
    assert.match(
      source,
      /import "\.\/profile-draft-shared\.js"/,
      "the server imports its sibling shared module (inside the image context)",
    );
  });
});
