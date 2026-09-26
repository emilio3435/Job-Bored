DONE

## 1. Mission
FE-B2B3: a greenfield user picks a free provider (Gemini, pre-selected), pastes a key, and gets a resume draft with honest progress, honest privacy copy and one clear action per state. No key is written to this computer without an inline "Save it"; drafting can't hang forever. VAL-ONEFLOW-001 green.

Commits on feat/gfx-fe-b2b3 (local only, not pushed):
- 3e84e829 feat(local-server): localServerHint accepts { platform, runtime }
- eff76ddf feat(onboarding): B2 recommends Gemini and asks before saving the key
- 10d2552c feat(onboarding): B3 drafts with honest progress and honest errors
- bd49366e test(e2e): VAL-ONEFLOW-001 walks B2 on the Gemini card
- 2583f8e5 style(onboarding): B2/B3 look deliberate and keep links readable

## 2. Claims that went red first (named with ledger IDs)
New files tests/gfx-fe-b2b3-{beat-ai,beat-resume,local-server-hint}.test.mjs, run before any product change: 37 tests, 35 fail, 2 pass. The two that passed were already true: the old positional localServerHint signature, and "B2-6 never blocks the check".
```
ℹ tests 37
ℹ pass 2
ℹ fail 35
✖ GFX B2-2 · B2-4 · honest copy (3.13225ms)
✖ GFX B2-3 · the Gemini write-through shows ✓ or ✗ (9.625833ms)
✖ GFX B2-4 · B2-5 · the key reaches this computer only after an inline Save it (8.77575ms)
✖ GFX B2-6 · a soft key-shape warning (6.220625ms)
✖ GFX B2-7 · no false CORS note (1.957792ms)
✖ GFX B3-2 · .docx, not .doc (2.479375ms)
✖ GFX B3-4 · drafting never hangs without progress and an exit (14.98475ms)
✖ GFX B3-7 · 'open your local JobBored' is a link (2.04125ms)
✖ GFX B3-8 · B3-9 · B3-10 · B3-11 · N-B3-2 · copy and stages (3.721209ms)
✖ GFX D3 · B2-1/9 · Gemini is the first and pre-selected card (15.303ms)
✖ GFX D3 · resolveModel still prefers the catalog default (3.095625ms)
✖ GFX N-B2-1 · OpenRouter tells one paid story (1.562917ms)
✖ GFX N-B2-3 · no local server, no ask, no write; a failed write says so (4.033042ms)
✖ GFX N-B3-1 · a browser-direct failure shows the provider's own words (4.24675ms)
✖ GFX N-B3-3 · one primary action per state (3.079ms)
✖ GFX N-B3-4 · paste advice is said once (1.942166ms)
✖ GFX X1 · B3-6 · one start sentence, detail behind a disclosure (6.49775ms)
✖ GFX X1 · R13 · localServerHint({ platform, runtime }) (2.052667ms)
```
VAL-ONEFLOW-001 (item 9) was red at base bb46b28a (run in a throwaway worktree, since removed):
```
  ✘  1 tests/e2e-onboarding/greenfield-onboarding.spec.mjs:543:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install (6.0s)
    Error: network boundary contract violations
    +   "OpenRouter check model openai/gpt-5.4-mini",
    > 538 |   expect(state.calls.violations, "network boundary contract violations").toEqual([]);
  1 failed
```

## 3. What shipped, file and fence
- `local-server.js` (only `localServerHint`): accepts `{ platform, runtime }`. `runtime:"desktop"` → "open the JobBored app". The positional form still works. X1/R13.
- `oneflow-beat-ai.js`:
  - D3/B2-1/9: Gemini first and pre-selected, with the spec's note.
  - N-B2-1: OpenRouter "Many models, one key. Pay-as-you-go." and "Create an OpenRouter key ↗"; the rate-limit tip ends "…press Check & continue again."
  - B2-4: privacy line verbatim.
  - B2-4/B2-5/N-B2-3: after a passed check, an inline consent row with footer actions Save it / Not now, and "What changes" `<details>` listing ~/.jobbored/llm.json and the discovery .env. The llm.json pin and the Gemini .env write happen only after Save it. The ping (`pingLocalServer`) says `no_local_server`/`static_host` → no ask, no write. A failed pin → one-line warn note with the localServerHint sentence, then Continue / Try saving again. `askHostChange`/native `confirm()` removed from B2. The key-shaped `console.warn`s are gone.
  - B2-2/B2-3: the bonus line now pre-announces the ask; ✓/✗ receipt from `geminiWroteThrough`.
  - B2-6: a soft prefix hint (AIza / sk-or- / sk-ant-) that never blocks.
  - B2-7: CORS_NOTE removed; the trouble tip names network blocks and suggests OpenRouter.
  - `resolveModel` unchanged (catalog default).
  - Local provider: its pin carries a base URL, not a key, so it saves without the ask.
- `oneflow-beat-resume.js`:
  - B3-4: `DRAFT_TIMINGS` (2 s counter, 30 s stall line verbatim, 90 s deadline). An AbortController on the server fetch; the direct `callConfiguredAi` path is raced against the same deadline. It can't be aborted: `callConfiguredAi` takes no signal and resume-generate.js stayed untouched.
  - Picking a template mid-draft supersedes the draft in flight.
  - N-B3-1: the direct path returns `{ok:false, message}` with the provider's words, which B3 shows.
  - X1/B3-6: the start sentence comes from `localServerHint()`; the raw error sits in `<details>Technical detail`.
  - B3-7: the 405 case links "JobBored on this computer" (http://localhost:8080/).
  - B3-2: accept drops .doc and the lede says .docx.
  - Copy and stages: B3-8 headline; B3-9/N-B3-2 two stages, no baked ✓; B3-10 template lede; B3-11 "Build my profile from this text" plus "Or paste the text".
  - N-B3-3: one primary per state. Try again drafts the current paste.
  - N-B3-4: paste advice is said once.
- `resume-ingest.js` (only the .doc message): .doc (or msword that isn't .docx) → a specific message naming Save As .docx or paste.
- `css/oneflow.css` (B2 and B3 blocks only; old lines 929–1105, before ONEFLOW:L2; shared :557-572 untouched):
  - Every rule is scoped under `.oneflow-ai`/`.oneflow-resume` (the cascade trap: several `p` rules never applied before).
  - Links are navy on paper, fixing FE-B1's mint-deep link-primary note; the signup link is an outlined navy chip.
  - The consent card, receipt, hint and notice get their styles; five cards sit in one row on desktop.
  - The consent row scrolls into view once, so on a phone it isn't hidden under the dock.
  - The B2 success label drops its baked ✓ (it rendered "✓ ✓").
- Tests updated because the pinned behaviour moved (named in each commit body):
  - oneflow-l1-beat-ai: OpenRouter-first, the CORS note, the consent step, the ✓ label.
  - sixbeats2-beat-provider: order, Recommended, sub, pin after Save it.
  - sixbeats2-finale: consent step, ✓ from state.
  - sixbeats-b3-slow-check: consent step.
  - ux01-c7: the npm run dev pin → localServerHint.
  - ux01-c8: B2's askHostChange site → the inline-ask pin.
  - data-integrity: catch-binding regex.
  - oneflow-l0-wiring and oneflow-l1-beat-resume: headline, stages, start sentence, N-B3-1 copy.
  - greenfield-remediation.spec: the button label.
  - greenfield-onboarding.spec: the Gemini walk (item 9 option chosen: follow the new default).
- Screenshots (1440 and 375, port-0 dev-server, all host paths stubbed): `.lane-evidence/shots/` covers b2-{default,shape-hint,consent,trouble} and b3-{default,notice,stall} at both widths.

## 4. Floor results (paste, do not paraphrase)
`npm run lint:repo` (exit 0):
```
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md

> command-center@0.1.0 lint:tokens
> node tools/lint-tokens.mjs

lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
```
`npm run typecheck:repo` (exit 0):
```
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json


> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

```
`node --test tests/gfx-fe-b2b3-*.test.mjs` + every B2/B3 test (list: tests/beaudit-p-e17-claim-coverage.test.mjs tests/beaudit-q-ai-provider.test.mjs tests/data-integrity-resume-and-saves.test.mjs tests/fit-profile-wizard.test.mjs tests/gfx-be-fuel-local-server.test.mjs tests/gfx-be-fuel-prereqs.test.mjs tests/gfx-fe-b1-beat-google.test.mjs tests/greenfield-a-gate.test.mjs tests/greenfield-a-provider-guard.test.mjs tests/greenfield-c-google-nopunt.test.mjs tests/greenfield-d-effective-config.test.mjs tests/greenfield-d-receipts.test.mjs tests/index-html-cold-start.test.mjs tests/oauth-origin-detour.test.mjs tests/oneflow-l0-wiring.test.mjs tests/oneflow-l1-beat-ai.test.mjs tests/oneflow-l1-beat-google.test.mjs tests/oneflow-l1-beat-resume.test.mjs tests/oneflow-l1-server-resume.test.mjs tests/oneflow-l7-routed.test.mjs tests/sixbeats-b3-close-pauses.test.mjs tests/sixbeats-b3-greenfield-url.test.mjs tests/sixbeats-b3-slow-check.test.mjs tests/sixbeats-b3-template-escape.test.mjs tests/sixbeats2-beat-provider.test.mjs tests/sixbeats2-finale.test.mjs tests/ux01-c6-real-board.test.mjs tests/ux01-c7-honest-setup.test.mjs tests/ux01-c8-consent.test.mjs tests/weak-materials-model-warning.test.mjs ) (exit 0):
```
ℹ tests 498
ℹ suites 147
ℹ pass 491
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 7
ℹ duration_ms 7272.292833
✖ the image saves a starter profile and never returns a filesystem path (4.569584ms) # target behavior; fix owned by wave-2 lane O (E5: vendor the schema into server/)
```
The one ✖ line is a pre-existing `todo` (beaudit-p-e17, owned by BEAUDIT lane O). It is counted under todo 7, not fail.

`npm run test:e2e-onboarding` (exit 0):
```

  ✓  1 tests/e2e-onboarding/greenfield-onboarding.spec.mjs:575:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install (5.6s)
  ✓  2 tests/e2e-onboarding/greenfield-remediation.spec.mjs:204:1 › E1 Beat 3 is gated on Beat 2 (1.5s)
  ✓  3 tests/e2e-onboarding/greenfield-remediation.spec.mjs:260:1 › E2 Pasted resume survives Escape and reload (1.9s)
  ✓  4 tests/e2e-onboarding/greenfield-remediation.spec.mjs:291:1 › E3 Drawer setup lands in OneFlow (1.1s)
  ✓  5 tests/e2e-onboarding/greenfield-remediation.spec.mjs:305:1 › E4 Beat 1 never punts to Settings (771ms)
  ✓  6 tests/e2e-onboarding/greenfield-remediation.spec.mjs:321:1 › E5 Payoff is honest (1.0s)
  ✓  7 tests/e2e-onboarding/greenfield-remediation.spec.mjs:365:1 › E6 Settings shows receipts (1.1s)

  7 passed (13.6s)
```
`npm run test:e2e-journey` (exit 0):
```
  ✓  33 tests/e2e-journey/ux01-f-states-settings.spec.mjs:153:1 › C21: a silent sign-in restore that never answers opens the sign-in gate (8.6s)

  33 passed (39.7s)
```
`gitleaks protect --staged --redact` (exit 0; everything already committed, so staged was empty) and `gitleaks detect --log-opts="bb46b28a..HEAD" --redact` (exit 0):
```
/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored-worktrees-gfx-fe-b2b3/49b3e2a6-632e-4fa6-9eef-4d763b870300/scratchpad/gl2.txt:9:45AM INF 5 commits scanned.
/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored-worktrees-gfx-fe-b2b3/49b3e2a6-632e-4fa6-9eef-4d763b870300/scratchpad/gl2.txt:9:45AM INF no leaks found
/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored-worktrees-gfx-fe-b2b3/49b3e2a6-632e-4fa6-9eef-4d763b870300/scratchpad/gl1.txt:9:45AM INF 0 commits scanned.
/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored-worktrees-gfx-fe-b2b3/49b3e2a6-632e-4fa6-9eef-4d763b870300/scratchpad/gl1.txt:9:45AM INF no leaks found
```

## 5. Unverified / sandbox refused
- **Adjacent P1, outside the fence (shared dock CSS, ONEFLOW:CORE):** at 375 px the footer dock's message slot renders off-screen. Measured on this branch: `{"message":{"x":371,"w":143},"footer":{"x":0,"w":375},"vw":375}`. So every beat's error or warn line (B2's check failure, B3's failures, B2's pin note) is invisible on a phone. Visible in `.lane-evidence/shots/b2-375-trouble.png` and `b3-375-notice.png` (pink sliver at the right edge). Not fixed here.
- Kickoff deviation: `localServerHint({runtime:"desktop"})` returns lowercase "open the JobBored app", so it fits the same "To start it, …" clause as its siblings. The kickoff quotes a capital O.
- B3's direct path can't truly abort its fetch: it is abandoned at 90 s, not cancelled, because `callConfiguredAi` has no signal parameter. Adding `opts.signal` to resume-generate.js would close that.
- Not changed (out of fence or locked):
  - `CONNECT_AI_COPY` is byte-for-byte shared with onboarding-flow.js's gate note (source-B #7).
  - B3 SUB still says "nothing is saved until you approve it", although the resume is saved on upload.
  - B3-5 (optional "~10 min to finish setup") skipped so the spine labels stay consistent.
  - `config.example.js:77` still says "OpenRouter (free tier)" (N-B2-1 names config.example; the kickoff says BE-CORE owns it).
  - SETUP.md:260/269 (docs are fenced off).
- The consent is per passed check; it isn't remembered across checks in the session. A user who re-checks is asked again.
- "Unknown" ping (no JobBoredLocalServer, or a thrown ping) still shows the ask. The consent guards the write; a failed write says so.
- Not run: the full `npm test` (the kickoff says not to), and a live walkthrough on :8080 (Emilio's live port; QA-LIVE owns it).
- index.html: no script-tag changes needed.
