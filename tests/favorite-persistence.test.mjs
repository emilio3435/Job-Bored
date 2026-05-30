/* ============================================================
   favorite-persistence.test.mjs
   ------------------------------------------------------------
   Locks down the user-facing contract for the favorite toggle:

     "Clicking a favorite star in the kanban must persist across
      a page refresh, even when the Sheet write fails or the
      OAuth session has expired."

   The legacy behavior bailed out of toggleFavorite when
   accessToken was missing and rolled back the optimistic flip
   when the Sheet write returned non-OK. Either path produced a
   chip that visibly flipped back to ☆, which read to users as
   "the favorites button doesn't work."

   The fix layers a localStorage-backed pending-favorites cache:

     - toggleFavorite mutates pipelineData and writes to the
       cache BEFORE any network or auth check, so the optimistic
       UI always reflects intent.
     - The Sheet write is attempted when accessToken is set, and
       the cache entry is cleared only when the write succeeds.
     - On the next dashboard load, applyFavoriteCache layers the
       cache into freshly-parsed jobs, so the favorite survives a
       refresh regardless of how the Sheet write went.

   These are static-analysis tests against app.js — they don't
   spin up a browser. The point is to prevent the rollback
   regression from creeping back in.
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");

function sliceToggleFavorite() {
  const start = appJs.indexOf("async function toggleFavorite");
  assert.ok(start >= 0, "toggleFavorite must exist");
  const end = appJs.indexOf("async function dismissJob", start);
  assert.ok(end > start, "dismissJob must follow toggleFavorite in source order");
  return appJs.slice(start, end);
}

describe("favorite toggle persists across refresh", () => {
  it("declares a versioned localStorage key for pending favorites", () => {
    assert.match(
      appJs,
      /const\s+PENDING_FAVORITES_STORAGE_KEY\s*=\s*"jobbored\.favorites\.pending"/,
      "PENDING_FAVORITES_STORAGE_KEY must exist under a clearly-namespaced " +
        "non-secret-shaped localStorage path",
    );
  });

  it("exposes a stable cache-key derivation from job link with a synthetic fallback", () => {
    assert.match(
      appJs,
      /function\s+favoriteCacheKeyForJob\s*\(/,
      "favoriteCacheKeyForJob must exist",
    );
    // job.link is the primary key (stable across sheet row reordering); the
    // synthetic key keeps link-less manually-added rows persistable.
    assert.match(appJs, /const\s+link\s*=\s*job\.link[\s\S]*?return\s+link/);
    assert.match(appJs, /return\s+`synthetic::\$\{company\}::\$\{title\}`/);
  });

  it("layers cached favorites into freshly-parsed pipelineData after CSV parse", () => {
    assert.match(
      appJs,
      /function\s+applyFavoriteCache\s*\(/,
      "applyFavoriteCache must exist",
    );
    // The function is wired into the load path right after the existing
    // enrichment cache hydration so the user's favorites land on first paint.
    assert.match(
      appJs,
      /pipelineData = parsePipelineCSV\(pipelineRows\);\s*\n\s*applyEnrichmentCache\(pipelineData\);\s*\n\s*applyFavoriteCache\(pipelineData\);/,
    );
  });

  it("toggleFavorite writes to the cache BEFORE any auth or network check", () => {
    const fn = sliceToggleFavorite();
    // The local mutation + cache write happen up front.
    assert.match(fn, /job\.favorite\s*=\s*next;/);
    assert.match(fn, /if\s*\(cacheKey\)\s*setPendingFavorite\(cacheKey,\s*next\);/);
    // The cache write must occur BEFORE the accessToken check.
    const cacheWriteIdx = fn.search(/setPendingFavorite\(cacheKey,\s*next\)/);
    const authCheckIdx = fn.search(/if\s*\(!accessToken\)/);
    assert.ok(
      cacheWriteIdx >= 0 && authCheckIdx > cacheWriteIdx,
      "favorite cache must be written before the auth gate so the user's " +
        "intent survives even when the sign-in modal short-circuits the flow",
    );
  });

  it("toggleFavorite never rolls back the optimistic flip on failure", () => {
    const fn = sliceToggleFavorite();
    // The pre-fix code path had `job.favorite = !next;` inside the failure
    // branch — guarding the chip from flipping back is the whole point of
    // this fix. The cache absorbs the failure instead.
    assert.doesNotMatch(
      fn,
      /job\.favorite\s*=\s*!next/,
      "toggleFavorite must not roll back the optimistic flip; the local " +
        "cache absorbs Sheet-write failures so the user's pick survives refresh",
    );
  });

  it("clears the cache entry only when the Sheet write actually succeeded", () => {
    const fn = sliceToggleFavorite();
    // The success branch is the only place that calls clearPendingFavorite.
    assert.match(fn, /if\s*\(ok\)\s*\{[\s\S]*?clearPendingFavorite\(cacheKey\)/);
    // The failure branch leaves the cache entry in place.
    const failBranch = fn.slice(fn.indexOf("if (ok)"));
    assert.doesNotMatch(
      failBranch.slice(failBranch.indexOf("return true;") + "return true;".length),
      /clearPendingFavorite/,
      "the failure path must leave the cache entry intact so a subsequent " +
        "refresh still surfaces the user's intent",
    );
  });
});
