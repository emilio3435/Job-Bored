/**
 * Synthetic people and the mocked provider for the JOBQA hermetic fixture
 * and its tests. Nobody here is real: every name, email, phone, employer
 * and link is invented, and the email domain is the reserved `.test` TLD.
 *
 *   Profile A, Morgan Existing: the saved setup already on the "machine"
 *     (profile, resume, voice guide, one queued application).
 *   Profile B, Alex Example: a fresh person onboarding. Alex's resume has
 *     NO phone and NO LinkedIn on purpose: if Morgan's (555) number or
 *     LinkedIn ever shows up in Alex's details, a saved-data leak happened.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import "../../../server/profile-draft-shared.js";
import { buildResumeRead } from "../../../server/resume-read.mjs";
import { writeCanonicalResume } from "../../../server/profile-resume-sync.mjs";
import { saveVoice } from "../../../server/profile-voice.mjs";
import { writeProfileAtomic } from "../../../server/user-profile.mjs";

/** @param {string | Buffer} value */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The account hash the browser stamps on drafts and commits: a consistency
 * check, not authentication. Must match onboarding-flow.js accountHashOf().
 * @param {string} email
 */
export function accountHashOf(email) {
  return sha256(`jobbored-account-v1:${String(email || "").trim().toLowerCase()}`);
}

export const MORGAN = Object.freeze({
  account: "a",
  email: "morgan.existing@fixture.test",
  givenName: "Morgan",
  phone: "(555) 010-4477",
  linkedin: "https://www.linkedin.com/in/morgan-existing-fixture",
  resumeText: [
    "Morgan Existing",
    "Principal Platform Architect",
    "morgan.existing@fixture.test | (555) 010-4477 | Portland, OR",
    "linkedin.com/in/morgan-existing-fixture",
    "",
    "SUMMARY",
    "Platform architect who keeps shared infrastructure boring and fast for twelve product teams.",
    "",
    "EXPERIENCE",
    "Principal Platform Architect, Harbor Freightline Labs (2019 – Present)",
    "- Led the move of 140 services to a shared deployment platform.",
    "Staff Engineer, Northwind Example Co (2014 – 2019)",
    "- Cut build times from 40 to 9 minutes across the monorepo.",
    "",
    "SKILLS",
    "Kubernetes, Terraform, Go, incident response",
  ].join("\n"),
  voice: "# Morgan's voice\n\nDirect, numbers first, no exclamation points. Morgan-only phrase: harbor lights.\n",
});

export const ALEX = Object.freeze({
  account: "b",
  email: "alex.example@fixture.test",
  givenName: "Alex",
  resumeText: [
    "Alex Example",
    "Product Operations Analyst",
    "alex.example@fixture.test | Austin, TX",
    "",
    "SUMMARY",
    "Operations analyst who turns messy intake queues into dashboards teams actually use.",
    "",
    "EXPERIENCE",
    "Product Operations Analyst, Juniper Example Works (2021 – Present)",
    "- Built the intake dashboard used by 6 support pods.",
    "Operations Associate, Bluebird Sample Supply (2018 – 2021)",
    "- Reconciled 2,000 weekly orders with a 99.4% match rate.",
    "",
    "SKILLS",
    "SQL, Looker, process mapping, stakeholder interviews",
  ].join("\n"),
});

/** Morgan's saved v1 profile, contact identity included. */
export function morganSavedProfile() {
  return {
    version: 1,
    identity: {
      targetRoles: ["Principal Platform Architect"],
      targetSeniority: "any",
      primaryNarrative: "Platform architect who keeps shared infrastructure boring and fast for twelve product teams.",
      fullName: "Morgan Existing",
      headline: "Principal Platform Architect",
      email: MORGAN.email,
      phone: MORGAN.phone,
      location: { city: "Portland", state: "OR" },
      links: { linkedin: MORGAN.linkedin },
    },
    strengths: [
      { name: "Kubernetes", rank: 1 },
      { name: "Terraform", rank: 2 },
    ],
    hardConstraints: { workMode: "any", salaryRequired: false, workAuth: "us_authorized" },
    experiences: [
      { slug: "harbor-freightline-labs", company: "Harbor Freightline Labs", title: "Principal Platform Architect", label: "Harbor Freightline Labs" },
    ],
  };
}

/** @param {string} value */
function slugOf(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "role";
}

const ROLE_RE = /^(.+?), (.+?) \((\d{4})\s*[–-]\s*(Present|\d{4})\)$/;

/**
 * MOCK provider: what POST /profile/from-resume answers in the fixture.
 * Deterministic, offline, and labeled: `read.by.provider` is "fixture-mock".
 * It reads only the text it is given (never a saved resume) and returns the
 * same { profile, read } shape the real analyzeResume does.
 * @param {string} resumeText
 */
export async function fixtureAnalyze(resumeText) {
  const text = String(resumeText || "");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines[0] || "";
  const headline = lines[1] || "";
  const email = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [""])[0];
  const phone = (text.match(/\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}/) || [""])[0];
  const location = (text.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)*, [A-Z]{2}\b/) || [""])[0];
  /** @param {string} value */
  const lineWith = (value) => lines.find((line) => line.includes(value)) || value;
  const summaryAt = lines.findIndex((line) => /^summary$/i.test(line));
  const summary = summaryAt >= 0 ? lines[summaryAt + 1] || "" : "";
  const skillsAt = lines.findIndex((line) => /^skills$/i.test(line));
  const skillsLine = skillsAt >= 0 ? lines[skillsAt + 1] || "" : "";
  const skills = skillsLine.split(",").map((skill) => skill.trim()).filter((skill) => skill.length >= 2);
  const experiences = lines
    .map((line) => line.match(ROLE_RE))
    .filter((match) => match !== null)
    .slice(0, 8)
    .map((match) => ({ slug: slugOf(match[2]), company: match[2], title: match[1], label: match[2] }));
  const raw = {
    identity: {
      targetRoles: [headline || "Open to discussion"],
      targetSeniority: "any",
      primaryNarrative: summary || `${name}, ${headline}`,
    },
    strengths: skills.slice(0, 5).map((skill, index) => ({ name: skill, rank: index + 1 })),
    hardConstraints: { workMode: "any" },
    resumeFacts: {
      contact: {
        name: name ? { text: name, sourceQuote: name } : null,
        email: email ? { text: email, sourceQuote: lineWith(email) } : null,
        phone: phone ? { text: phone, sourceQuote: lineWith(phone) } : null,
        location: location ? { text: location, sourceQuote: lineWith(location) } : null,
        links: [],
      },
      headline: headline ? { text: headline, sourceQuote: headline } : null,
      summary: summary ? { text: summary, sourceQuote: summary } : null,
      skills: skills.map((skill) => ({ text: skill, sourceQuote: skillsLine, kind: "hard" })),
    },
  };
  const shared = /** @type {any} */ (globalThis).JobBoredProfileDraft;
  const profile = shared.clampToUserProfile(raw);
  const read = buildResumeRead(text, {
    facts: shared.resumeFactsOf(raw),
    structure: null,
    by: { provider: "fixture-mock", model: "jobqa-canned-read" },
  });
  return {
    profile: experiences.length ? { ...profile, experiences } : profile,
    read: { ...read, fixtureMock: true },
  };
}

/**
 * The fixture store's files, one folder, no real home involved.
 * @param {string} storeDir
 */
export function storePaths(storeDir) {
  return {
    profile: join(storeDir, "profile.json"),
    resume: join(storeDir, "resume.txt"),
    read: join(storeDir, "resume-read.json"),
    voice: join(storeDir, "profile", "voice.md"),
    record: join(storeDir, "profile-commit.json"),
    journal: join(storeDir, "profile-commit.journal.json"),
    applications: join(storeDir, "applications"),
  };
}

/**
 * Seed the store. "existing": Morgan's saved setup and one queued
 * application, committed under Morgan's account. "empty": nothing.
 * @param {ReturnType<typeof storePaths>} paths
 * @param {"existing" | "empty"} seed
 */
export async function seedStore(paths, seed) {
  await mkdir(paths.applications, { recursive: true });
  if (seed !== "existing") return;
  await writeCanonicalResume(MORGAN.resumeText, { path: paths.resume });
  await writeProfileAtomic(morganSavedProfile(), { path: paths.profile });
  await saveVoice(MORGAN.voice, { path: paths.voice });
  const slug = "harbor-freightline-labs-staff-sre";
  await mkdir(join(paths.applications, slug), { recursive: true });
  await writeFile(
    join(paths.applications, slug, "pending.json"),
    `${JSON.stringify(
      {
        slug,
        company: "Harbor Freightline Labs",
        title: "Staff SRE (Morgan's queued draft)",
        feature: "cover_letter",
        job_url: "https://jobs.fixture.test/harbor-staff-sre",
        notes: "Morgan-only queue item: must never appear for Alex.",
        requested_at: "2026-09-01T12:00:00.000Z",
        source: "jobqa-fixture",
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(
    paths.record,
    `${JSON.stringify(
      {
        schema: 1,
        commitId: "jobqa-seed-morgan",
        payloadSha256: "seed",
        mode: "create",
        revision: "seed",
        accountHash: accountHashOf(MORGAN.email),
        committedAt: "2026-09-01T12:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

/**
 * Every file under `dir` with its size and sha256, sorted, plus one digest.
 * Before/after manifests prove what a UI run did or did not write.
 * @param {string} dir
 */
export async function manifestOf(dir) {
  /** @type {Array<{ path: string, bytes: number, sha256: string }>} */
  const files = [];
  /** @param {string} at */
  async function walk(at) {
    let entries;
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch (err) {
      if (/** @type {{ code?: unknown }} */ (err).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const bytes = await readFile(full);
        files.push({ path: relative(dir, full), bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await walk(dir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, digest: sha256(JSON.stringify(files)) };
}
