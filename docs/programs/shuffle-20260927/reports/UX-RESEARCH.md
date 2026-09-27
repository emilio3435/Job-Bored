# Lead Shuffle: UX research (Opus agent, 2026-09-27)

Grounded in DESIGN.md: one navy primary (`--jb-action`); mint text on `--jb-on-accent`; no sentence below 13px; 11px mono caps labels; motion 120 / 200 / 320 ms; 2px navy focus ring.

**Thesis.** Build a triage queue with a weighted "surprise" slot, not a Tinder deck. Swipe decks are fast but breed a rejection mindset. Superhuman- and Linear-style triage keeps the speed and adds reversibility and context. Randomness widens what you see and never hides the top leads.

## 1. Patterns to borrow
- **Hinge's single "Most Compatible" pick:** a curated standout sits above the stream. Jobr's swipe-for-jobs logged 100M+ swipes before Monster bought it (TechCrunch 2016).
- **Superhuman and Linear triage:**
  - one key per action;
  - Linear's snooze returns an item at a set time *or on new activity*. Here that means "until the salary is posted or the listing changes".
- **Spotify shuffle dithering:** pure Fisher-Yates felt non-random, so Spotify spaces out the same artist (Spotify Engineering, 2025). Do the same by company and by board.
- **Algolia faceted search:**
  - live facet counts;
  - highlighted matches;
  - typo tolerance;
  - a facet tray on mobile.
- **Speed without addiction:**
  - one key per action;
  - every action undoable;
  - a queue that ends ("You're through today's 23").

## 2. Randomizer UX
- **Weights:** fit² weighting, with about 1 in 6 draws a labelled **wildcard** (fit 5–6, outside usual titles or companies).
- **Pinned top slot:** the best unseen lead with fit ≥ 8 is always card 1. Randomness fills slot 2 onward.
- **No-repeat window:** within a session. The same company never appears twice within 5 cards.
- **Visible seed and pool:** a mono label such as `SEED 4F2A · 212 IN POOL`. Seeded decks are reproducible.
- **One reason line per card:** from the fit assessment, or from behaviour ("Like Ramp, which you saved Tuesday").
- **Filter chips narrow the pool:**
  - the live count is announced politely ("212 → 38");
  - each chip shows its count before it is applied.
- **Low pool** (under 5): "Only 3 match. Loosen *salary ≥ 180k* → 41". **Empty pool:** show the next snoozed lead and the next run time.
- **Freshness:**
  - a `NEW` tag since the last visit;
  - an "expiring soon" mark at 21 days or more;
  - a header line: "14 new since Thursday · next discovery run 6:00".

## 3. Search UX
- **One field, two modes.** Typing turns the deck into ranked results; Esc returns to the same card and seed. Search is an overlay on the shuffle state.
- **Matching:** instant and typo-tolerant, over title, company, location and assessment prose. Hits are marked with `<mark>` (mint + `--jb-on-accent`).
- **Operators, recognised quietly:** `company:`, `remote`, `fit:8+`, `-contract`. Each becomes a chip.
- **Suggestions:** the last 5 searches, plus suggestions drawn from saved titles.
- **Scope:** search runs inside the current filters, with "search all leads" as the escape hatch.

## 4. Actions, keyboard, accessibility
- **Actions:**
  - **Save** (to the Pipeline);
  - **Pass**, with an optional reason chip: salary, location, seniority, not interested;
  - **Snooze** (3 days, or until the lead changes);
  - **Open** (The Case);
  - **Draft**.
- **Keys, scoped to the deck region only:**

  | Key | Action |
  |---|---|
  | `j` / `k` | Next / previous |
  | `s` | Save |
  | `x` | Pass |
  | `h` | Snooze |
  | `o` / Enter | Open |
  | `d` | Draft |
  | `r` | Reshuffle |
  | `/` | Search |
  | `z` or Cmd+Z | Undo |
  | `?` | Help |

  Space is not bound (WCAG 2.1.4).
- **Undo:** a multi-step stack. The toast lasts at least 6 s and stays open while hovered or focused. A "Passed" drawer lets a pass be recovered at any time.
- **Mobile swipe is an accelerator only.** The buttons always stay visible (NN/g contextual swipe; WCAG 2.5.1 / 2.5.7). The swipe commits at 40% of the width and springs back below that.
- **Reduced motion:** a 120 ms crossfade. Otherwise the card exits in 200 ms and the next enters in 320 ms.
- **Screen readers:**
  - each card is a region, "Lead 4 of 38";
  - a polite live region announces "Saved Ramp, Senior GTM Engineer. Next: Linear, fit 8";
  - focus stays on the card.

## 5. Layout
- **1440 px:**
  - left rail (~260 px): filters, pool count, freshness, recent searches;
  - centre (~640 px): search, the hero card, then the action bar (Pass · Snooze · **Save** · Open · Draft) with key hints;
  - right (~380 px): "Up next" (3 compact cards) and a tally ("12 reviewed · 3 saved", never a streak).
- **390 px:**
  - sticky top bar: search, Filters with a pool badge, and shuffle;
  - full-width card;
  - sticky bottom bar of 5 targets, each ≥ 44 px, with Save on the right;
  - a bottom-sheet filter tray.
- **Hero card, readable in under 5 seconds:**
  1. the fit numeral **with its one-line reason beside it**;
  2. title and company;
  3. salary, remote and seniority chips;
  4. freshness and board;
  5. match score, as secondary.

  The full prose sits behind "Why this fit ▸".

## 6. Anti-patterns
- **Rejection mindset.** Acceptance odds fell 27% from the first choice to the last as people swiped (Pronk & Denissen 2020, SAGE). Mitigations:
  - finite batches;
  - a pass-velocity nudge (5 passes in under 15 s);
  - the reason is visible before Pass.
- **No gamification of emptying the queue:** no streaks and no confetti. Celebrate saves and applications instead.
- **Pass is soft, never a delete.**
- **"Sort by fit"** turns randomness off entirely.

## Ranked recommendations
1. Pin the best unseen lead (fit ≥ 8) as card 1, and weight later draws by fit.
2. Put the fit reason first on the hero card, with salary, remote and seniority as chips.
3. Make passes reversible: a multi-step undo, a toast of at least 6 s, and a Passed drawer. Never hard-delete.
4. Keep the buttons always visible; swipe is a mobile accelerator only, with a 40% threshold.
5. Show live pool counts on chips, offer "loosen X → N", and dither by company and board.
6. Scope keys to the deck (`j k s x h o d r / z ?`), with `r` to reshuffle and never Space.
7. Make search an overlay: instant, highlighted, with silent operators that become chips. Esc returns to the same card and seed.
8. Use finite batches and freshness signals, never an endless feed: about 1 in 6 wildcards, a pass-velocity nudge, and no streaks.

**Sources:**
- TechCrunch, Jobr (2016)
- SwipeStats, Hinge
- Superhuman blog, split inbox
- Linear docs, Triage
- Spotify Engineering, shuffle (2025)
- Algolia UX blog: faceted search, highlighting, mobile
- W3C WCAG 2.1.4, 2.5.1, 2.5.7
- NN/g, contextual swipe
- Sara Soueidan and Erik Kroes, on toasts
- Pronk & Denissen (2020, SAGE)
