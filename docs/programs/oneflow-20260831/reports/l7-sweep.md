# LANE REPORT — L7 (sweep)

Branch: `feat/oneflow-sweep` · 8 commits, all local, nothing pushed.
Net: **82 files changed, 2 250 insertions, 19 666 deletions** — 18 files
deleted outright, 3 added (`css/onboarding-celebration.css` and the two new
probe suites).

---

## 1. What this lane was

Spec §7's deletions table, executed as the work order, plus the three
decisions the orchestrator routed here after L6.

L6 flipped boot to the one flow and left the legacy surfaces *defined but
unreachable* on purpose, so the cutover could be proven. This lane deletes
them, so the repo a stranger clones contains **one** onboarding rather than
two. Eight commits, one deletion unit each, `npm test` green at every one.

| # | Unit | Commit |
|---|---|---|
| — | Routed decisions 8/9/10 | `cf29747` |
| 1 | Enhancements wizard → Settings → Upgrades | `ee3c47c` |
| 2 | The blocking discovery gate | `f100fd3` |
| 3 | Both legacy onboarding wizards | `2b8812e` |
| 3c | `#setupScreen` ("One more step.") | `38cf6df` |
| 4 | welcome.js's onboarding half + WELCOME.md | `fcd4334` |
| 5 | The discovery modal maze → one button | `87afec4` |
| 6 | Dead elements, flags, fossils | `894d644` |

---

## 2. Which claims went red first (named tests)

Every unit opened with a failing probe. Two new suites:
`tests/oneflow-l7-routed.test.mjs` (8 tests) and
`tests/oneflow-l7-sweep.test.mjs` (50 tests).

**Routed decisions** — `tests/oneflow-l7-routed.test.mjs`, 7 of 8 red:

- `routed 8 · B3 leaves the drafted profile under runtime.profileDraft` —
  red: B3 wrote `resumeDraft`, B4 read it through an alias.
- `routed 8 · B4 still arrives drafted — the handoff survives the rename`
- `routed 8 · neither beat file mentions the retired alias`
- `routed 9 · renders the user's name, never the raw {firstName} token` —
  red: the shell title painted the literal template.
- `routed 9 · drops the comma when Google gave no name`
- `routed 10 · a mid-flow showSheetAccessGate does not paint over the beat`
- `routed 10 · the gate paints normally again once the flow closes`

**The sweep** — `tests/oneflow-l7-sweep.test.mjs`, red per unit before each
commit. Representative:

| Unit | Red-first claim |
|---|---|
| 1 | `the module and its suite are deleted` · `the three *EnhancementDismissed flags leave the store` · `is a real tab: button, panel, and schema entry all present` · `B6's footer line is not a lie — the power-ups it names live here` |
| 2 | `nothing anywhere in the tree markup or drives it` (repo-wide) |
| 3 | `module, partial, CSS and every suite that pinned it are deleted` · `B1 keeps its sheet checker — moved, not deleted` · `exactly ONE call site plays the celebration (§10 Phase 1 acceptance)` |
| 3c | `the markup, and the duplicate headline it carried, leave index.html` · `signed-in-with-no-sheet routes to Beat 1, not to a deleted screen` |
| 4 | `the 9-step machine, its storage, and its self-test are gone` · `welcome.css keeps only what the card renders` · `WELCOME.md documents only what ships` |
| 5 | `no module opens, closes, or populates any of the five` · `offers a single Open discovery setup, not five competing paths` |
| 6 | `the pendingDiscoverySetup plumbing is gone — writer, resumer, exports` · `the login gate's no-oauth sub-wizard is gone — Beat 1 owns that path` · `the Settings jb-v2 claim is corrected — it is ON by default` |

Two probe designs worth naming, because a weaker version would have passed
on a broken tree:

- **Repo-wide, not file-scoped.** A grep pinned to `onboarding-wizard.js`
  cannot prove a deletion once that file is itself deleted — it throws, or
  worse, silently passes. `shippedSources()` walks the repo root plus
  `partials/`, `css/`, `scripts/lib/` and asserts the absence across all of
  them.
- **Every deletion is paired with its replacement.** Nothing is asserted
  gone without asserting where the user goes instead: the Upgrades tab
  carries the retired cards, `sheet-access-setup.js` carries B1's sheet
  checker, `revealSetupScreenAfterAuth` opens Beat 1, the account menu and
  both Settings reset buttons open the flow.

---

## 3. What shipped, file-and-fence

### Routed decisions (granted beyond the deletion table)

**8 — one draft key.** `oneflow-beat-resume.js` (:429, :497) writes
`runtime.profileDraft`; the `resumeDraft` alias and its comment are gone from
`oneflow-beat-fit.js`. Two names for one seam is the shape that breaks on the
third reader.

**9 — the shell title shows the resolved headline.** `onboarding-flow.js`
`normalizeBeat` now accepts a function for `headline`, and `renderBeat`
resolves it once through a new `resolveHeadline(beat, ctx)` (a throwing
resolver warns and degrades to `""` rather than taking the beat down).
`oneflow-beat-payoff.js` registers the resolver, so the SHELL reads
"You're live, Priya." — previously only the celebration overlay resolved it
and the raw `{firstName}` was user-visible.

**10 — the gate stands down for a live beat.** `showSheetAccessGate`'s
ownership guard in `sheet-access-setup.js` gained the flow check, so a
mid-flow token expiry cannot repaint the login gate over a beat; the mode is
still recorded on `dataset.gateMode`, so the gate resumes correctly on close.
(Unit 3 then collapsed the guard's now-dead first-run half.)

### Deletions

| Deleted | With it |
|---|---|
| `enhancements-wizard-ui.js` | mount, script tag, `typecheck:repo` entry, `JobBoredEnhancements` bridge, `requestEnhancementsSetup` forwarder, 3 `*EnhancementDismissed` store flags, go-live's "Maximize your results" cross-rec, `tests/enhancements-wizard.test.mjs` |
| `#discoverySetupGate` | its markup, `show/hideDiscoveryGate`, both click handlers, the `onClose` gate-reassert |
| `first-run-wizard.js` + partial + `css/legacy-first-run-wizard.css` | 6 suites, every bridge/compat/app wire, `firstRunWizardOwnsSurface` |
| `onboarding-wizard.js` + partial + `css/legacy-onboarding.css` | 2 suites, the delegating celebration alias, 4 legacy stage configs, every bridge/compat/app wire |
| `#setupScreen` | `revealPipelineSetupStepsScreen`, `renderSetupStarterSheetUi` and its 8 call sites, the `#setupCreateStarterSheetBtn` listener |
| welcome.js's onboarding half | 9 steps, `jb-v2-onboarding` storage, the write-through, the self-test; 984 → 243 lines. `welcome.css` 494 → 183. |
| `partials/discovery-modals.html` (5 modals) | `discovery-setup-modals.js` 1008 → 162 lines, `app-compat` forwarders, bridge/app wires, the drawer's 5 Connection buttons, `#settingsTunnelStaleBadge` |
| Dead elements/flags | `#enhancementsReEntryBtn`, 2 whats-next badges, the `#onboardingWizardBtn` handler, `fitProfileOnboardingComplete`, the whole `pendingDiscoverySetup` queue, the login gate's no-oauth sub-wizard (132 lines of markup + 208 of orphaned CSS) |

### Kept, or moved rather than deleted — each because the flow uses it

- **`verifyExistingSheetAccess`** moved from `first-run-wizard.js` into
  `sheet-access-setup.js`. B1's paste path is its one remaining caller;
  LANE-REPORT-L1 §5 asked for exactly this relocation, and deleting it would
  have made B1's "paste a sheet link" path dead.
- **The celebration overlay's CSS** moved out of `css/legacy-onboarding.css`
  into a new `css/onboarding-celebration.css`, carrying `.sr-only` with it
  (`index.html` and `partials/profile-materials-modal.html` both use it, and
  that stylesheet was its only definition). Deleting the file wholesale would
  have unstyled the *one* celebration §7 exists to protect.
- **`discoverySetupSkipped`** store trio — `whats-next-banner.js` reads it.
- **`handleAppsScriptBrowserCorsFailure`** and
  **`testDiscoveryWebhookFromSettings`** — see §5.
- **The gate's error mode** and **`handleSetupCreateStarterSheet` /
  `createBlankStarterSheet`** — B1 drives the creator through the host bridge.

### Re-entry capability preserved, not deleted

Three surfaces used to reopen a legacy wizard. All three now open the flow
(`JobBoredOneFlow.open()`), so no user loses a way back in:
"Resume onboarding" in the account menu (`auth-session.js`), and both
Settings reset buttons (`materials-feature.js`). `revealSetupScreenAfterAuth`
hands a signed-in-without-a-sheet user to Beat 1;
`showSheetAccessGate("no-oauth")` hands the client-ID case to Beat 1. Both
fall back to the gate's error mode if the flow module never loaded.

### Settings → Upgrades (the replacement §7 asks for)

New `upgrades` tab: `settings-tab-schema.js` entry + button and panel in
`partials/settings-modal.html`. Static markup, no new JS module, no new CSS —
it reuses `.settings-setup-block`. Carries the retired wizard's three
`more_optional` cards plus the three power-ups B6's footer promises live
there. The wizard's own pointers had rotted (there is no Settings → General
tab, and no Browser Use Cloud switch anywhere), so each card names a switch
that exists: Settings → ATS Scoring, `logoDevToken` in `config.js`,
`BROWSER_USE_API_KEY` in the worker's `.env`, Settings → AI Providers.

### Test ownership

8 suites deleted with their surfaces. Where a deleted suite carried a claim
that outlives its owner, the claim was **re-homed, not dropped**:

- completion-flag ordering → `onboarding-flow.js`'s `finishFlow`
  (`tests/data-integrity-resume-and-saves.test.mjs`), including the new claim
  that a skipped connection does not mark discovery complete.
- provider-key save honesty → `oneflow-beat-ai.js`'s
  `persistProviderConfig` (same suite).
- the celebration player's behavior → already covered by
  `tests/oneflow-l4-celebration.test.mjs`, whose legacy-stage and
  delegating-alias blocks this lane rewrote.
- the OAuth Client ID input's accessible name → B1
  (`tests/wizards-modal-a11y-focus.test.mjs`).
- the no-oauth "create a Client ID" path → B1
  (`tests/oneflow-l5-repairs.test.mjs`).

`tests/e2e-smoke/boot-smoke.spec.mjs` (Playwright, not part of the floor —
so nothing caught it) still asserted the login gate owned greenfield boot and
opened the first-run wizard. Both now assert screen S0 and a beat.

### Fossils corrected

`Off by default` → `On by default` in the Settings jb-v2 hint (index.html
defaults it ON). `Task #6` removed from `fit-profile.css` and
`fit-profile-backcompat.js`. `jb-v2-legacy-hide.css`'s three
"intentional non-target" lists and index.html's blank-shell detector no
longer name `#setupScreen`. `CONTRIBUTING.md`, `docs/GITHUB-PAGES.md` and
`docs/DISCOVERY-WIZARD-SPEC.md` no longer instruct readers to look at deleted
files. `MIGRATION.md` §7 and `WELCOME.md` rewritten to describe what ships.
"Step 1 of 9", `aria-valuemax="3"`, and the duplicate "One more step."
headlines left with their surfaces in units 2 and 3.

---

## 4. Floor results — PASTED output

### `npm test`

```
ℹ tests 2490
ℹ suites 595
ℹ pass 2489
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 5984.792792
EXIT=0
```

The single `todo` is the pre-existing
`tests/submission-record-audit.test.mjs:17` marker
("blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB
store"). It was `todo` on the pre-lane baseline (`.lane-evidence/baseline-test.txt`,
`tests 2713 / pass 2712 / fail 0 / todo 1`) and is untouched by this lane.

### `npm run lint:repo`

```
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
EXIT=0
```

### `npm run typecheck:repo`

```
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

EXIT=0
```

### `npm run test:contract:all`

```
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
EXIT=0
```

Full captures: `.lane-evidence/floor-test.txt`, `floor-lint.txt`,
`floor-typecheck.txt`, `floor-contract.txt`.

---

## 5. The grep table (DoD) — and anything unverified

### Final grep pass

```bash
grep -rnE 'firstRunWizard|onboardingWizard|enhancementsWizard|discoverySetupGate|setupScreen|EnhancementDismissed|pendingDiscoverySetup' \
  --include='*.js' --include='*.mjs' --include='*.html' --include='*.css' --include='*.json' --include='*.md' .
```

**Zero hits in shipped code.** 145 remaining hits, all justified:

| Hits | Where | Justification |
|---|---|---|
| 65 | `docs/superpowers/plans/2026-06-09-optional-enhancements-wizard.md` | Dated plan doc for the wizard §7 deletes — a historical record of how it was built, not an instruction. |
| 20 | `docs/superpowers/plans/2026-06-09-mandatory-discovery-gate.md` | Same: the dated plan that shipped the gate §7 deletes. |
| 18 | `tests/oneflow-l7-sweep.test.mjs` | This lane's own probes. Every hit is the *name of the thing asserted absent*. |
| 6 | `docs/programs/oneflow-20260831/KICKOFF-L7-sweep.md` | This lane's kickoff — the work order itself. |
| 5 | `docs/superpowers/specs/2026-06-09-optional-enhancements-wizard-design.md` | Dated design spec for the deleted wizard. |
| 4 | `tests/discovery-cold-start-handoffs.test.mjs` | Three assert the `pendingDiscoverySetup` key is **absent**; one is the comment explaining why the section anchor moved. |
| 4 | `docs/ONE-FLOW-ONBOARDING-SPEC.md` | The spec's own §7 deletions table — the source of this work. |
| 2 | `docs/DISCOVERY-WIZARD-SPEC.md` | Both corrected this lane to point at `discovery-wizard-shell.js`; the remaining mentions name the deleted id only to say it is gone. |
| 1 | `tests/oneflow-l6-cutover.test.mjs` | Asserts `window.JobBoredApp.firstRunWizard` is `undefined` — the namespace is gone. |
| 1 | `docs/tech-debt-analysis.md` | Dated audit with app.js line numbers; a snapshot of a past tree. |
| 1 | `docs/refactor/STATUS-app-js-remainder-swarm.md` | Dated session log quoting a 2026-era commit and test count. |
| 1 | `docs/programs/oneflow-20260831/SUBSTRATE.md` | The program's ownership map, listing exactly these files as L7's to delete. |
| 15 | `.factory/validation/**/*.json` | Captured user-testing transcripts and scrutiny reviews from earlier rounds — evidence artifacts, immutable by nature. |

### Deliberate divergence from the kickoff (flagged, per rule 7)

The kickoff says "`discovery-setup-modals.js` + tests"; spec §7 says the
"five legacy discovery modals + `discovery-setup-modals.js` **copy**". I
followed the spec. Deleting the file outright would have taken two live
surfaces §7 never names:

- `handleAppsScriptBrowserCorsFailure` — Apps Script CORS remediation,
  called by `discovery-run-orchestration.js:415` and
  `discovery-wizard-ui.js:3040`, nothing to do with a modal.
- `testDiscoveryWebhookFromSettings` — the Settings **Test webhook**
  diagnostic. §7 names "the drawer's five Connection **buttons**"; counting
  the panel, that is paths / guide / local+ngrok / relay / tailscale — exactly
  five. Test webhook is the sixth control and a diagnostic, so it stays.

The file survives at 162 lines with a header saying what it now is. **Its
name is now a fossil** — a `-modals.js` with no modals. I did not rename it:
that means a new `typecheck:repo` entry and a new script tag, and ground-rules
trap 2 says report an unplanned file rather than create one. Recommended
follow-up: rename to `discovery-settings-actions.js`.

### Judgment calls made inside the fence

1. **Docs beyond §7's literal list.** `MIGRATION.md` §7 carried a 40-line
   localStorage schema for the deleted 9-step flow, and `CONTRIBUTING.md` /
   `docs/GITHUB-PAGES.md` / `docs/DISCOVERY-WIZARD-SPEC.md` instructed readers
   to look at deleted files. §7 names only "WELCOME.md step spec", but leaving
   these is the "one onboarding, not two" failure the mission names, so I
   corrected them. Dated retrospectives were left alone.
2. **Callers of deleted modules treated as in-fence.** A deletion is
   impossible without them, and leaving a CTA that calls a deleted module
   ships a dead button. This is why `go-live-wizard-ui.js` (L4's fence),
   `discovery-wizard-ui.js` (L3's), and `materials-feature.js` are touched.
3. **`renderSetupStarterSheetUi` deleted rather than left as a no-op.** Its
   only DOM was `#setupScreen`'s button and status line, so all eight call
   sites were painting nothing.
4. **The `?discovery=paths` / brief `agent` deep links** now open the
   discovery wizard instead of the deleted "ways to avoid webhooks" modal —
   the same question, answered by the surviving surface.
5. **`.login-gate__btn-oauth-primary` / `--secondary` left in place.** They
   had no HTML users *before* this lane, so they are pre-existing dead CSS,
   not orphans I created (global rule 3). Worth a separate cleanup.

### Unverified / not covered

- **`tests/e2e-smoke/boot-smoke.spec.mjs` was updated but NOT run.** It is a
  Playwright suite outside the four floor commands, and running it spawns
  `dev-server.mjs` on a live port. The two rewritten assertions are reasoned
  from the L6 boot path and the shell's mount id, not observed in a browser.
  Someone should run `npm run test:e2e-smoke` before the PR merges.
- **No browser was driven.** Every claim in this lane is a unit/integration
  test or a source-level assertion. The Upgrades tab's *rendering* (as
  opposed to its markup, schema entry, and copy) is unverified visually.
- **`discoverySetupSkipped` now has no writer.** The gate's confirm-escape
  was the only one, and unit 2 deleted it. The flag is observable-only —
  `whats-next-banner.js` exposes it but `discoveryComplete` alone drives the
  CTA — so nothing regresses, and the kickoff explicitly says the flag stays.
  But it is now a permanently-false read. B5's connect skip is the natural
  new writer; that is a behavior change in L3's fence that §7 does not name,
  so I left it. **Flagged for the orchestrator.**
- **`STEPS.FIRST_RUN_DONE` telemetry has no emitter.** `first-run-wizard.js`
  was its only one. The vocabulary is deliberately frozen (dashboards read
  historical events, and a frozen name must never be reused), so I left the
  key and deleted only the test for the deleted emitter. `onboarding-telemetry.js`
  is L0's fence in any case.
- **`tests/oneflow-l6-harness.mjs` was edited** (L6's file): `PAGE_SCRIPTS`
  and `MOUNT_IDS` referenced deleted files, and the routed gate probe needed
  `core.getSHEET_ID` — `sheet-access-setup.js:163,:411` reads the sheet id off
  `core`, not `core.host`, and the harness only modelled the latter. Additive;
  all L6 suites stay green.
- **Sandbox refused nothing.** All eight commits landed locally. One snag
  worth recording: this worktree's `node_modules` and `server/node_modules`
  are **symlinks** into the main checkout, and `git add -A` staged them into
  the first commit. Caught and amended out; both paths are now in
  `$(git rev-parse --git-common-dir)/info/exclude` (a local, uncommitted file)
  so no later worktree hits it.
