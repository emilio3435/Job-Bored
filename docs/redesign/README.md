# Redesign orchestration — Command Center (Job-Bored)

**Run ID:** `redesign-20260424T0742Z`
**Orchestrator:** main repo at `/Users/emilionunezgarcia/Job-Bored` (branch `main`, tip `a28c416`).
**Source-of-truth briefs (imported):**
- `DESIGN.md` — product principles (scan-first, progressive disclosure, AI as compression).
- `PIPELINE-CARDS-HANDOFF.md` — collapsed/expanded card 3-tier spec.
- (this directory) — per-lane handoffs derived from above, scoped by file/selector.

## Lanes at a glance

| Lane | Worktree | Branch | Owns (code) | Owns (CSS section + line range) |
|---|---|---|---|---|
| fe-dashboard | `../Job-Bored-wt-redesign-fe-dashboard` | `redesign/fe-dashboard` | `app.js` pipeline **header/orchestration** (`renderPipeline`, `renderPipelineDailyBrief`) + Daily Brief/KPI strip | `COMMAND STRIP` (1490–3450), `MAIN LAYOUT` (3451–3459), `PIPELINE SECTION` (3460–3802), `TOP BAR` (1158–1274) |
| fe-kanban | `../Job-Bored-wt-redesign-fe-kanban` | `redesign/fe-kanban` | `app.js` `renderKanbanCard`, `renderStageLane`, `renderPipelineBoard`, `groupByStage` | `PIPELINE BOARD — Stage lanes + Kanban cards` (3816–4264) |
| fe-detail-drawer | `../Job-Bored-wt-redesign-fe-detail-drawer` | `redesign/fe-detail-drawer` | `app.js` `renderDrawerContent`, `renderStageStepper`, `renderCardActions`, `handleDetailEscape` | `DETAIL DRAWER` (4265–5167), `DRAWER CARD STYLES` (5168–5238), `TALKING POINTS` (5239–5471), `CARD ACTIONS` (5472–5609) |
| be-data-deploy | `../Job-Bored-wt-redesign-be-data-deploy` | `redesign/be-data-deploy` | `server/`, `integrations/browser-use-discovery/`, `schemas/`, `scripts/`, contract tests | — (no CSS ownership) |
| integration | `../Job-Bored-wt-redesign-integration` | `redesign/integration` | merge target only | merges the four above sequentially |

## Shared file protocol

`app.js` and `style.css` are shared across the three FE lanes. Rule: **no two lanes edit the same `function` (JS) or the same CSS section (as listed above)**. If a change straddles a boundary, the lane opens a handoff note and waits for orchestrator approval.

Specifically:
- `:root` tokens, `--space-*`, `--status-*`, fonts → **fe-dashboard only** may extend tokens. Other lanes consume them. If a lane needs a new token, it posts a note and fe-dashboard adds it on its next commit.
- `renderPipeline()` calls into `renderPipelineBoard()` and opens drawers. fe-dashboard owns the caller, fe-kanban owns the callee, fe-detail-drawer owns the drawer. Signature changes require all three handoff notes.

## Model + CLI

Workers run with:
```
codex exec -m gpt-5.5 -c model_reasoning_effort=xhigh \
  -C <worktree-path> -s workspace-write \
  --add-dir /Users/emilionunezgarcia/Job-Bored/docs/redesign \
  <prompt-file>
```
(The `gpt-5.5` model and `xhigh` reasoning are already defaults in `~/.codex/config.toml`, but we pass them explicitly so the invocation is self-describing.)

## Coordination rules

1. Every worker starts by reporting: current branch, dirty status, files it intends to own, possible collisions.
2. No two workers may edit the same logical section without orchestrator approval.
3. Each worker runs focused verification before handoff (see per-lane briefs).
4. Each worker's handoff doc must include: changed files, tests run, screenshots (UI lanes), known risks, merge notes.
5. Prefer implementation over planning; stop on real ambiguity that could break data/write-back contracts.

## Integration

After all four lane handoffs land, the `integration` worktree merges branches **sequentially** (`fe-dashboard` → `fe-kanban` → `fe-detail-drawer` → `be-data-deploy`), resolving conflicts by reading both handoffs. It runs the repo-defined test suite from `package.json`, starts the dev server, and captures desktop + mobile screenshots.
