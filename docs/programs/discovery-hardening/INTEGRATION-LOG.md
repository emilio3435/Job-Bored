# Discovery hardening — integration log

Orchestrator: Fable 5.1 (claude-fable-5-1), session 019LLXuxWfWVGz8sjH8ct9bL.
Integration worktree: `/private/tmp/Job-Bored-discovery-hardening-integration`
Integration branch: `feat/discovery-hardening`
Base SHA: `81e313ac8aa72345b2930aa4233f3d11ce09f221` (main, 2026-09-01)

## Unrelated user changes preserved in the main checkout (not on any lane)

- `M integrations/hermes-job-hunt/resume-template/logos.json`
- untracked: `.worktrees/`, `DOSSIER_RENDERER_INSPECTION_REPORT.md`, `diagrams/`, `docs/audits/`, `docs/cleanup/`, `docs/superpowers/plans/2026-08-31-dossier-render-resilience.md`, `docs/superpowers/specs/2026-08-31-dossier-render-resilience-design.md`, `docs/swarm/PROMPT-discovery-hardening-fable51-opus5.md`

## Lane process evidence (`ps -o args= -p <pid>`)

| Lane | cmux ws | pid | ps args (model/effort/mode) | binary | cwd |
|---|---|---|---|---|---|
| scout-browser | workspace:192 | 71039 | `--model opus --effort high --permission-mode auto` | `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.257` | integration worktree |
| scout-worker | workspace:193 | 71067 | `--model opus --effort high --permission-mode auto` | `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.257` | integration worktree |
| assets | workspace:194 | 57753 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-assets` |
| scrape-e2e | workspace:195 | 57826 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-scrape-e2e` |
| lifecycle | workspace:196 | 58182 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-lifecycle` |
| stable-transport | workspace:197 | 58331 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-stable-transport` |
| canary | workspace:198 | 58641 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-canary` |

Lock SHA (spec + kickoffs, base of every lane branch): `d57fdac7afddb8dc2259c7ed4b5743e456013471`. Lanes spawned 2026-09-01 ~15:37 MT.
Note: the cmux wrapper places `--session-id`/`--settings` before the user flags, so verification scans the full arg vector (`ps -o args= -p <pid> | tr ' ' '\n' | grep -A1 ...`), not a literal `claude --model opus` match.


## Merge ledger

| # | Lane | Lane SHA | Merge SHA | Targeted gate result | Notes |
|---|---|---|---|---|---|

## Floor runs

### Baseline on base `81e313a` (+docs commit `8f79235`), run by Fable 2026-09-01 ~15:10 MT

| Gate | Result |
|---|---|
| `npm run typecheck:repo` | green |
| `npm run lint:repo` | green |
| `npm run test:contract:all` | green |
| `npm test` (root, run-tests.mjs) | 2515 tests · 2514 pass · 0 fail · 1 todo (`tests/submission-record-audit.test.mjs` "persists and can remove the canonical submission evidence record" is marked todo "blocked on the canonical-ownership gate" and prints a diff, but does not fail) · exit 0 |
| `npm run test:browser-use-discovery` | 727 pass · 0 fail · 0 skipped |
| `npm run test:e2e-smoke` | 6 passed |
| `npm run test:e2e-journey` | 7 passed |
| `git diff --check` | clean |

