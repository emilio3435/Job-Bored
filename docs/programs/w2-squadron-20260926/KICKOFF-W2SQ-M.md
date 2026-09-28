# W2SQ lane M: Materials and profile

Read `.lane-evidence/KICKOFF-W2SQ-_SHARED.md` first. It is binding.

## Outcome
Goal: close BEAUDIT wave-2 lane **M** (Materials and profile) register claims in this worktree (`feat/w2sq-M`), each proven by a test that went red first.
Success means: every claim below is either fixed with a named red-then-green test, or deferred with a written reason. The floor is green. Commits are local.
Stop when: the report's first line reads `DONE`, or you are blocked twice on the same thing (`BLOCKED: <why>`).

## Claims (read each row in `.lane-evidence/ref/REGISTER.md`)
F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F14, F16, F17, F18, F20, E13, F19, F21

Locked decisions that apply: §0.3, §0.2 (see `.lane-evidence/ref/SPEC-BEAUDIT-20260925.md` §0).

## Fence (you own these; stay inside)
- server/materials-*.mjs
- server/application-materials.mjs
- server/profile-*.mjs
- server/user-profile.mjs
- server/legacy-profile-migrator.mjs
- server/brand-logos.mjs
- server/index.mjs (/profile* and /api/applications/* routes only)
- integrations/hermes-job-hunt/resume-template/**, cover-letter-template/**, scripts/materials_watcher/**, scripts/materials_request.py, scripts/materials-request.sh, scripts/logo_resolver.py
- integrations/browser-use-discovery/src/profile/**, src/contracts/user-profile.*
- schemas/materials-*.v1.schema.json (from #120)
- tests for these claims

## Probes to promote into tests (under `.lane-evidence/ref/probes-*`)
- F/F-materials-e2e.sh
- F/F-profile-critic.mjs
- F/F-rescore-overlap.mjs

## Notes from the audit plan
Build PR #120 claim-ledger design (§0.3): the master comes from the user resume and profile, 3 narrow calls, a cache key; neutral example templates (§0.2); template and logo roots under ~/.jobbored, never the repo (F7); rescore single-flight with a generation id and RAW or escaped writes (F4, F5).

## Additions to M (orchestrator, from #126 and D8)
- #126 already shipped the template registry, renderer and fit (slices 3 and 3b). **Consume it; do not rebuild it.** Your pipeline produces a real `materials.render-model.v1` and **replaces the INPUT of `server/materials-render-model-adapter.mjs`**: the claim ledger from the user's resume and profile, three narrow schema-bound calls (extract, select-by-ID, draft), the conditional delint pass, the cache key including `<family>@<version>`, and run.json stages. Follow `docs/superpowers/plans/2026-09-17-materials-v3.md` for the slices other than 3, 3b and 7, and the mechanism spec `docs/superpowers/specs/2026-09-17-materials-v3-mechanism-design.md`. Reuse `server/materials-delint.mjs`, `materials-fit-budget.mjs` and the `schemas/materials-*.v1.schema.json` files that are already merged.
- **Slice 8 is yours:** remove `JOBBORED_MATERIALS_LEGACY_RENDER`, `server/materials-composer.mjs` if nothing else uses it, `tests/materials-composer.test.mjs`, and the fixed Georgia layout in `server/materials-candidate-docs.mjs` once the registry path fully replaces it. Update the tests that pin those files on purpose.
- **Identity leftovers from D8** (register H8/F18, template part): the Hermes `resume-template/` and `cover-letter-template/` must hold no owner identity (use neutral example values; real values come from gitignored files per §0.2), and `scripts/materials_watcher/notifier.py` must not hardcode Telegram chat or thread IDs (read them from env or config, with a neutral example). Add a guard test.
- Do NOT touch `templates/materials/**`, `server/materials-templates.mjs`, `server/materials-render.mjs` or `materials-fit.mjs` except to call them. `server/brand-logos.mjs` is in your fence; keep #126's `~/.jobbored/logos` root behaviour.

## Floor
Run the shared floor. Your report's section 4 must paste the tails of `npm run lint:repo`, `npm run typecheck:repo` and `npm test`, plus the worker suite and the e2e suites your claims touched.
