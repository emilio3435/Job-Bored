# PLAN: index.html Decompose (<2000 LOC on disk)

> **Goal:** Keep on-disk `index.html` under 2000 lines while preserving all DOM ids,
> test assertions, and static-first delivery (no runtime fetch for markup).
> **Baseline:** 5996 LOC (2026-05-31).
> **Current:** on-disk shell with `<!-- @include partials/... -->`; local and
> assembled compositions expand to the same protected surface.

## Success means

- On-disk `index.html` stays under 2000 lines (`tests/index-html-size.test.mjs`).
- Expanded / assembled markup exposes the protected surface in
  `scripts/lib/index-protected-surface.mjs`.
- Edit workflow: change `index.html` or `partials/*.html`. Local `dev-server.mjs`
  expands includes at serve time. `npm run assemble:index` verifies the same
  expansion (optional `--write index.assembled.html` for static hosts that
  cannot expand includes).
- No DOM id or `data-action` renames; JS/CSS selectors unchanged.

## Stop when

- On-disk `index.html` stays under 2000 lines and `npm test` plus
  `npm run assemble:index` pass.

## Architecture (implemented)

| File | Role |
|---|---|
| `index.html` | **Source shell** with `<!-- @include partials/... -->` |
| `partials/*.html` | Modal / drawer / wizard markup pulled in at expand time |
| `scripts/lib/expand-index-includes.mjs` | Shared include expander. F0-A contains HTTP paths, then calls expand with `resolveIncludePath`. |
| `scripts/lib/index-protected-surface.mjs` | IDs that static assembly and local expansion must both expose |
| `scripts/assemble-index.mjs` | `npm run assemble:index` — verify or `--write index.assembled.html` |
| `dev-server.mjs` | Expands includes when serving `.html` (F0-A owns path containment) |

There is no `index.template.html`. The on-disk source is `index.html`.

Tests and smoke fallbacks use `readIndexHtml()` so assertions see expanded markup.

## F0-A / F4-D split

- F0-A: realpath/deny the request path; do not serve `.env`, `config.js`, `.git`.
- F4-D: assembler expands includes with a contained resolver under the repo root.
- Order: contain the served file, then `expandIndexIncludes(..., { resolveIncludePath })`.

## Current partials

`partials/discovery-drawer.html`, `partials/discovery-modals.html`,
`partials/first-run-wizard.html`, `partials/onboarding-wizard.html`,
`partials/discovery-runs-modal.html`, `partials/expired-review-modal.html`,
`partials/settings-modal.html`, `partials/scraper-setup-modal.html`,
`partials/profile-materials-modal.html`, `partials/linkedin-capture-modal.html`,
`partials/resume-generation-modals.html`, `partials/ingest-manual-modal.html`.

## Rollback

Remove `<!-- @include -->` markers by inlining the partials; delete `partials/`;
revert assembler commits.
