# Cleanup opportunities

Observations from the survey. Each item is a fact about the repo plus a "if you wanted to clean this up" note. Don't act on them as part of unrelated work — Agent Rule 3.

## `app.js` is 24,289 lines

This file owns OAuth state, sheet parsing, write-back, card rendering, discovery dispatch, settings persistence, async polling, onboarding glue, and several thousand lines of feature flag bookkeeping.

Existing extraction: `dawn.js`, `dawn-data.js`, `pipeline.js`, `lattice.js`, `role*.js`, `letter.js`, `scribe.js`, `flowing-*.js`, `discovery-wizard-*.js`, `settings-*.js`, `setup-doctor.js`, `runs-tab.js`, `companies-tab.js` are all extractions out of `app.js`. The extraction is partial — `app.js` still owns the parser, the OAuth state machine, and the async-discovery polling.

`docs/APP_JS_ANALYSIS.md` exists; an explicit teardown plan would go further.

## `role-workshop.js` is still present

The Workshop preceded the Dossier (`role.js` + `role-brief.js` + `role-materials.js`). The Workshop file lingers. If nothing references it, it can be deleted — but check `index.html` script tags first.

## 26 root markdown files

`*HANDOFF*.md` accumulates whenever a long agent session ends. The canonical docs are five: `README.md`, `SETUP.md`, `AGENT_CONTRACT.md`, `AGENTS.md`, `DESIGN.md`. The rest could move to `docs/handoffs/` (which already exists for this purpose).

Notable handoff files: `BACKEND_HANDOFF.md` (from when a hosted backend was considered — decision: don't), `RUNS_LOG_HANDOFF.md` / `RUNS_POLISH_HANDOFF.md`, `PIPELINE-CARDS-HANDOFF.md`, `TIER1_DEFAULT_HANDOFF.md`, `HERMES_MATERIALS_HANDOFF.md`, `HANDOFF-cloudflare-tunnel.md`.

## Two Cloudflare relay templates

`integrations/cloudflare-relay-template/` and `templates/cloudflare-worker/` both ship a Worker. They have different routes and slightly different env shape. The newer one is `integrations/cloudflare-relay-template/`; the older `templates/cloudflare-worker/` could be deprecated with a redirect README.

## Hermes gate 2 / 4 / 6 references

The Hermes scripts and SKILL.md still mention apply-form gates that are not wired into the active materials lane (see [Hermes history](background/hermes-history.md)). Worth a pass to mark them historical.

## `style.css` at 13,209 lines

The legacy v1 stylesheet. v2 surfaces have their own per-surface CSS. Pieces of `style.css` are still consumed (the OAuth banner, toasts, modals). A migration would split it the way the JS layer already is.

## Multiple settings-tab files vs `settings-tab-schema.js`

There's a declarative schema in `settings-tab-schema.js` and ~5 imperative `settings-*.js` files. The split is fine, but one or two tab files duplicate metadata that the schema could own.

## `node --experimental-strip-types` everywhere

Discovery worker tests use the experimental strip-types flag. When Node 24 promotes it to stable (or 26 changes the flag), every script that hard-codes the flag has to flip together.

## Multiple discovery wizard files (~5)

`discovery-wizard-shell.js` (1.7k LOC), `-local.js`, `-relay.js`, `-probes.js`, `-verify.js`, `-helpers.js`. They share a fair amount of state. A single store module or a class hierarchy could reduce the cross-file coupling. The 3-tier transport rewrite is a good moment to revisit.

## Test runner forking

`scripts/run-tests.mjs` runs root tests. Worker tests run directly with `node --test`. Different glob behavior, different filter syntax, different output. A unified runner would simplify CI commands.

## `tests/runs-tab.test.mjs` and friends predate the v2 store

Some root tests assert against the legacy `app.js` rendering path. They still pass but don't cover the v2 surfaces. Adding v2 mirror tests would raise confidence in cross-surface changes.

## Related

- [Lore](lore.md)
- [Patterns and conventions](how-to-contribute/patterns-and-conventions.md)
- [By the numbers](by-the-numbers.md)
