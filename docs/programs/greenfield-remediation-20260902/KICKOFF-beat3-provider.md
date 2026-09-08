# KICKOFF — lane A `beat3-provider` (claim ids A1–A4)

Read `GROUND-RULES.md`, then `GREENFIELD-SPEC.md` §1 F1, §3 items 1–4, §4.1, §5. Create `LANE-REPORT-beat3-provider.md` before anything else.

## Mission
Beat 3 drafts only with a provider Beat 2 actually verified, and the flow refuses to skip a beat past an unmet prerequisite: opening `resume` before `ai` is complete lands on the AI beat with a one-line note, and opening `payoff` before `google` lands on Google. Deep links from Settings and the drawer keep working, and `open(beatId, { returnTo: "close" })` closes the shell when that beat completes instead of walking forward.

**Land §4.1 (gate + returnTo) in your FIRST commit.** Lanes C and D code against it.

## Fence (you own exactly these)
- `onboarding-flow.js`: `open`, `resolveEntryBeatId`, `goToBeat`, `completeBeat`, new `gateBeat`, new `BEAT_PREREQS` / `GATE_NOTES` constants, the `returnTo` bookkeeping on `runtime`. Nothing else in the file — `saveDraft`, `flushDrafts`, `handleShellClose`, and the `root` export block belong to lane B.
- `oneflow-beat-resume.js`: `verifiedProviderConfig`, `draftOnServer`, the message-slot render it calls. Nothing in the paste textarea or `hydrateFromDrafts` — lane B.
- `fit-profile-wizard.js:160-180` (the legacy `/profile/from-resume` caller).
- New tests: `tests/greenfield-a-gate.test.mjs`, `tests/greenfield-a-provider-guard.test.mjs`. Existing harnesses to reuse: `tests/oneflow-l4-harness.mjs`, `tests/oneflow-l6-harness.mjs`, `tests/sixbeats2-beat-provider.test.mjs` (read it first).

## Claims (red first, in this order)
- **A1 · gate.** `open("resume")` with `completedBeats` lacking `ai` lands on `ai` and renders the note with `data-gate-note="ai"`; `open("payoff")` with no `google` and no `sheetId` lands on `google` with `data-gate-note="google"`; `open("payoff")` with `sheetId` set but `google` not in `completedBeats` is allowed; `open("discovery")` and `open("ai")` are never redirected.
- **A2 · returnTo.** `open("ai", { returnTo: "close" })` then completing the AI beat closes the shell, toasts "Saved.", and does not render the resume beat. Without the option, behavior is unchanged (advances).
- **A3 · provider guard.** With `resumeProvider` unset (or set with an empty key / empty local base URL), `verifiedProviderConfig()` returns `null`; "Draft from this text" makes no fetch, renders the locked copy "Connect an AI provider first — your resume is drafted with it." with a button that calls `ctx.goToBeat("ai")`. With a verified OpenRouter config, the POST body carries `provider: "openrouter"` and its key — the existing `sixbeats2-beat-provider` assertions still pass.
- **A4 · server reasons.** A server response with `reason` in `{ "gemini_not_configured", "profile_provider_not_configured" }` renders the same copy and button as A3, not the raw server message. Legacy `fit-profile-wizard.js` sends the same `{provider, apiKey, model, baseUrl}` block Beat 3 sends (extract the helper if that is the cleanest way; keep it in your fence).

## Non-negotiables
- Locked copy and ids verbatim from §4.1 and §4.6 (E1). Lane E asserts them.
- `reconcileStaleCompletion` still runs before the gate. The S0 card's `open()` (`oneflow-demo-board.js:112`) must land on `google` on a fresh install exactly as today.
- `open()` from the "Resume setup ▸" pill lands on the saved beat; the saved beat always has its prerequisites complete, so the gate is a no-op there — add an assertion for it.

## Definition of Done
- A1–A4 red output pasted, then green.
- Full floor from `GROUND-RULES.md` pasted into the report.
- First commit contains §4.1 and A1/A2; later commits the rest. Commit locally, never push.
