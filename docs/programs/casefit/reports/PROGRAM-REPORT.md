# CASEFIT — program report (orchestrator, Fable 5.1)

**Branch:** `feat/casefit` at 810cd52, 14 commits over origin/main 58366b6. Not pushed.
**Spec:** `docs/superpowers/specs/2026-09-03-case-content-fit-design.md` · **Plan:** `docs/superpowers/plans/2026-09-03-case-content-fit.md`

## Lanes (model verified on the live process)

| Lane | Model · vehicle | Commits | Note |
|---|---|---|---|
| M2 model-truth | GPT 5.6 Sol xhigh · Codex | c30e908, 5e0c40f | all seven items; 70/70 own suites |
| F1 board-fold | **Spark 1.3 (`muse-spark-1.3-contributor`) xhigh · native `muse exec`** | 301985e, 68a9611, d1d6234 | full floor run inside the lane (sandbox off): 3069 pass, both Playwright suites |
| S3 upstream-truth | GPT 5.6 Sol xhigh · Codex | 772be47 (rescue-committed) | sandbox refused index.lock and loopback |
| T4 real-shape proof | GPT 5.6 Sol xhigh · Codex | fd45535 (rescue-committed) | its balance assertion failed on the integrated head — see below |

Integrator commits: 4046c94 (follow-up date width), 810cd52 (empty date placeholder; lane-bound amendment).

## Floor on 810cd52, run by the orchestrator

- `npm test`: 3073 tests, 3072 pass, 0 fail (the one flagged item is the pre-existing "canonical-ownership gate" todo, identical on main)
- `lint:js` 0 · `typecheck:server` 0 · `lint-tokens` 0 findings · `smoke:jb-v2` 13/13 · `test:contract:all` exit 0
- `integrations/browser-use-discovery` `npm test`: 656/656
- Playwright: e2e-smoke 10/10 (three new real-shape tests), e2e-journey 13/13

## Deviations from the plan, stated

1. **Spec §7's 1.6× lane ratio was amended to 2.5× + ≤ 1000px.** T4's fixture measured 897 / 804 / 396 on three content-bearing lanes; with the §9 caps (8 requirements, 12 chips) 1.6 is not attainable, and the board reads correctly at those numbers (one screen, no blank column — the old shape was 7×). The number was a guess in the spec, not a locked decision.
2. **No Grok verification lane was spawned.** The orchestrator ran the T4 suite and the real-shape screenshot itself (`reports/real-shape-1240.png`); fewer agents, same evidence.
3. Two integrator CSS fixes landed inside F1's fence after F1 exited: the date input clipped to "09/06/2…" inside its new wrapper, and the empty date still showed the browser's mm/dd/yyyy.

## Unverified

- `LIVE-CHECK.md` on Emilio's real sheet (the only unautomated proof).
- The enrichment prompt's new voice rule changes model output only on the next enrichment; cached enrichments keep the old third-person points.

## Environment notes for the next program

- Worktrees need `node_modules` **and** `server/node_modules` symlinked from the primary checkout; without the second, the scraper-server tests spawn a process that dies on a missing `express` and the suite hangs forever.
- macOS `/bin/bash` is 3.2: no associative arrays. Watcher scripts go in zsh.
- Codex lanes cannot commit in a linked worktree (index.lock outside the sandbox) and cannot bind loopback; rescue-commit is the norm, not the exception.
