# LANE REPORT — B2 boot-error (SIXBEATS claim C1)

**Root cause, one sentence:** C1 as reported — an uncaught
`TypeError: Cannot read properties of null (reading 'appendChild')` on
`/?greenfield=1` first paint — **does not reproduce** on this tree or on the
commit the walkthrough itself ran (`5239f58`) under six environment
configurations that match the walkthrough's own recorded network fingerprint;
the only code in the 115-script boot surface that can throw that exact
TypeError is `showToast()` in `auth-session.js`, which appended into
`document.getElementById("toastContainer")` without ever checking the lookup
resolved, and that is what this lane fixed and pinned.

**Owning file (named before editing, per the fence):** `auth-session.js`
— chosen after the RCA below, which is what the fence required.

---

## 1. What this lane was

Claim C1 (`SIXBEATS-SPEC.md`): "cold start throws before the user does
anything." The kickoff required RCA *before* any fix, a Playwright
`pageerror` capture before and after, a module-level red-first test, and a
minimal fix at the source rather than a guard on the symptom.

## 2. Which claims went red first (named tests)

`tests/sixbeats-boot-null-parent-toast.test.mjs` — new, runs in the `npm test`
gate (confirmed present in the gate output, line 3721 of
`.lane-evidence/floor-npm-test.txt`). It slices the `TOAST SYSTEM` section out
of `auth-session.js` and runs it in a vm with a minimal document, the same
source-slicing pattern `tests/oauth-session-storage-boundary.test.mjs`
established.

Red before the fix — three of its four probes failed with **the exact string
claim C1 reports**:

```
✖ does not throw when #toastContainer is absent (claim C1's exact shape)
  actual: TypeError: Cannot read properties of null (reading 'appendChild')
      at Object.showToast (auth-session.js#toast-system:50:13)
✖ still announces to assistive tech when there is nowhere to paint
  TypeError: Cannot read properties of null (reading 'appendChild')
✖ still returns a callable dismiss so held references keep working
  TypeError: Cannot read properties of null (reading 'appendChild')
```

Green after:

```
▶ SIXBEATS C1 — a boot-path append must never dereference a null parent
  ✔ renders into #toastContainer when the page has one (the shipped path)
  ✔ does not throw when #toastContainer is absent (claim C1's exact shape)
  ✔ still announces to assistive tech when there is nowhere to paint
  ✔ still returns a callable dismiss so held references keep working
ℹ pass 4  ℹ fail 0
```

Mutation check: delete the `if (!container)` guard and probe 2 fails with the
C1 TypeError again. Probe 1 exists so the guard cannot be "fixed" by making
the shipped page stop rendering toasts.

## 3. What shipped, file-and-fence

`auth-session.js` — `showToast()`, one guard, no refactor:

```js
  // SIXBEATS C1: #toastContainer (index.html:1419) is the only parent any
  // boot-path append here dereferences without checking. showToast is a
  // published global (window.showToast) called from ~220 sites, so a host
  // page without the container turned every one of them into an uncaught
  // "Cannot read properties of null (reading 'appendChild')". The
  // announcement above is the accessible channel and has already fired;
  // only the painting is impossible, so hand back a no-op dismiss rather
  // than throwing into the caller's flow.
  if (!container) return () => {};
```

The guard sits *after* the `JobBoredA11y.live.announce` mirror, so the
accessible channel (jb-a11y.js:182) still fires when rendering is impossible,
and it returns a callable dismiss because ~220 call sites store and later
invoke that return value — returning `undefined` would only move the
TypeError to the caller.

`tests/sixbeats-boot-null-parent-toast.test.mjs` — new pin (§2).

Nothing else in the repo was touched. `git diff --stat` at commit time:
`auth-session.js` +10, one new test file.

### The RCA that produced that answer

**Step 1 — reproduce.** `.lane-evidence/capture-boot-errors.mjs` starts the
real `dev-server.mjs` on a free port (no hermetic fence, no `config.js` — a
fresh clone's exact serving posture) and loads `/?greenfield=1` and `/` in
Chromium, printing every `pageerror` with its stack. **BEFORE the fix:**

```
=== /?greenfield=1 ===
pageerrors: 0
console errors: 5
  [console.error] Failed to load resource: … 403 (Forbidden)
  [console.error] Refused to execute script from '…/config.js' because its MIME type ('text/plain') is not executable…
  [console.error] [JobBored startup] window:error {kind: resource, target: …/config.js}
  [console.error] Access to fetch at 'http://127.0.0.1:3847/api/applications' … blocked by CORS policy…
  [console.error] Failed to load resource: net::ERR_FAILED

=== / ===
pageerrors: 0
console errors: 5
  (same five)

RESULT: zero page errors
```

Zero. The environment is not the reason — the request log matches the
walkthrough's own fingerprint, including both its `KNOWN` 403s:

```
RES 200 /?greenfield=1
RES 403 /__proxy/discovery-state
RES 403 /__proxy/ngrok-tunnels
RES 200 https://accounts.google.com/gsi/client
```

**Step 2 — falsify the obvious causes.** Six configurations, none of which
produced a single `pageerror`:

| # | Configuration | Probe | Result |
|---|---|---|---|
| 1 | HEAD, `/?greenfield=1` and `/`, cold cache | `capture-boot-errors.mjs` | 0 |
| 2 | HEAD, six consecutive warm-cache reloads in one context | `probe-cache.mjs` | 0 |
| 3 | HEAD, GSI (`accounts.google.com/gsi/client`, `async` in `<head>`) served instantly from memory to force the earliest possible execution, plus a `Document.prototype.body` getter that logs every null read with a stack | `probe-body-null.mjs` | 0; the only null `document.body` read all boot is index.html:285's own `if (document.body)` guard |
| 4 | HEAD, local materials API (:3847) proxied with a permissive ACAO so it answers 200 with real data — the walkthrough had it reachable, my random port is 403'd by its origin allowlist | `probe-with-api.mjs` | 0 |
| 5 | HEAD, driven through S0 → demo card → pill → beat shell → `requestDiscoverySetup` (the surface `path-a-desktop.webm` actually shows at 00:00–00:03) → a toast | `probe-flow.mjs` | 0 |
| 6 | **Commit `5239f58`** — the build the walkthrough reports — extracted to scratch and served by its own `dev-server.mjs`, both URLs | scratch `capture.mjs` | 0 |

Playwright is **1.61.1**, the same version the walkthrough used.

**Step 3 — trace the null anyway.** Two instruments rather than guesses:

- `.lane-evidence/probe-null-queries.mjs` wraps `Document.prototype`/
  `Element.prototype` `getElementById`/`querySelector`/`closest` and records
  every null return during boot with its stack. 76 null lookups fired; every
  one is in a caller that null-checks (dawn-data self-tests, settings tabs
  binding absent panels, fit-profile-backcompat's slot poll, GSI's own
  `googleidentityservice_button_styles` lookup).
- A static scan over **all 115 scripts `index.html` boots** for the hazard
  shape — a parent obtained from a DOM query, appended to without a guard —
  plus the parent-chain variants (`parentNode`/`parentElement`/`closest()`
  `.appendChild`). Three raw hits; `pipeline.js:1602` is inside
  `if (card && fromBody)` and `app.js:173` is behind
  `if (!statusCard || !statusTitle || !statusDetail || !statusActions) return;`.
  The third — `auth-session.js:585`, `container.appendChild(toast)` with
  `container = document.getElementById("toastContainer")` and no check
  anywhere between — is the **only unguarded null-parent append in the entire
  boot surface**, and it is the fix above.

**Step 4 — the walkthrough evidence does not corroborate C1.** Cited for the
record, not to dismiss the claim:

- `path-a-desktop.webm` (83.76 s / 6,270,885 B — the report's "1m 22s,
  5.98 MB") at **00:00–00:03, the exact window `SIXBEATS-SPEC.md` cites for
  C1**, shows the legacy **Discovery setup** wizard (8-step
  STATUS/PATH/CONFIG/SERVER/TUNNEL/RELAY/TEST/DONE rail), not screen S0. The
  report's S0 prose ("renders the full demo board with 8 scored cards and
  centered invitation card") describes a surface its own desktop video does
  not show at that timestamp. `s0-01-cold-start.png` is that same wizard frame.
- The report says every step was "recorded with an on-screen DevTools overlay
  HUD". There is no HUD in any frame I sampled, so nothing in the media shows
  the console line the claim quotes.
- 20 of the 30 named screenshots are **byte-identical duplicates**: `b1-02` =
  `b1-03` = `b1-04` = `b1-05`; `b4-01` = `b4-02` = `b4-03` = `b4-05`;
  `b5-02` = `b5-03` = `b5-04` = `b5-05`; `path-b-01` = `path-b-02` =
  `path-c-02` = `path-c-04` = `path-c-07`; and four more pairs. The set
  collapses to ~15 distinct images.
- The media is not wholesale fabricated — `path-a-mobile-s0.webm` is
  unmistakably the real app (DEMO chips, fit scores, the verbatim invitation
  copy) and `path-a-desktop.webm` at 40 s is the real Beat 4. The problem is
  that the prose and the media disagree at exactly the moment C1 is claimed.

Conclusion: the console line is most likely an artifact of the walkthrough
runner rather than app code. The fix above is not a guard placed over C1's
symptom — C1 has no reproducible symptom to guard — it is the one genuine
instance of C1's failure mode that the exhaustive boot-surface trace found.

**AFTER the fix** (`.lane-evidence/capture-AFTER.txt`):

```
=== /?greenfield=1 ===
pageerrors: 0
=== / ===
pageerrors: 0
RESULT: zero page errors
```

## 4. Floor results — PASTED output

```
$ npm test
ℹ tests 2597
ℹ suites 626
ℹ pass 2596
ℹ fail 0
ℹ skipped 0
ℹ todo 1
NPM_TEST_EXIT=0

$ npm run lint:repo
> eslint .
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
lint:repo exit=0

$ npm run typecheck:repo
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
> tsc --noEmit --project server/tsconfig.json
typecheck:repo exit=0

$ npm run test:contract:all
OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
test:contract:all exit=0
```

The one `todo` is `tests/submission-record-audit.test.mjs` → "persists and can
remove the canonical submission evidence record", annotated `# blocked on the
canonical-ownership gate`. **Pre-existing, not this lane**: it fails
identically when run against a pristine `git archive HEAD` extraction
(`ed44f35`, before any change of mine). `npm test` exits 0 with it.

## 5. Anything unverified, and what needs routing

1. **C1 is unreproducible and should be re-tagged.** The orchestrator marked
   C1 `ERROR` with "Source unknown — RCA required"; the RCA's answer is that
   it does not reproduce, on the walkthrough's own commit or on HEAD, in six
   configurations. The spec's success criterion "a red-first test that fails
   on `5406698` and passes on the integration branch" is met only in the sense
   that the shipped test fails on `5406698`'s `auth-session.js` — **no test
   can make the walkthrough's boot pageerror appear**, because the boot does
   not produce one. Recommend re-tagging C1 to match C4's "suspected artifact"
   and treating this lane's pin as the durable guard.
2. **The walkthrough evidence needs a health warning for the other lanes.**
   §3 Step 4 documents prose/media disagreement and 20 duplicate screenshots.
   V1, V2, B3 and Q1 are all reading claims out of that report — they should
   verify against the app, not against the report's screenshots.
3. **`evidence/s0-as-shipped-emilio.png` is missing.** `SIXBEATS-SPEC.md`
   names it as the whole of claim U1 and the addendum tells V1 to work from
   it, but `docs/programs/sixbeats-20260902/evidence/` contains only the two
   `.md` files. V1 is blocked on it. Outside my fence — routing, not fixing.
4. **`.lane-evidence/` is not in `eslint.config.mjs`'s `ignores`.** The
   ground rules say to keep scratch there, but `eslint .` lints it, and my
   Playwright probes' `page.evaluate` closures tripped 17 `no-undef` errors on
   browser globals. I kept the floor green without touching repo config by
   putting `/* eslint-disable no-undef */` at the top of each probe. The
   config already ignores `tmp/**` for exactly this reason; adding
   `.lane-evidence/**` beside it would spare every future lane the same
   detour. Outside my fence — routing.
5. **Second unguarded dereference in the same function, left alone.**
   `showToast` also does `toast.querySelector(".toast-close").addEventListener(…)`
   with no null check. It cannot throw in a real browser (the preceding
   `innerHTML` assignment always parses that node into existence), so fixing
   it would be speculative hardening rather than a defect fix, and the fence
   said one minimal change. Noted so it is a decision on the record, not an
   oversight.
6. **Not run:** `test:e2e-journey` / `test:e2e-smoke`. `tests/e2e-smoke/**`
   and `tests/e2e-journey/**` are Q1's fence, and the addendum assigns both
   Playwright suites to Q1's floor, not mine. `tests/e2e-smoke/boot-smoke.spec.mjs`
   already has a "greenfield boot produces zero console errors" test that
   folds `pageerror` into its console-error list; **Q1 should extend it to the
   configured `/` route too** — today only `/?greenfield=1` is covered, and
   C1's claim spans both.
7. **Scratch probes are gitignored** (`.lane-evidence/`), so they are not in
   the commit. They are reproducible from this report: `capture-boot-errors.mjs`,
   `probe-cache.mjs`, `probe-body-null.mjs`, `probe-with-api.mjs`,
   `probe-flow.mjs`, `probe-null-queries.mjs`, `probe-requests.mjs`,
   `probe-board.mjs`, plus `capture-BEFORE.txt` / `capture-AFTER.txt`.
8. **Unrelated observation, not acted on:** `/__proxy/discovery-state` and
   `/__proxy/ngrok-tunnels` still 403 from the browser on every boot. Known
   and owned elsewhere; it is not C1 (the 403s are present in runs with zero
   page errors).
