# integration lane — handoff

**Run:** `redesign-20260424T0742Z`
**Worktree:** `../Job-Bored-wt-redesign-integration`
**Branch:** `redesign/integration` (off `main@a28c416`)

## Task

After all four lane handoffs are complete and each lane's `docs/redesign/handoffs/<lane>.md` "Completion report" is filled in, merge the four branches **sequentially** into `redesign/integration`.

**Merge order:**
1. `redesign/fe-dashboard` (tokens + shell first so downstream lanes see any new `:root` tokens).
2. `redesign/fe-kanban`.
3. `redesign/fe-detail-drawer`.
4. `redesign/be-data-deploy` (last — backend only; merges cleanly if FE lanes stayed in their files).

## Conflict resolution rules

- **app.js** — conflicts should only appear at function boundaries declared in per-lane briefs. Read both lane handoffs; keep the block owned by the earlier-merged lane and re-apply the later lane's intent via a fresh patch instead of naive merge.
- **style.css** — per-section ownership is exclusive, so conflicts should only happen at section boundary lines. Keep both sections' content in their declared order.
- **index.html** — resolve by the lane that owns the scaffolding.
- **schemas/** — if FE and BE both touched a schema, BE wins. Surface the discrepancy in the final report.

## Verification after each merge

```bash
node --check app.js runs-tab.js settings-profile-tab.js
env -u NODE_OPTIONS node --test tests/ 2>&1 | tail -30   # or `npm test` if defined
npm run test:pipeline-contract 2>&1 | tail -20
env -u NODE_OPTIONS node scripts/run-tests.mjs integrations/browser-use-discovery/tests/ 2>&1 | tail -20
```

If any test regressed, `git reset --hard HEAD~1` and escalate to orchestrator with the failure.

## Browser check

Start the dev server from the integration worktree:
```bash
npm run dev
# then open http://localhost:8080 (or the port printed)
```

Capture at `docs/redesign/screenshots/integrated/`:
- `desktop-signed-out.png`
- `desktop-signed-in.png`
- `desktop-drawer-open.png`
- `mobile-signed-in.png`
- `mobile-drawer-open.png`

## Final report sections

1. **What shipped** — bullet summary per lane.
2. **Branches / worktrees used** — this file's table.
3. **Files changed by lane** — grouped `git diff --name-only main...redesign/<lane>` per lane.
4. **Tests + browser checks** — exact commands + pass/fail.
5. **Unresolved risks**.
6. **Exact next commands for review / deploy** — e.g., `git push origin redesign/integration`, PR title/body suggestions, deploy gotchas from be-data-deploy.
