# Lane FE-B2B3: Beat 2 (AI provider) and Beat 3 (resume)

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 (D1, D3, D12) and **every Beat 2 and Beat 3 ledger row**: B2-1…B2-9, N-B2-1, N-B2-3, B3-2…B3-11, N-B3-1…N-B3-4, X1
- `PLAN.md` §R: R2, R6, R13
- `docs/COPY.md` (FE-B1, merged): follow its voice and names
- `reports/GEMINI-copy-inventory.md` (the B2 and B3 rows)
- FE-B1's report note: `body.jb-v2 a` repaints link-shaped primaries as mint-deep on mint (about 2:1 contrast). Fix that inside your beats.

**Load `/frontend-design`.** Routing: opus · medium.

**Goal:** a greenfield user picks a free provider, pastes a key, and gets a resume draft with honest progress, honest privacy copy and one clear action per state. Nothing hangs forever, and no message lies about where the key goes.

**Success means (each item red first, tests named with ledger IDs):**

1. **D3 + B2-1/9 + N-B2-1: provider cards.**
   - Gemini is the **first and pre-selected** card: "Recommended. Free tier — no card needed. Also powers job-link import and discovery search."
   - OpenRouter is second: "Many models, one key. Pay-as-you-go."
   - Tell one consistent paid story for OpenRouter everywhere:
     - The rate-limit tip becomes "Wait a minute and press Check & continue again."
     - The link label becomes "Create an OpenRouter key ↗".
   - `resolveModel` still prefers the catalog default. `config.example.js` is already fixed by BE-CORE.
2. **B2-4 (P0) + N-B2-3: privacy and consent.**
   - The "stored in this browser and sent only to the provider" copy becomes: "Your key is saved in this browser. If JobBored is running on this computer, it's also saved there so drafting and scoring work. It's only ever sent to {provider}."
   - **Gate both local writes behind one inline consent row:** the `POST /api/llm-config` pin to `~/.jobbored/llm.json`, and the Gemini discovery `.env` write-through. The row reads "Also save this key on this computer so drafting, scoring and discovery can use it? [Save it] [Not now]". The file paths go in a "What changes" `<details>`. **B2-5: no native `confirm()`.**
   - Skip both writes, and don't show the consent row, when `JobBoredLocalServer` reports no local server.
   - A failed pin shows a one-line note; don't silently `console.warn`.
3. **B2-2, B2-3, B2-6, B2-7: B2 copy.**
   - B2-2: the "lights up … grounded search" slop goes.
   - B2-3: after the check, show a ✓ or ✗ line driven by `geminiWroteThrough`.
   - B2-6: a soft prefix warning (AIza / sk-or- / sk-ant-).
   - **B2-7:** drop `CORS_NOTE` ("keep npm run dev running"). It is false: OpenAI and Anthropic calls go browser-direct. The trouble tip names network blocks and suggests OpenRouter.
4. **B3-4: the stall watch** (P1, the drafting can hang forever).
   - Port B2's `CHECK_TIMINGS` stall watch into B3: a seconds counter after 2 s.
   - At 30 s: "Still waiting on your AI provider — free tiers can be slow. Leave it running, or start from a template."
   - A 90 s `AbortController` on both the server fetch and the direct `callConfiguredAi` path.
   - Use injectable timings for the tests.
5. **N-B3-1:** the browser-direct fallback returns `{ ok:false, message }`, and B3 shows **the provider's message** (429, bad key) instead of the false "couldn't reach the app / start.command".
6. **X1 / R13: one start sentence.**
   - Every "start the server" sentence in B2 and B3 comes from `JobBoredLocalServer.localServerHint(...)`.
   - **Extend `local-server.js` `localServerHint` to accept `{ platform, runtime }`.** When `runtime === "desktop"`, it returns "Open the JobBored app"; otherwise it keeps the current Mac/other sentences. Keep the old positional signature working, and add tests.
   - Technical detail goes in a `<details>Technical detail</details>`.
7. **B3 copy and flow:**
   - B3-2: drop `.doc` from `accept`, say ".docx", and give a specific message when a `.doc` is dropped.
   - B3-7: the "open your local JobBored" text becomes a link.
   - B3-8: "Drop in your resume. AI drafts your profile from it."
   - B3-9: stage labels without a baked-in ✓; the ✓ comes from `state:"done"`.
   - B3-10: "You can change everything on the next screen."
   - B3-11: button and label copy per SPEC.
   - N-B3-2: two stages (Reading → Drafting).
   - N-B3-3: one primary action per state.
   - N-B3-4: no doubled paste advice.
   - B3-5 (optional): the spine label reads "~10 min to finish setup".
8. **Visual (`/frontend-design`):**
   - B2 cards and the B3 dropzone and progress look deliberate and consistent with B1's new look.
   - Fix the link-primary contrast in your beats.
   - CSS is scoped under `.oneflow-ai` / `.oneflow-resume`. **Your CSS fence is the B2 block (`css/oneflow.css` from about `:680`) and the B3 block (from about `:771`), up to the fit block.** The shared rule at `:557-572` is FE-B1's; don't edit it.
   - Screenshots at 1440 and 375 px (port-0 dev-server) go in `.lane-evidence/`.

9. **VAL-ONEFLOW-001 must go green (the last blocker is yours).** B4 now saves the profile, and the test reaches `expectCleanRun` (`greenfield-onboarding.spec.mjs:~620`). There it trips a **B2** pin: the spec's OpenRouter stub at `:~417` expects `openai/gpt-oss-120b:free`, but `model-catalog.js:91` has recommended `openai/gpt-5.4-mini` since `3ce31667`, and BE-CORE unpinned `config.example.js`.
   - D3 makes Gemini the default, so update the spec's B2 path to walk the **Gemini** card with a stubbed Gemini check, or align the OpenRouter stub with the catalog default. Choose the one that matches the new default flow.
   - The whole e2e-onboarding suite must be 7/7.

**Floor:** paste all of this in §4.
- `npm run lint:repo`
- `npm run typecheck:repo`
- `node --test` on your new `tests/gfx-fe-b2b3-*.test.mjs` files and `tests/gfx-be-fuel-local-server.test.mjs`, plus every existing test that covers B2 or B3, or pins a string you changed. Find them with `grep -l "oneflow-beat-ai\|oneflow-beat-resume\|resume-ingest" tests/*.mjs`, and include `sixbeats-b3-*`, `oneflow-l1-*`, `ux01-c7-*` and `ux01-c8-*`.
- `npm run test:e2e-onboarding` and `npm run test:e2e-journey`
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)

- `oneflow-beat-ai.js`, `oneflow-beat-resume.js`
- `resume-ingest.js`: the accept list and the `.doc` message only
- `local-server.js`: **only** the `localServerHint` extension
- `resume-generate.js`: only if N-B3-1 needs the direct-draft return shape
- the B2 and B3 blocks of `css/oneflow.css`
- `tests/gfx-fe-b2b3-*.test.mjs`, plus updates to tests that pin moved strings or behaviour (say so in the commit body)

**Do NOT touch:**
- `server/**`, `oneflow-beat-google.js`, `oneflow-route-local.js`, `onboarding-flow.js`
- `oneflow-beat-fit.js` (FE-B4, live)
- `oneflow-beat-discovery.js`, the wizard files (FE-B5)
- `index.html`, docs

## Non-negotiables

- No local write of any key without the user's explicit consent in the same session.
- No key in a URL or log.
- One primary action per state.
- Nothing waits forever without visible progress and an exit.

## Definition of Done

The floor, green and pasted in §4 (`VAL-ONEFLOW-001` must pass: item 9). First line `DONE`. Local commits only.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
