# LANE REPORT — finale (NEW-1 BLOCKER, NEW-10, NEW-4)

Branch `feat/sixbeats2-finale`, worktree `Job-Bored.worktrees/sixbeats2-finale`.
Base `1651a1d`. Three local commits, nothing pushed.

- `d893a38` feat(sixbeats2-finale): make the B6 finale a burst, not a modal
- `3d76755` fix(sixbeats2-finale): one sub-line at B6, a readable success line at B2
- `0f136fd` style(sixbeats2-finale): keep the burst card opaque and compact

## 1. What this lane was

Three findings from the observe-only acceptance rerun on main @ cf0da4d
(`docs/programs/sixbeats2-20260902/evidence/rerun-09-02/REPORT.md`):

| # | Finding | Root cause | Fix |
|---|---|---|---|
| NEW-1 (BLOCKER) | The legacy celebration modal sits on top of Beat 6 and its actions cannot be clicked | `onboarding-celebration.js` played `flow_payoff` into a `role="dialog" aria-modal="true"` overlay with `pointer-events: auto`, gated on a CTA, and inerted every body sibling so ITS cta would win hit-testing | The finale is a burst: no scrim, `pointer-events: none`, no journey strip / alt link / CTA, no inerting, no focus steal, self-dismissing after 2.5 s |
| NEW-10 | Beat 6's sub-line rendered twice | `registerBeat({ sub })` gives the shell the step lede AND `renderPayoff` painted the same string as the first body line | The body paragraph (and its now-orphaned `.oneflow-payoff__sub` rule) go; the shell lede is the one copy |
| NEW-4 | B2's success line was on screen ~106 ms before auto-advance | `oneflow-beat-ai.js` completed the beat as soon as the post-check work resolved | A 1.4 s hold measured from the moment the "✓ Connected" line is painted, so the write-through and the config pin spend it rather than add to it |

Locked decision 2 is what the burst implements verbatim: "Confetti +
title/sub float over the visible Beat 6 for ~2.5 s with `pointer-events:
none`, then fade; no journey strip, no alt link, no CTA gate. Beat 6's
actions are clickable from first paint. Keep the reduced-motion/a11y
mechanics."

## 2. Which claims went red first (named tests)

Every probe below was written before the fix and run against the pre-fix
build in a throwaway worktree checked out at `1651a1d` (the lane's base,
i.e. the cf0da4d lineage the rerun measured), with only the new test files
copied in. **10 of 11 unit probes and 5 of 5 browser probes failed there.**

New: `tests/sixbeats2-finale.test.mjs`, `tests/e2e-visual/finale-burst.spec.mjs`.

```
### RED-FIRST — new probes run against 1651a1d (the pre-fix build)

--- node --test tests/sixbeats2-finale.test.mjs ---
  ✖ drops role=dialog and aria-modal so Beat 6 stays the screen (9.155541ms)
  ✖ removes the legacy journey strip, the CTA and the alt link (4199.820292ms)
  ✖ carries the burst class whose rule turns off pointer events (33.028584ms)
  ✖ never inerts the page and never steals focus from Beat 6 (1.246583ms)
  ✖ fades itself within 3 s and clears its confetti (2.885917ms)
  ✖ keeps the finale copy the caller hands it, and nothing else (3.146459ms)
  ✖ still honours prefers-reduced-motion (0.259583ms)
✖ NEW-1 — the finale is a burst, not a modal (SIXBEATS2 decision 2) (4250.546666ms)
  ✖ the shell lede is the only copy of the sub (154.398583ms)
  ✔ the rest of the receipt is untouched (3.518583ms)
✖ NEW-10 — Beat 6's sub-line renders exactly once (spec §5 B6) (158.140042ms)
  ✖ ships a hold of at least 1.2 s (6.666959ms)
  ✖ stays on B2 while the success line is up, then advances (10.084ms)
✖ NEW-4 — B2 holds its success line before advancing (spec §5 B2) (16.995292ms)
ℹ tests 11
ℹ pass 1
ℹ fail 10

--- npx playwright test tests/e2e-visual/finale-burst.spec.mjs ---
  ✘  1 › the B6 finale at 1440×900 › should fire on Beat 6 and clear itself, carrying no second payoff (1440×900)
  ✘  2 › the B6 finale at 1440×900 › should let Run discovery now be clicked while the burst is up (1440×900)
  ✘  3 › the B6 finale at 390×844 › should fire on Beat 6 and clear itself, carrying no second payoff (390×844)
  ✘  4 › the B6 finale at 390×844 › should let Run discovery now be clicked while the burst is up (390×844)
  ✘  5 › the B6 finale under prefers-reduced-motion › should still show, still clear itself, and still not block the beat
    Error: not a dialog — decoration over a live beat
    Expected: "status"
    Received: "dialog"
    Error: the payoff's primary is the topmost element (got onboarding-celebration onboarding-celebration--in)
    Expected: true
    Received: false
    Error: expect(received).toBe(expected) // Object.is equality   [pointer-events]
    Expected: "none"
    Received: "auto"
  5 failed
```

`got onboarding-celebration onboarding-celebration--in` is NEW-1 itself,
reproduced by the probe: `document.elementFromPoint` at the centre of
`Run discovery now` returns the overlay, not the button.

Legacy probes that pinned the modal were updated in the same commits, each
naming the finding (ground rules trap 7):

- `tests/oneflow-l4-celebration.test.mjs` — the persistent-CTA handoff, the
  CTA focus, the inert click-through fix, the timed-fallback-without-a-CTA
  path and the `onAlt` hand-off were mechanics that existed to make the
  modal usable. Replaced with the burst's contract (self-dismissal, handoff
  at fade start, page left interactive, confetti cleaned up); the journey
  `currentIndex` probe went with the strip.
- `tests/oneflow-l4-payoff.test.mjs` — "survives an unreachable profile
  server" asserted the receipt by looking for the sub-line, which moved off
  the body; it now asserts card 2 and the ETA promise.
- `tests/oneflow-l4-harness.mjs` — `makeCelebrationDom()` now ships
  index.html's legacy journey strip and the CTA/alt classes, so "the burst
  removes them" is a claim about a DOM that actually had them; the dead
  `withCta` option went with the CTA fallback.
- `tests/integration/onboarding-chain-convergence.test.mjs` — six walks
  drive `ai_check` and settle on macrotasks (the shell's `onAction` is
  fire-and-forget and returns no promise), so they zero
  `_internal.timings.successHoldMs` rather than wait out the real 1.4 s six
  times. The hold itself is owned by `tests/sixbeats2-finale.test.mjs`.

## 3. What shipped, file-and-fence

In fence:

- `onboarding-celebration.js` — rewritten around `normalizeBurstOverlay()`:
  strips the journey strip / CTA / alt link from whatever markup the page
  shipped, drops `role="dialog"` + `aria-modal` for `role="status"` +
  `aria-live="polite"`, adds `.onboarding-celebration--burst`. Shows first
  and writes the copy second so the live region actually announces. Spawns
  confetti, then self-dismisses on `TIMINGS.burstMs` (2500) with the handoff
  at fade start and cleanup at `TIMINGS.fadeMs` (320). No inerting, no
  focus. `STAGES.flow_payoff` is `{title, sub}` — the `cta` and the journey
  `currentIndex` are gone.
- `oneflow-beat-payoff.js` — `renderPayoff` no longer paints the sub-line
  (NEW-10). Nothing else in the receipt moved.
- `oneflow-beat-ai.js` — `CHECK_TIMINGS.successHoldMs = 1400` plus a
  `wait()` helper; the beat holds before `completeBeat`, discounts the work
  it already did, and re-checks `run !== state.checkRun` so a newer attempt
  started during the hold still owns the screen. Advance delay only — no
  provider defaults or labels touched (that hunk belongs to
  drafting-provider).
- `css/oneflow.css` (CORE) — deleted the `.oneflow-payoff__sub` rule my
  change orphaned. One rule, nothing else.

Outside the listed fence, both flagged in §5:

- `css/onboarding-celebration.css` — the burst variant's rules and the
  reduced-motion coverage. This is the 1:1 paired stylesheet of a fenced
  module and no other lane's fence names it.
- `tests/e2e-visual/finale-burst.spec.mjs` (new), plus the four test files
  listed in §2.

## 4. Floor results — PASTED output

Every gate below was re-run at the final commit `0f136fd`; raw output in
`.lane-evidence/floor-final.txt` (per-gate logs also in `floor-npm-test.txt`,
`floor-static.txt`, `floor-e2e-visual.txt`, `floor-e2e-other.txt`).

`npm test`:

```
ℹ tests 2792
ℹ suites 679
ℹ pass 2791
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
```

The one `todo` is `tests/submission-record-audit.test.mjs` — the APPLY-01
executable TODO that is red on purpose ("blocked on the canonical-ownership
gate"), pre-existing and untouched by this lane.

`npm run lint:repo` / `npm run typecheck:repo` / `npm run test:contract:all`:

```
=== npm run lint:repo ===
> eslint .
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md

=== npm run typecheck:repo ===
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
> tsc --noEmit --project server/tsconfig.json
(all `node --check` targets clean, including oneflow-beat-ai.js,
 oneflow-beat-payoff.js and onboarding-celebration.js)

=== npm run test:contract:all ===
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
```

`npm run test:e2e-visual` — 29 passed, including the five new finale probes:

```
  ✓   1 tests/e2e-visual/finale-burst.spec.mjs:95:5 › the B6 finale at 1440×900 › should fire on Beat 6 and clear itself, carrying no second payoff (1440×900)
  ✓   2 tests/e2e-visual/finale-burst.spec.mjs:151:5 › the B6 finale at 1440×900 › should let Run discovery now be clicked while the burst is up (1440×900) (3.2s)
  ✓   3 tests/e2e-visual/finale-burst.spec.mjs:95:5 › the B6 finale at 390×844 › should fire on Beat 6 and clear itself, carrying no second payoff (390×844) (5.0s)
  ✓   4 tests/e2e-visual/finale-burst.spec.mjs:151:5 › the B6 finale at 390×844 › should let Run discovery now be clicked while the burst is up (390×844) (1.5s)
  ✓   5 tests/e2e-visual/finale-burst.spec.mjs:224:3 › the B6 finale under prefers-reduced-motion › should still show, still clear itself, and still not block the beat (4.5s)
  ...
  29 passed (1.3m)
```

`npm run test:e2e-smoke` — 7 passed. `npm run test:e2e-journey` — 12 passed:

```
  ✓  5 tests/e2e-smoke/boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (732ms)
  7 passed (13.8s)

  ✓   7 tests/e2e-journey/critical-journey.spec.mjs:359:1 › should carry completed discovery into the pipeline and ready dossier materials (8.4s)
  12 passed (49.0s)
```

### The real-browser proof (NEW-1 is a BLOCKER, so it gets its own)

Driver `.lane-evidence/finale-evidence.mjs`, log
`.lane-evidence/finale-evidence.json`. Nothing is dismissed
programmatically: the run reaches Beat 6 through the product's own path
(cold start → "Make it mine — 15 min, once" → `goToBeat("payoff")`), waits
for the finale to be up, and repeats the rerun's own measurement.

The overlay, while it is up:

```json
{
  "role": "status",
  "ariaModal": null,
  "ariaLive": "polite",
  "ariaHidden": "false",
  "className": "onboarding-celebration onboarding-celebration--burst onboarding-celebration--in",
  "pointerEvents": "none",
  "zIndex": "100002",
  "background": "rgba(0, 0, 0, 0)",
  "box": "1440×900 at (0,0)",
  "journey": false,
  "cta": false,
  "alt": false,
  "title": "You're live."
}
```

(identical at 390×844.) The rerun recorded the same overlay as
`role="dialog"`, `aria-modal="true"`, `pointer-events: auto`, with the
journey strip, the CTA and the alt link present.

`document.elementFromPoint` at the centre of `Run discovery now`, sampled
every 250 ms — the rerun's exact method, which found the primary covered
for the whole 29 870 ms sample:

```
      2 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
    255 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
    511 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
    764 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
   1020 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
   1272 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
   1530 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
   1783 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
   2036 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
   2289 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
   2542 ms  burstUp=True   covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
   2794 ms  burstUp=False  covered=False  topmost=discovery-setup-wizard__btn discovery-setup-wizard__btn--primary
```

`1440×900: 0/16 covered; burst up for 11 samples` and
`390×844: 0/16 covered; burst up for 11 samples` — the payoff's primary is
the topmost element from the first paint, and the burst is gone by ~2.8 s.
`tests/e2e-visual/finale-burst.spec.mjs` then clicks it for real
(`primary.click()`, no `force`, so Playwright's own hit-test would fail on
an intercepting overlay) and waits for the beat to answer.

Console, both viewports (nothing from the celebration; every line is the
app's own startup logging):

```
log: [dawn-data:p1] self-test pass
warning: [dawn-data:p2] role-shape fail {fullOk: true, tpOk: false, ...}
info: [JobBored startup] domcontentloaded {readyState: interactive, sheetIdState: missing, ...}
info: [JobBored startup] bootstrap:init:no-sheet-id {configuredSheetIdState: missing, hasOAuthClientId: false}
info: [JobBored startup] bootstrap:init:early-return {reason: missing-sheet-id}
info: [JobBored startup] window:load {readyState: complete, sheetIdState: missing, ...}
error: Failed to load resource: the server responded with a status of 404 (Not Found)
```

Network, both viewports — one non-2xx, and it is the expected one:

```
HTTP 404 http://127.0.0.1:<port>/profile
```

A hermetic cold start has no saved fit profile, so B6's `readSearch()` gets
a 404 and renders "Your saved profile isn't reachable right now…" rather
than inventing a receipt. Nothing else failed; no external request escaped
the fence (`fence.unexpectedExternal` is `[]` in all five browser probes).

Screenshots in `.lane-evidence/`:

| before (1651a1d) | after (this branch) |
|---|---|
| `before-b6-modal-1440x900.png` | `after-b6-burst-1440x900.png`, `after-b6-faded-1440x900.png` |
| `before-b6-modal-390x844.png` | `after-b6-burst-390x844.png`, `after-b6-faded-390x844.png` |

## 5. Anything unverified, including what the sandbox refused

1. **index.html still carries the legacy celebration markup.** The kickoff
   fence names `onboarding-celebration.js`, `oneflow-beat-payoff.js`,
   `oneflow-beat-ai.js` and `css/oneflow.css` — not `index.html`, and the
   ground rules say "delete nothing outside your fence". So the journey
   `<ol>`, the `#onboardingCelebrationContinue` CTA, the
   `#onboardingCelebrationAlt` link and `role="dialog" aria-modal="true"`
   are all still in `index.html:1314-1384`, and the player removes them at
   play time instead. That is correct at runtime and proven in the browser
   above, but it is dead markup with stale copy ("Profile set!", "Set up job
   discovery →", "or start with your other devices →") sitting in the
   shipped HTML. **Routing request for the orchestrator:** delete lines
   1343-1382 of `index.html` and swap the overlay's `role`/`aria-modal`
   attributes for `role="status" aria-live="polite"`, after which
   `normalizeBurstOverlay()` becomes belt-and-braces for cached markup
   rather than the mechanism.
2. **`css/onboarding-celebration.css` is outside the listed fence.** I
   edited it anyway: it is the 1:1 paired stylesheet of `onboarding-
   celebration.js`, no other lane's fence names it, and the burst cannot
   exist without it (the fence lists `css/oneflow.css` CORE, which holds the
   payoff beat's styles, not the overlay's). Flagging rather than assuming.
3. **`.onboarding-celebration__journey*`, `__cta` and `__alt` CSS is now
   dead** (~90 lines in `css/onboarding-celebration.css`) once item 1 lands.
   Left in place deliberately: it still styles the markup index.html ships,
   and deleting it before the markup goes would make a stale cached page
   render an unstyled strip mid-fade. Cleanup belongs with item 1.
4. **Shared-file coordination.** `oneflow-beat-ai.js` is shared with
   drafting-provider per the spec's fence note. This lane touched only the
   advance path — the `CHECK_TIMINGS` object, one `const successAt`, and the
   `wait()` before `completeBeat`. The provider table, `defaultModel` and
   the card labels are untouched, so the two hunks should not collide.
   `tests/oneflow-l1-beat-ai.test.mjs` was NOT modified (it passes as-is,
   ~11 s slower across its successful-check cases).
5. **`prefers-reduced-motion` is emulated per-page, not per-context.**
   `test.use({ reducedMotion: "reduce" })` inside a `test.describe` did not
   reach the page in this Playwright version —
   `matchMedia("(prefers-reduced-motion: reduce)").matches` came back
   `false`, which would have made the probe pass for the wrong reason. The
   spec calls `page.emulateMedia()` instead and asserts the emulation is
   actually in force before measuring. Worth knowing for other lanes.
6. **Not verified by this lane:** the rerun's other eleven findings, and any
   behaviour behind a live Google grant or a real provider key — the
   hermetic fence refuses both by design, so `Run discovery now` is proven
   *clickable and answered*, not proven to return jobs.
7. **The burst overlaps the shell's header while it is up.** At 390×844 it
   covers the "Set up JobBored" strip and the spine for its 2.5 s; at
   1440×900 it clips the top ~70 px of the shell card. Deliberate — decision
   2 puts it over the beat — and the card was made opaque and narrower
   (`0f136fd`) so nothing ghosts through, but it is a look worth a glance
   before merge: `.lane-evidence/after-b6-burst-390x844.png`.
8. Nothing was refused by the sandbox; no network access was needed. Three
   local commits, nothing pushed.
