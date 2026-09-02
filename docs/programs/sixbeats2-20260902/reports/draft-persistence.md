# Lane report — draft-persistence (SIXBEATS-2, 2026-09-02)

Branch: `feat/sixbeats2-draft-persistence` · commits `b870c64`, `0ac3a7b` (local only, never pushed).
Claims: **NEW-14** (BLOCKER — Beat 4 resumes empty after a refresh), **NEW-7** (controller/store side of the lost resume text), **NEW-6** (no re-entry after Escape).

## 1. What this lane was

The acceptance rerun on main @ `cf0da4d` refreshed the page mid-flow and lost everything the user had typed or drafted. Spec §3.2 has always said beat-local drafts persist "under the same key on input, debounced" and §3.4 that resuming lands on the saved beat "with drafts restored" — the controller simply had no seam for it: the drafted profile lived on `ctx.runtime` alone, so a refresh returned a stranger to an empty, un-advanceable Beat 4. Separately, on a configured install Escape dropped the user on the dashboard with the flow paused and nothing on screen leading back to it.

This lane landed the shared seam SIXBEATS2 locked decision 4 defines (`ctx.saveDraft` / `ctx.runtime.drafts`), Beat 4's read and write of it, and locked decision 6's re-entry pill. The controller API landed in the first commit so drafting-provider can code against it.

## 2. Which claims went red first (named tests)

`tests/oneflow-sb2-draft-persistence.test.mjs` — 15 probes, **all 15 failing before the change** (`ℹ pass 0 / fail 14` plus one that could not even resolve `flow.saveDraft`):

| Probe | Claim |
|---|---|
| `SB2-DRAFT-SAVE` | NEW-7: `ctx.saveDraft` reaches the flow state |
| `SB2-DRAFT-RUNTIME` | the saving beat reads its own draft back with no round trip |
| `SB2-DRAFT-DEBOUNCE` | §3.2 "debounced" — one write per typing burst, last keystroke wins |
| `SB2-DRAFT-KEYS` | an unknown key (`apiKey`) is refused and never reaches the store |
| `SB2-DRAFT-HYDRATE` | §3.4: `open()` restores drafts from a previous session |
| `SB2-DRAFT-GOTO` | `goToBeat()` re-hydrates — the B3→B4 handoff cannot ride on in-memory scratch |
| `SB2-DRAFT-CLEAR` | `clearOnboardingFlowState` wipes the bag (greenfield leak) |
| `SB2-DRAFT-NORMALIZE` | the store keeps only the two known keys and coerces their types |
| `SB2-FIT-DRAFT-READ` | **NEW-14**: B4 renders from `runtime.drafts.profileDraft` |
| `SB2-FIT-DRAFT-WRITE` | §3.2 "B4 edits" persist on input |
| `SB2-FIT-RELOAD` | **NEW-14 repro**: draft → reload the page → B4 populated → `Looks like me →` completes |
| `SB2-PILL-SHOWN` | **NEW-6**: Escape off the demo board leaves a "Resume setup ▸" pill with an a11y label naming the beat |
| `SB2-PILL-REOPENS` | the pill reopens the saved beat and removes itself |
| `SB2-PILL-NOT-ON-BOARD` | on S0 the invitation card is the re-entry — no second one |
| `SB2-PILL-GONE-WHEN-DONE` | a completed flow leaves no pill behind |

After the change: `ℹ pass 15 / fail 0`.

## 3. What shipped, file-and-fence

- **`user-content-store.js`** (normalize `drafts` only): `DEFAULT_ONBOARDING_FLOW_STATE.drafts = {}`, `ONBOARDING_FLOW_DRAFT_KEYS = ["resumeText", "profileDraft"]` (exported), `normalizeOnboardingFlowDrafts()` — text capped at 100 000 chars, structured drafts stored as a JSON round-trip (data, never a live reference), unknown keys dropped so a beat cannot turn the bag into a credential store. `saveOnboardingFlowState` merges `drafts` the way it already merges `skipped`; `clearOnboardingFlowState` wipes it.
- **`onboarding-flow.js`**: `ctx.saveDraft(key, value)` (also on `window.JobBoredOneFlow`) — debounced 400 ms, resolves `true` when the write lands and `false` for an unknown key; `runtime.drafts` hydrated in `hydrate()` and re-mirrored on `goToBeat()`; pending keystrokes flushed before every beat transition, before completion, and on pause. Plus locked decision 6: `showResumePill()` / `hideResumePill()` on the close hook — only when the demo board is not the live surface, `aria-label="Resume setup — <beat label>"`, removed on reopen and on flow completion.
- **`oneflow-beat-fit.js`**: `getDraft()` now reads `runtime.drafts.profileDraft` (after a refresh it is the only draft there is), and `markChanged()` persists the corrected payload back through `ctx.saveDraft`.
- **`css/oneflow.css`** CORE, one rule: `.oneflow-resume-pill` — the demo pill's silhouette, docked bottom-**left** because the toast stack owns bottom-right and the pause toast fires at the same instant (caught by the browser proof, `0ac3a7b`).

Nothing outside the fence was touched.

## 4. Floor results — pasted output

```
$ npm test
ℹ tests 2799
ℹ suites 679
ℹ pass 2798
ℹ fail 0
ℹ todo 1
ℹ duration_ms 9451.842333
(exit 0 — the single todo is the pre-existing `submission-record-audit` case,
 marked "blocked on the canonical-ownership gate", untouched by this lane)

$ npm run lint:repo
> eslint .
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md

$ npm run typecheck:repo
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
> tsc --noEmit --project server/tsconfig.json
(clean — plus `node --check` over every browser file, onboarding-flow.js and
 oneflow-beat-fit.js included)

$ npm run test:contract:all
OK schema (ATS request/response), ats-scorecard.js request builder
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md

$ npm run test:e2e-smoke
  7 passed (15.3s)

$ npm run test:e2e-journey
  12 passed (24.7s)

$ npm run test:e2e-visual
  24 passed (53.4s)
```

### Real-browser proof (NEW-14 BLOCKER, and NEW-6)

`.lane-evidence/new14-reload.spec.mjs`, real Chromium against the real dev server, run with
`npx playwright test --config .lane-evidence/playwright.config.mjs`:

```
Running 2 tests using 1 worker
  ✓  1 NEW-14: a drafted Beat 4 survives page.reload() and still advances (3.4s)
  ✓  2 NEW-6: pausing off the demo board leaves a Resume setup pill that reopens the beat (1.1s)
  2 passed (5.4s)
```

Console / network lines from that run (`.lane-evidence/new14-console-network.log`):

```
[console:info] [JobBored startup] bootstrap:init:no-sheet-id {configuredSheetIdState: missing, hasOAuthClientId: false}
... page.reload() ...
[console:info] [JobBored startup] window:load {readyState: complete, sheetIdState: present, ...}
[state] onboardingFlowState.drafts keys after reload: profileDraft
[state] completedBeats after advance: fit · beat now discovery
[net] POST /profile -> 200
```

Screenshots (`.lane-evidence/`): `new14-01-before-reload.png`, `new14-02-after-reload.png` (Beat 4 back with "Staff Software Engineer", "Distributed systems", the narrative and the $210k floor), `new14-03-advanced.png`, `new6-01-resume-pill.png`.

No overlay was dismissed programmatically: the invitation, `Looks like me →`, the Escape key and the pill were all real clicks/keypresses on real controls.

## 5. Anything unverified, including what the sandbox refused

1. **The B3 half of NEW-7 is not this lane's.** `resumeText` is a first-class draft key, persisted, hydrated and tested here; the call site (Beat 3 saving on input and restoring on render) belongs to drafting-provider per locked decision 4. Nothing in `oneflow-beat-resume.js` calls `saveDraft` yet on this branch.
2. **One stub in the browser proof:** the hermetic fence 404s `/profile` for every method, so the proof fulfils `POST /profile` with `{ok:true}`. Beat 4's *save* is not what NEW-14 is about — whether the beat still has a draft to save after a refresh is — and the request is shown really firing (`[net] POST /profile -> 200`).
3. **Where a greenfield reload lands is a routing question outside this fence.** `sheet-access-setup.js` hands an install with no OAuth client id to `flow.open("google")` (an explicit beat), not to the resume path. The browser proof therefore calls `JobBoredOneFlow.open()` — the documented resume entry, and the one the rerun exercised on a configured install — after the reload. If the integrator wants a cold, unconfigured install to resume at its saved beat too, that is a change in `sheet-access-setup.js`, which no SIXBEATS2 lane owns.
4. **Not screenshotted at 390 px.** This is not a visual lane; the pill is a fixed 30 px-tall corner control and the visual gate's 24 phone/desktop assertions are green.
5. `LANE-REPORT-*.md` and `.lane-evidence/` are both gitignored, so this report and the proof are on disk, not in the commits.
