# PLAN: index.html Decompose (<5000 LOC)

> **Goal:** Reduce `index.html` below 5000 lines while preserving all DOM ids,
> test assertions, and static-first delivery (no runtime fetch for markup).
> **Baseline:** 5996 LOC (2026-05-31).
> **Target:** <5000 LOC assembled `index.html`.

## Success means

- `index.html` (assembled output) is under 5000 lines.
- All tests that read `index.html` stay green (`npm test`).
- Edit workflow: change `partials/*.html` or `index.template.html`, run
  `npm run assemble:index`, commit assembled `index.html`.
- No DOM id or `data-action` renames; JS/CSS selectors unchanged.

## Stop when

- `wc -l index.html` < 5000 and `npm test` passes.

## Architecture (implemented)

| File | Role |
|---|---|
| `index.html` | **Source shell** (~3953 LOC) with `<!-- @include partials/... -->` |
| `partials/discovery-modals.html` | Paths, setup guide, tunnel, relay, help modals |
| `partials/discovery-drawer.html` | Pre-run discovery search drawer |
| `scripts/lib/expand-index-includes.mjs` | Shared include expander |
| `scripts/assemble-index.mjs` | `npm run assemble:index` — verify or `--write index.assembled.html` |
| `dev-server.mjs` | Expands includes when serving `.html` |

Tests and smoke fallbacks use `readIndexHtml()` so assertions see expanded markup.

## Extraction order (by LOC saved)

| Partial | Approx lines | Cumulative index.html |
|---|---|---|
| Baseline | — | 5996 |
| `partials/discovery-drawer.html` | ~1026 | ~4970 ✓ |
| `partials/discovery-modals.html` | ~1018 | ~3954 |
| `partials/materials-modal.html` | ~907 | ~3049 |
| `partials/settings-modal.html` | ~549 | ~2502 |
| `partials/onboarding-wizard.html` | ~444 | ~2060 |
| `partials/login-gate.html` | ~263 | ~1799 |

Phase 1 (this session): discovery-drawer + discovery-modals → **3953 LOC** ✓

Phase 2 (follow-up): materials, settings, onboarding, login-gate for maintainability.

## Parallel lanes

| Lane | Owner | Deliverable |
|---|---|---|
| A | infra | `scripts/assemble-index.mjs`, `npm run assemble:index` |
| B | markup | `partials/discovery-drawer.html` |
| C | markup | `partials/discovery-modals.html` |
| D | integrator | `index.template.html`, assemble, `npm test` |

## Rollback

Restore `index.template.html` markers to inline markup; delete partials; revert assembler commit.
