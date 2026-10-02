/**
 * HOLES lane SHEETS · A15 (load side), B8 (load half), B2 (emit side).
 *
 * loadAllData ran once per caller: the 5-minute poll, Refresh, the online
 * hook and post-write reloads overlapped, and whichever finished last won,
 * even when it read an older Sheet. It now runs one load at a time:
 * overlapping callers share the in-flight promise, each real load has a
 * generation number, and a load superseded by a Sheet switch never paints.
 * Every load emits the SPEC §1b.10 events BOARD reads:
 *   jb:data:loading {generation}
 *   jb:data:loaded  {generation, rowCount}
 *   jb:data:failed  {generation, status, message}
 * and loadAllData still resolves a boolean.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HEADERS, deferred, loadReader, pipelineRow, valuesOk } from "./holes-sheets-fake.mjs";

const ROWS_A = [HEADERS, pipelineRow({ title: "Staff Engineer", company: "Acme", link: "https://example.com/a" })];
const ROWS_B = [
  HEADERS,
  pipelineRow({ title: "Data Engineer", company: "Globex", link: "https://example.com/b1" }),
  pipelineRow({ title: "ML Engineer", company: "Globex", link: "https://example.com/b2" }),
];

const ofType = (env, type) => env.events.filter((e) => e.type === type && e.target === "document");

describe("A15 / B8 · loadAllData is single-flight with a generation counter", () => {
  it("overlapping callers share one in-flight promise and one fetch", async () => {
    const gate = deferred();
    let fetches = 0;
    const env = loadReader({
      fetch: async () => {
        fetches += 1;
        await gate.promise;
        return valuesOk(ROWS_A);
      },
    });
    const first = env.sr.loadAllData();
    const second = env.sr.loadAllData();
    assert.equal(first, second, "the second caller joins the first load");
    gate.resolve();
    assert.equal(await first, true);
    assert.equal(await second, true);
    assert.equal(fetches, 1);
    assert.equal(env.calls.setPipelineData.length, 1);
  });

  it("a load after the last one settled is a new generation", async () => {
    const env = loadReader({ fetch: async () => valuesOk(ROWS_A) });
    await env.sr.loadAllData();
    await env.sr.loadAllData();
    assert.deepEqual(
      ofType(env, "jb:data:loading").map((e) => e.detail.generation),
      [1, 2],
    );
    assert.equal(env.sr.getLoadState().generation, 2);
  });

  it("a load that throws does not wedge every later load", async () => {
    let boom = true;
    const env = loadReader({
      fetch: async () => valuesOk(ROWS_A),
      host: {
        getOAuthClientId: () => {
          if (boom) throw new Error("config not ready");
          return "client-id";
        },
      },
    });
    await assert.rejects(env.sr.loadAllData(), /config not ready/);
    boom = false;
    assert.equal(await env.sr.loadAllData(), true);
  });

  it("a load superseded by a Sheet switch never paints the old Sheet's rows", async () => {
    const gateA = deferred();
    const env = loadReader({
      fetch: async (url) => {
        if (url.includes("/sheet-A/")) {
          await gateA.promise;
          return valuesOk(ROWS_A);
        }
        return valuesOk(ROWS_B);
      },
    });
    env.state.sheetId = "sheet-A";
    const old = env.sr.loadAllData();
    env.state.sheetId = "sheet-B"; // Settings switched the Sheet mid-load
    const fresh = env.sr.loadAllData();
    assert.notEqual(old, fresh, "a different Sheet never joins the old load");
    assert.equal(await fresh, true);
    gateA.resolve();
    assert.equal(await old, true, "the superseded caller gets the newest answer");
    assert.equal(env.calls.setPipelineData.length, 1, "only the current Sheet painted");
    assert.deepEqual(
      [...env.state.data.map((j) => j.link)],
      ["https://example.com/b1", "https://example.com/b2"],
    );
    const loaded = ofType(env, "jb:data:loaded");
    assert.deepEqual(loaded.map((e) => e.detail.generation), [2]);
  });

  it("a superseding load that finds no Sheet id does not leave loading stuck", async () => {
    const gateA = deferred();
    const env = loadReader({
      fetch: async () => {
        await gateA.promise;
        return valuesOk(ROWS_A);
      },
    });
    env.state.sheetId = "sheet-A";
    const old = env.sr.loadAllData();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(env.sr.getLoadState().loading, true);
    env.state.sheetId = ""; // Settings cleared the Sheet mid-load
    assert.equal(await env.sr.loadAllData(), false);
    gateA.resolve();
    await old;
    assert.equal(env.sr.getLoadState().loading, false);
  });

  for (const [how, cut] of [
    ["the Sheet id is cleared", (env) => (env.state.sheetId = "")],
    // Same Sheet would join the in-flight load; a switch plus sign-out supersedes it.
    ["the person switches Sheet signed out", (env) => ((env.state.sheetId = "sheet-B"), (env.state.token = ""))],
  ]) {
    it(`a load superseded because ${how} ends its generation with jb:data:failed`, async () => {
      const gateA = deferred();
      const env = loadReader({
        fetch: async () => {
          await gateA.promise;
          return valuesOk(ROWS_A);
        },
      });
      env.state.sheetId = "sheet-A";
      const old = env.sr.loadAllData();
      await new Promise((r) => setTimeout(r, 0));
      cut(env);
      assert.equal(await env.sr.loadAllData(), false);
      gateA.resolve();
      await old;
      const opened = ofType(env, "jb:data:loading").map((e) => e.detail.generation);
      const failed = ofType(env, "jb:data:failed").map((e) => e.detail);
      assert.deepEqual(opened, [1]);
      assert.equal(failed.length, 1, "exactly one outcome for the open generation");
      assert.equal(failed[0].generation, 1);
      assert.equal(typeof failed[0].status, "number");
      assert.ok(failed[0].message);
      assert.equal(ofType(env, "jb:data:load-failed").length, 1, "the legacy event fires too");
      assert.equal(ofType(env, "jb:data:loaded").length, 0);
    });
  }
});

describe("B2 · loadAllData emits jb:data:loading / loaded / failed (§1b.10)", () => {
  it("a good load emits loading {generation} then loaded {generation, rowCount}", async () => {
    const env = loadReader({ fetch: async () => valuesOk(ROWS_B) });
    const ok = await env.sr.loadAllData();
    assert.equal(ok, true);
    const types = env.events.filter((e) => e.target === "document").map((e) => e.type);
    assert.ok(types.indexOf("jb:data:loading") < types.indexOf("jb:data:loaded"));
    assert.deepEqual({ ...ofType(env, "jb:data:loading")[0].detail }, { generation: 1 });
    const loaded = ofType(env, "jb:data:loaded")[0].detail;
    assert.equal(loaded.generation, 1);
    assert.equal(loaded.rowCount, 2);
    assert.ok(env.events.some((e) => e.target === "window" && e.type === "jb:data:loading"));
  });

  it("a failed load emits failed {generation, status, message} and resolves false", async () => {
    const env = loadReader({
      fetch: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: "The caller does not have permission" } }),
        text: async () => "",
      }),
    });
    const ok = await env.sr.loadAllData();
    assert.equal(ok, false);
    const failed = ofType(env, "jb:data:failed");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].detail.generation, 1);
    assert.equal(failed[0].detail.status, 403);
    assert.equal(typeof failed[0].detail.message, "string");
    assert.ok(failed[0].detail.message.length > 0);
    assert.doesNotMatch(failed[0].detail.message, /caller does not have permission/i, "plain words, not Google's");
    assert.equal(ofType(env, "jb:data:load-failed").length, 1, "the legacy event still fires");
  });

  it("an offline load reports status 0 in plain words", async () => {
    const env = loadReader({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    assert.equal(await env.sr.loadAllData(), false);
    const failed = ofType(env, "jb:data:failed")[0].detail;
    assert.equal(failed.status, 0);
    assert.match(failed.message, /offline/i);
  });

  it("a signed-out call is not a load: no loading event without an outcome", async () => {
    const env = loadReader({ fetch: async () => valuesOk(ROWS_A) });
    env.state.token = "";
    assert.equal(await env.sr.loadAllData(), false);
    assert.equal(ofType(env, "jb:data:loading").length, 0);
  });
});
