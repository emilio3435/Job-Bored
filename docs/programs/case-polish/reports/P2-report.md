# LANE-REPORT-P2 — wiring-truth

Branch `feat/polish-2`, cut from `feat/case-polish` @ 8975312. Four commits, nothing pushed.

## What shipped

Every item in the P2 row of the plan table is done, test-first, one commit per group.

| Spec id | State | Commit | What changed |
|---|---|---|---|
| P0-1 Enter on chips | done | `71d7af4` | `role.js` binds the Enter/Escape handler only to `INPUT`/`TEXTAREA`; the Replied `<button>`s commit through the click walker, so Enter's default action (a click) is no longer cancelled. |
| P0-3 optimistic `aria-pressed` | done | `71d7af4` | `paintReplyChoice()` moves `aria-pressed` and `case__seg-b--on` in the click handler, before dispatch. A later render repaints the same truth. |
| P0-4 phase words, retry above 1 | done | `cc97df0` | `phaseWords()` maps the state-machine enum to plain words on the compact row (`rendering_pdf` → `polishing the PDFs`); the count renders as `retry N` only above 1. |
| P2-5 `couldn't finish` + retry/dismiss | done | `cc97df0` | A `failed` row states `couldn't finish` and carries the same Dismiss / Try again pair (`materials-dismiss` / `materials-retry`, keyed by the pending feature) the legacy panel always paired with FAILED. |
| P2-6 empty-state invitation | done | `cc97df0` | The Case empty hint is now "Nothing written for this role yet — use Draft cover letter or Tailor resume above to start one." No "on disk". |
| P1-0e error styling hook | done | `cc97df0` | `renderCaseHint` takes a hint class; `renderError` passes `case__hint--error`. **The CSS rule itself is P3's** — this is only the hook it hangs on. |
| P0-0b cross-role materials leak | done | `13cfe79` | Every paint is stamped with `lastPaintKey`; `rehydrateOpenRole()` skips when the open role differs. Cleared on `jb:role:closed` alongside `lastPaint`. |
| P0-2 focus restore across re-render | done | `d381424` | `renderForKey` records the focused control's identity (the `data-*` the renderer re-emits, never the node) before the `innerHTML` swap and re-focuses its replacement after. A render with nothing focused in the region is untouched. |

Not done: nothing in the lane's row.

## Harness work (both traps, inside the fence)

- **Trap 3 (`tests/role-case-interactions.test.mjs`):** the harness drove everything with `.click()` and had no key handling — which is exactly why P0-1 shipped. It now dispatches a real `keydown`, including the browser's default action (Enter/Space on a `<button>` activates it *unless* a handler calls `preventDefault()`), so the P0-1 test is red against the old code for the real reason.
- Same file: `classList` rebuilt a throwaway `Set` on every read, so `add`/`remove` were unobservable. Writes now persist onto the class attribute — without this the P0-3 assertion would have passed while broken.

## Assertions changed (no assertion weakened)

Three existing assertions encoded the bugs; they were corrected to the new truth and are named here per the non-negotiable:

- `tests/role-materials.test.mjs` "a drafting document shows phase, elapsed and attempt" — `drafting · 42s · attempt 1` → `writing · 42s` (P0-4).
- same file, "an optimistic pending block … renders as queued" — `queued · — · attempt 1` → `in line · —` (P0-4).
- same file, "collapses the empty and error states to a single hint line" — the error hint's class is now `case__hint case__hint--error` (P1-0e).

## Verification

```
node --test tests/role-case-interactions.test.mjs \
            tests/role-field-edit-render-guard.test.mjs \
            tests/role-materials.test.mjs \
            tests/role-materials-manifest-events.test.mjs
→ tests 78 · pass 78 · fail 0

npm run lint:js            → clean
node tools/lint-tokens.mjs --quiet → 0 findings across 16 file(s)
```

The full floor (`npm test`, contract, typecheck, smoke, e2e) was **not** run in-lane — it exceeded the time box and the orchestrator runs it at integration. Treat the floor as unverified for this branch.

## Frozen contracts

No `data-action` value, `jb:*` event name or shape, `renderCompact`, or Sheet Interface A was touched. P2-5 reuses the existing `materials-dismiss` / `materials-retry` actions and their `data-feature` payload; `case__hint--error` is a new class, not a new contract.
