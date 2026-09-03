# CASEFIT — Ground rules (every lane reads this first)

**Spec:** `docs/superpowers/specs/2026-09-03-case-content-fit-design.md` — §9 locked decisions override anything contrary.
**Plan:** `docs/superpowers/plans/2026-09-03-case-content-fit.md` — your fence is in §2, your items in §3.
**Base:** `feat/casefit` (origin/main 58366b6 + the docs commit). Your branch is `feat/casefit-<lane>`; your worktree is this directory.

## Your first action

Create `LANE-REPORT-<lane>.md` at the worktree root with these five headings, each marked `PENDING`, and fill them in as work lands:

1. What this lane was
2. Which claims went red first (test names)
3. What shipped — file and fence
4. Floor results — pasted, not paraphrased
5. Anything unverified, including what the sandbox refused

A lane is not done until section 4 holds real output. Lanes die to quota and sandbox limits; a report written at the end is a report nobody gets.

## Non-negotiables

1. **Test-first.** Each item starts with a failing test that names the real string from spec §1. Never weaken an assertion. If a fixture encoded the bug, fix the fixture and say so in the report.
2. **Stay in your fence** (plan §2). A diff outside it is reverted at integration, however good.
3. **Frozen** (spec §5): `jb:*` event names/shapes, Sheet Interface A, `recruiter-strip.js`, every existing `data-action` value, the enrichment JSON schema field names, the `role.js` focus-guard selector.
4. Commit locally with conventional messages, one logical change each. **Never push.** Scratch goes in `.lane-evidence/`. Delete nothing that you did not create.
5. Do not end your turn to check in. Keep going until your Definition of Done is met or you are genuinely blocked; if blocked, write why in report section 5 and stop.

## Traps that fail silently (these cost hours last time)

- **node:vm harness:** every sandbox must evaluate `jb-text.js` **before** `role-case-model.js` / `role-case.js` / `dawn-data.js`. If it does not, `T()` is null, the model falls back to `String(x).trim()`, and every new text helper is a no-op that still passes. Assert `window.JobBoredText` exists in the harness.
- **CSS cascade (jb-v2):** a single-class rule loses to `body.jb-v2 h3/p` (0,1,1). Scope every rule under `body.jb-v2 [data-region="role"] .case`. A rule that "does nothing" is this.
- **Token lint:** raw hex only inside custom-property definitions. `node tools/lint-tokens.mjs --quiet` must print nothing.
- **Playwright reduced motion:** `test.use({ reducedMotion })` inside a `describe` never reaches the page. Use `page.emulateMedia({ reducedMotion: "reduce" })` and assert `matchMedia`.
- **`npm test` is the gate.** `node --test tests/*.test.mjs` silently skips `tests/integration/`. Use `npm test`.
- **Codex sandbox:** `git commit` can fail on `index.lock` (worktree metadata lives outside the sandbox). Leave green work as dirt, say so in report section 5, and the integrator rescue-commits it. `npm test` may refuse to bind loopback — note which suites, do not mark them skipped.
- **Screenshots:** Playwright screenshots go to `.lane-evidence/` only. Never overwrite a tracked PNG.
- **Dates:** any test that pins a "now" must use a *local* evening west of UTC (`new Date(2026, 8, 2, 23, 50)`), not a UTC noon that cancels the bug out.

## Floor (paste the output into report section 4)

```bash
npm test && npm run lint:js && npm run test:contract:all && npm run typecheck:server
npm run smoke:jb-v2 && node tools/lint-tokens.mjs --quiet
npm run test:e2e-smoke && npm run test:e2e-journey
```
Lane S3 also: `cd integrations/browser-use-discovery && npm test`.

## Muse (lane F1 only)

Flag set proven by the orchestrator's preflight (2026-09-03 02:05 CDT, 33s, wrote `.lane-evidence/PROBE.txt`, no prompt):

```
muse exec --model muse-spark-1.3-contributor --reasoning-effort xhigh --workspace <wt> --trust-workspace --approval-mode never --disable-sandbox --prompt-file <wt>/.lane-evidence/kickoff-F1.md
```

Sandbox is off, so loopback binding for the Playwright suites is unrestricted. Muse ignores `CLAUDE.md` where `AGENTS.md` exists — the repo contract in `AGENTS.md` is what the lane sees. `node_modules` is a symlink to the primary checkout; do not run `npm install`.
