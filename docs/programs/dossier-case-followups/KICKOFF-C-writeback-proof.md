# Kickoff · C writeback-proof (Grok 4.6 high) — prove the People writebacks at the wire, in a real browser

Read `docs/programs/dossier-case-followups/GROUND-RULES.md` first (trap 3 and 4 are yours). Model your spec on `tests/e2e-smoke/case-dossier.spec.mjs` (seeding through `window.JobBoredApp.core.setPipelineData` + `pipelineRender.renderPipeline()` + `host.revealDashboardShell()`, console-error collector) and on how `tests/e2e-journey/critical-journey.spec.mjs` builds its fence (route interception, `unexpectedExternal`).

## What is already proven, and what is not
`tests/role-writeback-bridge.test.mjs` proves, with a mocked `fetch`, that `jb:role:writeback` for `contact` / `heardBack` / `reply` / `followupAt` produces a Sheets `values` request to `Pipeline!L{row}` / `R{row}` / `S{row}` / `P{row}`. What nobody has proved is that the *Case's actual controls in a real browser* produce those requests. That is this lane.

## Build `tests/e2e-journey/case-people-writeback.spec.mjs`
1. Boot greenfield with the console-error collector. Stage a fake signed-in session exactly per the headless recipe: `localStorage.command_center_oauth_session` and `sessionStorage.command_center_oauth_runtime` = `{ accessToken: "fake", expiresAt: Date.now()+3600e3, oauthClientId: window.COMMAND_CENTER_CONFIG.oauthClientId, hasOauthSession: true, userEmail: "test@example.com", grantedOauthScopes: "..." }` (read `auth-session.js` for the exact keys the token getter reads; the ground truth is what makes `flowing-writes.js` line ~162 find a token). Stub `showSheetAccessGate` to a no-op on every `window.JobBoredApp.*` module that has it.
2. `page.route("https://sheets.googleapis.com/**", …)`: record `{ method, url, body }` and fulfil with `{ ok: true, json: { updatedRange: "…" } }`. Route everything else external to abort and record as `unexpectedExternal` (as the journey fence does).
3. Seed three fixture jobs (fictional), open role `"1"`.
4. In the Case's People block: set the follow-up date input to a date and dispatch `change`; click the replied control's `Yes`; type into last contact and blur; type into contact and blur. After each, wait for a recorded Sheets request and assert: PUT/POST to a `values/Pipeline!P…` / `S…` / `R…` / `L…` range (letter only — see trap 4) with the exact value in the body (`[[ "2026-09-10" ]]`, `[[ "Yes" ]]`, …).
5. Assert no request ever targeted a column other than L/P/R/S during the People edits, `unexpectedExternal` is empty, and console errors are zero (the "Not signed in" warn must NOT appear — if it does, the staging in step 1 is wrong; fix the staging, never the assertion).
6. If the Case's People block does not yet look as lane A is building it (a segmented replied control), target `[data-field="reply"]` generically — it is the frozen contract either way.

## Write `docs/programs/dossier-case-followups/LIVE-CHECK.md`
A 60-second script for Emilio to run on his real Sheet once, in the order the spec exercises: which role to open, which four edits to make, and exactly which four cells (`L/R/S/P` of that row) to look at in the Sheet — plus what a failure would look like in the UI (`jb:write:failed` toast copy from `flowing-writes.js`). This is the only proof that can't be automated; make it trivial to do.

## Definition of Done
1. `npm run test:e2e-journey` green including your spec (pasted in `LANE-REPORT-C.md` §4); `npm run test:e2e-smoke` still green.
2. `LIVE-CHECK.md` exists and is copy-pasteable.
3. One commit: `test(e2e): prove the Case's People edits reach the Sheet at the wire`. Never modify app source; if the staging cannot find a token seam, stop and write exactly which key `auth-session.js` reads in §5.
