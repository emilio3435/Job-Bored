# WELCOME.md — the dashboard's first-run empty state

**Owner:** Welcome (first-run empty-state agent)
**Status:** Shipped behind `body.jb-v2`. Off-flag → the legacy `#emptyState` renders unchanged.
**Region:** `[data-region="welcome"]` inside `<!-- region:welcome:start -->` … `<!-- region:welcome:end -->` markers in `index.html`.
**Files:** `welcome.js`, `welcome.css`.

This document is the source of truth for one surface: the card a user sees
when their pipeline has nothing in it yet.

## What this file used to describe

A nine-step paced onboarding flow — its copy deck, its mascot poses, its
`jb-v2-onboarding` localStorage schema, its write-through into
`CommandCenterUserContent`, and a `?jb-v2-test=welcome` self-test. All of
it is deleted. `docs/ONE-FLOW-ONBOARDING-SPEC.md` §7 keeps exactly the
empty-state card, because onboarding is now the **one flow**
(`onboarding-flow.js` plus the six beat modules, rendered through
`discovery-wizard-shell.js`), and a second nine-step wizard behind a
feature flag was precisely the duplication that spec exists to end.

If you are looking for the onboarding flow, read
`docs/ONE-FLOW-ONBOARDING-SPEC.md`. Nothing in `welcome.js` participates in
it any more.

---

## 1. Public surface

```js
window.JobBoredWelcome = {
  boot,             // called on DOMContentLoaded; no-op unless body.jb-v2
  mountEmpty,       // render the card into a region host
  isFirstRunEmpty,  // is the legacy app currently reporting an empty pipeline?
};
```

`welcome.js` writes nothing — no localStorage, no IndexedDB, no config. It
reads the legacy app's own truth and renders a card.

---

## 2. Trigger contract

The card renders when, **and only when**, the legacy empty condition fires
(`pipelineData.length === 0 && !dataLoadFailed`). Rather than duplicate that
condition, `isFirstRunEmpty()` observes the element the legacy app writes:

- `#emptyState` has `display !== "none"` and a non-null `offsetParent`, **and**
- `#emptyStateTitle.textContent` matches `/your pipeline is empty/i`.

A `MutationObserver` on `#emptyState` plus a ~10-second polling fallback
(20 × 500 ms) handle the case where `app.js` renders the empty state after
`welcome.js` boots. Once mounted, the watcher stops.

Reading the legacy DOM rather than a new public API is deliberate:
`pipelineData` is module-scoped in `app.js`, and exposing it would cross the
region scope this file is fenced into.

---

## 3. What the card offers

Each action delegates to a control the legacy app already owns, so no input
plumbing is re-implemented here:

| Action | Delegates to |
|---|---|
| Paste a URL | focuses `#ingestUrlInput` and scrolls it into view |
| Run discovery | clicks `#discoveryBtn`, `[data-action="openDiscovery"]`, `#openDiscoveryBtn`, or `#runDiscoveryBtn` — whichever the page exposes |
| Add manually | clicks `#ingestManualModalOpenBtn` |

Three sample links (Greenhouse / Lever / Ashby) prefill `#ingestUrlInput` on
click so the user can see the input shape rather than guess it. Every action
hides the card first, so the surface it hands off to is what the user sees.

Copy, verbatim:

- Headline: “Your pipeline is empty (for now).”
- Sub: “Paste a job URL, run discovery, or add one by hand. Roles land here as soon as they exist.”

---

## 4. Accessibility

- The card is not a dialog and traps nothing — the dashboard behind it stays
  reachable. (The onboarding flow's modal containment lives in
  `discovery-wizard-shell.js`.)
- The mascot is decorative: `aria-hidden="true"`, empty `alt`.
- Sample links are `<button>`s with an `aria-label` naming the board
  (“Try a Greenhouse URL”), because their visible text is a raw URL.
- Every interactive element gets a visible focus ring via
  `--jb-shadow-focus`.
- Transitions honour `prefers-reduced-motion: reduce`.

---

## 5. Styling

`welcome.css` is token-only and entirely scoped under
`body.jb-v2 [data-region="welcome"]` — off the flag it is a no-op. It
defines the region root, the mascot frame, the two button variants the card
uses, and the empty-state block. No new tokens: every colour, radius,
shadow, and spacing value references an existing `--jb-*` token.
