## BEAUDIT wave 1 (part 1): Hermes safety and AI provider

This PR lands two wave-1 lanes of the 2026-09-25 backend audit build: H (Hermes safety) and Q (AI provider). It closes 10 P1 rows: H1 (+H17), H2–H9 and E2. It also lands the P2/P3 rows these lanes own. The other two wave-1 lanes are on hold by Emilio's call: S (Sheets client) waits on #107, and L (Lifecycle and contracts) is parked.

Branch `feat/beaudit-build-w1` was cut from `fix/beaudit-p0-containment` at 37f5c38, which is PR #122 as first pushed. Every build lane ran on Opus 5.5 at medium effort. Muse (Spark 1.3) verified each lane and astra-ro (gpt-6-astra) reviewed each diff. The orchestrator merged a lane only after its merged tree passed the full floor, e2e, the Hermes pytest suite and gitleaks.

| Merge | Lane | Claims | Muse | Review | Repair rounds |
|---|---|---|---|---|---|
| 62143b3 | H, Hermes safety (§0.6, §0.2) | H1 (+H17), H2–H13, H15, H16, H18–H20, H22, H23 | all FIXED at 290335c | no blocking | 3 |
| 2494afa | Q, AI provider | E15 (+F15), E2, E9, E10, E11, E12, E14, B17, E18 (partial) | FIXED at 58783a0 (E18 waived) | no blocking | 7 across 4 runs |

### What changed

- **H, Hermes safety.** Apply stays shelved (§0.6): `greenhouse_filler.py` is deleted and the CLI live mode is removed. Gate 1 and Gate 2 are hardened with exact match, a reply-to id, a sender allowlist, cancel on any other reply and a dedicated Gate 2 bot token. The filler stops after a submit it cannot verify, instead of clicking Submit again. It treats role-based widgets (combobox, listbox, option, checkbox) as fields to fill, not as submits. Owner PII and ids become neutral examples loaded from gitignored local files, with no history rewrite (§0.2). The Hermes suite now tests the repo's own scripts, and a new CI job `hermes-pytest.yml` runs it on Python 3.9 and 3.12.
- **Q, AI provider.** `server/ai/provider.mjs` is the single provider layer:
  - One provider enum; `local` and `ollama` are aliases of `openai_compatible`.
  - Keys come only from the `llm.json` pin.
  - The Gemini key travels in the `x-goog-api-key` header everywhere, server and browser; no more `?key=` URLs.
  - `chat()` honors the request's abort signal and reports cancellation as an `AbortError`.
  - Upstream errors share one `ProviderApiError` taxonomy, with the upstream bodies redacted.
  - Each provider keeps the temperature the caller passed.

  `POST /api/llm-config` keeps the stored key when `apiKey` is omitted and clears it when `apiKey` is `""`. The worker's chat provider re-exports this module. The server and the browser both read both casings of the URL-context metadata field.

### Orchestrator decisions

- **E18 is partial (P3).** The Gemini flash model-id cache and the shared profile-excerpt budget landed. The heading-based trim of job postings was removed: two review rounds showed it dropping real requirement lines, for example a clearance requirement under "About the role". Postings now keep the original 7,000-character clip.
- **Fence leeway.** Lane Q made small, listed edits outside its fence. They were the browser copy of the E9 casing check, the browser Gemini call sites for B17 and the E11 route wiring in `server/index.mjs`. No other lane was editing those files at the time, and L will build on top of them.

### Deferred (none is a P0; H8 and H9 are P1 residuals)

- **H8/F18:** the owner identity in `resume-template/**`, `cover-letter-template/**` and `materials_watcher/notifier.py` goes to lane M.
- **H9:** confirmation relayed through the live Hermes gateway is unproven. A stubbed `getUpdates` 409 fails fast.
- **H11:** setup does not install Playwright Chromium while apply is shelved.
- **H12:** the doctor drift report goes to lane O.
- **H20:** `daily-brief.js` and `today-data.js` keep literal thresholds; a test pins them equal to the shared file.
- **Q:** the E11 materials route has no request-bound provider call to abort, and moving the remaining transports onto `chat()` is not done.

### Evidence: floor on the merged tree (2494afa)

Every command ran with `HOME` set to a fresh temp dir and `PLAYWRIGHT_BROWSERS_PATH` pointed at the real cache:

```
npm run lint:repo                   exit 0
npm run typecheck:repo              exit 0
npm test                            tests 3327, pass 3319, fail 0, todo 8
npm run test:browser-use-discovery  tests 772, pass 772, fail 0
npm run test:contract:all           exit 0
npm run test:e2e-smoke              9 passed
npm run test:e2e-journey            13 passed
python -m pytest integrations/hermes-job-hunt/tests   135 passed
gitleaks detect (lane ranges)       no leaks found
```

Q's fixes closed two of E17's strict-mode targets (E2 and E9), so the todo count fell from 12 to 8.

Evidence files, all under `docs/programs/beaudit-20260925/`:
- Muse verdicts: `verdicts/BUILD-VERDICT-{H,Q}-r*.json`
- Reviews: `verdicts/REVIEW-{H,Q}.json`
- Lane reports: `reports/build/BUILD-REPORT-{H,Q}.md`

### Merge note: session.ts overlaps with #122

Lane Q's commit 8cad4c93 and #122's commit 103bab66 both fix the same Linux-only EPIPE in `integrations/browser-use-discovery/src/browser/session.ts`, in different ways:
- **8cad4c93 (Q)** ignores the stdin error and lets the child's exit code decide.
- **103bab66 (#122)** rejects the promise and kills the child.

Bringing `origin/main` into this branch after #122 merges will conflict in that file. Resolve it by taking #122's version and dropping Q's single `child.stdin.on("error", () => {})` line. Then re-run `npm run test:browser-use-discovery`, which includes both sides' `session-ssrf` tests.

### Unverified

- No live Telegram, Gemini, Anthropic or OpenAI call was made. Provider wire behavior is covered by recorded-request tests.
- The Hermes gateway confirmation path is unproven (H9 above).
- Codex and Muse quota were not read (no meter).
