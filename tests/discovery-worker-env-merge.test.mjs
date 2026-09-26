import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeEnvFileValues,
  mergeEnvFileValuesWithSources,
  parseEnvFileText,
  resolveLayeredEnvSources,
} from "../scripts/lib/env-file-merge.mjs";

/* ============================================================
   An empty placeholder must never erase a configured value.

   The worker starter merges three env files in order — the repo's
   integrations/browser-use-discovery/.env, server/.env, then the user's
   ~/.jobbored/browser-use-discovery/.env — with later files winning so a
   machine can override the repo. But a plain `Object.assign` also lets a
   present-but-EMPTY key win, and env files grow those lines by being
   copied from .env.example.

   Emilio, 2026-09-02: the repo env pointed at a real service-account key,
   the home env carried a bare `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE=`,
   and the worker refused every run with "no Google Sheets credential
   configured" — the credential was configured, then blanked in the merge.
   ============================================================ */

const KEY = "BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE";

describe("mergeEnvFileValues — later files override, empties do not", () => {
  it("keeps the earlier value when a later file leaves the key empty", () => {
    const merged = mergeEnvFileValues([
      { [KEY]: "/Users/me/keys/service-account-key.json" },
      { [KEY]: "" },
    ]);
    assert.equal(merged[KEY], "/Users/me/keys/service-account-key.json");
  });

  it("still lets a later file override with a REAL value", () => {
    const merged = mergeEnvFileValues([
      { [KEY]: "/repo/key.json" },
      { [KEY]: "/home/override.json" },
    ]);
    assert.equal(merged[KEY], "/home/override.json");
  });

  it("treats a whitespace-only value as empty", () => {
    const merged = mergeEnvFileValues([{ [KEY]: "/repo/key.json" }, { [KEY]: "   " }]);
    assert.equal(merged[KEY], "/repo/key.json");
  });

  it("accepts an empty value when no earlier file set the key at all", () => {
    const merged = mergeEnvFileValues([{ OTHER: "x" }, { [KEY]: "" }]);
    assert.equal(merged[KEY], "");
  });

  it("merges unrelated keys from every file", () => {
    const merged = mergeEnvFileValues([
      { A: "1" },
      { B: "2" },
      { C: "3", A: "" },
    ]);
    assert.deepEqual({ ...merged }, { A: "1", B: "2", C: "3" });
  });
});

describe("parseEnvFileText — the shape the starter has always parsed", () => {
  it("reads KEY=value, skips comments and blanks, and strips matched quotes", () => {
    const parsed = parseEnvFileText(
      ['# comment', '', 'A=1', 'B="two"', "C='three'", "D=", "=nokey"].join("\n"),
    );
    assert.deepEqual({ ...parsed }, { A: "1", B: "two", C: "three", D: "" });
  });

  it("keeps '=' characters inside a value", () => {
    assert.equal(parseEnvFileText("K=a=b=c").K, "a=b=c");
  });
});

describe("mergeEnvFileValuesWithSources — BEAUDIT G11 provenance", () => {
  it("reports the winning layer index per key", () => {
    const { values, sources } = mergeEnvFileValuesWithSources([
      { A: "repo", B: "repo" },
      { B: "server", C: "server" },
      { C: "" },
    ]);
    assert.deepEqual({ ...values }, { A: "repo", B: "server", C: "server" });
    assert.deepEqual({ ...sources }, { A: 0, B: 1, C: 1 });
  });

  it("keeps the earlier layer when a later file leaves the key empty", () => {
    const { sources } = mergeEnvFileValuesWithSources([
      { [KEY]: "/repo/key.json" },
      { [KEY]: "" },
    ]);
    assert.equal(sources[KEY], 0);
  });
});

describe("resolveLayeredEnvSources — BEAUDIT G11 key-to-file map", () => {
  const paths = ["/repo/integrations/browser-use-discovery/.env", "/repo/server/.env", "/home/.jobbored/.env"];

  it("maps each resolved key to its winning file (never the value)", () => {
    const { values, sources } = resolveLayeredEnvSources(
      [{ A: "repo", B: "repo" }, { B: "server" }, { C: "home" }],
      { paths, processEnv: {} },
    );
    assert.deepEqual({ ...values }, { A: "repo", B: "server", C: "home" });
    assert.deepEqual({ ...sources }, { A: paths[0], B: paths[1], C: paths[2] });
  });

  it("marks process env wins as 'process', mirroring the {...files, ...process} spread", () => {
    const { sources } = resolveLayeredEnvSources([{ A: "repo" }, { B: "server" }], {
      paths,
      processEnv: { B: "exported", PATH: "/bin" },
    });
    assert.deepEqual({ ...sources }, { A: paths[0], B: "process" });
  });
});
