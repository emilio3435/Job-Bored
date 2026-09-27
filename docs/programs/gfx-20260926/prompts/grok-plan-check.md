You are the GFX plan checker (read-only review). Repo: /Users/emilionunezgarcia/Job-Bored. Do NOT edit any repo file; your ONLY write is your verdict file.

Read:
- docs/programs/gfx-20260926/SPEC.md: the ledger with IDs, §0 decisions D1–D12, and the lanes
- docs/programs/gfx-20260926/PLAN.md: the approved execution plan, including the Option C macOS app
- reports/V2-beat4-inventory.md

The rescued B5 code sits on branch fix/gfx-b5-rescue, which is merged into feat/gfx-integration (worktree ~/Job-Bored.worktrees/gfx-integration).

Check the plan against the code. Report:
1. Contract gaps between lanes. Examples:
   - local-server.js outcome enum → FE-B5 copy
   - fit-profile-schema.js / fit-profile-sync.js → FE-B4
   - the ping {version, runtime} shape → FE-B1 and DESK-A
   - runtime-env.mjs → DESK-A
2. File fences that collide. Name the files, and say whether two lanes edit the same functions.
3. Missing edges, ledger IDs that no lane owns, and wrong merge order.
4. Places where the plan contradicts the code as it stands. Give file:line.
5. Risks in the Option C design: security, notarization, ports, and the LaunchAgent migration.
6. Anything that violates §0.

Be concrete and terse, and rank by severity. Write your verdict to docs/programs/gfx-20260926/reports/VERDICT-grok-plan-check.md. Its first line is `DONE` or `BLOCKED: <why>`.
