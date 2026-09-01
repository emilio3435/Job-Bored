# DISCOVERY-HARDENING ground rules — every lane reads this first

Program spec: `docs/programs/discovery-hardening/PROGRAM-SPEC.md` (its **Locked decisions** section overrides anything else you infer). Your kickoff names your lane, fence, and claim ID.

## First action, before any code

Create `LANE-REPORT-<lane>.md` in your worktree root with exactly these headings, each marked `PENDING`, and fill them in as work lands:

```md
# Lane report: <lane>

## Scope and ownership
PENDING

## Baseline and RED evidence
PENDING

## Implementation
PENDING

## Verification and raw output
PENDING

## Commit, risks, and handoff
PENDING
```

A lane is not done until "Verification and raw output" holds PASTED raw output (not a pass count) and "Commit, risks, and handoff" holds your local commit SHA.

## Definition of Done (paste every result into the report)

1. Your claim's RED probe (from the kickoff) run BEFORE implementation, raw output pasted.
2. The same probe GREEN after implementation, raw output pasted.
3. Your lane's targeted gate (named in the kickoff).
4. The repository floor, run from your worktree:

```bash
npm run typecheck:repo
npm run lint:repo
npm run test:repo
git diff --check
```

5. `git diff` reviewed by you, scanned for secrets (grep for `ya29.`, `AIza`, `sk-`, `ngrok`, real hostnames, real Sheet IDs, `.env` values), then ONE coherent local commit: `<type>(discovery-hardening/<lane>): …`. Return the SHA in the report.

## Work style

- TDD: RED probe first, then the smallest change that turns it GREEN. Test names carry the claim ID (e.g. `ASSET-1:`).
- Work ONLY inside your fence. If you need a change outside it, STOP editing that file, write the need into the report's handoff section, and continue with what you can. The orchestrator routes it.
- Commit locally, never push. Never open a PR. Never touch remotes, secrets, schedules, Cloudflare, DNS, Tailscale, launchd.
- Keep scratch in `.lane-evidence/` (gitignored). Delete nothing.
- Match the codebase: classic-global IIFE modules on `window` for browser files (no ESM in browser JS), `node:test` for root tests, `node --experimental-strip-types --test` for the worker's TS tests, no `any`.
- Do not spawn sub-agents. Do the work in-lane.
- Environmental failures (EADDRINUSE / listen EPERM, missing browsers, missing creds, network refusal) are BLOCKERS: paste them verbatim in the report, do not work around them by weakening a test.

## Traps that fail SILENTLY (these cost hours)

1. `node --test tests/foo.test.mjs` runs, passes, and SKIPS `tests/integration/` — only `npm test` / `npm run test:repo` is real. `npm test -- tests/foo.test.mjs` is the correct single-file form.
2. A new root-level browser JS file not appended to `typecheck:repo` in package.json passes typecheck while broken. Only the Canary lane owns package.json; nobody else creates root browser files.
3. Worker tests: the `test:browser-use-discovery` glob only picks up `tests/<dir>/*.test.ts` for the listed dirs. A test in a new subdirectory is silently never run.
4. `config.js` is gitignored and holds live secrets. Never read it into a test, never commit one. The hermetic harness serves `config.example.js` as `/config.js` on purpose.
5. Playwright: `tests/e2e-journey` and `tests/e2e-smoke` are Playwright-only; `.spec.mjs` files never run under node:test. Run them with `npm run test:e2e-journey` / `npm run test:e2e-smoke`. If chromium is missing: `npx playwright install chromium`.
6. Legacy tests pin current behavior on purpose. If your change legitimately breaks one INSIDE your fence, update it in the same commit with a message naming the claim. A red test outside your fence = report handoff section, don't touch it.
7. `git commit` inside a worktree can fail on `.git/worktrees` metadata if a sandbox refuses it. Do NOT retry destructively: leave the tree dirty, write "commit refused" in the report with the error, the integrator rescues.
8. Never put a wall-clock `setTimeout`/sleep in a race assertion. Use the `deferred()` pattern (already in `tests/e2e-fixtures/hermetic-harness.mjs`) or injected clocks.
9. The scraper server lives at `server/index.mjs` + `server/shared/job-scraper-core.mjs` (NOT `server/src`). The discovery worker lives at `integrations/browser-use-discovery/src`.

## Model / vehicle

You were launched as `claude --model opus --effort high`. If you notice you are not Opus, stop and say so in the report.
