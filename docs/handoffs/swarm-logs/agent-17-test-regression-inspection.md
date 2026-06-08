# Agent 17 Test And Regression Inspection

Goal: Prove the integrated OpenRouter compatibility branch with focused and repo-wide validation.

Success means:
- Final focused browser/server/provider tests pass.
- Repo syntax, contract, discovery-worker, and full repo gates pass.
- Local smoke proves OpenRouter-only generic LLM readiness while Gemini Google-tool lanes remain optional.

Stop when: Required verification passes or a blocker is assigned to an owner.

## Result

PASS. No product blockers found.

Agent 17 was launched in cmux `workspace:34` from `openrouter-compat/agent-17-test-regression-inspector` and ran the required final gates against the integrated branch state. The inspector workspace collected the PASS evidence but stalled while writing the report, so Agent 0 committed this artifact from the integration branch using the recorded command outcomes.

## Command Ledger

| Command | Outcome | Evidence |
| --- | --- | --- |
| `npm test -- tests/resume-generate-openrouter.test.mjs tests/resume-generate-local.test.mjs tests/discovery-ai-call-configured-routing.test.mjs tests/discovery-drawer-provider-guard.test.mjs tests/enrichment-self-heal.test.mjs tests/ats-scorecard-provider.test.mjs tests/first-run-wizard.test.mjs` | PASS | 177 pass / 0 fail |
| `npm run typecheck:repo` | PASS | Root browser scripts, scripts, and server modules passed `node --check` |
| `npm run test:contract:all` | PASS | Discovery webhook schema, ATS scorecard contract, Pipeline contract, and skill lint passed |
| `npm run test:browser-use-discovery` | PASS | 610 pass / 0 fail |
| `npm run test:repo` | PASS | Contract suite, root tests, and discovery worker suite passed; auxiliary root wrapper summary showed 1097 pass / 0 fail |
| `npm run dev` smoke | PASS with alternate ports | Default `8080/3847/8644` ports were occupied by the root worktree dev stack. Integration smoke used web `8090`, scraper `3947`, worker `8744`; web served the dashboard, scraper `/health` reported `atsProvider=openrouter` and `atsConfigured=true`, worker `/health` reported `llm.provider=openrouter`, `llm.ready=true`, and Gemini Google tools advisory-only. Smoke sessions were terminated and alternate ports cleared. |

## Regression Notes

- The first worker run-path test attempt failed before dependency install with missing packages. After `npm ci`, the suite ran and exposed a real `runtimeConfig` regression.
- Commit `54c46bd` resolved that regression by attaching worker `runtimeConfig` to run config only for explicit merged-profile payloads, preserving legacy behavior for ambient disk profiles.
- `54c46bd` also resolved the Agent 15 and Agent 16 blockers: local/OpenAI-compatible ATS no-key readiness, generic worker matcher construction, and blank local startup template fields.

## Owner Status

| Area | Owner | Inspector Result |
| --- | --- | --- |
| Browser provider paths | Agents 2-4 | PASS |
| Server provider paths | Agents 5-7, 11 | PASS after `54c46bd` |
| Worker provider paths | Agents 8-11 | PASS after `54c46bd` |
| Docs and copy | Agent 12 | PASS through contract/docs gates |
| Final regression | Agent 17 / Agent 0 | PASS |
