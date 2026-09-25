# BEAUDIT build — dynamic workflow plan

**Goal:** implement `SPEC-BEAUDIT-20260925.md`, following its §0 decisions and the `MOCKUP.html` targets, as a sequence of Workflow runs. Every build lane is an Opus 5.5 agent at medium effort (§0.9).

**Success means:**
- Every P0 and P1 row in `REGISTER.md` is fixed in a merged lane. Each has a regression test that failed before the fix, and Muse returns `FIXED` for its audit reproducer.
- Each wave's integration branch is green on the full floor plus e2e.
- Each wave's integration branch carries a clean `gitleaks` run.
- Each wave's integration branch has a build report, then a PR that Emilio opens.

**Stop when:**
- all four runs are merged; or
- a run halts on a quota wall, a red lane or an unmet gate that only Emilio can clear. The run's return value says which.

- **Script:** `build-workflow.mjs`, a Workflow tool script, written but **not run**. Running it spawns many agents, so it waits for Emilio's go.
- **Schemas:** `build-verdict.schema.json` (Muse's build verify) and `review.schema.json` (second-vendor review).
- **Audit reproducers the lanes promote to tests:** `probes/<letter>/`.

## How one lane moves

```
deps merged? ─ no ─▶ deferred (named reason)
gates met?   ─ no ─▶ deferred (e.g. "gate not met: pr102")
      │ yes
      ▼
BUILD   Opus 5.5 medium · own worktree ~/Job-Bored.worktrees/bbuild-<id> · branch fix|feat/beaudit-w<N>-<id>
        red-first tests from the audit probes · floor green · commits carry "Beaudit-Lane: <id>"
      ▼
VERIFY  runner launches Muse (muse-spark-1.3, max, read-only): floor, new tests, every claim's reproducer → FIXED?
      ▼                                        FAIL ─┐
REVIEW  runner launches the second vendor (astra-ro by default; grok when it has balance) on the diff
      ▼                                   blocking ─┤
      │                                             ▼
      │                         REPAIR (same Opus lane, same worktree, only the listed issues) · max 2 rounds → else "red"
      ▼
MERGE QUEUE  one merge at a time into the wave's integration branch: merge --no-commit → full floor (+e2e) → gitleaks → commit or abort
      ▼
dependents start
```

**Dynamic behavior.**
- **Scheduling from the DAG.** Each lane starts the moment its dependencies merge, so there are no wave-wide barriers inside a run.
- **Missing prerequisites defer, they don't crash.** An unmet gate (a PR Emilio hasn't merged) or a dependency missing from `origin/main` defers only the lanes that need it; the rest proceed.
- **Repairs are bounded.** A lane loops through Build → Verify → Review → Repair at most twice before it reports red.
- **The first quota wall halts new work.** A wall on Muse or the review rung stops new builds and verifies, holds in-flight lanes, and returns resume instructions. Emilio picks the next `fleet.md` rung, and the run resumes with `resumeFromRunId`.
- **A completeness critic ends every run.** It lists every P0/P1 row left uncovered or unverified and proposes the next run's args.

**Families.** Every build lane, and every relay agent (preflight, verify runner, review runner, integration runner, close, critic), runs as `model: 'opus', effort: 'medium'`. Two verification steps are relayed to other vendors, because the author's family never verifies its own work:
- **Muse** returns the verdict.
- **The review rung** returns the review.

The Opus relay agents only launch those tools and pass their JSON back.

## Runs, in order

| Run | Args | Integration branch | Lanes | Emilio's gate before this run |
|---|---|---|---|---|
| 1 | `{ waves: [0] }` | `fix/beaudit-p0-containment` | P perimeter · R relay auth · X egress (X after P) | none. This is the incident PR (§0.1) |
| 2 | `{ waves: [1] }` | `feat/beaudit-build-w1` | S sheets · Q AI provider · L lifecycle and contracts · H hermes safety | run 1's PR merged. Land #113, then #107 plus #109's timer line; close #108 and #109 (§0.5). Merge #102 (L). |
| 3 | `{ waves: [2] }` | `feat/beaudit-build-w2` | D discovery · M materials and profile · O ops and hosted · B browser surfaces | run 2's PR merged. Merge #120, or tell the orchestrator to cherry-pick its schemas (M, §0.3). |
| 4 | `{ waves: [3] }` | `feat/beaudit-build-w3` | F1 preview · F6 run history · F5 capture · F8 saved searches · F3 duplicate review · F4 timeline · F7 control center · F9 rescore preview · Z splits and docs | run 3's PR merged |

Each run's preflight refuses to build a lane whose dependency from an earlier wave isn't on `origin/main`. It finds landed lanes by the `Beaudit-Lane:` commit trailer, which enforces the order above. To run a single lane (for example, to retry one red lane), pass `only: ["X"]`.

**Invocation.** Once Emilio says to run it:

```
Workflow({ scriptPath: "docs/programs/beaudit-20260925/build-workflow.mjs",
           args: { waves: [0], stamp: "2026-09-25T07:00", reviewRung: "astra-ro", maxRepairs: 2 } })
```

**Knobs:**
- `waves`: which waves run.
- `only`: a subset of lane ids.
- `reviewRung`: `astra-ro` by default, since Grok returned 402 at 06:19; set `grok` when it has balance.
- `maxRepairs`: 2 by default.
- `integrationBranch`: overrides the default branch name.
- `stamp`: a timestamp for the report, since scripts cannot read the clock.

## Lanes

Claims are `REGISTER.md` ids (a merged row carries its members). The fences are in the script and are disjoint within each wave. Where two lanes share a file, a dependency serializes them.

| Wave | Lane | Claims | After | Gates |
|---|---|---|---|---|
| 0 | **P** Perimeter | E1 (+G2), G3, A1, G4, G10, E17 | — | — |
| 0 | **R** Relay auth (§0.7, §0.4 docs) | G1, G24 | — | — |
| 0 | **X** Egress | C1 (+C2, D15), C8, C9, E8, C16 | P | — |
| 1 | **S** Sheets client (§0.5) | D1–D10, D12, D13, D16–D20, A8 | X | #113, #107 |
| 1 | **Q** AI provider | E15 (+F15), B17, E2, E9–E12, E14, E18 | — | — |
| 1 | **L** Lifecycle and contracts | A2–A5, A7, A9, A12–A18, A20, A21, E7 | P | #102 |
| 1 | **H** Hermes safety (§0.6, §0.2) | H1 (+H17), H2–H13, H15, H16, H18–H20, H22, H23 | — | — |
| 2 | **D** Discovery engine (§0.8) | B1–B4, B6–B13, B18, C3–C7, C10, C12, C13, C15, C17, C18, E3 | Q, L, X | #113 |
| 2 | **M** Materials and profile (§0.3, §0.2) | F1–F14, F16–F20, F21 (claim ledger), E13 | Q, L | #120 |
| 2 | **O** Ops and hosted (§0.4) | G5–G9, G11 (+H14), G12–G16, G19, G20, E5, E6 | L, P | — |
| 2 | **B** Browser surfaces | E4, D11 | L, S | — |
| 3 | **F1** Discovery preview and cost receipt | B20, B23 | D, L | — |
| 3 | **F6** Run history drill-down | A19, C22 | F1 | — |
| 3 | **F5** Capture preview | C19, E20 | F6 | — |
| 3 | **F8** Saved searches (§0.8) | B21 | F1 | — |
| 3 | **F3** Duplicate review | D22 | S, B | — |
| 3 | **F4** Timeline, funnel and receipt | D23, D24, H24 | F3, H | — |
| 3 | **F7** Setup control center | G21, G22, E21 | O, Q | — |
| 3 | **F9** Rescore preview | F23 | M | — |
| 3 | **Z** File splits and docs | B15, B16, C14, G18, A11, G17, E16 | all wave-3 features | — |

In-flight rows land through their own PRs rather than a lane: B5 via #113, G6 via #111 (O takes the residual flap fix), and A6 via #102. A10 is Emilio's PR decision (§0.5). Every other non-feature register row, and every P0 and P1 row, is claimed by exactly one lane; the check `python3` ran against `verdicts/_register.json` found 0 unclaimed and 0 duplicates. The critic re-checks this after each run.

**Backlog.** These feature rows are proposed but not scheduled; add them as wave-3 lanes when wanted: C20 field evidence ledger, H25 recruiter and interview timeline, B22 experiment lab, C21 capture companion, D25 search health dashboard, E22 ATS evidence in the materials workspace, F22 draft run ledger and versions, F24 portable workspace export, G23 port-collision doctor.

## Evidence this plan's control flow works

A dry run executed the script with every `agent()` call stubbed (`scratchpad/dryrun.mjs`). No real agent ran.

```
== wave 0, clean                                 {"merged":3}
== wave 0, X fails verify once then passes       {"merged":3}                     (repair round taken)
== waves 1-3, all gates met, wave 0 landed       {"merged":17}                    71 agent calls
== wave 1, pr102 missing (L deferred)            {"merged":3,"deferred":1}        L=deferred(gate not met: pr102)
== wave 2, lane Q never landed (D and M deferred){"deferred":2,"merged":2}
== waves 1-2, Muse wall during S                 {"walled":1,"held":3,"deferred":4}  halt: Muse quota wall
== wave 0, preflight blocked                     "blocked-preflight"
max concurrent merges: 1 in every scenario; every call pinned to model opus, effort medium (the stub throws otherwise)
```

Scale before repairs: 15 agent calls for run 1 and 71 across runs 2–4. Every repair round adds three calls (build, verify, review).

## Known limits

- **Quota is only partly visible.** Every lane draws on the Claude Max pool, which the preflight reads natively. Muse has no CLI meter; Emilio approved blind Muse runs for BEAUDIT. The Codex pool (astra-ro) is read only if possible. Otherwise the review runner reports a 402 or 429 as a wall.
- **Large lanes may exhaust one agent's context.** The biggest are S, L, D and M, at medium effort. Lanes commit green increments and keep their report current. A lane that dies returns "blocked", and `resumeFromRunId` re-enters the same worktree and continues from its commits.
- **The model pin is recorded, not self-verified.** Workflow agents can't report their own model id. After each run the orchestrator reads the run journal for each agent's model and records `claude-opus-5-5` / medium in `LANES.md`.
- **Publication stays Emilio's.** Pushing, opening PRs, merging PRs (including #102, #107, #113 and #120) and deploying all stay with Emilio. The close agent only prints the commands.
