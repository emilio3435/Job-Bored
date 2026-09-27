# Lane UXD-FE: make live discovery progress visible — elegant, minimal, on-theme

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `DIAGNOSIS-disco-progress.md` (the 8m39s silent-run incident; verify its claims yourself, trust nothing)
- `SPEC.md` §0 (D1–D12)
- `LANES.md`
- `DESIGN.md`, `JB-UI.md`, `JB-A11Y.md` (repo root)

**Load the `/frontend-design` skill before designing anything.** Routing: opus · medium (seat 1, pool A).

Your worktree is based on `feat/gfx-integration` at `dd45a692`.

**Live alongside you:** UXD-BE (sol · high) instruments the worker to emit fine-grained progress. QA-LIVE (astra · xhigh) is live on `:8080`/`:8644` with an isolated HOME — **do not message, probe, or target that session or its ports; your only sibling is UXD-BE.** Do not touch worker/server/contract files; those are the BE fence.

**Goal:** a discovery run never again *looks* frozen. While a run is live, the dashboard shows honest, elegant, minimal progress on-theme: what phase it's in, that the worker is alive, and how much has been found so far — driven by the BE contract, never invented.

**Phase 0 — independent investigation + own recs (no sibling contact yet):**
1. Reproduce the incident shape against the evidence in DIAGNOSIS (frozen `scout #2`, 2s poll, coarse fields). Trace the dashboard poll loop and every field it renders for a live run: `discovery-run-tracker.js`, `discovery-status-handoff.js`, `discovery-drawer.js`, `runs-tab.js`, and their CSS.
2. Write your OWN recs in your report (new §6 `FE recs (pre-align)`): what to render (phase, heartbeat/elapsed honesty, counters, per-source or per-company mini-progress), what payload shape you need from BE, degradation rules when fields are absent, motion/a11y plan. Commit nothing yet.

**Phase 1 — consult UXD-BE via cmux, then align (strict gate):**
3. Find the UXD-BE lane session with the cmux CLI and exchange recs. Iterate until you agree on ONE shared progress contract: exact `progress` payload fields (additive on `DiscoveryRunProgress`), semantics of each counter, staleness/heartbeat rules, and what "no data" means.
4. Paste the identical `AGREED CONTRACT` block (fields + one example payload) into your report §6 and confirm UXD-BE's report holds the same bytes. **No Phase 2 before this.** If the sibling is unreachable after 3 tries spaced ≥10 min apart, first line `BLOCKED-ON-ALIGN`, leave your proposal in §6, and stop.

**Phase 2 — implement on the agreed contract (each item red first, tests named):**
5. **Live run rendering.** Drive the discovery drawer/status surface and the Runs tab live rows from the agreed `progress` object: phase indicator, honest elapsed + "updated Xs ago" heartbeat, counters (companies / boards / listings / leads), and per-source or per-company mini-progress exactly as agreed. A quiet-but-alive worker must read as *working*, never as broken; a truly stalled one (no heartbeat past the agreed bound) must say so.
6. **Degradation.** Missing/older-worker/relay payloads render the legacy coarse view with no spinner-of-death and no invented numbers.
7. **Visual quality (`/frontend-design`).** Deliberate, minimal, jb-v2 tokens; scope every rule under the discovery/runs roots (the jb-v2 cascade trap); reduced-motion safe (`page.emulateMedia`, assert on `matchMedia`); keyboard/screen-reader sane per JB-A11Y.md. Playwright screenshots at 1440 and 375 px saved to `.lane-evidence/`, port-0 dev-server only, never :8080.

**Floor:** paste all of this in §4. Never bind 8080/8644/3847; never touch the real `~/.jobbored`.
- `npm run lint:repo`
- `npm run typecheck:repo`
- `node --test` on your new `tests/gfx-uxd-fe-*.test.mjs`, plus `tests/runs-tab.test.mjs` and every suite that pins a string or selector you changed (grep for each)
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>` (+ `BLOCKED-ON-ALIGN` state above).

**Stop when:** the fence is exhausted, the floor is pasted, the report's first line is `DONE`, `AGREED CONTRACT` matches UXD-BE's, and your commits are on your branch.

## Fence

- `discovery-drawer.js`, `discovery-status-handoff.js`, `discovery-run-tracker.js`, `discovery-run-orchestration.js`, `runs-tab.js`, and their CSS blocks (lane locates; other beats' blocks untouched)
- new `tests/gfx-uxd-fe-*.test.mjs`, `.lane-evidence/` screenshots

**Do NOT touch:**
- `integrations/**`, `server/**`, `schemas/**`, `examples/**`, `AGENT_CONTRACT.md` (UXD-BE)
- `index.html` script tags (orchestrator: ask in §5), `desktop/**`, `oneflow-beat-*.js`, docs, `.github/**`
- the live ports, the real `~/.jobbored`, `~/Library/LaunchAgents`, the QA-LIVE session

## Non-negotiables

- Render only what the contract delivers; never invent progress.
- Every claim red first.
- No weakened test claims.
- Reduced-motion and a11y assertions ship with the visuals.
- Never kill a process you didn't start.

## Definition of Done

A live run shows phased, heartbeat-honest, counter-backed progress per the agreed contract; legacy payloads degrade cleanly; floor pasted in §4; first line `DONE`. Local commits.
