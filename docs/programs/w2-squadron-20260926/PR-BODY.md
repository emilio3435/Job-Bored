## What this ships

One PR for the post-#126 follow-ups, built in parallel by six Muse Spark 1.3 lanes. Opus verified every lane and integrated them on `feat/w2sq-integration` (base `main` @ 453e9f06).

| Lane | What changes for you | Claims |
|---|---|---|
| **D · Discovery engine** | Discovery remembers what it learned through a stable intent key, and that memory feeds frontier ranking. Runs and LLM calls are capped, ATS pages are gated properly, listings dedupe by fingerprint, and ingest keeps real-host lineage. | BEAUDIT B1–B4, B6–B13, B18, C3–C7, C10, C13, C15, C17, C18, E3 (server half) |
| **M · Materials pipeline** | Resumes and letters are built from a **claim ledger** of your real facts. The pipeline makes three narrow schema-checked AI calls, caches results, has degraded and repair paths, and renders through the #126 template registry. Profile writes are atomic and validated when read. Owner identity is scrubbed from the Hermes templates. Legacy composer removed. | F1–F21, E13 · materials slices 1, 2, 4, 5, 8 |
| **O · Ops and hosted** | The worker identifies its checkout: it never kills or reuses a foreign worker, and it names whoever owns the port. `npm run restart` works cross-platform. The server-only Docker image works end to end. Pages ships a CSP and only allowlisted assets. Node 24 is aligned. | G5–G11, G13–G16, G19, E5, E6 |
| **B · Browser surfaces** | Every API call goes through one `apiFetch`, which sends the hosted token **only to the JobBored API's own origins**. Applied evidence (confirmed date and receipt note) reaches the Sheet on the fallback writer too. | E4, D11 |
| **T · One appearance system** | The five old preview themes are folded into the Signal / Dossier / Editorial registry, and a saved theme choice migrates one time. The preview uses the same family, accent and density as the PDF. | materials slice 7 |
| **E · Error codes + dotenv** | Every worker and server error code is lower_snake_case, with one exported map per package and a convention test that fails on uppercase. dotenv goes 17.4.2 → 18.0.1, which **replaces #121**. The dashboard still accepts the retired `UPSTREAM_ERROR`. | — |

### Integration fixes (orchestrator)
- `802b5d92`: review fix. `apiFetch` sends the hosted token only to the API's own origins, never to third-party or webhook URLs (11 origin tests).
- `30fa85d3`, `1214b866`: lowercased codes added by lanes that branched before lane E (`logos_unavailable`, `invalid_ledger`, `qa_clean`).
- `cb5619c3`: lane O's perimeter test now expects `host_not_allowed`.
- `0352bd5d`: resynced the vendored profile schema after lane M's `writingSamples` change.

## Verification (orchestrator-run on the final tree, 9f26b01b)
- `npm run lint:repo` ✓ · `npm run typecheck:repo` ✓
- `npm test`: 4,284 tests, **4,277 pass, 0 fail**, 7 todo (all pre-existing, other programs)
- worker suite: **978 / 978**
- `npm run test:contract:all` ✓ · `npm run test:coverage` ✓ (functions 93.4%, lines 88.2%) · `npm audit --omit=dev --audit-level=high` ✓
- e2e: smoke 24 · journey 33 · onboarding 7 · visual 56, all passing
- `gitleaks detect` over 453e9f06..HEAD: no leaks
- Every lane's floor was also re-run by the orchestrator before its merge; each lane report is in the program folder.

## Deferred, with reasons
- **C12** (merge the duplicated ATS fetchers): the worker and shared contracts differ in real ways (RawListing vs bare fields, different Ashby endpoints), so merging them is a redesign, not a P2 simplify.
- **E3, UI half** (dossier wording driven by `matchKind`): the server half and types shipped. The client copy has no owner yet.
- **H14** (Hermes `.env` precedence logging): outside ops scope; it belongs to the Hermes lane.
- **G12** (PowerShell start and Task Scheduler autostart): new platform surface. The matrix marks win32 autostart as unsupported.
- **G20** (npm workspaces): needs a lockfile migration rehearsal. The interim fix shipped (`npm ci` postinstall and a CI server audit).
- Materials **slice 2** leftovers (the shared `resume-generate.js` quality-contract string, and the numbers in the tailorer prompt), plus the **slice 7** rows outside lane T's fence (prompt defaults, BYOK budgets and banned list, system-prompt pass, server request fields).

## Not verified
- Nothing ran against live Sheets, Telegram, Render or a hosted deployment. Every lane used fakes, and the real-Render probe was not replayed.
- **Second-vendor review was not available.** Grok's balance is exhausted and Astra is capped until Sep 29, so Opus reviewed diffs as the non-author family.
- No human has looked at a live-model materials draft; the e2e-visual renders use fixtures.

## After merge
- Close **#121**, which this replaces.
- Logos now resolve from `~/.jobbored/logos` (since #126): set `HERMES_RESUME_TEMPLATE_DIR` or re-upload.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017wFBgR5YHve8PD2i4fZc33
