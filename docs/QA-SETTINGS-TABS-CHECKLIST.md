# QA checklist — Settings tabs refactor

Manual regression tests after the anchor-nav → real-tabs migration.

## Tab structure

- [ ] Settings modal shows exactly 6 tabs: Setup, Sheet, Discovery, Scraping, ATS Scoring, AI Providers
- [ ] Only one tab panel is visible at a time
- [ ] Default tab on open is Setup
- [ ] Clicking each tab button shows the correct panel and hides the others
- [ ] Desktop: vertical left rail layout with tab buttons
- [ ] Mobile (< 600px): horizontal scroll tab strip at top, no multi-row wrapping

## Tab content placement

### Setup

- [ ] OAuth Client ID field is present
- [ ] "Redo onboarding wizard" button is present and functional
- [ ] "Clear saved settings" button is present
- [ ] Clear settings confirm bar appears inside Setup tab when clicked
- [ ] Cancel / Remove actions work as before

### Sheet

- [ ] Spreadsheet URL / Sheet ID field
- [ ] Dashboard title field

### Discovery

- [ ] Discovery webhook URL field
- [ ] Discovery callout ("Pipeline works without a webhook")
- [ ] Setup guide / Hermes + ngrok / Cloudflare relay / Test webhook buttons
- [ ] Discovery engine status card
- [ ] Apps Script deploy accordion
- [ ] Discovery preferences accordion (roles, location, keywords)

### Scraping

- [ ] Job posting scraper URL field
- [ ] Scraper setup button

### ATS Scoring

- [ ] ATS scorecard mode dropdown (server / webhook)
- [ ] ATS scorecard server URL field
- [ ] ATS scorecard webhook URL field

### AI Providers

- [ ] Provider dropdown (Gemini / OpenAI / Anthropic / webhook)
- [ ] Provider panels show/hide based on selection (unchanged behavior)
- [ ] Gemini / OpenAI / Anthropic API key + model fields
- [ ] Webhook URL field

## Keyboard & accessibility

- [ ] Arrow Right/Down moves to next tab
- [ ] Arrow Left/Up moves to previous tab
- [ ] Home moves to first tab (Setup)
- [ ] End moves to last tab (AI Providers)
- [ ] Tab buttons have `role="tab"`, panels have `role="tabpanel"`
- [ ] `aria-selected="true"` on active tab only
- [ ] `aria-controls` links each tab button to its panel
- [ ] `aria-labelledby` links each panel back to its tab button
- [ ] Hidden panels have `hidden` attribute

## Save & reload

- [ ] Save button remains visible on all tabs (global footer)
- [ ] Save collects values from ALL tabs, not just the visible one
- [ ] Validation error for missing sheet ID switches to Sheet tab
- [ ] Save & reload still works end-to-end

## Discovery flow integration

- [ ] `focusDiscoveryWebhookFieldInSettings()` switches to Discovery tab and focuses the webhook URL
- [ ] Apps Script remediation UI (from CORS failure) activates Discovery tab
- [ ] Cloudflare relay "Apply" fills webhook URL and activates Discovery tab
- [ ] Discovery test button preconditions still work

## Entry points

- [ ] Open settings from main settings button (header gear)
- [ ] Open settings from sheet-access gate "Open settings" button
- [ ] Open settings from setup flow
- [ ] Relay / Apps Script remediation paths open settings then focus discovery controls
- [ ] `?setup=discovery` deep link still works

## Regression checks

- [ ] OAuth-only mode (`settings-modal--oauth-only`) hides the tab layout
- [ ] Provider panel switching (Gemini ↔ OpenAI ↔ Anthropic ↔ Webhook) still works
- [ ] Apps Script deploy flow works from Discovery tab
- [ ] Discovery engine status updates live as webhook URL changes
- [ ] Sheet field blur normalizes the Sheet ID
- [ ] OAuth client ID input triggers Apps Script deploy UI refresh
- [ ] No console errors on settings open/close cycle

## Highest-risk regressions (smoke test first)

1. **Save & reload** — all fields across all tabs collected and persisted
2. **Discovery webhook focus** — tab switch + field focus from outside the modal
3. **Provider panel switching** — display toggling inside AI Providers tab
4. **OAuth-only mode** — tab layout hidden, OAuth field still editable
5. **Apps Script deploy** — accordion open + deploy button inside Discovery tab
