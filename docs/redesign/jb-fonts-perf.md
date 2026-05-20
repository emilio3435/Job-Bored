# jb-fonts-perf.md — JobBored v2 font perf report

**Owner:** Quill (Phase 2 typography agent)
**Status:** verified.

## Canonical URL

```
https://fonts.googleapis.com/css2?family=Caveat:wght@500;600;700&family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap
```

## Methodology note

Google Fonts ships **variable fonts** for all three families. With a modern Chrome UA, the CSS slices each family by **unicode-range subset** (latin, latin-ext, cyrillic, cyrillic-ext, greek, vietnamese), but **every requested weight points at the same woff2 URL per subset**. So adding/removing weights does not change byte cost — only adding/removing subsets (or families) does. Dropping Geist 300 or 700 saves nothing.

The browser only downloads subsets whose `unicode-range` matches glyphs actually rendered. For an English-language UI, **only the latin subset loads**. The table below reports the realistic latin-only payload.

## Per-family bytes table (latin subset only — what users actually download)

| Family | Weights served | Bytes (latin .woff2) |
|---|---|---|
| Caveat | 500, 600, 700 (one variable file) | 74,572 |
| Geist | 300, 400, 500, 600, 700 (one variable file) | 28,388 |
| JetBrains Mono | 400, 500, 600 (one variable file) | 31,340 |
| **Total (latin)** | | **134,300 B ≈ 131.2 KB** |

All-subsets total (latin + latin-ext + cyrillic + cyrillic-ext + greek + vietnamese): **348,732 B ≈ 340.6 KB**. Only triggered if rendered text contains glyphs in those ranges.

## Total + budget

**131.2 KB / 180 KB ✓** — under budget. No weights need to be dropped. Trimming weights would not save bytes anyway because Google serves a single variable woff2 per subset.

## Preload recommendations

Add these two `<link rel="preload">` tags **above** the stylesheet `<link>` in `index.html`:

```html
<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous"
  href="https://fonts.gstatic.com/s/geist/v4/gyByhwUxId8gMEwcGFWNOITd.woff2">
<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous"
  href="https://fonts.gstatic.com/s/caveat/v23/Wnz6HAc5bAfYB2Q7ZjYYiAzcPA.woff2">
```

These are the **latin** woff2 URLs for Geist (covers 300–700) and Caveat (covers 500–700). Because Google serves one variable file across all weights, preloading these two URLs warms the cache for every Geist body weight and every Caveat handwritten weight in one shot.

⚠️ Google occasionally rotates these URLs when font versions bump (`/v4/`, `/v23/`). If a future audit shows a 404 on these preloads, regenerate by re-running the curl. Recommend a quarterly recheck.

JetBrains Mono is intentionally **not** preloaded — code-style monospace usage is rare in JobBored chrome and FOUT on tertiary type is acceptable.

## Note on duplication with jb-v2.css

Atlas added an `@import` for the same Google Fonts URL inside `jb-v2.css` (line 17). **Recommendation: REMOVE that `@import`** when adding the `<link>` to `index.html`.

Reasoning:
- A `<link>` in `<head>` is discovered by the preload scanner immediately during HTML parsing and starts the network fetch in parallel with CSS parsing.
- An `@import` inside a stylesheet is only discovered after the parent CSS has been downloaded and parsed, serializing the request chain (HTML → jb-v2.css → fonts.googleapis.com → fonts.gstatic.com). On a cold load this typically adds 100–300 ms of blocking time before any text can paint with the right font.

**Action taken:** Quill removed the `@import` from `jb-v2.css` and added the `<link rel="stylesheet">` to `index.html`. The legacy fonts link (DM Sans / Lora / Source Sans 3 / JetBrains Mono) is also preserved so the legacy UI renders pixel-identically when `body.jb-v2` is absent. JetBrains Mono is dropped from the new v2 link to avoid duplicate-font requests since the legacy link already loads it.

## Recommendation for `font-display`

`&display=swap` is in the canonical URL ✓ — every `@font-face` in the fetched CSS includes `font-display: swap;`. Text renders immediately in the system fallback and swaps to the web font once available. No FOIT.
