# Lane DESK-D: CI for the macOS app (build, sign, notarize, draft release) and release docs

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 (D10, D11)
- `PLAN.md`, section "Option C", the CI paragraph and §R20
- the existing workflows (`.github/workflows/ci.yml`, `pages.yml`, `release.yml`, `gitleaks.yml`) for their style and required checks

**Routing (D12):** opus.

**Live alongside you:** DESK-A, which is building `desktop/**`. You consume its scripts by name: `desktop/package.json` `stage` and `dist`, and `JOBBORED_DESKTOP_SMOKE=1`. Don't edit `desktop/**`; if a script name differs when DESK-A lands, the integrator reconciles it.

**Goal:** one workflow that builds a universal JobBored.app. When Emilio's secrets are present, it signs and notarizes the app and uploads a **draft** release to the feed repo. Without them, it builds unsigned. It never publishes, and it is never a required check.

**Success means:**

1. **`.github/workflows/desktop-mac.yml`:**
   - **Triggers:** `workflow_dispatch` with a `version` input, and `pull_request` limited to `paths: [desktop/**, .github/workflows/desktop-mac.yml, scripts/lib/runtime-env.mjs]`, which builds **unsigned** only.
   - `permissions: contents: read` by default; the release job adds only what it needs.
   - `concurrency` per ref.
   - **Job `build-mac`** (`runs-on: macos-15`, `timeout-minutes: 60`):
     - checkout, setup-node 24 with npm cache;
     - `npm ci` at the root, then `npm ci` in `desktop/`;
     - `npm run stage --prefix desktop`;
     - build with `electron-builder --mac dmg zip --universal --publish never`.
     - **Signing is conditional:** the signing env comes only from secrets, and there is a `SIGN` step output that is true only when `MAC_CSC_LINK` is non-empty **and** the event is `workflow_dispatch`. Unsigned builds set `CSC_IDENTITY_AUTO_DISCOVERY=false`.
     - Put the temp keychain under `$RUNNER_TEMP`. Write the `.p8` to a temp file with mode 600, and delete it in an `always()` step.
     - **Never echo secrets:** no `set -x` near them, and add `::add-mask::` where values are derived.
     - When signed: notarize with the API key, run `xcrun stapler staple`, then verify with `codesign --verify --deep --strict` and `spctl -a -vvv -t exec` on the app, and `spctl -a -t open --context context:primary-signature` on the DMG.
     - Smoke-test the packaged app with `JOBBORED_DESKTOP_SMOKE=1` (alternate ports), plus the stage self-check that no excluded files are present.
     - Upload the DMG, the zip and `latest-mac.yml` as workflow artifacts.
   - **Job `draft-release`** (needs `build-mac`; only on `workflow_dispatch` when signed):
     - Create or update a **draft** release `desktop-v<version>` in **`emilio3435/jobbored-desktop`**, using `DESKTOP_RELEASES_TOKEN`, with the DMG, the zip and `latest-mac.yml`.
     - **Never** `--publish always`, never a non-draft release, and never a tag push to this repo.
   - Pin third-party actions to a full commit SHA, with the version in a comment.
2. **It is not a required check.** Don't edit branch rulesets or `ci.yml`'s required-checks list. Document this.
3. **`docs/DESKTOP-RELEASE.md`**, a short runbook for Emilio:
   - **The secrets to add yourself:**
     - `MAC_CSC_LINK`: the base64 of the Developer ID Application `.p12`, plus `MAC_CSC_KEY_PASSWORD`
     - `APPLE_API_KEY`: the `.p8` contents, plus `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`
     - `DESKTOP_RELEASES_TOKEN`: a fine-grained PAT with contents write on `jobbored-desktop` only
   - Also cover: how to create the feed repo; how to run the workflow; how to check the draft; the **manual publish step, which is the moment users get the update**; and how electron-updater finds `latest-mac.yml`.
   - A troubleshooting table: notarization rejected, a Gatekeeper-quarantined app, a stapler failure, the `disable-library-validation` note.
4. **Local validation:**
   - `actionlint`, if installed, or a YAML parse plus a structural check in a node test (`tests/gfx-desk-d-workflow.test.mjs`). The test asserts:
     - triggers and paths;
     - no `publish: always` and no non-draft release;
     - signing is gated on a secret **and** `workflow_dispatch`;
     - every `uses:` is pinned to a 40-character SHA;
     - no `secrets.` reference appears in a `run:` script without going through `env:`;
     - `permissions` are minimal;
     - smoke ports are not 8080/8644/3847.
   - Red first: write the test against a deliberately bad draft, then fix.

**Floor:** paste all of this in §4.
- `npm run lint:repo`
- `node --test tests/gfx-desk-d-workflow.test.mjs`
- `actionlint`, if available
- `gitleaks protect --staged --redact`

You **cannot** run the workflow on GitHub; that is Emilio's. Say so in §5.

**Report:** first line `DONE` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)

- `.github/workflows/desktop-mac.yml`
- `docs/DESKTOP-RELEASE.md`
- `tests/gfx-desk-d-workflow.test.mjs`

**Do NOT touch:**
- `desktop/**` (DESK-A)
- other workflows, rulesets, `release-please-config.json`
- any secret, token, certificate or keychain
- pushes and `gh` commands that write to GitHub

## Non-negotiables

- Drafts only.
- Never a required check.
- Secrets never printed and never written outside `$RUNNER_TEMP`.
- Signing only on a manual dispatch with secrets present.

## Definition of Done

The floor, green and pasted in §4. First line `DONE`. Local commits only.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
