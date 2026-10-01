/**
 * JOBQA: two contexts on one server, over real HTTP.
 *
 * The fixture API (tests/fixtures/jobqa-hermetic/fixture-api.mjs) mounts the
 * REAL affected handlers — read-only parsing, contact suggestions, the
 * commit, the profile/resume/voice stores — on a temp store by injected
 * paths, with the AI provider MOCKED (fixtureAnalyze). HOME is never
 * changed. Morgan Existing's setup is saved; Alex Example is a fresh
 * browser onboarding on the same computer.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { resumeTextSha256 } from "../server/resume-read.mjs";
import { createFixtureApi } from "./fixtures/jobqa-hermetic/fixture-api.mjs";
import { ALEX, MORGAN, accountHashOf, manifestOf, morganSavedProfile, seedStore, storePaths } from "./fixtures/jobqa-hermetic/profiles.mjs";

const WEB = "http://127.0.0.1:18680";
let root;
let paths;
let server;
let base;
const log = [];

before(async () => {
  root = await mkdtemp(join(tmpdir(), "jobqa-two-context-"));
  paths = storePaths(join(root, "store"));
  await seedStore(paths, "existing");
  const app = createFixtureApi({ paths, webOrigins: [WEB], log: (entry) => log.push(entry) });
  server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

/** A browser request from the fixture page's origin. */
async function send(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { origin: WEB, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const storeManifest = () => manifestOf(join(root, "store"));

describe("JOBQA two contexts: Alex's preview never touches or reads Morgan's saved setup", () => {
  it("should draft Alex's profile from Alex's text alone and write nothing", async () => {
    const beforeManifest = await storeManifest();
    const { status, body } = await send("POST", "/profile/from-resume", { resumeText: ALEX.resumeText });
    assert.equal(status, 200);
    assert.equal(body.source, "staged_request");
    assert.equal(body.read.by.provider, "fixture-mock", "the provider is the labeled mock");
    const everything = JSON.stringify(body);
    assert.match(everything, /Alex Example/);
    assert.doesNotMatch(everything, /Morgan|555\) 010-4477|morgan-existing|harbor lights/i, "no Morgan data in Alex's draft");
    assert.deepEqual(await storeManifest(), beforeManifest, "parsing wrote no resume, read cache or profile");
    assert.equal(existsSync(paths.read), false, "no derived read cache from a preview");
  });

  it("should refuse garbled text instead of analyzing Morgan's saved resume", async () => {
    const garbled = "S ummary\nE xperience a t H arbor F reightline L abs d id t hings w ith p latforms\n".repeat(8);
    const { status, body } = await send("POST", "/profile/from-resume", { resumeText: garbled });
    assert.equal(status, 422);
    assert.equal(body.reason, "resume_garbled");
    assert.doesNotMatch(JSON.stringify(body), /Morgan/);
  });

  it("should refuse a request with no text rather than read the saved resume", async () => {
    const { status, body } = await send("POST", "/profile/from-resume", {});
    assert.equal(status, 400);
    assert.equal(body.reason, "resume_empty");
  });

  it("should suggest only Alex's contact details — Morgan's phone and LinkedIn never fill Alex's gaps", async () => {
    const { body } = await send("POST", "/profile/contact/suggest", { resumeText: ALEX.resumeText });
    assert.equal(body.source, "request");
    assert.equal(body.values.email, ALEX.email);
    assert.equal(body.values.phone, undefined, "Alex's resume has no phone; Morgan's must not appear");
    assert.equal(body.values.links && body.values.links.linkedin, undefined);
    assert.doesNotMatch(JSON.stringify(body), /Morgan|morgan/);
  });

  it("should refuse Alex's commit on a computer where Morgan's setup is saved, changing nothing", async () => {
    const beforeManifest = await storeManifest();
    const { status, body } = await send("POST", "/profile/commit", {
      commitId: "jobqa-http-alex-01",
      mode: "create",
      resumeText: ALEX.resumeText,
      profile: {
        version: 1,
        identity: { targetRoles: ["Analyst"], targetSeniority: "any", primaryNarrative: "Operations analyst who builds dashboards.", fullName: "Alex Example" },
        strengths: [{ name: "SQL", rank: 1 }],
        hardConstraints: { workMode: "any" },
      },
      accountHash: accountHashOf(ALEX.email),
    });
    assert.equal(status, 409);
    assert.equal(body.reason, "canonical_profile_exists");
    assert.deepEqual(await storeManifest(), beforeManifest, "Morgan's setup is byte-for-byte unchanged");
  });

  it("should let Morgan's own browser replace Morgan's setup with proof, and keep the read only for the saved text", async () => {
    const state = await send("GET", "/profile/commit/state");
    assert.equal(state.body.exists, true);
    const updated = `${MORGAN.resumeText}\nNew: led the 2026 platform rewrite.`;
    const { status, body } = await send("POST", "/profile/commit", {
      commitId: "jobqa-http-morgan-01",
      mode: "replace",
      resumeText: updated,
      profile: morganSavedProfile(),
      accountHash: accountHashOf(MORGAN.email),
      proof: resumeTextSha256(MORGAN.resumeText),
      baseRevision: state.body.revision,
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.match(await readFile(paths.resume, "utf8"), /2026 platform rewrite/);

    // An editor re-reading a DIFFERENT text with persistRead keeps nothing...
    await send("POST", "/profile/from-resume", { resumeText: ALEX.resumeText, persistRead: true });
    assert.equal(existsSync(paths.read), false);
    // ...and re-reading the saved text keeps the read for the Settings panel.
    await send("POST", "/profile/from-resume", { resumeText: updated, persistRead: true });
    assert.equal(existsSync(paths.read), true);
  });

  it("should refuse unknown routes and foreign origins", async () => {
    const unknown = await send("GET", "/__proxy/full-boot");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.reason, "fixture_unknown_route");
    const foreign = await fetch(`${base}/profile`, { headers: { origin: "https://evil.example" } });
    assert.equal(foreign.status, 403);
  });
});
