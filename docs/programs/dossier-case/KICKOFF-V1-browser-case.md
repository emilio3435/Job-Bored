# Kickoff · V1 browser verification (claim V) — prove The Case renders and works in a real browser

Read `docs/programs/dossier-case/GROUND-RULES.md` first. Every lane so far verified The Case through `node:vm` stub-DOM harnesses; nothing has rendered it in a real page. Your job is to add ONE durable Playwright spec that does, and to report exactly what it proves.

**Mission.** Write `tests/e2e-smoke/case-dossier.spec.mjs` (same config/idioms as `tests/e2e-smoke/boot-smoke.spec.mjs`; read it first — it already boots the app cold-start, collects console errors, and serves the page) that:

1. Boots the app greenfield (as boot-smoke does) with a console-error collector armed.
2. Seeds the pipeline with 3 fixture jobs **through the app's own path** — find how `window.JobBoredApp.core.getPipelineData()` is populated (`grep -n "pipelineData" app-config-core.js app-compat.js bridge-registry.js`) and use that setter, then `window.JobBoredApp.pipelineRender.renderPipeline()`. Fixture jobs are fictional (Meridian Labs / Chronicle) and exercise: stage `Researching`, `followUpDate` in 3 days, `responseFlag: "No"`, `priority: "⚡"`, `favorite: true`, a `_postingEnrichment` with `roleInOneLine`, `mustHaves` (one containing `**bold**` and one leading `- `), `toolsAndStack`, `talkingPoints`, `requirements`, `skills`, `scrapedAt`, and one job with `_parseMode: "loose"` so the provenance review tag has a case.
3. Opens a role with `window.JobBoredFlowing.openRole.set("0")` and asserts, with `toBeVisible()` plus a non-zero bounding box (boot-smoke's idiom): `.case__rail`, `.case__stepper .case__step--now`, `.case__numbers [data-num="fit"]`, `.case__lane--they li[data-status]`, `.case__lane--moves [data-mount="materials"]`, `.case__notes textarea`, `.case__chron .case__ev`. Asserts the rendered text contains no `**`, no `&amp;amp;`, no `[object Object]`, no `- ` glyph at the start of an `<li>`. Asserts no `Gemini` text anywhere in `[data-region="role"]`.
4. Interactions: clicks the `Applied` stepper step and asserts `jb:pipeline:move` fired with `{fromStage:"researching", toStage:"applied"}` (listen on `window` before clicking); types into the notes textarea, dispatches `jb:pipeline:rendered` on `document` while focused, and asserts the typed text survives; blurs and asserts the region re-rendered (the pending flush).
5. Screenshots the open Case at 1440×900 and at 720×1200 into `.lane-evidence/` and copies both to `docs/programs/dossier-case/reports/V1-case-desktop.png` / `V1-case-mobile.png`.
6. Asserts zero console errors for the whole run.

**Fence.** `tests/e2e-smoke/case-dossier.spec.mjs` (create), `docs/programs/dossier-case/reports/V1-*.png`, `LANE-REPORT-V1.md`. Nothing else. If the app cannot be seeded without touching source, STOP and write in §5 exactly which seam is missing — do not patch app code.

**Non-negotiables.** No real Google sign-in, no network. If a block does not render, that is a finding to report with the DOM you observed, not a test to weaken.

**Definition of Done.**
1. `npm run test:e2e-smoke` green including your spec — output pasted in `LANE-REPORT-V1.md` §4.
2. Both screenshots present and described in §3 (what you see: rail, stepper, numbers, lanes, notes, record).
3. §5 lists anything the spec could not prove.
4. One commit: `test(e2e): real-browser smoke for The Case dossier`.
