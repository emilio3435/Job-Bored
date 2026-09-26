# Lane cD: UX01 cleanup (board handoffs)

Branch `feat/ux01-cleanup-board`, cut from `feat/ux-zero-to-one` at e37f2f4. Worktree `~/Job-Bored.worktrees/ux01-cleanup-board`. Not pushed. These are handoffs from the lane A and lane C reports that lanes A, C and D did not pick up.

## Items

| Item | Status | What changed |
|---|---|---|
| AX-06 / C2: `pipeline.css` pressed chip | done | `.pipe-tool__chip[aria-pressed="true"]` now sets `color: var(--jb-on-accent)` (navy) on `--jb-mint`, 6.0:1 per the token note in `tokens-v2.css`. Before, it used `--jb-ink-inverse` (light text on mint, about 2:1). Test: `tests/pipeline-chip-contrast.test.mjs` failed first, then passed. Commit 3253092. |
| MP-07 / C20: Add to calendar in Mark submitted | done | After a confirmed Applied write, `submission-flow.js` shows a second toast, "Follow up with <Company> on <date>.", with an **Add to calendar** action. The toast only appears when `window.JobBoredToday.data.buildIcs` exists and the follow-up is an ISO date. The action builds an all-day event through `buildIcs({date, title, company, jobKey, summary:"Follow up", description, url})` and downloads `jobbored-<company>-follow-up.ics` through a Blob and an object URL. Undo stays on the Applied toast. The calendar toast is persistent, because the default 3 s auto-dismiss is too short to act on. Test: `tests/submission-calendar.test.mjs` (4 cases) failed first, then passed. Commit fe7a0e0. |
| C20: `flowing-writes.js` numeric 0 jobKey | done | Added `isMissingKey(key)` (only `null`, `undefined` and `""` count as missing). It is used in `onRoleWritebackEvent` (was `!jobKey`), `findCardsForJobKey` (was `!jobKey`, which also broke the DOM `data-job-url` fallback for key 0) and `resolveSheetRow`. Tests: 3 new cases in `tests/flowing-writes-stage-resolve.test.mjs`; the two for key 0 failed first. Commit 99df7fe. |

## Contracts

Kept: `data-action`, `data-stable-key`, `expandedJobKeys`, `updateJobStatus(dataIndex, stage)`, `schemas/pipeline-row.v1.json`. None of them changed. No schema or Sheet column changed. The `.ics` is built client-side only.

## Baselines

None refreshed. The visual suite passed without updates.

## Handoffs

- None blocking.
- Optional follow-up for whoever owns `jb-a11y.js` / `auth-session.js`: toasts accept only one action, so Add to calendar needs its own toast. A multi-action toast would let it sit next to Undo.

## Floor (worktree root, HEAD fe7a0e0; logs in `~/Job-Bored.worktrees/.ux01-run/cD-*.log`)

Every command exited 0. `npm test`: 3069 tests, 3068 pass, 0 fail, 1 todo. The todo is `submission-record-audit` "blocked on the canonical-ownership gate" and predates this lane (it is also a todo at e37f2f4). Its assertion stack shows up in the log, but it does not count as a failure.

### npm run lint:repo && npm run typecheck:repo
```
lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
> npm run typecheck:browser-use-discovery && node --check app.js && node --check discovery-coach.js && node --check discovery-payload.js && node --check expired-review.js && node --check dev-server.mjs && node --check discovery-wizard-local.js && node --check discovery-wizard-probes.js && node --check discovery-wizard-relay.js && node --check discovery-wizard-shell.js && node --check discovery-wizard-ui.js && node --check discovery-wizard-verify.js && node --check discovery-setup-modals.js && node --check role-materials.js && node --check materials-queue.js && node --check settings-tabs.js && node --check settings-profile-tab.js && node --check user-content-store.js && node --check onboarding-telemetry.js && node --check resume-bundle.js && node --check resume-generate.js && node --check model-download.js && node --check document-templates.js && node --check bridge-registry.js && node --check config.example.js && node --check config-overrides.js && node --check discovery-drawer.js && node --check whats-next-banner.js && node --check materials-feature.js && node --check settings-modal.js && node --check settings-tab-schema.js && node --check app-bootstrap.js && node --check app-compat.js && node --check app-config-core.js && node --check auth-session.js && node --check daily-brief.js && node --check discovery-readiness.js && node --check discovery-status-handoff.js && node --check resume-generation.js && node --check setup-doctor.js && node --check sheet-access-setup.js && node --check scripts/lib/paths.mjs && node --check scripts/lib/schedule.mjs && node --check scripts/setup.mjs && node --check scripts/run-scheduled-discovery.mjs && node --check scripts/run-scheduled-expired-cleanup.mjs && node --check scripts/install-expired-cleanup-schedule.mjs && node --check scripts/uninstall-expired-cleanup-schedule.mjs && node --check scripts/install-repo.mjs && node --check scripts/doctor.mjs && node --check scripts/install-discovery-worker-autostart.mjs && node --check scripts/uninstall-discovery-worker-autostart.mjs && node --check scripts/install-discovery-tunnel-autostart.mjs && node --check scripts/uninstall-discovery-tunnel-autostart.mjs && node --check scripts/lib/discovery-transport.mjs && node --check scripts/bootstrap-local-discovery.mjs && node --check scripts/discovery-keep-alive.mjs && node --check scripts/lib/discovery-worker-policy.mjs && npm run typecheck:server && node --check stage-registry.js && node --check pipeline.js && node --check pipeline-render.js && node --check pipeline-controller.js && node --check dawn.js && node --check dawn-data.js && node --check expired-review-ui.js && node --check pipeline-transition-adapter.js && node --check pipeline-transitions.js && node --check today-data.js && node --check today.js && node --check jb-a11y.js && node --check fit-profile-wizard.js && node --check scribe-state.js && node --check scribe-score-adapter.js && node --check scribe.js && node --check submission-flow.js && node --check recruiter-strip.js && node --check discovery-readiness-truth.js && node --check discovery-run-preview.js && node --check dossier-field-provenance.js && node --check onboarding-flow.js && node --check oneflow-beat-google.js && node --check oneflow-beat-ai.js && node --check oneflow-beat-resume.js && node --check oneflow-beat-fit.js && node --check oneflow-beat-discovery.js && node --check oneflow-beat-payoff.js && node --check oneflow-demo-board.js && node --check onboarding-celebration.js
> command-center@0.1.0 typecheck:server
exit=0
```

### npm test
```
ℹ tests 3069
ℹ suites 739
ℹ pass 3068
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 13587.64375
test=0
```

### npm run test:contract:all
```
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
contract=0
```

### npm run test:e2e-smoke
```

  17 passed (17.5s)
smoke=0
```

### npm run test:e2e-journey
```

  25 passed (28.3s)
journey=0
```

### npm run test:e2e-visual
```

  37 passed (1.0m)
visual=0
```

## Verification · floor (cD-r1)

Verifier: fresh Opus context, independent of the author. HEAD `2791eae8` on `feat/ux01-cleanup-board`, clean tree. Logs: `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/cD-r1/`. No retries needed, no flaky specs, nothing skipped or filtered.

| Command | Result | Counts |
|---|---|---|
| `npm run lint:repo` | pass (exit 0) | lint:tokens 34 sheets, 0 new findings, 0 brace errors |
| `npm run typecheck:repo` | pass (exit 0) | tsc --noEmit clean |
| `npm test` | pass (exit 0) | 3069 tests / 739 suites: 3068 pass, 0 fail, 0 cancelled, 0 skipped, 1 todo |
| `npm run test:contract:all` | pass (exit 0) | 12 OK lines, 0 FAIL |
| `npm run test:e2e-smoke` | pass (exit 0) | 17 passed |
| `npm run test:e2e-journey` | pass (exit 0) | 25 passed |
| `npm run test:e2e-visual` | pass (exit 0) | 37 passed |

Note: the one todo is `tests/submission-record-audit.test.mjs:17` ("persists and can remove the canonical submission evidence record"), which is marked todo as "blocked on the canonical-ownership gate". The runner prints it under "failing tests" but it does not count toward fail.

### Tails

```
# npm test
ℹ tests 3069
ℹ suites 739
ℹ pass 3068
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 14389.674459
# contract

OK integrations/openclaw-command-center/SKILL.md
exit 0
# smoke
  17 passed (17.9s)
# journey
  25 passed (29.7s)
# visual
  37 passed (1.0m)
```
