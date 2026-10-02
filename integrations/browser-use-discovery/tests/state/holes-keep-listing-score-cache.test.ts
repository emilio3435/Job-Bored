// HOLES KEEP R17: the listing score cache is keyed by the scoring model and
// evicts by age and size, so a model switch re-scores and the file stays bounded.
import assert from "node:assert/strict";
import test from "node:test";

import type { RawListing } from "../../src/contracts.ts";
import type { LlmFitScoreResult, UserProfile } from "../../src/contracts/user-profile.ts";
import { scoreListingForProfile } from "../../src/normalize/profile-aware-scorer.ts";
import { openListingScoreCache } from "../../src/state/listing-score-cache.ts";

const SCORE: LlmFitScoreResult = {
  fitScore: 8,
  band: "strong",
  perStrength: [],
  concerns: [],
  matches: [],
  rationale: "Strong backend match.",
} as LlmFitScoreResult;

const PROFILE: UserProfile = {
  version: 1,
  updatedAt: "2026-09-30T00:00:00.000Z",
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative: "I am a staff backend engineer looking for distributed systems work.",
  },
  strengths: [{ name: "backend systems", rank: 1 }],
  hardConstraints: { workMode: "any" },
} as UserProfile;

const LISTING: RawListing = {
  sourceId: "greenhouse",
  sourceLabel: "Greenhouse",
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "San Francisco, CA",
  url: "https://jobs.example.com/be/4012",
  canonicalUrl: "https://jobs.example.com/be/4012",
  descriptionText: "Build distributed systems on a small team.",
} as RawListing;

test("R17: a score cached under one model is not served for another model", async () => {
  const keys: string[] = [];
  const recordingCache = {
    get(key: string) {
      keys.push(key);
      return SCORE;
    },
    put: () => undefined,
    getBreakdown: () => null,
    putBreakdown: () => undefined,
    close: () => undefined,
  };
  for (const geminiModel of ["gemini-flash", "gemini-pro"]) {
    const outcome = await scoreListingForProfile(LISTING, PROFILE, {
      runtimeConfig: { geminiApiKey: "test-key", geminiModel },
      cache: recordingCache,
    });
    assert.equal(outcome.ok, true);
  }
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1], "the cache key must change with the scoring model");
});

test("R17: entries older than the max age are misses and are evicted", () => {
  let now = Date.parse("2026-09-01T00:00:00.000Z");
  const cache = openListingScoreCache(":memory:", {
    maxAgeMs: 7 * 86_400_000,
    maxEntries: 100,
    now: () => now,
  });
  try {
    cache.put("old-key", SCORE);
    cache.putBreakdown("https://jobs.example.com/old", SCORE);
    now += 8 * 86_400_000;
    assert.equal(cache.get("old-key"), null, "an aged score must be re-scored");
    assert.equal(cache.getBreakdown("https://jobs.example.com/old"), null);
    cache.put("fresh-key", SCORE);
    assert.deepEqual(cache.get("fresh-key"), SCORE);
  } finally {
    cache.close();
  }
});

test("R17: the cache keeps only the newest maxEntries scores", () => {
  let now = Date.parse("2026-09-01T00:00:00.000Z");
  const cache = openListingScoreCache(":memory:", {
    maxAgeMs: 30 * 86_400_000,
    maxEntries: 2,
    now: () => now,
  });
  try {
    for (const key of ["a", "b", "c"]) {
      cache.put(key, SCORE);
      now += 1000;
    }
    assert.equal(cache.get("a"), null, "the oldest entry is evicted past the cap");
    assert.deepEqual(cache.get("b"), SCORE);
    assert.deepEqual(cache.get("c"), SCORE);
  } finally {
    cache.close();
  }
});
