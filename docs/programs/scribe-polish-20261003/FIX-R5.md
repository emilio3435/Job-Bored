# SCRP round-5 fixes (Fable verdict: reports/VERDICT-SCRP-R5.md: FAIL, 7 findings)

**Goal:** make locked figures truly atomic without blocking harmless rewrites, and close the round-5 residuals.
**Success means:** one commit per item (`fix(scribe): R5-#N …`), each with a red-first test (`SCRP-F10x` or `SCRP-B6x`). The lane floor is green with `skipped 0`.
**Stop when:** all items are done and the floor is pasted.

## Host ruling D27: supersedes D26 and D24's character rule

A locked figure is atomic by its **numeric run**.

**Normalize first.** Run both the base text and the resulting text through the same normalization (the server's `plain()`). Then classify by whole code points.

**How a run is built.** Start from the locked token's characters and extend outward one code point at a time:
- **Forward:** extend while the next code point is a letter, a digit, or one of `%`, `$`, `€`, `£`, `¥`. Also extend over `.` or `,` when the code point after it is a digit.
- **Backward:** extend while the previous code point is a letter, a digit, or one of `$`, `€`, `£`, `¥`, `%`. Also extend over `.` or `,` when the code point before it is a digit.

**What the run must do.** Every locked token's base run must appear in the result as an identical run, counted as a multiset, so two occurrences need two. The run may move anywhere in the block. It may not change.

**Where it applies.**
- Client: on the full resulting block text after every beforeinput, input and paste. Refuse with the lock string.
- Server: in `assertUnlocked`, on manual edits and AI proposals alike, with no confirmation override.

**Required regressions,** on both documents and on both client and server:

| Edit | Result |
|---|---|
| `38.` → `38.5` | blocked |
| `.38` → `1.38` | blocked |
| `38,` → `38,000,` | blocked |
| `38` → `38,000` | blocked |
| `38` → `38%` | blocked |
| `38` → `$38` | blocked |
| `Reached 38.` → `Reached 38 today.` | allowed |
| `Cut delays 38% through weekly measurement.` → `Through weekly measurement, cut delays 38%.` | allowed |
| `Processed 38 shipments.` → `Processed (38) shipments.` | allowed |
| `38%*` markup neighbour, word added elsewhere | allowed |
| A supplementary-plane digit attached to the token | blocked |
| A token appearing twice where one is changed | blocked |

## Items

| # | Fix |
|---|---|
| 1 [P1] | D27, client and server, replacing D26's single-neighbour comparison. |
| 2 [P2] | Add `.scribe__compare` to the phone hide list (`scribe-v2.css` ~287). Extend F95: with View or Compare active, the compare pane is hidden and unreachable by Tab on Chat and Versions, at 375px, for both documents. |
| 3 | Resolved by D27: moving the figure is allowed. Keep the existing writer prompt. |
| 4 [P3] | When the gate clears while the unsaved Save/Discard/Stay prompt is open, refresh the message only. Do not arm the timer. |
| 5 [P3] | Show the gate copy only when recovery finds an open request, a local proposal or a busy run. Otherwise keep "Not saved. Your text is kept." with **Try again**. |
| 6 [P3] | Cap automatic gate retries at 3. After that, fall back to "Not saved. Your text is kept." with **Try again**. |
| 7 [P3] | Resolved by D27's shared normalization. Add the `38%*` and backtick regression on the server. |
