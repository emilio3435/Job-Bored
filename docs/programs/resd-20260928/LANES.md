# RESD lanes

Goal: Track the bounded implementation and independent verification of the Dossier resume repair.

Success means: Every named lane has a verified live model pin, a report, a commit or blocker, and integration status.

Stop when: The integrated branch is green and lane worktrees are swept, or a repeated blocker is recorded.

| Lane | Family | State | Worktree | Report |
|---|---|---|---|---|
| ingest | sol | running | `Job-Bored.worktrees/RESD-ingest` | `.lane-evidence/LANE-REPORT-ingest.md` |
| account | sol | running after approved package/schema fence extension | `Job-Bored.worktrees/RESD-account` | `.lane-evidence/LANE-REPORT-account.md` |
| dossier | opus | merged as `24a540e4`; focused floor green | `Job-Bored.worktrees/RESD-dossier` | `reports/dossier.md` |
| verify | muse | queued after integration | integration snapshot | `reports/VERIFY.md` |

Model mix and timestamped readings are in `SPEC-RESD-20260928.md`. No publication is authorized.
