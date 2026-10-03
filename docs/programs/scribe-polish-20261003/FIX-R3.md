# SCRP round-3 fixes: Fable R3 (reports/VERDICT-SCRP-R3.md) plus QA-KBD-01 (reports/qa-phase2/QA-REPORT.md)

**Goal:** close every residual found by the round-3 review and the QA keyboard-only failure.
**Success means:**
- One commit per item, each with a red-first regression: `fix(scribe): R3-#N …` or `fix(scribe): KBD-01 …`.
- The full lane floor is green with `skipped 0`.
**Stop when:** every item below is done and the floor is pasted.

## Host rulings

**D24 (R3-#2).** A locked figure is atomic. An insert or replacement that touches a locked span edge is a change to the locked figure when the neighbouring inserted character is in `[\p{L}\p{N}.,%$]`.
- The client refuses it locally with the lock string.
- The server's `assertUnlocked` requires the located token not to be flanked by a digit, letter or decimal point. A violation returns `400 locked`, even with `confirmUnverified`.

**D25 (QA-KBD-01).** Document blocks are keyboard-reachable.
- After each iframe load, the parent sets `tabindex="0"` (roving, with exactly one at a time `tabindex=0` and the rest `-1`) on every eligible `[data-node]` element in `iframe.contentDocument`. These are DOM attributes, not scripts, so the sandbox and CSP are unchanged.
- When `.scribe__docscroll` or the frame receives focus, focus moves to the current block. ArrowDown and ArrowUp (also J and K inside the document) move between blocks.
- Enter or Space selects the focused block as the scope and opens `.scribe__selection-actions` with focus on its first button.
- Edit text in that toolbar enters manual edit for that block. Escape returns focus to the block, and Escape again returns to the docscroll.
- The focus-visible ring for `[data-node]:focus-visible` goes in the injected iframe CSS in `scribe-v2-diff.js`, using existing `--jb-*` focus tokens.
- Each block announces "{label}, {locked|editable}". Locked and ineligible blocks stay reachable (to hear why) but cannot be edited.

## Items

| # | Fix |
|---|---|
| R3-1 | On mount, look up the registry entries for both documents of the slug. Adopt an entry when the user reaches that document (`setDoc`), and show the restored Save/Discard prompt then. Add the cross-document case to F73. |
| R3-2 | D24, client and server. Test both edges in F42/F72 and in `tests/materials-nodes.test.mjs`. |
| R3-3 | A click that resolves to no editable block leaves the current scope unchanged (`if (!ids.length) return;`). |
| R3-4 | When a save settles for a closed controller whose manual object was adopted, hide the adopting controller's prompt and `loadDoc` it. |
| R3-5 | A zero-change blur clears the manual message unless the state is saving, confirm or conflict. |
| R3-6 | Save anyway while suggested changes are open shows "Review or discard the open changes first." and nulls `m.confirmation`. |
| R3-7 | Stay or Esc re-arms the 2-second save, and the manual state keeps saying it will save. |
| R3-8 | On a Discard 404, always drop the rejected local proposal, then render recovery for whatever GET open returns. |
| R3-9 | After `readOpen` succeeds with no proposal, clear the local unsaveable result and say "Those changes are no longer available." |
| R3-10 | `discard` cancels auto-save first. `save` returns while `ctl.discarding`. |
| R3-11 | Activating the disabled multi-block Edit text shows status "Select one block to edit its text." |
| R3-12 | No doubled "Try again". The batch line reads "Some of this text isn’t in your saved facts:" followed by the quoted replacements. |
| R3-13 | "Discarded." survives the reload (`keepStatus`). |
| KBD-01 | D25. Playwright, both documents at 1440 and 375, keyboard only: Tab to the document, ArrowDown to a block, Enter, Edit text, type, Tab out, and exactly one manual version is saved. Plus the lock and announce checks. |
