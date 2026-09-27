# ORCH handoff: spawn UXD-FE + UXD-BE lanes in cmux

For the GFX orchestrator (opus · medium, seat 1). Mission: spawn the two discovery-progress-visibility lanes and verify they are alive. You spawn and verify only — you do not implement lane work yourself.

Artifacts are ready and reviewed (2026-09-26 ~16:45 CT):
- `docs/programs/gfx-20260926/DIAGNOSIS-disco-progress.md` — the 8m39s silent-run incident
- `docs/programs/gfx-20260926/KICKOFF-GFX-UXD-FE.md` — opus · medium + `/frontend-design`
- `docs/programs/gfx-20260926/KICKOFF-GFX-UXD-BE.md` — sol · **high** (Emilio's explicit order; do not "upgrade" to xhigh)
- Shared ground rules: `KICKOFF-GFX-_SHARED.md` (lanes read it first)

## 0. Read first

`LANES.md`, both kickoffs, the diagnosis. Note current quota state and append fresh readings (pool A was 86% weekly; pool X reset 12:47 CT — FE burns A, BE burns X).

## 1. Protect the live lane

QA-LIVE (astra · xhigh) is running a live single-run QA pass against `:8080`/`:8644` with an isolated HOME. Before spawning anything, record its cmux session/pane refs. Then: **no input, no messages, no pane closes, no port binds, no process kills anywhere near it.** If QA-LIVE is gone when you look, note it in LANES.md and carry on; if it is mid-run, spawn quietly and keep clear.

## 2. Worktrees

Base is `feat/gfx-integration` at `dd45a692` (verified this session). If the branch has moved, use the newest HEAD and record the actual SHA in both LANES rows — do not edit the kickoffs after spawn.

```
git worktree add ~/Job-Bored.worktrees/gfx-uxd-fe -b feat/gfx-uxd-fe <base-sha>
git worktree add ~/Job-Bored.worktrees/gfx-uxd-be -b feat/gfx-uxd-be <base-sha>
```

## 3. Spawn in cmux (house ritual, exact prompts)

Two panes/sessions with **discoverable names containing `UXD-FE` and `UXD-BE`** — the lanes find each other by name for the Phase 1 alignment. Working dir = the lane's worktree.

- **UXD-FE:** `claude --model claude-opus-5-5 --effort medium --permission-mode auto`
  First prompt: `Read /Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/KICKOFF-GFX-UXD-FE.md and execute lane UXD-FE exactly as it says. Work only in this worktree, commit locally, never push. Do not end your turn to check in; keep going until the Definition of Done is met or you are genuinely blocked.`
- **UXD-BE:** `codex -m gpt-6-sol -c model_reasoning_effort="high"` (+ house hooks/sandbox flags)
  First prompt: `Read /Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/KICKOFF-GFX-UXD-BE.md and execute lane UXD-BE exactly as it says. Work only in this worktree, commit locally, never push. Do not end your turn to check in; keep going until the Definition of Done is met or you are genuinely blocked.`

Spawn FE first, then BE, within minutes of each other — Phase 1 is a mutual gate and a long-staggered start burns quota on `BLOCKED-ON-ALIGN` risk. (Each lane retries 3× over ≥30 min before blocking, so a small stagger is fine.)

## 4. Verify alive (within ~15 min of spawn)

- `~/Job-Bored.worktrees/gfx-uxd-fe/.lane-evidence/LANE-REPORT-UXD-FE.md` exists, first line `PENDING`
- `~/Job-Bored.worktrees/gfx-uxd-be/.lane-evidence/LANE-REPORT-UXD-BE.md` exists, first line `PENDING`
- Both sessions show `cmux set-status lane working`
- If a lane never starts: respawn once; still dead → report to Emilio with the pane transcript tail. Do not debug lane internals beyond spawn mechanics.

## 5. Hands off the alignment

The lanes align peer-to-peer via cmux and record an identical `AGREED CONTRACT` block in both reports before implementing. You do not mediate, reword, or pre-decide the contract. If either lane reports `BLOCKED-ON-ALIGN`, surface it to Emilio immediately. When both reports show the matching block, note `aligned` in LANES.md.

## 6. Bookkeeping

- Append both LANES.md rows (lane, family, worktree, report path, status `spawned <time>` + base SHA).
- Republish the board per the LANES.md BOARD entry.
- Never push, merge, or PR — Emilio publishes; integration merges come later.

## Done

Both lanes `working` with `PENDING` reports, LANES.md + board updated, QA-LIVE untouched. Final message to Emilio: spawn timestamps, cmux refs, base SHA, quota readings, and either "both working" or the respawn/BLOCKED state.
