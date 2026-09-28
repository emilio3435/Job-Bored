# Handoff — JobBored onboarding & discovery run path (as of 2026-09-02, 23:45 CDT)

Goal: Pick up the six-beat onboarding and discovery run path where the 2026-09-02 session left it — starting with the one new, unfixed defect below — without re-deriving anything already proven and merged.

Success means:
  - The new defect (§1) is fixed with a failing-then-passing test, merged to `main` through the CI gate, and proven live in a browser on a greenfield install.
  - Every claim in this file that you rely on is re-verified against `main` before you act on it; anything that has moved is corrected here.
  - The floor in §6 is green before every push. CI is the gate; merge only on eleven green checks.
  - Nothing in §7 (guardrails) is violated. Two of them cost this session real time.

Stop when: §1 is merged and live-proven, and §4's open items are either fixed the same way or still listed here with a one-line reason they were left.

---

## 1. The new defect — Beat 1 "Continue with Google" stays greyed after pasting a Client ID

**What the user sees (Emilio, 2026-09-02 23:44):** on a greenfield install, take Beat 1's "First time? You'll need a free Client ID" detour, paste the Client ID, save it. The message says "Client ID saved. Continue with Google below." Press **Continue with Google**: no Google popup; the button greys out and stays that way. The page does not refresh.

**Mechanism, traced in code (verify each line still holds):**

1. `app-bootstrap.js` cold-start branch (no sheet) calls `initAuth()`.
2. `auth-session.js:653 initAuth()` reads `host().getOAuthClientId()`. On greenfield it is empty, so `initAuth` **returns immediately** — `gisLoaded` stays `false`, `tokenClient` stays `null`. GIS is never initialized on this boot.
3. `oneflow-beat-google.js:341 saveClientId()` writes the id (`mergeStoredConfigOverridePatch({ oauthClientId })`) and calls `applyOAuthClientChange(raw)`, then paints the success message **without looking at the return value**.
4. `auth-session.js:614 applyOAuthClientChange()` only re-inits the token client when GIS is *already* loaded; with `gisLoaded === false` it **returns `false` and does nothing**.
5. "Continue with Google" then runs `signIn` with no token client. The shell's busy stages for `ACTION_CONTINUE` start (`oneflow-beat-google.js:211 ctx.setBusy(...)`) and the early bail never clears them — that is the greyed button.

The Settings modal avoids this exact hole by reloading when `applyOAuthClientChange` returns `false` (`settings-modal.js` ~L719: "OAuth client saved — reloading…"). Beat 1 does not.

**Fix direction (smallest honest change):** in `saveClientId`, when `applyOAuthClientChange(raw)` returns `false`, initialize GIS for the first time — `call("initAuth")` now finds the saved id and runs `tryInit`, which sets `gisLoaded` and builds the token client. Confirm `initAuth` is safe to call twice. If GIS cannot be initialized in-session, fall back to what Settings does: reload — the flow state persists at Beat 1, so a reload resumes there. Whichever path, `ACTION_CONTINUE` must never be left in a busy state after an early bail (clear the stages on every exit of the sign-in handler).

**Test seams:** `tests/oneflow-l1-beat-google.test.mjs` (Beat 1 unit harness); `tests/oneflow-l6-harness.mjs` `loadCutover({ sheetId: "" })` drives the real boot chain and its host records `initAuth` calls (`makeHost` → `initAuth: record("initAuth")`), so "saving a Client ID on a boot that never initialized GIS calls initAuth" is directly assertable. Live proof: `http://localhost:8080/?greenfield=1` → Make it mine → the Client ID detour → paste → Continue with Google → the Google popup opens.

## 2. What merged today (all on `main`, all CI-green, newest first)

| PR | main @ | What |
|---|---|---|
| #103 | 58366b6 | Unconfigured AI provider → Beat 3 says "go back to the AI step"; server answers 409 not 500 |
| #101 | b5bc7fe | Dashboard-started worker logs to `~/.jobbored/browser-use-discovery/logs/worker.log` instead of `/dev/null` |
| #100 | 04433c6 | Fleet polish: preflight regression from #96; `open()` re-checks the sheet (S0 cannot land on the payoff); 401 self-heal bound to this machine's worker; copy names real controls |
| #96 | 94b8340 | Placeholder `YOUR_SHEET_ID_HERE` is "no Sheet connected", not a broken credential |
| #95 | 5152257 | Worker env parity (env-file merge; dev-server spawn layers the same files as the starter); `allowUnrestrictedFallback` ships with any dashboard allowlist |
| #94 | 1c7f016 | Webhook secret survives a masked sheet id; 401 self-heal reads `/__proxy/discovery-webhook-secret`; stale completion restarts the flow |
| #93 | 06fb70b | Beat 6 exits land on the real dashboard, not the sample board |

Full root causes, evidence, and lessons for each are in the session memory file (`~/.claude/projects/-Users-emilionunezgarcia-Job-Bored/memory/project_jobbored_onboarding_teardown.md`); read it before touching any of these areas.

## 3. Machine state you are inheriting

- Dev stack: `npm run dev` from `~/Job-Bored` on `main @ 58366b6` — web :8080, API :3847, worker :8644. Log: `/tmp/jobbored-dev.log`. Worker log (dashboard-started workers included since #101): `~/.jobbored/browser-use-discovery/logs/worker.log`.
- Emilio's browser profile: stored `sheetId` and `oauthClientId` are **blank** (a greenfield mask); flow state was reset by #100's entry check; his resume text (7,823 chars) and profile draft are intact in flow-state drafts; server fit profile (3 roles, 4 strengths) and `~/.jobbored/resume.txt` are intact. He is meant to click "Make it mine" and connect his existing Pipeline sheet by URL in Beat 1 — §1 is what blocks that.
- Worker env: service-account key configured in `integrations/browser-use-discovery/.env`; the home env's `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE=` is an empty placeholder (harmless since #95). `worker-config.json` still has `sheetId: "YOUR_SHEET_ID_HERE"` (harmless since #96 — the dashboard's sheet id wins once Beat 1 is done).
- Playwright: locked `@playwright/test@1.61.1`; Chromium build 1228 restored 2026-09-02 21:00. If `npm ls playwright` shows an *extraneous* newer copy again, `npm prune` then `npx playwright install chromium`.
- Uncommitted, not yours: `integrations/hermes-job-hunt/resume-template/logos.json` (Emilio's). Never stage it.
- Untracked QA material: `docs/qa/2026-09-02-greenfield-walkthrough/` (Gemini report + 61 screenshots), `docs/qa/GEMINI-GREENFIELD-WALKTHROUGH-PROMPT.md`, `docs/qa/fixtures/walkthrough-resume.txt` (fictional).

## 4. Open items, in priority order

1. **§1 above.** Blocks Emilio's own re-onboarding.
2. **The 46-minute scout hang.** Run `run_c9d4ebe5…` (variation `9f85a5d2110dd554`), accepted 2026-09-03 00:45:59Z with a real sheet id, checkpointed scout phase seq 2 at +30 ms, then no progress until the stack was stopped; the next worker labeled it "restarted mid-run". The label is the consequence, not the cause. No logs exist for that worker (pre-#101). Reproduce by running discovery from Beat 6 and watching `worker.log`; the budget is 60 min with no per-phase liveness check, which is likely a second defect once the first is understood.
3. **Tier C from the fleet review (deferred, not blocking):** the env-parity test's only env-file assertion loops over zero keys in CI (hollow); the payoff-exit tests stay green if the `openDiscoveryDrawer` bridge lines are deleted (hollow); `AGENT_CONTRACT.md` and `docs/INTERFACE-COMPANY-ALLOWLIST.md` still say allowlists fail closed; `handle-ingest-url.ts` still resolves the placeholder sheet id; the silent allowlist broadening (zero catalog match → unrestricted search) is not surfaced to the user anywhere; the self-heal ignores the route's `wrote` flag (a freshly generated secret needs the forced worker restart Beat 5 performs).
4. **Beat 3 draft capture** saves on the textarea `input` event only. Real users are fine (keyboard paste fires it); programmatic `.value` writes are not captured. Snapshotting the field on pause/close would make it robust. Low priority.

## 5. Walkthrough reports — how to read them

Two Gemini walkthroughs exist (`docs/qa/2026-09-01-six-beats-walkthrough/`, `docs/qa/2026-09-02-greenfield-walkthrough/`). Both contained at least one claim contradicted by their own screenshot (a "blocking modal" that the image shows as the small non-modal finale burst). Treat every ERROR/MISMATCH row as a hypothesis: open the cited screenshot, then the code, then decide. The prompt now carries a rule requiring the agent to re-open its screenshot before writing such a verdict. Of the 2026-09-02 report's four non-OK rows, one was real (fixed in #103), one refuted, one a harness artifact, one by design — details in the #103 PR body.

## 6. The floor (run all before any push)

```
npm test                     # scripts/run-tests.mjs — includes tests/integration/
npm run lint:repo
npm run typecheck:repo
npm run test:contract:all
npm run test:e2e-journey     # Playwright, spare ports; 13 today
npm run test:e2e-smoke       # 7 today
npm run test:e2e-visual      # 37 today
cd integrations/browser-use-discovery && npm test   # 655 today, when the worker changes
```

One test is `todo`-marked and prints ✖ under `npm test` while `fail 0` — it is not a failure. Merge with `gh pr merge <n> --rebase`; if GitHub says BEHIND, `gh pr update-branch <n> --rebase` and let CI re-run. `pr-lint` rejects a PR subject that starts with a capital letter.

## 7. Guardrails that cost this session time

- Never kill or bind ports 8080, 3847, 8644 in a repro. Use spare ports (Playwright already does). Emilio rejected a tool batch that would have.
- Never POST a placeholder value to a write route (`/__proxy/discovery-env-key`) on his machine; that overwrote his real SerpApi key once. Read routes only.
- The `!` shell has a lean PATH: use `/usr/bin/curl`, `/usr/sbin/lsof`, `/usr/bin/cut`; `node` via `$(node -e 'console.log(process.execPath)')` if needed.
- A local guard (`dcg`) blocks any `>` character in a command that touches a home path — including inside `sed` replacements like `<set>`. Use `tee -a`, `printf`, or Python for writes; avoid angle brackets in strings.
- `zsh` globs `--include=*.js`; quote it.
- Codex/worktree lanes cannot run `npm test` (loopback blocked) or commit (index.lock); rescue-commit from the orchestrator.
- The Chrome MCP tab shares Emilio's real profile (localStorage + IndexedDB). It masks any value whose key looks like a secret; compute booleans with neutral names, and never print or log a secret.
- A `git pull` can time out on this network mid-chain; check `gh pr view <n> --json state` before assuming a merge failed.
- `dev-server.mjs` and `server/index.mjs` are read at process start; browser JS is served live from the tree. Changes to the former two need a stack restart to take effect.

## 8. Reading order for a cold start

1. This file.
2. The memory file named in §2 (root causes and lessons, in order).
3. `docs/ONE-FLOW-ONBOARDING-SPEC.md` §3.4 (entry/exit/resume) and §5 B1 (the Client ID detour is where §1 lives).
4. `oneflow-beat-google.js`, `auth-session.js` (`initAuth`, `applyOAuthClientChange`, `signIn`), `settings-modal.js` around L690–L740 (the reload fallback that Beat 1 lacks).
