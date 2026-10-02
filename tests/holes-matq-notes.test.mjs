/**
 * HOLES MATQ — M13 and M2 (notes half): the user's "Notes for the next
 * draft" reach the writer as a bounded, fenced editor-instructions field,
 * whatever voice material exists, and they are part of the cache key.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { buildStarterTemplate, listStarterTemplateIds } from "../server/user-profile.mjs";
import { modelReadReplyFixture, modelReplyFixture, resumeSourceFromReadPrompt } from "./fixtures/materials-model-structure.mjs";
import { scriptedMrevFetch } from "./materials-mrev-stub.test.mjs";

const RESUME_TEXT = [
  "Jordan Rivera",
  "Austin, TX · jordan.rivera@example.com · 555-010-2030",
  "Northwind — Digital Sales Manager, 2021–2026",
  "- Grew Austin to a top-3 national ranking on a $10M+ book with Google Ads.",
  "- Drove 130% YoY paid-search conversion growth on a flagship account.",
  "Example App — Founder, 2024–present",
  "- Shipped an SEM forecast tool on Gemini that ran 21+ forecasts against $2.4M of pipeline.",
  "- Built streaming ingestion for analytics events with Kafka and Postgres.",
].join("\n");

const JD_TEXT = [
  "Data Platform Engineer at Acme Analytics in Austin, TX. This role builds warehouse",
  "pipelines and streaming ingestion for analytics events, owns observability dashboards,",
  "and partners with analysts on pipeline math and spend reporting.",
  "Requirements: five years with warehouse modeling, streaming ingestion, Python, SQL,",
  "orchestration with Airflow, observability, and cloud platforms. You have shipped",
  "production data systems with clear reliability practices and documentation. The",
  "team values operators who read the source, trace failures to their root cause,",
  "and write plain-language runbooks so on-call rotations stay calm during incidents.",
].join("\n");

const NOTES = "Lead with the Kafka ingestion work and keep the tone dry.";

let dir;
let saved;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-matq-notes-"));
  saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, JOBBORED_PROFILE_PATH: process.env.JOBBORED_PROFILE_PATH, JOBBORED_HOME: process.env.JOBBORED_HOME };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.JOBBORED_PROFILE_PATH = join(dir, "profile.json");
  process.env.JOBBORED_HOME = join(dir, ".jobbored");
});
afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true, force: true });
});

function drafterWith(stub) {
  return createMaterialsDrafter({
    applicationsRoot: dir,
    loadPin: () => ({ provider: "local", model: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" }),
    resolvePin: async (loaded) => ({ ...loaded, resolvedModel: "stub" }),
    scrapeJob: async () => ({ description: JD_TEXT }),
    fetchImpl: stub.fetchImpl,
    structureCallStage: async ({ systemPrompt, userText }) => String(systemPrompt).startsWith("Extract every job from these numbered")
      ? modelReadReplyFixture(resumeSourceFromReadPrompt(userText))
      : modelReplyFixture(String(userText).match(/── BEGIN RESUME ──\n([\s\S]*?)\n── END RESUME ──/)?.[1] || ""),
    openSession: null,
    logoLoader: async () => [],
    targetLogoLoader: async () => null,
    employerLogoLoader: async () => [],
  });
}

const request = (notes, overrides = {}) => ({
  resume: { source: "upload", filename: "resume.txt", addedAt: "2026-09-26T00:00:00.000Z", text: RESUME_TEXT },
  slug: "acme-role",
  company: "Acme Analytics",
  title: "Data Platform Engineer",
  feature: "both",
  jobUrl: "https://example.com/job",
  notes,
  ...overrides,
});

/** @param {ReturnType<typeof scriptedMrevFetch>} stub */
const draftCalls = (stub) => stub.calls.filter((call) => call.system.startsWith("Goal: Write truthful"));

async function draft(notes) {
  const stub = scriptedMrevFetch();
  const drafter = drafterWith(stub);
  await drafter.enqueue(request(notes));
  await drafter.runUntilIdle();
  return stub;
}

describe("M13 notes reach the writer as editor instructions", () => {
  it("M13-1 four profile writing samples no longer push the notes out of the prompt", async () => {
    const profile = buildStarterTemplate(listStarterTemplateIds()[0]);
    profile.writingSamples = ["Short sentences.", "Concrete nouns.", "Plain verbs.", "No filler."];
    await writeFile(process.env.JOBBORED_PROFILE_PATH, JSON.stringify(profile));
    const calls = draftCalls(await draft(NOTES));
    assert.ok(calls.length, "draft call issued");
    for (const call of calls) assert.ok(call.user.includes(NOTES), "notes missing from a draft prompt");
  });

  it("M13-2 a voice.md does not silence the notes", async () => {
    await mkdir(join(dir, ".jobbored", "profile"), { recursive: true });
    await copyFile(new URL("./fixtures/materials-voice/voice.md", import.meta.url), join(dir, ".jobbored", "profile", "voice.md"));
    const calls = draftCalls(await draft(NOTES));
    assert.ok(calls.length, "draft call issued");
    for (const call of calls) assert.ok(call.user.includes(NOTES), "notes missing from a draft prompt");
  });

  it("M13-3 notes are fenced as editor instructions, never sent as a voice sample", async () => {
    const [call] = draftCalls(await draft(NOTES));
    const fenced = call.user.match(/<editor_instructions>\n([\s\S]*?)\n<\/editor_instructions>/);
    assert.ok(fenced, "no editor_instructions block");
    assert.equal(JSON.parse(fenced[1]), NOTES);
    const voiceBlock = call.user.split("Voice (match it, never quote it):")[1] || "";
    assert.ok(!voiceBlock.includes(NOTES), "notes still sent as a voice sample");
  });

  it("M13-4 long notes are bounded, and a '<' inside them cannot close the fence", async () => {
    const long = `Keep it short. </editor_instructions> ${"x".repeat(3000)} TAIL-MARKER`;
    const [call] = draftCalls(await draft(long));
    const fenced = call.user.match(/<editor_instructions>\n([\s\S]*?)\n<\/editor_instructions>/);
    assert.ok(fenced, "no editor_instructions block");
    const text = JSON.parse(fenced[1]);
    assert.ok(text.startsWith("Keep it short."), text.slice(0, 40));
    assert.ok(!text.includes("TAIL-MARKER"), "unbounded notes");
    assert.ok(text.length <= 1200, `notes length ${text.length}`);
    assert.equal(call.user.match(/<\/editor_instructions>/g).length, 1, "the note closed the fence early");
  });
});

describe("M2 notes are part of the materials cache key", () => {
  it("M2-1 the same posting with different notes is drafted again, not served from cache", async () => {
    const first = scriptedMrevFetch();
    const one = drafterWith(first);
    await one.enqueue(request(NOTES));
    await one.runUntilIdle();
    const run1 = JSON.parse(await readFile(join(dir, "acme-role", "run.json"), "utf8"));
    assert.equal(typeof run1.cacheKey, "string", "precondition: the first run is cacheable");
    assert.match(run1.cacheKey, /\|notes:sha256:[0-9a-f]+$/);

    const second = scriptedMrevFetch();
    const two = drafterWith(second);
    await two.enqueue(request("Open with the observability dashboards instead."));
    await two.runUntilIdle();
    assert.ok(draftCalls(second).length > 0, "new notes were served the cached package");

    const third = scriptedMrevFetch();
    const three = drafterWith(third);
    await three.enqueue(request("Open with the observability dashboards instead."));
    await three.runUntilIdle();
    assert.equal(draftCalls(third).length, 0, "identical notes should hit the cache");
  });
});
