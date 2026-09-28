/**
 * Wave 3 (Jordan's decision): the resume and letter header headline
 * follows the same per-role positioning as the letter hook and summary.
 *
 * Precedence (server/materials-positioning.mjs headlineFor):
 *   1. a headline the user confirmed in "Your details"
 *      (identity.headline + identity.headlineConfirmed === true);
 *   2. the per-role positioning headline;
 *   3. an unconfirmed profile headline (pre-filled from the resume);
 *   4. the writer header, the resume's own line, the latest seat.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { headlineFor, positioningFor, positioningHeadline } from "../server/materials-positioning.mjs";
import { overlayProfileIdentity, refreshStoredModel, renderIdentity } from "../server/materials-render-model-adapter.mjs";
import { normalizeContact, withContact } from "../server/profile-identity.mjs";
import { validateProfile } from "../server/user-profile.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/* The phrases Jordan's voice.md names. */
const VOICE = {
  guideText: "Digital marketing consultant and AI product builder. I'm a performance marketer. Digital marketing consultant / strategist.",
  facts: [],
};

describe("headline · per-role positioning", () => {
  it("should title the three positioning kinds in the user's own words", () => {
    assert.equal(positioningHeadline("consultant", VOICE), "Digital Marketing Consultant · AI Product Builder");
    assert.equal(positioningHeadline("performance", VOICE), "Performance Marketer · AI Product Builder");
    assert.equal(positioningHeadline("ai", VOICE), "AI Product Builder · Digital Marketing Strategist");
  });

  it("should be empty when the voice guide does not name the lead identity", () => {
    assert.equal(positioningHeadline("consultant", null), "");
    assert.equal(positioningHeadline("performance", { guideText: "AI product builder only.", facts: [] }), "");
    assert.equal(positioningHeadline("ai", { guideText: "AI product builder only.", facts: [] }), "AI Product Builder");
  });

  it("should follow the role: agency, in-house growth and AI roles", () => {
    const agency = positioningFor({ role: { title: "Account Director", family: "sales" } }, "Our agency serves clients.", VOICE);
    const growth = positioningFor({ role: { title: "Growth Marketing Lead", family: "marketing" } }, "In-house growth team.", VOICE);
    const ai = positioningFor({ role: { title: "VP, AI Strategy", family: "general" } }, "", VOICE);
    assert.equal(positioningHeadline(agency.kind, VOICE), "Digital Marketing Consultant · AI Product Builder");
    assert.equal(positioningHeadline(growth.kind, VOICE), "Performance Marketer · AI Product Builder");
    assert.equal(positioningHeadline(ai.kind, VOICE), "AI Product Builder · Digital Marketing Strategist");
  });
});

describe("headline · precedence", () => {
  const ROLE = "Performance Marketer · AI Product Builder";

  it("should let a confirmed Your-details headline win", () => {
    assert.deepEqual(headlineFor({ headline: "Growth Operator", headlineConfirmed: true }, ROLE), { headline: "Growth Operator", source: "confirmed" });
  });

  it("should put the per-role headline over an unconfirmed (resume pre-filled) one", () => {
    assert.deepEqual(headlineFor({ headline: "Growth Marketing Leader - AI Product Builder" }, ROLE), { headline: ROLE, source: "role" });
    assert.deepEqual(headlineFor({ headline: "Growth Marketing Leader", headlineConfirmed: false }, ROLE), { headline: ROLE, source: "role" });
  });

  it("should fall back to the profile headline, then nothing", () => {
    assert.deepEqual(headlineFor({ headline: "Growth Marketing Leader" }, ""), { headline: "Growth Marketing Leader", source: "profile" });
    assert.deepEqual(headlineFor({ headlineConfirmed: true }, ""), { headline: "", source: "" });
    assert.deepEqual(headlineFor(null, ""), { headline: "", source: "" });
  });

  it("should apply the precedence in the render identity, over the resume's own line", () => {
    const resumeText = "Jordan Rivera\nDigital Sales Leader\nAustin, TX";
    assert.equal(renderIdentity({ profile: {}, resumeText, roleHeadline: ROLE }).target, ROLE);
    assert.equal(renderIdentity({ profile: { headline: "Pre-filled" }, resumeText, roleHeadline: ROLE }).target, ROLE);
    assert.equal(renderIdentity({ profile: { headline: "Mine", headlineConfirmed: true }, resumeText, roleHeadline: ROLE }).target, "Mine");
    assert.equal(renderIdentity({ profile: {}, resumeText }).target, "Digital Sales Leader", "no role headline: the resume's own line");
  });

  it("should keep a per-role headline on regenerate unless the user confirmed one", () => {
    const stored = { name: "Jordan Rivera", target: ROLE, targetSource: "role", contact: [{ kind: "email", text: "j@example.com" }] };
    assert.equal(overlayProfileIdentity(stored, { headline: "Pre-filled" }).target, ROLE);
    assert.equal(overlayProfileIdentity(stored, { headline: "Mine", headlineConfirmed: true }).target, "Mine");
    const legacy = { name: "Jordan Rivera", target: "Old", contact: [{ kind: "email", text: "j@example.com" }] };
    assert.equal(overlayProfileIdentity(legacy, { headline: "Pre-filled" }).target, "Pre-filled", "older packages keep today's behavior");
  });

  it("should not let the resume's own line replace a stored per-role headline", () => {
    const model = {
      contract: "materials.render-model.v1",
      provenance: { source: "claim-ledger-pipeline" },
      template: { family: "signal", version: "1.0", pageBudget: 1 },
      identity: { name: "Jordan Rivera", target: ROLE, targetSource: "role", contact: [{ kind: "email", text: "j@example.com" }] },
      documents: {},
    };
    const refreshed = refreshStoredModel(/** @type {any} */ (model), "Jordan Rivera\nDigital Sales Leader\nAustin, TX · j@example.com");
    assert.equal(refreshed.identity.target, ROLE);
  });
});

describe("headline · the confirmed flag in Your details", () => {
  function baseProfile() {
    return {
      version: 1,
      identity: { targetRoles: ["Director of Growth"], targetSeniority: "director", primaryNarrative: "Growth leader who builds AI-assisted marketing systems." },
      strengths: [{ name: "Lifecycle marketing", rank: 1 }],
      hardConstraints: { workMode: "remote_only" },
    };
  }

  it("should keep headlineConfirmed only beside a headline, and clear it when a save leaves it out", () => {
    assert.deepEqual(normalizeContact({ headline: "Mine", headlineConfirmed: true }), { headline: "Mine", headlineConfirmed: true });
    assert.deepEqual(normalizeContact({ headlineConfirmed: true }), {});
    assert.deepEqual(normalizeContact({ headline: "Mine", headlineConfirmed: "yes" }), { headline: "Mine" });
    const saved = withContact(baseProfile(), { headline: "Mine", headlineConfirmed: true });
    assert.equal(saved.identity.headlineConfirmed, true);
    const resaved = withContact(saved, { headline: "Mine" });
    assert.equal(resaved.identity.headlineConfirmed, undefined);
  });

  it("should be valid in the server schema and its client mirror", () => {
    const profile = baseProfile();
    Object.assign(profile.identity, { headline: "Mine", headlineConfirmed: true });
    assert.equal(validateProfile(profile).ok, true, JSON.stringify(validateProfile(profile).errors));
    const window = {};
    vm.runInContext(readFileSync(join(repoRoot, "fit-profile-schema.js"), "utf8"), vm.createContext({ window }));
    const S = /** @type {any} */ (window).JobBoredFitProfileSchema;
    assert.deepEqual(Array.from(S.validateProfile(profile).errors), []);
    profile.identity.headlineConfirmed = "yes";
    assert.equal(validateProfile(profile).ok, false);
    assert.ok(Array.from(S.validateProfile(profile).errors).some((e) => e.field === "identity.headlineConfirmed"));
  });

  it("should carry the flag through the details form's shape helpers", () => {
    const window = {};
    vm.runInContext(readFileSync(join(repoRoot, "profile-identity.js"), "utf8"), vm.createContext({ window, document: {}, console }));
    const P = /** @type {any} */ (window).JobBoredProfileIdentity;
    assert.deepEqual(JSON.parse(JSON.stringify(P.toContact({ headline: "Mine", headlineConfirmed: true }))), { headline: "Mine", headlineConfirmed: true });
    assert.deepEqual(JSON.parse(JSON.stringify(P.toContact({ headline: "Pre-filled", headlineConfirmed: false }))), { headline: "Pre-filled" });
    assert.equal(P.toValues({ headline: "Mine", headlineConfirmed: true }).headlineConfirmed, true);
    assert.equal(P.toValues({ headline: "Mine" }).headlineConfirmed, false);
  });
});
