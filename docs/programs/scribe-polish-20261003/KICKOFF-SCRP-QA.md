# Lane QA — Scribe browser, PDF and live-provider acceptance (Astra, read-only on product)

Read `KICKOFF-SCRP-_SHARED.md` (ground rules, silent traps) and `SPEC-SCRP-20261003.md` §0–§6 in `docs/programs/scribe-polish-20261003/`. §0 overrides this file. Your own prior audit is `source-evidence/ASTRA-FINDINGS.md`; your probe runners and harness live at `/Users/emilionunezgarcia/Job-Bored/.worktrees/scribe-editor-fix/.lane-evidence/editor-qa-20261003/` (`qa-harness.mjs`, `probe-*.mjs`). Other lanes now: BE, FE, UX (Sol) build on their own branches; you change **no tracked file** — you write only under this worktree's `.lane-evidence/`.

Goal: give the host independent browser evidence — a baseline now, and candidate acceptance after the host freezes the integration branch.

Success means:
- **Phase 1 (now, on this worktree's HEAD = the integration base):** copy your runners into `.lane-evidence/qa/` and re-run the six repro classes (orphan close/switch/resubmit, early-stop, pdf-unavailable, stale, recovery, mobile) for both docs to confirm each boundary still applies on this base; record pass/fail per case in `QA-BASELINE.md`. Then probe the paths the audit never proved: the score modal's **Fix this / Apply / Repair** filling the Scribe composer (`role-materials.js` `openScore`/`fill`, `materials-score.js`), for both docs at 1440 and 375 — record what happens and any defect with exact steps. Check whether a **real** installed-browser PDF can be produced in your environment (which dependency, which binary) and whether a live provider is configured for a fictional count-only sample — record availability, do not run live calls yet.
- **Phase 2 (only after the host writes `CANDIDATE <sha>` into `docs/programs/scribe-polish-20261003/PROGRAM-LOG.md` on the integration branch, or messages you):** `git checkout --detach <sha>` in this worktree (it is yours alone), install nothing new (node_modules is linked), then:
  - Re-run every repro class against the candidate; each former failure must now pass for both docs (ASTRA-01..05, RISK-01 browser symptom).
  - F1/F2 acceptance both docs: selection pill/payload, popover keyboard, stale selection refusal, manual edit → one version after debounce, locked/new-fact/stale/paste cases; 1440 and 375; keyboard-only; focus return; `scrollWidth` at 375.
  - Score-modal Fix/Apply/Repair → editor on the candidate.
  - Real PDF gate (if available): save a fictional edit per doc, download/reopen the PDF, check changed text, page count, fonts, sibling unchanged; plus the PDF-unavailable fault copy ("Text saved as vN. PDF unavailable.").
  - Live-provider sample (if configured): 2 fictional requests per doc → visible preview, accepted saved text, reopen persistence, version provenance, sibling equality. Credentials stay in memory/env; record counts only.
  - Screenshots for every case into `.lane-evidence/qa/candidate/`; a ranked findings list with exact steps for anything that fails.
- Write `QA-REPORT.md` (in `.lane-evidence/`) and keep `LANE-REPORT-QA.md` current. Any gate you cannot run is reported as **unavailable** with the exact reason — never a mock substituted for real proof.
- Report first line `DONE` | `BLOCKED: <why>`.

Stop when: Phase 2 is complete and reported, or you are blocked. Between Phase 1 and Phase 2, write `PENDING — phase 1 done, waiting for CANDIDATE` as the report's first line and wait (check `PROGRAM-LOG.md` on the integration branch every ~5 minutes: `git -C /Users/emilionunezgarcia/Job-Bored.worktrees/scribe-polish-integration show HEAD:docs/programs/scribe-polish-20261003/PROGRAM-LOG.md | grep CANDIDATE`).

## Fence
Writes only under `/Users/emilionunezgarcia/Job-Bored.worktrees/scrp-qa/.lane-evidence/`. No tracked-file edits, no commits, no `git add`.

## Non-negotiables
- Fictional data only (Alex Example / Acme); isolated `JOBBORED_PROFILE_PATH`/`JOBBORED_LLM_CONFIG_PATH`; fresh browser contexts; never the live stack, `~/.jobbored`, the serving checkout, or ports 8080/3847/8644.
- No credentials, request headers or customer text in any file.
- Real browser + real service for every claim you mark "pass"; label mocked model replies as mocked.

## Definition of Done
QA-REPORT.md with: per-ID before (baseline) / after (candidate) table for both docs, F1/F2 acceptance table, score-modal path results, real-PDF result or "unavailable: <reason>", live-provider result or "unavailable: <reason>", command lines and literal outputs, screenshot paths. First line `DONE`.
