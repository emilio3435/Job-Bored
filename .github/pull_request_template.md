<!--
Thanks for sending a PR! A few things to know:

- The CI gate is `npm test` (which runs scripts/run-tests.mjs and includes the
  integration suite). It MUST end 0 fail / 0 skip. `npx eslint .` and
  `npm run typecheck:repo` must also be clean before merge.
- Tests live in `tests/`. The repo's preferred style is behavioral VM-context
  harnesses (see tests/discovery-cross-rec.test.mjs, tests/enhancements-wizard.test.mjs
  for patterns) over source-sniff regex pins.
- Browser code is classic-global IIFE modules on `window.*` namespaces — please
  match the surrounding style.
-->

## What this changes

<!-- One or two sentences. What does the user notice or stop noticing? -->

## Why

<!-- The motivation. If this fixes an issue, link it: `Fixes #123` -->

## How

<!-- The notable implementation decisions, especially anything reviewers shouldn't
     have to re-derive (a non-obvious choice, a known constraint, a deliberate
     non-fix). Skip if the diff speaks for itself. -->

## Verification

<!-- Pick what applies. Delete the rest. -->

- [ ] `npm test` — passes (0 fail / 0 skip)
- [ ] `npx eslint .` — clean
- [ ] `npm run typecheck:repo` — clean
- [ ] New behavior is covered by a test that fails without this change
- [ ] Manually exercised in the browser (attach a screenshot for UI changes)
- [ ] Not applicable (docs / chore / config only)

## Screenshots / before-after

<!-- For any UI change. Side-by-side preferred. -->

## Anything reviewers should look extra carefully at?

<!-- A specific file, a tricky branch, a decision you're unsure about. Honest
     "I picked option A over option B because…" notes save review cycles. -->
