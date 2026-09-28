# KICKOFF — lane `progress-ui` (wave 2; branches from the green wave-1 integration commit)

Read `GROUND-RULES.md` and `BATCHSCORE-SPEC.md` §1 (F3), §3 item 1, and §4.3 first. Create `LANE-REPORT-progress-ui.md` before anything else.

## Mission
While a discovery run is scoring, the dashboard's run status line reads "Scoring 14 / 40 · Figma" from the status row's `progress.scoring` block, and shows nothing extra when that block is absent.

## Fence (you own exactly these)
- `discovery-run-tracker.js`
- `discovery-status-handoff.js`
- Dashboard tests under the repo-root `tests/` for those two modules (find the existing harness that covers them and extend it; if none covers them, add one in the same style as the nearest sibling and name it in the report).
- One CSS rule at most, in whichever stylesheet already styles the run status line, only if the text cannot be rendered with existing classes.

## Consumes
- The `progress.scoring` shape from `BATCHSCORE-SPEC.md` §4.3, emitted by the `funnel` lane (runs in parallel; code to the spec, fixture the shape in tests). Fields: `company`, `scored`, `total`, `capturedAt`.
- The base branch already carries `feat/discovery-hardening`'s edits to both files. Read them in full before editing; extend the status line they already build.

## Non-negotiables
- Render exactly `Scoring <scored> / <total> · <company>`; omit the company segment when `company` is empty. Hidden when `scoring` is absent or `total` is 0. Never throw on a malformed block (non-numeric fields render nothing).
- The line updates on every poll that changes `scored` and does not flicker when only `capturedAt` changes.
- No change to how the tracker decides a run is live, terminal, or stale; hardening owns those semantics and they are on your base.
- Red-first tests, named for behavior: renders the line from a fixture status row; hides it when `scoring` is absent; hides it when `total` is 0; tolerates a malformed block; the existing status text for a run without scoring progress is unchanged (snapshot on the base commit, asserted unchanged).

## Definition of Done
1. Report section 2 shows every test above red, then green.
2. Floor pasted into report section 4 (the worker suites are required even though you did not touch the worker — the same PR carries both):
   ```
   npm run typecheck:browser-use-discovery
   npm run test:browser-use-discovery
   npm run test:contract:all
   npm run lint:repo
   npm test
   ```
3. Commit locally (`feat(dashboard): show scoring progress while discovery runs`), never push. Keep scratch in `.lane-evidence/`. Delete nothing.
