# Handoff — Main Machine Setup (JobBored + Hermes JHOS)

**For:** Agent on Emilio's primary computer with the JobBored repo  
**From:** cmux merge orchestrator (Phases 4–7 on secondary Mac)  
**Date:** 2026-05-27  
**Repo:** https://github.com/emilio3435/Job-Bored.git

---

## What was merged (GitHub is current)

| Commit    | Phase | Summary                                                                                                                          |
| --------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| `4b0e275` | 2+4   | Discovery worker: directional prompting, profile-aware scoring, pipeline column X, SerpApi hardening                             |
| `8d164bd` | 5     | Default `worker-config.json` discovery targeting                                                                                 |
| `df7ca8c` | 4–7   | **`integrations/hermes-job-hunt/`** — all Python scripts, templates, handoffs, tests (was only on disk at `~/.hermes/job-hunt/`) |
| `c69cbe7` | —     | Gitignore cleanup (no `__pycache__` in repo)                                                                                     |

**Pull first:**

```bash
cd ~/path/to/Job-Bored   # your local clone
git pull origin main
```

---

## Workspace session map (cmux)

| Workspace   | Brief summary                                                                                              | Committed?                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Phase 4** | Submit pipeline: `jhos_submit.py`, `apply-orchestrator.py`, Gate 1/2, Workday blocker, dry-run CrowdStrike | Yes → `df7ca8c` + earlier `4b0e275` (worker only)                                                        |
| **Phase 5** | Discovery cron 7:00 CT, pipeline status 7:30, `gate1-approve.py`, Gate 1 via Telegram YES                  | Yes → scripts in `df7ca8c`, worker config in `8d164bd`                                                   |
| **Phase 6** | Universal filler architecture (DOM extractor + LLM + Playwright); killed 25-script ATS plan                | Yes → `universal_filler.py`, handoffs in `df7ca8c`                                                       |
| **Phase 7** | **Pivot:** materials-first — Hermes drafts dossier/resume/CL; JobBored shows review/download; manual apply | Yes → `HANDOFF-2026-05-27-materials-first-jobbored-ux.md`, `PLAN-2026-05-27-pivot-to-materials-first.md` |

---

## Setup on main machine (ordered)

### 1. Clone / update Job-Bored

```bash
git clone https://github.com/emilio3435/Job-Bored.git
cd Job-Bored
git pull origin main
```

### 2. Install Hermes runtime home

```bash
mkdir -p ~/.hermes
rsync -a integrations/hermes-job-hunt/ ~/.hermes/job-hunt/
```

Scripts expect worker config at:

```text
$HOME/GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/state/worker-config.json
```

Adjust paths in `gate1-approve.py`, `pipeline-status.py`, `discovery-trigger.sh` if your clone lives elsewhere.

### 3. Browser-use discovery worker

```bash
cd integrations/browser-use-discovery
cp .env.example .env
# Fill: BROWSER_USE_API_KEY, sheet ID after onboarding, service account path
npm install
node --experimental-strip-types src/server.ts
# Health: curl http://127.0.0.1:8644/health
```

**Secrets (never commit):**

- `integrations/browser-use-discovery/.env`
- `integrations/browser-use-discovery/service-account-key.json`
- `~/.hermes/google_token.json`

On secondary Mac a service account key was created for `jobbored@elio-ai-prod.iam.gserviceaccount.com` — copy the key file securely or regenerate on main.

### 4. Hermes agent local patch (optional)

VibeProxy + Codex routing fix (prevents Claude models hitting Codex endpoint):

```bash
cd ~/.hermes/hermes-agent
git apply /path/to/Job-Bored/integrations/hermes-job-hunt/patches/hermes-codex-model-guard.patch
# Or: branch emilio/local-codex-vibeproxy exists on secondary Mac only (not pushed to NousResearch upstream)
```

### 5. VibeProxy (if using Hermes CLI with Claude via proxy)

- App in Login Items; ports **8317** + **8318**
- `hermes doctor` should show vibeproxy healthy

### 6. Cron / Hermes jobs

Re-register on main (IDs differ per machine):

| Job                | Schedule        | Script                                            |
| ------------------ | --------------- | ------------------------------------------------- |
| JobBored Discovery | 7:00 AM Central | `~/.hermes/job-hunt/scripts/discovery-trigger.sh` |
| Pipeline Status    | 7:30 AM Central | `~/.hermes/job-hunt/scripts/pipeline-status.py`   |
| Follow-up Monitor  | (existing)      | `followup-monitor.py`                             |

**Pause/replace:** Gate 2 Researching watcher (`e48e736a1aa0` on old machine) — redesign for **materials-ready**, not auto-submit. See materials-first handoff.

---

## Primary agent read order

1. `integrations/hermes-job-hunt/HANDOFF-2026-05-27-materials-first-jobbored-ux.md` — **current strategy**
2. `integrations/hermes-job-hunt/PLAN-2026-05-27-pivot-to-materials-first.md`
3. `integrations/hermes-job-hunt/HANDOFF-2026-05-27-phase7-onwards.md` — universal filler (shelved, optional later)
4. `integrations/hermes-job-hunt/HANDOFF-2026-05-26-session3.md` — full system state through Phase 5
5. `~/.hermes/plans/jobbored-hermes-master-plan.html` — copy from secondary or regenerate

---

## Next implementation tasks (materials-first)

Do **not** prioritize automated form submit.

| #   | Task                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Freeze workflow: Discovery → Researching → Hermes drafts → JobBored review → manual apply                                     |
| 2   | Implement `manifest.json` writer per `applications/<slug>/` (schema in materials-first handoff)                               |
| 3   | Replace Gate 2 submit watcher with **Researching → auto-draft → materials-ready** notification                                |
| 4   | JobBored UI: dossier panel + Application Docs cards + preview/download from manifest                                          |
| 5   | Backfill manifests for Chartis, TEGNA, CrowdStrike folders (copy `applications/` from secondary via secure sync — not in git) |

---

## Application artifacts (not in GitHub)

Generated PDFs/HTML under `~/.hermes/job-hunt/applications/` were **excluded** from the repo (PII). Sync separately:

- `chartis-senior-digital-marketing-consultant/`
- `tegna-digital-sales-manager/`
- `crowdstrike-director-sales-enablement-specialists/`

Use AirDrop, iCloud, or rsync between machines.

---

## Verify end-to-end

```bash
# Worker
curl -s http://127.0.0.1:8644/health

# Gate 1 dry-run
python3 ~/.hermes/job-hunt/scripts/gate1-approve.py --dry-run --list-new

# Apply orchestrator dry-run (no submit)
python3 ~/.hermes/job-hunt/scripts/apply-orchestrator.py \
  --dry-run --job-url 'https://example.com/job' --task-id smoke

# pytest
cd ~/.hermes/job-hunt && python3 -m pytest tests/ -q
```

---

## Stopping condition

Main machine is ready when:

- [ ] `git pull` at `df7ca8c` or later
- [ ] `~/.hermes/job-hunt/` synced from `integrations/hermes-job-hunt/`
- [ ] Discovery worker healthy on `:8644`
- [ ] Sheet writes work with OAuth + service account
- [ ] Agent has read materials-first handoff and started manifest + dashboard contract work
