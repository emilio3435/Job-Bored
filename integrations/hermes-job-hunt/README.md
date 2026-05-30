# Hermes Job Hunt OS (JHOS)

Hermes-orchestrated automation that pairs with [Job-Bored](../browser-use-discovery/) discovery and the Pipeline Google Sheet.

**Runtime home (per machine):** `~/.hermes/job-hunt/`. Install it with
`npm run setup:hermes` from the JobBored repo root. Override paths with:

- `JOBBORED_REPO` (default `~/Job-Bored`)
- `HERMES_HOME` (default `~/.hermes`)
- `HERMES_JOB_HUNT_HOME` (default `~/.hermes/job-hunt`)
- `HERMES_APPLICATIONS_DIR` (default `~/.hermes/job-hunt/applications`)
- `BROWSER_USE_DISCOVERY_WORKER_CONFIG` (default `~/.jobbored/browser-use-discovery/worker-config.json`)
- `BROWSER_USE_DISCOVERY_WORKER_ENV` (default `~/.jobbored/browser-use-discovery/.env`)

## Layout

| Path                                          | Purpose                                                          |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `scripts/`                                    | Submit pipeline, gates, discovery cron helpers, universal filler |
| `profile/`                                    | Canonical candidate profile for drafting/scoring                 |
| `resume-template/` / `cover-letter-template/` | HTML templates (copy per application)                            |
| `HANDOFF-*.md`                                | Session handoffs — read latest before resuming                   |
| `tests/`                                      | pytest for submit/gate scripts                                   |

## Quick start (main machine)

```bash
cd ~/Job-Bored
npm run setup:discovery
npm run setup:hermes
npm run doctor:hermes
```

`setup:hermes` creates/uses `~/.hermes/job-hunt/.venv` and installs
`requirements.txt`. Keep Google tokens, worker secrets, and service-account
paths in ignored local env/token files only. Doctor output reports whether a
secret is configured without printing the value.

## Current strategy (2026-05-27)

**Materials-first:** Discovery → Researching → Hermes drafts dossier + resume + cover letter → JobBored dashboard review/download → manual apply.

Automated form submit (Phase 7 universal filler) is shelved. Treat it as an assisted-apply tool only when Emilio explicitly requests `ASSIST APPLY <company>`. See `HANDOFF-2026-05-27-materials-first-jobbored-ux.md`.

## Related commits

- `4b0e275` — Discovery worker: directional prompting, profile-aware scoring, pipeline schema
- `8d164bd` — Default worker-config targeting (Phase 5)
- This integration — Hermes Python scripts, templates, handoffs (Phases 4–7)
