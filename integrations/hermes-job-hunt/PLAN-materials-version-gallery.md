# Plan — Materials Version Gallery

**Branch:** `feat/materials-version-gallery`  
**Date:** 2026-06-01  
**Goal:** Let Emilio leaf through every Hermes draft of a role’s resume/cover letter, compare them side-by-side, and pick a favorite without losing earlier versions.

**Success means:**
- Each successful materials run keeps a numbered snapshot (PDF + HTML + QA/analysis for that run).
- The dossier shows a gallery control (prev/next or deck) per document type.
- Picking a version sets the **active** files the dashboard previews, downloads, and quality-gates treat as canonical.
- Re-drafting never silently deletes prior snapshots.

**Stop when:** Gallery works end-to-end for resume and cover letter on a role with ≥2 drafts, tests cover manifest + promote API, and docs match disk layout.

---

## Problem today

| Layer | Behavior |
|---|---|
| **Watcher** | On success, writes `resume.pdf`, `cover-letter.pdf`, etc. at slug root — **overwrites** prior draft. |
| **Manifest** | `buildManifest()` reads only root-level allowlisted filenames — one resume, one letter. |
| **UI** | `role-materials.js` renders a single card per doc type; no history. |
| **BYOK lane** | `resume-generation.js` already has a **draft deck** (IndexedDB versions) — Hermes lane has nothing equivalent. |

Re-requests append to `pending.json` `history[]` but artifacts are not versioned on disk.

---

## Proposed disk layout

```
~/.hermes/job-hunt/applications/<slug>/
  resume.pdf                    ← active (symlink or copy of selected version)
  resume.html
  cover-letter.pdf
  cover-letter.html
  versions/
    manifest.json               ← version index (see schema below)
    v001-20260601T155806Z/
      resume.pdf
      resume.html
      cover-letter.pdf
      cover-letter.html
      job-analysis.md
      qa-report.md
      meta.json                 ← requested_at, notes, provider, model, feature
    v002-20260601T180000Z/
      ...
  pending.json.done.*           ← unchanged
```

**Active files** at slug root remain what JobBored serves today (backward compatible). New drafts:

1. Write full artifact set into `versions/vNNN-<stamp>/`.
2. Append entry to `versions/manifest.json`.
3. Default **active** = newest version (copy or hardlink into root).
4. When user picks a favorite in UI → **promote** that version’s files to root + set `activeVersionId` in manifest.

Avoid symlinks if iCloud/two-machine sync makes them fragile — prefer atomic copy on promote.

### `versions/manifest.json` (v1 sketch)

```json
{
  "schema": "materials-versions.v1",
  "activeVersionId": "v002-20260601T180000Z",
  "versions": [
    {
      "id": "v001-20260601T155806Z",
      "createdAt": "2026-06-01T15:58:06Z",
      "feature": "both",
      "notes": "…",
      "provider": "minimax-oauth",
      "model": "MiniMax-M3",
      "label": "V1"
    }
  ]
}
```

---

## Implementation phases

### Phase 1 — Version capture (watcher + manifest writer)

**Owner:** `integrations/hermes-job-hunt/scripts/materials_watcher/`

- After `verify_outputs()` succeeds, before `archive_pending()`:
  - Allocate next version id (`v###` + UTC stamp).
  - Move/copy generated artifacts into `versions/<id>/`.
  - Update `versions/manifest.json` (`activeVersionId` = new id).
  - Refresh slug-root active files from that version.
- On re-draft: **do not** delete older `versions/*` dirs.
- Log version id in `.draft.log` header and Telegram success message.

**Tests:** Python unit tests on a temp slug dir (create version dir, manifest round-trip, promote copy).

### Phase 2 — Server manifest API

**Owner:** `server/application-materials.mjs`, `server/index.mjs`

- Extend `buildManifest()`:
  - `versions: { activeId, items[] }` per slug when `versions/manifest.json` exists.
  - Each item: `id`, `createdAt`, `feature`, `notes`, `provider`, `model`, primary file mtimes.
- New endpoints (narrow contract):
  - `GET /api/applications/:slug/versions` — list + active id.
  - `POST /api/applications/:slug/versions/:versionId/promote` — copy version artifacts to slug root, set active in manifest.
  - `GET /api/applications/:slug/versions/:versionId/files/:filename` — serve allowlisted file from version dir (path-safe).
- Keep existing `GET …/files/:filename` serving **active** root files only.

**Tests:** `tests/application-materials.test.mjs` — version list, promote changes primary mtime, traversal blocked.

### Phase 3 — Dossier gallery UI

**Owner:** `role-materials.js`, `role.css`

Reuse BYOK **draft deck** interaction patterns from `resume-generation.js`:

- Under each resume / cover-letter card when `versions.items.length > 1`:
  - Chevron nav: “V2 of 3”
  - Optional stacked-card preview (reuse `.draft-deck__*` classes or Hermes-specific BEM prefix).
- Preview/download uses version file URL when browsing non-active version; badge when not active.
- **Use this version** button → `POST …/promote` → refresh manifest → card shows new active PDF.
- Keyboard: ←/→ when gallery focused; aria labels for screen readers.

Do **not** block the pending/progress banner — gallery hidden while `pending` is in flight.

### Phase 4 — Polish + docs

- Show version metadata in card subtitle (date, notes snippet, model).
- Update `droid-wiki/features/materials.md` and `integrations/hermes-job-hunt/scripts/materials_watcher/README.md`.
- Optional: migrate existing single-draft slugs (no `versions/` yet) as implicit `v001` on next read — lazy migration in `buildManifest`.

---

## Out of scope (v1)

- Diff view between two HTML versions.
- Branching / merge of bullet text.
- Pipeline sheet column for “selected version”.
- Gallery for support docs (`job-analysis.md`, `qa-report.md`) — follow active version only.

---

## Risks / decisions

| Decision | Recommendation |
|---|---|
| Copy vs symlink for active files | **Copy** on promote (sync-safe across daily driver ↔ always-on). |
| Max versions retained | Cap at 10 per slug; prune oldest non-active unless user starred (v2). |
| Contract change | Add `materials-versions.v1` schema under `schemas/` if we expose manifest to agents. |
| Two-machine sync | Version dirs must sync via existing `applications/` iCloud/rsync path; avoid partial writes (watcher already uses atomic json writes). |

---

## Suggested build order (this branch)

1. Watcher version capture + `versions/manifest.json` writer.
2. Server list + promote endpoints + manifest extension.
3. Gallery UI on dossier cards.
4. Tests + README.

**First PR slice:** Phases 1–2 (disk + API) without UI — verifiable via curl. **Second slice:** Phase 3 gallery.

---

## Reference implementations in repo

- Draft deck UI: `resume-generation.js` (`renderDraftDeckPanel`, `.draft-deck__*`)
- Manifest / allowlist: `server/application-materials.mjs`
- Watcher success path: `materials_watcher/watcher.py` (`archive_pending`, `verify_outputs`)
- Pending history (metadata only today): `materials_request.py` `merge_pending()` → `history[]`
