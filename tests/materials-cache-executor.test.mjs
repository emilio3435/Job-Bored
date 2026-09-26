import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  PIPELINE_PROMPT_VERSION,
  findCachedPackage,
  pipelineCacheKey,
} from "../server/materials-cache.mjs";
import {
  listExecutors,
  resolveExecutor,
  runStageWithExecutor,
} from "../server/materials-executor.mjs";

describe("cache key", () => {
  it("keys on jd, ledger, template@version, prompts, budgets, feature", () => {
    const base = {
      jdHash: "sha256:aaaa",
      ledgerHash: "sha256:bbbb",
      templateFamily: "hermes-classic",
      templateVersion: "1",
      promptVersion: PIPELINE_PROMPT_VERSION,
      budgetVersion: "materials.budgets.v3",
      feature: "both",
    };
    const key = pipelineCacheKey(base);
    assert.match(key, /sha256:aaaa\|sha256:bbbb\|hermes-classic@1\|/);
    assert.notEqual(pipelineCacheKey({ ...base, ledgerHash: "sha256:cccc" }), key);
    assert.notEqual(pipelineCacheKey({ ...base, feature: "resume" }), key);
    assert.notEqual(pipelineCacheKey({ ...base, templateVersion: "2" }), key);
  });

  it("finds a cached package only when key and files agree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-cache-"));
    const slugDir = join(dir, "acme-role");
    await mkdir(slugDir, { recursive: true });
    const key = "k1";
    assert.equal((await findCachedPackage({ dir: slugDir, cacheKey: key })).hit, false);
    await writeFile(join(slugDir, "run.json"), JSON.stringify({ cacheKey: key, runId: "r1" }));
    assert.equal((await findCachedPackage({ dir: slugDir, cacheKey: key, feature: "both" })).hit, false);
    await writeFile(join(slugDir, "manifest.json"), "{}");
    await writeFile(join(slugDir, "resume.html"), "<p>x</p>");
    await writeFile(join(slugDir, "cover-letter.html"), "<p>y</p>");
    const hit = await findCachedPackage({ dir: slugDir, cacheKey: key, feature: "both" });
    assert.equal(hit.hit, true);
    assert.equal(hit.runId, "r1");
    assert.equal((await findCachedPackage({ dir: slugDir, cacheKey: "other" })).hit, false);
  });
});

describe("executor boundary", () => {
  it("lists local-inprocess plus unsupported remotes", () => {
    assert.deepEqual(listExecutors(), ["local-inprocess", "hermes-cli", "webhook"]);
    assert.equal(resolveExecutor("local-inprocess").supported, true);
    assert.equal(resolveExecutor("hermes-cli").supported, false);
  });

  it("runs local stages and falls back when a remote cannot", async () => {
    const local = await runStageWithExecutor({
      executor: "local-inprocess",
      stage: "claims.select",
      run: async () => ({ kept: 5 }),
    });
    assert.deepEqual(local, { ok: true, result: { kept: 5 } });
    const remote = await runStageWithExecutor({
      executor: "hermes-cli",
      stage: "claims.select",
      run: async () => ({ kept: 5 }),
    });
    assert.equal(remote.ok, false);
    assert.equal(remote.error, "executor_unsupported");
    assert.throws(() => resolveExecutor("nope"), /unknown executor/);
  });
});
