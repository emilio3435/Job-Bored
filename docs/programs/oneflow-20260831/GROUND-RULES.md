# ONEFLOW ground rules — every lane reads this first

Mission context: `docs/ONE-FLOW-ONBOARDING-SPEC.md` (v2, approved — copy strings in §4/§5 are NORMATIVE, ship them verbatim) + `docs/programs/oneflow-20260831/SUBSTRATE.md` (architecture + your fence). Your kickoff names your lane. The spec's §11 locked decisions and SUBSTRATE's locked decisions override anything else you infer.

## First action, before any code

Create `LANE-REPORT-<lane>.md` in your worktree root with five headings, each marked `PENDING`, and fill them in as work lands:
1. What this lane was
2. Which claims went red first (named tests)
3. What shipped, file-and-fence
4. Floor results — PASTED output, not paraphrased
5. Anything unverified, including what the sandbox refused

A lane is not done until §4 holds real output.

## The floor (Definition of Done runs ALL of these, pasted into the report)

```bash
npm test                      # scripts/run-tests.mjs — the ONLY test gate that counts
npm run lint:repo
npm run typecheck:repo
npm run test:contract:all
```

## Work style

- TDD: write the failing probe test first, then make it pass. Tests encode WHY (spec section refs in test names).
- Work ONLY inside your fence (SUBSTRATE.md ownership map). If you need a change outside it, write the need into your report §5 and continue — the orchestrator routes it.
- Commit locally, small conventional commits (`feat(oneflow-<lane>): …`). NEVER push. Keep scratch in `.lane-evidence/`. Delete nothing outside your fence.
- Match the codebase: classic-global IIFE modules on `window`, no ESM in browser files, no `any`-style shortcuts, existing naming.
- Normative copy: quote strings from the spec exactly — punctuation included. Voice rules are spec §8.

## Traps that fail SILENTLY (these cost hours)

1. `node --test tests/foo.test.mjs` runs, passes, and SKIPS `tests/integration/` — only `npm test` is real.
2. A new browser JS file not appended to `typecheck:repo` in package.json passes typecheck while broken. L0 registered every stub; if you create an unplanned file, STOP and report instead.
3. Script load order: anything reading `window.CommandCenterUserContent` at parse time dies silently if its tag precedes user-content-store.js (this exact bug killed welcome.js). All new tags are already placed after it — keep them there.
4. `updateRuntime({message})` on the OLD shell contract renders nothing — use the L0 `setMessage`/`setBusy` APIs; raw writes are the bug we're fixing.
5. Codex sandbox: `git commit` can fail on worktree metadata outside the sandbox. If it does — DO NOT retry destructively; leave the tree dirty, write report §5 "commit refused", the integrator rescues. `gh`/network may die silently; nothing in your DoD needs network.
6. `config.js` is gitignored and holds live secrets — never read it into a commit, never create one.
7. Legacy tests pin current behavior on purpose. If your change legitimately breaks one INSIDE your fence, update it in the same commit with a message naming the spec section. A red test outside your fence = report §5, don't touch it.

## Model / vehicle

You were launched on the correct model+CLI per the worker stack. Do not spawn sub-agents; do the work in-lane.
