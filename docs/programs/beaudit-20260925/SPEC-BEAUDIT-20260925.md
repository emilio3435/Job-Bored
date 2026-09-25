# SPEC-BEAUDIT-20260925 — JobBored backend: fix, optimize, add

Pinned SHA `f227fbb` (origin/main, 2026-09-25). Evidence: `REGISTER.md` (163 root causes from 186 lane rows), `INVENTORY.md`, `PRIOR-CLAIMS.md`, `reports/`, `verdicts/`. Mockup: `MOCKUP.html`. This spec specifies; the build is the next program, run from §8 once §0 holds Emilio's answers. Plan check: the Grok run stopped on a quota wall (402, 06:19 CDT), and Emilio chose to skip the second-vendor plan check, so none has run on this spec.

## §0 Locked decisions

Answered by Emilio on 2026-09-25 at 06:21 CDT. These override anything contrary below.

| # | Decision | Locked answer |
|---|---|---|
| 0.1 | P0 containment | Lanes P, R and X run first as their own wave and ship as an incident PR ahead of the rest. |
| 0.2 | Owner PII in the public repo | Replace it with neutral examples and load real values from gitignored files. No history rewrite. |
| 0.3 | Materials | Lane M builds PR #120's claim-ledger design (ledger from the user's resume, 3 narrow calls, cache key). |
| 0.4 | Hosted mode | The docs mark hosted mode unsupported now; lanes O and B fix E4–E6 in wave 2. |
| 0.5 | Error-cell PRs | Land #113, then #107 plus #109's safety-timer line; close #108 and #109. |
| 0.6 | Hermes apply | Stays shelved. Delete `greenhouse_filler.py`, drop CLI live mode now, and harden the gates before any re-enable. |
| 0.7 | Relay auth | A per-dashboard bearer token minted at deploy and stored in the dashboard config; anonymous calls get 401; path allowlist. |
| 0.8 | Memory and planner | Wire them through a stable intent key so memory feeds frontier scoring and unlocks saved searches (B21). |
| 0.9 | Build lane model (06:32) | Every build lane runs the opus family (`claude-opus-5-5`) at **medium** effort, replacing the sol, gemini and xhigh routing in §8. Muse still verifies each lane and a second vendor still reviews each diff (the author's family never verifies). The build runs as a dynamic Workflow: see `BUILD-WORKFLOW.md`. |

## §1 So-what

- **Four P0 holes are open on default setups.** A DNS-rebound web page can rewrite `~/.jobbored/llm.json` and the profile (E1, G2). The shipped relay spends the worker secret for anonymous callers (G1). `GET //` kills the worker and its runs (A1). Page visits, `agent-browser` and cleanup skip the SSRF guard (C1). Muse and the orchestrator reproduced all four; each is an S–M fix.
- **The OSS build treats Emilio as every user.** Materials tailor his resume for everyone (F1). The apply filler answers with his identity, and scripts target his Sheet (H8). `POST /profile` rewrites a tracked repo file (F7). No materials draft can ever reach READY (F2).
- **The Sheet has no concurrency control.** Stale row numbers and no per-Sheet lock mean duplicates, another job overwritten, Applied reverted to Expired, and lost notes (D1, D2). Re-discovery overwrites user columns (D4), and posting text becomes live formulas (D5).
- **Discovery drops its best leads and pays for discarded work.** A unit bug makes selection alphabetical (B1), an 18-slot cap silently truncates (B2), and rejected companies are still deep-extracted (B3). RUN-07, RUN-10 and RUN-11 are "fixed" only in helpers that production never calls, behind green tests named for the claims (C3, C4, C15). A run costs about 90–100k tokens (INFERRED).
- **Most of the prior audit is still open.** Of 52 backend claims, 22 are fixed, 7 have residuals, 20 are open and 3 are in flight; none of the 23 backend wishlist items is built. Hosted mode cannot work (E4–E6). There are seven AI-provider clients and nine copies of the Sheet column map.

## §2 Inventory snapshot

The weakest point of each surface is in brackets.

- `:8080` dev-server: static files, 20 `/__proxy` routes and the `/profile` proxy, lane G [no Host check: G2, G3].
- `:3847` API: 24 routes for scrape, ATS, llm-config, profile, applications and logos, lanes E and F [Host-derived same-origin: E1].
- `:8644` worker: 7 routes (webhook, runs, ingest, pipeline-update, cleanup, discovery-profile, health), lane A [crash before auth: A1].
- Discovery engine: scout → score → exploit → learn, lane B [selection: B1–B3].
- Fetch layers: worker sources/browser plus `server/shared`, 17 ATS providers, lane C [SSRF bypass: C1].
- Sheet writers: worker, patcher, cleanup, rescore, browser, Hermes, Apps Script, lane D [no lock: D1, D2].
- AI providers: 7 clients, lane E [enum drift: E2].
- Materials and profile: the drafter loop, rescore, from-resume, lane F [owner resume: F1].
- Local ops: starter, keep-alive, autostart, schedulers, relay deploy, lane G [open relay: G1].
- Hermes: 13 entrypoints and 3 crons, lane H [soft gates: H1, H2].
- Stores: 8 under `~/.jobbored`, 3 Sheet tabs, 4 under `~/.hermes` [non-atomic writes: F6, E14].

`INVENTORY.md` holds the full tables and assigns each of the 212 tracked backend files to an owning lane.

## §3 Prior-audit ledger

- **CRITICAL-AUDIT** (52 backend claims): 22 fixed, 7 fixed with a residual, 20 open, 3 in flight.
- **FEATURE-WISHLIST** (23 backend items): 0 built.
- **TECH_DEBT** (12): 4 fixed, 7 open, 1 moot.

Still open, with the register row: SEC-04 C1, SEC-05 A1, AUTH-01 G10, AUTH-03 E4, PRIV-01 E10/F7, SETUP-03 G21, SETUP-04 G4, SETUP-09 G8, DISC-06 B13, PIPE-03 B1, PIPE-04 D7/D11, PIPE-05 D8, PIPE-06 D10, PIPE-07 D1/D22, RUN-02 A6 (#102), RUN-04 D13, RUN-05 A5/A9, RUN-07 C3, RUN-08 B2/B3/B9, RUN-10 C4, RUN-11 C5, INGEST-01/04 C6, DOSSIER-01 E3, DOSSIER-02 F13, SCRIBE-02 E22, APPLY-01 D11/H18, P2-REDACT E11, P2-WRITESCOPE G4, P2-STATIC G13, TD-004 G17, TD-008 A7/A18, TD-010 E7, TD-014 G20, TD-015 G15, TD-016 D18, TD-021 D17. Each lane's answer is in `PRIOR-CLAIMS.md`.

## §4 Fix now (P0, P1)

Each line reads: claim — evidence — fix (effort). Every row is CONFIRMED and Muse-reproduced unless marked. S ≤ ½ day, M 1–2 days, L > 2 days.

**P0**
- **E1** (+G2): rebinding rewrites llm.json and the profile — `security-boundaries.mjs:94`, `dev-server.mjs:220` — a Host allowlist on every loopback listener (S).
- **G1**: relay injects the secret for anyone — `templates/cloudflare-worker/worker.js:60` — per-dashboard token plus a path allowlist (M).
- **A1**: `GET //` kills the worker — `W/server.ts:1021` — parse inside a try, plus a catch-all (S).
- **C1** (+C2, D15): three fetch paths bypass the SSRF guard — `W/browser/session.ts:151`, `bin/browser-use-agent-browser.mjs:51`, `expired-job-cleanup.ts:415` — route them through `safeFetch` and gate the browser (M).

**P1: trust and privacy**
- G3: gitignored logs are served — `static-path-guard.mjs:7` — serve from an allowlist (S).
- G4: the wizard silently starts a tunnel and a relay deploy — `discovery-autodetect.js:115` — explicit buttons (S).
- H8 (+F18, H21): owner PII and IDs are defaults — `filler_profile.py:14` — load from the gitignored profile (S).
- F7 (+E13): `POST /profile` writes a tracked file — `brand-logos.mjs:51` — keep the template root in `~/.jobbored` (S).
- E4: the browser never sends the hosted token — `hosted-api-auth.js` (0 callers) — one `apiFetch()` (M).
- E5: the image cannot save a profile and leaks paths — `user-profile.mjs:29` — vendor the schema (M).

**P1: Sheet integrity**
- D1 (+D8): concurrent writes duplicate rows and lose notes — `pipeline-writer.ts:720` — a per-Sheet mutex (S).
- D2 (+D3, F16): stale rows overwrite other jobs — `pipeline-writer.ts:788` — re-resolve by Link before writing (M).
- D4: re-discovery overwrites user columns — `pipeline-writer.ts:266` — fill only when empty (S).
- D5 (+F5): formula injection — `pipeline-writer.ts:603`, `profile-rescore-worker.mjs:597` — escape the cell or write RAW (S).
- D6: header drift writes the wrong columns and returns 200 — `pipeline-patcher.ts:45` — map by header, 409 on drift (S).
- F4: overlapping rescores let stale scores win — `index.mjs:542` — single-flight plus a generation id (M).

**P1: discovery**
- B1: the fit unit bug — `frontier-scorer.ts:375` — one score-unit helper (S).
- B2: leads past 18 dropped — `run-discovery.ts:1106` — budget only the scouts (S).
- B3: rejected companies extracted — `run-discovery.ts:206` — blank `rawText` for them (S).
- C5 (+B4): signals never reach ATS or LLM calls — `run-discovery.ts:753` — thread `runSignal` through (S).
- C3 (+B14): only 3 ATS providers are gated in — `run-discovery.ts:470` — derive the list from the registry (S).
- C4: one bad board wipes its siblings — `run-discovery.ts:747` — use the settled collector (S).
- C6: ingest writes "Careers" as the company — `handle-ingest-url.ts:974` — use the scraper's fields (S).
- C15 (+B19): tests cover helpers, not production — `ats-public-fetchers.test.ts:156` — run-level tests (S).
- E3: the scrape returns a different posting — `job-scraper-core.mjs:618` — id/url match only, plus `matchKind` (M).
- G5: Hermes on :8644 kills `npm run dev` — `start-discovery-worker-local.mjs:212` — name the owner and hold (S).

**P1: AI and materials**
- E2: the Local pin breaks ATS — `ats-scorecard.mjs:826` — a shared provider normalizer (S).
- F1: the owner's resume is used for every user — `materials-drafter.mjs:30` — build the master from the user's data (L).
- F2: no draft ever reaches READY — `materials-critic.mjs:203` — scan only the slot text (S).

**P1: Hermes apply (shelved path)**
- H1 (+H17): substring approvals — `gate2_telegram.py:214` — exact match plus a sender allowlist (S).
- H2: Gate 1 inherits another row's approval — `jhos_submit.py:51` — anchored normalizer (S).
- H3: the Notes wipe — `jhos_submit.py:334` — abort on a failed read (S).
- H4: "Send"/"Done" skip the gate — `universal_filler.py:130` — treat any submit click as final (M).
- H5 (INFERRED end to end): "Thank you" text false-verifies — `universal_filler.py:726` — require a success marker (M).
- H6: live submit with no gates — `greenhouse_filler.py:308` — delete the file (S).
- H7: an env flag bypasses the gates — `universal_filler.py:774` — live mode from the orchestrator only (S).
- H9 (INFERRED): a second Telegram poller blocks Gate 2 — `gate2_telegram.py:184` — confirm through the gateway (M).

B5 (#113) and G6 (#111) are P1s already fixed by open PRs.

## §5 Optimize

- **Discovery LLM cost:** wire the listing score cache (B8); pre-filter, then select, then score (B9). On a 25-listing repeat run this cuts 37 chat calls to 12 and 17.7k input tokens to 4.0k (measured).
- **Grounded exploit:** skip rejected companies (B3) and cap scouts (B12). Per 25 rejected companies that saves 50 Gemini, 50 preflight and 50 Browser Use calls (measured).
- **Materials:** fix F2, send text instead of HTML, and scope the run to the requested feature (F3). That cuts 3 calls to 1 and about 37k to about 9k input tokens per application (estimate).
- **Sheets reads:** read only the identity columns (D17): 37 KB down to about 10 KB per write at 310 rows (estimate).
- **`/health`:** cache the token and readiness (A8, D16): about 240 down to about 24 Google calls per hour under keep-alive (estimate).
- **Cleanup:** flush every 25 rows with concurrency 4 (D9): 180 up to about 720 rows per 45 minutes, and a killed pass keeps its progress.
- **Reliability:** one `runAsyncLifecycle` (A2, A12), append even when the update fails (D12), and write boot history rows (A5). No run sticks in `running` and no DiscoveryRuns row is lost.
- **Simplify:** one fetch layer (C12, about 700 lines removed). Split the 3,014-, 4,386- and 2,732-line files (B15, B16, G18) into modules under 700 lines.

## §6 Add (value ÷ effort)

1. **Discovery preview and cost receipt** (T0; B20, B23), find: `POST /discovery/preview` returns the resolved plan and predicted calls; `discovery-preview.v1` plus DiscoveryRuns cost columns; a preview sheet on the Run button (M).
2. **Cancel and idempotency** (A21, A20), find: `POST /runs/:id/cancel` and `idempotencyKey`; webhook v1.1; Runs tab (S).
3. **Duplicate review** (T1-2; D22), triage: collisions go to a `Review` tab; board badge and merge drawer (M).
4. **Timeline, funnel and receipt** (T2; D23, D24, H24), follow up: an append-only `PipelineEvents` tab; `application-receipt.v1`; dossier timeline (M).
5. **Capture preview** (T1-1; C19, E20), find: `POST /ingest-url?preview=1` returns fields with provenance; Add-URL card (M).
6. **Run drill-down** (T1-8; A19, C22), triage: `GET /runs?sheetId=`; `run-status-list.v1`; reopen from the Runs tab (M).
7. **Setup control center** (T0, T1-10; G21, G22, E21), setup: `/__proxy/ops-status` and `/api/llm-config/verify`; worker `/health` identity; Settings (M).
8. **Saved searches** (T1-3; B21), find: a stable intent hash plus a saved-search table; discovery drawer (M).
9. **Rescore preview** (F23), triage: `?preview=5` returns score deltas before any write (S).
10. **Claim ledger** (T2; F21, #120), apply: `GET /profile/ledger` feeds materials (L).

## §7 Target architecture

Eight single funnels replace today's duplicates:
1. **Loopback guard:** one Host and Origin check for the dev-server, API and worker.
2. **Egress:** `safeFetch` for every outbound URL, stripping credentials on redirect and capping bytes.
3. **AI provider:** `server/ai/provider.mjs` holds one enum, pin-only keys, signals and one error taxonomy; the worker re-exports it and the browser posts to `/api/ai/chat`.
4. **Sheets client:** a token cache, a per-Sheet mutex, Link re-resolution and a column map generated from `pipeline-row.v1.json`; stage writes go through a TS port of `pipeline-transitions.js`, and `PipelineEvents` records every write.
5. **Error envelope:** `api-error.v1` `{error, code, detail, nextStep, retryable}` everywhere.
6. **Run lifecycle:** one `runAsyncLifecycle`.
7. **Worker runtime:** env layering with sources, identity `{repoRoot, version}`, port inspection.
8. **User data root:** templates, logos and personal defaults live in `~/.jobbored`, never in the repo.

Contract bumps (per the AGENTS.md invariants, each updates the schema, examples, `AGENT_CONTRACT.md` and `docs/CONTRACT-CHANGELOG.md` together):
- The webhook moves to v1.1, additive: `idempotencyKey`, and the schema aligns with the parser.
- `pipeline-update` moves to **v2**, a breaking change: Applied requires `appliedDate` and `source`, with 409 `header_mismatch` and `ambiguous_match`.
- New v1 schemas: `api-error`, `run-status`, `run-status-list`, `ingest-url`, `cleanup-expired`, `discovery-preview`, `pipeline-events`, `application-receipt`.
- DiscoveryRuns header v2 adds cost and skip columns.
- The scrape response adds `matchKind`, `confidence` and `fetchedAt`.
- `llm-config` gets a normalized enum, and omitting `apiKey` keeps the stored key.

## §8 Build program

Sol builds backend and Opus builds browser surfaces. Gemini makes bulk and docs edits, which Muse verifies and the orchestrator commits. Muse verifies every lane and Grok reviews every diff. The claim letters are new.

Floor for every lane: `npm run lint:repo && npm run typecheck:repo && npm test && npm run test:browser-use-discovery && npm run test:contract:all`, plus the lane's probes promoted to tests. Browser lanes add `test:e2e-smoke` and `test:e2e-journey`; lane H adds the Hermes pytest job.

- **Wave 0, P perimeter** (sol, M): E1, G2, G3, A1, G4, G10. Fence: the worker listener, the origin section of `security-boundaries.mjs`, the `index.mjs` middleware, and the `dev-server.mjs` gate, `/profile` proxy and full-boot, plus `static-path-guard.mjs`.
- **Wave 0, R relay** (sol, M): G1, G24. Fence: `templates/cloudflare-worker/*` and `deploy-cloudflare-relay.mjs`.
- **Wave 0, X egress** (sol, M), after P: C1, C2, D15, C8, C9, E8. Fence: `session.ts`, `bin/*`, the cleanup fetch, and the SSRF section of `security-boundaries.mjs`.
- **Wave 1, S sheets** (sol, L): D1–D6, D9, D12, D13, D16, D17, D18, A8. Fence: `W/sheets/*`, `W/cleanup/*`, `handle-pipeline-update.ts`, `pipeline-row.v1.json`.
- **Wave 1, Q AI provider** (sol, L): E15, E2, E9, E10, E12, E14, B17. Fence: a new `server/ai/`, `llm-config.mjs`, the provider sections, and `chat-provider.ts`.
- **Wave 1, L lifecycle and contracts** (sol, L), after #102: A2–A5, A7, A9, A12, A15, A18, A20, A21, E7. Fence: `W/webhook/*`, `run-status-store.ts`, `contracts.ts`, `schemas/*`, `examples/*`, `AGENT_CONTRACT.md`.
- **Wave 1, H hermes** (sol, L): H1–H8, H10–H13, H15, H16, H19, H21–H23. Fence: `integrations/hermes-job-hunt/**`, `scripts/setup.mjs`, and a CI pytest job.
- **Wave 2, D discovery** (sol, L), after Q and X: B1–B3, B6, B8, B9, B11–B13, C3–C6, C15. Fence: `W/run/*`, `W/normalize/*`, `W/match/*`, providers, `handle-ingest-url.ts`.
- **Wave 2, M materials and profile** (sol, L), after Q: F1–F8, F11, F13, F14, F18, E13. Fence: `server/materials-*`, `profile-*`, `user-profile.mjs`, `brand-logos.mjs`, the templates.
- **Wave 2, O ops** (sol, M), after P: G5–G9, G11, G12, G14, G15, G20, E5, E6. Fence: `scripts/*` except `setup.mjs`, the `dev-server.mjs` worker section, `Dockerfile`, `render.yaml`.
- **Wave 2, B browser** (opus, M): E4, D11, D24. Fence: the `apiFetch` sites, `submission-flow.js`, `sheets-writeback.js`.
- **Wave 3, F features** (sol and opus, L): §6 items 1 and 3–9 on the wave-1 substrates.
- **Wave 3, G split and docs** (gemini, M): B15, B16, C14, G18, A11, G17, H20.

Serial edges: P before X, both touching `security-boundaries.mjs`. Q before D and M. P before O, both touching `dev-server.mjs`. Merge #102 before L, and land one Error-cell PR before S.

## §9 Decisions for Emilio

1. **P0 containment:** (a) ship P, R and X now as an incident PR *(recommended)*; (b) ship them with wave 1.
2. **Owner PII in the public repo:** (a) neutral examples from now on, with no history rewrite *(recommended)*; (b) also rewrite history (a force-push that breaks forks); (c) leave it as is.
3. **Materials:** (a) build #120's claim ledger in lane M *(recommended)*; (b) patch only F1 and F2; (c) disable server materials until #120 lands.
4. **Hosted mode:** (a) mark it unsupported now and fix it in wave 2 *(recommended)*; (b) fix E4–E6 in wave 1; (c) drop `render.yaml`.
5. **Error-cell PRs:** (a) land #113, then #107 plus #109's timer line, and close #108 and #109 *(recommended)*; (b) close all four and fold them into lane L.
6. **Hermes apply:** (a) keep it shelved, delete `greenhouse_filler.py`, drop CLI live mode, and harden the gates before any re-enable *(recommended)*; (b) harden and re-enable it; (c) remove it.
7. **Relay auth:** (a) a per-dashboard bearer token minted at deploy *(recommended)*; (b) an HMAC over body and timestamp; (c) retire the relay in favor of Tailscale.
8. **Memory and planner (B7, B18, about 4,000 lines):** (a) wire them through a stable intent key *(recommended)*; (b) delete them.
