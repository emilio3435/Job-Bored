/**
 * "Your details" — the user's confirmed name and contact on the fit profile.
 *
 * Jordan's Seabright resume and letter rendered the name "Candidate" with
 * only a phone number: profile.json had no contact fields, so the renderer
 * read identity off the first line of whatever resume text the application
 * carried, and that text was garbage. These tests pin the fix end to end:
 *
 *   - the resume parser proposes each field with a confidence, never saves;
 *   - the schema (server ajv + client mirror) accepts the new optional
 *     fields and rejects bad email / phone / URL formats;
 *   - an old profile still loads, and a hand-edited one is migrated;
 *   - POST /profile from an older editor keeps the saved details;
 *   - the render adapter prefers the profile over the resume, so the name
 *     is never "Candidate" and the letter carries email and links.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  carryForwardContact,
  contactOf,
  migrateProfile,
  normalizeContact,
  profileForLedger,
  suggestIdentityFromResume,
  suggestionValues,
  withContact,
} from "../server/profile-identity.mjs";
import { readProfile, validateProfile, writeProfileAtomic } from "../server/user-profile.mjs";
import {
  buildRenderModelFromDraft,
  buildRenderModelFromWriter,
  overlayProfileIdentity,
} from "../server/materials-render-model-adapter.mjs";
import { renderDocument, validateRenderModel } from "../server/materials-render.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A realistic resume header: nickname, shouted name, one-line contact bar. */
const RESUME = `JORDAN “JO” RIVERA
Growth Marketing Leader · AI Product Builder
Austin, TX | (512) 555-0147 | jordan.rivera@example.com | linkedin.com/in/jordan-rivera | jordanrivera.dev | github.com/jrivera

SUMMARY
Marketing leader who ships AI products.

EXPERIENCE
Acme Analytics — Director of Growth                          2020 – Present
- Grew self-serve revenue 42% by rebuilding the trial funnel
- Led a team of 9 across lifecycle, paid and analytics

EDUCATION
University of Texas at Austin, BBA Marketing
`;

/** The garbage the Seabright application carried instead of a resume. */
const GARBLED = "Page 1 of 3 ::: %PDF-1.7 obj 12 0 R\n555-010-9999\nlorem ipsum";

function baseProfile() {
  return {
    version: 1,
    identity: {
      targetRoles: ["Director of Growth"],
      targetSeniority: "director",
      primaryNarrative: "Growth leader who builds AI-assisted marketing systems.",
    },
    strengths: [{ name: "Lifecycle marketing", rank: 1 }],
    hardConstraints: { workMode: "remote_only" },
  };
}

const CONTACT = {
  fullName: "Jordan Rivera",
  headline: "Growth Marketing Leader",
  email: "jordan.rivera@example.com",
  phone: "(512) 555-0147",
  location: { city: "Austin", state: "TX" },
  links: {
    linkedin: "https://linkedin.com/in/jordan-rivera",
    website: "https://jordanrivera.dev",
    github: "https://github.com/jrivera",
    other: [{ label: "Talk", url: "https://example.com/talk" }],
  },
};

describe("suggestIdentityFromResume · pre-fill from a realistic resume", () => {
  it("should propose every field the header names, each with a confidence", () => {
    const s = suggestIdentityFromResume(RESUME);
    assert.equal(s.fullName?.value, "Jordan Rivera", "nickname stripped, shouting title-cased");
    assert.equal(s.headline?.value, "Growth Marketing Leader · AI Product Builder");
    assert.equal(s.email?.value, "jordan.rivera@example.com");
    assert.equal(s.phone?.value, "(512) 555-0147");
    assert.deepEqual(s.location?.value, { city: "Austin", state: "TX" });
    assert.equal(s.links.linkedin?.value, "https://linkedin.com/in/jordan-rivera");
    assert.equal(s.links.website?.value, "https://jordanrivera.dev");
    assert.equal(s.links.github?.value, "https://github.com/jrivera");
    for (const entry of [s.fullName, s.headline, s.email, s.phone, s.location, s.links.linkedin]) {
      assert.ok(entry && entry.confidence > 0 && entry.confidence <= 1, "a confidence in (0, 1]");
    }
    assert.ok(s.email.confidence > s.links.website.confidence, "an email is surer than a bare domain");
  });

  it("should flatten suggestions into a contact the schema accepts", () => {
    const values = suggestionValues(suggestIdentityFromResume(RESUME));
    const profile = { ...baseProfile(), identity: { ...baseProfile().identity, ...values } };
    const result = validateProfile(profile);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("should never read a place as the headline, and find a headline under the contact line", () => {
    const s = suggestIdentityFromResume("Sam Lee\nsam@example.org • 555.010.2222 • Austin, CO\nSenior Data Scientist\n");
    assert.equal(s.headline?.value, "Senior Data Scientist");
    assert.deepEqual(s.location?.value, { city: "Austin", state: "CO" });
    const placeOnly = suggestIdentityFromResume("Sam Lee\nAustin, CO\n");
    assert.equal(placeOnly.headline, null);
  });

  it("should return nothing to suggest (not a guess) for empty or garbled text", () => {
    const empty = suggestIdentityFromResume("");
    assert.equal(empty.fullName, null);
    assert.equal(empty.email, null);
    const garbled = suggestIdentityFromResume(GARBLED);
    assert.equal(garbled.fullName, null, "no name off a PDF-junk first line");
    assert.equal(garbled.email, null);
  });

  it("should be pure: same input, same output, no I/O", () => {
    assert.deepEqual(suggestIdentityFromResume(RESUME), suggestIdentityFromResume(RESUME));
  });
});

describe("schema · contact identity fields (server ajv)", () => {
  it("should accept a profile with every contact field", () => {
    const profile = baseProfile();
    Object.assign(profile.identity, CONTACT);
    const result = validateProfile(profile);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("should accept an old profile with no contact fields (all optional)", () => {
    assert.equal(validateProfile(baseProfile()).ok, true);
  });

  it("should reject a bad email, a phone without 7 digits, a non-http link, a 4th other link and unknown keys", () => {
    const cases = [
      [{ email: "jordan.example.com" }, "/identity/email"],
      [{ phone: "(-----1" }, "/identity/phone"],
      [{ phone: "call me" }, "/identity/phone"],
      [{ links: { linkedin: "ftp://linkedin.com/in/x" } }, "/identity/links/linkedin"],
      [{ links: { website: "not a url" } }, "/identity/links/website"],
      [
        {
          links: {
            other: [1, 2, 3, 4].map((n) => ({ label: `L${n}`, url: `https://example.com/${n}` })),
          },
        },
        "/identity/links/other",
      ],
      [{ links: { twitter: "https://x.com/j" } }, "/identity/links"],
      [{ location: { city: "Austin", zip: "78701" } }, "/identity/location"],
      [{ nickname: "Jo" }, "/identity"],
    ];
    for (const [patch, path] of cases) {
      const profile = baseProfile();
      Object.assign(profile.identity, patch);
      const result = validateProfile(profile);
      assert.equal(result.ok, false, `should reject ${JSON.stringify(patch)}`);
      assert.ok(
        result.errors.some((e) => e.instancePath === path || e.instancePath.startsWith(`${path}/`)),
        `${JSON.stringify(patch)} → ${path}: ${JSON.stringify(result.errors.map((e) => e.instancePath))}`,
      );
    }
  });

  it("should keep the vendored server/contracts schema byte-identical to the canonical one", () => {
    const canonical = readFileSync(
      join(repoRoot, "integrations/browser-use-discovery/src/contracts/user-profile.schema.json"),
      "utf8",
    );
    assert.equal(readFileSync(join(repoRoot, "server/contracts/user-profile.schema.json"), "utf8"), canonical);
  });
});

describe("schema · the client mirror (fit-profile-schema.js) agrees with the server", () => {
  function clientSchema() {
    const window = {};
    vm.runInContext(readFileSync(join(repoRoot, "fit-profile-schema.js"), "utf8"), vm.createContext({ window }));
    return window.JobBoredFitProfileSchema;
  }

  it("should pass the same full profile and fail the same bad fields", () => {
    const S = clientSchema();
    const good = baseProfile();
    Object.assign(good.identity, CONTACT);
    assert.deepEqual(Array.from(S.validateProfile(good).errors), []);
    const bad = baseProfile();
    Object.assign(bad.identity, {
      email: "nope",
      phone: "12",
      links: { website: "example.com", other: [{ label: "", url: "https://x.dev" }] },
    });
    assert.deepEqual(
      Array.from(S.validateProfile(bad).errors, (e) => e.field),
      ["identity.email", "identity.phone", "identity.links.website", "identity.links.other[0].label"],
    );
    for (const e of S.validateProfile(bad).errors) assert.ok(e.message.length > 10, "a human message");
    assert.equal(validateProfile(bad).ok, false, "the server refuses the same profile");
  });

  it("should validate the contact half alone, with caller-chosen paths", () => {
    const S = clientSchema();
    assert.deepEqual(Array.from(S.validateContact({ email: "a@b" }, ""), (e) => e.field), ["email"]);
    assert.deepEqual(Array.from(S.validateContact({}, "")), []);
  });
});

describe("migration + backcompat · older and hand-edited profiles", () => {
  let dir;
  const saved = process.env.JOBBORED_PROFILE_PATH;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "jb-profile-identity-"));
    process.env.JOBBORED_PROFILE_PATH = join(dir, "profile.json");
  });

  after(() => {
    if (saved === undefined) delete process.env.JOBBORED_PROFILE_PATH;
    else process.env.JOBBORED_PROFILE_PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it("should load an old profile unchanged — same object, same ledger hash input", async () => {
    const old = baseProfile();
    assert.equal(migrateProfile(old), old, "no contact keys → untouched");
    assert.equal(profileForLedger(old), old);
    writeFileSync(process.env.JOBBORED_PROFILE_PATH, JSON.stringify(old));
    const read = await readProfile();
    assert.equal(read.ok, true);
    assert.deepEqual(read.profile, old);
    assert.equal(read.profile.identity.fullName, undefined);
  });

  it("should migrate a hand-edited file: 'City, ST' string, bare links, nickname, blanks", async () => {
    const edited = baseProfile();
    Object.assign(edited.identity, {
      fullName: "Jordan “Jo” Rivera",
      email: "  jordan.rivera@example.com ",
      phone: "",
      location: "Austin, TX",
      links: { linkedin: "linkedin.com/in/jordan-rivera", portfolio: "jordanrivera.dev" },
    });
    writeFileSync(process.env.JOBBORED_PROFILE_PATH, JSON.stringify(edited));
    const read = await readProfile();
    assert.equal(read.ok, true, JSON.stringify(read.errors));
    assert.deepEqual(contactOf(read.profile.identity), {
      fullName: "Jordan Rivera",
      email: "jordan.rivera@example.com",
      location: { city: "Austin", state: "TX" },
      links: {
        linkedin: "https://linkedin.com/in/jordan-rivera",
        website: "https://jordanrivera.dev",
      },
    });
  });

  it("should keep saved details when an older editor POSTs identity without them", async () => {
    const prior = withContact(baseProfile(), CONTACT);
    const fromOldEditor = baseProfile();
    fromOldEditor.identity.targetRoles = ["VP Growth"];
    const merged = carryForwardContact(fromOldEditor, prior);
    assert.deepEqual(merged.identity.targetRoles, ["VP Growth"], "the edit lands");
    assert.equal(merged.identity.fullName, "Jordan Rivera", "the name survives");
    assert.deepEqual(merged.identity.links, prior.identity.links);
    const explicit = carryForwardContact(
      { ...fromOldEditor, identity: { ...fromOldEditor.identity, email: "new@example.com" } },
      prior,
    );
    assert.equal(explicit.identity.email, "new@example.com", "a key the editor sends wins");
  });

  it("should clear a field the details form leaves empty (withContact replaces the contact half)", async () => {
    const prior = withContact(baseProfile(), CONTACT);
    const next = withContact(prior, { ...CONTACT, phone: "", links: { linkedin: CONTACT.links.linkedin } });
    assert.equal(next.identity.phone, undefined);
    assert.deepEqual(next.identity.links, { linkedin: CONTACT.links.linkedin });
    assert.deepEqual(next.identity.targetRoles, prior.identity.targetRoles, "search intent untouched");
    await writeProfileAtomic(next);
    const read = await readProfile();
    assert.equal(read.ok, true);
    assert.equal(read.profile.identity.phone, undefined);
  });

  it("should leave contact details out of the claim ledger's profile hash", () => {
    const withDetails = withContact(baseProfile(), CONTACT);
    assert.deepEqual(profileForLedger(withDetails), baseProfile());
  });

  it("should normalize legacy link arrays into named slots and up to three others", () => {
    const out = normalizeContact({
      links: [
        "https://www.linkedin.com/in/jr",
        { label: "Portfolio", url: "jr.design" },
        "github.com/jr",
        { label: "Blog", url: "blog.jr.dev" },
        { label: "Talk", url: "https://example.com/t" },
        { label: "Pod", url: "https://example.com/p" },
        { label: "Extra", url: "https://example.com/x" },
      ],
    });
    assert.equal(out.links.linkedin, "https://www.linkedin.com/in/jr");
    assert.equal(out.links.website, "https://jr.design");
    assert.equal(out.links.github, "https://github.com/jr");
    assert.equal(out.links.other.length, 3);
  });
});

describe("render adapter · the confirmed profile wins, the resume fills gaps", () => {
  const ledger = {
    employers: [{ id: "acme", name: "Acme Analytics", title: "Director of Growth" }],
    claims: [
      { id: "acme-1", employerId: "acme", kind: "outcome", text: "Grew self-serve revenue 42% by rebuilding the trial funnel" },
      { id: "acme-2", employerId: "acme", kind: "outcome", text: "Led a team of 9 across lifecycle, paid and analytics" },
    ],
  };
  const draft = {
    statement: "Growth leader who ships AI products.",
    bullets: [
      { claimId: "acme-1", text: "Grew self-serve revenue 42% by rebuilding the trial funnel" },
      { claimId: "acme-2", text: "Led a team of 9 across lifecycle, paid and analytics" },
    ],
    letter: {
      hook: "Your team is rebuilding how agencies buy media, and I build the systems that make that work.",
      proof1: "At Acme Analytics I grew self-serve revenue 42% by rebuilding the trial funnel end to end.",
      proof2: "I led a team of 9 across lifecycle, paid and analytics while shipping AI tooling.",
      ask: "I would welcome a conversation about the role.",
    },
  };
  const outline = { featured: [{ employerId: "acme", claimIds: ["acme-1", "acme-2"] }], earlier: [], toolsLine: [] };
  const request = { company: "Seabright", title: "VP, AI Strategy" };
  const family = resolveFamily("signal");

  function draftModel(profile, resumeText = GARBLED) {
    return buildRenderModelFromDraft({
      draft,
      outline,
      ledger,
      resumeText,
      profile,
      request,
      family,
      marks: [],
      nowIso: "2026-09-27T00:00:00.000Z",
    });
  }

  it("should never name the candidate 'Candidate' when the profile has fullName (garbled resume)", () => {
    const before = draftModel(undefined);
    assert.equal(before.identity.name, "Candidate", "the bug this fixes: garbage resume → Candidate");
    const model = draftModel(withContact(baseProfile(), CONTACT).identity);
    assert.equal(model.identity.name, "Jordan Rivera");
    assert.equal(model.identity.target, "Growth Marketing Leader");
    assert.equal(validateRenderModel(model).ok, true, JSON.stringify(validateRenderModel(model).errors));
  });

  it("should put the full contact block on the letter as clickable links", () => {
    const model = draftModel(withContact(baseProfile(), CONTACT).identity);
    const kinds = model.identity.contact.map((c) => c.kind);
    assert.deepEqual(kinds, ["location", "phone", "email", "linkedin", "site", "github", "other"]);
    const html = renderDocument(model, "coverLetter");
    assert.match(html, /Jordan Rivera/);
    assert.match(html, /Growth Marketing Leader/);
    assert.match(html, /href="mailto:jordan\.rivera@example\.com"/);
    assert.match(html, /href="tel:5125550147"/);
    assert.match(html, /href="https:\/\/linkedin\.com\/in\/jordan-rivera"/);
    assert.match(html, /href="https:\/\/jordanrivera\.dev"/);
    assert.match(html, /Austin, TX/);
    assert.doesNotMatch(html, />Candidate</);
  });

  it("should give every template family links, not only Signal", () => {
    const model = draftModel(withContact(baseProfile(), CONTACT).identity);
    for (const id of ["signal", "dossier", "editorial"]) {
      const html = renderDocument({ ...model, template: { ...model.template, family: id } }, "coverLetter");
      assert.match(html, /href="mailto:jordan\.rivera@example\.com"/, `${id}: email link`);
      assert.match(html, /href="https:\/\/linkedin\.com\/in\/jordan-rivera"/, `${id}: LinkedIn link`);
    }
  });

  it("should fill only the empty profile fields from the resume", () => {
    const partial = { ...baseProfile().identity, fullName: "Jordan Rivera" };
    const model = draftModel(partial, RESUME);
    assert.equal(model.identity.name, "Jordan Rivera");
    const email = model.identity.contact.find((c) => c.kind === "email");
    assert.equal(email?.text, "jordan.rivera@example.com", "the resume fills the email gap");
    const confirmed = draftModel({ ...partial, email: "work@example.com" }, RESUME);
    const emails = confirmed.identity.contact.filter((c) => c.kind === "email");
    assert.deepEqual(emails.map((c) => c.text), ["work@example.com"], "the profile's email wins, no duplicate");
  });

  it("should prefer the profile in the writer path too, over the writer's header", () => {
    const model = buildRenderModelFromWriter({
      writerJson: { resume: { header: { name: "Resume Header Name", headline: "Header headline" } }, letter: {} },
      resumeText: GARBLED,
      profile: withContact(baseProfile(), CONTACT).identity,
      request,
      family,
      nowIso: "2026-09-27T00:00:00.000Z",
    });
    assert.equal(model.identity.name, "Jordan Rivera");
    assert.equal(model.identity.target, "Growth Marketing Leader");
    assert.ok(model.identity.contact.some((c) => c.kind === "email" && c.href === "mailto:jordan.rivera@example.com"));
  });

  it("should overlay the profile on a stored model when regenerating", () => {
    const stored = draftModel(undefined).identity;
    const next = overlayProfileIdentity(stored, withContact(baseProfile(), CONTACT).identity);
    assert.equal(next.name, "Jordan Rivera");
    assert.ok(next.contact.some((c) => c.kind === "linkedin"));
    assert.equal(overlayProfileIdentity(stored, null), stored, "no profile → stored identity stands");
  });
});
