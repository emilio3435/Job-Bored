# Lane MACUPD: prove the Mac app updates itself (spike S6)

Read `KICKOFF-CDESK-_SHARED.md` in this folder first; its rules bind you, except the floor: yours is below. Family: sol · xhigh. Worktree `~/Job-Bored.worktrees/cdesk-macupd`, branch `feat/cdesk-macupd`, base main `98903e29`.

**State:** JobBored 0.1.0 is signed, notarized and published as Latest in `emilio3435/jobbored-desktop` (release `desktop-v0.1.0`). `desktop/updater.mjs` wires electron-updater to that feed (checks at launch and every 6 h, "Restart to update"). `desktop/electron-builder.yml:80-85` embeds `app-update.yml`. CI: `.github/workflows/desktop-mac.yml` (`workflow_dispatch` with `version`), which creates a DRAFT release. All 7 signing secrets are set. Nobody has tried an update.

**Goal:** make the 0.1.0 → 0.1.1 update path certain before Emilio spends a release on it, and hand him the exact steps.

**Tasks:**
1. Read `desktop/updater.mjs`, `main.mjs` (tray wiring), `electron-builder.yml`, `desktop-mac.yml` and `docs/DESKTOP-RELEASE.md`. Using `gh release view desktop-v0.1.0 --repo emilio3435/jobbored-desktop --json assets` (read-only), confirm the published release carries what electron-updater needs on macOS: `latest-mac.yml`, the `.zip` (Squirrel.Mac updates from the zip, not the dmg), and blockmaps. Confirm the version/tag naming the updater expects matches what CI produces (`desktop-v0.1.0` vs `v0.1.0`; electron-updater's GitHub provider matches tags by `vPrefixedTagName` and release channel). Any mismatch is a P0: fix it in config and cite the electron-updater source or docs.
2. Confirm how the workflow sets the app version (root `package.json`, `desktop/package.json`, or the `version` input) so 0.1.1 is higher than the installed 0.1.0. Fix it if a 0.1.1 build could still report 0.1.0.
3. Add or extend unit tests in `desktop/test/` for anything you change (state machine: idle → checking → downloading → ready; error surfaced in the tray).
4. Write `docs/programs/cdesk-20260927/reports/MACUPD-RUNBOOK.md`: the numbered steps Emilio runs (the `gh workflow run` command for 0.1.1, where to click Publish on the draft, how to trigger "Check for updates" in the installed app, where the app logs the update (`~/.jobbored/logs/desktop.log`?), and what success looks like). Also note whether 0.1.0 is installed on this Mac (look in `/Applications` and `~/Applications`, read-only).
Do NOT run `gh workflow run`, create releases, or publish anything.

**Floor:** `cd desktop && npm test && npm run typecheck`, plus `npm run lint:repo` at the root, plus `gitleaks protect --staged --redact`. Paste all of it.

**Success means:** release-asset check pasted; every mismatch fixed with a test; the runbook written; report first line `DONE`.

**Stop when:** done, or blocked.
