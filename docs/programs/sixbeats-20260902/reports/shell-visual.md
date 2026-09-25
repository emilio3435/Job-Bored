# Lane V2 — shell-visual (claims U2, C7)

Branch: `feat/sixbeats-shell-visual` · commit `1a30f7c` (local only, never pushed)
Fence: `discovery-wizard-shell.js`, `css/oneflow.css` inside `/* ONEFLOW:CORE */`

## 1. What this lane was

Make the one shell look and behave like `reference/six-beats-prototype.html`:

- **U2** — the flow rendered the 6-beat spine AND a second step-rail row under
  it (a lone `GOOGLE` pill on beat 1) AND a `STEP 1 OF 1` kicker inside the beat
  card, plus a footer note telling the visitor to "use the step rail above".
  Four things claiming to say where you are; spec §2 says ONE spine. The header
  strip, the beat card's framing, and the busy/message styling needed the
  prototype's polish on top of that.
- **C7** — at 390×844 beats 4–5 ran long and the actions were not reachable
  without scrolling to the bottom of the card.

Everything is gated on the host passing `spine`, so the discovery wizard, the
go-live wizard and the shell's own default blueprint keep the markup *and* the
paint they shipped with.

## 2. Which claims went red first (named tests)

`tests/sixbeats-v2-shell-visual.test.mjs` — written before any implementation.
First run against `ed44f35`: **9 of 15 failed** (the 6 that passed are the
guards that had to stay green all along: legacy hosts unchanged, the back
arrow, the header title, "writes nothing outside CORE").

```
▶ V2 · U2 — the flow shell shows ONE progress system (spec §2, §3.5.1)
  ✖ renders no legacy step rail beneath the spine
  ✖ renders no 'Step 1 of 1' counter inside the beat card
  ✖ drops the footer note that points at the removed rail
  ✔ keeps the back arrow, which is navigation and not progress
  ✔ keeps the title and Close together in the header
  ✖ marks the root with the one-flow variant hook the CORE sheet paints against
  ✔ leaves the rail, the counter and the hook alone for a host with no spine
▶ V2 · U2 — the CORE fence carries the shell's framing (spec §3.5)
  ✖ scopes every new shell rule to the one-flow hook
  ✖ keeps the spine's segments and the minutes label styled as one row
  ✖ styles the busy stage list and the message slot in the same fence
  ✔ writes nothing outside CORE
▶ V2 · C7 — the phone gets a sticky action bar and a scrolling body
  ✖ docks the footer with its own hook when a host passes a spine
  ✔ leaves a spine-less host's footer undocked
  ✖ pins the dock and the scrolling body inside a max-width 480px block
▶ V2 · the third legacy host renders unchanged (SUBSTRATE locked decision 1)
  ✔ the shell's default blueprint is byte-identical to the pre-lane shell
ℹ tests 15   ℹ pass 6   ℹ fail 9
```

After the implementation, same file:

```
ℹ tests 15
ℹ suites 4
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Claim → probe map:

| Claim | Probe |
|---|---|
| U2 · two rails | `renders no legacy step rail beneath the spine` |
| U2 · third indicator | `renders no 'Step 1 of 1' counter inside the beat card` |
| U2 · stale pointer | `drops the footer note that points at the removed rail` |
| U2 · header | `keeps the title and Close together in the header` |
| U2 · framing | `scopes every new shell rule to the one-flow hook`, `keeps the spine's segments and the minutes label styled as one row`, `styles the busy stage list and the message slot in the same fence` |
| C7 · mobile hook | `docks the footer with its own hook when a host passes a spine` |
| C7 · mobile rule | `pins the dock and the scrolling body inside a max-width 480px block` |
| identity lock | `leaves the rail, the counter and the hook alone for a host with no spine`, `leaves a spine-less host's footer undocked`, `the shell's default blueprint is byte-identical to the pre-lane shell`, plus the two trees the L0 suite already locks |

## 3. What shipped, file-and-fence

### `discovery-wizard-shell.js` (fence: whole file, V2-owned)

- `renderRoot` adds `discovery-setup-wizard--spine` to the dialog root **only**
  when `context.spine` exists. This is the single hook every CSS rule below
  hangs off; a host with no spine gains neither a class nor a node.
- `renderRoot` no longer appends `renderStepNavigation(context)` when a spine is
  present — the spine owns the position. The rail still renders for the
  multi-step legacy hosts that navigate from it.
- `renderStepFrame` skips the `Step N of M` kicker text when a spine is present,
  keeps the back arrow (navigation, not progress), and drops the kicker row
  entirely when it would be empty.
- `renderFooter` adds `discovery-setup-wizard__footer--dock` when a spine is
  present, and suppresses the default "Use the step rail above to jump between
  steps." note, which pointed at a component this lane removes.

No copy string was changed. The only string that stops rendering is the legacy
rail instruction, which is a pointer to deleted chrome, not spec §4/§5 copy.

### `css/oneflow.css` — inside `/* ONEFLOW:CORE */` only

~300 lines appended at the end of the CORE region (`writes nothing outside
CORE` asserts the L1–L4 regions stay untouched). Every selector is scoped to
`.discovery-setup-wizard--spine`, except the one-flow's own mount class
`.oneflow-root`, which CORE already owns.

- **Frame** — the flow narrows from the 1120px chassis to `min(56rem, 100%)`
  (the prototype stages at 860px), warm paper ground, one hard `--jb-line`
  border, `--jb-radius-lg`, the prototype's two-layer shadow. The chassis'
  decorative blue radial blobs are switched off; behind warm paper they read as
  a different product than the board the visitor just left. `.oneflow-root`'s
  backdrop is warmed to match.
- **Header** — `--jb-font-display` (Caveat) wordmark at 1.9rem, Close demoted to
  a quiet mono chip so the title leads.
- **Spine** — the six `__spine-dot`s become the prototype's 6px segment bars
  (`flex: 1 1 0`, mint for done, navy for current, `--jb-line-soft` for todo),
  with the beat labels in mono/uppercase/0.6rem directly under their own
  segment, and `about N min left` in Caveat mint on the right. The dots are
  `aria-hidden`; their numbers go, the labels carry the meaning.
- **Beat card** — `--jb-paper-2` on `--jb-line-soft`, the prototype's 24/32px
  padding, headline at 1.55rem/800/`text-wrap: balance`, sub at 0.95rem capped
  to 58ch, content 20px below the sub.
- **Busy stages + message** — the prototype's `.stages` rhythm (18px glyph
  gutter, 4px rows, 0.88rem) and its pulsing active glyph behind
  `prefers-reduced-motion: no-preference`; the message slot gets real padding
  and the 8px radius.
- **`@media (max-width: 480px)` — claim C7.** The shell goes full-bleed and
  `height: 100dvh` (a dock is only a dock if it is at the bottom of the
  *viewport*, on short beats too). `__body` becomes the one scroll region
  (`overflow-y: auto`, `overscroll-behavior: contain`) and `__frame` stops
  scrolling, so there are no longer two nested scrollers stranding the actions.
  `__footer--dock` goes `position: sticky; bottom: 0`, full-bleed, paper-backed,
  with a hairline top rule, a lift shadow and `env(safe-area-inset-bottom)`
  padding; its buttons stretch to full width. The header stays one row (the
  chassis' 760px rule stacked it and made Close a full-width bar), and the spine
  labels drop to 0.5rem so six of them still fit across 390px.

### `tests/sixbeats-v2-shell-visual.test.mjs` (new)

15 probes, listed above. The last suite **extends** the L0 identity lock with a
third legacy render (the shell's default blueprint, used when a host passes no
steps at all) — captured from the pre-lane shell and asserted byte-for-byte.
The two trees `tests/oneflow-l0-shell.test.mjs` locks were not touched or
weakened; they still pass unchanged in `npm test`.

## 4. Floor results — PASTED output

```
$ npm test            # scripts/run-tests.mjs — exit 0
ℹ tests 2608
ℹ suites 629
ℹ pass 2607
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6190.36
```

(The single `todo` is the pre-existing
`tests/submission-record-audit.test.mjs` "persists and can remove the canonical
submission evidence record", marked todo on the canonical-ownership gate. It is
`todo`, not a failure — `npm test` exits 0.)

```
$ npm run lint:repo
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

```
$ npm run typecheck:repo
> command-center@0.1.0 typecheck:repo
> npm run typecheck:browser-use-discovery && node --check app.js && … && node --check discovery-wizard-shell.js && … && node --check onboarding-celebration.js

> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```
(clean — no diagnostics; `discovery-wizard-shell.js` is already registered in
the `node --check` chain, and this lane created no new browser JS file)

```
$ npm run test:contract:all
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
```

Not part of this lane's floor, run anyway because V2 touches the shell every
browser suite drives (Q1 owns them):

```
$ npm run test:e2e-journey
  ✓  1 … should open a zero-config visit on the demo board, not a credential ask (405ms)
  ✓  2 … should collapse the invitation to a corner pill that still opens the flow (393ms)
  ✓  3 … should enter the one shell at beat 1 with the six-beat spine when the visitor accepts (416ms)
  ✓  4 … should treat closing the flow as pausing — Esc returns to the board and re-entry resumes the saved beat (664ms)
  ✓  5 … should never show the one-flow to a user who already finished setup (559ms)
  ✓  6 … should show queued, running, and partial discovery outcomes (2.0s)
  ✓  7 … should carry completed discovery into the pipeline and ready dossier materials (8.7s)
  7 passed (13.5s)

$ npm run test:e2e-smoke
  ✓  1 … greenfield boot produces zero console errors (3.4s)
  ✓  2 … every <script src> in the served HTML returns 200 (314ms)
  ✓  3 … screen S0 — the demo board — is the cold-start surface, credential gate hidden (293ms)
  ✓  4 … demo cards render watermarked, with a fit score and a why-it-fits line (319ms)
  ✓  5 … JobBoredOneFlow.open() renders a beat, and its primary action is hittable (376ms)
  ✓  6 … requestDiscoverySetup() renders the wizard shell with a usable primary action (394ms)
  6 passed (5.5s)
```

## 5. Screenshots — before/after, both viewports

Captured with `.lane-evidence/shot.mjs` (Playwright + the repo's hermetic
fixture harness, `/?greenfield=1`, `JobBoredOneFlow.open()` / `goToBeat("fit")`).
All eight files are in `.lane-evidence/`.

| Beat | Viewport | Before | After |
|---|---|---|---|
| B1 Google | 1440×900 | `before-beat1-1440x900.png` | `after-beat1-1440x900.png` |
| B4 Your fit | 1440×900 | `before-beat4-1440x900.png` | `after-beat4-1440x900.png` |
| B1 Google | 390×844 | `before-beat1-390x844.png` | `after-beat1-390x844.png` |
| B4 Your fit | 390×844 | `before-beat4-390x844.png` | `after-beat4-390x844.png` |

What changed, per claim:

- **U2, 1440×900 (`before-beat1-1440x900.png` → `after-beat1-1440x900.png`):**
  before, three progress indicators stack — the numbered spine, a full-width
  rail pill reading `GOOGLE` directly beneath it, and `STEP 1 OF 1` at the top
  of the card. After, one spine: six segment bars over six mono labels, with
  `about 15 min left` in Caveat on the right, and nothing else. The shell also
  narrows from 1120px to 896px, the blue haze becomes warm paper, and the
  wordmark leads the header with Close demoted to a mono chip.
- **U2, 1440×900 beat 4 (`before-beat4-1440x900.png` → `after-beat4-1440x900.png`):**
  same — rail row and step counter gone, spine reads three done / one current /
  two todo at a glance, card framed with the prototype's padding.
- **C7, 390×844 beat 4 (`before-beat4-390x844.png` → `after-beat4-390x844.png`):**
  before, the header stacked into two rows with Close as a full-width bar, the
  rail pill ate another row, and the card scrolled inside itself with the
  primary action pinned below it. After, the shell is full-bleed and full-height,
  the header is one row again, the body is the single scroll region, and
  `Looks like me →` sits in a full-width sticky bar at the bottom of the
  viewport with the content scrolling behind it.
- **C7, 390×844 beat 1 (`before-beat1-390x844.png` → `after-beat1-390x844.png`):**
  a short beat now docks its two actions at the bottom of the viewport too,
  full-width and stacked, instead of floating mid-card.

## 6. Anything unverified, including what the sandbox refused

- **Outside my fence — the "Ad / d" wrap on beat 4.** In every beat-4 screenshot
  (before and after, both viewports) the fit wizard's inline `Add` buttons wrap
  mid-word to two lines. That is `fit-profile-wizard.js` / the L2 fit CSS, not
  `ONEFLOW:CORE`, so I left it alone. **Route it** — it is visible in the
  1440×900 after shot and will read as unfinished in Q1's visual gate.
- **Outside my fence — the S0 board.** Claim U1 is V1's; nothing here touches
  `oneflow-demo-board.js` or the L4 region.
- **One flake, not reproducible.** On the *first* `npm run test:e2e-journey` run
  (immediately after the screenshot rig had been driving the same hermetic
  server), `should treat closing the flow as pausing` failed at the post-reload
  `expect(DEMO_BOARD).toBeVisible()`. It passed on the pre-lane files, passed on
  my files in isolation, and passed 7/7 on two subsequent full-suite runs (the
  output pasted in §4). I believe it was contention with the screenshot run
  rather than this change, but I could not reproduce it to prove that — flagging
  it so Q1 watches that spec.
- **Real-device touch not verified.** The 480px dock was verified in headless
  Chromium at 390×844 only. `env(safe-area-inset-bottom)` and momentum scrolling
  behind the dock are untested on real iOS/Android hardware.
- **Prototype parity is structural, not pixel.** Per SIXBEATS locked decision 2
  I replicated the prototype's structure and rhythm in the product's token
  system; the prototype's `frame-chrome` browser strip is prototype furniture
  and was deliberately not reproduced.
- **Nothing was refused by the sandbox.** `npm test`, both lint steps, both
  typecheck projects, the contract suite and both Playwright suites all ran.
  Committed locally as `1a30f7c`; never pushed.
