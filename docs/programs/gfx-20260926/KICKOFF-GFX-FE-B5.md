# Lane FE-B5: Beat 5 (SerpApi + discovery) UI, the discovery wizard, and Beat 6 payoff

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 (D1, D2, D4) and **every Beat 5 and Beat 6 ledger row**: S3/S7/S9 copy, S10, D1, D3–D8 (the wizard), N8, B5-N*
- `PLAN.md` §R: R2, R5, R9, R13
- `docs/COPY.md` (merged): its voice and names
- `reports/GEMINI-copy-inventory.md` (the B5, wizard and B6 rows)
- **`local-server.js`** (merged): the frozen `OUTCOMES` table (§R2), with a `display` key and a `blocks` flag for each outcome

**Load `/frontend-design`.** Routing: opus · medium.

**Live alongside you:** FE-B2B3, which owns `oneflow-beat-ai.js`, `oneflow-beat-resume.js`, `resume-ingest.js`, the `localServerHint` extension in `local-server.js`, and the B2/B3 CSS. Don't touch those. If you need the runtime-aware hint, call `localServerHint({ platform, runtime })` and fall back to the positional form. FE-B2B3 lands the extension.

**Goal:** every Beat 5 state shows one honest diagnosis and exactly one fix action (D1). The discovery wizard speaks plain words, names each path once, and recommends exactly one path. Beat 6 celebrates only what really happened.

**Success means (each item red first, tests named with ledger IDs):**

1. **R2 / D1 / S3, S7, S9: key-check copy per outcome.**
   - B5's message table covers **every** `OUTCOMES` entry, each with exactly one action:
     - `invalid_key`: re-paste the key, with a link to the SerpApi key page;
     - `unreachable`: "SerpApi didn't answer — check your internet, then press Save & verify." **Never "start the server"**;
     - `upstream_error`: try again in a minute;
     - `wrong_origin`: "open http://localhost:8080 and press Save & verify there", as a link;
     - `internal_error`: restart JobBored, using the hint sentence;
     - `no_local_server`: the hint sentence;
     - `stale_server`: "The JobBored server on this computer is out of date or isn't JobBored — quit it and start JobBored again";
     - `static_host`: "Open JobBored on this computer", which goes to B1's route-to-local screen (already wired);
     - `ok` + `searchesLeft`: a quiet note.
   - Add a table test: for each outcome, exactly one action and no generic fallback copy.
   - D1 strict: Save & verify stays the gate, and there is no Skip.
2. **Wizard copy and names (D1, D3–D8, D5, D6).**
   - D1: "Re-scan" → "Check again".
   - D4: "Pipeline sheet not set up" gets a **Connect Sheet** action that goes to B1.
   - D5: the "Relay … ngrok … redeploy" jargon becomes plain copy with a **Fix** button that runs the existing repair.
   - D6: **one name per path** in both wizard files and B5: "Stable URL · Tailscale", "Just this computer", "A web address you own". Follow COPY.md.
   - D7: "No webhook (manual)" / "Confirm — no webhook" → "Skip for now", with a one-line consequence.
   - D8: "public HTTPS endpoint you already control" → "a web address you already own".
   - S10: every start sentence comes from `localServerHint`.
3. **R9 / D2 (stub_only) + D4 (recommendation).**
   - Remove the **`stub_only` discovery flow** from the wizard's flow enums, cards and recommendation (`discovery-wizard-shell.js`, `discovery-wizard-ui.js`, and the flow recommendation in `discovery-wizard-probes.js:~905-930`).
   - **Keep the Apps Script *engine state* `stub_only`** (`DISCOVERY_ENGINE_STATE_STUB_ONLY`, `:18/:38/:253/:675/:761/:897`). That is a real deployed-stub state, not a flow; only the *flow* option is orphaned.
   - Pass the wizard's Tailscale probe result to `discovery-readiness.js` as `tailscaleInstalled` (BE-CORE merged that input). Exactly one card is marked recommended: Tailscale when installed, else "Just this computer". Its label and its reason agree.
4. **N8: B6 payoff.** `runNow` awaits `triggerRun()` and shows a failure inline on B6 ("The first run didn't start — {reason}. Try again."), instead of fire-and-forget. B6's ○ rows for skipped steps use softer copy (P1).
5. **Link-primary contrast** (FE-B1's note: `body.jb-v2 a` makes link-shaped primaries about 2:1). Fix it in B5 and B6.
6. **Visual (`/frontend-design`).**
   - The B5 key panel, the outcome messages and the wizard cards are consistent with B1 and B4's new look.
   - Scoped CSS: **your CSS fence is the discovery block (`css/oneflow.css` from about `:1091`) and the payoff block (from about `:1929`)**, plus the wizard's own stylesheet, if it has one.
   - Screenshots at 1440 and 375 px (port-0 dev-server) go in `.lane-evidence/`, including at least three outcome states.

**Floor:** paste all of this in §4.
- `npm run lint:repo`
- `npm run typecheck:repo`
- `node --test` on your new `tests/gfx-fe-b5-*.test.mjs` files, `tests/gfx-be-fuel-*.test.mjs`, `tests/oneflow-b5-*.test.mjs`, `tests/oneflow-l3-*.test.mjs`, `tests/sixbeats2-fuel-beat.test.mjs`, `tests/ux01-c7-honest-setup.test.mjs`, `tests/discovery-wizard-*.test.mjs`, `tests/oneflow-l4-*.test.mjs`, `tests/oneflow-payoff-exit.test.mjs`, `tests/gfx-be-core-*.test.mjs`, plus any test that pins a string you changed (grep for it)
- `npm run test:e2e-onboarding` and `npm run test:e2e-journey`. FE-B2B3 owns the last `VAL-ONEFLOW-001` blocker (the B2 model pin); report its state, but don't fix B2
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)

- `oneflow-beat-discovery.js`: render and copy. The state machine and classification belong to BE-FUEL (merged); change them only if an outcome can't render, and say so
- `discovery-wizard-ui.js`, `discovery-wizard-shell.js`
- `discovery-wizard-probes.js`: the flow recommendation only, never the engine state
- `oneflow-beat-payoff.js`
- the discovery and payoff blocks of `css/oneflow.css`, plus the wizard's stylesheet
- `tests/gfx-fe-b5-*.test.mjs`, plus updates to tests that pin moved strings or behaviour (say so in the commit body)

**Do NOT touch:**
- `local-server.js`, `dev-server.mjs`, `start.sh` (BE-FUEL)
- `discovery-readiness.js` (BE-CORE): consume it
- `oneflow-beat-ai.js`, `oneflow-beat-resume.js` (FE-B2B3, live)
- `oneflow-beat-google.js`, `oneflow-route-local.js`, `onboarding-flow.js`, `oneflow-beat-fit.js`
- `index.html`, docs

## Non-negotiables

- D1: every blocked state has exactly one action, and B5 has no Skip.
- `unreachable` never tells the user to start a server.
- The Apps Script engine state stays.
- No key in a URL or log.
- Scoped CSS.

## Definition of Done

The floor, green and pasted in §4. First line `DONE`. Local commits only.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
