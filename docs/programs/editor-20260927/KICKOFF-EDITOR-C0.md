# Lane C0: the Scribe v2 edit contract

Read these first. Their rules bind you:
- `/Users/emilionunezgarcia/Job-Bored/docs/programs/cdesk-20260927/KICKOFF-CDESK-_SHARED.md` (shared ground rules)
- this folder's `SPEC.md`, with §0 locked, §3 in full, and §8
- `PLAN.md`, the "Lanes and fences" row for C0

The spec is authoritative. Family: sol · xhigh. Worktree: `~/Job-Bored.worktrees/editor-c0`. Branch: `feat/editor-c0`, based on main `98903e29`.

**Goal:** land the contract every other Scribe v2 lane builds on, alone and first. Build it once, correctly: node ids, the edit-op schema, a pure `applyOps`, run-record fields, and fixtures.

**Fence (PLAN C0):**
- `schemas/materials-edit-op.v1.schema.json` (new)
- `schemas/materials-run.v1.schema.json`
  - Add the `edit`, `manual` and `restore` sources and the `edit` and `restoredFrom` fields.
  - Keep the changes strictly additive: another session's lane `materials-w1-reliability` is also editing this schema. Name that overlap in report §5.
- `scripts/test-materials-contract.mjs`
- `server/materials-nodes.mjs` (new and pure)
  - Node-id derivation from `materials.render-model.v1`, stable across runs, per SPEC §3.
  - `lockedSpans(model)`.
  - `applyOps(model, ops, {scope})`. It rejects out-of-scope ops, ops on locked spans, and shape-limit violations. It never returns a partially applied invalid model.
- The browser twin named in SPEC §3.5, if the spec places it in C0; otherwise leave it to F1 and say so.
- `docs/programs/editor-20260927/fixtures/*.json`: a sample model, a ledger, ops (valid, locked, out of scope, over the shape limit) and an SSE transcript.
- Unit tests: `tests/materials-nodes*.test.mjs`.

Do not touch `server/index.mjs`, templates, `materials-render.mjs` or any client file.

**Success means:**
1. The schema validates every fixture op, and the contract script includes both schemas.
2. The `applyOps` unit tests cover:
   - replace, insert and remove;
   - a locked-span refusal;
   - an out-of-scope refusal;
   - a shape-limit refusal (bullets 2–4, statement 20–55 words, per PLAN Risks);
   - idempotent ids across two runs of the same model;
   - no input mutation.
3. `npm run test:contract:all` and the full shared floor are green, with the output pasted.
4. The report's first line reads `DONE`, and §3 lists the exported API (names and signatures) so the P0, B1, T1 and F1 lanes can build against it.

**Codex sandbox notes:**
- You may be unable to bind loopback or reach the npm registry. Run what you can, and list what the sandbox refused in §5.
- If `git commit` fails on `index.lock`, leave the work staged, write `DONE (uncommitted — sandbox)` and stop. The orchestrator commits it.

**Stop when:** done or blocked.
