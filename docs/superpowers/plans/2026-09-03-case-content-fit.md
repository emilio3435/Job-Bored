# The Case — Content Fit Plan (for /orchestrate)

**Spec:** `docs/superpowers/specs/2026-09-03-case-content-fit-design.md` (locked decisions §9)
**Program prefix:** `casefit`
**Integration branch:** `feat/casefit` from `origin/main` (58366b6). Lanes: `feat/casefit-<lane>`, worktrees at `../Job-Bored.worktrees/casefit-<lane>`.
**Orchestrator:** Fable 5.1 — orchestrates only, runs the floor itself, merges, never implements in a lane.
**Kickoffs:** `docs/programs/casefit/GROUND-RULES.md` + `KICKOFF-<lane>.md` (written by the orchestrator from this plan before any spawn).

## 1. Worker stack for this run (Emilio's per-run directive, 2026-09-03)

| Lane | Kind | Model | Vehicle | Launch |
|---|---|---|---|---|
| **F1 board** | FE | **Spark 1.3** | native `muse` CLI (Meta seat) | `muse exec --model muse-spark-1.3-contributor --reasoning-effort xhigh --workspace <wt> --trust-workspace --approval-mode never --disable-sandbox --prompt-file <wt>/.lane-evidence/kickoff-F1.md` |
| **M2 model-truth** | BE/test | GPT 5.6 Sol xhigh | Codex | `codex -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -c sandbox_workspace_write.network_access=true -a never -s workspace-write "<prompt>"` |
| **S3 upstream-truth** | BE/test | GPT 5.6 Sol xhigh | Codex | same as M2 |
| **T4 real-shape proof** | test | GPT 5.6 Sol xhigh | Codex | same as M2 |
| final verification | verify | Grok 4.6 high | Grok Build CLI | `grok -m grok-4.6 --reasoning-effort high --always-approve "<prompt>"` |
| rate-limit fallback (any lane) | — | Grok 4.6 xhigh | Grok Build CLI | `grok -m grok-4.6 --reasoning-effort xhigh --always-approve "<prompt>"` |

- **No Opus lanes this run; no Fable lanes ever.** `ps -o args= -p <pid>` must show `muse-spark-1.3-contributor` for F1 and `gpt-5.6-sol` for M2/S3/T4 before the lane is left alone.
- **Muse preflight (mandatory, before F1 spawns):** run a 2-minute probe in a scratch worktree — `muse exec … "run: npm test -- --grep 'role-case-render' ; then create .lane-evidence/PROBE.txt containing the summary line"` — and confirm (a) the model id on the process, (b) the test process bound loopback and finished, (c) the file was written. If (b) fails with the sandbox on, keep `--disable-sandbox`; if `--approval-mode never` still prompts, add `--user-input-auto-resolve`. Record the working flag set in `GROUND-RULES.md`; spawn F1 with exactly that set.
- The `muse` CLI has no `--effort` alias: `--reasoning-effort xhigh`. It reads the prompt from `--prompt-file`, so the kickoff runner is copied into the worktree's `.lane-evidence/` (gitignored) — never referenced by absolute path outside the workspace.
- `claude-muse` (Claude Code over the Meta endpoint, `bypassPermissions`) is **not** the vehicle here; Emilio said native `muse` CLI. It stays available as a manual fallback only if `muse exec` cannot run headless, and its use must be reported.
- cmux name: `CASEFIT · <lane task> · <model> · 09-03`, e.g. `CASEFIT · board-fold · spark · 09-03`.

## 2. Lane fences (absolute — a lane that edits outside its fence is reverted at integration)

| Lane | Owns | Consumes | Delivers first |
|---|---|---|---|
| **M2 model-truth** (serial-first) | `role-case-model.js`, `jb-text.js`, `structured-output-validator.js`, `keyword-profile-match.js` (only the new `findProfileEvidence` export + the alias table export), `tests/role-case-model.test.mjs`, `tests/jb-text.test.mjs`, `tests/dossier-structured-output.test.mjs`, `tests/keyword-match-analyze-job.test.mjs` (extend) | spec §3.2–3.5, §4 | **Commit 1** = the schema delta in §4 with `visibleCount`, ranked+deduped `requirements`, `evidence: null` everywhere, `youHave.source ∈ {scorecard, none}`. F1 is gated on this commit appearing. |
| **F1 board** | `role-case.js`, `role-case.css`, `role-materials.js` **lines 715–760 only** (doc-row label rule §3.7), `tests/role-case-render.test.mjs`, `tests/role-case-a11y.test.mjs`, `tests/role-materials.test.mjs` (the one label case) | M2 commit 1 (merge it into the F1 branch before starting); spec §3.1, 3.2 renderer half, 3.3 renderer half, 3.7 | `data-lanes` + `align-items: start` as commit 1, so T4 can assert on it early. |
| **S3 upstream-truth** | `server/shared/job-scraper-core.mjs`, `server/shared/text-normalize.mjs`, `integrations/browser-use-discovery/src/sheets/pipeline-writer.ts`, `job-posting-insights.js` (prompt strings only), their tests (`tests/job-scraper-block-text.test.mjs`, `integrations/browser-use-discovery/tests/sheets/pipeline-writer.test.ts`, `tests/insights-normalization.test.mjs` (extend)) | spec §3.4 (server twin), 3.5 prompt, 3.6 | independent; no one waits on it |
| **T4 real-shape proof** | `tests/e2e-fixtures/real-shape-posting.mjs` (new), `tests/e2e-smoke/case-dossier.spec.mjs` (new `describe` only — existing assertions untouched), `docs/programs/casefit/LIVE-CHECK.md` | F1 commit 1 + M2 commit 1 for green; writes the fixture and red assertions first | the fixture file, so M2 and F1 can import it into node:vm tests |

Shared-file rule: `keyword-profile-match.js` is touched by **M2 only**; `role-materials.js` by **F1 only** in the stated range; `jb-text.js` by **M2 only** — S3 mirrors helpers into `text-normalize.mjs` with the same names and a shared test vector file `tests/fixtures/text-normalize-vectors.json` that S3 creates and M2 consumes (S3 lands it in its first commit).

## 3. Items per lane (each is: failing test naming the real §1 string → fix)

**M2**
1. `stripControlTokens`, `isFragment`, `splitHeadingTail` in `jb-text.js` with the §1 strings as vectors.
2. `cleanItem`/`cleanList` use them; `polluted` set when anything was dropped.
3. `buildCaseModel`: rank missing→partial→found→unknown, header-tail split, chip dedupe rule (§3.2), `visibleCount: 8`, `stack`/`stackHidden` split at 12.
4. `findProfileEvidence(term, index)` in the analyzer; `analyzeJob` result terms carry `evidence`; the model attaches evidence to found/partial requirements.
5. `buildYouHave`: keyword branch removed; scorecard `topStrengths` filtered to ≥ 3 significant tokens; gaps collapse prefix-duplicates; `isFragment` applied.
6. `collectDeps` builds `sheetPointCounts` from `getPipelineRawRows()` column Q via `_parseTalkingPointsFromCard`-equivalent splitting; model drops sheet points seen on ≥ 2 rows.

**F1**
1. `data-lanes` + `align-items: start`; column rules per count; 1080px unchanged.
2. Requirements: first 8 + `.case__more[hidden]` + `toggle-requirements` button (`aria-expanded`, `aria-controls`); nice-to-haves inside `.case__more` when collapsed; no button when total ≤ 8.
3. Chips: 12 + `+N more` (`toggle-stack`).
4. Evidence line under marked requirements (`.case__req-ev`), serif 12.5px muted, none on missing/unknown.
5. `You have`: strengths list only when items pass the model; lane hides on `none` (already).
6. §3.7 labels: `Add a date`, `Add salary`, follow-up empty-state span, doc-row single label.
7. Every new rule scoped under `body.jb-v2 [data-region="role"] .case`; `node tools/lint-tokens.mjs --quiet` → 0.

**S3**
1. `text-normalize.mjs`: the three helpers, byte-identical behaviour to M2's via the shared vector file.
2. `guessRequirementsFromText`: a heading-shaped line (no terminal punctuation, ≤ 6 words, Title Case) ends the current item and is not pushed; `splitHeadingTail` applied to every pushed bullet.
3. `pipeline-writer.ts`: local calendar day for Date Found; test pins a 23:50 America/Chicago instant and expects the same day.
4. `job-posting-insights.js`: `talkingPoints` + `fitAngle` voice rule (§3.5); a test asserts the prompt text contains the rule and that `list(parsed.talkingPoints, 6)` is unchanged.

**T4**
1. Fixture: 25 requirements (incl. two glued headers, one `[<|"|>` token), 21 stack, 3 nice-to-haves, scorecard with the truncated-triplet gap, sheet talking point duplicated on 3 rows.
2. Playwright `describe("real-shape posting")`: lane-height ratio ≤ 1.6; ≤ 8 visible `.case__req li`; toggle reveals 25 and `aria-expanded` flips; `[<|` absent; `data-lanes` equals rendered lanes; screenshots to `.lane-evidence/` only.
3. `LIVE-CHECK.md`: the 90-second check on Emilio's real sheet (open CSC Generation, expect the board in ≤ 2 screens, no fragments, evidence lines present).

## 4. Non-negotiables (all lanes; the silent-failure traps go in GROUND-RULES)

1. **Test-first**; never weaken an assertion; a fixture that encoded the bug is fixed and said so.
2. **node:vm harness trap:** evaluate `jb-text.js` before any consumer in every sandbox, or the model silently falls back to `String(x).trim()` and every new helper is a no-op that still passes.
3. **Cascade trap (F1):** single-class rules lose to `body.jb-v2 h3/p`; scope everything.
4. **Playwright trap (T4):** `test.use({reducedMotion})` inside a describe never reaches the page — use `page.emulateMedia` and assert `matchMedia`.
5. **Codex sandbox trap (M2/S3/T4):** commits can fail on `index.lock`; leave green work as dirt + `LANE-REPORT-<lane>.md` and the integrator rescue-commits it.
6. **Frozen (§5)**: any diff touching a `jb:*` event, Sheet Interface A, `recruiter-strip.js`, an existing `data-action`, or the enrichment schema field names is reverted.
7. **Report first:** `LANE-REPORT-<lane>.md` created before the first edit with the five headings, filled as work lands. Section 4 holds pasted floor output, not prose.
8. Commit locally, never push, scratch in `.lane-evidence/`, delete nothing.

## 5. Floor (each lane pastes it; the orchestrator re-runs it per lane before merge and after each merge)

```bash
npm test && npm run lint:js && npm run test:contract:all && npm run typecheck:server
npm run smoke:jb-v2 && node tools/lint-tokens.mjs --quiet
npm run test:e2e-smoke && npm run test:e2e-journey
```
S3 additionally: `cd integrations/browser-use-discovery && npm test`.

## 6. Sequence

1. Orchestrator: branch `feat/casefit`, write GROUND-RULES + four kickoffs, run the **muse preflight** (§1), add `.lane-evidence/` and `LANE-REPORT-*.md` to `.gitignore` if not already.
2. Spawn **M2** alone. Gate: its commit 1 (schema delta) appears and `npm test` is green on it.
3. Merge M2 commit 1 into `feat/casefit`; spawn **F1** (Spark via muse), **S3**, **T4** in parallel, each branched from that point.
4. Watch commits + dirt + reports; nudge with a finish list at turn-end; at ~60% context tell a lane to commit green work, write its handoff, stop; respawn from the doc.
5. Integrate in order **M2 → F1 → S3 → T4**, floor after each. Conflicts are fixed in the losing lane's branch, never hand-stitched.
6. Grok verification pass on the integrated branch: rerun the T4 suite, open the real-shape fixture in the hermetic app, and screenshot the board at 1240 and 720 into `.lane-evidence/`.
7. Report to Emilio: what shipped, what was verified by the orchestrator vs claimed, anything unverified. **Push, PR and merge only on his word.** Then sweep per the cleanup policy, scoped to `casefit`.

## 7. Definition of Done (program)

- Floor green on `feat/casefit` at the integrated head, run by the orchestrator.
- T4's real-shape suite green; the §1 strings appear in tests as inputs and nowhere in rendered output.
- `LIVE-CHECK.md` executed by Emilio on the real sheet (the only unautomated proof).
- Every lane report's section 4 holds real floor output; the four lanes ran on the models in §1, verified on the process.
