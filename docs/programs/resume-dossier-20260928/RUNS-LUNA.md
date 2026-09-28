# Dossier Run Evidence (Luna)

## Goal / success / stop

- **Goal:** identify the earliest stage where recent Dossier resume runs lose usable career evidence.
- **Success means:** compare recent runs and an earlier control using structural counts, markers, timestamps, hashes, and artifact/code paths only.
- **Stop when:** a causal hypothesis is supported by run evidence or an access blocker repeats twice.

## Privacy boundary

**CONFIRMED:** Inspection read only JSON keys, scalar status/hash/timestamp metadata, file sizes, array/object counts, and employer-reference counts. Resume, profile, contact, and job-posting text was not printed or copied into this report. The run folder names and IDs below are retained as exact artifact paths/identifiers, as requested; their contents were not read as prose.

## Finding

**CONFIRMED:** The newest saved resume runs all load a 21-claim, 2-employer ledger with the same ledger hash, `sha256:425d7f7cc9c13956`. The current central ledger at `/Users/emilionunezgarcia/.jobbored/claim-ledger.json` matches that hash and has 21 claims, but all 21 claims reference only one distinct employer ID. Its structural note is `structure:rules (model fallback: model_sparse)`. The saved ledger's resume source hash is `sha256:381dee64b4acb511…`, matching the truncated resume hash in the newest run metadata.

**CONFIRMED:** The earliest observed evidence reduction is upstream of `claims.load`: the sparse-fallback marker and single-employer attribution already exist in the central ledger that the runs load. `claims.load` reports success and reads the ledger; it does not rebuild it. The newer selection stage then keeps 8–9 claims and drops 11–12, and the outline/draft stages compress those further to one featured item, no earlier items, and five bullets.

**INFERRED:** The leading causal hypothesis is loss during ledger construction or its input-to-structure mapping, with a `model_sparse` fallback retaining claims while collapsing their employer attribution. Selection and drafting amplify the effect, but do not appear to be its earliest point.

**UNKNOWN:** The exact producer of the saved `model_sparse` ledger and whether it corresponds to the current checkout. Current source files in both the task checkout and `fix/materials-false-failures` do not contain that marker. The latest run at 16:00Z predates scraper PID 28721's 16:18Z start. The saved run directories contain no quote-grounded structure snapshot, so the offline parser comparison cannot recreate the ledger without a provider call; that optional comparison remains unverified.

## Run comparison

All timestamps are UTC. Run IDs are listed to locate exact archived artifacts; full SHA-256 values identify each `run.json`.

| Run | Requested → finished | Input and ledger | Selection → outline → draft | Status/fallback markers |
|---|---|---|---|---|
| Figma resume, `mr_20260928160005_figma-marketing-engineer_37b6` | 2026-09-28 16:00:05.776Z → 16:00:22.673Z | Resume `sha256:381dee64b4acb511…`, 7,945 chars; ledger `sha256:425d7f7cc9c13956`, 21 claims / 2 employers; JD `sha256:660f80dd06415a49…`, 1,164 words | 9 kept / 11 dropped → 1 featured / 0 earlier → 5 bullets / 0 earlier | Resume used from request (`current`). QA first `failed`, then retry reached `review`; publish `ok`. Ledger's central status note is `model_sparse`. `run.json` SHA-256 `e1b8566fab8649c93abc2126f37f7287d5ab7395abd7217b2005e3d3c3a0603b`. |
| Figma resume, `mr_20260928155724_figma-marketing-engineer_ffae` | 2026-09-28 15:57:24.219Z → 15:57:37.009Z | Same resume and ledger hashes/counts as above; same JD hash/word count | 9 / 11 → 1 / 0 → 5 / 0 | Request was marked garbled; fallback used saved resume (`resume_garbled`). QA `review`; publish `ok`. `run.json` SHA-256 `5c88ccae92380c80b5a01a459024d67229a0f3a9020b857ba7aa406e4c8c1dad`. |
| Remote Quest resume, `mr_20260928123615_remote-quest-jobs-remote_27f1` | 2026-09-28 12:36:15.333Z → 12:36:27.899Z | Same resume and ledger hashes/counts; JD `sha256:68aa8633107e8bcd…`, 343 words | 8 / 12 → 1 / 0 → 5 / 0 | Resume source `file`, used from request (`current`); QA `review`; publish `ok`. `run.json` SHA-256 `2e449ed9b8186098d8032a4a5a0125263f9c1ef7ab54b81862a2ddfd571ad358`. |
| Earlier successful control, Darkroom resume, `mr_20260928051652_darkroom-director-of-med_d7fa` | 2026-09-28 05:16:52.304Z → 05:17:15.097Z | Resume 7,007 chars; ledger `sha256:e5738d11455778d1…`, 22 claims / 5 employers, builder version 4 | 12 / 8 → 2 / 2 → 8 / 2 | QA `pass`; stages completed `ok`. `run.json` SHA-256 `fe9f0bdadbe1be2d7d12f1004138188247f236cf9762f778acae06bdcad3b716`. This is a cross-JD historical control, so it demonstrates the structural contrast but does not isolate job-specific selection behavior. |

**CONFIRMED, additional replication:** The 2026-09-28 08:01:10.870Z resume run `mr_20260928080110_scale-ai-frontier-agents_acf1` is the earliest inspected archived run with the current ledger hash. It also loads 21 claims / 2 employers, keeps 9 / drops 11, outlines 1 featured / 0 earlier, drafts 5 / 0, and ends QA `review`. Its `run.json` SHA-256 is `ae1022c68d690cee348325b0ec3f0b3f44cdeac9c030ee7650daea354c278d4a`.

**CONFIRMED, adjacent feature:** The Figma run requested at 15:56:04.617Z is `cover_letter`, not `resume`; it uses the same ledger and records request-garbled fallback. Its zero resume bullets are not counted as a resume output comparison.

## Artifact and code paths

**CONFIRMED:** Recent run evidence is in these exact paths:

- `/Users/emilionunezgarcia/.jobbored/applications/figma-marketing-engineer/runs/mr_20260928160005_figma-marketing-engineer_37b6/{run.json,selection.json,outline.json,draft.json,resume-source.json,qa.resume.json}`
- `/Users/emilionunezgarcia/.jobbored/applications/figma-marketing-engineer/runs/mr_20260928155724_figma-marketing-engineer_ffae/{run.json,selection.json,outline.json,draft.json,resume-source.json,qa.resume.json}`
- `/Users/emilionunezgarcia/.jobbored/applications/remote-quest-jobs-remote-ai-solutions-engineer-remote/runs/mr_20260928123615_remote-quest-jobs-remote_27f1/{run.json,selection.json,outline.json,draft.json,resume-source.json,qa.resume.json}`
- `/Users/emilionunezgarcia/.jobbored/applications/scale-ai-frontier-agents-engineer-applied-ai/runs/mr_20260928080110_scale-ai-frontier-agents_acf1/{run.json,selection.json,outline.json,draft.json,resume-source.json,qa.resume.json}`
- `/Users/emilionunezgarcia/.jobbored/applications/darkroom-director-of-media/runs/mr_20260928051652_darkroom-director-of-med_d7fa/{run.json,selection.json,outline.json,draft.json,resume-source.json,qa.resume.json}`
- Central ledger: `/Users/emilionunezgarcia/.jobbored/claim-ledger.json` (file SHA-256 `2621f8c51535c2dcc69d71ea9d47f83adbf20a9704e2b137530b31b2efadae28`; ledger hash `sha256:425d7f7cc9c13956`; built at `2026-09-28T07:58:10.397Z`).

**CONFIRMED:** The current checkout's relevant path is `server/materials-ledger-build.mjs:368` (`ensureLedger`) and `server/materials-pipeline.mjs:202` (`claims.load`) / `:263` (`claims.score`) / `:272` (`claims.select`) / `:290` (`outline`). In `fix/materials-false-failures`, `server/materials-resume-structure.mjs` has no pure raw-resume parser export; the pure `buildLedger` requires a quote-grounded structure when resume text is present. The archived run directories have only `resume-source.json`, not that structure artifact, so an offline parser replay would require a provider call and is not comparable from saved inputs. The parser replay is marked **UNKNOWN / unverified**.

**CONFIRMED:** The current ledger was built at 07:58Z; its source profile timestamp is 07:32Z and resume timestamp is 07:31Z. The latest relevant resume run finished at 16:00Z. PID 28721 started at 16:18Z in `Job-Bored/server`, after the archived runs; its start cannot establish their runtime revision.

## Safe next diagnostic step

**INFERRED:** Once a revision-matched structure artifact is available, re-run the pure ledger builder from the exact archived source profile/resume plus that structure. Compare claim count, distinct employer attribution, and model-fallback status before selection. A red-first implementation plan should preserve the raw structured-stage artifact and assert that sparse fallback is explicit and cannot silently publish a collapsed employer mapping. The current evidence does not establish a numeric expected claim count for every profile, so the regression should anchor on source-to-claim attribution and fail closed on sparse structure rather than hard-code 21 or 22.

## Floor command and output

The task SPEC names `git status --short --branch`; it was run read-only. The workspace is already on `chore/resume-dossier-diagnosis` and contains many unrelated untracked program artifacts. The lane-scoped output is:

```text
$ git status --short --branch -- docs/programs/resume-dossier-20260928/RUNS-LUNA.md
## chore/resume-dossier-diagnosis
?? docs/programs/resume-dossier-20260928/RUNS-LUNA.md
```

**CONFIRMED:** No focused tests were run because this was a read-only diagnosis lane and no implementation changed. `gitleaks protect --staged --redact` was not run because nothing was staged.
