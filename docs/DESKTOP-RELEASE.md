# Desktop release runbook (macOS)

`.github/workflows/desktop-mac.yml` builds a universal `JobBored.app` (DMG + zip). On a pull request that touches `desktop/**`, the workflow file, or `scripts/lib/runtime-env.mjs`, it builds **unsigned** and smoke-tests. On a manual run with the secrets below, it signs, notarizes, staples, and uploads a **draft** release to `emilio3435/jobbored-desktop`. The update payload gate checks the packaged app version, zip checksum and size, and zip blockmap before upload. Nothing is ever published automatically: you publish the draft yourself.

It is **not a required check**. It is not in `ci.yml`'s list or the `main` ruleset; keep it that way, because it only runs on desktop paths and signing is manual.

## 1. Secrets (add them yourself)

In this repo: **Settings → Secrets and variables → Actions → New repository secret**. No agent handles these.

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | `base64 -i DeveloperID_Application.p12 \| pbcopy`: the base64 of your **Developer ID Application** certificate + private key, exported from Keychain Access as `.p12` |
| `MAC_CSC_KEY_PASSWORD` | the password you set on that `.p12` export |
| `APPLE_API_KEY` | the full text of the App Store Connect API key `AuthKey_XXXXXXXXXX.p8` (App Store Connect → Users and Access → Integrations → Keys; role *Developer*) |
| `APPLE_API_KEY_ID` | that key's ID (the `XXXXXXXXXX`) |
| `APPLE_API_ISSUER` | the Issuer ID shown above the keys list |
| `APPLE_TEAM_ID` | your 10-character Team ID (developer.apple.com → Membership) |
| `DESKTOP_RELEASES_TOKEN` | a **fine-grained PAT**, resource owner `emilio3435`, repository access *only* `jobbored-desktop`, permission **Contents: Read and write**. Nothing else. |

Signing turns on only when `MAC_CSC_LINK` is non-empty **and** the run is a manual dispatch. The workflow never prints these: the `.p12` and `.p8` are written under `$RUNNER_TEMP` with mode 600 and removed in an `always()` step, with the temporary keychain.

## 2. Create the feed repo (once)

1. Create a **public** repo `emilio3435/jobbored-desktop` with a README, so it has a default branch for release tags.
2. Leave it empty otherwise; it only holds releases.

Public matters: electron-updater reads its releases without a token.

## 3. Run a release

1. **Actions → Desktop (macOS) → Run workflow**, branch `main`, `version` such as `1.0.0` (semver, no leading `v`).
2. `build-mac` (about 20–40 min): stage → stage exclusion check → sign → notarize the app → sign, notarize and staple the DMG → `codesign`/`spctl` verification → packaged-app smoke test on ports 18580–18582 → artifacts.
3. `draft-release` creates or updates the draft `desktop-v<version>` in the feed repo, with the DMG, the zip, its `.zip.blockmap`, and `latest-mac.yml`. It refuses to touch a tag that is already published: bump the version instead.

Without the secrets, the same run builds unsigned, uploads workflow artifacts, and skips `draft-release`.

## 4. Check the draft

1. Open `https://github.com/emilio3435/jobbored-desktop/releases`; the draft is visible only to you.
2. Download the DMG, open it and drag the app to Applications. It should open **without** a Gatekeeper warning. To double-check: `spctl -a -vvv -t exec /Applications/JobBored.app` should print `source=Notarized Developer ID`.
3. Confirm `latest-mac.yml`'s `version` matches, and that the zip is listed in it.

## 5. Publish (the moment users get the update)

Edit the draft → leave **Set as a pre-release** unchecked, check **Set as the latest release** → **Publish release**. Installed apps pick it up on their next check (launch, then every 6 h) and show "Restart to update" in the tray.

**How electron-updater finds it:** the packaged app carries `app-update.yml` (from the `publish` block in `desktop/electron-builder.yml`: GitHub provider, `emilio3435/jobbored-desktop`). It asks GitHub for the **latest non-draft, non-prerelease** release, downloads `latest-mac.yml` from that release's assets, compares `version` with its own, then downloads the zip and checks its `sha512`. Drafts are invisible to it, so publishing is the switch. To roll back, unpublish (convert to draft) or delete the bad release; users already updated stay on it until a newer version ships.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Notarization **Invalid/Rejected** | The step prints the `notarytool log`. Usual causes: a binary without hardened runtime or a secure timestamp (every nested binary must be signed by electron-builder, so check `mac.binaries` for native modules), or an expired or wrong certificate type (must be *Developer ID Application*, not *Apple Development*). |
| "JobBored is damaged / can't be opened" (quarantined) | The build was unsigned or not stapled. Use the signed draft. For a local unsigned test build only: `xattr -dr com.apple.quarantine /Applications/JobBored.app`. |
| `stapler staple` fails (error 65 / no ticket) | Notarization had not propagated yet, or the file changed after submission. Re-run the job; if it persists, run `xcrun notarytool history` with the API key and confirm the submission is *Accepted*. |
| `spctl` rejects the DMG | The DMG is not signed (`dmg.sign=true` is passed by the workflow) or not stapled. The app itself can still be fine; check with `spctl -a -t exec` on the app. |
| App crashes at launch only when signed | Hardened runtime blocks JIT or loading the Electron-as-Node children. The entitlements need `cs.allow-jit`, `cs.allow-unsigned-executable-memory`, and **`cs.disable-library-validation`**. The last is needed while native modules or child binaries are not signed by the same team; drop it once spike S2 proves it unnecessary, since it widens what the process will load. |
| `draft-release` 403/404 | `DESKTOP_RELEASES_TOKEN` is missing, expired, or not scoped to `jobbored-desktop` with Contents write; or the feed repo has no default branch. |
