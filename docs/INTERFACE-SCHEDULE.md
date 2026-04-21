# Interface contract — Settings → Schedule

**Status:** authoritative contract for the `feat/schedule-backend` and `feat/schedule-ui` workspaces. Both implementations must conform to this document; do not diverge without updating the doc first and notifying the orchestrator.

**Scope:** the three-tier daily-refresh ladder described in the approved plan at `/Users/emilionunezgarcia/.claude/plans/resilient-stargazing-sparrow.md`.

---

## 1. TypeScript: extend `StoredWorkerConfig.schedule`

**File:** `integrations/browser-use-discovery/src/contracts.ts:748`

**Current shape (do not break):**

```ts
schedule: {
  enabled: boolean;
  cron: string;
};
```

**New shape (backward-compatible — add fields, keep `cron` for legacy config files):**

```ts
schedule: {
  enabled: boolean;
  /** Legacy; retained so old worker-config.json files still parse. New writers do not set this. */
  cron?: string;
  /** Local hour of day (0-23). Source of truth for the UI time picker. */
  hour?: number;
  /** Local minute of hour (0-59). */
  minute?: number;
  /**
   * Which tier the user picked in Settings → Schedule:
   *   - "browser": Tier 1, auto-refresh while tab is open.
   *   - "local":   Tier 2, OS scheduler on this machine (launchd/systemd/schtasks).
   *   - "github":  Tier 3, GitHub Actions cron.
   */
  mode?: "browser" | "local" | "github";
  /** ISO timestamp written by local installer scripts. UI uses this to show an installed-status badge. */
  installedAt?: string;
};
```

**Migration:** existing configs with only `{enabled, cron}` parse fine because every new field is optional. Readers that need `hour`/`minute` fall back to defaults (e.g., 8 / 0) and show an "unconfigured" hint in the UI.

---

## 2. HTTP: new webhook modes on `POST /discovery-profile`

**Existing modes:** `manual` (default), `refresh`, `skip_company`, `status`. Reference: `integrations/browser-use-discovery/src/webhook/handle-discovery-profile.ts:150-158`.

**Add:** `schedule-save`, `schedule-status`. Same endpoint, same auth header (`x-discovery-secret`), same response envelope shape (`{ok: boolean, ...}`).

### 2.1 `mode: "schedule-save"`

Writes the user's chosen schedule fields into `worker-config.schedule`. Does not install any OS artifact — that's the installer script's job; this endpoint only records intent.

**Request body:**

```json
{
  "event": "discovery.profile.request",
  "schemaVersion": 1,
  "mode": "schedule-save",
  "sheetId": "<required, used to look up worker-config>",
  "schedule": {
    "enabled": true,
    "hour": 8,
    "minute": 0,
    "mode": "local"
  }
}
```

Validation rules (worker enforces; reject with `400` + helpful `message`):

- `sheetId` — non-empty string. Required.
- `schedule.enabled` — boolean. Required.
- `schedule.hour` — integer 0-23. Required when `enabled=true`; optional when `enabled=false` (worker stores whatever was sent).
- `schedule.minute` — integer 0-59. Same rules as hour.
- `schedule.mode` — one of `"browser" | "local" | "github"`. Required when `enabled=true`.

**Success response (200):**

```json
{
  "ok": true,
  "schedule": { "enabled": true, "hour": 8, "minute": 0, "mode": "local", "installedAt": null }
}
```

The `installedAt` field echoes what's currently stored; the save endpoint never sets it (only installer scripts do, via the breadcrumb at §4).

**Error responses:** mirror existing `skip_company` error handling at `handle-discovery-profile.ts:181-186` — `400` with `{ok:false, message, detail?}`.

### 2.2 `mode: "schedule-status"`

Read-only. Returns what's saved in `worker-config.schedule` + whether a local OS artifact is installed (by probing the breadcrumb, §4).

**Request body:**

```json
{
  "event": "discovery.profile.request",
  "schemaVersion": 1,
  "mode": "schedule-status",
  "sheetId": "<required>"
}
```

**Success response (200):**

```json
{
  "ok": true,
  "schedule": {
    "enabled": true,
    "hour": 8,
    "minute": 0,
    "mode": "local",
    "installedAt": "2026-04-21T14:32:10.000Z"
  },
  "installed": true,
  "installedArtifact": {
    "platform": "darwin",
    "path": "/Users/emilio/Library/LaunchAgents/com.jobbored.refresh.plist"
  }
}
```

When no schedule is saved yet: `{ok:true, schedule:{enabled:false}, installed:false, installedArtifact:null}`.

---

## 3. CLI: cross-platform installer

**Entry point:** `npm run schedule:install -- --hour <0-23> --minute <0-59>`

**Flags (identical across OSes — the dispatcher enforces a single UX):**

| Flag | Type | Default | Notes |
| --- | --- | --- | --- |
| `--hour` | int 0-23 | `8` | Local time. |
| `--minute` | int 0-59 | `0` |  |
| `--port` | int 1-65535 | from `BROWSER_USE_DISCOVERY_PORT` in `.env` or `8644` | Used to build the localhost URL for the scheduled POST. |
| `--force` | flag | false | Overwrite an existing artifact without prompting. |
| `--help` / `-h` | flag | — | Print usage and exit 0. |

**Companion scripts:**

- `npm run schedule:uninstall` — same flags ignored (just removes the artifact).
- `npm run schedule:status` — prints `installed: true|false` + the artifact path + the `hour/minute` stored in the breadcrumb. Exit 0 either way.

**Exit codes:**

- `0` — success (install/uninstall/status-ok).
- `1` — user-visible error (missing secret, bad flag, OS not supported). Always preceded by a `schedule:install: <reason>` line on stderr.

**OS dispatch** (inside `scripts/install-schedule.mjs`):

- `darwin` → delegate to existing `scripts/install-launchd-refresh.mjs`.
- `linux` → `scripts/install-cron-refresh.mjs` (systemd user timer first, `crontab` fallback).
- `win32` → `scripts/install-taskscheduler-refresh.mjs`.
- Anything else → exit 1 with message pointing to the Tier 3 GitHub Actions wizard.

---

## 4. Breadcrumb file — the source of truth for "installed"

**Path:** `integrations/browser-use-discovery/state/schedule-installed.json`

**Writer:** every OS-specific installer script writes this file at the end of a successful install. Uninstallers delete it.

**Shape:**

```json
{
  "platform": "darwin | linux | win32",
  "installedAt": "2026-04-21T14:32:10.000Z",
  "artifactPath": "<absolute path to the plist / .timer / schtasks task name>",
  "hour": 8,
  "minute": 0,
  "port": 8644
}
```

**Reader:** the worker's `schedule-status` handler reads it and echoes it in the response.

**Why a breadcrumb instead of querying the OS directly:** querying launchd/systemd/schtasks requires shelling out from the worker, which is fragile and platform-specific. A JSON breadcrumb written at install time is trivially portable and the only thing the worker needs to read.

---

## 5. Tier 3 (GitHub Actions) — no backend surface

The frontend wizard generates a personalized YAML client-side. The only backend interaction is `schedule-save` with `mode:"github"` — this records the user's intent so the status panel can show "you've chosen GitHub Actions." No installer script runs; no breadcrumb is written.

`installed` in the `schedule-status` response is `false` whenever `schedule.mode === "github"` — we cannot verify GitHub's side from this worker. The UI should display an advisory ("Verify in your GitHub Actions tab") instead of a binary installed/not-installed badge.

---

## 6. Test coverage contract

**Backend workspace owns:**
- `integrations/browser-use-discovery/tests/webhook/handle-discovery-profile-schedule.test.ts`
  - `schedule-save` happy path writes config correctly.
  - `schedule-save` rejects missing `sheetId`, bad `hour`, bad `minute`, bad `mode`.
  - `schedule-status` returns `installed:false` when breadcrumb absent.
  - `schedule-status` returns `installed:true` + correct fields when breadcrumb present.
- Installer script unit tests (per OS) — render expected artifact content given fixed flags.

**Frontend workspace owns:**
- Existing `settings-profile-tab` tests still pass.
- New assertions: time-picker round-trip through localStorage; OS detection emits the right install command; Tier 3 YAML download contains the cron matching the picked time.

**Orchestrator owns (between-merge):**
- `tests/integration/schedule-e2e.test.mjs` — boots the worker against a tmp state dir, hits `schedule-save` then `schedule-status`, asserts round-trip, simulates an installer by writing the breadcrumb manually, re-asserts `installed:true`.

---

## 7. Change-control

Any change to this contract during implementation:
1. Open a question in the orchestrator session (not in a workspace).
2. Orchestrator edits this file and commits to the shared branch.
3. Both workspaces `git pull` before adjusting.

This prevents one workspace from silently drifting and the other building against a stale spec.
