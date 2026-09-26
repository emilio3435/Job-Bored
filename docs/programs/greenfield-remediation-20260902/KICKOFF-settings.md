# KICKOFF — lane D `settings` (claim ids D1–D5)

Read `GROUND-RULES.md`, then `GREENFIELD-SPEC.md` §1 F6, §3 items 3–5, §4.5, §5 items 5–6, and `ROADMAP.md` §1.6 (the overlap table). Create `LANE-REPORT-settings.md` before anything else.

## Mission
Settings stops re-asking for what the six beats already collected. One effective-config resolver feeds both the beats and the modal; the raw-localStorage bypass is gone; drawer-owned webhook fields leave Settings; Setup and Sheet become one "Google" tab and AI Providers becomes "AI", each opening with a receipt of what setup holds and a "Change in setup" button that deep-links into the beat and returns.

## Fence (you own exactly these)
- `app-config-core.js`: add `getEffectiveConfig()` beside `getConfig()` (`:51-61`), exported on the same global.
- `settings-profile-tab.js:780-820` (the raw-key read/write) and `:460-480` (the transport read).
- `settings-tab-schema.js` (`TAB_ORDER`, `FIELD_TAB_MAP`, labels).
- `settings-modal.js`: `populateCommandCenterSettingsForm` (`~:436-475`), the save payload (`~:803-850`), the model-default fallbacks (`~:825-841`), tab rendering, the new receipt render.
- `partials/settings-modal.html`: panel grouping, receipt blocks, removal of the webhook fields. **Field DOM ids do not change.**
- `oneflow-beat-ai.js:125-150` (model defaults → catalog table) and `:490-500` (`liveConfig` → `getEffectiveConfig`).
- `model-catalog.js`: add and export `DEFAULT_MODEL_BY_PROVIDER`; nothing else.
- Existing settings tests under `tests/` that reference tab ids `setup`/`sheet`/`ai-providers` or the webhook fields — update them; list every one in the report.
- New tests: `tests/greenfield-d-effective-config.test.mjs`, `tests/greenfield-d-receipts.test.mjs`, `tests/greenfield-d-tabs.test.mjs`.

You consume lane A's `open(beatId, { returnTo: "close" })`; pass the options and never assert on the close behavior (lane E does, on integration).

## Claims (red first)
- **D1 · effective config.** `getEffectiveConfig()` returns the overlaid config with a malformed `sheetId` preserved as-is (not nulled); `populateCommandCenterSettingsForm` and `liveConfig()` read from it (assert by stubbing).
- **D2 · one writer.** `settings-profile-tab.js` no longer reads or writes `localStorage["command_center_config_overrides"]` directly; a grep-style test asserts the string is absent from the file, and a behavioral test asserts a save round-trips through `mergeStoredConfigOverridePatch`.
- **D3 · tabs.** `TAB_ORDER` has `google` and `ai`, no `setup`/`sheet`/`ai-providers`; every field formerly in Setup or Sheet maps to `google`; Scraping, ATS Scoring, Fit Profile, Upgrades unchanged.
- **D4 · receipts.** `[data-receipt="google"]` shows the Sheet title (or id) and signed-in email when present, "Not connected" otherwise; `[data-receipt="ai"]` shows provider + model; `[data-action="settings_change_in_setup"]` closes the modal and calls `window.JobBoredOneFlow.open(<beat>, { returnTo: "close" })`.
- **D5 · webhook fields gone; defaults unified.** `#settingsDiscoveryWebhookUrl` / `#settingsDiscoveryWebhookSecret` absent from the partial; populate/payload code no longer references them; `settings-modal.js` and `oneflow-beat-ai.js` both resolve a provider's default model from `DEFAULT_MODEL_BY_PROVIDER` and agree (`gpt-5.6-terra`, `claude-sonnet-5`, `gemini-3.5-flash`, `openai/gpt-oss-120b:free`, `gemma4:e2b` — verify against `oneflow-beat-ai.js` before locking the table).

## Non-negotiables
- Field DOM ids stable. Only grouping, labels, and headers move.
- Discovery credentials are owned by the drawer's Connection tab; Settings links there ("Discovery connection lives in the drawer → Connection") instead of duplicating fields.
- No change to the override key allow-list semantics beyond what D1–D5 need.

## Definition of Done
- D1–D5 red output pasted, then green.
- Full floor pasted, including the list of pre-existing tests you updated and why. Commit locally, never push.
