# Settings Tabs Worker Prompts

Copy-paste prompts for a master orchestrator and a 5-worker swarm to refactor
the settings modal into real standalone tabs.

Use this when implementing the settings IA split into:

- `Setup`
- `Sheet`
- `Discovery`
- `Scraping`
- `ATS Scoring`
- `AI Providers`

## How To Use This

1. Start the master orchestrator first.
2. Have the orchestrator create the seam files and lock interfaces before
   spawning workers.
3. Run Workers 1, 2, and 3 first.
4. After those interfaces are stable, run Workers 4 and 5 in parallel.
5. Keep all `app.js` and `index.html` integration edits owned by the
   orchestrator.

## Shared Rules For Every Worker

Paste these rules into every worker prompt:

- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an `app.js` or `index.html` change, do not make it.
  Instead, leave a clear integration note for the orchestrator.
- Preserve current behavior unless the new tab IA explicitly changes it.
- The settings UI must become real standalone tabs, not anchor links to lower
  sections of the same page.
- The required tabs are exactly:
  - `Setup`
  - `Sheet`
  - `Discovery`
  - `Scraping`
  - `ATS Scoring`
  - `AI Providers`
- `Discovery` and `Scraping` must be separate.
- `ATS Scoring` and `AI Providers` must be separate.
- `Setup` must absorb onboarding/reset behavior that is currently orphaned
  below the old nav.
- Report exactly which files you changed and any orchestrator follow-ups.

## Master Orchestrator Prompt

```text
You are the master orchestrator for the Settings Tabs refactor in the Job-Bored repo.

Read these files first:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/style.css
- /Users/emilionunezgarcia/Job-Bored/app.js
- /Users/emilionunezgarcia/Job-Bored/docs/SETTINGS-TABS-WORKER-PROMPTS.md

Project goal:
Replace the current anchor-based settings section nav with real standalone tabs.

Required tab IA:
- Setup
- Sheet
- Discovery
- Scraping
- ATS Scoring
- AI Providers

Required content placement:
- Setup:
  - OAuth Client ID
  - redo onboarding wizard
  - clear saved settings / destructive settings reset UI
  - short setup-oriented copy if helpful
- Sheet:
  - Spreadsheet URL / Sheet ID
  - Dashboard title
- Discovery:
  - Discovery webhook URL
  - discovery status card
  - discovery setup/test actions
  - Apps Script deploy/remediation UI
  - discovery preferences
- Scraping:
  - Job posting scraper URL
  - scraper setup entrypoint
- ATS Scoring:
  - ATS scorecard mode
  - ATS scorecard server URL
  - ATS scorecard webhook URL
- AI Providers:
  - provider selector
  - provider-specific API keys/models
  - resume generation webhook URL

Non-negotiable UX rules:
- tabs must be real tabs, not links to lower sections on the same page
- only one tab panel is visible at a time
- desktop layout should support a left tab rail or similarly clear standalone-tab UI
- mobile layout should use a horizontally scrollable top tab strip, not a wrapped multi-row nav
- header and footer should remain stable while the tab panel body scrolls
- Save & reload stays global
- validation and focus flows must become tab-aware
- any discovery-specific helper that focuses a hidden field must activate Discovery first

Your ownership:
- own all integration edits in /Users/emilionunezgarcia/Job-Bored/index.html
- own all integration edits in /Users/emilionunezgarcia/Job-Bored/app.js
- own all merge decisions
- own final QA and behavior verification

Create and use these seam files before parallel work starts:
- /Users/emilionunezgarcia/Job-Bored/settings-tabs.js
- /Users/emilionunezgarcia/Job-Bored/settings-tabs.css
- /Users/emilionunezgarcia/Job-Bored/settings-tab-schema.js
- /Users/emilionunezgarcia/Job-Bored/settings-discovery-adapters.js
- /Users/emilionunezgarcia/Job-Bored/docs/QA-SETTINGS-TABS-CHECKLIST.md

Lock these interfaces before spawning workers:
- window.JobBoredSettingsTabs.initSettingsTabs(root, options)
- window.JobBoredSettingsTabs.setActiveSettingsTab(tabId, options)
- window.JobBoredSettingsTabs.getActiveSettingsTab()
- window.JobBoredSettingsTabSchema.SETTINGS_TAB_IDS
- window.JobBoredSettingsTabSchema.getSettingsTabForField(fieldId)
- window.JobBoredSettingsDiscoveryAdapters.ensureDiscoveryTabActive(tabApi)
- window.JobBoredSettingsDiscoveryAdapters.focusDiscoveryWebhookField(tabApi)

Important existing code to integrate carefully:
- settings modal markup in /Users/emilionunezgarcia/Job-Bored/index.html
- settings open/save/init flows in /Users/emilionunezgarcia/Job-Bored/app.js
- discovery-specific focus/remediation/test helpers in /Users/emilionunezgarcia/Job-Bored/app.js
- current settings modal layout CSS in /Users/emilionunezgarcia/Job-Bored/style.css

Execution order:
1. Read current code and define the exact seam interfaces above.
2. Create minimal stub versions of the seam files and wire load order in index.html.
3. Spawn Worker 1, Worker 2, and Worker 3 in parallel.
4. After their interfaces are stable, spawn Worker 4 and Worker 5 in parallel.
5. Rewrite the settings modal markup in index.html into the 6-tab structure.
6. Integrate the tab controller into app.js.
7. Make save, validation, and focus flows tab-aware.
8. Make discovery-specific helpers activate Discovery before focusing hidden controls.
9. Run smoke checks using the QA checklist.
10. Report residual risks.

Specific behavior requirements:
- replace old anchor nav completely
- remove any dependency on scrolling to #settings-theme-* sections
- missing sheet config should switch to Sheet
- discovery-related save/test/remediation should switch to Discovery
- ATS-related validation should switch to ATS Scoring
- AI provider/key-related validation should switch to AI Providers
- clear-settings confirm UI should live under Setup instead of being orphaned below the old sections
- redo onboarding should live under Setup
- preserve current provider-panel switching behavior
- preserve current discovery webhook, Apps Script, relay, and scraper flows

Do not delegate:
- final app.js integration
- final index.html integration
- final conflict resolution
- final QA signoff

When you finish, report:
- files you changed
- which worker outputs were integrated
- which old settings section patterns were removed
- checks run
- any residual risks
```

## Worker 1 Prompt: Tab Controller

```text
You are Worker 1 for the Settings Tabs refactor in the Job-Bored repo.

Read these files first:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/app.js

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve current behavior unless the new tab IA explicitly changes it.
- The settings UI must become real standalone tabs, not anchor links.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
Build the reusable JS tab controller for the settings modal.

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/settings-tabs.js

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/app.js
- /Users/emilionunezgarcia/Job-Bored/settings-tab-schema.js

Build:
- a namespaced API under window.JobBoredSettingsTabs
- initSettingsTabs(root, options)
- setActiveSettingsTab(tabId, options)
- getActiveSettingsTab()
- keyboard navigation for tabs
- ARIA state management for tablist/tab/tabpanels
- focus restoration when switching tabs
- support for default tab on open
- support for tab activation before focusing a field
- support for revealing a target field inside a hidden panel after activation

Constraints:
- do not edit app.js
- do not edit index.html
- do not implement discovery business logic
- do not style the UI outside your file

Expected integration notes for orchestrator:
- required DOM data attributes / ids
- expected options shape for initSettingsTabs
- how to activate a tab before focusing a field

At the end, list:
- files changed
- exported API
- orchestrator integration notes
```

## Worker 2 Prompt: Tabs Layout And CSS

```text
You are Worker 2 for the Settings Tabs refactor in the Job-Bored repo.

Read these files first:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/style.css

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve current behavior unless the new tab IA explicitly changes it.
- The settings UI must become real standalone tabs, not anchor links.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
Build the CSS for the new settings tabs layout.

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/settings-tabs.css

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/style.css

Build:
- desktop settings modal layout with a clear standalone tab UI
- mobile horizontal-scroll tab strip
- active/inactive/hover/focus tab states
- tab panel visibility states
- a modal body layout where the panel area scrolls but header/footer remain stable
- styles for Setup tab utility/danger blocks
- styles that fit the existing Job-Bored visual language

Constraints:
- do not edit style.css
- do not edit index.html
- do not rely on anchor scrolling
- do not introduce a design system reset

Deliver:
- complete CSS in settings-tabs.css
- a short integration note for the orchestrator covering:
  - required wrapper classes
  - any expected DOM structure
  - any responsive assumptions

At the end, list:
- files changed
- major CSS hooks/classes
- orchestrator integration notes
```

## Worker 3 Prompt: Tab Schema And Validation Mapping

```text
You are Worker 3 for the Settings Tabs refactor in the Job-Bored repo.

Read these files first:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/app.js

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve current behavior unless the new tab IA explicitly changes it.
- The settings UI must become real standalone tabs, not anchor links.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
Define the settings tab metadata and field-to-tab mapping so the orchestrator can make validation and focus flows tab-aware.

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/settings-tab-schema.js

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/app.js

Build:
- SETTINGS_TAB_IDS
- ordered tab metadata for:
  - setup
  - sheet
  - discovery
  - scraping
  - ats_scoring
  - ai_providers
- default tab id
- field-to-tab mapping for every settings field id currently used in index.html/app.js
- helpers:
  - getSettingsTabForField(fieldId)
  - getSettingsDefaultFieldForTab(tabId)
  - getSettingsTabMeta(tabId)
  - getSettingsPanelId(tabId)
  - getSettingsTabButtonId(tabId)

Also include mappings for non-field UI anchors the orchestrator will need:
- discovery webhook area
- Apps Script area
- scraper area
- onboarding reset area
- clear settings confirm area

Constraints:
- do not edit app.js
- do not edit index.html
- do not implement DOM wiring
- be explicit and exhaustive

At the end, list:
- files changed
- exported schema/helpers
- any fields or controls the orchestrator must map manually
```

## Worker 4 Prompt: Discovery Tab Adapters

```text
You are Worker 4 for the Settings Tabs refactor in the Job-Bored repo.

Read these files first:
- /Users/emilionunezgarcia/Job-Bored/app.js
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/settings-tabs.js
- /Users/emilionunezgarcia/Job-Bored/settings-tab-schema.js

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve current behavior unless the new tab IA explicitly changes it.
- The settings UI must become real standalone tabs, not anchor links.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
Build small adapter helpers so discovery-specific settings flows can safely activate the Discovery tab before focusing hidden controls.

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/settings-discovery-adapters.js

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/app.js
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/settings-tabs.js
- /Users/emilionunezgarcia/Job-Bored/settings-tab-schema.js

Build:
- a namespaced API under window.JobBoredSettingsDiscoveryAdapters
- ensureDiscoveryTabActive(tabApi)
- focusDiscoveryWebhookField(tabApi)
- prepareAppsScriptRemediationView(tabApi)
- prepareCloudflareRelayApplyReturn(tabApi)
- helpers that the orchestrator can call from:
  - discovery webhook focus flows
  - Apps Script remediation flows
  - Cloudflare relay apply/test flows
  - discovery test button preconditions

Constraints:
- do not move or rewrite discovery network logic
- do not edit app.js
- do not edit index.html
- do not duplicate the whole settings tab controller
- your code should assume the orchestrator passes in the active tab API

At the end, list:
- files changed
- exported adapter helpers
- exactly which app.js call sites the orchestrator should update
```

## Worker 5 Prompt: QA Checklist

```text
You are Worker 5 for the Settings Tabs refactor in the Job-Bored repo.

Read these files first:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/style.css
- /Users/emilionunezgarcia/Job-Bored/app.js

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve current behavior unless the new tab IA explicitly changes it.
- The settings UI must become real standalone tabs, not anchor links.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
Write the manual regression and QA checklist for the refactor so the orchestrator can verify behavior after integration.

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/docs/QA-SETTINGS-TABS-CHECKLIST.md

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/style.css
- /Users/emilionunezgarcia/Job-Bored/app.js

Document:
- acceptance criteria for the 6 tabs
- keyboard and screen-reader tab behavior checks
- mobile behavior checks
- checks that only one panel is visible at a time
- checks that Save & reload remains global
- checks that Setup contains onboarding reset and clear settings behavior
- checks that Discovery contains webhook status/test/Apps Script/preferences
- checks that Scraping is separate from Discovery
- checks that ATS Scoring is separate from AI Providers
- checks that provider switching still works
- checks that discovery helper flows activate Discovery before focus/remediation
- regression checks for:
  - open settings from main settings button
  - open settings from setup flow
  - open settings from sheet-access flow
  - relay/apps-script remediation paths
  - save validation routing to the correct tab

At the end, list:
- files changed
- highest-risk regressions the orchestrator should smoke test first
```
