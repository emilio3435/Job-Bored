# Preliminary diagnosis: discovery runs look frozen (2026-09-26 15:56 CT run)

Where: `docs/programs/gfx-20260926/DIAGNOSIS-disco-progress.md`. Status: **preliminary** — both UXD lanes must verify independently before treating any of this as fact.

## Incident

A manual discovery run (`run_c2a4d7b5…`, variation `2f33e64c0b699a38`, worker PID 44127 on `:8644`, gfx-integration worktree) showed `Running / Live` in the dashboard with **zero visible change for 8m39s** (15:56:31 → 16:05:10 CT). Dashboard polled `GET /runs/:id` every ~2s; status stayed `phase=scout, sequence=2`, `sources=[]`, `updatedAt` frozen at start.

## Finding: not stuck, just silent

The run completed normally: `partial`, 3 companies (Scale AI, Figma, Notion), 39 board detections, **539 listings seen → 9 leads appended**, DiscoveryRuns history row written. Terminal `stageOrder` proves where the time went:

- `scout` 20:56:31Z → `score` 21:05:03Z (**8m32s in scout**)
- `score` → `exploit` 18ms → `learn`/write 7s → `completed`

Process forensics during the "freeze": CPU ~0–3%, event loop healthy in `kevent` (`sample(1)`), outbound HTTPS churning (ATS APIs → Gemini → serpapi.com), zero error lines. The worker was grinding through the ATS scout loop, not wedged.

## Suspected root causes (lanes verify)

1. **BE: one checkpoint for the whole scout.** `run-discovery.ts` emits `nextStage("scout")` at loop entry (~line 705), then nothing until `score`. No per-company checkpoint, no per-N-listings progress, no success-path logs. 539 listings × sequential normalize + optional Gemini match (30s cap each) = minutes of radio silence. Per-lane 60s timeouts bound *stalls* but emit no *progress*.
2. **BE: SerpApi section same shape.** 5 queries ran in ~8s (fine), but the per-listing normalize gaps after it (12–26s between log lines) were equally unexplained in-band.
3. **FE: nothing to render even if BE talked.** Runs/drawer UI renders coarse fields (status, duration, companies, updated) and has no phase/progress/counter rendering, no per-source lanes, no honest "worker alive but quiet" vs "stalled" distinction. "Live" + frozen timestamp reads as broken.
4. **Contract gap.** `DiscoveryRunProgress` (`phase/sequence/checkpointedAt/budget`) exists but is too coarse: no listing counters, no per-company/per-source breakdown, no matcher-queue depth. FE and BE never agreed on a live-progress shape.

## Evidence pointers (all verified 2026-09-26 ~16:00 CT)

- Worker log: `/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/4307f7f5-795c-4642-aeca-584c929df011/scratchpad/qa-home.sOcM/.jobbored/browser-use-discovery/logs/worker.log`
- Full run-event timeline reconstructed from that log (8.5 min gap between `config_resolved` and first `serpapi_*` event).
- `GET /runs/run_c2a4d7b5ee5e9d17507c3b46a4f39b7d` terminal payload (stageOrder, loopCounters, sourceSummary).
- Code: `integrations/browser-use-discovery/src/run/run-discovery.ts` (ATS loop ~701–862, normalize loop ~824–847, SerpApi ~988–1085, checkpoints at 352/465/920/1336), `src/run/run-abort.ts` (timeouts verified sound), `src/run/run-progress.ts`, `src/webhook/handle-discovery-webhook.ts` (checkpoint callback ~229–246), `src/sources/serpapi-google-jobs.ts` (20s per-query timeout verified).

## Proposed direction (lanes own the real recs)

- **UXD-BE (sol · high):** instrument the run — per-company scout checkpoints + structured logs, throttled per-N-listings progress (counts, matcher calls, elapsed), SerpApi per-query checkpoints, fill any phase-checkpoint gaps; extend the progress payload **additively** (contract invariant applies if the shape changes).
- **UXD-FE (opus · medium + /frontend-design):** render live progress elegantly and minimally on-theme (jb-v2 tokens): phase indicator, honest elapsed/heartbeat, counters, per-source or per-company mini-progress per the agreed contract; degrade gracefully when fields are absent (older workers, relay paths).
- **Both:** Phase 0 independent investigation + own recs → Phase 1 align via cmux on one shared progress contract (identical block in both reports, strict gate) → Phase 2 implement.

## Open questions for the lanes

- Checkpoint write cost to the run-status store at high frequency — throttle by count AND time; measure, don't guess.
- Relay/Apps Script/Sheets paths that can't proxy live progress — FE must degrade, never spin forever.
- DiscoveryRuns sheet stays terminal-write-only (no live row updates) — confirm, don't expand scope.
- The existing `budget.remainingMs` may already give FE a time-budget signal — check before adding fields.

## Handoff

Kickoffs: `KICKOFF-GFX-UXD-FE.md`, `KICKOFF-GFX-UXD-BE.md`. Base: `feat/gfx-integration` at `dd45a692`. Do not touch the live QA-LIVE (Astra) lane, its ports, or its isolated HOME.
