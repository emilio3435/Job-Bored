# How to contribute

Practical guide to making changes in this repo. Read [patterns and conventions](patterns-and-conventions.md) first.

## Pages

- [Patterns and conventions](patterns-and-conventions.md) — the rules everything else assumes
- [Workflow](workflow.md) — branching, commits, contract change checklist
- [Debugging](debugging.md) — common breakages and how to diagnose them

## Quick checklist

Before opening a PR:

1. `npm run typecheck:repo` passes.
2. `npm test` passes.
3. If you touched the discovery worker: `npm run test:browser-use-discovery`.
4. If you touched a contract surface (Pipeline / discovery webhook / ATS): `npm run test:contract:all`.
5. The change is surgical — adjacent files are untouched.
6. New code matches surrounding style (file naming, IIFE / `window.*` exposure for browser modules).
7. New browser script tags placed at the right point in the `index.html` load chain.
8. Contract changes also update schema + `AGENT_CONTRACT.md` + `docs/CONTRACT-CHANGELOG.md`.

## Related

- [Configuration reference](../reference/configuration.md)
- [Maintainers](../maintainers.md)
