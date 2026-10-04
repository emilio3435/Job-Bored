# SCRP round-7 fixes (Fable verdict: reports/VERDICT-SCRP-R7.md — FAIL; Emilio ruled D29 on 2026-10-03)

**Goal:** close locked-figure safety structurally and fix two data-loss bugs in the save path.

**Success means:**
- One commit per item (`fix(scribe): R7-#N …`) with a red-first test (`SCRP-F12x` or `SCRP-B8x`).
- The lane floor is green with `skipped 0`.

**Stop when:** all items are done and the floor is pasted.

## Ruling D29 (Emilio, 2026-10-03): direct typing never touches a block that holds a locked figure

D29 supersedes D24, D26, D27 and D28 for manual edits.

**Client.**
- A block with any locked span or whole lock cannot enter manual editing. This applies to double-click, Edit text and the keyboard.
- Edit text in the selection toolbar is `aria-disabled`.
- Activating it shows the status "This line has locked figures. Ask Scribe to change it." and focuses the composer, with the block's scope kept.
- The block's keyboard announcement says "locked".
- Blocks without locks keep full manual editing, including the new-fact confirmation.

**Server.**
- `POST …/edits/manual` rejects any op whose node has locked spans or a whole lock, with `400 locked`, even when `confirmUnverified` is set.

**AI path.**
- The server keeps the D28 run check for AI proposals, hardened: build the run set from classes, not literals. Use `\p{Pd}` (all dashes, including in the sign test and the trailing trim), `\p{Sc}` (all currency), `\p{Sm}` (math), the percent family `% ‰ ‱ ٪ ％ ﹪`, and the separators `. , ' ’ ‘ ´ · ٫ ٬ ． ，`.
- A gap made of **any** whitespace run (`\s`, `\p{Zs}`, U+2028, U+2029) bridges the run when the next non-space token is a digit, a run-set character, or one of these scale or sign words (case-insensitive, whole word): `k`, `m`, `b`, `bn`, `mm`, `million`, `billion`, `thousand`, `hundred`, `dozen`, `percent`, `per cent`, `pct`, `times`.
- The same bridging applies before the figure for `minus` and `negative`.
- Blocking a harmless AI rewrite is acceptable.

## Items

| # | Fix |
|---|---|
| D29-client | Block manual editing on locked blocks, with the status and composer focus described above. Tests on both documents: résumé metric line and letter metric paragraph, via double-click, Edit text and the keyboard path. |
| D29-server | Manual ops on locked nodes return `400 locked`, even when confirmed. Integration test on both documents. |
| AI-hardening | Class-based runs plus whitespace and scale-word bridging for AI ops. Add regressions for every R7 group A–E row from `reports/VERDICT-SCRP-R7.md`: the server blocks the AI op. Keep `Reached 38.` → `Reached 38 today.` and the figure-move case allowed. |
| R7-#4 [P2] | Stop deleting `~` at save. Restore the paired-markup-only strip in storage `plain()`, and keep the lock-check strip set separate. Also move `~` from the lock strip set into the run set, so `~40%` can be neither created nor lost. Test: "Cut costs ~40% …" keeps `~` after an unrelated edit, on both documents. |
| R7-#6 [P2, pre-existing] | Saving must not delete ordinary text between `<` and `>` (see finding 6 in the R7 verdict for the exact path). Plain-text manual edits keep literal `<`/`>` text, which is escaped at render. Add a test on both documents. |
| R7-#7–#14 | **Do not fix** unless a fix is a one-line change made while already touching that code. They are documented as follow-ups in ISSUE-LEDGER by the host. |
