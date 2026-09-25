# UX01 lane F: States and Settings (C21, C22)

Branch `feat/ux01-states-settings`, cut from `feat/ux-zero-to-one` at cca3e30. Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/ux01-states-settings`.

## Upstream merge: blocked

`git merge --no-edit feat/greenfield-integration` (#104) conflicted in `oneflow-beat-ai.js` and `tests/sixbeats2-beat-provider.test.mjs`. I don't own either file, so I aborted the merge per the rules and built on `feat/ux-zero-to-one` alone. None of #104 merged.

**The risk:** #104 also edits files this lane owns: `settings-modal.js` (+222), `partials/settings-modal.html` (+161), `settings-tab-schema.js` (+106), `settings-tabs.css` (+36), `settings-profile-tab.js`, `sheet-access-setup.js` and `fit-profile-wizard.js`. To keep the eventual conflicts small, I added new functions and CSS blocks and made targeted edits rather than restructuring anything. I did not touch `settings-tab-schema.js`, `settings-profile-tab.js` or `fit-profile-wizard.js`. The #104 receipts model is not on this branch, so this lane could not build on it. Expect a manual reconcile in `settings-modal.js` (the save tail and the open/close functions) and in the settings partial (the lede, the OAuth hint, the Upgrades tab and the Save label) when #104 lands.

## What changed for the user

- **A failed refresh no longer looks like a wiped board.** When a Sheet read fails after a good load (lost access, offline, a 404 or a 5xx), the last good cards stay. A banner above the Today region names the cause in plain words:
  - 403: "user@example.com can't open this Sheet", with an Open Sheet button.
  - 404: "That Sheet doesn't exist."
  - Offline: "You're offline."
  - 401: "Your Google session ended", with a Sign in button.

  Every banner has Retry, and Open Settings where it helps. Google's raw sentence never shows.
- **A "Synced N min ago" label and a Refresh button** sit above Today. They appear after the first good load and update every 30 s.
- **The connection is watched.** Going offline shows the offline banner, and coming back online reloads the Sheet and sends any stars that were saved while offline.
- **An offline star gives one message.** It used to fire two red toasts. Now it shows one warning with Retry, and the star syncs itself when the connection returns.
- **Session-expired toasts have a Sign in button.**
- **The sign-in gate's error copy names the account and the cause** (the same plain map as the banner). It adds an "Open the Sheet" button on a 403, and "Reload" reads "Try again".
- **An expired session no longer hangs on a blank page.** If the silent sign-in restore doesn't answer within 8 s, the sign-in gate opens with the title "Your Google session ended".
- **The legacy error block (`?jb-v2=0`)** shows plain copy, and its primary button now reads "Retry" and retries.
- **Settings at 375 px:** all 7 tabs wrap onto the screen and each is at least 44 px tall. Before, 1 of 7 was visible.
- **Scraper setup opened from Settings works.** The guide sits above Settings, is no longer inert, and Escape closes the guide, not Settings. Focus returns to the button that opened it.
- **Save applies in place.** It reloads only when the Sheet or the Google client ID changed; otherwise it applies the change, toasts "Saved" and closes. The button reads "Save", and a changed dashboard title updates live.
- **Unsaved changes are protected.** Escape, the X and the overlay ask "Discard your unsaved Settings changes?" when the form was edited.
- **One save per tab.** The footer Save is hidden on Fit Profile (it has its own save) and Upgrades (nothing to save).
- **Upgrades:** "Turn on ATS scoring" and "Add a Gemini key" are buttons that jump to the right tab or field. Extras that need a file edit say "Needs a one-line file edit" instead of implying one click.
- **Plain Settings copy:** the lede, the OAuth hint, the discovery hint and the scraper hint are rewritten, with ports and `npm start` behind a Details disclosure. A failed Check connection says "Couldn't reach Google Gemini from this browser… or switch to OpenRouter", with the raw reason under Details.
- **Fit Profile Rescore** is a real `fp-btn` ghost button, with the lede "Rescore updates fit scores for roles already in your Pipeline." Its failures use plain copy.
- **The setup doctor previews before it writes.** It lists each finding with its detail and "Will write Pipeline!A1 in your Sheet" before a "Fix N things" button. When it stops for the user, the instructions stay beside Continue. "Run setup doctor" opens a dialog over the dashboard instead of replacing the board with the error gate.

## Change status

| id | status | notes |
|---|---|---|
| C21 | partial | Owned-file parts done. Needs lane C and lane A for SS-02, SS-08 and TR-21 (see handoffs) and lane E for SS-26. |
| · SS-01 | done | Last good data kept; banner with Retry. Unit test and e2e. |
| · SS-02 | handoff | Events and `html[data-jb-data-loaded]` are emitted; lane C must gate the Today/Dawn empty copy and add skeletons. |
| · SS-05 | done | Refresh button, "Synced N min ago", offline banner, `online` reloads. |
| · SS-06 | done | One warning with Retry; `flushPendingFavorites` runs on `online`. |
| · SS-08 | handoff | `jb-v2-legacy-hide.css` belongs to lane A. |
| · SS-09 | done (partial) | Plain 403/404/offline gate copy naming the account, plus Open Sheet. No separate "Switch account" button; the existing "Set up JobBored for this account" plus sign-in covers that path. |
| · SS-10 | done | Plain hint; the primary button retries. |
| · SS-25 | done | 8 s timeout opens the sign-in gate with "Your Google session ended". e2e. |
| · SS-26 | handoff | The copy lives in `resume-generation.js` and `posting-enrichment.js` (lane E). |
| · TR-21 | handoff | The badge rule belongs in `flowing-chrome` CSS (lane C). |
| C22 | done (partial on SS-17) | |
| · SS-03 | done | e2e: the guide is on top, not inert, and Escape closes only the guide. |
| · SS-04 / AX-18 | done | Tabs wrap at 600 px and below, 44 px min height. e2e checks every tab's box inside 375 px. |
| · SS-13 | done | Plain check-failure copy with the raw reason under Details. |
| · SS-14 | done | Save in place unless the Sheet or client ID changed; footer hidden on Fit Profile and Upgrades (e2e checks Upgrades). |
| · SS-15 | done | |
| · SS-16 | done | Tab/field buttons; file-edit extras labelled as such. Not a docs link, just "see SETUP.md". |
| · SS-17 | partial | Lede and three hints rewritten, with ports and `npm start` behind Details. #104's receipts rework the Google and AI tabs; those are not on this branch. |
| · SS-20 | done | Preview list and detail at Continue. Unit test. |
| · SS-21 | done | `<dialog>` over the dashboard. |
| · SS-27 | done | e2e. Settings now owns Escape in the capture phase (see handoffs). |

## Files touched

`sheets-read-load.js`, `sheets-writeback.js`, `auth-session.js`, `sheet-access-setup.js`, `setup-doctor.js`, `settings-modal.js`, `settings-tabs.js`, `settings-tabs.css`, `partials/settings-modal.html`, `scraper-ats-config.js` and `fit-profile-backcompat.js`.

Tests:
- New: `tests/ux01-f-load-states.test.mjs`, `tests/ux01-f-doctor-preview.test.mjs` and `tests/e2e-journey/ux01-f-states-settings.spec.mjs` (5 e2e tests).
- Updated: `tests/read-path-session-expiry.test.mjs`. The session toast copy changed, and the legacy hint now asserts plain copy instead of Google's raw sentence.

`app-bootstrap.js` was not changed. Its dead `#refreshBtn` handler is left alone, and the new Refresh lives in the sync bar.

## Contracts touched

- `updateJobStatus(dataIndex, stage)`: unchanged.
- `data-action`, `data-stable-key`, `expandedJobKeys`, the PIPELINE-CARDS-HANDOFF.md selectors: untouched.
- `schemas/pipeline-row.v1.json`: untouched. The doctor now *displays* its `Pipeline!A1` write before fixing, and the fix itself is unchanged.
- `sheetsWrite.updateMultipleCells(updates, isRetry, opts)`: new optional third argument `{ silent }`. Backward compatible.
- `setup.showSheetAccessGate(mode, opts)`: new optional `{ title, detail }`. Backward compatible.
- New events on `window` and `document`:
  - `jb:data:loaded` with `{ rows, count, first, lastSyncedAt }`. It fires on every successful load; `first` is true only for the first one.
  - `jb:data:load-failed` with `{ status, kind, lastSyncedAt, hasLastGood }`. `status` is 0 when offline or when there was no answer.

## APIs added

- `sheetsRead.describeLoadFailure({ status, kind, email })`
- `sheetsRead.formatSyncedAgo(at, now)`
- `sheetsRead.getLoadState()`
- `sheetsWrite.flushPendingFavorites()`
- `settings.requestCloseCommandCenterSettingsModal()`
- `settings.settingsFormIsDirty()`
- `settings.settingsSaveNeedsReload(before, payload, sheetId)`
- `settings.describeProviderCheckFailure(provider, raw)`

DOM hooks:
- `#jbSyncBar[data-state=ok|failed|offline]`, with `#jbSyncLabel`, `#jbSyncRefreshBtn` and `#jbSyncBanner` inside it
- `html[data-jb-data-loaded="true"]`
- `#settingsModal[data-active-tab]`
- `[data-settings-goto-tab]` and `[data-settings-goto-field]`
- `dialog#jbDoctorDialog`

## Baselines refreshed

None. `npm run test:e2e-visual` passed 37/37 with no snapshot moved. The sync bar is hidden until the first good load and stays out of every baseline frame.

## Handoffs

1. **Lane C, `today.js` and `dawn.js` (SS-02, SS-11):** until `jb:data:loaded` fires, or while `html[data-jb-data-loaded]` is absent, render skeleton rows with `aria-busy="true"` instead of "Nothing is waiting on you today" or "No active roles…".
2. **Lane C, `flowing-chrome.js` (optional):** adopt `#jbSyncLabel` and `#jbSyncRefreshBtn` into `.page-top__actions`. `#jbSyncBar` is a self-contained sibling inserted before `[data-region="today"]`, so moving the two nodes keeps their handlers.
3. **Lane C, the `flowing-chrome` CSS (TR-21):** add `body.jb-v2 .page-top__actions [hidden] { display: none }`.
4. **Lane A, `jb-v2-legacy-hide.css` (SS-08):** add `[data-region="today"]` to the auth-gated hide list and to the `:has(#dashboard…)` reveal list.
5. **Lane E, `resume-generation.js:800` and `posting-enrichment.js:256` (SS-26):** replace the copy with "Add an AI key to draft materials" and a toast action that calls `openCommandCenterSettingsModal({ tab: "ai_providers" })`, with the tab label taken from `JobBoredSettingsTabSchema` TAB_META.
6. **Lane E, `materials-feature.js:652` (global Escape):** its Settings branch now never runs, because Settings stops propagation in the capture phase. The Settings and scraper branches can be deleted.
7. **Lane A, C2 (SS-18):** Save button and `.field-label` contrast inside `#settingsModal`. The sync-bar and doctor-dialog CSS in `settings-tabs.css` should move to a states sheet when lane A's renames land. It uses only `--jb-*` tokens, each `var()` with a fallback. The fallbacks are CSS system colours (`Canvas`, `CanvasText`, `currentColor`), not literals.
8. **Integrator:** merge #104 (`feat/greenfield-integration`) into this branch after the `oneflow-beat-ai.js` conflict is settled upstream, then reconcile the Settings files named above.

## Floor

Logs are in `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/`.

**Run 1** (commit 828e182), files `F-*.log`:

| command | result |
|---|---|
| lint:repo | exit 0 (`F-lint.log`) |
| typecheck:repo | exit 0 (`F-typecheck.log`) |
| npm test | **exit 1**: 3065 tests, 3057 pass, 7 fail |
| test:contract:all | exit 0 |
| test:e2e-smoke | exit 0 |
| test:e2e-journey | exit 0, including the 5 new lane F tests |
| test:e2e-visual | exit 0, 37 passed |

The npm test failures break down as follows:
- **Six real regressions from this lane.** They were source-shape and copy assertions in `favorite-persistence`, `oauth-session-storage-boundary`, `oneflow-l7-sweep` (×3) and `wizards-modal-a11y-focus` (×2). All are fixed in 2112d9a.
- **One known todo:** `submission-record-audit:17`, the same one lane A reports.

After the fix, a targeted rerun of those six files plus the lane F unit tests gave 99 pass, 0 fail.

**Run 2** (commit 2112d9a), files `F2-*.log`, was still running when this report was committed:
- lint:repo: exit 0
- typecheck:repo: exit 0
- npm test, contract, smoke, journey and visual: results pending. Read `F2-*.log`. Each file ends with an `EXIT <suite> <code>` line.
