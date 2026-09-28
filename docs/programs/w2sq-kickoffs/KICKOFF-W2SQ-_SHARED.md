# W2SQ: shared rules for every lane

Program: the post-#126 follow-ups, delivered as ONE clean PR. The orchestrator (Opus, cmux workspace "◑ Cmux orchestrator dashboard") integrates your branch into `feat/w2sq-integration`. Emilio publishes; you never do.

## §0 Locked (Emilio, 2026-09-26 02:40 CDT)
- Lanes run Muse Spark 1.3 Contributor at max effort, with no sandbox and approval mode "never". Pushing is blocked by the environment.
- Scope: aim for **every** claim in your list. You may **defer** a claim that is too risky or too large, with a written reason in your report's section 5. Never force a half-fix.
- Earlier BEAUDIT decisions still hold. Read `.lane-evidence/ref/SPEC-BEAUDIT-20260925.md` §0 (0.1–0.9) and `.lane-evidence/ref/DECISIONS.md` (D1–D10). Where they mention Opus build lanes, Muse now builds and the orchestrator verifies.
- The materials template registry (#126) is merged: `server/materials-templates.mjs`, `templates/materials/<family>/`, `server/materials-render.mjs`, `server/materials-render-model-adapter.mjs`. Do not re-implement it.

## Reference material (read-only copies inside your worktree)
- `.lane-evidence/ref/REGISTER.md`: every claim id (A1, B3, F21…) with its evidence and file:line pointers. **Read each of your claim rows before editing.** Line numbers may have drifted since 2026-09-25; re-locate by symbol.
- `.lane-evidence/ref/PRIOR-CLAIMS.md`: earlier audit claims mapped to register rows.
- `.lane-evidence/ref/probes-*`: audit reproducers. Promote them to real tests where your claim notes say so. Probes must never write to the real `~/.jobbored` or restart the live :8644 worker: set `HOME` to a temp dir for any probe that spawns a server.

## First action (before any code)
Create `.lane-evidence/LANE-REPORT-<lane>.md` with first line `PENDING` and five headings, each `PENDING`:
1 Mission · 2 Claims that went red first, named · 3 What shipped, file and fence · 4 Floor results, pasted · 5 Unverified and deferred (with reasons).
Update it as you go: write to a temp file, then rename. Final first line is `DONE` or `BLOCKED: <why>`.

## Way of working
- **Red first:** for each claim, write or promote a failing test that shows the defect, then fix it. Name the red tests in section 2.
- **Stay in your fence.** If a claim truly needs a file outside it, make the smallest change and list it in section 3 under "outside fence", with the reason.
- Match the surrounding code: comment density, naming, idiom. No drive-by refactors.
- Commit in coherent conventional commits (`fix(discovery): …`, `feat(materials): …`), with bodies that say why. Stage explicit paths only; never `git add -A` or `git add .`. `node_modules` entries are symlinks, so never stage them. Run `gitleaks protect --staged --redact` before each commit. A hit means BLOCKED, not a commit.
- End every commit message with:
  ```
  Co-Authored-By: Muse Spark 1.3 Contributor <noreply@meta.com>
  Claude-Session: https://claude.ai/code/session_017wFBgR5YHve8PD2i4fZc33
  ```
- **Never** push, open or merge a PR, change git remotes or config, rewrite history, or touch `~/Job-Bored` (the main checkout) or any other worktree.
- Do not stop to check in. Keep going until the Definition of Done is met or you are genuinely blocked. Blocked twice on the same thing: write `BLOCKED: <why>` and stop.

## Floor (run from your worktree root; paste the tails into section 4)
```
npm run lint:repo
npm run typecheck:repo
npm test                                   # the real gate (run-tests.mjs, includes tests/integration)
npm --prefix integrations/browser-use-discovery test    # if you touched the worker (or: npm run test:browser-use-discovery)
npm run test:e2e-smoke                     # if you touched any browser file
npm run test:e2e-journey                   # if you touched any browser file
npm run test:e2e-onboarding                # if you touched onboarding or setup
```
Known flake: worker test VAL-ROUTE-010 makes a real call to example.com. If it is the only failure, note it and move on. Do not "fix" it unless it is in your fence.

## Traps that fail silently
- `node --test tests/*.test.mjs` skips tests/integration/. Use `npm test`.
- A fresh HOME makes Playwright miss Chromium. Set `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright` using the REAL home path.
- zsh does not word-split `$var` in `for x in $list`. Run loops under bash.
- The hermetic harness does not fence same-origin `/profile/*` or `/__proxy/*`. Stub both in browser tests (see existing `installHostIsolation`).
- Single-class CSS rules lose to `body.jb-v2 h3/p`. Scope component CSS under its root class.
