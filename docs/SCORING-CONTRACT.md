# Scoring Contract

> Shared contract for the JobBored fit-score rewrite. All four implementation slices (scorer, onboarding/settings, discovery pane, backcompat) MUST conform to the shapes defined here. If you need to change a shape, update this file and `integrations/browser-use-discovery/src/contracts/user-profile.{ts,schema.json}` together — never one without the other.

## 1. Goal

Replace the hard-coded keyword scorer in `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts` with a profile-driven pipeline that any user can configure through onboarding + Settings, and that produces a per-listing breakdown transparent enough for the user to trust and tune.

## 2. Data flow

```
                    ┌───────────────────────┐
   Onboarding ────▶ │  ~/.jobbored/         │ ◀──── Settings editor
                    │     profile.json      │       (read/write)
                    └─────────┬─────────────┘
                              │ load once at discovery start
                              ▼
                    ┌───────────────────────┐
                    │     UserProfile       │ ◀──── Discovery pane
                    │       (memory)        │       (per-run overrides only,
                    └─────────┬─────────────┘        does NOT write back)
                              │
   ┌──────────────────────────┼──────────────────────────┐
   ▼                          ▼                          ▼
Pre-filter             Query-builder               LLM Scorer
(keyword/regex)        (existing path:             (gemini-3.5-flash,
hardConstraints        DiscoveryProfile)            structured output)
   │                          │                          │
   │ pass                     │                          │
   ▼                          ▼                          ▼
Listing enters         Discovery results          ProfileScoringOutcome
scoring lane           are normalized,            with fitScore,
                       then sent to LLM           perStrength, concerns,
                                                  matches, rationale
```

## 3. Storage

| Path | Purpose | Owner |
|------|---------|-------|
| `~/.jobbored/profile.json` | Canonical user profile (v1) | Onboarding + Settings |
| `~/.jobbored/profile.json.bak.<timestamp>` | Pre-edit backup written by Settings on save | Settings |
| `~/.hermes/job-hunt/profile/job-preferences.md` | Legacy Emilio profile (markdown) | Backcompat migrator (read-only fallback) |
| `~/.hermes/job-hunt/profile/profile.md` | Legacy Emilio narrative (markdown) | Backcompat migrator (read-only fallback) |

The backcompat agent migrates legacy → canonical on first worker boot, writes `.migrated` marker, and never re-runs migration unless the marker is removed.

## 4. UserProfile JSON shape

Authoritative schema: [`integrations/browser-use-discovery/src/contracts/user-profile.schema.json`](../integrations/browser-use-discovery/src/contracts/user-profile.schema.json). TypeScript mirror: [`integrations/browser-use-discovery/src/contracts/user-profile.ts`](../integrations/browser-use-discovery/src/contracts/user-profile.ts).

Five buckets:

1. **identity** — `targetRoles[]` (ordered), `targetSeniority`, `yearsRelevantExperience`, `primaryNarrative` (1–4 sentences, first person, embedded verbatim in LLM prompt).
2. **strengths[]** — capability areas ranked 1–8. Each has `name`, `rank`, optional `evidence`, optional `keywords[]`. Rank 1 = top. Replaces the old hardcoded `LANE_KEYWORDS`.
3. **wants[]** — free-form English. Things the user wants the role to involve.
4. **avoids[]** — free-form English. Soft "please skip" signals.
5. **hardConstraints** — `salaryFloor` / `salaryRequired` / `workMode` / `acceptableLocations[]` / `workAuth` / `skipTitles[]`. These are the ONLY fields that hard-reject a listing.

Plus optional `tieBreakers` for soft signals the user can dial up/down (`salaryTransparencyImportance`, `companyCredibilityImportance`, `applicationComplexityAversion`).

## 5. Pre-filter contract

Synchronous, no I/O, no LLM. Run inside `normalizeLead` before the LLM scorer.

```ts
function runPreFilter(rawListing: RawListing, profile: UserProfile): PreFilterResult
```

Rules (apply in this order, first failure wins):

1. **`skipTitles`** — case-insensitive substring match on `rawListing.title`. Hit → reject `skip_title_match`.
2. **`workMode`** —
   - `remote_only`: listing's resolved `remoteBucket` must be `remote`. Else reject `work_mode_mismatch`.
   - `hybrid_ok`: `remote` or `hybrid` accepted; `onsite` requires `acceptableLocations` match (next rule).
   - `onsite_ok`: all modes accepted; onsite still requires location match.
   - `any`: no work-mode check.
3. **`acceptableLocations`** — when listing is onsite/hybrid AND `acceptableLocations` is non-empty, listing location must substring-match at least one entry. Else reject `location_outside_acceptable`. (`remote_only` skips this entirely.)
4. **`workAuth`** — if profile is `needs_sponsorship` and the listing's description mentions "no sponsorship" / "US citizens only" / "must be authorized to work in the US without sponsorship", reject `work_auth_mismatch`. Otherwise pass.
5. **`salaryRequired` + `salaryFloor`** —
   - `salaryRequired=true` AND listing has no parseable salary → reject `salary_missing_but_required`.
   - `salaryFloor` set AND listing's published max < floor → reject `salary_below_floor`. (Use parsed max, not min, to avoid rejecting wide bands.)

Anything else passes. Pre-filter rejections are surfaced in `DiscoveryRejectionSummary` with the reason code.

## 6. LLM scorer contract

```ts
async function scoreListingWithLlm(
  rawListing: RawListing,
  profile: UserProfile,
): Promise<LlmFitScoreResult>
```

- Model: `gemini-3.5-flash` (no fallback; the model-swap agent standardized this).
- Mode: structured output, JSON Schema = `LlmFitScoreResult` (see TS file).
- System prompt embeds `profile.identity.primaryNarrative`, then enumerates strengths (rank-ordered, with evidence + keywords if present), wants, avoids, and tieBreakers.
- User prompt is the listing: title, company, location, compensationText, descriptionText (truncated to 6k chars).
- Required output fields: `fitScore` (1–10 integer), `band`, `perStrength[]` (one per profile strength, in profile order), `concerns[]`, `matches[]`, `rationale` (1–2 sentences). Optional: `leadAngle`.
- Bands: ≥9 `Exceptional`, ≥8 `Strong`, ≥7 `Interesting`, else `Low`.

Caching: keyed on `sha256(canonicalUrl + profile.updatedAt + USER_PROFILE_SCHEMA_VERSION)` so profile edits invalidate the cache. SQLite (existing `state/` dir).

## 7. Pipeline sheet wire compatibility

Existing columns stay where they are. The new scorer writes to the same cells:

| Sheet column | Source field |
|---|---|
| `Fit Score` (H, idx 7) | `LlmFitScoreResult.fitScore` |
| `Fit Assessment` (K, idx 10) | `LlmFitScoreResult.rationale` + summarized matches/concerns |
| `Talking Points` (Q, idx 16) | `LlmFitScoreResult.leadAngle` or derived from top-3 `perStrength` |
| `Match Score` (U) | Keep populated for backcompat — set equal to `fitScore` (LLM is now the single source of truth). |

The structured `perStrength + concerns + matches` array is persisted to a sidecar (`state/listing-scores.sqlite`) so the dashboard drawer can render the breakdown without re-calling the LLM. The drawer reads the sidecar by `canonicalUrl`.

## 8. Discovery pane / runtime overrides

The discovery pane pre-fills its filter UI from the master `UserProfile`. User edits during a run create a `DiscoveryRunPreferences.perRunOverrides` object that is merged with `baseProfile` for that run only — **never written back to disk**. The merge precedence is per-field replacement (override beats base when present).

The merged profile is the one passed to the pre-filter and the LLM scorer. Surfacing it in the run log: the existing `DiscoveryProfileSnapshot.profileHash` should hash the merged set (not the base) so post-hoc analysis can tell when a run used an override.

## 9. Backcompat — legacy migration

On worker boot, if `~/.jobbored/profile.json` is absent AND `~/.hermes/job-hunt/profile/job-preferences.md` exists, run the migrator:

1. Parse the legacy markdown rubric (the 9-dimension table) → seed `strengths[]` with the lane keywords as `strengths[i].keywords`, ranks derived from old weights (highest weight → rank 1).
2. Pull `Acceptable locations`, `Avoid / reject titles` sections → `hardConstraints.acceptableLocations` and `hardConstraints.skipTitles`.
3. Pull `Salary policy` → `hardConstraints.salaryRequired = false`, no floor (legacy behavior).
4. Embed legacy `profile.md` body into `identity.primaryNarrative` (truncate to 1200 chars).
5. Write canonical JSON. Touch `~/.jobbored/.migrated.v1`.
6. Leave the legacy files in place. They are now read-only and ignored.

A `Rescore all` button in Settings POSTs to `/profile/rescore` which iterates Pipeline rows and re-scores via the LLM. Default behavior is **opt-in** — new discoveries score automatically, but old rows only re-score when the user clicks.

## 10. Cross-slice ownership

| Slice | Owns | Reads |
|---|---|---|
| **Scorer** (Task #3) | `src/normalize/profile-aware-scorer.ts` (rewrite), `src/normalize/lead-normalizer.ts` (wire-up), `src/state/listing-scores.sqlite` schema | `user-profile.ts`, `user-profile.schema.json` |
| **Onboarding + Settings** (Task #4) | client onboarding wizard, Settings profile tab UI, server endpoints `POST /profile`, `GET /profile`, `POST /profile/template/:id` | `user-profile.schema.json` (validates on POST) |
| **Discovery pane** (Task #5) | discovery pane UI (`discovery-wizard-*.js`), per-run override state | `GET /profile` for defaults |
| **Backcompat** (Task #6) | legacy → canonical migrator, `POST /profile/rescore`, "Rescore all" Settings button | legacy md files, `user-profile.ts` |

If two slices need to touch the same file (e.g., Settings + discovery pane both edit dashboard tabs), the project-orchestrator agent will resolve sequencing.

## 11. What is OUT of scope

- Changing column positions in the Pipeline sheet (would break existing dashboards).
- Replacing the existing AI job-matcher (Match Score) wholesale. We're consolidating onto the LLM scorer for fit, but `matchScore` stays in the data model — populated from the same LLM call's `fitScore` so downstream consumers don't see nulls.
- Multi-profile support (one profile per user account). v1 = one profile per worker install.
- Per-strength custom weights with sliders. Rank order is the only weighting input the user touches.
