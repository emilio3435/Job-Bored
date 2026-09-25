# SIXBEATS program — polish & repair of the six-beat onboarding (2026-09-02)

Goal: Bring the shipped six-beat onboarding to the quality `docs/ONE-FLOW-ONBOARDING-SPEC.md` promises — every surface framed and on-brand, every action answered on screen, every profile write actually persisting on a fresh install — driven by the claims below, landed through one PR to main.

Success means:
- Every `ERROR`/`MISMATCH` claim (C1, C3, C4, C2) has a red-first test that fails on `5406698` and passes on the integration branch.
- Every `UGLY` claim (U1, U2, C7) has a before/after screenshot pair at 1440×900 and 390×844 in the lane report, and the after matches the prototype's structure (header/wordmark strip, framed board, prominent invitation, one spine).
- Full floor green on integration: `npm test`, `lint:repo`, `typecheck:repo`, `test:contract:all`, `test:e2e-journey`, `test:e2e-smoke`, plus the new visual gate.
- A second Gemini walkthrough of Path A (Emilio runs it) records zero `ERROR`/`FROZEN`/`BLOCKER` tags.

Stop when: the integration branch is merged to main through CI and the program is swept.

## Evidence (read before any lane starts)
- `evidence/s0-as-shipped-emilio.png` — the founder's screenshot of S0 as shipped: "hot garbage". This is claim U1.
- `evidence/gemini-walkthrough-REPORT.md` — Gemini's observe-only walkthrough (4 paths, tags per surface). Its media (57 screenshots + 6 videos) lives on this machine at `/Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/`.
- `evidence/gemini-KICKOFF-FABLE.md` — Gemini's draft kickoff. Its §fence references are fabricated and its fixes are guesses; use only its claim list as leads. The claims below are the orchestrator-verified set.
- `reference/six-beats-prototype.html` — the approved clickable prototype: the visual + copy target for S0 and the shell. Open it in a browser next to the app.

## Claims (verified by the orchestrator against code; the lane still writes the red test first)
- **U1 · S0 · UGLY** — as shipped, S0 is a bare kanban of demo cards with no page header/wordmark, no framing, and the invitation card collapsed to a corner pill while most of the viewport is empty (evidence/s0-as-shipped-emilio.png). Prototype S0 shows the target.
- **U2 · shell · UGLY/MISMATCH** — the flow shell renders the 6-segment spine AND a second step-rail row ("GOOGLE") beneath it; spec §2 "ONE spine". Shell header, spacing, and busy/message styling need the prototype's polish.
- **C7 · Beats 4–5 · UGLY (mobile)** — at 390×844 the cards run long and the action buttons are not reachable without scrolling (Gemini path A mobile).
- **C3 · Beats 4/6 · ERROR** — `POST /profile` and `GET /profile` resolve same-origin (`jobBoredApiUrl` is empty by default) → :8080 static host → 404 (`profile_response_invalid`). The server fit profile never persists on a fresh install. The dev server has no `/profile` proxy.
- **C1 · cold start · ERROR** — uncaught `TypeError: Cannot read properties of null (reading 'appendChild')` on `/?greenfield=1` first paint (Gemini S0, video path-a-desktop 00:00–00:03). Source unknown — RCA required.
- **C4 · refresh · MISMATCH (suspected artifact)** — refreshing with `?greenfield=1` still in the URL re-runs the greenfield reset (drops IndexedDB) and lands on cold start; resume-on-refresh is tested green without the param. Fix at source: strip the param from the URL after applying the reset.
- **C2 · Beat 3 · MISMATCH** — the template grid has no "Back to upload / paste" action.
- **C5 · Beat 4 · CONFUSING** — Escape drops to the board with no feedback; closing is pausing (spec §3.4) and should say so.
- **C6 · Beats 2/5 · FROZEN-adjacent** — key verification spins 1.4–3.0 s with no elapsed/timeout affordance.

## Locked decisions
1. Integration branch `feat/sixbeats-integration` (this worktree); lane branches `feat/sixbeats-<lane>`; one PR to main; `gh pr merge --rebase`.
2. Visual target = `reference/six-beats-prototype.html` rendered in the product's token system (`tokens-v2.css`: paper / navy / mint / washi tape; Geist + Caveat + JetBrains Mono). Lanes replicate its structure and rhythm; exact pixel parity is not required.
3. C3 fix = the dev server proxies `/profile` and `/profile/*` to the local API (`http://127.0.0.1:3847` by default, same auth posture as the existing `/__proxy` routes); the client keeps resolving same-origin when `jobBoredApiUrl` is empty. No stranger has to configure a URL.
4. Fences are per the ONEFLOW `SUBSTRATE.md` ownership map, refined below; `css/oneflow.css` is split by its existing `/* ONEFLOW:CORE */` (shell) and `/* ONEFLOW:L4 */` (S0) regions — V1 edits only L4, V2 edits only CORE.
5. Q1 (visual gate) runs serial after V1 + V2 merge.

## Lane cut
| Lane | Claims | Fence |
|---|---|---|
| V1 s0-visual | U1 | `oneflow-demo-board.js`, `fixtures/demo-pipeline.json` (copy only), `css/oneflow.css` L4 region |
| V2 shell-visual | U2, C7 | `discovery-wizard-shell.js`, `css/oneflow.css` CORE region |
| B1 profile-path | C3 | `dev-server.mjs` (new proxy route + tests), `fit-profile-wizard.js` `profileUrl()` fallback comment only |
| B2 boot-error | C1 | RCA first; then the single owning file (report it) |
| B3 beat-ergonomics | C2, C4, C5, C6 | `oneflow-beat-resume.js`, `oneflow-beat-ai.js`, `oneflow-beat-discovery.js`, `onboarding-flow.js` (close hook only), `config-overrides.js` (greenfield function only) |
| Q1 visual-gate (serial) | all | `tests/e2e-journey/**`, `tests/e2e-smoke/**`, new `tests/e2e-visual/**` |

Worker stack: every lane is Opus 5 high via `claude --model opus --effort high --permission-mode auto`. Ground rules: `docs/programs/oneflow-20260831/GROUND-RULES.md` apply unchanged, plus `GROUND-RULES-ADDENDUM.md` here.
