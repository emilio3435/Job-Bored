# SCRP round-6 fixes (Astra verdict: reports/VERDICT-SCRP-R6.md, FAIL, 7 findings)

**Goal:** finish locked-figure safety with a conservative rule and close the save-gate residuals.

**Success means:**
- One commit per item (`fix(scribe): R6-#N …`).
- Each commit has a red-first test (`SCRP-F11x` or `SCRP-B7x`).
- The lane floor is green with `skipped 0`.

**Stop when:** all items are done and the floor is pasted.

## Host ruling D28 (supersedes D27's run definition)

When it is unclear whether an edit changes a figure, protect the figure. Blocking a harmless edit is acceptable; changing a figure is not.

**Normalization for lock checks.** Apply NFC, then remove only markdown markup characters (`*`, `_`, `` ` ``, `~`). Do not strip list enumerators, digits or any other text. Use exactly the same function on the client and on the server.

**The figure run of a locked token.** Start at the token and extend in both directions over:
1. Letters and numbers of any script: `\p{L}`, `\p{N}`, including `\p{Nd}` in every script.
2. Combining marks (`\p{M}`) and format characters (`\p{Cf}`, which includes zero-width characters).
3. These characters: `. , % ‰ $ € £ ¥ + - − – — / : × x ^ '`.
4. One space (U+0020, U+00A0 or U+202F) when the next code point is a digit, `%` or `‰`. This covers grouped thousands and a spaced percent.
5. One space when the previous code point is a sign (`+ - −`) and the code point after the space is a digit.

Then trim trailing characters from the run while it ends in one of `. , : ; – — - /` and that character is not followed by a digit. This keeps sentence punctuation outside the run.

**Matching.** Group all locked spans that fall inside the same base run into one run. Each distinct base run must appear in the result as an identical run, matched as a multiset. A run may move anywhere in the block, but it may not change.

**Locks for non-ASCII digits.** Cover-letter lock discovery (the `NUMBER` pattern in `server/materials-nodes.mjs`) must also recognise Unicode decimal digits (`\p{Nd}`).

**Regressions required, on both documents, client and server.** Each case below must be blocked:
- `38` → `.38`
- `38` → `-38`
- `38` → `- 38`
- `38` → `38 000` (with a plain space and with NBSP)
- `38` → `38 %`
- `38` → `38–40`
- `38` → `38​0`
- `３８` → `３９` (cover letter)
- `٣٨` → `٣٩` (cover letter)

Each case below must be allowed:
- `Processed 38x40 sheets.` → `We processed 38x40 sheets.` (locks `38` and `40`)
- `38. Shipments processed.` → `38. All shipments processed.`
- `Reached 38.` → `Reached 38 today.`
- Moving the figure to another position in the block
- `USD 38` → `USD 38 total`

## Items

| # | Fix |
|---|---|
| 1 [P1] | D28 figure runs, implemented on the client and the server. |
| 2 [P2] | D28 grouping of spans that share a run. |
| 3 [P2] | Every automatic save path is limited to the 3-retry gate budget, including focus and blur. The budget resets only on changed text or an explicit Save or Try again. |
| 4 [P3] | When recovery has armed a timer, keep the scheduled-save status: "Your text is kept. Saves in 2 seconds." with **Save**. Show the failure and **Try again** only after automatic recovery has stopped. |
| 5 [P2] | Cover-letter lock discovery recognises Unicode decimal digits, per D28. |
| 6 [P3] | Covered by D28's normalization, which no longer strips enumerators. Add a regression. |
| 7 [P3] | On a phone, keep the stage line visible on Chat and Versions while it holds an actionable manual-save status (Save or Try again), not only while Stop is present. Add a 375px browser assertion. |
