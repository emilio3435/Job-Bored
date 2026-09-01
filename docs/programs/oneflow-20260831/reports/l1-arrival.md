# LANE REPORT — L1 arrival (Beats B1–B3: Google · AI · Resume)

Branch: `feat/oneflow-arrival` · worktree `Job-Bored.worktrees/oneflow-arrival`
Commits (local only, never pushed):

```
a282164 fix(oneflow-l1): per-provider key drafts, honest CORS sentence, route doc
d803619 feat(oneflow-l1): beats B1-B3 — Google, AI provider, resume dual write
442d642 test(oneflow-l1): red probes for beats google, ai, resume + the server dual write
```

---

## 1. What this lane was

The arrival half of the one-flow onboarding (ONE-FLOW-ONBOARDING-SPEC §5 B1–B3):
fill in the three registered beat stubs L0 landed, so a stranger can sign in and
get a Sheet, connect a live-verified AI provider, and hand over a resume that is
actually visible to the thing that drafts from it.

Three claims carry the lane:

1. **B1** replaces the login gate *and* `#setupScreen` — signing in and owning a
   Sheet stop being two chapters — by *calling* the existing auth and
   starter-sheet surfaces rather than forking them.
2. **B2** makes the mandatory AI ask defensible (spec §11.5) by making an
   unverified pass impossible, `Local` included.
3. **B3** closes the teardown's keystone bug: a resume uploaded in wizard 1 was
   invisible to wizard 2 (IndexedDB vs filesystem). The fix is a dual write with
   a fixed order, plus a drafting prompt that no longer orders the model to
   return half a profile.

The substrate stays **dark**: nothing in the boot chain calls the flow. That is
L6's cutover, and `tests/oneflow-l0-wiring.test.mjs` still enforces it.

---

## 2. Which claims went red first (named tests)

TDD: four suites, **52 failing claims**, written and committed (442d642) before
any implementation existed.

| Suite | Red → green |
|---|---|
| `tests/oneflow-l1-beat-google.test.mjs` | 12 → 15/15 |
| `tests/oneflow-l1-beat-ai.test.mjs` | 21 → 26/26 |
| `tests/oneflow-l1-beat-resume.test.mjs` | 15 → 16/16 |
| `tests/oneflow-l1-server-resume.test.mjs` | 4 → 7/7 |

The claims that mattered most, by name:

**B1 — `tests/oneflow-l1-beat-google.test.mjs`**
- `signs in through the existing auth entry, then creates the sheet through the existing creator`
- `renders the three normative stages and completes with createdSheet:true`
- `does not create a second sheet when one is already connected`
- `does not complete when the creator leaves the flow without a sheet` — spec §5 B1's
  exit condition is `getSheetId()` truthy and nothing else
- `reuses the existing sheet-access validation and completes with createdSheet:false`
- `renders no Drive API step — JobBored never touches Drive`
- `renders no gcloud button until oauth-bootstrap mints a real Web client`
- `keeps the consent-screen step` / `ships the collapsed details with the honest ten-minute estimate`

**B2 — `tests/oneflow-l1-beat-ai.test.mjs`**
- `refuses to complete when the check fails — the silent gate is the bug`
- `gates \`Local\` on the Ollama base URL actually answering` (+ `lets Local through once the base URL answers`)
- `does NOT offer the webhook provider — it moved to Settings`
- `carries the browser-CORS note on OpenAI and Anthropic`
- `renders the provider's own error in the message slot` / `opens a Having trouble? block naming the wrong-key, rate-limit and CORS fixes`
- `POSTs the key to the discovery worker env and says so` / `never writes through for a non-Gemini provider` / `still completes when the worker write fails`
- `emits key_check {beat, provider, ok, ms} on a pass` / `…with ok:false on a failure`
- `verifyResumeProviderLive` suite: real `/chat/completions` round-trip, mapped
  actionable error, Local failure when the base URL does not answer

**B3 — `tests/oneflow-l1-beat-resume.test.mjs`**
- `commits to IndexedDB BEFORE asking the server to draft` (write-order probe)
- `sends the same text to the server as request-body resumeText`
- `still keeps the browser copy of the resume when drafting fails` — a failed
  draft must not cost the user their upload; that IS the keystone bug
- `keeps the missing-resume 404 distinct from a provider error`
- `offers BOTH a retry and the template path after a failure`
- `completes with source:"template" once one is picked`

**Server — `tests/oneflow-l1-server-resume.test.mjs`**
- `writes request-body resumeText to ~/.jobbored/resume.txt`
- `still prefers the body over anything already on disk`
- `never persists a body with no resumeText`
- `returns the draft even when the disk write is impossible`
- `no longer orders the model to leave wants and avoids empty`

---

## 3. What shipped, file-and-fence

### Inside the L1 fence

| File | Change |
|---|---|
| `oneflow-beat-google.js` | B1, filled. Normative headline/sub, the `Continue with Google` path (`JobBoredApp.core.host.signIn` → poll → `handleSetupCreateStarterSheet({context:"wizard"})`), the three-stage busy list, the inline existing-sheet field reusing `verifyExistingSheetAccess`, and the collapsed first-timer detour (consent screen kept, Drive API step gone, honest "about 10 minutes", "You only ever do this once.", clipboard-assisted origin, Client-ID paste field, **no gcloud button**). |
| `oneflow-beat-ai.js` | B2, filled. Five provider cards in spec order with OpenRouter pre-selected (webhook absent), CORS note inline on OpenAI/Anthropic, three numbered key steps + masked field, `Check & continue` → override-store write → live check → completion **only on a pass**. Failure renders the provider's own message in the message slot plus a per-case `Having trouble?` block. Gemini also POSTs to `/__proxy/discovery-env-key` (`BROWSER_USE_DISCOVERY_GEMINI_API_KEY`) with the normative bonus line rendered before the ask. Emits `STEPS.KEY_CHECK {beat:"ai", provider, ok, ms}`. |
| `oneflow-beat-resume.js` | B3, filled. Drag/paste/browse intake; the dual write in order (`UC.setPrimaryResume` → `POST /profile/from-resume {resumeText}`); the four normative stages; the draft profile handed to B4 via the controller's cross-beat `runtime`; the honest 404 / provider-error split with retry **and** template paths; the four starter templates **copied** from `fit-profile-wizard.js` (never imported), seeded from the server's own `/profile/template/:id`. |
| `resume-generate.js` | **One** added export: `verifyResumeProviderLive()` — a real minimal completion through `callConfiguredAi`, never throwing, returning `{ok, provider, model, ms, reply|message}`. It reuses the module's own error mapping, so a bad OpenRouter key surfaces "Your OpenRouter API key is invalid. Paste a valid free key from…" rather than "HTTP 401". |
| `server/profile-from-resume.mjs` | `resolveResumeTextForAnalysis` now caches staged body text to `~/.jobbored/resume.txt` (`mkdir -p`, mode 0600, best-effort — a failed cache never costs the draft) via a new `jobboredResumePath()` shared by the reader. The `wants: leave []` / `avoids: leave []` prompt lines are replaced with instructions that draft both from resume evidence. `SYSTEM_PROMPT` added to `__test`. |
| `server/index.mjs` | Doc-comment only: the `/profile/from-resume` header said the staged resume is "not persisted" — true before §5 B3, a lie after it. |
| `css/oneflow.css` | Rules added **only** inside `/* ONEFLOW:L1 */`. Nothing outside the fence touched. |

### Tests

New: `tests/oneflow-l1-harness.mjs` (not a `*.test.mjs`, so the runner never
treats it as a suite) plus the four suites above.

The harness imports L0's fakes rather than forking them, and adds three things
the substrate probes did not need: the `JobBoredApp.core.host` bridge double, an
injectable recording `fetch`, and a small adapter that teaches L0's IndexedDB
fake `objectStore.clear()` and transaction completion — `setPrimaryResume`
deliberately runs the clear and the put in **one** transaction so a failed put
cannot leave the user with no resume, and L0's fake modelled neither.

### Legacy tests updated (ground rule 7 — same commit, spec section named)

- `tests/profile-from-resume-staged.test.mjs` — F2B's claim "staged text is
  never written to disk" **was** the bug §5 B3 closes. Rewritten to keep what
  F2B was actually protecting (staged text lands at exactly one canonical path;
  secret-looking body fields are never mistaken for a resume) and to hand the
  write claim to the L1 server suite. Both probes now sandbox `HOME`.
- `tests/oneflow-l0-wiring.test.mjs` — its placeholder assertion rode on the
  `resume` beat being unfilled. Split out and re-pointed at `fit`, whose lane has
  not landed; the substrate's claim (an unfilled beat must look unfinished, not
  look shipped) is unchanged.

### Deliberately NOT touched

`index.html`, `package.json`, `discovery-wizard-shell.js`,
`user-content-store.js`, `onboarding-telemetry.js`, `onboarding-flow.js` (all
L0-owned), `first-run-wizard.js`, `onboarding-wizard.js`, `fit-profile-wizard.js`,
`welcome.js`, `enhancements-wizard-ui.js`, `app-bootstrap.js`,
`discovery-status-handoff.js`. Verified: `git diff main -- <those>` is empty.
`sheet-access-setup.js` needed no edit either — `createBlankStarterSheet` and
`handleSetupCreateStarterSheet` were already exported, so the export the kickoff
pre-authorized was not required.

---

## 4. Floor results — PASTED output

### `npm test`

```
ℹ tests 2518
ℹ suites 602
ℹ pass 2517
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 8373.305208
EXIT=0
```

Baseline before this lane (`.lane-evidence/baseline-test.txt`) was
`tests 2453 / pass 2452 / fail 0 / todo 1`. The single `todo` is the pre-existing
`tests/submission-record-audit.test.mjs` — "blocked on the canonical-ownership
gate; no legal Sheet column or IndexedDB store" — unchanged by this lane, present
at baseline and at HEAD. Net +65 tests, all this lane's.

### `npm run lint:repo`

```
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
EXIT=0
```

### `npm run typecheck:repo`

```
> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

EXIT=0
```

(`typecheck:repo` runs `node --check` over every browser file including
`oneflow-beat-google.js`, `oneflow-beat-ai.js`, `oneflow-beat-resume.js` — L0
registered all three, so no package.json edit was needed.)

### `npm run test:contract:all`

```
> command-center@0.1.0 test:contract
> node scripts/test-contract.mjs
OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js

> command-center@0.1.0 test:ats-contract
> node scripts/test-ats-scorecard-contract.mjs
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload

> command-center@0.1.0 test:pipeline-contract
> node scripts/test-pipeline-contract.mjs
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js

> command-center@0.1.0 test:pipeline-update-contract
> node scripts/test-pipeline-update-contract.mjs
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
EXIT=0
```

Raw logs: `.lane-evidence/floor-{test,lint,typecheck,contract}.txt`; baselines in
`.lane-evidence/baseline-*.txt`.

---

## 5. Anything unverified, including what the sandbox refused

### Cross-fence needs (for the orchestrator to route — NOT edited here)

1. **The shell's step-frame fossils leak into every beat.** With the flow's
   one-step-per-beat shell, `discovery-wizard-shell.js` renders a
   `Step 1 of 1` kicker (`renderStepFrame`) and the footer note
   `"Use the step rail above to jump between steps."` (`renderFooter`'s
   `defaultNote`) on all six beats. Both are wrong once the spine is the
   progress system — spec §7's fossil row ("Step 1 of 9" markup) and §2's
   one-spine rule. The fix belongs to whoever owns the shell: either suppress
   both when `spine` is present, or let `onboarding-flow.js` pass a
   `footerNote` through to the step blueprint (it currently maps only
   `id/label/title/description/actions/render`). Both files are L0's.
2. **`verifyExistingSheetAccess` lives on a module L7 deletes.** B1's
   existing-sheet path reuses `window.JobBoredApp.firstRunWizard
   .verifyExistingSheetAccess` — the kickoff's "existing validation reused".
   `first-run-wizard.js` is on §7's deletion list. **L7 must relocate that
   helper** (a bridge entry, or move it into `sheet-access-setup.js`) or B1's
   secondary path dies with the file. B1 already fails loudly rather than
   silently if the helper is absent, so the breakage would be visible, not
   invisible — but it would still be a regression.
3. **`getStoredResumeText` precedence is unchanged and still worker-first.** A
   stale `worker-config.json` `candidateProfile.resumeText` still outranks
   `~/.jobbored/resume.txt`. Request-body text wins over both, so B3 is
   unaffected, but a *later* keyless call could read a stale worker resume. Not
   in this lane's remit; flagged for whoever owns the worker config sync.

### Behavior verified only against doubles

4. **The real OAuth popup and the real Sheets API were never exercised.** B1's
   sign-in wait polls `isSignedIn()` because `auth-session.js` dispatches no
   sign-in event (verified: the only `dispatchEvent` there is
   `jobbored:install-doctor:update`). The polling loop, the 120s timeout, and
   the popup-blocked copy are unit-tested against a host double; nothing in
   this lane's DoD needed network, and none was used.
5. **The granular-consent recovery is by design a second click.** If Google
   signs the user in without the Sheets scope, the real
   `handleSetupCreateStarterSheet` fires `signIn({prompt:"consent"})` and
   returns without a sheet. B1 then renders the honest error naming that exact
   fix. The app's own post-sign-in resume may create the sheet in the
   background; B1 does **not** try to complete from that stale callback (a
   double-complete would be worse) — the user's next `Continue with Google`
   sees the sheet and completes instantly. Verified by unit test only.
6. **No live provider was called.** `verifyResumeProviderLive()` is tested
   against a recording fetch double for OpenRouter (pass), a mapped 401
   (failure), and a dead Local base URL. It has never hit a real API key in
   this lane.
7. **File extraction is stubbed.** B3's `ingestFile` is probed with a fake
   `CommandCenterResumeIngest`; pdf.js and mammoth were not pulled into node.
   The real extractor is unchanged and its own tests still pass.

### Test-harness caveat

8. **L0's IndexedDB fake needed an adapter, not a fork.** `tests/oneflow-l1-harness.mjs`
   wraps `makeFakeIndexedDb()` to add `objectStore.clear()` and a transaction
   that reports `oncomplete`, because `setPrimaryResume` runs its clear and put
   in one transaction. If L0 later grows those in `oneflow-l0-harness.mjs`, the
   wrapper is a no-op for `clear` and can be deleted.
9. **Cross-realm arrays.** The vm sandbox returns arrays whose prototype is not
   the test realm's, so every `deepEqual` on a beat's array spreads it first
   (`[...x]`) — same pattern L0's probes already use.

### Sandbox

10. Nothing was refused. All commits succeeded; `LANE-REPORT-*.md` is
    `.gitignore`d by the repo (lines 76/80), so this report lives in the
    worktree uncommitted, as intended. **Nothing was pushed.**
