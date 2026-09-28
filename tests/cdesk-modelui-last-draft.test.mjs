/**
 * CDESK MODELUI: GET /api/llm-config carries `lastDraft`, the model the
 * newest drafted package actually used (read from its run.json pin block).
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAST_DRAFT_MAX_READS, readLastDraft } from "../server/materials-last-draft.mjs";
import { handleGetLlmConfig } from "../server/llm-config.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function writePackage(root, slug, { run, manifest }) {
  const dir = join(root, slug);
  await mkdir(dir, { recursive: true });
  if (run !== undefined) {
    await writeFile(join(dir, "run.json"), typeof run === "string" ? run : JSON.stringify(run));
  }
  if (manifest) await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
}

describe("readLastDraft", () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jb-last-draft-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("should read at most 20 run.json files, newest first by run.json mtime", async () => {
    assert.equal(LAST_DRAFT_MAX_READS, 20);
    const base = Date.parse("2026-09-27T00:00:00.000Z");
    // 25 packages; package k's run.json is k hours older than package 0's.
    for (let k = 0; k < 25; k += 1) {
      const slug = `pkg-${String(k).padStart(2, "0")}`;
      const pinned = k === 19 || k === 20;
      await writePackage(root, slug, {
        run: {
          feature: "resume",
          // Package 20 claims the newest finish, but it sits past the cap.
          finishedAt: new Date(base + (k === 20 ? 5 : 1) * 3600000).toISOString(),
          ...(pinned ? { pin: { provider: "gemini", requestedModel: `m-${k}`, resolvedModel: `m-${k}` } } : {}),
        },
      });
      const at = new Date(base - k * 3600000);
      await utimes(join(root, slug, "run.json"), at, at);
    }
    const last = await readLastDraft({ root });
    assert.ok(last, "the 20th-newest run.json is still read");
    assert.equal(last.slug, "pkg-19", "the 21st-newest run.json is never read");
  });

  it("should return the newest run that carries a model pin, with its role", async () => {
    await writePackage(root, "acme-platform-engineer", {
      run: {
        feature: "resume",
        finishedAt: "2026-09-26T10:00:00.000Z",
        pin: { provider: "gemini", requestedModel: "gemini-flash", resolvedModel: "gemini-flash-latest" },
      },
      manifest: { company: "Acme", title: "Platform Engineer" },
    });
    await writePackage(root, "globex-data-lead", {
      run: {
        feature: "cover_letter",
        finishedAt: "2026-09-27T09:30:00.000Z",
        pin: { provider: "gemini", requestedModel: "gemini-3.8-flash", resolvedModel: "gemini-3.8-flash" },
      },
      manifest: { company: "Globex", title: "Data Lead" },
    });
    // Newer, but a regenerate: no LLM call, no pin. Skipped.
    await writePackage(root, "initech-analyst", {
      run: { feature: "resume", finishedAt: "2026-09-27T11:00:00.000Z" },
    });

    const last = await readLastDraft({ root });
    assert.deepEqual(last, {
      slug: "globex-data-lead",
      company: "Globex",
      title: "Data Lead",
      feature: "cover_letter",
      provider: "gemini",
      requestedModel: "gemini-3.8-flash",
      resolvedModel: "gemini-3.8-flash",
      finishedAt: "2026-09-27T09:30:00.000Z",
    });
  });

  it("should return null when the root is missing or no run is readable", async () => {
    assert.equal(await readLastDraft({ root: join(root, "does-not-exist") }), null);
    await writePackage(root, "broken-run", { run: "{not json" });
    await writePackage(root, "no-time", {
      run: { pin: { provider: "gemini", resolvedModel: "gemini-flash-latest" } },
    });
    assert.equal(await readLastDraft({ root }), null);
  });
});

describe("GET /api/llm-config lastDraft", () => {
  let dir;
  let env;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-llm-last-"));
    env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
    await writeFile(
      env.JOBBORED_LLM_CONFIG_PATH,
      JSON.stringify({ provider: "gemini", model: "gemini-3.8-flash", apiKey: "secret-key", baseUrl: "" }),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should add lastDraft next to the redacted pin", async () => {
    const lastDraft = { slug: "acme", resolvedModel: "gemini-3.8-flash", finishedAt: "2026-09-27T09:30:00.000Z" };
    const res = mockRes();
    await handleGetLlmConfig({}, res, env, { readLastDraft: async () => lastDraft });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.model, "gemini-3.8-flash");
    assert.deepEqual(res.body.lastDraft, lastDraft);
    assert.equal("apiKey" in res.body, false);
    assert.equal(JSON.stringify(res.body).includes("secret-key"), false);
  });

  it("should still answer the pin when the last-draft reader throws", async () => {
    const res = mockRes();
    await handleGetLlmConfig({}, res, env, {
      readLastDraft: async () => {
        throw new Error("disk gone");
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.model, "gemini-3.8-flash");
    assert.equal("lastDraft" in res.body, false);
  });

  it("should carry lastDraft on the 404 when no pin is configured", async () => {
    await rm(env.JOBBORED_LLM_CONFIG_PATH);
    const res = mockRes();
    await handleGetLlmConfig({}, res, env, { readLastDraft: async () => ({ slug: "acme" }) });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "llm_unconfigured");
    assert.deepEqual(res.body.lastDraft, { slug: "acme" });
  });
});
