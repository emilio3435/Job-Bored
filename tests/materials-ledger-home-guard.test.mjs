/**
 * Regression: a test must never read or write the user's real claim ledger.
 *
 * On 2026-09-27 12:06 a drafter test with no HOME isolation rebuilt
 * ~/.jobbored/claim-ledger.json from fixture text (the "Alex Rivera"
 * freight resume in tests/fixtures/materials-example-writer.mjs). Under
 * `node --test`, ensureLedger now refuses any ledger inside the real
 * user's ~/.jobbored. These checks never touch the real home: the IO case
 * protects a temp dir through JOBBORED_TEST_REAL_HOME instead.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { writeLedgerAtomic } from "../server/materials-ledger.mjs";
import {
  assertLedgerPathIsolated,
  buildLedger,
  ensureLedger,
  LEDGER_BUILDER_VERSION,
} from "../server/materials-ledger-build.mjs";
import { EXAMPLE_RESUME_TEXT } from "./fixtures/materials-example-writer.mjs";
import { modelReplyFixture, modelStructureFixture } from "./fixtures/materials-model-structure.mjs";

const GOLDEN = readFileSync(new URL("./fixtures/resumes/unbulleted-realshape.txt", import.meta.url), "utf8");
const PIN = { provider: "gemini", model: "gemini-3.8-flash", resolvedModel: "gemini-3.8-flash", apiKey: "fictional-key" };
const fetchImpl = async () => ({});
const modelCall = (text) => async () => modelReplyFixture(text);
const saved = { ...process.env };
afterEach(() => {
  for (const key of ["HOME", "JOBBORED_PROFILE_PATH", "JOBBORED_TEST_REAL_HOME"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("the claim ledger stays out of the real HOME under test", () => {
  it("rejects the real user's ~/.jobbored ledger path, even when $HOME points elsewhere", () => {
    process.env.HOME = mkdtempSync(join(tmpdir(), "jb-guard-home-"));
    const real = join(userInfo().homedir, ".jobbored", "claim-ledger.json");
    assert.throws(() => assertLedgerPathIsolated(real), (e) => e.code === "ledger_real_home_in_test");
    assert.doesNotThrow(() => assertLedgerPathIsolated(join(process.env.HOME, ".jobbored", "claim-ledger.json")));
  });

  it("ensureLedger fails before reading or writing a protected home", async () => {
    const protectedHome = mkdtempSync(join(tmpdir(), "jb-guard-protected-"));
    process.env.JOBBORED_TEST_REAL_HOME = protectedHome;
    process.env.JOBBORED_PROFILE_PATH = join(protectedHome, ".jobbored", "profile.json");
    await assert.rejects(
      () => ensureLedger({ profile: null, resumeText: EXAMPLE_RESUME_TEXT }),
      (e) => e.code === "ledger_real_home_in_test",
    );
    assert.equal(existsSync(join(protectedHome, ".jobbored", "claim-ledger.json")), false);
  });

  it("a model-built fixture ledger is rebuilt when the resume text changes", async () => {
    process.env.JOBBORED_PROFILE_PATH = join(mkdtempSync(join(tmpdir(), "jb-guard-heal-")), ".jobbored", "profile.json");
    const leaked = await ensureLedger({
      profile: null,
      resumeText: EXAMPLE_RESUME_TEXT,
      pin: PIN,
      fetchImpl,
      callStage: modelCall(EXAMPLE_RESUME_TEXT),
    });
    assert.ok(leaked.claims.some((c) => /freight budget/.test(c.text)));
    const healed = await ensureLedger({ profile: null, resumeText: GOLDEN, pin: PIN, fetchImpl, callStage: modelCall(GOLDEN) });
    assert.equal(healed.rebuilt, true, "resume hash mismatch forces a rebuild");
    const resumeHash = `sha256:${createHash("sha256").update(GOLDEN.trim()).digest("hex")}`;
    assert.equal(healed.sources.find((s) => s.kind === "resume")?.hash, resumeHash);
    assert.equal(healed.claims.some((c) => /freight budget/.test(c.text)), false, "no fixture claim survives");
  });

  it("a stored ledger from an older builder is rebuilt even when its sources still match", async () => {
    process.env.JOBBORED_PROFILE_PATH = join(mkdtempSync(join(tmpdir(), "jb-builder-")), ".jobbored", "profile.json");
    /* What the bullet-only v1 builder stored for this unbulleted resume:
     * matching source hashes, no builderVersion, no resume claims. */
    const current = buildLedger({
      profile: { strengths: [{ name: "x", rank: 1, evidence: "Ran an $8M+ digital book at Brightwave Media." }] },
      resumeText: GOLDEN,
      structure: modelStructureFixture(GOLDEN),
    });
    const { builderVersion: _drop, ...v1 } = current;
    await writeLedgerAtomic({ ...v1, claims: current.claims.filter((c) => c.id.startsWith("profile-")), employers: [] });
    const profile = { strengths: [{ name: "x", rank: 1, evidence: "Ran an $8M+ digital book at Brightwave Media." }] };
    const rebuilt = await ensureLedger({ profile, resumeText: GOLDEN, pin: PIN, fetchImpl, callStage: modelCall(GOLDEN) });
    assert.equal(rebuilt.rebuilt, true, "older builder forces a rebuild");
    assert.equal(rebuilt.builderVersion, LEDGER_BUILDER_VERSION);
    assert.ok(rebuilt.claims.filter((c) => c.id.startsWith("resume-")).length >= 20);
    const again = await ensureLedger({ profile, resumeText: GOLDEN, pin: PIN, fetchImpl });
    assert.equal(again.rebuilt, false, "a current-builder ledger with matching sources is reused");
  });
});
