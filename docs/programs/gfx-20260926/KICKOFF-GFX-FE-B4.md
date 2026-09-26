# Lane FE-B4: redesign the fit profile (Beat 4) and wire its save to the server

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 (D1, D5) and **every Beat 4 ledger row**: B4-1…B4-11, N-B4-1…N-B4-6
- `PLAN.md` §R: R6, R7
- **`reports/V2-beat4-inventory.md`**: every control, the server contract, the local-store contract and the suggested regroup
- `reports/GEMINI-copy-inventory.md` (B4 rows)
- `docs/COPY.md`, if FE-B1 has landed it; otherwise follow SPEC's replacement strings

**Load `/frontend-design` before designing.** Routing: opus · medium.

Emilio's words: the fit profile UX is "hideous". This lane makes it the best-looking beat in the flow, while keeping every field and the data contract.

**Live alongside you:** FE-B1, which owns `oneflow-beat-google.js`, `oneflow-route-local.js`, `onboarding-flow.js` `maybeStart`, docs, and the CSS at `:557-572`, the B1 block and route-local. Don't touch those.

**Goal:** Beat 4 reads as one calm, grouped page that a job seeker understands at a glance. Every hard filter is visible, nothing is hidden behind "edit" links or raw JSON, and pressing "Looks like me" really saves the profile to the server, or honestly says it saved locally.

**Success means (each item red first, tests named with ledger IDs):**

1. **N-B4-1 (P0) + R7: wire the save.**
   - `confirmFit` calls `window.JobBoredFitProfileSync.syncProfile(payload)` (BE-CORE, merged) instead of its own `profileApiConfigured` / fetch path. Delete the dead helper.
   - The local IndexedDB save stays the source of truth: only its failure blocks the beat.
   - Handle each sync result:
     - `synced:false, reason:"local_only"` → complete, with the sync's message shown as a quiet note;
     - `ok:false, reason:"rejected"` → **stay on the beat** and show the server's message next to the relevant field (N-B4-2: never swallow a 4xx);
     - `server_error` → complete locally, with a retry note.
   - **`tests/e2e-onboarding` `VAL-ONEFLOW-001` must go green.** It is red on main right now (`profileWrites` 0).
2. **N-B4-2: validation.**
   - Validate inline with `window.JobBoredFitProfileSchema.validateProfile` (BE-CORE, merged): per-field errors, caps enforced at input time (for example, the Add control is disabled at 8 roles with the reason shown), and the first invalid field focused on submit (N-B4-3).
   - Delete the copied enums (`oneflow-beat-fit.js:24-51`) and use the schema module's.
3. **Regroup (B4-1, B4-5, B4-9)** into sections, in this order:
   - **Target**: roles, seniority
   - **Your story**: the narrative
   - **Strengths**: ranked
   - **Deal-breakers**: work mode, locations, work authorization, and the salary control
   - **Preferences**: wants ("More of"), avoids ("Less of"), skip titles; collapsed by default, with a count badge

   No 3-column grid in the modal. Two zones at most on wide screens and one column below 720 px.
4. **N-B4-3 + B4-4: narrative.**
   - An always-visible, labelled, auto-growing textarea: "In one or two sentences, what do you do best?"
   - A live 20–1200 counter.
   - No "edit" link and no truncated `<em>`.
5. **D5 / N-B4-4: one salary control.**
   - "Minimum salary [____] ☐ Also hide jobs that don't list a salary", with the help text: "The minimum only applies to jobs that list a salary."
   - The summary line no longer shows a floor as active unless it is.
   - The backend semantics are unchanged.
6. **B4-2, B4-3, B4-11, N-B4-5: chips.**
   - A fluid tag input (`field-sizing: content`, with a `size` fallback). Enter or comma adds; the × button is at least 24×24 px.
   - Reorder roles and strengths with a **drag handle only**, plus keyboard move-up/down.
   - No inline ↑↓ glyph buttons, and `draggable` sits on the handle, not on the row.
   - Trim and dedupe on blur; empty chips are removed.
7. **B4-6:** remove the "Raw profile JSON" `<details>` from B4 entirely. The Settings → Fit profile editor keeps its own advanced view; don't touch it.
8. **Copy (B4-7, N-B4-6):**
   - Headline: "Here's how we'll match jobs to you."
   - The "Lean toward / away" title becomes "Preferences", with the subheads "More of" / "Less of".
   - Follow COPY.md.
9. **Visual quality (`/frontend-design`):**
   - Use the jb-v2 tokens and `DESIGN.md`, with clear hierarchy, generous whitespace and consistent focus rings, following the one-flow shell's look.
   - All CSS is scoped under `.oneflow-fit`, because of the jb-v2 cascade trap.
   - **CSS fence: `css/oneflow.css:860-1057` only (R6).** Don't cross into the resume-pill rules at `:1059+`.
   - Take Playwright screenshots at 1440 and 375 px (port-0 dev-server), before and after, and save them to `.lane-evidence/`.
   - Check keyboard-only operation, and that screen-reader labels exist for every control.

**Floor:** paste all of this in §4.
- `npm run lint:repo`
- `npm run typecheck:repo`
- `node --test` on your new `tests/gfx-fe-b4-*.test.mjs` files, plus `tests/oneflow-l2-fit-beat.test.mjs`, `tests/gfx-be-core-fit-profile-*.test.mjs`, `oneflow-l0-*`, `oneflow-l6-*`, `oneflow-l7-*`, the `greenfield-*` tests, `data-integrity-resume-and-saves`, and any test that pins a B4 string you changed (grep for it)
- `npm run test:e2e-onboarding`: **all 7 green, including VAL-ONEFLOW-001**
- `npm run test:e2e-journey`
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)

- `oneflow-beat-fit.js`
- `css/oneflow.css:860-1057`
- `tests/gfx-fe-b4-*.test.mjs`, plus updates to tests that pin B4 behaviour or strings that genuinely moved (say so in the commit body)

**Do NOT touch:**
- `fit-profile-schema.js`, `fit-profile-sync.js`, `fit-profile-wizard.js`, `fit-profile-editor.js` (BE-CORE, merged: consume them, and request changes in §5)
- the other beats, `onboarding-flow.js`, `index.html`, other CSS blocks, docs

## Consumes

- `window.JobBoredFitProfileSync.syncProfile(payload, { fetchImpl })` → `{ ok, synced, status, reason, message }`
- `window.JobBoredFitProfileSchema`: enums, limits, `validateProfile(profile)` → per-field errors
- Both load after `profile-api-base.js` in `index.html` and resolve their dependencies lazily.

## Non-negotiables

- The profile payload shape doesn't change: the server contract and the local-store contract are in `V2-beat4-inventory.md`.
- No field is lost.
- A 4xx is never swallowed.
- Exactly one primary action ("Looks like me →").
- Keyboard and screen-reader operable.
- Scoped CSS.

## Definition of Done

The floor is green and pasted in §4, `VAL-ONEFLOW-001` passes, and screenshots are saved. First line `DONE`. Local commits only.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
