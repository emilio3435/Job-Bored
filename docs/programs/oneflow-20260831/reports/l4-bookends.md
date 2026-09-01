# LANE REPORT — L4 (bookends)

Branch: `feat/oneflow-bookends` · Base: `1b5dc55` (L0 substrate merged) · Commits: 7, local only, never pushed.

## 1. What this lane was

The two bookends of the one-flow onboarding (`docs/ONE-FLOW-ONBOARDING-SPEC.md`
§4, §5 B6, §6), plus the honest exits the tail never had:

- **S0 — the demo board.** Value before any ask: a self-contained, watermarked
  demo pipeline seeded from a bundled fixture, with the normative invitation
  card over it and a session-persistent corner-pill escape.
- **The celebration extraction.** The well-tested player moves out of
  `onboarding-wizard.js` (which L7 deletes) into its own module, so the flow's
  single celebration has a home that survives the sweep.
- **B6 — the payoff.** The one celebration, the "Your search" and "What happens
  now" cards read from real state, and `Run discovery now` streaming the first
  cards onto the live board.
- **Go-live honest exits (Phase 0).** The single-device answer, the cloud
  finish unblock, the Tailscale button hierarchy, and the conditional
  done-step callout.

Everything lands **dark** (SUBSTRATE locked decision 1): the new modules exist,
register, and are unit-tested, but boot still runs the legacy chain. L6 flips it.

## 2. Which claims went red first (named tests)

TDD order, four red-then-green cycles. Red counts are from the first run of
each new suite against the unfilled L0 stubs.

**`tests/oneflow-l4-demo-board.test.mjs` — 16 of 23 red.** The fixture-schema
claims passed immediately (the fixture was written first); every behavioral
claim failed on `env.board.mount is not a function`. The load-bearing reds:

- `mounts a self-contained overlay seeded from the fixture`
- `watermarks every card DEMO — the board must never read as real data`
- `opens a READ-ONLY detail on card click — nothing on this board writes`
- `unmounts itself when the first real Sheet rows render (spec §4 Exit)`
- `degrades to the invitation alone when the fixture can't be fetched`
- `ships the headline, the deal, and the privacy sentence verbatim`
- `the collapse persists across the session — a remount shows the pill`
- `the demo board never reaches into the real renderer`

**`tests/oneflow-l4-celebration.test.mjs` — 21 of 22 red.** Only "calls onDone
immediately when the overlay is absent" passed against the empty L0 stub (it
does nothing, which is indistinguishable from graceful degradation — the reason
the other 21 exist). The load-bearing reds:

- `publishes the player on its own global`
- `persists: no auto-dismiss timer, and the CTA takes focus (a11y)`
- `inerts every body sibling while up, and restores them on dismiss`
- `adds exactly ONE new stage — the flow finale B6 fires`
- `the flow finale takes its headline and sub from the caller (per-user copy)`
- `forwards onDone, the stage key, and opts to the extracted player`
- `still completes the handoff when the player module never loaded`
- `no longer carries the player's implementation`

**`tests/oneflow-l4-payoff.test.mjs` — 25 of 27 red.** Only the two
registration claims passed (the L0 stub already registered id + order). The
load-bearing reds:

- `falls back gracefully to 'You're live.' when the name is unknown`
- `reads roles, where, floor, and the top THREE strengths from the saved profile`
- `omits the floor line rather than inventing one when none was set`
- `survives an unreachable profile server without losing the payoff`
- `names the provider the user actually configured`
- `counts armed sources from the discovery snapshot and credits Google's index`
- `replaces the armed line with the honest keys-saved line`
- `refuses to fire — loudly — when B4 somehow left no intent behind`
- `emits first_results {count, ms} the first time the poll reports rows`
- `fires at most once per flow, even if the beat re-renders`

**`tests/oneflow-l4-go-live-exits.test.mjs` — 14 of 17 red** (the three green
were the `wizard_cloud_verify` guard and two store-source claims that a later
edit satisfied). The load-bearing reds:

- `path_select offers it as a first-class third answer, not fine print`
- `choosing it writes goLiveSetupSkipped and closes the wizard`
- `still exits cleanly when the store cannot record the answer`
- `leaves 'I added it to Google OAuth — finish' enabled after a failed probe`
- `still SAYS the probe failed — enabled is not the same as silent`
- `finish is primary and verify is secondary — the step is finishing, not verifying`
- `says nothing about discovery once it is already on`
- `hides the go-live CTA once the user says they only use this computer`

Two later red-then-green cycles inside the same lane:

- The **footer-primary coupling** probe (`connected: Run discovery now is the
  footer primary` / `skipped connect: Go to my dashboard is the footer primary`)
  was added *after* the view model was green, to pin end-to-end through
  `renderWizardShell` an ordering dependency the unit probes could not see.
- The **intent-parity** probe (`guards on the run's own payload, not a second
  guess at it`) went red against a first implementation that resolved intent
  from the stored discovery profile alone — which would have blocked a run the
  worker accepts whenever B4's roles live only in the fit profile.

## 3. What shipped, file-and-fence

Everything below is inside the L4 fence from SUBSTRATE's ownership map.

| File | Change |
|---|---|
| `fixtures/demo-pipeline.json` | **new.** 8 curated rows across 6 live stages, each with a 0–100 fit score and a one-line reason. Deterministic, no personal data, canonical stage-registry keys only, no archived stages (they render collapsed). |
| `oneflow-demo-board.js` | **filled.** Self-contained overlay board (no `pipeline-render.js` involvement — SUBSTRATE locked decision), `DEMO` chip per card, reduced opacity once at the root, read-only detail with no actionable control, `mount()`/`unmount()`/`isActive()`. Invitation card ships §4's copy verbatim; "Poke around first" collapses to the corner pill (`sessionStorage`, session-scoped); the pill reopens the flow. Exits on the first real Sheet row via `jb:pipeline:rendered` + a call-only `pipelineController.getPipelineData()`. |
| `onboarding-celebration.js` | **filled.** The player, its overlay driver, its confetti, and the four legacy stage configs, moved unchanged from `onboarding-wizard.js:137-344`. Two additions, both for B6: the `flow_payoff` stage, and per-call `title`/`sub`/`cta` overrides. |
| `onboarding-wizard.js` | **celebration cut only.** Player replaced by a thin delegating alias resolved lazily at call time. Its four legacy call sites are untouched (L7 owns them). |
| `oneflow-beat-payoff.js` | **filled.** B6 view model + renderer + actions + the one celebration + `first_results`. See §5 for the two data sources that need a sibling lane. |
| `go-live-wizard-ui.js` | `path_select` gains `go_live_only_this_computer`; `buildTailscaleActions` ready branch swaps primary/secondary; `buildCloudActions` drops the probe gate on finish; the failed-probe result card says why the check is inconclusive and names the next action; `buildDoneBody`'s discovery callout is gated on `_discoveryCtaVisible`; a handler for the new action. |
| `user-content-store.js` | **granted single addition:** `isGoLiveSetupSkipped` / `setGoLiveSetupSkipped` + their two export lines. Nothing else. |
| `whats-next-banner.js` | Reads `goLiveSetupSkipped` through the same guarded pattern as the discovery skip, and treats it as *settling* the go-live row (spec §6). Deliberately asymmetric — see below. |
| `css/oneflow.css` | Rules only inside `/* ONEFLOW:L4 */`. Nothing outside the fence was touched. |
| `tests/oneflow-l4-harness.mjs` | **new.** Shared fakes, built on `tests/oneflow-l0-harness.mjs` so the two suites can't disagree about the DOM. |
| `tests/oneflow-l4-*.test.mjs` | **new**, 98 tests: demo board 23, celebration 22, payoff 32, go-live exits 21. |
| `tests/onboarding-celebration.test.mjs`, `tests/whats-next-signpost.test.mjs` | **import surface only** — same claims, now loading/reading the player from its new home. `whats-next-signpost.test.mjs` also drops the now-orphaned `onboardingWizardJs` read. |

Three decisions worth naming, because each one chose against the obvious symmetry:

1. **The go-live skip is not the discovery skip.** The kickoff says "treat
   `goLiveSetupSkipped` like the discovery skip (:190-203 pattern)". I matched
   the *reading* pattern exactly (guarded, try/caught, defaults false) but NOT
   the resolution: `discoverySetupSkipped` is explicitly observable-but-not-
   completion, because discovery is mandatory and the row must keep nudging.
   Other-devices is optional, and spec §6 says the single-device answer
   "permanently quiets the banner". So `goLiveSetupSkipped` settles its row and
   `discoverySetupSkipped` still doesn't. A probe pins both halves, including
   the negative (`does NOT let the discovery skip resolve its own row`).

2. **The cloud finish is unblocked, not the probe fixed.** `probeUrlReachable`
   uses `mode:"no-cors"`, whose response is opaque — it carries no status, so a
   rejection proves nothing about whether the deploy is up. Gating Finish on it
   stranded users whose site was live. The probe stays (it is still useful when
   it succeeds); the gate goes; the failure copy now says the check is
   inconclusive rather than implying the URL is down.

3. **B6's footer actions are resolved during body render.** The shell captures a
   step's action array by reference and builds the footer *after* the step body,
   so the beat mutates one module-level array in `render()` and the footer picks
   up the right variant. This is a real ordering coupling on `discovery-wizard-
   shell.js` internals, and it is load-bearing (get it wrong and the payoff
   silently ships the wrong primary). It is therefore pinned end-to-end through
   `renderWizardShell` for BOTH variants, not on the view model — if the shell's
   render order ever changes, those two tests go red loudly. The alternative
   (rendering B6's actions inside the body, go-live's path-card idiom) would
   have left the shell's default "Finish setup" button stranded in the footer
   alongside them.

## 4. Floor results — PASTED output

Baseline (pre-lane, at `1b5dc55`) for comparison: `tests 2453 / pass 2452 /
fail 0 / todo 1`, and all four gates exit 0.

```
$ npm test                      # scripts/run-tests.mjs
ℹ tests 2551
ℹ suites 611
ℹ pass 2550
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 8448.634459
TEST_EXIT=0
```

The single `todo` is pre-existing and unrelated to this lane
(`tests/submission-record-audit.test.mjs` — "persists and can remove the
canonical submission evidence record", marked todo with the reason "blocked on
the canonical-ownership gate; no legal Sheet column or IndexedDB store"). It is
`todo: 1` in the baseline run too, and `fail` is 0 in both.

```
$ npm run lint:repo
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
LINT_EXIT=0
```

```
$ npm run typecheck:repo
...
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

TC_EXIT=0
```

```
$ npm run test:contract:all
...
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
CT_EXIT=0
```

Net: +98 tests, all passing; no gate regressed. Raw logs are in
`.lane-evidence/` (`final-npm-test.txt`, `final-lint.txt`,
`final-typecheck.txt`, `final-contract.txt`, plus the four `baseline-*.txt`).

## 5. Anything unverified, including what the sandbox refused

**Cross-fence needs — for the orchestrator to route. Neither blocks this lane;
both degrade gracefully today.**

1. **`{firstName}` has no source yet.** Spec §5 B6 wants the first name from the
   Google session profile, but `auth-session.js` only captures `email` and
   `picture` from `/oauth2/v3/userinfo` — `given_name` is in that response and
   is simply not read. `auth-session.js` is **L5's** fence, so I did not touch
   it. B6 resolves the name from `ctx.runtime.firstName` first (the natural
   place for B1 to leave it) and then from an optional
   `window.JobBoredApp.auth.getUserGivenName()`, which does not exist yet.
   **Today the headline therefore always renders the spec's fallback,
   "You're live."** — correct, tested, and not what §5 B6 wants long-term. The
   fix is ~3 lines in `auth-session.js` (`userGivenName = data.given_name`, an
   accessor, and the two persist sites), or one line in L1's B1 writing
   `ctx.runtime.firstName`. Both paths are already wired on my side.

2. **`ctx.runtime.fitProfile` is read but nobody writes it.** B6 prefers the
   profile the flow already carries over a second `/profile` fetch. **L2 (B4)**
   owns the write. Until then B6 falls back to `FitProfileForm.fetchProfile()`,
   which is the real saved profile — correct, just one extra round trip. Tested
   both ways, including the server-unreachable path.

**Not verified in this lane:**

3. **No browser run.** Every claim is asserted through `vm` sandboxes against a
   fake DOM. The demo board's `position: fixed` overlay stacking against the
   real dashboard, the celebration overlay's z-index over the new S0 root, and
   the pill's corner placement at narrow widths are **unverified visually**.
   They are also unreachable until L6 wires `mount()` into boot, so the natural
   place to check them is L6's cutover.

4. **`Run discovery now` end to end.** The probes assert that the intent
   pre-check runs on the same payload `triggerDiscoveryRun` builds, that the run
   fires with `trigger: "onboarding_payoff"`, and that `first_results` fires off
   the run tracker's own event. **A real run against a live worker was not
   performed** — nothing in the DoD needs network, and the sandbox has none.
   Spec §10 Phase 3's acceptance ("streams ≥ 1 SerpApi-sourced card in the same
   session on a connected setup") is therefore still open and belongs to
   whoever dogfoods after L6.

5. **`go-live-wizard-ui.js` is absent from `typecheck:repo`.** Pre-existing gap,
   not caused by this lane — the script lists ~90 browser files and this one was
   never added. `package.json` is **L0's** fence so I left it alone. Low risk
   (eslint covers the file and `node --check` runs on it via the pre-commit
   hook), but it is exactly the silent-pass trap GROUND-RULES #2 names. One line
   to fix: `&& node --check go-live-wizard-ui.js`.

6. **The `grep playOnboardingCelebration = 1 call site` acceptance is not met
   yet, on purpose.** Spec §10 Phase 1 wants a single call site; there are still
   four (first-run ×2, discovery, go-live) plus B6's. Those four belong to
   **L7's** deletions, and removing them now would break the legacy chain that
   is still the live boot path. The extraction is what makes that deletion
   cheap; a probe pins that the four legacy stage configs are still intact so
   L7 removes them deliberately rather than by accident.

7. **`.gitignore` does not cover the worktree's `node_modules` symlinks.** This
   worktree links `node_modules` and `server/node_modules` at the main
   checkout, and `.gitignore` lists only the directory forms
   (`node_modules/`, `server/node_modules/`), which do not match a symlink of
   the same name. Both therefore show as untracked, and a `git add -A` in this
   lane's first commit staged them; the last commit on this branch
   removes the index entries, and the symlinks themselves are untouched. The
   `.gitignore` line is repo-wide and pre-existing, so I did not patch it from
   inside this fence — **every other lane in a worktree has the same trap**, and
   the one-line fix is to drop the trailing slashes (or add
   `node_modules` / `server/node_modules` entries alongside them).

**Nothing the sandbox refused.** All four floor gates ran to completion locally;
`git commit` worked on every commit (no worktree-metadata refusal); no network
was needed.
