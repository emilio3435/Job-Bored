# Materials Watcher

Winky's materials watcher turns `pending.json` files from JobBored into Hermes-generated resume and cover-letter artifacts.

## Contract

- Watch root: `/Users/emiliong/.hermes/job-hunt/applications` by default.
- Input: `/Users/emiliong/.hermes/job-hunt/applications/<slug>/pending.json`.
- Required job source: `job-description.md` in the same slug folder.
- Success: required HTML/PDF/analysis/QA artifacts exist, `pending.json` is archived as `pending.json.done.<timestamp>`, and a `✅ MATERIALS READY` Telegram message is posted to thread 48.
- Failure: `pending_error.json` is written, `pending.json` stays in place with `progress.phase = "failed"`, and a `❌ MATERIALS FAILED` Telegram message is posted.

## Run

```bash
cd /Users/emiliong/.hermes/job-hunt
.venv/bin/python3 -m materials_watcher
```

Launchd runs with `PYTHONPATH=/Users/emiliong/.hermes/job-hunt/scripts`.

## Install

```bash
/Users/emiliong/.hermes/job-hunt/scripts/materials_watcher/install-launchd.sh
```

## Uninstall

```bash
/Users/emiliong/.hermes/job-hunt/scripts/materials_watcher/uninstall-launchd.sh
```
