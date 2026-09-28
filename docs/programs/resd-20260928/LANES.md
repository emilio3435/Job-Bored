# RESD lanes

Goal: Track the bounded implementation and independent verification of the Dossier resume repair.

Success means: Every named lane has a verified live model pin, a report, a commit or blocker, and integration status.

Stop when: The integrated branch is green and lane worktrees are swept, or a repeated blocker is recorded.

| Lane | Family | State | Worktree | Report |
|---|---|---|---|---|
| ingest | sol | merged; 50 focused tests passed; temporary worktree swept | `fix/resume-dossier-ingest` | `reports/ingest.md` |
| account | sol | merged; 76 focused tests passed; temporary worktree swept | `fix/resume-dossier-account` | `reports/account.md` |
| dossier | opus | merged as `24a540e4`; 46 focused tests passed; temporary worktree swept | `fix/resume-dossier-ui` | `reports/dossier.md` |
| verify | independent Astra review plus integration owner floor; Muse unavailable | baseline-equivalent full floor, one inherited active failure | `fix/resume-dossier-grounding` | `RESULTS.md` |

Model mix and timestamped readings are in `SPEC-RESD-20260928.md`. Grok's diff CLI stalled twice, so independent Astra reviews and the integration owner's full floor supplied review evidence; the verifier-family pin could not be claimed. No publication is authorized.
