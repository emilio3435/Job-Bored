# WELCOME.md — Phase 3 onboarding + first-run empty state

**Owner:** Welcome (Phase 3 agent)
**Status:** Phase 3 shipped behind `body.jb-v2`. Off-flag → legacy single-step onboarding card renders unchanged.
**Region:** `[data-region="welcome"]` inside `<!-- region:welcome:start -->` … `<!-- region:welcome:end -->` markers in `index.html`.

This document is the source of truth for the 9-step paced onboarding flow, the first-run empty-state card, and how both surfaces wire into existing JobBored storage.

---

## 1. Step list

| # | Title | Mascot says | Input | Validation |
|---|-------|-------------|-------|------------|
| 1 | What should we call you? | "Hi there. Let's get you set up." | text input → `name` | non-empty |
| 2 | What's the shape of your search? | "Big picture — what's the shape of your search?" | radio: Active / Casual / Coasting → `goal` | required |
| 3 | Which sources should we watch? | "Where should I look for openings?" | multi-select chips: Greenhouse / Lever / Ashby / LinkedIn / Indeed / Manual paste → `sources[]` | ≥1 |
| 4 | How should drafts sound? | "How should drafts sound when I write them?" | radio: Direct / Warm / Formal → `tone` (legacy copy reused verbatim from `index.html:1335-1360`) | required |
| 5 | What's in your stack? | "Tell me what you're great at." | comma-separated textarea → `stack` | non-empty |
| 6 | What comp range works? | "Roughly, what comp range are you targeting?" | range slider 40k–400k+ USD → `comp` | ≥40k |
| 7 | Where do you want to work? | "Where do you want to land?" | multi-select chips → `locations[]` | ≥1 |
| 8 | Connect your Google Sheet | "Last bit of plumbing — your sheet." | "Connect existing" or "Create my Pipeline sheet" — both delegate to legacy OAuth handlers (see §6) | best-effort, non-blocking |
| 9 | All set | "You're set. Here's your first daily brief!" | confirmation only | n/a |

Copy is conversational; only Step 9's confirmation copy ends with an exclamation mark, per the `HARD RULES` brief.

---

## 2. Transitions

- Step body (`.jbw-step`) cross-fades on each navigation: 280ms `cubic-bezier(0.16, 1, 0.3, 1)` (`--jb-ease`), opacity 0→1 + translateX 8px→0.
- Progress segments (`.jbw-progress__seg`) animate background + opacity at `var(--jb-transition-base)` (180ms). The current segment pulses (`jbw-pulse` keyframes, 1.6s alternate).
- Mascot transforms morph at `var(--jb-transition-slow)` (320ms).
- All animations collapse to instant under `prefers-reduced-motion: reduce`.

---

## 3. Persistence schema (localStorage)

**Key:** `jb-v2-onboarding`

```jsonc
{
  "step": 1,                      // integer 1-9
  "values": {
    "name": "",                   // step 1
    "goal": "active",             // step 2: "active" | "casual" | "coasting"
    "sources": [],                // step 3: subset of ["greenhouse","lever","ashby","linkedin","indeed","manual"]
    "tone": "warm",               // step 4: "direct" | "warm" | "formal"
    "stack": "",                  // step 5: comma list of skills
    "comp": 120000,               // step 6: USD integer
    "locations": [],              // step 7: chip labels (e.g. "Remote (US)")
    "sheetId": ""                 // step 8: populated when connect succeeds
  },
  "updatedAt": "2026-05-06T19:00:00.000Z"
}
```

State is written on every `update()` call (per-keystroke for inputs, per-click for chips/radios), and on every step navigation. On submit (step 9) the state is **also flushed to the legacy stores** below; the local `jb-v2-onboarding` key is then cleared.

### Field-key mapping (legacy stores)

| Welcome field | Legacy store / call | Notes |
|---|---|---|
| `values.tone` | `CommandCenterUserContent.savePreferences({ tone })` | Writes through to the same key the legacy `wizardPrefTone` hidden input did (see `app.js:16340`). Defaults preserved (`defaultMaxWords: 350`, etc. stay untouched). |
| `values.stack` | `CommandCenterUserContent.saveDiscoveryProfile({ targetRoles: stack })` | Same key the legacy onboarding chips wrote to (`app.js:16329`). |
| `values.locations[]` | `CommandCenterUserContent.saveDiscoveryProfile({ locations })` | Comma-joined to match the discovery webhook contract (`DEFAULT_DISCOVERY_PROFILE.locations` is a string in `user-content-store.js:182`). |
| `values.name`, `values.goal`, `values.sources[]`, `values.comp` | `CommandCenterUserContent.saveAdditionalContext({ text })` | Aggregated into a single human-readable blob, the same surface legacy onboarding used for "Superpower / Avoid / pasted summary". |
| `values.sheetId` | Delegated — legacy `JobBored.getSheetId()` / `#setupCreateStarterSheetBtn` own the canonical write. We never persist a sheet id ourselves. |
| _(completion flag)_ | `CommandCenterUserContent.completeOnboarding()` → IndexedDB `onboardingComplete = true` | Same call `app.js:16347` makes. |

After persistence we also click any `[data-action="completeOnboarding"]` element if present (none currently exists in the legacy markup; the call-site is `app.js:16347` as a function). The bridge logs an info message in that case so the contract stays observable.

---

## 4. Mascot variant strategy

Per `docs/redesign/mascot-review.md`, no SVG edits are approved yet. Welcome therefore uses the same `jobbored.svg` for every step and varies it only with **safe CSS transforms** plus subtle stage-token-driven accents:

| Step | Transform | Intent |
|---|---|---|
| 1 | `rotate(0)` | Identity / "hello" — neutral pose. |
| 2 | `rotate(-4deg) translateY(-2px)` | Looking up at the question. |
| 3 | `rotate(3deg) translateY(-1px)` | Looking out (sources are "out there"). |
| 4 | `rotate(-2deg)` | Half-listening — tone choice. |
| 5 | `rotate(4deg) translateY(-3px)` | "Tell me about it." |
| 6 | `rotate(-3deg)` | Considering numbers. |
| 7 | `rotate(2deg) translateY(-1px)` | Watching the map. |
| 8 | `scaleX(-1) rotate(-2deg)` | **Mirrored** — facing the sheet, plumbing pose. |
| 9 | `rotate(5deg) translateY(-4px)` + amber drop-shadow filter | Celebratory — only step that uses an accent shadow, only step where the say-line ends with `!`. |

`--jb-stage-*` tokens drive the implicit accent palette per step via `accent-color` / button hover hues; we did not add any new tokens.

When a future SVG variant set ships (tired / excited / curious face), swapping the `<img src>` per step is a 3-line patch — the transform layer remains.

---

## 5. Empty-state contract

Triggered when, **and only when**, the legacy condition fires: `pipelineData.length === 0 && !dataLoadFailed`. We reuse the legacy signal by observing the legacy `#emptyState` element:

- `display !== "none"` AND
- `#emptyStateTitle.textContent` matches `/your pipeline is empty/i` (the legacy title written in `app.js:12325`).

A `MutationObserver` on `#emptyState` plus a 10-second polling fallback handle the case where `app.js` renders the empty state after `welcome.js` boots.

The empty card surfaces three actions, each delegating to the existing legacy controls so we never re-implement input plumbing:

| Action | Delegates to |
|---|---|
| Paste a URL | focuses `#ingestUrlInput` and scrolls it into view |
| Run discovery | clicks `[data-action="openDiscovery"]`, `#openDiscoveryBtn`, or `#runDiscoveryBtn` (whichever the legacy app exposes) |
| Add manually | clicks `#ingestManualModalOpenBtn` (the existing legacy button that opens the manual-add modal) |

Three example cards (Greenhouse / Lever / Ashby) prefill `#ingestUrlInput` on click so the user understands the input shape.

---

## 6. OAuth / sheet-connect (Step 8) — read-only proxy

Step 8 must NOT reimplement OAuth. It exposes two buttons that delegate to existing surfaces:

- **Connect existing sheet** — checks `window.JobBored.getSheetId()`; if absent, clicks any of `#setupShowGate` / `#openSheetGateBtn` (the legacy "Open sheet" gate) and lets the legacy gate complete the flow.
- **Create my Pipeline sheet** — clicks the existing `#setupCreateStarterSheetBtn` (`index.html:91`) which is wired to `app.js`'s starter-sheet creator.

Step 8's validation is **non-blocking**: if neither path completes synchronously, the user can still proceed to Step 9. The completion flag is set independently of the sheet write so users on a stale auth state aren't trapped in onboarding.

---

## 7. Interactions

- **Enter** → advance (suppressed inside `<textarea>` so newlines work).
- **Esc** → if progress > 25% (i.e. user is past Step 3) open a confirm dialog; otherwise close immediately. Confirm dialog buttons: "Stay" (dismisses) and "Leave" (closes + clears `jb-v2-onboarding`).
- **Back** is disabled on Step 1 only; otherwise always available.
- **Refresh mid-flow** → state is read on mount, so the user lands back on the saved step with prior values intact.
- **Autofocus** — first input/button of the step takes focus 40ms after paint (with `preventScroll`), so keyboard-first users never have to hunt.

---

## 8. Self-test

Activate by appending `?jb-v2-test=welcome` to the URL while `body.jb-v2` is on (e.g. `?jb-v2=1&jb-v2-test=welcome`). The harness boots normally, then runs three assertions ~600ms after mount and logs results to the console:

```
[welcome.test] ✓ step-5 restoration data-step=5
[welcome.test] ✓ name restored value=Avery
[welcome.test] ✓ esc confirm dialog opens rendered
[welcome.test] ✓ step-9 submit no data-action present (no-op logged)
[welcome.test] DONE [...]
```

What's covered:

1. **Refresh-mid-flow** — seeds state to step 5 with prior values, re-mounts, asserts `data-step="5"` on the region and that the name input is restored.
2. **Esc on step 6 → confirm dialog** — sets state to step 6, opens the confirm dialog programmatically, asserts the `.jbw-dialog` is rendered, then dismisses via "Stay".
3. **Step 9 submit** — sets state to step 9, calls `_advance()`. If a `[data-action="completeOnboarding"]` element exists in the page it asserts the click fired; otherwise it asserts the no-op log path (which is the legacy contract — `app.js:16347` calls `UC.completeOnboarding()` directly without a data-action attribute).

Failures log via `console.error` with the `[welcome.test]` prefix so they show up immediately in the dev-tools console and are easy to grep.

---

## 9. Accessibility checklist (manual, axe-core ready)

- Region root is `role="dialog"` (in onboarding mode) with `aria-modal` and `aria-labelledby` to the step title.
- Progress strip is `role="progressbar"` with `aria-valuemin/max/now`.
- Radio groups are `role="radiogroup"`, options are `role="radio"` with `aria-checked`.
- Multi-select chips are buttons with `aria-pressed`.
- Mascot is purely decorative (`aria-hidden="true"`); the say-line carries the cue and is `aria-live="polite"`.
- Field errors live in an `aria-live="polite"` container directly below the slot.
- All interactive elements have visible focus rings via `--jb-shadow-focus`.
- Reduced-motion: every transition / animation collapses to instant under `prefers-reduced-motion: reduce` (squiggle, progress pulse, slot transition, mascot transform).

---

## 10. Defensible choices made without conductor input

- **`comp` stored as USD integer** rather than a `{ min, max }` range — the brief said "Comp range — slider (USD)" and the legacy schema has no `compRange` key; a single target keeps the discovery-profile contract untouched.
- **`locations` stored as comma-joined string in the legacy `discoveryProfile.locations`** because that field is a string in `DEFAULT_DISCOVERY_PROFILE` (`user-content-store.js:184`). The Welcome state still keeps the array form locally for chip-state rehydration.
- **Sheet-connect proxy is non-blocking** so the user is never trapped if their OAuth has lapsed. Sheet writes happen via the existing legacy buttons.
- **Empty-state detection by DOM observation**, not a new public API — the legacy `pipelineData` is module-scoped and exposing it crosses the region scope.
- **No new tokens introduced.** Every color/radius/shadow/spacing references an existing `--jb-*` token; the lint passes.
