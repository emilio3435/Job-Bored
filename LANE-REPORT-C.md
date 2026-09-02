# LANE-REPORT-C

Branch `feat/casefu-c`, cut from `feat/dossier-case-followups` at `811384d`. Nothing pushed.

---

## 1. What this lane was

Claim C — prove The Case's People controls reach Google Sheets at the wire, in a real browser. `tests/role-writeback-bridge.test.mjs` already proves `jb:role:writeback` for `contact` / `heardBack` / `reply` / `followupAt` with a mocked `fetch`. Nobody had proved that the actual People inputs, clicked and typed in Chromium, produce those `values` requests. This lane adds one Playwright spec and a 60-second live Sheet script. No app source.

---

## 2. Which claims went red first (named tests)

`the Case People controls write contact, last contact, reply, and follow-up to the Sheet` — green on first run. Nothing went red.

That is the right outcome for a verification lane: the Case People block already commits `followupAt` on `change`, `reply` on click of `[data-field="reply"]`, and `heardBack` / `contact` on blur; `flowing-writes.js` already maps those four fields to Pipeline!P / S / R / L. The spec is the missing browser proof, not a new write path.

Staging notes that would have gone red (and did not, because they were handled in the spec, not by patching the app):

1. **Greenfield blanks the token.** `?greenfield=1` wipes `command_center_oauth_session` and masks `oauthClientId` to `""`. `auth-session.js` `restoreOAuthSession` then no-ops (`host().getOAuthClientId()` is null). `flowing-writes.js` line 162 reads the in-memory getter `window.JobBored.getAccessToken()` → `JobBoredApp.auth.getAccessToken`. The spec boots greenfield first, then stages the headless-recipe storage **and** `auth.setAccessToken("fake")` plus `core.setSHEET_ID`. Storage alone after boot is not enough.
2. **Seeded jobKey `"1"` is not a sheet row.** `getSheetRow` needs `_rawIndex`; `toSheetRowNumber("1")` rejects values `< 2`. First write therefore GETs `Pipeline!E:E` (trap 4 URL cache) before the PUT. The spec fulfills that GET with the three fixture links and asserts **letter + value on PUT/POST only**, never the row number, never the GET.

---

## 3. What shipped, file and fence

Fence only. No app source.

| File | Change |
|---|---|
| `tests/e2e-journey/case-people-writeback.spec.mjs` | New. Boots greenfield with the console-error collector and the journey hermetic fence; overlays `page.route("https://sheets.googleapis.com/**")` to record `{ method, url, body }`. Stages fake OAuth (`localStorage.command_center_oauth_session` + `sessionStorage.command_center_oauth_runtime` + in-memory token + `SHEET_ID`); stubs `showSheetAccessGate` on every `JobBoredApp.*` module that has it. Seeds three fictional jobs via `core.setPipelineData` + `pipelineRender.renderPipeline` + `host.revealDashboardShell`, opens role `"1"`. In People: follow-up `2026-09-10` + `change` → Pipeline!P; click `[data-field="reply"][data-value="Yes"]` → S `Yes`; type last contact `2026-09-01` + blur → R; type contact `Dana Reyes` + blur → L. Asserts each PUT/POST body `[[ value ]]`, no People write to any other column, `unexpectedExternal` empty, zero console errors, no `"Not signed in"` warn. |
| `docs/programs/dossier-case-followups/LIVE-CHECK.md` | New. 60-second copy-paste script: pick a real role, four edits in spec order, four cells (P/S/R/L), failure toast copy from `flowing-writes.js`. |
| `LANE-REPORT-C.md` | This file. |

People selectors are the frozen contract (`[data-field="followupAt"]`, `[data-field="reply"][data-value="Yes"]`, `[data-field="heardBack"]`, `[data-field="contact"]`) so the spec holds whether the replied control is today's toggle or lane A's segmented chips.

---

## 4. Floor results pasted

Kickoff floor for this lane is `npm run test:e2e-journey` (including the new spec) and `npm run test:e2e-smoke` still green.

```
> command-center@0.1.0 test:e2e-journey
> playwright test --config tests/e2e-journey/playwright.config.mjs


Running 13 tests using 1 worker

(node:2889) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓   1 tests/e2e-journey/case-people-writeback.spec.mjs:353:1 › the Case People controls write contact, last contact, reply, and follow-up to the Sheet (5.3s)
  ✓   2 tests/e2e-journey/critical-journey.spec.mjs:134:1 › should open a zero-config visit on the demo board, not a credential ask (388ms)
  ✓   3 tests/e2e-journey/critical-journey.spec.mjs:170:1 › should collapse the invitation to a corner pill that still opens the flow (500ms)
  ✓   4 tests/e2e-journey/critical-journey.spec.mjs:198:1 › should enter the one shell at beat 1 with the six-beat spine when the visitor accepts (482ms)
  ✓   5 tests/e2e-journey/critical-journey.spec.mjs:240:1 › should treat closing the flow as pausing — Esc returns to the board and re-entry resumes the saved beat (795ms)
  ✓   6 tests/e2e-journey/critical-journey.spec.mjs:291:1 › should never show the one-flow to a user who already finished setup (707ms)
  ✓   7 tests/e2e-journey/critical-journey.spec.mjs:306:1 › should show queued, running, and partial discovery outcomes (1.9s)
  ✓   8 tests/e2e-journey/critical-journey.spec.mjs:359:1 › should carry completed discovery into the pipeline and ready dossier materials (8.2s)
  ✓   9 tests/e2e-journey/critical-journey.spec.mjs:454:1 › should give beat 3's template grid a way back, with the pasted draft intact (1.3s)
  ✓  10 tests/e2e-journey/critical-journey.spec.mjs:503:1 › should spend the greenfield param once, so a mid-setup refresh resumes instead of resetting (716ms)
  ✓  11 tests/e2e-journey/critical-journey.spec.mjs:540:1 › should say on screen that closing the flow paused it (566ms)
  ✓  12 tests/e2e-journey/critical-journey.spec.mjs:577:1 › should pause to a live corner pill for a visitor who poked around first (554ms)
  ✓  13 tests/e2e-journey/critical-journey.spec.mjs:614:1 › should serve the dashboard's own /profile from the local API, never a static 404 (300ms)

  13 passed (22.2s)
```

```
> command-center@0.1.0 test:e2e-smoke
> playwright test --config tests/e2e-smoke/playwright.config.mjs


Running 7 tests using 1 worker

(node:2888) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 tests/e2e-smoke/boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors (3.5s)
  ✓  2 tests/e2e-smoke/boot-smoke.spec.mjs:102:1 › every <script src> in the served HTML returns 200 (343ms)
  ✓  3 tests/e2e-smoke/boot-smoke.spec.mjs:128:1 › screen S0 — the demo board — is the cold-start surface, credential gate hidden (344ms)
  ✓  4 tests/e2e-smoke/boot-smoke.spec.mjs:144:1 › demo cards render watermarked, with a fit score and a why-it-fits line (366ms)
  ✓  5 tests/e2e-smoke/boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (400ms)
  ✓  6 tests/e2e-smoke/boot-smoke.spec.mjs:182:1 › requestDiscoverySetup() renders the wizard shell with a usable primary action (461ms)
  ✓  7 tests/e2e-smoke/case-dossier.spec.mjs:227:1 › The Case renders in a real browser from seeded pipeline data (5.2s)

  7 passed (11.3s)
```

---

## 5. Anything unverified, including what the sandbox refused

- **No app source was patched.** Token staging uses existing seams: `JobBoredApp.auth.setAccessToken`, `JobBoredApp.core.setSHEET_ID`, `configOverrides.applyConfigOverridesToWindowConfig`, `showSheetAccessGate` stubbed on the modules that already export it.
- **Keys `auth-session.js` reads for the token.** Restore: `sessionStorage["command_center_oauth_runtime"]` must contain `{ accessToken, expiresAt, oauthClientId, hasOauthSession: true }` and `oauthClientId` must equal `host().getOAuthClientId()` (placeholder `YOUR_CLIENT_ID_HERE.apps.googleusercontent.com` counts as missing). `localStorage["command_center_oauth_session"]` is the identity marker and does **not** hold the bearer token. After a greenfield boot, restore has already run and missed; the getter flowing-writes uses is the in-memory `accessToken`. Staging writes both stores (kickoff recipe) and then `setAccessToken("fake")`.
- **Row number is not asserted.** Seeded jobs have no `_rawIndex` / `data-sheet-row`. JobKey `"1"` cannot use the numeric fallback (`toSheetRowNumber` requires `>= 2`). The first People write GETs `Pipeline!E:E` to build the URL cache (trap 4), then PUTs to whatever row that cache returns. The spec asserts column letter + body value on PUT/POST only.
- **Hermetic fence, no live Google.** `unexpectedExternal` was empty. Emilio's real Sheet is the remaining proof — `docs/programs/dossier-case-followups/LIVE-CHECK.md`.
- **Lane A's segmented replied control is not in this worktree.** The spec targets `[data-field="reply"][data-value="Yes"]`, which matches today's toggle (fixture `responseFlag: "No"`, so the button offers Yes) and lane A's Yes chip.
- **Commit succeeded locally.** Nothing pushed. `LANE-REPORT-*.md` is gitignored; this file is force-added to match the fence (same as V1).
