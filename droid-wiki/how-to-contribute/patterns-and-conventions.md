# Patterns and conventions

How code is shaped in this repo. Read this before editing more than one file.

## No build step on the dashboard

`index.html` loads ~50 root JS files as plain `<script defer>` tags. They are not ES modules; many publish globals on `window` (`window.JobBoredDiscoveryWizard`, `window.JB_V2`, `window.COMMAND_CENTER_CONFIG`, `window.JobBoredUserContent`, …). Order in `index.html` is load-bearing — if a module references `JobBoredUserContent`, `user-content-store.js` must come earlier.

New browser modules should follow the same pattern: wrap in an IIFE, attach a namespaced API to `window`, and place the `<script>` tag in `index.html` at the right point in the load order.

## Coding norms (from `~/.factory/AGENTS.md`)

These rules apply to every coding task in this repo. The repo-local `CLAUDE.md` and `AGENTS.md` defer to them:

1. Surface tradeoffs and assumptions. If two interpretations exist, name both.
2. Simplicity first — no speculative abstractions, no flexibility "in case".
3. Surgical changes — touch only what the task requires. Don't clean up adjacent code you didn't write.
4. Goal-driven execution — define verifiable success, loop until verified.
5. Code-decidable things go in code; the LLM is for judgment calls only.
6. Token budgets are not advisory. Stop and summarize when approaching them.
7. Pick one pattern when two conflict. Flag the loser; don't blend.
8. Read before you write — read callers, exports, shared utilities first.
9. Tests verify intent, not just current behavior.
10. Checkpoint after each significant step.
11. Match the codebase's conventions even when you disagree.
12. Fail loud — "tests pass" is wrong if any were skipped.

`AGENTS.md` and `CLAUDE.md` both reference the shared `directional-prompting` skill. Use `Goal:` / `Success means:` / `Stop when:` headers when writing non-trivial prompts.

## Contract invariants

Two interfaces are versioned and validated by CI:

- **Pipeline rows (Interface A)** — `schemas/pipeline-row.v1.json`. Run `npm run test:pipeline-contract`.
- **Discovery webhook (Interface B)** — `schemas/discovery-webhook-request.v1.schema.json` + `examples/discovery-webhook-request.v1*.json`. Run `npm run test:contract`.
- **ATS scorecard** — `schemas/ats-scorecard-*.schema.json`. Run `npm run test:ats-contract`.
- **Integration skill links** — every `integrations/**/SKILL.md` must link to `AGENT_CONTRACT.md` and the discovery webhook schema. Run `npm run lint:skills`.

Run `npm run test:contract:all` before pushing changes that touch any of these.

When changing the Pipeline columns: update the schema, the README "Sheet Structure" table, `AGENT_CONTRACT.md`, and any affected writer/parser code together (e.g., `parsePipelineCSV` in `app.js`, `integrations/browser-use-discovery/src/sheets/pipeline-writer.ts`).

When changing the discovery webhook: update the schema, the fixtures in `examples/`, `AGENT_CONTRACT.md`, and `docs/CONTRACT-CHANGELOG.md`.

## Discovery worker invariants

`integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts` preserves a specific order:

1. Method check
2. Secret auth
3. JSON parse
4. Per-run `googleAccessToken` stripping (it must never be persisted)
5. Preflight validation
6. First run-status side effect
7. Run execution

Don't reorder these without updating tests in `integrations/browser-use-discovery/tests/webhook/`.

`integrations/browser-use-discovery/src/run/run-discovery.ts` is the scout → score → exploit → learn loop. Don't widen its public surface — call sites should depend on the run record + status, not internal phase helpers.

`integrations/browser-use-discovery/src/discovery/career-surface-resolver.ts` classifies discovered surfaces. Third-party job boards (LinkedIn, Indeed, …) are **hint-only** and must not become direct write sources.

## Event names (browser-internal)

Internal events (not part of the agent contract) follow the `jb:` prefix and dispatch on both `window` and `document`:

- `jb:ats:state`, `jb:ats:state:request`, `jb:ats:modal:open`
- `jb:role:opened`, `jb:role:closed`, `jb:role:action`, `jb:role:note`, `jb:role:writeback`
- `jb:pipeline:move`

Payload shapes are documented in `AGENT_CONTRACT.md` "Dossier event family". Workers building Direction F must not rename or reshape these.

## Card data attributes

v2 kanban cards (`.kanban-card[data-stable-key="..."]`) carry read-only `data-*` attributes consumed by `dawn-data.js` view-models. Empty source values MUST be omitted entirely (do not emit `data-foo=""`). The full enum lives in `AGENT_CONTRACT.md` "v2 kanban-card data-attributes".

Tests: `tests/dossier-card-attrs.test.mjs`.

## Browser CORS / credentials

`server/security-boundaries.mjs` resolves allowed origins for the local scraper. `integrations/browser-use-discovery/src/http/origin-guard.ts` does the same for the worker. New endpoints should reuse these helpers.

The worker's webhook secret is checked via `hasValidWebhookSecret`; run-status requests are authorized via `hasValidRunStatusToken`. Status tokens are bearer credentials for one run; never log them raw.

## Test naming and runner

- Root tests live in `tests/*.test.mjs` and run via Node's built-in test runner through `scripts/run-tests.mjs`.
- Discovery worker tests live in `integrations/browser-use-discovery/tests/**/*.test.ts`, run via `node --experimental-strip-types --test`.
- Tests should fail when business logic changes — see Agent Rule 9 (intent, not just behavior).

## File naming

- Lowercase with hyphens (`fit-profile-wizard.js`, not `FitProfileWizard.js`).
- `*.demo.html` for primitive demos.
- `*.test.mjs` for root tests, `*.test.ts` for worker tests.
- `HANDOFF-*.md` for session handoff notes.
- Themed module names (`dawn`, `lattice`, `scribe`, `flowing-*`) are intentional. See [glossary](../overview/glossary.md).

## Logging

The discovery worker uses a structured `logEvent` function. Run-status / webhook handlers should funnel through it instead of `console.log` directly. Materials-quality and ATS scorecard modules write structured JSON to stdout.

## Where to start when extending

- New browser feature → pick the right surface (`pipeline.js`, `role.js`, `dawn.js`…) and check the v2 flag.
- New discovery source → add an entry under `integrations/browser-use-discovery/src/sources/` or `src/browser/providers/` and register it in `src/contracts.ts` (`SUPPORTED_SOURCE_IDS`).
- New webhook field → bump the schema, add a fixture, update `AGENT_CONTRACT.md`, document in `docs/CONTRACT-CHANGELOG.md`.
- New server endpoint → add a route in `server/index.mjs`, reuse `security-boundaries.mjs`, add tests under `tests/`.
