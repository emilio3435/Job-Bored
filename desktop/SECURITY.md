# JobBored for Mac: security notes

The desktop app is a menu-bar supervisor. It runs JobBored's three local servers from a read-only copy inside the app, and opens `http://localhost:8080/` in the user's browser. It has no windows and loads no remote content.

## jobbored:// links (`protocol.mjs`)

Any web page can fire a `jobbored://` link, so the handler trusts none of it.

- It accepts exactly two strings: `jobbored://open` and `jobbored://open?beat=<id>`, where `<id>` is one of `google`, `ai`, `resume`, `fit`, `discovery`, `payoff`. Nothing is decoded or normalised, so encodings, whitespace, credentials, fragments, extra or duplicate parameters, and case variants all fail the comparison.
- `returnTo` is never accepted (GFX R4). A beat is only a re-entry hint; the dashboard still enforces its own prerequisites.
- The target URL is picked from a table of constants, never built from the input, and is passed only to `shell.openExternal`. No shell, spawn or file API ever sees link content.
- Launches are limited to one per 2 seconds. The raw URL is never logged; only a reason code or the accepted beat is.

## Supervising the servers (`supervisor.mjs`)

- Children are spawned with `spawn(cmd, args, { cwd, env })` from the spec in `scripts/lib/runtime-env.mjs`, which is the frozen contract. They are never spawned with `shell: true`.
- Children start from a curated environment (`app-config.mjs` `childBaseEnv`): a system PATH plus locale and user name. The app's own environment (API keys, `NODE_OPTIONS`, `DYLD_*`) is not passed on.
- **Attach before spawn.** A port already answered by a healthy JobBored (a source checkout, or an earlier LaunchAgent) is attached to rather than started a second time.
- **Never kill what we didn't start.** A foreign process on a port is named in the tray (via `/usr/sbin/lsof`, argv only) and left alone. Quit and Restart signal only children this app spawned, together with their process groups, which contain only processes those children started.

## LaunchAgent migration (`launchagents.mjs`)

It touches only five exact labels: `ai.jobbored.discovery.keepalive`, `ai.jobbored.discovery.worker`, `ai.jobbored.discovery.tunnel`, `com.jobbored.refresh` and `com.jobbored.expired-cleanup`. Nothing runs without an explicit yes. With a yes, each label is booted out with `launchctl bootout gui/<uid>/<label>` and its plist is moved, not deleted, to `~/.jobbored/launchagents-disabled/`.

## The RunAsNode fuse stays enabled (the tradeoff)

The servers run on Electron's own Node: the app's binary runs again with `ELECTRON_RUN_AS_NODE=1` (SPIKE S1). That saves bundling a second, separately signed Node runtime of about 70 MB. It requires the `RunAsNode` fuse to stay on.

**The cost.** Any local process running as the user can start `JobBored.app/Contents/MacOS/JobBored` as a plain Node interpreter and run arbitrary JavaScript under JobBored's code signature. On macOS, that means it inherits any TCC grants (privacy permissions) the user gave JobBored. This is a known class of issue for Electron apps that keep RunAsNode.

**Why we accept it.**
- JobBored requests no TCC-protected access: no camera, microphone, contacts, full-disk access, automation or accessibility, and no keychain items of its own. Borrowing its signature gains an attacker nothing they don't already have as the same user.
- The attacker must already be able to execute code as the user.
- The remaining fuses are hardened. `NODE_OPTIONS` and `--inspect` are disabled, so the app process can't be hijacked through environment or debugger flags. The app loads only from its integrity-checked `app.asar`, cookie encryption is on, and `file://` has no extra privileges.

**Revisit if** the app ever asks for a TCC permission or stores secrets in the keychain. At that point, either ship a separately signed Node for the children and turn RunAsNode off, or move the servers into Electron `utilityProcess`.

## Hardened runtime entitlements (`entitlements.mac.plist`)

- `cs.allow-jit` and `cs.allow-unsigned-executable-memory` are for V8, in the app and in every Electron-as-Node child, which inherit the entitlements.
- `cs.disable-library-validation` is included until the S2 spike (a signed and notarized build) shows it can be dropped.

## What ships

`scripts/stage.mjs` builds `app-bundle/` from `git ls-files`, so untracked files such as `config.js`, `.env` and uploads can never be included. Production dependencies are installed with `npm ci --omit=dev --ignore-scripts`. A self-check fails the build if any test, doc, coverage file, cache, `.lane-evidence`, screenshot, `.env*`, root `config.js`, or key or token file is present.

All user data is written under `~/.jobbored` (DESK-B). Logs go to `~/.jobbored/logs/` with the directory at mode 0700 and files at 0600.

## Signing and updates

- Local builds are not signed with any identity (`CSC_IDENTITY_AUTO_DISCOVERY=false`). The only signature is the ad-hoc one that Apple Silicon requires after the fuses are flipped (`resetAdHocDarwinSignature`), with no team and no certificate. Developer ID signing and notarization happen only in CI, using secrets Emilio adds (D10).
- Updates come from the GitHub repo `emilio3435/jobbored-desktop`, which is pinned in code in `updater.mjs` as well as in `app-update.yml`. Squirrel.Mac verifies that an update carries the same code signature as the running app, so an unsigned local build cannot install updates. That is expected until builds are signed.
