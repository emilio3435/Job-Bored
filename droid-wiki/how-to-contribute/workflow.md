# Workflow

How changes move from local to a PR.

## Branching

The default branch is `main`. Feature branches use a topic-prefix style:

- `feat/<scope>-<short-name>` — new behavior
- `fix/<scope>-<short-name>` — bug fix
- `chore/<scope>-<short-name>` — non-functional
- `docs/<scope>-<short-name>` — documentation only

The repo's current working branch is `feat/seamless-discovery-coexistence`.

## Commit format

The repo uses Conventional Commit prefixes loosely. Recent examples:

```
feat(discovery): WIP Cloudflare tunnel transport core (3-tier selection)
fix(kanban): make favorite star actually clickable
feat(discovery): seamless Hermes coexistence + reboot-durable worker
chore(checkpoint): snapshot in-progress work
```

Bodies are short and bias toward "why". Agents that commit on the user's behalf include a `Co-authored-by:` line for the agent (`factory-droid[bot]`, `claude[bot]`, etc.).

## Pull requests

The repo doesn't require a specific PR template, but each PR should answer:

- What changed and why
- Which tests / contracts were validated
- Anything skipped or deferred (per Agent Rule 12 — fail loud)

## Contract change checklist

Whenever you touch a contract surface, run the full alignment loop:

| Surface | What to update | Test |
| --- | --- | --- |
| Pipeline columns | `schemas/pipeline-row.v1.json`, README "Sheet Structure", `AGENT_CONTRACT.md`, `app.js` parser, worker `pipeline-writer.ts` | `npm run test:pipeline-contract` |
| Discovery webhook | `schemas/discovery-webhook-request.v1.schema.json`, `examples/discovery-webhook-request.v1*.json`, `AGENT_CONTRACT.md`, `docs/CONTRACT-CHANGELOG.md`, `src/contracts.ts`, browser builder `discovery-payload.js` | `npm run test:contract` |
| ATS scorecard | `schemas/ats-scorecard-*.schema.json`, `examples/`, browser builder, server normalizer | `npm run test:ats-contract` |
| Integration skill links | `integrations/**/SKILL.md` must link to `AGENT_CONTRACT.md` + the discovery webhook schema | `npm run lint:skills` |

Run all four at once with `npm run test:contract:all`.

## Adding a contract-affecting field

The order matters:

1. Update the JSON Schema.
2. Add or update an example fixture in `examples/`.
3. Document it in `AGENT_CONTRACT.md` + `docs/CONTRACT-CHANGELOG.md`.
4. Update `src/contracts.ts` (worker) and `discovery-payload.js` (browser).
5. Update any receivers (the worker handler, the dashboard handler).
6. Run `npm run test:contract:all`.

If you change the schema's `schemaVersion`, every receiver that hard-codes a version must be updated in the same PR.

## Worker test conventions

Discovery worker tests run with `node --experimental-strip-types --test`. They cannot import shared CommonJS / ESM utilities that use a build step. Keep test helpers TypeScript-native.

## Browser test conventions

Root tests run with the built-in Node test runner via `scripts/run-tests.mjs`. They assume jsdom-free pure JS — write code that doesn't need a DOM to test, then a thin DOM bridge.

## Local CI gauntlet

Before pushing a non-trivial branch:

```sh
npm run typecheck:repo \
  && npm run lint:skills \
  && npm test \
  && npm run test:browser-use-discovery \
  && npm run test:contract:all
```

## Related

- [Patterns and conventions](patterns-and-conventions.md)
- [Debugging](debugging.md)
