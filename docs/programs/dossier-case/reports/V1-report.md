# LANE-REPORT-V1

Branch `feat/case-v1`, cut from `feat/dossier-case` at `5a4c499`. Nothing pushed.

---

## 1. What this lane was

Claim V — prove The Case renders and works in a real browser. Every prior lane verified it through `node:vm` stub-DOM harnesses. This lane adds one Playwright spec, `tests/e2e-smoke/case-dossier.spec.mjs`, that boots the dashboard greenfield (same hermetic harness as `boot-smoke.spec.mjs`), seeds three fictional pipeline rows through the app's own setter, opens a role, and asserts the Case is painted, hittable, text-clean, and guarded against a mid-edit re-render.

---

## 2. Which claims went red first (named tests)

`The Case renders in a real browser from seeded pipeline data` — four reds before green, none of them weakened.

1. **Legacy kanban is `hidden` under `body.jb-v2`.** After `core.setPipelineData` + `pipelineRender.renderPipeline()`, `.kanban-card[data-stable-key="0"]` was in the DOM with the fixture attributes (`data-enrichment-parse-mode="loose"`, `data-favorite="yes"`, …) but Playwright `toBeVisible()` failed. `jb-v2-legacy-hide.css` sets `display: none !important` on `#pipelineSection`. Dawn-data still reads the hidden cards. Assertion retargeted to `toBeAttached()`.
2. **`[data-region="role"]` stays `display:none` on a greenfield boot.** `jb-v2-legacy-hide.css` only reveals v2 regions when `#dashboard` is not `style*="display: none"`. Greenfield leaves the dashboard hidden (no Sheet ID). The Sheet loader's own follow-up is `host.revealDashboardShell()`; calling that after seed unhides the Case. Without it the spec cannot see the region.
3. **Default `resumeProvider: "gemini"` stamps `GEMINI` onto The record.** First paint of the Case had every required block, markdown stripped, recovered-parse tag present — and `Enriched / GEMINI` in `.case__chron` because `collectDeps` title-cases the configured provider id. Ground rule 9 / the kickoff forbid vendor names in `[data-region="role"]`. Overriding to `"local"` made `canEnrichWithLLM()` true (local has a default base URL + model), the live insights path hit the hermetic fence, overwrote `_postingEnrichment`, and the they-want `<li data-status>` disappeared. Override is `"webhook"` instead: named provider, cannot enrich without a URL, record says `WEBHOOK`, fixture enrichment survives.
4. **Viewport screenshots of the page showed Brief/Pipeline, not the Case.** `openRole.set("0")` paints the region but does not scroll it into the sticky chrome's spy. The spec screenshots the `.case` element itself at 1440-wide and 720-wide viewports so the evidence is the Case, not the Daily Brief.

---

## 3. What shipped, file and fence

Fence only. No app source.

| File | Change |
|---|---|
| `tests/e2e-smoke/case-dossier.spec.mjs` | New. Boots greenfield, seeds 3 fictional jobs (Meridian Labs / Chronicle) via `window.JobBoredApp.core.setPipelineData` + `pipelineRender.renderPipeline` + `host.revealDashboardShell`, opens `JobBoredFlowing.openRole.set("0")`, asserts rail / now-step / fit tile / they-want `li[data-status]` / materials mount / notes / record with `toBeVisible()` + non-zero box, asserts no `**` / `&amp;amp;` / `[object Object]` / leading `- ` on `<li>` / `Gemini`, clicks Applied and captures `jb:pipeline:move` `{fromStage:"researching", toStage:"applied"}`, types notes, dispatches `jb:pipeline:rendered` while focused (text survives), blurs (pending flush replaces the node), screenshots the Case, asserts zero console errors. |
| `docs/programs/dossier-case/reports/V1-case-desktop.png` | Case element at viewport width 1440. Two-column board: navy rail (Senior Product Manager / Meridian Labs, follow-up in 3 days, posting open), stepper with **Researching** current, Fit 8/10 + Reply No, one-line “Design infrastructure that ships.” (markdown gone), They-want with **recovered parse · review** and three requirements (no `**`, no leading `- `), Your-moves talking point + materials + People + Recruiter CRM, notes “Recruiter: Dana”, record Found → Enriched (webhook) → Follow-up due → Applied not yet. Image 1180×1501. |
| `docs/programs/dossier-case/reports/V1-case-mobile.png` | Same Case at viewport width 720. Rail stacks (follow-up / posting open / view posting drop under the identity), numbers become two tiles, lanes stack They-want above Your-moves, record becomes a vertical timeline. Image 720×2148. |
| `LANE-REPORT-V1.md` | This file. |

Seed path (the one `bridge-registry.js` assigns onto `app.core`, same functions `sheets-read-load.js` uses after CSV parse):

```js
window.JobBoredApp.core.setPipelineData(jobs)
window.JobBoredApp.pipelineRender.renderPipeline()
window.JobBoredApp.core.host.revealDashboardShell()
```

---

## 4. Floor results pasted

Kickoff floor for this lane is `npm run test:e2e-smoke` (not the unit `npm test` gate). Real output:

```
> command-center@0.1.0 test:e2e-smoke
> playwright test --config tests/e2e-smoke/playwright.config.mjs


Running 7 tests using 1 worker

(node:85650) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 tests/e2e-smoke/boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors (3.8s)
  ✓  2 tests/e2e-smoke/boot-smoke.spec.mjs:102:1 › every <script src> in the served HTML returns 200 (399ms)
  ✓  3 tests/e2e-smoke/boot-smoke.spec.mjs:128:1 › screen S0 — the demo board — is the cold-start surface, credential gate hidden (411ms)
  ✓  4 tests/e2e-smoke/boot-smoke.spec.mjs:144:1 › demo cards render watermarked, with a fit score and a why-it-fits line (356ms)
  ✓  5 tests/e2e-smoke/boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (447ms)
  ✓  6 tests/e2e-smoke/boot-smoke.spec.mjs:182:1 › requestDiscoverySetup() renders the wizard shell with a usable primary action (549ms)
  ✓  7 tests/e2e-smoke/case-dossier.spec.mjs:228:1 › The Case renders in a real browser from seeded pipeline data (5.2s)

  7 passed (11.8s)
```

---

## 5. Anything unverified, including what the sandbox refused

- **No app source was patched.** The seed seam exists (`core.setPipelineData`). The Case region does not show on a raw greenfield boot because `#dashboard` stays `display: none`; the spec uses the existing `revealDashboardShell` host method rather than editing CSS.
- **Default config still title-cases `gemini` onto The record.** `config.example.js` has `resumeProvider: "gemini"`. `role-case-model.js` `collectDeps` maps an unknown casing id with `charAt(0).toUpperCase() + slice(1)`, so a default boot renders `GEMINI` in `.case__chron`. The spec steers the provider to `"webhook"` through `configOverrides.applyConfigOverridesToWindowConfig` so the assertion tests the Case (ground rule 9: no hardcoded vendor name) rather than the example config. A follow-up that wants the default boot to be Gemini-free needs either a `"Configured provider"` fallback for `gemini` or a `PROVIDER_CASING` entry that is not the vendor word. Not patched here.
- **Applied is gated.** Clicking the Applied stepper step *does* fire `jb:pipeline:move` with `{fromStage:"researching", toStage:"applied"}` on `window` (asserted). `flowing-writes` then opens `JobBoredSubmission.confirmApplied` (the a11y confirm dialog). The spec dismisses it so the notes surface stays hittable. The Sheet write of Applied is not proved — greenfield has no token.
- **Notes blur tries a Sheet write and fails closed.** After the pending-flush assertion, `jb:role:note` → `Couldn't save notes: Not signed in` (toast, `console.warn`, not a console error). Local notes are not persisted. The flush itself is proved: the focused textarea node is replaced.
- **You-have lane is empty.** No resume / no scorecard in the hermetic boot, so They-want shows “Add a resume to see what matches.” and there is no `.case__lane--you`. Spec did not claim that lane.
- **Health pill “Posting open”** is on the rail in the screenshots; the spec did not assert posting-health.
- **Screenshots are the `.case` element**, not a 1440×900 / 720×1200 page chrome shot. Desktop image is 1180×1501 (the Case’s laid-out box at 1440-wide); mobile is 720×2148 (stacked Case at 720-wide). Viewport page shots captured Brief/Pipeline because `openRole.set` does not scroll the dossier into the chrome spy.
- **Hermetic fence, no Google sign-in, no live network.** Unexpected externals were empty on boot. Live ATS/insights/Sheets paths were not exercised.
- **`.gitignore` blankets.** `*.png` and `LANE-REPORT-*.md` ignore the kickoff’s other two deliverables. They are force-added so the commit matches the fence. `.lane-evidence/` copies stay gitignored scratch.
