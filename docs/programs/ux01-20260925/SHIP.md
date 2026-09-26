# UX01 ship train

**Goal.** Land UX01 and its three upstreams on `main` in one PR and deploy it: lanes A, C, D and the cleanup (already merged), #104, #102, casefit, held lanes F, B, E with the C11 server half, and DS-08.

**Success means:**
- `feat/ux-zero-to-one` contains all of the above with every conflict resolved and both sides' intent kept.
- The full local floor is green on its head, gitleaks is clean, and an independent review of the integrated diff reports no blocking findings.
- One PR to `main` passes the 7 required checks and merges with a merge commit.
- The Pages deploy for that merge succeeds.

**Stop when** the deploy is green, or a decision only Emilio can make blocks the train.

## §0 Locked decisions

| # | Decision | Source |
|---|---|---|
| 0.1 | Every lane, verifier and reviewer runs Opus 5.5 at medium effort. This overrides the model-policy family split for this program. | Emilio, 06:30 CDT |
| 0.2 | One train: the synced upstreams and held lanes merge into `feat/ux-zero-to-one`, followed by one PR and one CI cycle. | Emilio, 11:22 CDT |
| 0.3 | The orchestrator pushes, opens the PR, fixes CI, merges and watches the deploy. | Emilio, 11:19 CDT |
| 0.4 | Merge with a merge commit, not squash or rebase, so #104 and #102 close as merged and lane history survives. | Orchestrator (follows 0.2) |
| 0.5 | `retireLegacyView: false`: `?jb-v2=0` keeps working. | Build plan default |
| 0.6 | The C11 server half merges only together with lane E. On its own it returns 422 to every draft request that has no resume. | Lane E-srv handoff |
| 0.7 | Order inside the train: #104 before F and #102; #102 before B; casefit before E and the server half. | Lane dependencies |
| 0.8 | #104's pending Gemini re-walk is skipped; CI and the local floor are the gate. | Emilio, one-train choice |

## Train shape

```
prep (parallel): sync #104, #102, casefit with origin/main · DS-08 cutover → merge into base
chain 1: L104 = base + synced #104 → { LF = L104 + F ;  L102 = L104 + synced #102 → LB = L102 + B }
chain 2: LCF = base + synced casefit → LE = LCF + server half + E
land:    merge LF, LB, LE into feat/ux-zero-to-one → full floor · gitleaks · review → push → PR → CI → merge → Pages
```

Each landing step is one Opus lane, followed by an independent floor and an independent review of the conflict resolutions.
