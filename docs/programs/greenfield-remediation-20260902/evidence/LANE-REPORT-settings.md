# LANE REPORT — lane D `settings` (claims D1–D5)

Branch `feat/greenfield-settings`, cut from the integration base `7addeb4`.
Status: **Definition of Done met.** Full floor green, committed locally, never pushed.

---

## 1. What this lane was

Settings stops re-asking for what the six beats already collected: one effective-config
resolver (`getEffectiveConfig()`) feeds both the beats and the Settings modal, the
raw-localStorage bypass in `settings-profile-tab.js` is gone, and the drawer-owned
discovery webhook fields leave Settings. Setup + Sheet collapse into one "Google" tab and
AI Providers becomes "AI", each opening with a receipt of what setup holds plus a
"Change in setup" button that deep-links into the beat with `{ returnTo: "close" }`.

---

## 2. Which claims went red first

Three new files, written and run against the untouched base before any implementation.
Raw output is in `.lane-evidence/red-d1-d2.txt`, `.lane-evidence/red-d3.txt`,
`.lane-evidence/red-d4-d5.txt`.

### D1 + D2 — `tests/greenfield-d-effective-config.test.mjs` (9 tests, 0 pass / 9 fail)

```
▶ D1 · getEffectiveConfig() is the overlay resolver
  ✖ is exported on the same global as getConfig (2.02175ms)
  ✖ preserves a malformed sheetId as-is instead of nulling the config (1.314833ms)
  ✖ overlays the stored config overrides on top of window config (0.460625ms)
  ✖ returns an object even with no window config at all (0.375875ms)
▶ D1 · populateCommandCenterSettingsForm reads getEffectiveConfig()
  ✖ fills the form from the resolver, not from a raw window-config spread (0.965958ms)
▶ D1 · oneflow-beat-ai liveConfig() reads getEffectiveConfig()
  ✖ routes the beat's config reads through the resolver (0.294416ms)
▶ D2 · settings-profile-tab.js is not a second override writer
  ✖ does not name the override localStorage key anywhere in the file (0.129792ms)
  ✖ does not name the transport-setup localStorage key either (0.081875ms)
  ✖ round-trips a discovery secret through mergeStoredConfigOverridePatch (1.150375ms)
ℹ tests 9
ℹ pass 0
ℹ fail 9

test at tests/greenfield-d-effective-config.test.mjs:79:3
✖ is exported on the same global as getConfig
  AssertionError [ERR_ASSERTION]: configCore.getEffectiveConfig must sit beside configCore.getConfig
  + actual - expected
  + 'undefined'
  - 'function'

test at tests/greenfield-d-effective-config.test.mjs:295:3
✖ does not name the override localStorage key anywhere in the file
  AssertionError [ERR_ASSERTION]: settings-profile-tab.js must not touch
  localStorage["command_center_config_overrides"] — config-overrides.js owns that key
  true !== false
```

### D3 — `tests/greenfield-d-tabs.test.mjs` (11 tests, 3 pass / 8 fail)

```
▶ D3 · TAB_ORDER collapses Setup + Sheet into google, AI Providers into ai
  ✖ orders google and ai, and drops setup / sheet / ai_providers (1.580416ms)
  ✔ keeps Fit Profile, Scraping, ATS Scoring and Upgrades untouched
  ✖ labels google 'Google' and ai 'AI' (0.498375ms)
  ✖ defaults to the google tab (0.675ms)
  ✖ maps every former Setup or Sheet field to google (0.4785ms)
  ✖ maps every AI provider field to ai (0.459834ms)
  ✖ no field still routes to a retired tab id (0.831792ms)
▶ D3 · the partial matches the schema
  ✖ renders a google tab button and panel, and no setup/sheet ones (0.6435ms)
  ✖ renders an ai tab button and panel, and no ai_providers one (0.328583ms)
  ✔ every schema panel id and button id exists in the partial
  ✔ keeps every field DOM id stable
ℹ pass 3
ℹ fail 8
```

(The three that passed red are the guard rails: the tabs that must NOT move, and the
field-DOM-id-stability assertion that must hold before AND after.)

### D4 + D5 — `tests/greenfield-d-receipts.test.mjs` (21 tests, 3 pass / 18 fail)

```
▶ D4 · the Google receipt reports what setup already holds
  ✖ shows the Sheet title and the signed-in email when both are present (1.696416ms)
  ✖ falls back to the Sheet id when no custom title is set (0.7125ms)
  ✖ says Not connected with no Sheet at all (0.380833ms)
▶ D4 · the AI receipt names the provider and model
  ✖ shows provider · model from the effective config (0.4315ms)
  ✖ falls back to the catalog default model when none is stored (0.323541ms)
  ✖ says Not connected when no provider has been set up (0.260125ms)
▶ D4 · renderSettingsReceipts writes into the receipt blocks
  ✖ fills [data-receipt-state] for google and ai (0.408458ms)
▶ D4 · settings_change_in_setup deep-links into the beat and returns
  ✖ closes the modal, then opens the beat with returnTo: close (0.699417ms)
  ✖ routes the AI receipt button at the ai beat (0.534334ms)
  ✖ does not throw when the one-flow global is absent (0.657ms)
▶ D4 · the partial carries the receipt blocks
  ✖ has a google receipt with a state node and a change button (0.782375ms)
  ✖ has an ai receipt with a state node and a change button (0.534834ms)
  ✖ points at the drawer for discovery credentials instead of duplicating them (0.301ms)
▶ D5 · the drawer owns the discovery webhook fields
  ✔ the settings partial has no webhook URL or secret input
  ✖ settings-modal.js no longer populates or saves them (0.247209ms)
  ✖ a Settings save never writes a discovery key even when the drawer fields exist (0.930167ms)
▶ D5 · one default-model table, two consumers
  ✖ model-catalog.js exports DEFAULT_MODEL_BY_PROVIDER with the beat's ids (0.716667ms)
  ✖ oneflow-beat-ai.js hard-codes no provider default model (0.092458ms)
  ✖ settings-modal.js hard-codes no provider default model (0.063208ms)
  ✖ the Settings save writes the catalog default when a model field is blank (0.805292ms)
```

Two red assertions were revised *while still red* — both because the original wording
asserted something outside this lane's fence. They are called out here so the change is
not mistaken for a green-washing edit:

- `every default is a real option in that provider's static list` → replaced with
  `keys the table by a supported provider id, with a non-empty model each`. The fence
  says model-catalog.js gets `DEFAULT_MODEL_BY_PROVIDER` "and nothing else", so I cannot
  add `gpt-5.6-terra` / `claude-sonnet-5` to `STATIC_FALLBACK`. See §5.
- `settings-modal.js no longer populates or saves them` was a whole-file string ban; it
  is now scoped to the `populateCommandCenterSettingsForm` and
  `saveCommandCenterSettingsFromForm` bodies, which is what the kickoff actually
  specifies ("populate/payload code no longer references them"). See §5 for the two
  live-status listeners that remain.

**All three files green after implementation: 41 pass / 0 fail.**

---

## 3. What shipped

| File | Fence | Change |
|---|---|---|
| `app-config-core.js` | add `getEffectiveConfig()` beside `getConfig()` | New resolver: applies stored overrides, then returns a shallow copy of `window.COMMAND_CENTER_CONFIG`. Never null, `sheetId` verbatim. Exported on `window.JobBoredApp.configCore`. |
| `settings-profile-tab.js` | `:780-820` raw key, `:460-480` transport read | Both raw-localStorage paths deleted. `updateDiscoverySecretCaches` now reads/writes through `configOverrides.readStoredConfigOverrides` / `mergeStoredConfigOverridePatch`; `readDiscoveryTransportSetupState` delegates to config-overrides.js. Both key constants removed (orphaned by the change). Two functions added to the existing `__test` block. |
| `settings-tab-schema.js` | `TAB_ORDER`, `FIELD_TAB_MAP`, labels | `SETUP`+`SHEET` → `GOOGLE` ("Google"), `AI_PROVIDERS` → `AI` ("AI"). `TAB_ORDER` = google, ai, fit_profile, scraping, ats_scoring, upgrades. `DEFAULT_TAB` = google. Every Setup/Sheet field maps to `google`; every provider field to `ai` (including the OpenRouter/Local ids that were previously unmapped). `TAB_ORDER` now exported. |
| `settings-modal.js` | populate, payload, model defaults, receipt render | `populateCommandCenterSettingsForm` reads `getEffectiveConfig()`. New `buildSettingsReceipt`, `renderSettingsReceipts`, `settingsChangeInSetup` (all exported) + the `[data-action="settings_change_in_setup"]` click wiring. The two `settingsDiscoveryWebhook*` populate lines and the two payload `assignOwned` lines are gone, along with the now-dead discovery-engine-state re-record branch and the orphaned `resolveGeminiModel` host shim. All five blank-model fallbacks read `defaultModelFor(...)`. |
| `partials/settings-modal.html` | panel grouping, receipt blocks | Tablist: `google` + `ai` buttons replace `setup` / `sheet` / `ai_providers`. The Sheet panel's two fields moved into the Google panel as a `settings-setup-block`; the Sheet panel is gone. Both panels open with `<div class="settings-receipt" data-receipt="…">` carrying a `[data-receipt-state]` line and a `data-action="settings_change_in_setup" data-beat="…"` button. Added "Discovery connection lives in the drawer → Connection." **Every field DOM id unchanged; zero duplicate ids (verified by parse).** |
| `oneflow-beat-ai.js` | `:125-150` defaults, `:490-500` liveConfig | `liveConfig()` resolves through `configCore.getEffectiveConfig()` with the raw config as fallback. All five `defaultModel:` literals removed from `PROVIDERS`; `resolveModel` reads the new lazy `defaultModelFor(def.id)`. Lazy on purpose — model-catalog.js loads *after* this file in index.html. `defaultModelFor` exported for the test seam. |
| `model-catalog.js` | defaults export only | Added and exported `DEFAULT_MODEL_BY_PROVIDER` (frozen). Nothing else touched. |
| `settings-tabs.css` | **outside fence — see §5** | 36 lines: `.settings-receipt`, `.settings-receipt__state`, `.settings-receipt__btn`. Scoped under `.settings-receipt` so `body.jb-v2 p` (0,1,1) cannot outrank the state line. |

New tests: `tests/greenfield-d-effective-config.test.mjs`, `tests/greenfield-d-tabs.test.mjs`,
`tests/greenfield-d-receipts.test.mjs`.

No `<script>` tag was added — no new file was created, so index.html is untouched.

### Pre-existing tests updated, and why

| Test | Why it had to change |
|---|---|
| `tests/settings-modal-webhook-secret-roundtrip.test.mjs` | Its second case asserted "still writes discovery URL/secret when those fields are present on the form". D5 makes that behaviour wrong: the drawer is the only owner, and the fields are reachable by id from anywhere on the page. Rewritten as **"leaves discovery URL/secret alone even when the drawer fields are mounted"**, asserting the patch carries neither key and the stored identity survives. The first case (F2C-SETUP01-PRESERVE) is unchanged and still passes. |
| `tests/sixbeats2-beat-provider.test.mjs` | `defaults Gemini to gemini-3.5-flash…` read `PROVIDERS.find(p => p.id === "gemini").defaultModel`, which D5 deletes. Rewritten to assert `beats.ai.defaultModelFor("gemini")` **and** `JobBoredModelCatalog.DEFAULT_MODEL_BY_PROVIDER.gemini` — the same claim, now proving the two consumers read one table. |
| `tests/settings-profile-schedule-card.test.mjs` | Two cases assert the bootstrap secret lands in `localStorage["command_center_config_overrides"]`. D2 routes that write through config-overrides.js, which the sandbox did not load. The harness now runs `config-overrides.js` before `settings-profile-tab.js`, exactly as index.html does. **The assertions themselves are unchanged** — same key, same value, same round-trip. |
| `tests/oneflow-l1-harness.mjs` | `loadArrival` did not load `model-catalog.js`, so the beat's lazy `defaultModelFor` resolved to `""` and the "pins that model on the server" case broke. Added `"model-catalog.js"` to the front of the `files` list (index.html loads it before the beats). Additive: one entry, no existing line touched. Flagged in §5 as shared with lanes A/B. |

No other test in `tests/` referenced `setup` / `sheet` / `ai-providers` tab ids or the
webhook fields — verified by grep across `tests/`. `tests/discovery-drawer-payload.test.mjs`
and `tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs` assert those field
ids inside `partials/discovery-drawer.html`, which this lane does not touch, and both still pass.

### Commits

```
0ea295a feat(settings): receipts instead of asks; the drawer owns the webhook
eb40fc9 feat(settings): collapse Setup + Sheet into Google, AI Providers into AI
e2da799 feat(settings): one effective-config resolver, one override writer
```

---

## 4. Floor results

Run from `/private/tmp/Job-Bored-greenfield-settings`. Raw output in `.lane-evidence/floor-*.txt`.

### `npm test` — exit 0

```
ℹ tests 3074
ℹ suites 869
ℹ pass 3073
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 213062.885917

✖ failing tests:
test at tests/submission-record-audit.test.mjs:17:1
✖ persists and can remove the canonical submission evidence record (3.850917ms) # blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store
```

`fail 0` / `todo 1`: `submission-record-audit` is a pre-existing `todo`-annotated test
("blocked on the canonical-ownership gate"), unrelated to this lane — it touches no file
in the fence. `npm test` exits 0.

### `npm run lint:repo` — exit 0

```
> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

### `npm run typecheck:repo` — exit 0

```
> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```
(plus `node --check` over all 80+ browser globals, including every file this lane touched
— no output means clean.)

### `npm run test:e2e-smoke` — 7 passed

```
Running 7 tests using 1 worker
  ✓  1 tests/e2e-smoke/boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors (3.5s)
  ✓  2 tests/e2e-smoke/boot-smoke.spec.mjs:102:1 › every <script src> in the served HTML returns 200 (368ms)
  ✓  3 tests/e2e-smoke/boot-smoke.spec.mjs:128:1 › screen S0 — the demo board — is the cold-start surface, credential gate hidden (386ms)
  ✓  4 tests/e2e-smoke/boot-smoke.spec.mjs:144:1 › demo cards render watermarked, with a fit score and a why-it-fits line (413ms)
  ✓  5 tests/e2e-smoke/boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (429ms)
  ✓  6 tests/e2e-smoke/boot-smoke.spec.mjs:182:1 › requestDiscoverySetup() renders the wizard shell with a usable primary action (701ms)
  ✓  7 tests/e2e-smoke/case-dossier.spec.mjs:227:1 › The Case renders in a real browser from seeded pipeline data (6.2s)

  7 passed (12.7s)
```

### `npm run test:e2e-visual` — 37 passed

```
  ✓   1 tests/e2e-visual/finale-burst.spec.mjs:95:5 › the B6 finale at 1440×900 › should fire on Beat 6 and clear itself, carrying no second payoff (1440×900) (3.9s)
  …
  ✓  37 tests/e2e-visual/shell-structure.spec.mjs:310:3 › the one shell on a phone — claim C7 › should dock the footer at the bottom of the viewport, not the bottom of the card (1.2s)

  37 passed (1.1m)
```
(full 37-line list in `.lane-evidence/floor-e2e-visual.txt`)

### Live check in a real browser

Node tests cannot prove the receipts render or that the deep link actually lands, so
`.lane-evidence/receipt-live-check.mjs` drives Chromium against `dev-server.mjs`:

```
{
  "tabs": [
    { "id": "google",      "label": "Google",      "selected": "true"  },
    { "id": "ai",          "label": "AI",          "selected": "false" },
    { "id": "fit_profile", "label": "Fit Profile", "selected": "false" },
    { "id": "scraping",    "label": "Scraping",    "selected": "false" },
    { "id": "ats_scoring", "label": "ATS Scoring", "selected": "false" },
    { "id": "upgrades",    "label": "Upgrades",    "selected": "false" }
  ],
  "googleReceipt": "Emilio's board",
  "aiReceipt": "OpenRouter · openai/gpt-oss-120b:free",
  "changeButtons": [ "google", "ai" ],
  "googlePanelVisible": true,
  "sheetField": true,
  "webhookField": false
}
AI TAB: {"aiPanelVisible":true,"googlePanelHidden":true,"aiReceipt":"OpenRouter · openai/gpt-oss-120b:free"}
AFTER CHANGE-IN-SETUP: {
  "modalDisplay": "none",
  "shellMounted": true,
  "mountText": "Set up JobBored×Close✓Google2AI3Resume4Your fit5Discovery6Doneabout 10 min leftNow give it a brain.One AI key powers eve"
}
pageerrors: []
```

Screenshots: `.lane-evidence/settings-google-tab.png`, `.lane-evidence/settings-ai-tab.png`,
`.lane-evidence/settings-receipts.png` (the AI beat after the deep link).

---

## 5. Anything unverified, and every line outside the fence

### Fence extensions I took (declare-and-continue, per GROUND-RULES §Fences)

1. **`settings-tabs.css` — 36 added lines.** The kickoff fences the receipt *markup*
   (`partials/settings-modal.html`) but names no stylesheet, and `.settings-receipt` is a
   new class with no existing rule. Without it the receipt renders as an unstyled `<p>`
   and a loose button. The block is purely additive (no existing selector touched) and
   is scoped under `.settings-receipt` to survive the jb-v2 cascade trap. No other lane
   in this program touches `settings-tabs.css`.

2. **`tests/oneflow-l1-harness.mjs` — one added array entry.** `loadArrival` is shared
   with lanes A and B. The exact added lines:
   ```js
       // index.html loads the model catalog before the beats; oneflow-beat-ai.js
       // resolves a provider's default model from its DEFAULT_MODEL_BY_PROVIDER
       // table at call time (GREENFIELD D5), so the arrival sandbox needs it.
       "model-catalog.js",
   ```
   Needed because D5 makes the beat's default-model resolution lazy, and the sandbox
   otherwise has no catalog. Additive, at the top of the `files` list; no existing entry
   moved. **Orchestrator: this is the one place lane D touches a lane-A/B-shared file.**

### Known gaps, all deliberate, none blocking

3. **`resolveGeminiModel()` still returns the `gemini-flash` alias.** It lives in
   `discovery-drawer.js:1090` (out of fence) and still falls back to `"gemini-flash"`,
   which the beat's own comment says Google 404s. Settings no longer calls it (the blank
   Gemini model field now takes `DEFAULT_MODEL_BY_PROVIDER.gemini` = `gemini-3.5-flash`),
   but the drawer's Gemini calls still do. **Follow-up: point `discovery-drawer.js`'s
   final fallback at the catalog table.**

4. **`resume-generate.js` carries the same stale defaults** the roadmap flagged —
   `resumeOpenAIModel: c.resumeOpenAIModel || "gpt-4o-mini"` (`:180`),
   `resumeAnthropicModel: … || "claude-sonnet-4-6"` (`:181`), plus `:457` and `:503`.
   Out of fence. It is now the last file that disagrees with the table.

5. **`model-catalog.js`'s `STATIC_FALLBACK` does not contain the new defaults.** The
   openai list stops at `gpt-5.4` and the anthropic list at `claude-opus-4-8` /
   `claude-fable-5`; neither has `gpt-5.6-terra` or `claude-sonnet-5`. So a user who
   opens the Settings model dropdown for those two providers will not see the id the beat
   would pick. The fence says model-catalog.js gets the defaults export "and nothing
   else", so I did not add them. **This is the one place D5's "they agree" is true in
   code but not yet true in the dropdown.** Recommend a one-line-per-provider addition to
   `STATIC_FALLBACK` as a follow-up.

6. **Two live-status listeners on `#settingsDiscoveryWebhookUrl` remain in
   `settings-modal.js`** (`initCommandCenterSettings`, `input` + `blur` →
   `renderDiscoveryEngineStatusUi()`). They are neither populate nor payload code, and
   `settings-modal.js` is the only file that binds them — deleting them would drop live
   engine-status refresh as the user types in the *drawer*, with nothing to catch it.
   **Follow-up: move these two listeners into `discovery-setup-modals.js`**, which owns
   the Connection tab. Until then, "the drawer owns the fields" is true for read/write
   and not quite true for event wiring.

7. **`companies-tab.js:502` opens Settings with `{ tab: "profile" }`.** `"profile"` has
   never been a tab id in `TAB_META` (the profile surface moved behind the briefcase nav
   long ago), so `setActiveSettingsTab` returns early and the modal just opens on the
   default tab. Pre-existing, unaffected by this lane, out of fence — noting it because I
   read every `setActiveSettingsTab` caller while checking for retired ids.

### On lane A's seam

`settingsChangeInSetup` passes `open(beat, { returnTo: "close" })` as instructed and is
wrapped in a `typeof oneFlow.open === "function"` guard plus a try/catch, so it is a
no-op-after-close if the global is absent. Per the kickoff I do **not** assert the close
behaviour — the live check above only records that the shell mounted on the AI beat.
Lane E asserts the return on integration.

### Sandbox

Nothing was refused. `npm ci` was not needed (`node_modules` present); Playwright
chromium was already installed (v1.61.1). The dev server bound `127.0.0.1:8101` for the
live check without incident. Commits succeeded.
