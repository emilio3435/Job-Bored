# KICKOFF — lane B `beat3-drafts` (claim ids B1–B4)

Read `GROUND-RULES.md`, then `GREENFIELD-SPEC.md` §1 F2, §3 items 1–2, §4.2, §5 item 7. Create `LANE-REPORT-beat3-drafts.md` before anything else.

## Mission
A resume pasted into Beat 3 survives Escape, reload, and a close mid-debounce, whether the text arrived by typing, by paste, or by a programmatic value set. The draft is mirrored synchronously to localStorage so no unload window can lose it, and the flow's reset path is the only thing that clears it.

## Fence (you own exactly these)
- `onboarding-flow.js`: `saveDraft`, `flushDrafts`, `handleShellClose`, the `root` export block (add `flushDrafts`), and a new one-time `pagehide` registration where the shell opens. Nothing in `open`/`goToBeat`/`completeBeat`/`resolveEntryBeatId` — lane A owns those and is adding a gate there.
- `oneflow-beat-resume.js`: `hydrateFromDrafts`, the paste textarea block inside its render helper (the `input` listener at ~`:364-367`), new `writePasteMirror` / `readPasteMirror` helpers beside `hydrateFromDrafts`. Nothing in `verifiedProviderConfig` or `draftOnServer` — lane A.
- `user-content-store.js`: `clearOnboardingFlowState` only (clear the mirror there).
- New tests: `tests/greenfield-b-draft-mirror.test.mjs`; one Playwright spec `tests/e2e-visual/greenfield-b3-reload.spec.mjs` (mirror the structure of `tests/oneflow-sb2-draft-persistence.test.mjs` `SB2-FIT-RELOAD` at `:259` and `tests/e2e-visual/finale-burst.spec.mjs`).

## Claims (red first)
- **B1 · every path saves.** `input`, `change`, and `paste` on `#oneFlowResumePaste` each call `saveDraft("resumeText", …)`; the localStorage key `jb_oneflow_draft_resumeText` holds `{ text, at }` synchronously after the event, before the 400 ms debounce fires.
- **B2 · unload flushes.** `handleShellClose` awaits `flushDrafts()` before the pause toast; a `pagehide` event calls `flushDrafts()`; `root.flushDrafts` is a function.
- **B3 · hydrate prefers the mirror.** With IndexedDB `drafts.resumeText` empty and the mirror holding text, the textarea renders the mirror text; with both present, the mirror wins; `clearOnboardingFlowState` removes the key.
- **B4 · real browser.** Playwright, greenfield: reach Beat 3, put 400+ chars into `#oneFlowResumePaste` via `locator.type()`, Escape, wait for the toast, `page.reload()`, assert the same beat and the same value. Repeat with `locator.fill()`. Both green.

## Non-negotiables
- Key name, value shape, cap, and clearing rule exactly as §4.2.
- Do not touch the draft-landed path (`profileDraft` save) — stale mirror text after a successful draft is harmless because hydrate only fills an empty textarea.
- Reduced-motion trap from the ground rules applies to B4.

## Definition of Done
- B1–B4 red output pasted, then green.
- Full floor pasted. Commit locally, never push.
