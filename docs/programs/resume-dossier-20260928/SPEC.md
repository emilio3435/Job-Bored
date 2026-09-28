# Resume dossier diagnosis

Goal: Identify why recent Dossier resume drafts underuse available evidence and specify a safe fix.

Success means:
- Two Luna investigations independently trace recent saved run structure and the active generation path, respectively.
- A Sol synthesis distinguishes confirmed causes from inference and specifies implementation with red-first verification.
- Reports contain structural counts, hashes, paths, and code references without personal resume, contact, or posting text.

Stop when: The cause and fix plan are reviewable, or a repeated access blocker prevents the diagnosis.

## §0 Locked decisions

| Decision | Choice | Basis |
|---|---|---|
| Scope | Read-only diagnosis and a written fix plan | User asked to investigate, identify a fix, and spec implementation. |
| Investigation model | bench (Luna) at high effort | User explicitly requested Luna agents. |
| Evidence | Recent local application runs and current code | The saved run directories exist under the local applications root. |
| Privacy | Structural summaries only | The saved artifacts contain personal career data. |
| Publication | Local files and branch only | Repo guidance reserves publication for Emilio. |

## Floor commands

Run and paste exact output in the final report: `git status --short --branch`; focused tests selected after the cause is known; `gitleaks protect --staged --redact` if a commit is staged. Record any unavailable gate precisely.

## Lanes

- `runs` · flat · Luna · Read the newest local Dossier materials runs and trace their saved inputs, ledgers, selection, and draft metadata. Report where evidence first disappears using counts and hashes. Read-only.
- `code` · flat · Luna · Trace the active dashboard request through server intake, ledger, selection, drafting, and rendering. Compare its current branch to recent run provenance and propose a minimal reproducer. Read-only.
- `synthesis` · flat · Sol · Reconcile both reports, inspect disputed code directly, and write the diagnosis and implementation plan. Owns only program documents.

The lanes share no mutation path. The run lane owns artifact evidence; the code lane owns code-path evidence. Both return paths and exact line references for independent Sol verification.
