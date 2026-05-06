# Interface contract — Run Discovery `companyAllowlist` (per-run company picker)

**Status:** authoritative contract for the Run Discovery per-run company picker. Implementations must conform to this document; do not diverge without updating the contract docs and tests together.

**Scope:** the ephemeral per-run company override for `POST /discovery`. This document is authoritative for the wire format and server semantics between the dashboard and the discovery worker.

**Related existing contracts:** already-shipped `mode: "list_companies"` / `"skip_company"` / `"unskip_company"` on `POST /discovery-profile` (see `integrations/browser-use-discovery/src/webhook/handle-discovery-profile.ts`) — those are read-only / permanent-curation endpoints and are NOT changed by this work. The new override lives on the separate `POST /discovery` webhook, which is the one that actually kicks off a discovery run.

---

## 1. TypeScript: extend the `/discovery` request type

**File:** `integrations/browser-use-discovery/src/contracts.ts`

**Field name:** `companyAllowlist`

**Location:** **top-level** of the `/discovery` request object (NOT nested inside `discoveryProfile`). Rationale: the field is a run-selector, not part of the candidate profile, and we don't want the client to accidentally persist it when a future `persist`-like flow lands for profile overrides.

```ts
/** Optional per-run override: restrict the run's company list to exactly
 * these companyKey values, drawn from stored StoredWorkerConfig.companies
 * ∪ StoredWorkerConfig.companyHistory.
 *
 * Unknown keys (not present in either pool) are silently dropped.
 * When omitted or empty, the run behaves exactly as today — stored
 * companies (filtered by negativeCompanyKeys) are used as-is.
 *
 * Never persisted. Stored config is NEVER mutated by the presence of
 * this field.
 */
companyAllowlist?: string[];
```

Keep the field `readonly`-friendly (don't widen the existing request type in any other way). All other fields on the existing request type remain untouched.

---

## 2. HTTP: `POST /discovery` request body

**Existing request:** produced client-side by `buildDiscoveryWebhookPayload` in `app.js` (~line 2047). Shape today:

```jsonc
{
  "event": "command-center.discovery",
  "schemaVersion": 1,
  "sheetId": "…",
  "variationKey": "…",
  "requestedAt": "2026-04-23T…",
  "discoveryProfile": {
    "targetRoles": [],
    "locations": [],
    "remotePolicy": "",
    "seniority": "",
    "keywordsInclude": [],
    "keywordsExclude": [],
    "maxLeadsPerRun": 25,
    "groundedSearchEnabled": true,
    "sourcePreset": "browser_plus_ats"
    // ultraPlanTuning, groundedSearchTuning optional
  },
  "googleAccessToken": "…"
}
```

**New request (additive):** same shape plus an optional top-level `companyAllowlist`:

```jsonc
{
  "event": "command-center.discovery",
  "schemaVersion": 1,
  "sheetId": "…",
  "variationKey": "…",
  "requestedAt": "2026-04-23T…",
  "discoveryProfile": { /* unchanged */ },
  "googleAccessToken": "…",
  "companyAllowlist": ["notion", "figma", "ramp"]
}
```

### 2.1 Validation rules (server enforces)

The worker enforces these and rejects with HTTP 400 + a helpful `{ ok: false, message: "…" }` envelope when violated. Silently-dropped values listed here mean "accept the request but treat them as absent"; they are NOT an error.

| Rule | Behavior |
|---|---|
| Field absent | No-op. Run uses stored companies exactly as today. |
| `companyAllowlist: []` | No-op. Treated identically to absent. |
| Not an array (e.g. `companyAllowlist: 42`, `"notion"`, `{}`) | **400** with message: `"companyAllowlist must be an array of company key strings when present."` |
| Entry is not a string | **400** with message: `"companyAllowlist entries must be strings."` |
| Entry is whitespace-only after trim | Silently dropped. |
| Entry doesn't match any stored company (after normalization) | Silently dropped. |
| Too many entries (> 500) | **400** with message: `"companyAllowlist may not contain more than 500 entries."` |

### 2.2 Normalization

Server normalizes each entry by `String(x).trim().toLowerCase()` before lookup. This must match the normalization already used by `companyFilterKey` + `buildCompanyKeySet` (see `handle-discovery-profile.ts` — task B1 extracts these helpers). Clients should send raw `companyKey` values as returned by `mode: "list_companies"`; the server will normalize them either way.

---

## 3. Server behavior — how the allowlist is applied

**File to modify:** `integrations/browser-use-discovery/src/config.ts`, inside `mergeDiscoveryConfig`.

**Applied at merge time.** Order of operations (must be preserved):

1. Existing `filterSkippedCompanies(storedConfig.companies, storedConfig.negativeCompanyKeys)` → this is the baseline active list. (No change to this line.)
2. **New step** — if `request.companyAllowlist?.length > 0`:
   ```ts
   const allow = buildCompanyKeySet(request.companyAllowlist);
   const pool = [
     ...companies,                           // already-filtered active
     ...(storedConfig.companyHistory ?? []), // previously-seen, may include skipped
   ];
   companies = dedupeByCompanyKey(pool).filter(
     c => allow.has(companyFilterKey(c))
   );
   atsCompanies = atsCompanies?.filter(
     c => allow.has(companyFilterKey(c))
   );
   ```
   Where `dedupeByCompanyKey` keeps the first occurrence (active wins over history when the same key appears in both).
3. Everything downstream (`run-discovery.ts`, frontier scorer, etc.) consumes `EffectiveDiscoveryConfig.companies` as today. No changes needed past `mergeDiscoveryConfig`.

**Empty-result fallback:** if the allowlist matches zero companies, the resulting `companies` array is empty. This behaves identically to a never-configured profile: the worker falls through to its existing broadcast-search fallback. Do NOT throw or short-circuit the run on empty-result; existing downstream code handles it.

**Persistence:** `mergeDiscoveryConfig` must NOT call any upsert helper when `companyAllowlist` is present. The allowlist is ephemeral. Stored `companies` / `negativeCompanyKeys` / `companyHistory` remain untouched.

**ATS companies:** same rule applied symmetrically — `atsCompanies` is filtered to the intersection. If a company is in the allowlist but only present in `atsCompanies` (not in `companies` or `companyHistory`), the user gets it in the ATS lane only. That's intentional and matches how `atsCompanies` is treated today.

---

## 4. Shared helpers extracted (backend workspace, task B1)

Move these three functions from `handle-discovery-profile.ts` to a new module `integrations/browser-use-discovery/src/discovery/company-keys.ts` and re-export from there. Keep the existing call sites in `handle-discovery-profile.ts` working — just update the import paths.

```ts
// src/discovery/company-keys.ts
import type { CompanyTarget } from "../contracts.ts";

/** Normalize a user-provided or extracted company key to the canonical
 * lookup form (trim + lowercase). Also used as the map key for
 * Set<string> membership checks. */
export function companyFilterKey(company: CompanyTarget): string { /* … */ }

export function buildCompanyKeySet(keys: unknown): Set<string> { /* … */ }

export function filterSkippedCompanies(
  companies: CompanyTarget[] | undefined,
  negativeCompanyKeys: unknown,
): CompanyTarget[] { /* … */ }
```

No behavior change. `handle-discovery-profile.ts` imports these instead of declaring them. `config.ts` imports `buildCompanyKeySet` + `companyFilterKey` from here too.

---

## 5. Frontend obligations (summary for backend to code against)

The frontend workspace is on the hook for these behaviors. Backend does NOT need to implement them, but if frontend deviates, the integration test will catch it.

1. On the Run Discovery modal's "Company targets" tab open, call `POST /discovery-profile` with `{ mode: "list_companies", sheetId }` to fetch `{ active, skipped, history }`.
2. Render `active` rows default-checked; render `history` rows default-unchecked and gated behind a "Show history" toggle. Skipped rows are NOT shown in this picker (users manage those from the top-level Companies panel).
3. Maintain an in-memory `Set<companyKey>` — the selection — seeded with active keys on load.
4. "Pick N random" button calls the frontend's `pickRandomCompanies(library, n)` helper (Fisher-Yates) and replaces the selection with those keys.
5. On "Run now", if the selection differs from the full active set, include `companyAllowlist: Array.from(selection)` on the `/discovery` payload. Omit the field when selection equals the full active set (keeps the payload clean when the user didn't touch the picker).

---

## 6. End-to-end test (orchestrator writes after both sides land)

Located at `integrations/browser-use-discovery/tests/webhook/companies-run-allowlist.integration.test.ts`. Fixture scenario:

- Stored config: `companies=[notion, ramp]`, `companyHistory=[figma, airtable]`, `negativeCompanyKeys=["airtable"]`.
- Request payload includes `companyAllowlist: ["notion", "figma", "airtable"]`.
- Assertion: the `EffectiveDiscoveryConfig` handed to `run-discovery` has `companies` keyed `["notion", "figma"]` only. `airtable` is dropped because it's in the negative list AND the allowlist doesn't override skipped-company safety (the negative list is enforced at the earlier `filterSkippedCompanies` step, and `airtable` never makes it into the baseline pool).

Wait — clarification needed: does the allowlist override the negative list, or not?

**Decision (authoritative):** NO, the allowlist does NOT override the negative list. Eliminated companies stay eliminated. The user's intent for an eliminated company is "never run against this again"; the per-run picker is for subsetting the *available* pool, not resurrecting eliminated ones. To use an eliminated company, the user must first Restore it from the top-level Companies panel.

Implementation consequence: the `pool` assembled in §3 step 2 is built from `companies` (which is already filtered by `filterSkippedCompanies`) and `companyHistory`. Before intersecting with the allowlist, also filter `companyHistory` through `filterSkippedCompanies` so eliminated entries in history don't slip through.

```ts
const historyMinusSkipped = filterSkippedCompanies(
  storedConfig.companyHistory,
  storedConfig.negativeCompanyKeys,
);
const pool = dedupeByCompanyKey([...companies, ...historyMinusSkipped]);
companies = pool.filter(c => allow.has(companyFilterKey(c)));
```

This is the final rule both workspaces must code against.

---

## 7. Non-goals

- No UI for the allowlist outside the Run Discovery modal. Top-level Companies panel is unaffected.
- No backend API for "list my last N run allowlists". Each run is independent.
- No randomize on the server. Randomization is client-side UX only.
- No schema version bump on the `/discovery` request. The field is additive and optional; existing payloads continue to work unchanged.
