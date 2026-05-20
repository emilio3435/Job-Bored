# dossier-df-integration lane — handoff

**Run ID:** `dossier-df-20260519T2030Z`
**Worktree:** `../Job-Bored-wt-dossier-df-integration`
**Branch:** `dossier-df/integration` (off `feat/flowing-page`)
**Model:** GPT-5.5, xhigh reasoning
**Trigger:** runs after all five phase-1 lanes report `status: "completed"` in their status JSONs.

## Goal

Merge the five phase-1 lane branches in the right order, resolve conflicts deterministically, then run the full repo test suite. Hand the merged branch to the tests-screens lane.

## Merge order (strict)

1. `dossier-df/ats-state-bus` — contract producer, lands first
2. `dossier-df/writeback-bridge` — contract producer, lands second
3. `dossier-df/css` — visual scaffolding, lands before JS that depends on selectors
4. `dossier-df/brief` — consumer of CSS, no event emit dependency
5. `dossier-df/workshop` — consumer of CSS + state-bus + writeback

After all five merge, hand off to `dossier-df/qa` (tests-screens lane).

## Conflict resolution playbook

### role.js shell — `renderDossier(region, vm)`
Both Brief and Workshop lanes will have added a function call inside this shell. Keep both calls in order:
```js
function renderDossier(region, vm) {
  region.innerHTML = `
    <div data-anno="part 03 divider">…</div>
    <div class="dossier">
      <article class="brief" data-mount="brief"></article>
      <div class="mode-divider">…</div>
      <aside class="workshop" data-mount="workshop"></aside>
    </div>
  `;
  const briefMount    = region.querySelector('[data-mount="brief"]');
  const workshopMount = region.querySelector('[data-mount="workshop"]');
  if (window.JobBoredDossierBrief)    window.JobBoredDossierBrief.renderBrief(briefMount, vm);
  if (window.JobBoredDossierWorkshop) window.JobBoredDossierWorkshop.renderWorkshop(workshopMount, vm);
  // …existing close/wire logic stays below…
}
```
If both lanes wrote conflicting mount-point markup, take the version that matches the wireframe.

### index.html — script tags
Both lanes added one `<script>` tag. Final order:
```html
<script src="./role.js"></script>
<script src="./role-brief.js"></script>
<script src="./role-workshop.js"></script>
```

### app.js
ats-state-bus edits cluster around `atsScorecardState` (~L13877+ and the consumer block at ~L17820). writeback-bridge edits cluster around `attachCardListeners` and existing column-write helpers. They should not collide. If they do, both lane briefs require declaring exact line ranges in their Completion Reports — read those first.

### style.css
Only ats-state-bus and dossier-css MAY touch `style.css`. ats-state-bus only edits an existing modal-related rule if any; dossier-css only adds `:root` tokens. They should not collide. If they do, prefer the dossier-css additions and re-apply any state-bus styles after.

### CSS scope conflicts
Only dossier-css owns `role.css`. No conflicts expected.

## Verification (run before handing to tests-screens lane)

```bash
node --check role.js role-brief.js role-workshop.js app.js flowing-writes.js
npm test -- tests/dossier-card-attrs.test.mjs \
            tests/ats-state-bus.test.mjs \
            tests/role-writeback-bridge.test.mjs
npm run typecheck:repo
npm run lint:repo
npm run test:repo
```

If any of the above fails, stop and write a status JSON entry. Do not patch source code — the source-owning lane must fix it.

Manual smoke:
- `npm start`, open a role from the kanban.
- Confirm Brief renders with the two-column grid, Workshop renders below as a distinct bordered card.
- Click each Workshop chip; confirm via DevTools `monitorEvents` that the correct `jb:role:writeback` payload fires.
- Click "See full scorecard"; confirm modal opens and closes via Escape, outside-click, and the close button.
- Resize to 1024 / 720 / 390; confirm responsive collapse matches the wireframe.

## Status file

Write to `docs/redesign/status/dossier-df-integration.json`:

```json
{
  "lane": "integration",
  "branch": "dossier-df/integration",
  "status": "completed" | "blocked",
  "merged": ["ats-state-bus", "writeback-bridge", "css", "brief", "workshop"],
  "conflicts_resolved": [{"path": "...", "resolution": "..."}],
  "tests_run": [...],
  "notes": "...",
  "ended_at": "..."
}
```

## Completion report (fill in at the end)

- **Final integration commit SHA:**
- **Per-lane merge SHAs:**
- **Conflicts encountered:**
- **Test results:**
- **Manual smoke results:**
- **Handoff to tests-screens:** ready / blocked
- **Known risks:**
