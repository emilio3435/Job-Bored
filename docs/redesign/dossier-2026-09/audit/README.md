# Dossier layout audit

Two scripts. The first proves the bug against the shipped dossier; the second holds the proposal to
the same standard. Both need only the repo's own dev dependencies (`npm ci`) plus a Playwright
Chromium (`npx playwright install chromium`).

```bash
node docs/redesign/dossier-2026-09/audit/measure.mjs      # shipped  → RESULTS.json  + before-*.png
node docs/redesign/dossier-2026-09/audit/shoot-mocks.mjs  # proposal → MOCK-AUDIT.json + after-*.png
```

## Why a browser and not jsdom

The failure this audit exists to catch is a grid track resolving to 12.3px. Layout is the whole
finding, so it needs a real layout engine. Eleven root test files make 166 assertions about the
dossier's markup and CSS text and every one of them passed while the surface was unusable — that gap
is the point.

## `measure.mjs` — the shipped layout

[`current-3col-probe.html`](current-3col-probe.html) loads production `style.css`, `tokens-v2.css`,
`jb-v2.css`, `role.css` and `role-case.css`, then calls the production
`JobBoredCase.model.buildCaseModel` and `JobBoredCase.render` with an injected dep bag. Nothing about
the layout is re-implemented. The one transcription is the materials rows: `role-materials.js` cannot
boot without the profile API and the manifest poller, so [`fixture-3e.js`](fixture-3e.js) emits the
same markup its `renderCaseRows()` does, and says so at the call site.

The fixture is 3E · AI & Marketing Analytics Manager at realistic content lengths. That matters: a
fixture of short strings would prove nothing, because the claim under test is that the layout cannot
hold real content. Variants: `default`, `materials-drafting`, `materials-failed`, `long-title`,
`loading`, `no-resume` — pass one with `?variant=` when opening the probe by hand.

Widths: 1024 (the last width above the shipped `max-width: 1080px` media query) and 1280 / 1440 /
1512 (the dogfood band from the brief).

### Fields in `RESULTS.json`

| Field | Meaning |
| --- | --- |
| `frame.caseWidth` | The rendered dossier frame |
| `frame.siblingRegionWidth` | What `--jb-flow-content-width` yields when applied at top level, i.e. what the pipeline gets at the same viewport. The gap between these two is the double-gutter bug |
| `frame.unusedViewportPx` | Viewport width the dossier does not use |
| `lanes[].contentWidth` | Text measure inside one lane, after padding |
| `masthead.truncatedPx` | Title characters unreachable inside the `<input>` |
| `materials[].nameColPx` / `.labelLines` | The crush, per row. `12.3px` over `9` lines is the headline |
| `laneHeights[].height` vs `.inkHeight` | Grid stretch vs. actual content — the ragged-bottom measurement |
| `findings.escapes` | Ink crossing the `.case` content box, which `overflow: hidden` clips |
| `findings.selfOverflow` | `scrollWidth > clientWidth` with no scroller |
| `findings.columnBleed` | Ink crossing out of its own lane onto the neighbour |
| `findings.noise` | Deliberately excluded: 1px visually-hidden boxes and the `::after` hit-target expanders, which are meant to exceed their box |

`escapes` is **0** at every width. That is not the audit failing to find anything — it is the
finding. See [TEARDOWN §1](../TEARDOWN.md#1-the-headline-it-does-not-overflow-it-crushes).

`PROBE_PAINT=1` re-shoots each still with overflow highlighting (`html.probe-paint`). Not committed,
because with zero escapes it highlights almost nothing.

## `shoot-mocks.mjs` — the proposal

Runs the same overflow walk against the mocks, and adds a check the before-audit has no use for:

- **`shredded`** — any label rendering over 3 lines at fewer than 6 characters per line. That is the
  signature of a track that went below its floor, and it is what the shipped layout produces without
  ever overflowing.

It also records `frameOverflowX` and `docketPosition`, because the two most consequential properties
in the redesign are that the frame is **not** a scroll container and that the docket therefore
actually sticks.

This check has already caught a real bug in the proposal: the metric tile key row overflowed by up to
35px at 348px until it was allowed to wrap. That is the reason to have it.

Current result: clean at 1560 / 1400 / 1000 / 800 / 470px viewports (frames 1220 / 1220 / 900 / 720 /
390).

## Screenshots

Written to [`../screenshots/`](../screenshots/). Full dossier stills ship at 1x — which is exactly
what the dogfooder sees — and only crops go to 2x, where type detail is the point. The set is
allowlisted past the repo's blanket `*.png` ignore because for a redesign package the pictures are
the deliverable.
