DONE

## 1. Mission
DESK-D (SPEC D10, D11; PLAN R20) delivers two things:
- **One workflow** that builds a universal JobBored.app. On a manual dispatch with the secrets present, it signs, notarizes and uploads a draft release to emilio3435/jobbored-desktop. Otherwise it builds unsigned. It never publishes and is never a required check.
- **The release runbook.**

## 2. Claims that went red first
I ran `tests/gfx-desk-d-workflow.test.mjs` against a deliberately bad draft: a push trigger, `write-all`, an unpinned `@v4`, `secrets.` inside `run:`, `--publish always`, a non-draft release create, and a smoke run on PORT 8080.

```
✖ triggers: workflow_dispatch with version, pull_request on desktop paths only
✖ build-mac: macos-15, 60 min, concurrency per ref
✖ never publishes: --publish never on every build, drafts only, no tag push
✖ signing is gated on MAC_CSC_LINK and workflow_dispatch
✖ key material lives under RUNNER_TEMP and is removed in an always() step
✖ every uses: is pinned to a 40-char SHA with a version comment
✖ no secrets.* or inputs.* expression inside a run: script
✖ permissions are minimal: contents read, nothing writable
✖ smoke test runs the packaged app on alternate ports, never the live ones
✔ never a required check: ci.yml does not reference this workflow
ℹ tests 10
ℹ pass 1
ℹ fail 9
```

- The 10th claim guards existing `ci.yml` state, so it was green from the start.
- All 10 went green on the real workflow.
- Midway, the signing-gate claim went red again, correctly: the single build step pulled APPLE_* secrets through expressions and had no `if:`. I split it into two gated steps, one unsigned and one signed and notarized.

## 3. What shipped

### `.github/workflows/desktop-mac.yml` (b81d6bf1)
- **Triggers:**
  - `workflow_dispatch` with a required semver `version`, validated through env;
  - `pull_request` on the three paths.
- **Permissions:** `contents: read` only. The draft job uses the scoped PAT and needs no extra GITHUB_TOKEN scope.
- **Concurrency:** per ref.
- **`build-mac`** (macos-15, 60 min):
  - `npm ci` at the root and in `desktop/`, then `npm run stage --prefix desktop`, then the stage exclusion check.
  - A gate step sets `sign=true` only when `MAC_CSC_LINK` is non-empty **and** the event is `workflow_dispatch`.
  - The temp keychain, `.p12` and `.p8` live under `$RUNNER_TEMP`, written with umask 077 and chmod 600. The derived keychain password is masked with `::add-mask::`.
  - Build command: `electron-builder --mac dmg zip --universal --publish never`.
    - Unsigned: `CSC_IDENTITY_AUTO_DISCOVERY=false`.
    - Signed: API-key notarization plus `dmg.sign=true`.
  - The DMG is notarized with notarytool. The job parses the status and fetches the log when it is rejected.
  - `stapler staple` runs on the DMG and the app.
  - Verification:
    - `codesign --verify --deep --strict` on the app;
    - `spctl -t exec` on the app;
    - `spctl -t open --context context:primary-signature` on the DMG.
  - After stapling, the DMG's sha512 and size are refreshed in `latest-mac.yml`.
  - The packaged app is smoke-tested with `JOBBORED_DESKTOP_SMOKE=1` on ports 18580–18582, under a 300 s alarm.
  - Artifacts are uploaded, then an `always()` step cleans up the key material.
- **`draft-release`:**
  - Runs only on a dispatch that was signed.
  - Creates the release in the feed repo as a draft, or updates an existing draft with `upload --clobber`.
  - Refuses a tag that is already published.
- **Action pins** (SHAs resolved with `git ls-remote`): checkout v4.4.0, setup-node v4.4.0, upload-artifact v4.6.2, download-artifact v4.3.0.

### `tests/gfx-desk-d-workflow.test.mjs` (b81d6bf1)
Ten structural claims, as listed in the kickoff.

### `docs/DESKTOP-RELEASE.md` (5f6cf8cd)
- The secrets table
- Creating the feed repo
- Running the workflow and checking the draft
- The manual publish step
- How electron-updater finds `latest-mac.yml`
- A troubleshooting table: notarization rejected, quarantine, stapler, the DMG failing spctl, `disable-library-validation`, and PAT errors

### Not a required check
`ci.yml` and the rulesets are untouched. The test asserts that `ci.yml` never names this workflow, and both the workflow header and the runbook say it is not required.

## 4. Floor results
```
$ npm run lint:repo
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md

> command-center@0.1.0 lint:tokens
> node tools/lint-tokens.mjs

lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
$ npm run typecheck:repo
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

$ node --test tests/gfx-desk-d-workflow.test.mjs
✔ triggers: workflow_dispatch with version, pull_request on desktop paths only (0.575292ms)
✔ build-mac: macos-15, 60 min, concurrency per ref (0.078125ms)
✔ never publishes: --publish never on every build, drafts only, no tag push (0.212083ms)
✔ signing is gated on MAC_CSC_LINK and workflow_dispatch (0.155333ms)
✔ key material lives under RUNNER_TEMP and is removed in an always() step (0.129ms)
✔ every uses: is pinned to a 40-char SHA with a version comment (0.181875ms)
✔ no secrets.* or inputs.* expression inside a run: script (0.081125ms)
✔ permissions are minimal: contents read, nothing writable (0.060417ms)
✔ smoke test runs the packaged app on alternate ports, never the live ones (0.093666ms)
✔ never a required check: ci.yml does not reference this workflow (0.182125ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 150.606792
$ actionlint
actionlint: not installed (bash -n on all 13 run: blocks instead, all ok)
$ gitleaks protect --staged --redact
INF 0 commits scanned.
INF scanned ~26855 bytes (26.85 KB) in 11.3ms
INF no leaks found
exit=0

# exit codes, re-run directly (zsh dropped PIPESTATUS in the capture above)
lint:repo exit=0
typecheck:repo exit=0
test exit=0
```

Extra checks:
- `bash -n` passes on all 13 extracted `run:` blocks.
- **The stage-exclusion script, run against fake bundles:**
  - A clean bundle exits 0. It ignores a `.pem` inside `node_modules`.
  - A dirty bundle exits 1 and lists `tests/`, `config.js`, `node_modules/.cache` and `.env`.
- **The `latest-mac.yml` rewrite:** it changes only the DMG entry, and the new sha512 equals `openssl dgst -sha512 -binary | base64`.

## 5. Unverified / sandbox refused
- **The workflow has never run on GitHub.** That is Emilio's to do.
  - Signing, notarization, stapling, spctl and the draft-release path are verified only structurally.
  - This branch has no `desktop/` tree yet (DESK-A is still live), so stage, build and smoke are unexercised.
- **actionlint and shellcheck are not installed.** The node structural test and `bash -n` stand in for them.
- **For the integrator to reconcile with DESK-A:**
  - (a) The smoke-port env names `JOBBORED_SMOKE_{DASHBOARD,API,WORKER}_PORT` are my proposal. DESK-A's smoke mode must honor them, or rename them here; either way it must stay off 8080/8644/3847.
  - (b) Only the `stage` script is consumed; `electron-builder` is called directly, so the naming of `dist` versus `dist:unsigned` does not matter.
  - (c) The workflow assumes:
    - the output lands in `desktop/dist/`;
    - `JobBored.app` sits at most two levels deep;
    - `desktop/package-lock.json` exists.
  - (d) The runbook assumes `desktop/electron-builder.yml` has `publish: github emilio3435/jobbored-desktop`, so that `app-update.yml` is embedded in the app.
- **Notarization env:** electron-builder notarizes through `APPLE_API_KEY` (the path to the `.p8`), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. That follows electron-builder 24 and later; I have not checked it against the version DESK-A pins.
- **DMG blockmap:** not uploaded. It goes stale after stapling, and the mac updater uses the zip.
- **YAML parsing in the test:** it goes through Ruby (Psych) or PyYAML, because the repo has no YAML dependency and `package.json` is outside the fence. Both ship on GitHub's Ubuntu runners. If either is missing, the test fails loudly rather than skipping.
- **Commit trailers** use this session's attribution lines instead of the session URL printed in the shared kickoff.
