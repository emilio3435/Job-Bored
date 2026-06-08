/**
 * listing-score-cache.ts
 *
 * Persists LLM fit-score results so we don't re-score the same listing on
 * every run. Two tables:
 *
 *   listing_score_cache       — keyed by sha256(canonicalUrl + profileVersion + schemaVersion)
 *                               Hit/miss on this drives whether we call Gemini.
 *   listing_score_breakdown   — keyed by canonicalUrl
 *                               Latest breakdown for UI rendering, independent of profile.
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

export function openListingScoreCache(databasePath?: string): ListingScoreCache {
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
  `);

  const getStatement = database.prepare(`
    SELECT score_json FROM listing_score_cache WHERE cache_key = ?
  `);
  const putStatement = database.prepare(`
    INSERT INTO listing_score_cache (cache_key, score_json, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      score_json = excluded.score_json,
      created_at = excluded.created_at
  `);
  const getBreakdownStatement = database.prepare(`
    SELECT breakdown_json FROM listing_score_breakdown WHERE canonical_url = ?
  `);
  const putBreakdownStatement = database.prepare(`
    INSERT INTO listing_score_breakdown (canonical_url, breakdown_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(canonical_url) DO UPDATE SET
      breakdown_json = excluded.breakdown_json,
      updated_at = excluded.updated_at
  `);

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
      const row = getStatement.get(key) as { score_json?: string } | undefined;
      return row ? parseScore(row.score_json) : null;
    },

    put(cacheKey, result) {
      const key = String(cacheKey || "").trim();
      if (!key) return;
      putStatement.run(key, JSON.stringify(result), new Date().toISOString());
    },

    getBreakdown(canonicalUrl) {
      const key = String(canonicalUrl || "").trim();
      if (!key) return null;
      const row = getBreakdownStatement.get(key) as
        | { breakdown_json?: string }
        | undefined;
      return row ? parseScore(row.breakdown_json) : null;
    },

    putBreakdown(canonicalUrl, result) {
      const key = String(canonicalUrl || "").trim();
      if (!key) return;
      putBreakdownStatement.run(
        key,
        JSON.stringify(result),
        new Date().toISOString(),
      );
    },

    close() {
      database.close();
    },
  };
}
