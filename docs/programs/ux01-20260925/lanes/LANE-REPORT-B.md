# UX01 lane B (Entry & Find): lane report

Branch `feat/ux01-entry-find`, cut from `feat/ux-zero-to-one` at cca3e30. Worktree `~/Job-Bored.worktrees/ux01-entry-find`. Not pushed.

## Upstream merges: both conflicted, both aborted

Per the kickoff, neither upstream conflict was resolved here. Both merges were aborted, and this branch builds only on `feat/ux-zero-to-one`.

- `git merge --no-edit feat/greenfield-integration` (#104) conflicted in `tests/sixbeats2-beat-provider.test.mjs`.
- `git merge --no-edit feat/discovery-hardening` (#102) conflicted in `package.json` and `tests/e2e-journey/critical-journey.spec.mjs`.

**Expect conflicts when #104 lands.** It edits the same files this lane changes: `onboarding-flow.js`, `oneflow-beat-{google,ai,resume,payoff}.js`, `model-catalog.js`, `discovery-setup-modals.js` and `discovery-status-handoff.js`. Where #104 already fixes something, this lane followed it rather than inventing a second version:

- FR-05: #104 adds `detourOpen`. This lane adds the same key and also sets it on an invalid save, which #104 misses.
- FR-07: #104 pins `gemini-3.5-flash`. This lane changes only OpenRouter's default.

The same risk applies to #102 in `discovery-status-handoff.js` and `discovery-run-tracker.js`.

## What changed for the user

- **Setup no longer traps you on sample data.** Once Google has created or connected your Sheet, closing setup (Esc or ×) or choosing "Poke around first" takes you to your real board. A "Resume setup" pill is the way back in. A paused flow's invitation now reads "Resume setup — {step}" instead of offering the whole deal again. The last step adds "Track a job you already found", which opens manual add, so even a stranger with no discovery ends on one real row. The sample board is no longer dimmed to about 2.8:1 contrast.
- **Setup is honest.**
  - The invitation says "about 20–25 minutes" and names what you'll need. Each step's "min left" label matches.
  - The final receipt ticks AI and discovery only if those steps actually passed their checks; otherwise it shows ○ with the next step.
  - The Google step explains what a Client ID is for. It warns about Google's "unverified app" screen instead of promising it away, and stays open when you mistype an ID.
  - A signed-out user with an existing Sheet signs in and connects *that* sheet in one click. A signed-in user whose Sheet is already connected is told so.
  - The recommended AI card defaults to a model strong enough for letters.
  - Discovery offers "Just this computer" as a first-class choice next to Tailscale.
  - Every step names one start command, and the SerpApi arithmetic is honest ("about 20 runs a month").
- **Discovery asks before it touches your computer.** Every dashboard click that would rewrite `integrations/browser-use-discovery/.env`, restart the local worker or redeploy the relay first shows a confirm naming the file, the keys and the restart, and logs the answer. Opening the setup wizard only looks; it no longer repairs silently.
  - When search isn't set up, the drawer's button reads "Set up (~3 min)" and offers "Add a job from a link instead".
  - The wizard preselects the card it calls Recommended.
  - The step rail uses outcome words, and the false "no terminal step" claim is gone.
  - Every readiness state has its own plain label.
  - The coach no longer recommends Cloudflare, and Esc closes the coachmark before the drawer.
- **Your roles stay in your search.** Every role you type goes into the query; the rotation only adds one "also trying" title.
  - Run toasts drop run IDs and "worker logs". A finished run says "Found N new roles" with a View action, and a failure points at Runs.
  - The run preview shows roles, where and sources in plain words, with hashes behind "Technical details".
  - The runs log stops saying "Loading runs…" under loaded rows, and stops promising a retry that will never come.
- **A capture button for any job site.** The drawer's Search tab has a draggable "+ Save to JobBored" bookmarklet. On a posting, it reads the page's schema.org JobPosting and opens JobBored with manual add prefilled. It uses no server and no extension, and nothing is sent anywhere else.

## Changes

| Id | Status | Note |
|---|---|---|
| C6 | done | FR-02, FR-10, FR-19 and AX-09 all shipped. The FR-10 manual add goes through `JobBoredIngest.openManual`, falling back to the legacy manual modal. |
| C7 | partial | Done: FR-05, 07, 09, 11–18, 20. **FR-23 skipped:** P3, and removing the burst card's headline and sub moves five pinned suites plus the finale-burst visual spec. **SS-12 handed off:** `settings-modal.js` and `config.example.js` belong to lane F. **FR-17 deviation:** the audit says to use `npm start`, but that doesn't start the discovery worker B5 needs, so every beat names `npm run dev`. **FR-20 partial:** the beat says "Signed in as … · Sheet connected ✓" and Continue finishes without creating a sheet, but it does not auto-advance. |
| C8 | done | FD-04, 05, 06, 14, 19 and 20 shipped. FD-19 covers every call site this lane owns. `setup-doctor.js:631` and `settings-profile-tab.js:615` are handed off. |
| C9 | partial | Done: FD-09, 10, 11, 12 (the toast counts found roles and has a View action), 15, 16, 25, and SS-24. **Handed off:** FD-18 and SS-19 (the cron is generated in `settings-profile-tab.js`; the label now has a hook), FD-21 (tab scrolling is CSS in lane A's `legacy-discovery-drawer.css`), FD-07 (Connection belongs in Settings, lane F). **Not done (M effort, out of time):** FD-12's persistent strip under the top bar (lane C owns the top bar), FD-13, FD-17's 4-column runs table, FD-26's profile summary with "Edit for this run", FD-08. |
| C10 | done, pending one handoff | `capture-bookmarklet.js` plus the drawer's "Save jobs from any site" button. It goes live once `index.html` loads the script (handoff). |

## Contracts touched

- None of the Sheet write-back contracts were touched: `data-action`, `data-stable-key`, `expandedJobKeys`, `updateJobStatus`, the PIPELINE-CARDS-HANDOFF selectors and `schemas/pipeline-row.v1.json`. C10 writes rows only through the existing manual-add path.
- The discovery search-plan query changes:
  - `query.targetRoles` now carries every user role plus at most one adjacent title (it used to carry one of the user's roles plus one adjacent title).
  - New field `selected.alsoTrying: string[]`.
  - The worker reads `targetRoles` as a comma list, as before.
- `discovery-readiness-truth` labels changed. The `level` and `reason` codes did not.

## APIs added

- `window.JobBoredOneFlow`: `hasSheet()`, `revealRealBoard()`, `resumeLabel()`, `loadState()`.
- `window.JobBoredOneFlowDemoBoard`: `primaryLabel()`, `refresh()`.
- `window.JobBoredDiscoveryHelpers`: `confirmHostChange(opts)`, `describeHostChange(opts)`, `hostChangeLog`, `DISCOVERY_ENV_PATH`.
- `window.JobBoredDiscoveryCoach.isActive()`.
- `JobBoredDiscovery.drawer.syncDiscoveryDrawerFooter(classified)`.
- `recoverIfPossible({ confirmRecover })`. `runDiscoveryTailscaleAutoSetup({ confirmHostChange })` is a test seam.
- `window.JobBoredCapture`: `parseCaptureHash`, `encodeCapture`, `sanitizeCapture`, `extractJobPosting`, `buildBookmarkletHref`, `openManualWithCapture`, `consumeCaptureHash`, `installBookmarkletLinks`.
- Consumed but not built here: `JobBoredIngest.openManual({ source, url?, prefill? })` (lane D), and the `jb:view:request` event `{ view: "pipeline" }` (lane C).

## Baselines refreshed

None. The e2e-visual suites assert structure, not pixel snapshots. The copy constants they share (`INVITE_PRIMARY`) were updated to the new strings.

## Handoffs

| File | Owner | Change | API |
|---|---|---|---|
| `index.html` | A (head) or C (body) | Add `<script src="capture-bookmarklet.js" defer></script>` after `ingest-url-flow.js`. | `window.JobBoredCapture` |
| `ingest-url-flow.js` | D | `JobBoredIngest.openManual({ source, url, prefill: { title, company, location, description } })` opens manual add with those fields filled. Payoff, the drawer and capture already call it. | `JobBoredIngest.openManual` |
| `settings-profile-tab.js` | F | FD-18/SS-19: build the cron and the `TZ=` guard from `Intl.DateTimeFormat().resolvedOptions().timeZone`, and set `#settingsProfileScheduleCloudTzLabel` text and `data-tz` to match. | none |
| `settings-profile-tab.js:615`, `setup-doctor.js:631` | F | FD-19: wrap the `start-discovery-worker` and `fix-setup` POSTs in `JobBoredDiscoveryHelpers.confirmHostChange({ action, writesEnv, restartsWorker })`. | `confirmHostChange` |
| `settings-modal.js`, `config.example.js` | F | SS-12: one default provider; match B2 (OpenRouter with `openai/gpt-5.4-mini`). | none |
| `bridge-registry.js` | owner of the bridge (F?) | Add `openDiscoverySetupWizard` to `discovery.drawer.host`. The drawer calls the wizard UI directly until then. | none |
| `css/legacy-discovery-drawer.css` (to be renamed) | A | FD-21: scroll the tablist horizontally at 375 with an edge fade. Style `.discovery-drawer__setup-hint` and `.discovery-drawer__capture`, which use the existing hint and button classes for now. | none |
| top bar | C | FD-12: a persistent run strip ("Searching…", "Found N new · View") under the top bar. Listen for `jobbored:job-discovery-run-updated`, and answer `jb:view:request`. | none |

## Tests added

- `tests/ux01-c6-real-board.test.mjs`
- `tests/ux01-c7-honest-setup.test.mjs`
- `tests/ux01-c8-consent.test.mjs`
- `tests/ux01-c9-find.test.mjs`
- `tests/ux01-c10-capture.test.mjs`

Red-then-green was recorded for two of them. C6: 8 of 11 failed before the change. C9 FD-09: 2 of 2 failed before the change. Existing tests that pinned the old copy or behaviour were updated in the same commit as the change they pin.

## Floor (tails)

Run sequentially from the worktree root after the last code commit (0bd0da8). Logs are in `~/Job-Bored.worktrees/.ux01-run/final-B/`. Every command exits 0. The one `todo` in `npm test` is `submission-record-audit`, which is blocked on the canonical-ownership gate and was already there on the base. The contract suite also prints `OK discovery-payload.js covers schema properties`, so the new `selected.alsoTrying` field stays inside the schema.

### npm run lint:repo
```
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
EXIT 0
```
### npm run typecheck:repo
```
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
EXIT 0
```
### npm test
```
ℹ tests 3121
ℹ pass 3120
ℹ fail 0
ℹ skipped 0
ℹ todo 1
EXIT 0
```
### npm run test:contract:all
```
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
EXIT 0
```
### npm run test:e2e-smoke
```
  ✓  11 tests/e2e-smoke/hermetic-fence.spec.mjs:70:1 › should answer every host-mutating /__proxy and /profile path in the fence (301ms)
  11 passed (14.5s)
EXIT 0
```
### npm run test:e2e-journey
```
  ✓  13 tests/e2e-journey/critical-journey.spec.mjs:623:1 › should serve the dashboard's own /profile from the local API, never a static 404 (360ms)
  13 passed (21.8s)
EXIT 0
```
### npm run test:e2e-visual
```
  ✓  37 tests/e2e-visual/shell-structure.spec.mjs:310:3 › the one shell on a phone — claim C7 › should dock the footer at the bottom of the viewport, not the bottom of the card (1.0s)
  37 passed (1.0m)
EXIT 0
```

Not verified: the mockup was not opened in a browser in this lane (time). No manual pass was driven through the hermetic harness beyond the e2e suites.

## Verification · floor (B-r1)

Independent Opus verifier, fresh context, run 2026-09-25 against HEAD `1f4680d` with a clean tree. Logs: `Job-Bored.worktrees/.ux01-run/B-r1-floor/<n>.log`. No retries were needed, no flaky specs.

| # | Command | Result | Counts |
|---|---|---|---|
| 1 | `npm run lint:repo` | PASS (exit 0) | eslint clean; lint:skills OK |
| 2 | `npm run typecheck:repo` | PASS (exit 0) | tsc browser-use-discovery + server clean; all `node --check` OK |
| 3 | `npm test` | PASS (exit 0) | 3121 tests · 3120 pass · 0 fail · 0 skipped · 1 todo |
| 4 | `npm run test:contract:all` | PASS (exit 0) | 12 OK schema/skill lines |
| 5 | `npm run test:e2e-smoke` | PASS (exit 0) | 11 passed (15.1s) |
| 6 | `npm run test:e2e-journey` | PASS (exit 0) | 13 passed (21.4s) |
| 7 | `npm run test:e2e-visual` | PASS (exit 0) | 37 passed (1.0m) |

The one todo in `npm test` is "persists and can remove the canonical submission evidence record" (`# blocked on the canonical-ownership gate`); it prints an AssertionError but is counted as todo, not fail.

Tails:

```
[3] ℹ tests 3121 / ℹ pass 3120 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 1
[5]   11 passed (15.1s)
[6]   13 passed (21.4s)
[7]   37 passed (1.0m)
```

Verdict: floor green, 7/7.
