# W2SQ lane E: one error-code convention, plus the dotenv v18 bump

Read `.lane-evidence/KICKOFF-W2SQ-_SHARED.md` first. It is binding.

## Outcome
Goal: every API error code the worker and the server return follows one convention, and `server/` runs on dotenv 18 (replacing dependabot PR #121).
Success means:
1. **§0 (orchestrator-locked): the convention is lowercase snake_case** (e.g. `not_found`, `header_mismatch`), matching the newest server codes (`unknown_template`, `browser_unavailable`, `layout_overflow`). Every uppercase code (L's `NOT_FOUND` and siblings in the worker's contracts and webhook handlers, and any in `server/`) becomes lowercase. Where it clarifies the contract, codes live in one exported constant map per package.
2. Every consumer that matches on a code is updated (the browser JS, the server, the worker, the tests and docs, including `AGENT_CONTRACT.md` and `docs/CONTRACT-CHANGELOG.md`). If external clients could depend on an old uppercase code, accept the old form on input where the code is ever read back, and note the change in the changelog.
3. A test that went red first asserts that every error code the worker and server can emit matches `^[a-z][a-z0-9_]*$` (for example by scanning the exported maps, or the handler sources with a narrow regex).
4. dotenv: apply #121's change (`server/package.json` dotenv to `^18`, plus the regenerated `server/package-lock.json`). Read dotenv 18's changelog (`node_modules/dotenv/CHANGELOG.md` once installed, or the package README) for breaking changes (default logging/quiet, `override`, multiline, etc.) and adapt every `dotenv` call site in `server/` and anywhere else that imports it, so startup output and behaviour are unchanged. Add a test if behaviour could shift.
5. The floor is green.

Stop when: the report's first line reads `DONE`, or you are blocked twice on the same thing.

## Start here
- `grep -rn "header_mismatch" integrations/browser-use-discovery/src` (S's lowercase codes: `sheets/sheets-client.ts`, `webhook/handle-pipeline-update.ts`)
- `grep -rnE "code: ?['\\"][A-Z_]{3,}['\\"]|['\\"](NOT_FOUND|INVALID_[A-Z_]+|CONFLICT|FORBIDDEN|UNAUTHORIZED)['\\"]" integrations/browser-use-discovery/src server *.js`. L's uppercase codes are most likely in `src/contracts.ts`, `src/state/run-status-store.ts`, `src/webhook/run-async-lifecycle.ts` and `src/webhook/handle-discovery-webhook.ts`.
- `gh pr view 121` is blocked for lanes; the change is exactly `server/package.json` plus `server/package-lock.json`, dotenv 17.4.2 to 18.0.1.

## Fence
- Error-code string literals and constant maps in `integrations/browser-use-discovery/src/**` and `server/**`, plus the consumers that match on them (browser `*.js`, tests, `AGENT_CONTRACT.md`, `docs/CONTRACT-CHANGELOG.md`). **Change code strings only.** Lanes D, M and B are editing surrounding logic in some of these files in parallel, so keep your hunks minimal (the string, the map, the import) and the orchestrator will merge.
- `server/package.json` (dotenv line only), `server/package-lock.json`, and dotenv call sites.

## npm install caution
`server/node_modules` in your worktree is a SYMLINK to the main checkout's. **Before any npm command in server/**, delete that symlink (`rm server/node_modules`, which removes only the link) and run `npm ci --prefix server` (or `npm install --prefix server dotenv@^18` to regenerate the lock) so the install lands in your worktree and never in `~/Job-Bored`. Do the same for the root only if you truly need to, and say so in the report.
