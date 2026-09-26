# KICKOFF — lane E2 `verify-fix` (follow-up to lane E `verify`)

Read `GROUND-RULES.md`, `GREENFIELD-SPEC.md` §4.6, and `LANE-REPORT-verify.md` at the worktree root. Create `LANE-REPORT-verify-fix.md` before anything else. Your branch already holds the E1–E6 spec (commit 1607f02).

## Why you exist
The orchestrator ran `npm run test:e2e-onboarding` on the integration base outside the sandbox. Output: `evidence/verify-base-red-orchestrator-run.txt`. Nine tests failed. Four (E1, E3, E5, E6) fail on their own assertion — correct red. Five fail for the wrong reason and must be fixed so they can turn green when lanes A–D merge:

1. **E2** — strict-mode violation: `#oneFlowMount [data-beat-id="resume"]` matches both the spine `<li data-beat-id>` and the beat `<div class="oneflow-beat" data-beat-id>`. Scope every beat locator in the file to `.oneflow-beat[data-beat-id="…"]` (add a `beat(page, id)` helper beside `action()`).
2. **E4** — `toHaveAttribute("open", "")` reports "serializes to the same string". Assert `await expect(details).toHaveJSProperty("open", true)` and focus via `toBeFocused()` on the Client ID input.
3. **VAL-WIZ-001/002/003** in `greenfield-onboarding.spec.mjs` assert the pre-OneFlow login gate and two-step wizard ("Connect Google" heading, `?greenfield=1` surviving reload). That wizard is gone on main and `?greenfield=1` is stripped on first load by design (six-beats C4). Replace the three with ONE journey test `VAL-ONEFLOW-001: six beats reach the payoff on a fresh install` using the same hermetic harness: `?greenfield=1` → S0 card "Make it mine" → Beat 1 (stub sign-in via the harness AUTH, starter sheet created) → Beat 2 (OpenRouter key, verification stubbed) → Beat 3 (starter template) → Beat 4 (`Looks like me →`) → Beat 5 (skip the connection) → Beat 6 shows `payoff_run_discovery` or, if lane C has landed, the readiness primary. Keep any shared helpers you extract in `tests/e2e-onboarding/helpers/`.

## Fence
`tests/e2e-onboarding/**` only. No product files. Sandbox will refuse the browser and the commit; paste the refusal into report §5 and leave the tree dirty with `UNCOMMITTED — rescue commit needed` at the top of §3. `npm run lint:repo` must be green.

## Definition of Done
E2 and E4 assert on product behavior only; VAL-WIZ-* replaced by VAL-ONEFLOW-001; lint green; report written. Never push.
