# SCRP round-4 fixes (Astra verdict: reports/VERDICT-SCRP-R4.md, FAIL, 5 findings)

**Goal:** close the last locked-figure gap and the four keyboard and manual-save residuals.

**Success means:**
- One commit per finding, named `fix(scribe): R4-#N …`.
- Each commit has a red-first test, named `SCRP-F9x` or `SCRP-B5x`.
- The full lane floor is green with `skipped 0`.

**Stop when:** all five are done and the floor is pasted.

## Host ruling D26 (supersedes D24's character list)

A locked figure is atomic by **adjacency equality**. After any edit to a block (insert, delete, replace or paste), each locked token must still appear at its tracked span. The single code point immediately before it and the single code point immediately after it must also equal the corresponding code points in the base text. "No neighbour" counts as a value, so a token at the start or end of the block stays there.

- **Classify by whole code points.** Never classify by UTF-16 fragments.
- **Client:** run the check on the *resulting full block text* after every `beforeinput` and every input mutation. Do not inspect only the inserted characters. On failure, refuse the change and show the lock string.
- **Server:** `assertUnlocked` (in `server/materials-nodes.mjs`) applies the same adjacency-equality rule against the base node text. A violation returns `400 locked`, even with `confirmUnverified`.
- **Required regressions:** cover each of the following, both edges, on both documents.
  - Insert `,000` and then delete the space.
  - `38` → `38%`.
  - `38` → `$38`.
  - `38` → `38,000`.
  - A supplementary-plane digit introduced through a shared-high-surrogate replacement.
  - Deleting the character before a token at the start of a block.

## Items

| # | Fix |
|---|---|
| 1 [P1] | D26, client and server. |
| 2 | ArrowUp and ArrowDown always navigate blocks when a block has focus. J and K defer to review only while a proposal is open. Add a test with a proposal open. |
| 3 | A manual save gated by `materials_pending` keeps an explicit **Save** (or **Try again**) action. Once recovery shows the gate has cleared (the other request is discarded or saved), re-arm the pending save and refresh the message. Never leave text that refers to changes that are already gone. |
| 4 | The adopted-save failure path also resolves the adopting controller and shows its conflict, confirmation or retry controls. |
| 5 | Covered by D26: classify by whole code points. Add a test for the shared-high-surrogate case. |
