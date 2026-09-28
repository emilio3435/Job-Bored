# cmux inventory — 2026-09-26 17:05 CT (scope: Job-Bored workspaces only)

Evidence: `cmux rpc debug.terminals`, `ps -t <tty>`, `%cpu`, lane reports, `lsof`.

| Workspace | Title | What runs there | Class | Evidence |
|---|---|---|---|---|
| 113 | GFX UXD lanes | QA-LIVE astra (pid 43860), GFX orch claude 4307f7f5, this orch 6144acd1, 2 muse sessions | ACTIVE — off-limits | QA-LIVE mid-run; orchestrators live |
| 142 | GFX · UXD-FE · opus | claude pid 34039 | ACTIVE — off-limits | spawned 16:53 |
| 143 | GFX · UXD-BE · sol | codex pid 35127 | ACTIVE — off-limits | spawned 16:54 |
| 104 | ~/Job-Bored | `npm run discovery:worker:start-local` (pid 17330, since 02:25, cwd ~/Job-Bored) | ACTIVE — keep | Emilio's real-worker launcher; :8644 currently held by the QA dev-server child 21872 (gfx-integration), and the 15:17 feed says his real worker is paused until restored. Closing would kill the launcher |
| 2 | ~/Job-Bored | 2 bare zsh shells, no children | DONE | idle since Sep 25 05:04 / Sep 26 05:48 |
| 116 | ~/Job-Bored | 1 bare zsh shell | DONE | idle since 05:48 |
| 118 | GFX · plan check · grok-cursor | cursor-agent pid 13270 + serena, 0% CPU | DONE (idle agent) | verdict written 08:12 (reports/VERDICT-grok-plan-check.md); board lists grok-cursor for per-lane diff reviews, but none has been sent since |
| 129 | GFX · full-suite regressions + BE review · sol | codex pid 48883, 0% CPU | DONE (idle agent) | SOL-HARDEN report `BLOCKED: sandbox…floor`; both commits merged to integration (c7b01030); worktree clean; last evidence 13:08. Board still lists "Sol write-up" in flight — the scrollback may hold the adversarial findings table |
| 1 | Wave 2 materials registry | 2 claude sessions (Sep 25 06:05) + muse (Sep 25 20:39), idle | DONE (idle agents) | W2 materials registry shipped as #126 (3e3e5eef) |

Out of scope (other programs; untouched): 5 cooper `00 Control`, 115 Pensieve, 139/140/141/144 Sonde LLD.

Closing a workspace kills its processes; session transcripts stay on disk (claude `--resume <id>`, codex `resume`), so scrollback is the only loss.

## Sweep result — 17:08 CT (Emilio approved both categories)

Closed: ws2, ws116 (bare shells); ws1, ws118, ws129 (idle agents). Their processes are confirmed gone.
Kept and confirmed alive: ws113 (QA-LIVE 43860, GFX orch 32587), ws142 (UXD-FE 34039), ws143 (UXD-BE 35127), ws104 (worker launcher 17330). :8644 is unchanged (21872).

Undo / resume:
- ws1 claude sessions: `claude --resume 36696728-c9c2-48d6-9424-0fa42f07e97b` and `claude --resume 01584ceb-cd8d-430d-a1ae-219cfdaa64ad` (cwd ~/Job-Bored); the muse session was not located on disk
- ws129 SOL-HARDEN: `codex resume 01a0ded6-3587-74e2-a10e-c3357f6d1334` (cwd gfx-sol-harden; transcript ~/.codex/sessions/2026/09/26/rollout-2026-09-26T12-49-35-01a0ded6-….jsonl)
- ws118 grok-cursor: chat store ~/.cursor/chats/c7de62201cf5a710e55753167079f55a/704fe87c-661a-43ae-ab96-cb12f36ec93e; respawn for diff reviews as needed
- ws2/ws116: nothing to restore

## Full sweep inventory — 2026-09-26 23:12 CT (after #132, #133 landed)

DONE candidates (merged into origin/main, clean, no live process):
- Worktrees (17): bbuild-feat-beaudit-build-w1b, gfx-b5, gfx-be-core, gfx-be-fuel, gfx-desk-a, gfx-desk-b, gfx-desk-d, gfx-dock, gfx-fe-b1, gfx-fe-b2b3, gfx-fe-b4, gfx-fe-b5, gfx-floor, gfx-followup, gfx-sol-harden, legal-pages, pr105
- Idle finished lanes (3 worktrees + 3 workspaces): gfx-uxd-fe (ws142), gfx-uxd-be (ws143), gfx-sol-tailnet (ws146; report DONE) — all merged via #133, agents idle at 0% CPU
- Detached clean worktrees (3): wt-02df63f7, wt-29b7a3f6, gfx-baseline — HEADs contained in merged branches
- Local merged branches with no worktree (57): list in scratchpad merged-branches.txt

KEEP (evidence):
- main checkout (dirty 16) · w2sq-integration (merge in progress for #131)
- jobbored-review-package + ws158 GFXPKG grok review (live, unmerged 4) · gfx-integration (unmerged 3)
- writer-json-fix (unmerged 2, today) · beaudit-integration (unmerged 10) · main-bringup (unmerged 2) · gfx-spike-rt (unmerged 2)
- dirty or untracked: 8 subagent-v2-* detached worktrees, ux01-states-settings, feat-standalone-materials-drafter, oss-redesign, materials-templates, pr120-templates
- 9 stashes (never dropped) · ws104 (your worker launcher) · ws113 (orchestrators)
- Remote branches: not touched (deleting them is outward-facing)

## Sweep result — 23:25 CT

Removed (tags under zz-archive/sweep-0926/*, 77 total):
- Worktrees: 17 merged lanes + gfx-uxd-fe, gfx-uxd-be, gfx-sol-tailnet + detached wt-02df63f7, wt-29b7a3f6, gfx-baseline (23)
- Workspaces: ws142, ws143, ws146
- Branches: 20 lane branches + 55 of 57 merged no-worktree branches
Kept: feat/discovery-hardening and feat/greenfield-integration (ahead of their remote tracking branches; `-d` refused).

Incident: `git worktree remove` also deletes gitignored files, which took the lanes' `.lane-evidence/` folders (4 reports existed nowhere else).
Recovered from the 22:42 APFS local snapshot into docs/programs/gfx-20260926/reports/lane-evidence/<worktree>/ (13 reports + evidence).

Undo:
- branch: `git branch <name> zz-archive/sweep-0926/<name-with-dashes>`
- worktree: `git worktree add ~/Job-Bored.worktrees/<n> zz-archive/sweep-0926/<branch-with-dashes>`
- lane agents: UXD-FE `claude --resume cb7688e9-779a-4792-b799-4f0858808c01`; UXD-BE `codex resume 01a0dfb6-1cb9-7203-90f6-f6ad11b88ba2`; SOL-TAILNET `codex resume 01a0dfc2-f7de-7d22-9984-9ef96b2e3ae9`
