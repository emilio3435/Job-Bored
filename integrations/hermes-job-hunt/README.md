# Hermes Job Hunt OS (JHOS)

Hermes-orchestrated automation that pairs with [Job-Bored](../browser-use-discovery/) discovery and the Pipeline Google Sheet.

**Runtime home (per machine):** `~/.hermes/job-hunt/` — copy or symlink this directory there after clone, or run scripts from this repo path and set `JHOS_HOME`.

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
# 1. Sync repo
git pull origin main

# 2. Install Hermes job-hunt home (choose one)
mkdir -p ~/.hermes
rsync -a integrations/hermes-job-hunt/ ~/.hermes/job-hunt/

# 3. Start discovery worker (from repo root)
cd integrations/browser-use-discovery
npm install
# Configure .env from .env.example (never commit secrets)
node --experimental-strip-types src/server.ts

# 4. Dry-run apply orchestrator
cd ~/.hermes/job-hunt/scripts
python3 apply-orchestrator.py --dry-run --job-url '<url>' --task-id manual-test
```

## Current strategy (2026-05-27)

**Materials-first:** Discovery → Researching → Hermes drafts dossier + resume + cover letter → JobBored dashboard review/download → manual apply.

Automated form submit (Phase 7 universal filler) is shelved. See `HANDOFF-2026-05-27-materials-first-jobbored-ux.md`.

## Related commits

- `4b0e275` — Discovery worker: directional prompting, profile-aware scoring, pipeline schema
- `8d164bd` — Default worker-config targeting (Phase 5)
- This integration — Hermes Python scripts, templates, handoffs (Phases 4–7)
