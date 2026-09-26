# Lane SOL-HARDEN: fix the full-suite regressions, then an adversarial backend review and the leftover backend items

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 (D1–D12)
- `PLAN.md` §R (R1–R24)
- `LANES.md`
- the lane reports in `reports/` (`LANE-REPORT-*.md`): each §5 lists adjacent backend issues that nobody owns yet

**Routing:** sol · xhigh (pool X reset 2026-09-26 12:47). You are the **independent** backend reviewer: every backend line in this program so far was written by opus. Be hardened, edge-case driven and fail-closed.

Your worktree is based on `feat/gfx-integration` at `36f2c966`. It holds every lane except DESK-A, which is still live and fences `desktop/**`.

**Goal:** return `feat/gfx-integration` to **0 failures in the full `npm test`**, with no weakened claims. Harden and fix backend defects that the opus-written lanes left behind, and close the leftover backend items.

**Success means (each item red first, tests named with IDs):**

1. **P0: full-suite regressions (GFX-REG-1).** In `tests/integration/onboarding-chain-convergence.test.mjs`, 9 of 12 fail on integration and 0 fail on `origin/main` (`e751f0b4`). The bisect says `02df63f7` has 0 failures, and `29b7a3f6` (after the BE-FUEL merge) has 6; later merges added 3.
   - **The leading hypothesis, which you must verify:** this test's harness never loads `local-server.js` (or `oneflow-route-local.js`, `fit-profile-schema.js`, `fit-profile-sync.js`), and it stubs `/__proxy/ping` with the old `{ok:true}` shape, not the §R3 contract. So B5 fails closed, and every downstream chain step fails.
   - Other candidates: the R4 prerequisite (`discovery` requires `fit`), the D2 hosted gate, D1 (B5 has no Skip), or FE-B4's sync.
   - For **each** of the 9: find the root cause, then either fix **product code** when the chain is genuinely broken, or update the **harness or test** when the pinned behaviour moved by a §0/§R decision. Say which, and cite the decision.
   - **Never delete or weaken a claim.** "A finished flow never re-onboards", "escape is pausing", "refresh resumes", "the fuel key is NOT skippable" and "the ONE celebration" must all still be asserted.
2. **An adversarial review of the opus-written backend.** Read, hunt and write failing tests for real defects in:
   - `local-server.js`
   - the `dev-server.mjs` diff (`git diff e751f0b4..HEAD -- dev-server.mjs`): the ping and preflight, desktop mode, config serving, the bootstrap-state route, the keep-alive short-circuit
   - `scripts/lib/runtime-env.mjs`, `scripts/lib/paths.mjs`
   - `sheet-access-setup.js`: the exactly-once create under concurrency and resume
   - `fit-profile-sync.js`, `fit-profile-schema.js`
   - the `auth-session.js` diff
   - `start.sh`, and the `package.json` `start` script
   - the worker `config.ts` change

   Focus on: origin and CORS bypass, key or secret leakage (URL, logs, error bodies), path traversal in the new static routes, race conditions, fail-open branches, unbounded retries or timers, shell injection, and behaviour when `HOME` contains a space.

   Fix what's in your fence. Everything goes into a findings table in §3 (`ID | file:line | severity | defect | fixed? | test`).
3. **Leftover backend items** (from the lane reports' §5):
   - (a) `npm run dev` still uses `concurrently -k` and `--restart-existing`. Bring it to parity with `start`'s N4 fix, or explain why dev differs.
   - (b) `fix-setup` / `full-boot` can still run `bootstrap-local-discovery` (tunnel, launchd) in desktop mode. In desktop mode they must never touch launchd or tunnels.
   - (c) `doctor.mjs loadConfig` reads the repo `config.js` even in desktop mode. Use the runtime resolver.
   - (d) `scripts/install-discovery-tunnel-autostart.mjs:45` and `install-discovery-worker-autostart.mjs:38` build the bootstrap path by joining it onto the repo. Route both through `bootstrapStatePath()`.
   - (e) `user-profile.schema.json`'s `salaryFloor` description says "used only when salaryRequired=true", but the scorer applies it to every listed salary (FE-B4 finding). Fix the description, and keep the drift test green.
   - (f) `resume-generate.js` `callConfiguredAi`: accept `opts.signal`, so B3's 90 s abort truly cancels the fetch, and test it.

**Floor:** paste all of this in §4. Run it from your worktree **with an isolated HOME**, and never bind 8080/8644/3847.
- `npm run lint:repo`
- `npm run typecheck:repo`
- **`HOME=$(mktemp -d) npm test`**: exactly 0 `fail` (`todo` entries are fine)
- the worker suite: `cd integrations/browser-use-discovery && node --experimental-strip-types --test tests/browser/*.test.ts tests/discovery/*.test.ts tests/state/*.test.ts tests/sheets/*.test.ts tests/webhook/*.test.ts tests/e2e/*.test.ts`
- `npm run test:e2e-onboarding` and `npm run test:e2e-journey`
- `gitleaks protect --staged --redact`

**Report:** first line `DONE`, `DONE (uncommitted — sandbox)` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.

## Fence

- `tests/integration/onboarding-chain-convergence.test.mjs` and its harness
- the backend files listed in item 2, plus fixes inside them
- `scripts/**` (except `scripts/lib/runtime-env.mjs`, whose public contract is frozen: additive only; say so)
- `resume-generate.js`: `opts.signal` only
- `integrations/browser-use-discovery/src/contracts/user-profile.schema.json`: description only
- new `tests/gfx-sol-*.test.mjs`

**Do NOT touch:**
- `desktop/**` (DESK-A, live)
- `oneflow-beat-*.js` UI or copy, `oneflow-route-local.js`, CSS, `index.html`, docs, `.github/**`
- the live ports, the real `~/.jobbored`, `~/Library/LaunchAgents`

## Non-negotiables

- No weakened test claims.
- Every fix is red first.
- Fail closed.
- No key in a URL or log.
- Argv arrays only.
- Never kill a process you didn't start.

## Definition of Done

`HOME`-isolated `npm test` has 0 failures and the whole floor is pasted in §4. First line `DONE`. Local commits.
