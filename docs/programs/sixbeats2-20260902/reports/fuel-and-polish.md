# LANE REPORT — fuel-and-polish (SIXBEATS-2, 2026-09-02)

Branch `feat/sixbeats2-fuel-and-polish`. Findings owned: **NEW-3**, **NEW-12**,
**NEW-9**, **NEW-5 (BLOCKER)**, **NEW-13**.

## 1. What this lane was

Five findings from the observe-only acceptance rerun on main @ `cf0da4d`
(`docs/programs/sixbeats2-20260902/evidence/rerun-09-02/REPORT.md`), all in
Beat 5's fuel panel, the discovery verifier, screen S0's demo board, and the
shared toast:

| # | Tag | What the rerun saw | What shipped |
|---|---|---|---|
| NEW-3 | MISMATCH | "Save & verify" reported `Google Jobs index connected — 100 searches/mo` after an env write + worker restart. The key was never shown to SerpApi. | A real server-side check (`POST /__proxy/serpapi-check`) runs FIRST; the beat reports connected only on `ok`, and prints the quota SerpApi actually returned. |
| NEW-12 | CONFUSING | Message slot, in full: `Can't reach the endpoint.` after a `ts.net` POST failed at 15002 ms. Spec §8.4: every error names the next action. | On a tailnet URL the **message itself** names the first check (`tailscale status`), with tailnet-shaped remediation behind it. The bare-origin catch-all is untouched. |
| NEW-9 | UGLY | `…no card needed).1 · Create your free account ↗` — a hand-typed "1." inside an `<ol>` with `list-style: none`, and the deep link inline behind the full stop. | A real ordered list (`list-style: decimal`, `display: list-item`) and each deep link as its own block. Sentences unchanged. |
| NEW-5 | **BLOCKER** | An open demo-card detail (`position: fixed`, `z-index: 5`, no close) sat on the collapsed "Set up JobBored — 15 min ▸" pill and swallowed its clicks. | The detail carries its own Close, answers Escape, and moved to the opposite corner so the two boxes cannot intersect. |
| NEW-13 | UGLY | A ~500 px-tall red toast, almost one word per line, over the gate; its own action button overlapping its text. | The row wraps, the message keeps a 220 px flex basis + `overflow-wrap`, and the cap moves 360 → 420 px. |

## 2. Which claims went red first (named tests)

Every claim has a probe that failed before the fix and passes after.

**New suites (all red on the pre-lane tree):**

- `tests/sixbeats2-serpapi-check.test.mjs` — 6 probes, all red (route was a 404).
  - `asks SerpApi about the key and returns the real quota`
  - `names an invalid key rather than reporting connected`
  - `treats a 200 carrying an \`error\` string as an invalid key`
  - `says unreachable when SerpApi cannot be contacted`
  - `rejects an empty key without calling SerpApi`
  - `refuses a cross-origin caller, like every sibling /__proxy route`
- `tests/sixbeats2-fuel-beat.test.mjs` — 7 probes, **7/7 red** first run:
  - `checks the key with SerpApi BEFORE writing it into the worker env`
  - `shows the REAL quota SerpApi reported, not a hardcoded 100/mo`
  - `degrades to a plain connected line when SerpApi reports no quota`
  - `a rejected key never reports connected, never writes, and names the next action`
  - `distinguishes 'SerpApi is unreachable' from 'your key is wrong'`
  - `names the local server when the check request itself cannot be made`
  - `renders the check as its own live stage before the save`
- `tests/sixbeats2-tailnet-unreachable.test.mjs` — 2/3 red (the third pins the
  UNCHANGED non-tailnet copy and was green by design):
  - `puts the next action in the MESSAGE, which is the only line the beat renders`
  - `remediates the tailnet, not a local worker the user never started by hand`
- `tests/sixbeats2-demo-detail-dismiss.test.mjs` — 4/5 red:
  - `offers a Close control the moment it opens`
  - `clicking Close removes the detail and leaves the board standing`
  - `Escape closes it, and other keys do not`
  - `still offers nothing that writes — Close is the only control`
- `tests/sixbeats2-fuel-steps-markup.test.mjs` — 2/4 red:
  - `no step types its own number — the list draws the marker`
  - `styles the list so the marker renders and the link starts its own line`
- `tests/sixbeats2-toast-wrap.test.mjs` — 2/2 red.

**Browser proof — `tests/e2e-visual/fuel-and-polish.spec.mjs`, 8 tests, 7 red
on the pre-lane tree** (`.lane-evidence/red-first-e2e-visual.txt`, produced by
restoring the four fence files from `1651a1d` and re-running the suite):

```
  ✘   1 … S0 demo detail at 1440×900 › should keep the setup pill clear of an open demo detail (1440×900)
  ✘   2 … S0 demo detail at 1440×900 › should close the demo detail from its own control and from Escape (1440×900)
  ✓   3 … S0 demo detail at 390×844 › should keep the setup pill clear of an open demo detail (390×844)
  ✘   4 … S0 demo detail at 390×844 › should close the demo detail from its own control and from Escape (390×844)
  ✘   5 … B5 fuel steps at 1440×900 › should draw a list marker and give each deep link its own line (1440×900)
  ✘   6 … B5 fuel steps at 390×844 › should draw a list marker and give each deep link its own line (390×844)
  ✘   7 … toast at 1440×900 › should wrap a long toast like prose, never one word per line (1440×900)
  ✘   8 … toast at 390×844 › should wrap a long toast like prose, never one word per line (390×844)
```

Test 3 is green pre-fix and stays green: at 390 px the collapsed ask is
`position: static` above the board, so the fixed detail never reached it. The
blocker is a desktop-geometry defect, and that is where it was red.

### The BLOCKER, measured (non-hermetic dismissal: none)

`.lane-evidence/new5-blocker-red.txt`, pre-fix, real Chromium at 1440×900:

```
Error: the detail covers the pill:
  detail={"x":1060,"y":682.75,"width":360,"height":197.25,"top":682.75,"right":1420,"bottom":880,"left":1060}
  pill=  {"x":1067.44,"y":768.39,"width":225.56,"height":36,"top":768.39,"right":1293,"bottom":804.39,"left":1067.44}
```

The pill's box is **entirely inside** the detail's — 1067.44…1293 inside
1060…1420, 768.39…804.39 inside 682.75…880 — at `z-index` 3 under a `z-index` 5
fixed overlay. That is the swallowed click, in numbers.

Post-fix the same test asserts non-intersection **and then really clicks the
pill with the detail still open** (nothing is dismissed programmatically) and
waits for `.discovery-setup-wizard--spine` to be visible. Green.

Screenshots (1440×900 and 390×844, `.lane-evidence/`):

- `new5-before-detail-covers-pill-1440x900.png` — the failure state.
- `after-new5-detail-and-pill-1440x900.png` / `-390x844.png` — detail bottom-left
  with a `×`, pill bottom-right, both fully clickable.
- `after-new9-fuel-steps-1440x900.png` / `-390x844.png` — `1.` `2.` `3.` drawn at
  the line start, each deep link on its own line.
- `after-new13-toast-1440x900.png` / `-390x844.png` — the rerun's verbatim toast
  string, wrapped as prose, action button on its own line.

## 3. What shipped, file-and-fence

Inside the fence, nothing outside it.

| File | Fence | Change |
|---|---|---|
| `dev-server.mjs` | one new route | `POST /__proxy/serpapi-check` — local-origin auth (`isLocalOrigin` + the generic `/__proxy/*` guard), calls `https://serpapi.com/account.json?api_key=…` server-side with a 12 s abort, answers `{ok, plan, searchesLeft}` or `{ok:false, reason}` (`invalid_key` / `unreachable` / `upstream_error` / `empty_key`). A 401/403 **or** a 200 carrying an `error` string is a rejected key. The catch never logs the exception — the URL carries the key. |
| `oneflow-beat-discovery.js` | whole file | `checkFuelKey()` runs before the env write; three live stages (`Checking your key with SerpApi…` → `Saving your key…` → the quota line); `quotaLine()` renders what SerpApi said and invents nothing when the payload carries no numbers; `FUEL_CHECK_ERRORS` gives each failure its own next action; the panel status reads from the same one truth. `FUEL_STEPS` lost its hand-typed digits and its numbered link labels. |
| `discovery-wizard-verify.js` | catch-all only | A `.ts.net` endpoint gets its message, remediation and `suggestedCommand` from the tailnet branch; the bare-origin branch is byte-identical to what it was. The `network_error` taxonomy is unchanged. |
| `oneflow-demo-board.js` | whole file | `buildDetailHead()` (DEMO chip + Close), `closeDetail()`, Escape on the panel and on `document` (both feature-detected), and `unmount()` drops the listener. |
| `css/oneflow.css` | L3/L4 regions | `.oneflow-fuel__steps` → `list-style: decimal outside`, `.oneflow-fuel__step` → `display: list-item`, step deep links → `display: block`. `.oneflow-demo__detail` anchored `left` instead of `right`; new `.oneflow-demo__detail-head` / `-close` rules. |
| `style.css` | the toast rule | `.toast` gains `flex-wrap: wrap` + `align-items: flex-start`, `max-width` 360 → 420; `.toast-message` `flex: 1 1 220px` + `overflow-wrap: break-word`; `.toast-action-btn` `margin-left: auto` so a wrapped button lands at the row's end. |

**Legacy tests updated in place (ground rule 7), same commits:**

- `tests/oneflow-l3-beat-discovery.test.mjs` — `makeFuelFetch` now answers the
  check, and the two assertions pinning `100 searches/mo` assert the real quota
  line. SIXBEATS2-SPEC locked decision 5 supersedes that string in spec §5 B5.
- `tests/oneflow-l4-demo-board.test.mjs` — the read-only claim now allows
  exactly one control, the close, and still forbids every input/select/textarea.
  A dismiss control promises no write the fixture cannot keep.

No new browser JS file was created, so `typecheck:repo`'s `node --check` list
needed no change (ground-rules trap 2).

## 4. Floor results — PASTED output

Run on `feat/sixbeats2-fuel-and-polish` @ `eb7f896`, in this worktree.
Raw logs in `.lane-evidence/floor-*.txt`.

### `npm test` — the only gate that counts

```
> command-center@0.1.0 test
> node scripts/run-tests.mjs
…
ℹ tests 2811
ℹ suites 682
ℹ pass 2810
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 9585.687458
EXIT:0
```

The single `todo` is pre-existing and untouched by this lane:
`tests/submission-record-audit.test.mjs` → `persists and can remove the
canonical submission evidence record  # blocked on the canonical-ownership
gate; no legal Sheet column or IndexedDB store`. `fail 0`.

### `npm run lint:repo`

```
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills
…
OK integrations/openclaw-command-center/SKILL.md
EXIT:0
```

### `npm run typecheck:repo`

```
> tsc --noEmit --project server/tsconfig.json
EXIT:0
```

### `npm run test:contract:all`

```
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
EXIT:0
```

### `npm run test:e2e-visual` — the SIXBEATS visual gate, incl. this lane's 8 new tests

```
Running 32 tests using 1 worker
…
  ✓   1 tests/e2e-visual/fuel-and-polish.spec.mjs:82:5 › S0 demo detail at 1440×900 › should keep the setup pill clear of an open demo detail (1440×900)
  ✓   2 tests/e2e-visual/fuel-and-polish.spec.mjs:106:5 › S0 demo detail at 1440×900 › should close the demo detail from its own control and from Escape (1440×900)
  ✓   3 tests/e2e-visual/fuel-and-polish.spec.mjs:82:5 › S0 demo detail at 390×844 › should keep the setup pill clear of an open demo detail (390×844)
  ✓   4 tests/e2e-visual/fuel-and-polish.spec.mjs:106:5 › S0 demo detail at 390×844 › should close the demo detail from its own control and from Escape (390×844)
  ✓   5 tests/e2e-visual/fuel-and-polish.spec.mjs:142:5 › B5 fuel steps at 1440×900 › should draw a list marker and give each deep link its own line (1440×900)
  ✓   6 tests/e2e-visual/fuel-and-polish.spec.mjs:142:5 › B5 fuel steps at 390×844 › should draw a list marker and give each deep link its own line (390×844)
  ✓   7 tests/e2e-visual/fuel-and-polish.spec.mjs:223:5 › toast at 1440×900 › should wrap a long toast like prose, never one word per line (1440×900)
  ✓   8 tests/e2e-visual/fuel-and-polish.spec.mjs:223:5 › toast at 390×844 › should wrap a long toast like prose, never one word per line (390×844)
…
  32 passed (1.1m)
EXIT:0
```

### The other two browser suites (not required by the floor; run because this lane touched shared `style.css`)

```
npm run test:e2e-smoke     →   7 passed (16.7s)   EXIT:0
npm run test:e2e-journey   →  12 passed (21.8s)   EXIT:0
```

## 5. Anything unverified, including what the sandbox refused

1. **No live SerpApi call was ever made.** Every probe of
   `/__proxy/serpapi-check` stubs `globalThis.fetch` for `serpapi.com` only;
   the dev-server request itself goes through the real fetch. The field names
   the handler reads (`plan_name`, `total_searches_left`, `plan_searches_left`,
   `error`) come from SerpApi's documented `account.json` and are **not**
   verified against the live endpoint from this lane. If the live payload
   differs, the failure mode is safe — no `searchesLeft` renders the plain
   `Google Jobs index connected.` line rather than an invented number — but a
   real-key smoke on the integration branch would close this properly.
2. **The rerun's NEW-13 toast was intermittent** (0/5 on clean `?greenfield=1`
   cold starts). This lane fixed the *rendering*, not whatever produced the
   toast on the Path B boot. The e2e proof therefore raises the real toast
   through the app's own `window.showToast()` with the rerun's verbatim string
   and the same `Copy bootstrap command` action, rather than waiting for the
   intermittent trigger. Whoever owns the webhook-secret boot path still owns
   the question of why it fired.
3. **NEW-5 at 390×844 was already non-overlapping** before the fix, because the
   phone layout puts the collapsed ask above the board. The blocker was
   desktop-only geometry; the mobile test is a regression guard, not a repro.
4. **The tailnet branch is decided by hostname** (`/(^|\.)ts\.net$/`). A worker
   published on a tailnet through a custom domain will still get the
   bare-origin remediation. That matches how the beat's own Tailscale path
   builds its URL today.
5. Screenshots and floor logs live in `.lane-evidence/`, which is gitignored —
   they are lane evidence, not shipped artifacts. The rerun's read-only Gemini
   media was cited, never copied.
6. Nothing was pushed. Two local commits on `feat/sixbeats2-fuel-and-polish`:
   `49db162` (NEW-3, NEW-12) and `eb7f896` (NEW-5, NEW-9, NEW-13).
