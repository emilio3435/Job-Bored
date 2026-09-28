# EDITOR: Scribe v2 execution plan

- **Spec:** `SPEC.md`. It is authoritative; §n below refers to it.
- **Mockup:** `mockup/index.html`.
- **Base:** main `98903e29`.
- **Integration branch:** `feat/editor-integration`.
- **Lane branches:** `feat/editor-<lane>`, one worktree each under `~/Job-Bored.worktrees/editor-<lane>`. Each worktree gets a `server/node_modules` symlink.
- **Nothing here launches until Emilio answers SPEC §0.** The plan assumes the recommended option for every decision.

## Routing

| Role | Family · effort | Notes |
|---|---|---|
| Orchestrator | opus · medium | Integrates and commits lanes that cannot commit themselves |
| FE lanes | opus · medium | Each loads `/frontend-design` and reads `mockup/index.html` first |
| BE lanes | sol · xhigh | Kickoff carries a rescue-commit step. Codex worktree sandboxes cannot take `index.lock` or bind loopback |
| Verify | muse · max | Runs every lane's floor. `--disable-write` |
| Diff review | grok · xhigh | Reviews every lane before merge |

- The family that wrote a lane never verifies it.
- No lane binds :8080, :8644 or :3847. e2e configs use their own ports, and the hermetic harness must stub `/__proxy/*` and `/profile/*` (`installHostIsolation`).

## Lanes and fences

Every lane owns only the files listed for it, plus new test files under the names given. A file outside its fence means stop and ask the orchestrator.

| Lane | Family | Owns (fence) | Depends on |
|---|---|---|---|
| **C0 Contract** | sol | `schemas/materials-edit-op.v1.schema.json` (new); `schemas/materials-run.v1.schema.json` (add `edit`, `manual`, `restore` sources, and the `edit` and `restoredFrom` fields); `scripts/test-materials-contract.mjs`; `server/materials-nodes.mjs` (new, pure: node ids, locked spans, `applyOps`); `docs/programs/editor-20260927/fixtures/*.json` (sample model, ledger, ops, SSE transcript) | none |
| **P0 CSP probe** | opus | `tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs` (new) | C0 fixture model |
| **B1 Edit engine** | sol | `server/materials-edit.mjs` (new: `proposeEdits`, facts check, loss and summary); `server/prompts/materials-edit.v1.md` or wherever the writer prompts live (confirm first); `server/materials-regenerate.mjs` (extract `commitModelAsRun`); `server/materials-package.mjs` (`buildRunRecord` edit fields only) | C0 |
| **B2 Routes + SSE** | sol | `server/index.mjs`, only the new `/versions*`, `/preview`, `/edits*` blocks, inserted after the `regenerate` route; `server/materials-versions.mjs` (new: list, star sidecar, restore); `tests/integration/materials-edit-api.test.mjs` | B1 |
| **T1 Templates** | sol | `templates/materials/{signal,dossier,editorial}/{resume,cover-letter}.html`: add `data-node` only; `server/materials-render.mjs` `buildView`: emit node ids | C0 |
| **F1 Desk shell** | opus | `scribe-v2.js`, `scribe-v2.css`, `scribe-v2-api.js` (new); `role-materials.js` (Edit button → mount `<jb-scribe>`; delete `editInScribe` and `htmlToText` consumers); `index.html` (remove the region, swap script and link tags); `jb-v2-legacy-hide.css` (drop the scribe selector); `jb-v2-boot-contract.js` (scribe entries) | C0 fixtures (stub API until B2) |
| **F2 Review + diff** | opus | `scribe-v2-diff.js`, `vendor/fast-myers-diff/` (new); the proposal, marks and keyboard sections of `scribe-v2.js`, coordinated by a region comment with F1 (F1 lands first; F2 rebases) | F1, T1 |
| **F3 Versions + compare** | opus | `scribe-v2-versions.js` (new); compare-pane CSS in `scribe-v2.css` under the `.scribe__compare` block only | F1 |
| **Q1 Browser specs** | opus | `tests/e2e-journey/scribe-edit-journey.spec.mjs`, `tests/e2e-visual/scribe-v2.spec.mjs`, plus hermetic worker stubs for the new routes in the harness | F2, F3, B2 |
| **X1 Delete** | opus | Every file in §Delete | F1 merged |

**Order:**
1. C0.
2. P0, T1 and B1 in parallel.
3. B2 and F1 in parallel (F1 runs against C0 fixtures).
4. F2 and F3 in parallel.
5. Q1.
6. X1.
7. Integration floor.

At most 2 opus lanes run at once.

## Floor

Every lane pastes this output. Muse re-runs it.

```
npm run lint:repo                 # eslint + skills + lint:tokens (no new literals)
npm run typecheck:repo            # includes typecheck:server; add node --check for new root JS
HOME=$(mktemp -d) npm test        # full run-tests.mjs incl. tests/integration/ — not node --test tests/*.test.mjs
npm run test:contract:all         # C0, B1, B2, T1
npm run test:e2e-smoke            # P0, F1+
npm run test:e2e-onboarding       # every FE lane: R1 regression
npm run test:e2e-journey          # F1+
npm run test:e2e-visual           # T1 (templates must be pixel-identical), F1–F3, Q1
```

- `HOME` is isolated so that tests never touch `~/.jobbored`.
- A lane that skips a suite says so and names the reason. "Tests pass" means every suite in its row ran.

## Delete (X1)

**Remove only after `grep` shows no other consumer:**
- the Scribe region at `index.html:465-481`, and its `<link>` and `<script>` tags;
- `scribe.js`, `scribe-state.js` and `scribe.css`;
- `SCRIBE.md`, which has drifted;
- the `HTMLElement.prototype.click` monkey-patch at `scribe.js:125`;
- the `[data-region="scribe"]` rule in `jb-v2-legacy-hide.css:80-86`;
- `editInScribe` and the openDocument/closeDocument remount in `role-materials.js`;
- the audit-log `href="#"`;
- the scribe block in `jb-v2-boot-contract.js`, `eslint.config.mjs` and `package.json typecheck:repo`, where the `node --check` entries change to the v2 files.

**Keep:**
- `scribe-score-adapter.js`, rebound by slug.
- `resume-generation.js` and `user-content-store.js`. `app-compat.js` and the legacy modal still read them [C]. Retiring the legacy modal is its own program.

**Tests:** retire `tests/scribe*.test.mjs`, `ux01-e-scribe.test.mjs` and `tests/fixtures/scribe/`. First, port any assertion that still describes v2 behaviour (save truth, `jb:draft:saved`, keyword coverage). Then rewrite the parts of `draft-generation-stability`, `data-integrity-resume-and-saves` and `materials-preview-fold` that assert the old Scribe DOM. Each deleted test is listed in the lane report with its reason.

## Risks

| Risk | Mitigation |
|---|---|
| srcdoc is blocked, or its fonts fail, under the real CSP [U] | P0 gates every FE lane. On failure, stop and take §0-4(b) to Emilio |
| `callJsonStage` returns ops that violate the shape limits (bullets 2–4, statement 20–55 words) | Validate each op, emit `blocked`, and never apply a partial invalid model. Cover it in `materials-edit-apply` unit tests |
| One edit takes a long LLM call with no token stream, so the UI feels stuck | Honest stage events around the call, Stop, and a 90 s stall line that reuses the drafter copy style |
| A PDF re-render needs Chromium on every accept, which is slow | Accept writes the HTML and model first and returns `pdf:"stale"`. The PDF renders in the background, and the version row flips to `Matches PDF` |
| `data-node` shifts template pixels | T1 floor runs `test:e2e-visual materials-templates` with zero diff |
| `server/index.mjs` is a shared hot file | B2 is its only writer in this program. Other lanes add modules, never routes |
| Parallel sessions touching materials | Sweep `gh pr list` and cmux workspaces before fencing (memory: check open PRs) |
| Deleting the old Scribe breaks the onboarding or boot contract | X1 runs last, and its floor includes `test:e2e-onboarding` and boot-contract tests |
| The Codex lane can't commit in its worktree | Rescue commit by the orchestrator, whose kickoff names the exact `git -C` commands |
