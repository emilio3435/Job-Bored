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

`setup:hermes` creates/uses `~/.hermes/job-hunt/.venv`, installs
`requirements.txt`, and resolves the resume logo marks (see below). Keep Google
tokens, worker secrets, and service-account paths in ignored local env/token
files only. Doctor output reports whether a secret is configured without
printing the value.

### Resume logos

`resume-template/resume.html` references brand marks by filename
(`assets/logo-<slug>.png`). Those PNGs are **generated, not committed** — on a
fresh clone `setup:hermes` runs `scripts/logo_resolver.py`, which fills
`resume-template/assets/` from `resume-template/logos.json`, resolving each entry
**uploaded file → favicon → omitted**, where the favicon is auto-fetched from
the company's `domain` *or from the company name alone* (Clearbit autocomplete
resolves name→domain, then Google s2 fetches the icon). A mark that can't be
resolved is dropped via `onerror`, never shown as a broken image — so logos are
**automatic by default; uploading is only the fallback** for private brands with
no findable logo. Re-run manually anytime:

```bash
# from ~/.hermes/job-hunt (or the repo's integrations/hermes-job-hunt)
.venv/bin/python3 scripts/logo_resolver.py --template-dir resume-template          # fill gaps
.venv/bin/python3 scripts/logo_resolver.py --template-dir resume-template --force  # re-resolve all
.venv/bin/python3 scripts/logo_resolver.py --template-dir resume-template --offline  # skip network
```

Each `logos.json` entry needs only a `label` (the company/project name) — that
alone auto-resolves a favicon. Add a `domain` to pin the exact site, or an
`upload` (a file in `resume-template/uploads/`) for private brands with no
findable logo. Full backend/UI plan: `HANDOFF-brand-logos.md` (repo root).

## Current strategy (2026-05-27)

**Materials-first:** Discovery → Researching → Hermes drafts dossier + resume + cover letter → JobBored dashboard review/download → manual apply.

Automated form submit (Phase 7 universal filler) is shelved. Treat it as an assisted-apply tool only when Emilio explicitly requests `ASSIST APPLY <company>`. See `HANDOFF-2026-05-27-materials-first-jobbored-ux.md`.

## Related commits

- `4b0e275` — Discovery worker: directional prompting, profile-aware scoring, pipeline schema
- `8d164bd` — Default worker-config targeting (Phase 5)
- This integration — Hermes Python scripts, templates, handoffs (Phases 4–7)
