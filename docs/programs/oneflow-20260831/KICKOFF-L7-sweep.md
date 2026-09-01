# Lane L7 — sweep (serial; runs only after L6 is merged and the floor is green)

Read GROUND-RULES.md, SUBSTRATE.md, spec §7 (the deletions table is your work order). Fence: everything §7 names, their partials/CSS/script tags/`typecheck:repo` entries, their tests, `index.html` removals, the Settings → Upgrades card (settings-modal.js + partial), `partials/discovery-drawer.html` Connection collapse.

**Mission:** Remove every surface the one-flow replaced, so the repo a stranger reads contains one onboarding, not two — with the floor green at every commit.

Work in deletion units, one commit each, floor-relevant tests updated IN the same commit:

1. **Enhancements wizard:** `enhancements-wizard-ui.js`, its mount, script tag, typecheck entry, tests. Its `more_optional` card content becomes a static "Upgrades" card in Settings (one tab section, copy from spec §7). Remove the three `*EnhancementDismissed` flags from user-content-store.
2. **Discovery gate:** `#discoverySetupGate` markup + its driver block in onboarding-wizard.js + `discoverySetupSkipped` STAYS (banner still reads it).
3. **Legacy wizards:** `first-run-wizard.js` + partial + CSS + tests; `onboarding-wizard.js` + partial + CSS + tests (celebration player already lives in `onboarding-celebration.js` — keep that file and its tests; delete the legacy stage configs and the delegating alias). `#setupScreen` markup + `revealPipelineSetupStepsScreen` path in sheet-access-setup.js (gate error mode and starter-sheet creator STAY — Beat 1 uses them).
4. **welcome.js:** delete the onboarding half (mount/RENDERERS/validateStep/persistToLegacyStores/self-test); keep `mountEmpty` + `isFirstRunEmpty`; rewrite `WELCOME.md` to document only what ships.
5. **Modal maze:** `partials/discovery-modals.html` five modals + `discovery-setup-modals.js` + tests; collapse the drawer's Connection section to the single `Open discovery setup` button per the original spec's Phase 3 (`partials/discovery-drawer.html:738-960` region).
6. **Dead elements/flags/fossils:** `#enhancementsReEntryBtn`, whats-next badges, `#onboardingWizardBtn` handler (app-bootstrap:271-281), `fitProfileOnboardingComplete` write, `pendingDiscoverySetup` plumbing (writer, never-called resumer, exports); Settings copy claiming jb-v2 "off by default" corrected; login-gate `no-oauth` OAuth sub-wizard markup (Beat 1 owns that path now).
7. **Final grep pass** (paste in report): `firstRunWizard|onboardingWizard|enhancementsWizard|discoverySetupGate|setupScreen|EnhancementDismissed|pendingDiscoverySetup` — every remaining hit justified in one line.

Rules: delete only what §7 names; anything ambiguous goes in report §5 instead of the chopping block; every commit leaves `npm test` green (run the targeted suites between commits, the full floor at the end).

## DoD
Full floor green (pasted) + the grep table. Report complete; committed locally, never pushed.

## Routed items from L6 (orchestrator, 2026-09-01 — granted edits beyond the deletion table)

8. **Collapse the draft-key alias — canonical is `profileDraft`.** B3 (`oneflow-beat-resume.js` :429, :497) writes `runtime.resumeDraft`; B4 accepts both via an alias chain L6 added. Change B3's writes to `profileDraft`, delete the alias in `oneflow-beat-fit.js`, keep every seam test green.
9. **Make the shell title show the resolved payoff headline.** `beat.headline` may be a function the controller calls with the beat context (additive change in `onboarding-flow.js` renderBeat); B6 (`oneflow-beat-payoff.js`) registers its resolver so the SHELL title reads "You're live, {actual name}." — today the literal `{firstName}` placeholder is user-visible there while only the celebration overlay resolves it. Red-first probe.
10. **Extend `showSheetAccessGate`'s ownership guard to live beats** (`sheet-access-setup.js`): the existing `firstRunWizardOwnsSurface()` guard gains the flow-owns-surface check L6 used elsewhere, so a mid-flow token expiry cannot paint the gate over a beat; on flow close, the normal gate behavior resumes unchanged.
