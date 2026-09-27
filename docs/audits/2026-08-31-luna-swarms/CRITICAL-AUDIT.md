# Critical audit

This register consolidates 160 raw critical-swarm defect claims. Repeated findings from independent lanes are merged into one repair family and retain the originating lane IDs for traceability.

Severity used here:

- P0: immediate containment; secrets or host data are exposed on a reachable default path.
- P1: core security, data-integrity, lifecycle, or primary-journey failure.
- P2: material reliability, accessibility, contract, or recovery defect.
- P3: localized inconsistency or hardening gap.

## P0 — contain first

### SEC-01 — Dev server arbitrary-file read and runtime-secret exposure

Evidence: C01-F01, C10-F01; independently reproduced by the integration owner.

`dev-server.mjs` decodes the URL and joins it to the repo root without containment enforcement. Encoded traversal returned a known file from `/private/tmp`; direct requests also returned ignored worker `.env` and bootstrap state containing a webhook secret. The server currently listens on `*:8080`.

Required outcome:

- Resolve and realpath-check every static target beneath the allowed public root.
- Deny dotfiles, `.env*`, bootstrap/runtime state, and non-public directories.
- Move secrets outside every served root.
- Bind loopback by default; make remote exposure explicit and authenticated.
- Add regression probes for encoded separators, malformed encodings, symlinks, dotfiles, and runtime artifacts.

Do not expose the current port to LAN, tailnet, or a public tunnel before this is fixed.

## P1 — security and trust boundaries

| ID | Consolidated defect | Evidence | Required outcome |
|---|---|---|---|
| SEC-02 | Local proxy/control endpoints use wildcard CORS and authorize by TCP peer, exposing secret reads, restarts, installers, Tailscale, and env writes to arbitrary browser origins that can reach localhost. | C10-F02 | Exact-origin allowlist plus authenticated local handshake; no wildcard CORS on control routes. |
| SEC-03 | The env-key writer permits newline injection, allowing an allowlisted value to append arbitrary worker variables. | C10-F03 | Reject control characters and use a structured env writer. |
| SEC-04 | Worker, shared scraper, redirect, and rescore paths lack DNS-safe validation at connection time and on every hop. | C06-F03, C10-F04 | One DNS-pinned outbound fetch primitive for all job URLs and redirects. |
| SEC-05 | Malformed encoded paths can terminate both dashboard and worker listeners. | C01-F02, C10-F09, C11-F08 | Catch URI decoding at each request boundary and return a controlled 400. |
| AUTH-01 | Shipped CSP blocks `www.googleapis.com`, `script.googleapis.com`, `docs.google.com`, Clearbit, and configured custom origins used by current code. | C01-F03/F05/F07, C02-F03, U04-F08, U14-F01 | Derive a minimal tested policy from supported transports, preferably through same-origin proxies. |
| AUTH-02 | A token missing Sheets scope can fall back to a public read and still unlock write-looking UI because capability is reduced to token presence. | C02-F01 | Track read and write capability separately; missing scope must remain read-only or reopen consent. |
| AUTH-03 | Hosted API auth is required by the server but omitted by packaged browser callers. | C10-P01 | Design an authenticated same-origin/session transport; keep no-token hosted calls denied. |
| PRIV-01 | Privacy docs say tokens are memory-only and career data stays local, while tokens use sessionStorage and hosted AI providers receive resume/profile/job context. | U14-F02/F10 | Make storage and provider data flow accurate in code, onboarding, Settings, README, and SECURITY. |

## P1 — configuration, setup, and readiness

| ID | Consolidated defect | Evidence | Required outcome |
|---|---|---|---|
| SETUP-01 | Saving unrelated Settings clears the canonical discovery URL/secret because removed Settings fields serialize as empty. | C03-F01 | Omit absent fields and add a preservation regression. |
| SETUP-02 | Discovery automation controls render but their binder exits on a removed legacy button, leaving schedule controls inert. | C03-F02, U04-F05 | Bind to current controls and verify every action in a current-partial browser test. |
| SETUP-03 | Discovery readiness turns unverified or partially configured state into green “Discovery ready.” | U04-F03/F04, C07-F04 | Verified endpoint state must be distinct from ready-to-test and partial/recovery states. |
| SETUP-04 | Opening discovery setup can silently install keep-alive and render no wizard. | C07-F04/F05 | Always render review state; require explicit consent for OS/background installation. |
| SETUP-05 | Cloudflare Quick Tunnel state is normalized as ngrok; keep-alive then calls the ngrok API. | C07-F02, C09-F01/F02 | Preserve transport kind end to end and use transport-specific probes/maintenance. |
| SETUP-06 | First-run existing-Sheet connection validates only ID syntax, says connected, and never loads the Sheet on that route. | C02-F02, U01-F03 | Read-only access/header verification, then the normal load/reveal/refresh sequence. |
| SETUP-07 | Optional AI and discovery are hard first-run gates. | U01-F01/F02 | Allow a Sheet-only tracker path; feature-gate AI/discovery later. |
| SETUP-08 | Provider selection resets after Back navigation. | C03-F03 | Preserve every supported effective provider through rerender/back. |
| SETUP-09 | Install/schedule status often checks artifacts rather than active jobs and can report installed after activation failure or migration drift. | C09-F03/F04 | Verify active backend identity and last successful execution, not file existence. |

## P1 — profile and discovery intent

| ID | Consolidated defect | Evidence | Required outcome |
|---|---|---|---|
| DISC-01 | Discovery drawer fetches relative `/profile` on port 8080 while the configured API is on 3847. | C01-P01, U02-F01, U03-F01 | Reuse the canonical API-base resolver. |
| DISC-02 | `mergedUserProfile` is sent by the dashboard but dropped by the worker parser. | C11-F02 | Preserve and validate the merged non-secret object through dispatch. |
| DISC-03 | Master-profile/search-plan intent is absent from legacy guards, producing false `blank_intent`. | U03-F04, C07-F01, C11-F03 | Build one effective intent object used by guard, payload, query plan, and worker. |
| DISC-04 | Per-run company blocklist is accepted but ignored in both normal and ATS pools. | U03-F02, C11-F01 | Normalize and subtract blocklist after allowlist/skipped-company logic. |
| DISC-05 | Grounded-web opt-out is serialized but ignored by effective-source resolution. | U03-F03 | Make the per-run control authoritative or remove it. |
| DISC-06 | Unknown allowlist entries are silently dropped and can broaden into unrestricted search. | U03-F07 | Resolve against a catalog; block or explicitly confirm broad fallback. |
| PROFILE-01 | “Open full wizard” starts blank over a saved profile, and the UI drops schema-supported tie breakers. | C03-F06, U02-F02/F03 | Explicit create/edit modes; preserve all untouched schema fields. |
| PROFILE-02 | Browser-local resume is unavailable to server-side Fit Profile prefill. | U02-F05 | Pass staged text to a non-persisting analysis route or unify the resume source. |

## P1 — Pipeline and Sheet integrity

| ID | Consolidated defect | Evidence | Required outcome |
|---|---|---|---|
| PIPE-01 | Pipeline and Lattice are competing v2 boards; Lattice also misses normal boot because it races the `jb-v2` class. | C04-F01/F02, U06-F01 | Select one canonical renderer and one activation contract. |
| PIPE-02 | Stage/status registries diverge; Rejected/Passed disappear and Expired is relabeled Dismissed. | C04-P01, U06-F02, U10-F03, U12-F01 | One stage registry with active/closed semantics used everywhere. |
| PIPE-03 | Lattice renders valid 1–10 fit values as percentages and worker frontier scoring similarly saturates the scale. | C04-F03, U06-F03, C12-F02 | Normalize score units once and retain unknown separately. |
| PIPE-04 | Visible v2 Applied moves write only Status, bypassing Applied Date and Follow-up side effects. | C04-F04, U10-F01, U11-F07 | One atomic transition writer for all board/dossier paths. |
| PIPE-05 | Inbound pipeline updates rewrite the full stale A:Y row, risking loss of concurrent human edits. | C13-F03 | Narrow cell updates plus conflict-safe note append/serialization. |
| PIPE-06 | Dismiss/restore and direct expiry paths can leave UI and Sheet state divergent or bypass audit side effects. | U12-F03/F04/F09 | Canonical closure transition with atomic state, audit note, rollback, and visible restore. |
| PIPE-07 | Persisted-row dedupe is Link-only; alternate ATS URLs, redirects, stale tabs, and concurrent appends can duplicate roles. | U05-F02, C06-F06/F10, C13-F08 | Persist canonical/provider/semantic identity, serialize per Sheet, and provide merge review. |

## P1 — discovery execution and run lifecycle

| ID | Consolidated defect | Evidence | Required outcome |
|---|---|---|---|
| RUN-01 | Terminal run status is mutable; late running/watchdog writes can replace final state. | C11-F04 | Enforce terminal immutability inside the store. |
| RUN-02 | Async work begins before running-status persistence succeeds, permitting invisible duplicate side effects on retry. | C11-F05 | Persist lifecycle state and guaranteed terminal/watchdog handling before dispatch. |
| RUN-03 | Polling has no request timeout, keeps recovered runs in error, and lets old in-flight responses corrupt new runs. | C08-F02/F03/F04 | Abortable per-poll and overall deadlines plus run-generation guards. |
| RUN-04 | History has 9 headers/10 cells, misparses canonical rows, can stay “Loading,” drops local terminal outcomes, and puts success text in Error. | C08-F01/F05/F06/F08/F09, U04-F01 | Version the row contract and add structural browser tests. |
| RUN-05 | Watchdog/catastrophic failures can omit durable DiscoveryRuns rows. | C08-F07, C13-F07 | One idempotent terminal history finalizer at the webhook boundary. |
| RUN-06 | Retry broadening executes even when disabled. | C12-F01 | Enforce the flag in the outbound call sequence. |
| RUN-07 | Production ATS gating recognizes only Greenhouse, Lever, and Ashby despite a 14-provider registry. | C12-F03 | Derive execution from the registry or report explicit unsupported state. |
| RUN-08 | Deep extraction happens before frontier selection and budgets start too late. | C12-F04/F08 | Scout lightweight candidates, rank/select, then exploit under a run-scoped budget. |
| RUN-09 | Run-level dedupe drops distinct locations before the stronger fingerprint layer. | C12-F05 | Use the location/remote-aware fingerprint in the production run path. |
| RUN-10 | One failed ATS board discards successful sibling results. | C12-F06 | Per-board `allSettled`, retained successes, attributed failures. |
| RUN-11 | Fetch fallback and outer run timeout do not abort underlying work. | C12-F07 | Propagate AbortSignals through browser/fetch/provider layers. |

## P1 — intake, dossier, and materials

| ID | Consolidated defect | Evidence | Required outcome |
|---|---|---|---|
| INGEST-01 | Worker scraper drops structured company/location, labels fallback incorrectly, and cannot reach configured LinkedIn SerpApi fallback. | C06-F01/F02 | Preserve scraper output/source lineage and pass usable fallback context. |
| INGEST-02 | Default v2 transport failures can tell users to use manual entry without exposing a manual action. | C06-F04 | One manual CTA reachable from every failure state. |
| INGEST-03 | Manual “Description” is written into personal Notes and excluded from later evidence. | U05-F03 | Separate job description from user notes and label it user-provided. |
| INGEST-04 | Generic career host inference can save company as “Careers” or “Linkedin.” | U05-F04, C06-F01 | Prefer structured employer data and reject common host placeholders. |
| DOSSIER-01 | Title/company-only inference is shown as “grounded in the posting”; cache has no TTL or visible freshness. | C05-F05/F06, U05-F01/F06, U08-F01/F03 | Persist source, field-level provenance, profile revision, confidence, and freshness. |
| DOSSIER-02 | Malformed model delimiters are rendered as authoritative requirements. | U08-F02 | Validate structured output and show a review state instead of polluted claims. |
| SCRIBE-01 | Scribe and Lattice fail normal v2 boot on the class race; Scribe remains disconnected from role/draft state. | C05-F01/F03, U09-F01/F04 | Deterministic mount plus explicit selected-role/document state. |
| SCRIBE-02 | Visible ATS score is a demo heuristic, including a nonzero empty-document score. | C05-F02, U09-F06 | Consume the real ATS state/evidence or clearly label/remove demo scoring. |
| SCRIBE-03 | Refine reports success before async completion; Done/Print can use unsaved stale edits. | C05-F08/F09/F11, U09-F02/F03/F05 | Promise/event-driven completion, synchronous flush, persisted versions, failure truth. |
| APPLY-01 | Applied is a drag-driven claim without explicit submission confirmation or evidence. | U10-F02 | Human-only “Mark submitted” flow with date, source, receipt/checklist, and undo. |
| APPLY-02 | Human approval contracts disagree on Gate 1 and Telegram thread 48 versus 314. | U10-F04/F05 | One versioned gate contract used by docs, runtime, send, and poll. |

## P1 — accessibility and daily work

| ID | Consolidated defect | Evidence | Required outcome |
|---|---|---|---|
| UX-01 | Default Dawn removes overdue follow-up, waiting-on-reply, and stale-application work. | U06-F05, U11-F01 | Restore one actionable Today queue in the default experience. |
| UX-02 | “Last 30 days” metrics count the current full snapshot without date filtering. | U13-F01 | Date-window the metrics or rename them as current snapshot. |
| A11Y-01 | Global toasts are not announced; numerous dialogs lack consistent focus containment/restoration. | U14-F04/F05, U07-F05 | Shared modal and live-region primitives with browser coverage. |
| A11Y-02 | Fit Profile labels, background inertness, and stacked dialogs fail core accessibility expectations. | U02-F06/F07/F08 | Programmatic labels, single overlay owner, focus trap and restore. |
| MOBILE-01 | Active stage movement lacks a reliable explicit touch/keyboard alternative; hit targets are small or hover-dependent. | U06-F04, U07-F03/F04, U10-F07 | Visible 44px `Move to` action with keyboard/screen-reader parity. |

## P2/P3 hardening backlog

These remain material but follow the P0/P1 sequence:

- Add `server/.dockerignore`; never copy `.env*` into image layers (C10-F10).
- Redact upstream provider error bodies; add server timeouts and disconnect cancellation (C10-F05/F06).
- Never forward ambient `OPENAI_API_KEY` to arbitrary compatible endpoints (C10-F07).
- Ignore untrusted forwarded headers for CORS and normalize malformed JSON to the API error schema (C10-F11/F12).
- Add `x-run-status-token` to the documented CORS header path and validate nested run IDs (C11-F07/F09).
- Validate pipeline-update event/schema/fields before any mutation (C11-F10, C13-F05).
- Preserve grouped multi-Sheet config envelopes (C11-F06).
- Make Setup Doctor, cleanup, and scheduler actions show diagnosis and exact write scope before mutation (U01-F05, C13-F02/F04/F09).
- Fix Runs filtering, keyboard sorting, terminal zero/unavailable semantics, and funnel false buttons (U04-F02, U13-F03/F04/F05/F06).
- Add real soft-keyboard and phone-geometry coverage (U07-F06/F08/F09).
- Separate destructive settings reset from deletion of resumes, drafts, samples, AI context, OAuth state, and consent (U14-F03).
- Make static deployments assemble partials and apply an explicit security policy (C01-F04/F06, U01-F09).
- Remove or repair dead Letter/Workshop navigation and stale configuration/docs (C04-P02/P03, U14-F07, U09-F09/F13).

## Lane coverage

| Lane | Assigned area | Result |
|---|---|---|
| C01 | Runtime composition, bootstrap, config, CSP | COMPLETE |
| C02 | OAuth, auth session, Sheets read/write | COMPLETE |
| C03 | First run, onboarding, Settings, Fit Profile, Setup Doctor | BLOCKED for shared-browser proof; local/static audit complete |
| C04 | Pipeline, Lattice, filtering, drag/writeback | COMPLETE |
| C05 | Dossier, enrichment, ATS, Scribe, materials | COMPLETE |
| C06 | URL/manual intake, scraper, endpoint resolution | COMPLETE |
| C07 | Discovery drawer, setup wizard, relay/transports | COMPLETE |
| C08 | Run orchestration, polling, status, history | COMPLETE |
| C09 | Local services, installers, schedules, keep-alive | COMPLETE |
| C10 | Server, CORS, auth, providers, security | COMPLETE |
| C11 | Worker HTTP boundary, lifecycle, status store | COMPLETE |
| C12 | Worker sources, scoring, extraction, dedupe | COMPLETE |
| C13 | Sheets writers, schemas, contracts, cleanup | COMPLETE |
| C14 | Cross-cutting browser, a11y, responsive, dependency/test gaps | COMPLETE |

## Test interpretation

The green deterministic floor does not invalidate these findings. Many defects sit between individually tested modules: competing renderers, mismatched origins, stale configuration ownership, lifecycle ordering, missing side effects, browser CSP, and controls wired to retired DOM IDs. C14 also confirmed that the two browser suites are advisory in CI (`continue-on-error`). They should become required only after their config and environmental dependencies are made hermetic.
