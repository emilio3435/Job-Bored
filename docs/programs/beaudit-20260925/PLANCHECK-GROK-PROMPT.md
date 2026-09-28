# BEAUDIT plan check (grok, read-only review)

Cite file and line for every claim and paste the command output that proves it. End with a confidence line and a "What I could not verify" section. When unsure, say so rather than answer.

You are the plan checker for the BEAUDIT program. You did not write this spec; Opus did. Your job is to find what is wrong or missing in it before Emilio approves it. You are read-only: do not edit any file, do not run git writes, do not call any network service. You may read any file in this worktree (a checkout of `f227fbb` plus the program folder) and run read-only commands (`grep`, `sed -n`, `wc`, `git show f227fbb:<path>`, `node --check`).

Working directory: the repo root at `f227fbb`. Program folder: `docs/programs/beaudit-20260925/`.

Read, in this order:
1. `docs/programs/beaudit-20260925/SPEC-BEAUDIT-20260925.md` (the spec under review; §4–§9 matter most)
2. `docs/programs/beaudit-20260925/REGISTER.md` (163 root causes; evidence per row)
3. `docs/programs/beaudit-20260925/MOCKUP.html` (read the `CONTRACTS`, `FEATURES` and `LANESPEC` arrays in its script)
4. `AGENTS.md` §"Contract and documentation invariants", `AGENT_CONTRACT.md`, `schemas/`, `examples/`, `docs/CONTRACT-CHANGELOG.md`

Check exactly these five things, and for each give numbered findings:

**A. Contract changes vs the AGENTS.md invariants.** For every contract change in spec §7 and the mockup's `CONTRACTS`: does the spec name every artifact the invariant requires (schema, examples, `AGENT_CONTRACT.md`, `docs/CONTRACT-CHANGELOG.md`, README Sheet Structure for pipeline columns, the test command)? Is each version bump classified correctly (additive vs breaking)? Name any existing caller that would break (grep for it) and whether the spec gives it a migration path. Is `pipeline-update` v2 really needed, or can the Applied requirement be additive?

**B. Missing edges.** Name dependencies between §8 lanes that the spec's "Serial" line omits. For each, cite the two files or functions that make the edge real. Also name register P0/P1 rows that no §8 lane claims, and claims that two lanes both list.

**C. Colliding fences.** For every pair of §8 lanes that could run at the same time, list files both would edit. Use the fence text in §8 plus the evidence paths of the claims each lane owns in `REGISTER.md` (e.g. a lane that owns D5+F5 edits `profile-rescore-worker.mjs`, which lane M also owns). Propose the smallest re-fence that removes each collision.

**D. Features that are really frontend work.** For each §6 feature and each mockup feature, say whether the backend part is real and substantial or whether it is mostly UI on data that already exists. Name which should be re-labelled opus or split.

**E. Estimates.** Challenge the effort on every P0 row and every lane marked L or M. Name the ones you think are low, with the reason in code (size of the function, number of call sites from a grep, test fixtures that must change).

Output format, in plain Markdown, nothing else:

```
# PLANCHECK-GROK — BEAUDIT
## A. Contracts
A1. <finding> — evidence: <path:line or command + output> — proposed change to the spec: <one line>
...
## B. Missing edges
...
## C. Colliding fences
...
## D. Frontend-heavy features
...
## E. Estimates
...
## Summary
<five lines max: what must change in the spec before approval>
Confidence: <high|medium|low> — <why>
## What I could not verify
- ...
```

Keep it under 1,500 words. Every finding must be actionable as a one-line spec edit.
