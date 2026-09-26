/**
 * BEAUDIT G19: every discovery-state probe spawned `launchctl list` via
 * safeKeepAliveStatus plus loopback probes, and index.html include
 * expansion re-read partials on every request. Keep-alive status is cached
 * 30s; assembled HTML is cached by mtime (index plus every transitive
 * partial).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import {
  KEEP_ALIVE_STATUS_CACHE_TTL_MS,
  cachedKeepAliveStatus,
  loadStaticHtml,
} from "../dev-server.mjs";
import { listIncludeTargets } from "../scripts/lib/expand-index-includes.mjs";

describe("G19 listIncludeTargets", () => {
  it("lists directive targets in order", () => {
    assert.deepEqual(
      listIncludeTargets("a<!-- @include partials/x.html -->b<!--@include y.html-->c"),
      ["partials/x.html", "y.html"],
    );
    assert.deepEqual(listIncludeTargets("<p>no directives</p>"), []);
  });
});

describe("G19 keep-alive status cache", () => {
  it("caches for 30s and reloads after the TTL", async () => {
    assert.equal(KEEP_ALIVE_STATUS_CACHE_TTL_MS, 30_000);
    let loads = 0;
    const loadImpl = async () => ({ loads: ++loads });
    const cache = {};
    assert.deepEqual(await cachedKeepAliveStatus({ nowMs: 1_000, cache, loadImpl }), { loads: 1 });
    assert.deepEqual(await cachedKeepAliveStatus({ nowMs: 1_001, cache, loadImpl }), { loads: 1 });
    assert.deepEqual(await cachedKeepAliveStatus({ nowMs: 1_000 + 29_999, cache, loadImpl }), { loads: 1 });
    assert.equal(loads, 1, "one load for every call inside the TTL");
    assert.deepEqual(await cachedKeepAliveStatus({ nowMs: 1_000 + 30_000, cache, loadImpl }), { loads: 2 });
  });
});

// Real temp files: expansion itself reads through the real fs, so the
// fixtures live on disk while the wrappers count the cache's own reads.
function fixtureFs() {
  const root = mkdtempSync(join(tmpdir(), "jobbored-g19-"));
  const calls = { reads: [], stats: [] };
  return {
    root,
    calls,
    write(rel, content) {
      const path = join(root, rel);
      writeFileSync(path, content, "utf8");
      return path;
    },
    touch(rel, mtimeMs) {
      const at = new Date(mtimeMs);
      utimesSync(join(root, rel), at, at);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
    async readFileImpl(path, encoding) {
      calls.reads.push(String(path));
      return readFile(path, encoding);
    },
    statImpl(path) {
      calls.stats.push(String(path));
      return statSync(path);
    },
  };
}

describe("G19 assembled-HTML mtime cache", () => {
  it("serves from cache without reads while nothing changes", async () => {
    const fs = fixtureFs();
    try {
      mkdirSync(join(fs.root, "partials"), { recursive: true });
      const indexPath = fs.write("index.html", "<!-- @include partials/a.html -->!");
      fs.write(join("partials", "a.html"), "A");
      const cache = new Map();
      const deps = {
        readFileImpl: fs.readFileImpl,
        statImpl: fs.statImpl,
        cache,
        baseDir: fs.root,
      };
      assert.equal(await loadStaticHtml(indexPath, deps), "A!");
      const readsAfterMiss = fs.calls.reads.length;
      assert.ok(readsAfterMiss >= 1, "a miss reads through the loader");
      assert.equal(await loadStaticHtml(indexPath, deps), "A!");
      assert.equal(
        fs.calls.reads.length,
        readsAfterMiss,
        "a hit must not read any file (stats only)",
      );
    } finally {
      fs.cleanup();
    }
  });

  it("invalidates when the index or any transitive partial changes", async () => {
    const fs = fixtureFs();
    try {
      mkdirSync(join(fs.root, "p"), { recursive: true });
      const indexPath = fs.write("index.html", "[<!-- @include p/a.html -->]");
      fs.write(join("p", "a.html"), "A<!-- @include b.html -->");
      fs.write(join("p", "b.html"), "B");
      // Pin every mtime to the past so each touch is strictly newer.
      for (const rel of ["index.html", join("p", "a.html"), join("p", "b.html")]) {
        fs.touch(rel, 1_000_000);
      }
      const cache = new Map();
      const deps = {
        readFileImpl: fs.readFileImpl,
        statImpl: fs.statImpl,
        cache,
        baseDir: fs.root,
      };
      assert.equal(await loadStaticHtml(indexPath, deps), "[AB]");
      const readsAfterMiss = fs.calls.reads.length;
      // A nested partial changes: the cache must notice.
      fs.write(join("p", "b.html"), "B2");
      fs.touch(join("p", "b.html"), 2_000_000);
      assert.equal(await loadStaticHtml(indexPath, deps), "[AB2]");
      assert.ok(fs.calls.reads.length > readsAfterMiss, "a stale entry must re-expand");
      const readsAfterRefresh = fs.calls.reads.length;
      // The index itself changes: same story.
      fs.write("index.html", "{<!-- @include p/a.html -->}");
      fs.touch("index.html", 3_000_000);
      assert.equal(await loadStaticHtml(indexPath, deps), "{AB2}");
      assert.ok(fs.calls.reads.length > readsAfterRefresh);
    } finally {
      fs.cleanup();
    }
  });
});
