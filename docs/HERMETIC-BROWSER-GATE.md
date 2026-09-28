# Hermetic browser gate (F4-D)

Goal: `npm run test:e2e-smoke` and `npm run test:e2e-journey` run without real
Google, Sheets, or checkout `config.js`. They stay **advisory in CI** until
repair Gates A–D exist.

Success means:

- Both suites import `tests/e2e-fixtures/hermetic-harness.mjs`.
- The harness serves `config.example.js` as `/config.js` and never writes
  `config.js` into the repo.
- Off-origin Google/Sheets/fonts/GSI requests are mocked or aborted.
- Signed-in coverage uses disposable localStorage/sessionStorage + IndexedDB
  flags, not a live OAuth account.
- Phone geometry 320/375/393 is exported on the harness for F3-D.

Stop when: Gates A–D are recorded in the repair gate ledger, both suites are
green on a hermetic run, `continue-on-error` is removed from the two CI jobs,
and both checks are added to the branch-protection ruleset.

## Required-CI switch (do not flip yet)

`.github/workflows/ci.yml` jobs `e2e-smoke` and `e2e-journey` currently set
`continue-on-error: true`. After Gates A–D:

1. Delete `continue-on-error: true` from both jobs.
2. Add `e2e-smoke` and `e2e-journey` to the GitHub ruleset required checks
   (alongside `contract-tests`, `test`, and `scan`). `e2e-journey` is a
   Playwright `--shard` matrix whose checks are named `e2e-journey (1/3)` … `(3/3)`:
   either require each shard name, or add an aggregate
   job named `e2e-journey` that `needs:` the shards (as `test` does for
   `test-shard`).
3. Keep the Playwright browser install (cached `~/.cache/ms-playwright`,
   `install --with-deps` on a miss, `install-deps` on a hit) in those jobs.

Do not flip the switch while Gate A–D is still PENDING.
