import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveResumeTextForAnalysis } from "../server/profile-from-resume.mjs";

/* ============================================================
   RESJ K5 (RESJ-FIT-01): the Fit Profile wizard posts the
   browser's staged resume to /profile/from-resume. K3 stopped
   garbled staged text from overwriting resume.txt, but the
   resolver still handed it to the analyzer. Now garbled staged
   text is skipped for the saved resume, and the answer says so.
   Fictional text only; HOME is a temp dir.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const GARBLED = readFileSync(join(repoRoot, "tests", "fixtures", "materials-garbled-resume.txt"), "utf8");
const CLEAN = `Jordan Rivera
Growth Marketing Leader
Austin, TX | jordan.rivera@example.com

Experience
Director of Growth, Northwind Outfitters, 2019 to 2025
- Grew qualified pipeline 38% in two years.
`;

const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function tempHome(resumeTxt) {
  const home = mkdtempSync(join(tmpdir(), "jobbored-k5-home-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const path = join(home, ".jobbored", "resume.txt");
  if (resumeTxt != null) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, resumeTxt);
  }
  return path;
}

describe("resolveResumeTextForAnalysis skips garbled staged text (RESJ K5)", () => {
  it("should analyze the saved resume, not the garbled staged text, and say it fell back", async () => {
    const path = tempHome(CLEAN);
    const resolved = await resolveResumeTextForAnalysis({ resumeText: GARBLED });
    assert.equal(resolved.text, CLEAN.trim(), "the analyzer gets the saved resume");
    assert.equal(resolved.source, "jobbored_text");
    assert.equal(resolved.requestGarbled, true);
    assert.equal(readFileSync(path, "utf8"), CLEAN, "resume.txt untouched");
  });

  it("should refuse with resume_garbled when there is no clean saved resume to use", async () => {
    tempHome(null);
    await assert.rejects(
      resolveResumeTextForAnalysis({ resumeText: GARBLED }),
      (err) => err.code === "resume_garbled" && err.statusCode === 422,
    );
  });

  it("should refuse when the saved resume is garbled too", async () => {
    tempHome(GARBLED);
    await assert.rejects(resolveResumeTextForAnalysis({ resumeText: GARBLED }), (err) => err.code === "resume_garbled");
  });

  it("should still analyze and cache clean staged text", async () => {
    const path = tempHome(null);
    const resolved = await resolveResumeTextForAnalysis({ resumeText: CLEAN });
    assert.equal(resolved.source, "staged_request");
    assert.equal(resolved.requestGarbled, false);
    assert.equal(readFileSync(path, "utf8"), CLEAN.trim());
  });
});
