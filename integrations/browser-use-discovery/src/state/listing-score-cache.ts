/**
 * listing-score-cache.ts
 *
 * Persists LLM fit-score results so we don't re-score the same listing on
 * every run. Two tables:
 *
 *   listing_score_cache       — keyed by sha256(canonicalUrl + profileVersion + schemaVersion + model)
 *                               Hit/miss on this drives whether we call Gemini.
 *   listing_score_breakdown   — keyed by canonicalUrl
 *                               Latest breakdown for UI rendering, independent of profile.
 *
 * Both tables evict rows older than maxAgeMs and keep the newest maxEntries.
 *
 * Backed by node:sqlite (DatabaseSync), same as discovery-memory-store.ts.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { LlmFitScoreResult } from "../contracts/user-profile.ts";

export type ListingScoreCache = {
  get(cacheKey: string): LlmFitScoreResult | null;
  put(cacheKey: string, result: LlmFitScoreResult): void;
  getBreakdown(canonicalUrl: string): LlmFitScoreResult | null;
  putBreakdown(canonicalUrl: string, result: LlmFitScoreResult): void;
  close(): void;
};

export type ListingScoreCacheOptions = {
  /** Scores older than this are misses and are deleted (default 30 days). */
  maxAgeMs?: number;
  /** Rows kept per table, newest first (default 5,000). */
  maxEntries?: number;
  now?: () => number;
};

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;

export function openListingScoreCache(
  databasePath?: string,
  options: ListingScoreCacheOptions = {},
): ListingScoreCache {
  const maxAgeMs = options.maxAgeMs && options.maxAgeMs > 0 ? options.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const maxEntries =
    options.maxEntries && options.maxEntries > 0 ? Math.floor(options.maxEntries) : DEFAULT_MAX_ENTRIES;
  const now = options.now || Date.now;
  const resolvedPath = String(databasePath || "").trim() || ":memory:";
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath);
  if (resolvedPath !== ":memory:") {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
    `);
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS listing_score_cache (
      cache_key TEXT PRIMARY KEY,
      score_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listing_score_breakdown (
      canonical_url TEXT PRIMARY KEY,
      breakdown_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS listing_score_cache_created_at
      ON listing_score_cache (created_at);
    CREATE INDEX IF NOT EXISTS listing_score_breakdown_updated_at
      ON listing_score_breakdown (updated_at);
  `);

  const getStatement = database.prepare(`
    SELECT score_json FROM listing_score_cache WHERE cache_key = ? AND created_at >= ?
  `);
  const putStatement = database.prepare(`
    INSERT INTO listing_score_cache (cache_key, score_json, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      score_json = excluded.score_json,
      created_at = excluded.created_at
  `);
  const getBreakdownStatement = database.prepare(`
    SELECT breakdown_json FROM listing_score_breakdown WHERE canonical_url = ? AND updated_at >= ?
  `);
  const putBreakdownStatement = database.prepare(`
    INSERT INTO listing_score_breakdown (canonical_url, breakdown_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(canonical_url) DO UPDATE SET
      breakdown_json = excluded.breakdown_json,
      updated_at = excluded.updated_at
  `);

  const pruneStatements = [
    database.prepare(`DELETE FROM listing_score_cache WHERE created_at < ?`),
    database.prepare(`
      DELETE FROM listing_score_cache WHERE cache_key IN (
        SELECT cache_key FROM listing_score_cache ORDER BY created_at DESC LIMIT -1 OFFSET ?
      )
    `),
    database.prepare(`DELETE FROM listing_score_breakdown WHERE updated_at < ?`),
    database.prepare(`
      DELETE FROM listing_score_breakdown WHERE canonical_url IN (
        SELECT canonical_url FROM listing_score_breakdown ORDER BY updated_at DESC LIMIT -1 OFFSET ?
      )
    `),
  ] as const;

  function stamp(): string {
    return new Date(now()).toISOString();
  }

  function cutoff(): string {
    return new Date(now() - maxAgeMs).toISOString();
  }

  function prune(): void {
    const [cacheAged, cacheOverCap, breakdownAged, breakdownOverCap] = pruneStatements;
    const oldest = cutoff();
    cacheAged.run(oldest);
    cacheOverCap.run(maxEntries);
    breakdownAged.run(oldest);
    breakdownOverCap.run(maxEntries);
  }

  prune();

  function parseScore(json: unknown): LlmFitScoreResult | null {
    if (typeof json !== "string" || !json) return null;
    try {
      return JSON.parse(json) as LlmFitScoreResult;
    } catch {
      return null;
    }
  }

  return {
    get(cacheKey) {
      const key = String(cacheKey || "").trim();
      if (!key) return null;
      const row = getStatement.get(key, cutoff()) as { score_json?: string } | undefined;
      return row ? parseScore(row.score_json) : null;
    },

    put(cacheKey, result) {
      const key = String(cacheKey || "").trim();
      if (!key) return;
      putStatement.run(key, JSON.stringify(result), stamp());
      prune();
    },

    getBreakdown(canonicalUrl) {
      const key = String(canonicalUrl || "").trim();
      if (!key) return null;
      const row = getBreakdownStatement.get(key, cutoff()) as
        | { breakdown_json?: string }
        | undefined;
      return row ? parseScore(row.breakdown_json) : null;
    },

    putBreakdown(canonicalUrl, result) {
      const key = String(canonicalUrl || "").trim();
      if (!key) return;
      putBreakdownStatement.run(key, JSON.stringify(result), stamp());
      prune();
    },

    close() {
      database.close();
    },
  };
}
