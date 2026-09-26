# Beat 4 inventory and data contract (opus verifier V2, 2026-09-26)

## Controls as rendered (`oneflow-beat-fit.js:483-707`, HEAD = working tree)

1. **Card "Looking for"**
   - error line (roles)
   - **target roles** chip editor: text input per chip plus ↑ ↓ ×; "Add a target role" input plus an "Add" link-button; Enter adds; deduped on add only
   - **Seniority** `<select>`: 12 options, intern…c_level, plus any
   - read-only location summary line (for example "Remote · $120k floor")
2. **Card "Your edge"**
   - error line (strengths)
   - ordered **strengths**: rank number, text input, ↑ ↓ ×, `draggable` row; "Add a strength" plus Add
   - error line (narrative)
   - **narrative**: a one-line truncated `<em>` plus an "edit" link that toggles a hidden 4-row textarea; no label
3. **Card "Lean toward / away"**
   - h4 "Lean toward": **wants** chips (× only)
   - h4 "Lean away": **avoids** chips (× only)
4. **`<details>` "Edit details"** (6 controls)
   - **Work mode** radios: Any / Remote only / Hybrid OK / Onsite OK
   - **Acceptable locations** chips: shown only for hybrid or onsite
   - **Salary floor (USD/year)**: number input, step 1000
   - ☐ "Reject listings without published salary"
   - **Skip titles** chips
   - **Work authorization** `<select>`: Any / US citizen / US authorized / Needs sponsorship
5. **`<details>` "Raw profile JSON"**: a `<pre>` that is rebuilt on every keystroke
6. Action: **"Looks like me →"**

These fields are visible only in the raw JSON: strength `evidence` and `keywords`, `experiences`, `projects`, `tieBreakers`.

## Server contract

The server contract is `POST {profileApiBase}/profile`, validated against `integrations/browser-use-discovery/src/contracts/user-profile.schema.json`:

```
{ version:1,
  identity:{ targetRoles[1..8, ≤80ch], targetSeniority enum, primaryNarrative 20..1200 },
  strengths:[1..8]{ name 2..60, rank, evidence? ≤400, keywords?[≤20] },
  hardConstraints:{ workMode enum, workAuth enum, salaryFloor int|null,
                    acceptableLocations?[≤20], skipTitles?[≤30], salaryRequired?:true },
  wants?[≤12, 2..200ch], avoids?[≤12], experiences?[≤24], projects?[≤24], tieBreakers? }
```

`salaryFloor` is "used only when salaryRequired=true" (schema description). That is finding N-B4-4.

## Local store contract

The local store is `CommandCenterUserContent.saveDiscoveryProfile` (`:186-215`):

```
{ targetRoles:"a, b", locations:"…" (hybrid/onsite only), remotePolicy:"remote|hybrid|onsite|",
  seniority:<label>, keywordsInclude:<strength names>, keywordsExclude:<skipTitles ∪ avoids> }
```

## Suggested regroup

1. **Target**: roles, seniority
2. **Your story**: narrative, always visible
3. **Strengths**: ranked
4. **Deal-breakers**: work mode, locations, auth, salary floor plus salary-required as one control
5. **Preferences**: wants, avoids, skip titles; collapsed by default
