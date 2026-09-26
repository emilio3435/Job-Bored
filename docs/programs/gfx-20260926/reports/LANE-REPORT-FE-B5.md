DONE

# LANE REPORT: FE-B5 (B5 key check + discovery wizard + B6 payoff)

Branch `feat/gfx-fe-b5`, six local commits on top of `24eff564`, not pushed:

```
605f8383 test(wizard): update the shell's default-blueprint golden for R9/D7
1db053c4 style(b5): rail the key and connection, one painted fix, readable links
4bee9d7b fix(b6): promise first matches only when a run can happen
e7bd4513 fix(b6): wait for the first run to start; soften the not-yet rows
5969b6f3 feat(wizard): plain names, one recommendation, no stub_only flow
902a9728 feat(b5): one diagnosis and one fix per frozen fuel outcome
```

## 1. Mission

The kickoff asked for three things:
- Every Beat 5 state shows one honest diagnosis and exactly one fix (D1).
- The discovery wizard uses plain words, names each path once, and recommends exactly one path.
- Beat 6 celebrates only what really happened.

## 2. Claims that went red first (named with ledger IDs)

Each new test file was run against the unchanged code first and failed, then went green:
- `tests/gfx-fe-b5-outcomes.test.mjs`: 17 of 19 red. The two that already passed were the exact stale_server copy and the ok note.
  - GFX-R2: the table covers every OUTCOMES entry, one fix each, no shared or generic copy.
  - GFX-S3/S7/S9 × 8 blocked outcomes.
  - GFX-S7: invalid_key links to the key page.
  - GFX-S9: unreachable says "SerpApi didn't answer — check your internet…" and never "start/server".
  - GFX-S9: upstream_error says "in a minute".
  - GFX-S3: wrong_origin links to http://localhost:8080/.
  - GFX-S10: internal_error and no_local_server use localServerHint (Mac and Linux).
  - GFX-S1: static_host → route button.
  - GFX-D1: the skip refusal names the fix.
- `tests/gfx-fe-b5-wizard.test.mjs`: 15 of 18 red.
  - GFX-D1: Check again (never Re-scan or Re-check), in the wizard and in B5.
  - GFX-D4: Connect Sheet → B1.
  - GFX-D5: no ngrok, relay or redeploy words; Fix setup is the action.
  - GFX-D6: card names and shell summary names.
  - GFX-D7: Skip for now plus its consequence.
  - GFX-D6/D8: "a web address you already own".
  - GFX-S10: needs_server uses localServerHint.
  - GFX-R9: the shell enums and blueprints drop stub_only while the engine state stays; the probe never recommends stub_only.
  - GFX-D4: the Tailscale probe reaches readiness on open and on Set it up for me.
  - GFX-D4: exactly one card is Recommended and its reason agrees (×2).
- `tests/gfx-fe-b5-payoff.test.mjs`: 8 of 8 red, plus 2 of 3 in a later addition.
  - GFX-N8: completion waits for triggerRun.
  - GFX-N8: five failure reasons stay on B6 with "The first run didn't start — {reason}. Try again."
  - GFX-N8: a throwing run counts as a failure.
  - GFX-P1: soft ○ rows.
  - GFX-N8: the ETA line is shown only when armed and connected.

## 3. What shipped, file and fence

- `oneflow-beat-discovery.js` (render and copy only; the state machine is untouched):
  - A `FUEL_OUTCOMES` table with one row per `OUTCOMES` display key, each with exactly one fix. The fix is one of: link, route, retry, restart, or note (for ok).
  - One in-panel fix control (`[data-fuel-fix]`) for the link and route kinds.
  - No generic fallback: an unknown reason renders as stale_server.
  - Restart copy comes from `localServerHint()`.
  - Connect-panel paths are named once (D6), with "Check again".
  - Rail state classes on the fuel panel.
- `discovery-wizard-ui.js`:
  - Check again everywhere.
  - Connect Sheet action and handler (closes the wizard, then `JobBoredOneFlow.open("google")`).
  - D5 plain rows and descriptions.
  - `DISCOVERY_PATH_NAMES`, and Skip for now with its consequence.
  - D8 copy.
  - `needsServerMessage()` built from localServerHint.
  - Removed the stub_only flow card, step, body builder, actionable-step branch and `wizard_complete_stub_only` handler. A verified stub URL still records the `stub_only` engine state and result, and now lands on `ready`.
  - `probeTailscaleInstalled()` passes `tailscaleInstalled` to `refreshDiscoveryReadinessSnapshot` on open, and to `getDiscoveryReadinessSnapshot` after the Set it up for me probe.
  - A `recommended` flag on the card model.
- `discovery-wizard-shell.js`:
  - `stub_only` removed from `DEFAULT_STEP_IDS`, the blueprints, and the `flow`/`recommendedFlow` enums. The engineState, appsScriptState and result enums keep it.
  - D6 path summary names; D7/D8 blueprint copy.
  - A `--recommended` card class.
- `discovery-wizard-probes.js`: the flow recommendation only. It now defers to `readiness.recommendDiscoveryFlow`, falling back to local_agent. Engine state is untouched.
- `oneflow-beat-payoff.js`:
  - `runNow` awaits `triggerRun()`. On failure it calls clearBusy and shows the message inline, with no completion and no drawer.
  - `armFirstResults` now runs after the run is accepted.
  - Softer ○ rows.
  - The ETA line shows only when armed and not skipped.
- `css/oneflow.css`, B5 block (now around `:1713`):
  - Rail and state nodes in B1's ladder vocabulary.
  - The navy fix pill.
  - Scoped link colours that beat `body.jb-v2 a`.
  - The disabled Connect and Skip buttons are hidden while the connect panel is dimmed.
  - Link-primary contrast for B5 and B6.
  - Green-ink ✓ status.
- `css/oneflow.css`, B6 block (around `:2546`): green-ink ✓ rows (mint-deep was about 4:1) and a scoped sheet link.
- `css/discovery-setup-wizard.css`: warm-paper path cards, and one navy Recommended card with a sentence-case tag.
- Tests updated because the strings or behaviour they pin moved. Each commit body names them:
  - oneflow-b5-connect-healing, oneflow-b5-static-handoff, oneflow-l3-beat-discovery, oneflow-l3-wizard-repairs, discovery-cross-rec, sixbeats2-fuel-beat, oneflow-l4-payoff, sixbeats-v2-shell-visual (golden: stub segment removed, "Step 1 of 10", Manual → Skip), integration/onboarding-chain-convergence.
  - `oneflow-l3-harness.mjs` now loads `local-server.js` before the wizard, as index.html does.
- Screenshots in `.lane-evidence/`, taken from a port-0 hermetic dev-server with every host path stubbed. Only stubs answered `/__proxy/*` and `/profile*`, and the live :8644 pid 17367 was unchanged before and after.
  - `fe-b5-after-b5-{invalid_key,unreachable,wrong_origin,stale_server,ok}-{1440,375}.png`
  - `fe-b5-after-b6-{1440,375}.png`
  - `fe-b5-after-wizard-{status,paths}-{1440,375}.png`
  - The `fe-b5-before-*` shots are after the JS changes but before the CSS pass.
  - Script: `.lane-evidence/shots.mjs`.

## 4. Floor results (paste, do not paraphrase)

`npm run lint:repo` → exit 0 (tail):
```
OK integrations/openclaw-command-center/SKILL.md
> command-center@0.1.0 lint:tokens
> node tools/lint-tokens.mjs
lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
```

`npm run typecheck:repo` → exit 0. The run includes `node --check` on oneflow-beat-discovery.js, oneflow-beat-payoff.js, discovery-wizard-{ui,shell,probes}.js, plus `tsc --noEmit` for browser-use-discovery and server.

Named node tests → exit 0:
```
node --test tests/gfx-fe-b5-*.test.mjs tests/gfx-be-fuel-*.test.mjs tests/oneflow-b5-*.test.mjs tests/oneflow-l3-*.test.mjs tests/sixbeats2-fuel-beat.test.mjs tests/ux01-c7-honest-setup.test.mjs tests/discovery-wizard-*.test.mjs tests/oneflow-l4-*.test.mjs tests/oneflow-payoff-exit.test.mjs tests/gfx-be-core-*.test.mjs tests/discovery-cross-rec.test.mjs tests/sixbeats-v2-shell-visual.test.mjs
ℹ tests 560
ℹ suites 143
ℹ pass 560
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

A wider sweep ran every test that loads a fenced file or an oneflow harness: 78 files, excluding the two port-binding files (b5-start-opener, gfx-be-fuel-launcher). The launcher file ran green in the named run above. Result: `ℹ tests 1105 · pass 1098 · fail 7`. The 7 failures are all `tests/integration/onboarding-chain-convergence.test.mjs` (:143, :186, :206, :234, :340, :375, :389). The same 7 fail on an untouched `24eff564` checkout (baseline: `pass 128 · fail 7` for that file plus the b5/l3 set). Sample: `'fit' !== 'discovery'`. The flow now gates discovery on fit (R4 BEAT_PREREQS), and this integration file was never updated. I didn't cause it; see §5.

`npm run test:e2e-onboarding` → exit 1: 6 passed, 1 failed:
```
✘ 1 greenfield-onboarding.spec.mjs:543:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install
    Error: network boundary contract violations
    + "OpenRouter check model openai/gpt-5.4-mini",
✓ E1–E6 greenfield-remediation (incl. E5 Payoff is honest)
```
This is the B2 model pin, which FE-B2B3 owns. The run reached its end-of-test `expectCleanRun` at :624, so the B5 Save & verify, skip-connect and B6 steps all passed on the way.

`npm run test:e2e-journey` → exit 0: `33 passed (40.5s)`.

`gitleaks protect --staged --redact` (fence staged) → `no leaks found`. Also `gitleaks detect --log-opts=24eff564..HEAD` → `6 commits scanned … no leaks found`.

## 5. Unverified / sandbox refused

- **Adjacent P1, not in my fence (ONEFLOW:CORE CSS):** at 375 px the message slot renders off-screen to the right (x≈369) on every beat. I reproduced this on untouched HEAD.
  - Cause: under 480 px the dock footer is `flex-direction: column`, `css/oneflow.css:119` adds `flex-wrap: wrap`, and `.discovery-setup-wizard__message { flex: 1 0 100% }` wraps into a second column.
  - Suggested fix: `flex-wrap: nowrap` inside the 480 px dock rule.
  - Until then, my 375 shots show each outcome's panel node and fix control, but not the message text.
- `localServerHint` is called with no arguments. FE-B2B3's `{platform, runtime}` extension hasn't landed, and passing an object to the current positional form would read as "not a Mac". So the runtime-aware "Open the JobBored app" sentence isn't wired in B5 or the wizard yet. That's a one-line change once the extension lands.
- The wrong_origin link opens `http://localhost:8080/`, a different origin, so onboarding progress doesn't come along (X3 / D2 territory).
- D1 visual: the disabled Connect and Skip buttons are hidden by CSS only while the connect panel is dimmed. The DOM contract that existing tests pin (present and disabled) is kept.
- On a pass, the quota sentence shows three times: in the done stage list, the message and the panel ✓. I kept it because `oneflow-l3-beat-discovery:234` pins the stage list staying after a pass.
- Outside my fence and left alone:
  - Settings' "Tailscale (recommended)" callout (VAL-SIGN-003) is a second, unconditional recommendation, which drifts from D4.
  - `FUEL_TITLE` ("First, the fuel…") is spec-normative and pinned by tests, so B5 still has two title metaphors.
  - The wizard's local_agent path, now named "Just this computer", still walks the tunnel and relay steps.
- The screenshots used `seedRuntime({migratedBeats})` to open B5 and B6 directly. The wizard shots called `openSetupWizard` from the console. None of this was driven through the real B1–B4 flow; the e2e suites cover that.
- `index.html`: no script-tag changes needed.
