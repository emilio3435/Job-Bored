# LANE REPORT A — people-and-rail

Branch `feat/casefu-a`, cut from `feat/dossier-case-followups` @ `811384d`.
Four commits, local only, nothing pushed.

## 1. What this lane was

Two jobs from `KICKOFF-A-people-and-rail.md`:

1. **One native People block.** YOUR MOVES was showing the same four CRM facts
   twice — the Case's own People rows, and directly under them the recruiter
   strip's boxed dossier card (Caveat label, orange dot, white card + shadow,
   Yes/No/Unknown pills, a date field with a "Save follow-up" button, its own
   `sheetsWrite` bridge). Two surfaces, two write paths, one of them styled for
   a different product. The block is now singular, opens with the next move as
   a sentence, and every row commits through the one `jb:role:writeback` path.
2. **The client half of the A↔B contract** — `postedAt` / `closesAt` /
   `postingSalary` on the rail (fixture-driven here; lane B supplies the real
   values) — plus the `.case__fact-input` sizing tension L7 flagged.

## 2. Which claims went red first

Test-first, in order:

| Claim | Test that went red | Why it was red |
|---|---|---|
| The next move is one sentence, from `nextAction` | `tests/role-case-model.test.mjs` → `moves.people.nextMove` (4 branches) + "is the same function the compact kanban strip calls" | `recruiter-strip.js` did not export `nextAction`; the harness assertion `typeof …nextAction === "function"` failed first, exactly as trap 2 intends (an unexported source of truth would otherwise have let every sentence assertion pass on `""`). |
| Replied is three-state | `tests/role-case-render.test.mjs` → "renders replied as a three-state segmented control…"; `tests/role-case-interactions.test.mjs` → "every reply chip dispatches its own value verbatim" | The renderer emitted one `case__v--toggle` button carrying the *opposite* value; `Unknown` was unreachable. |
| `Unknown` survives the write | `tests/role-writeback-bridge.test.mjs` → new `reply` / `Unknown` case | `flowing-writes.writeReply` collapsed everything but `/^no$/i` to `"Yes"`, so `Unknown` would have been written as `Yes`. Column S's enum (`schemas/pipeline-row.v1.json`) has always allowed all three. |
| Saved marks | `tests/role-case-interactions.test.mjs` → the `saved mark` suite (4 cases) | No `.case__saved` slots, no `jb:write:succeeded` listener. |
| One block, not two | `tests/role-case-render.test.mjs` → "no longer mounts the recruiter strip's dossier card under People"; `tests/role-case-interactions.test.mjs` → "renders one People block and never mounts the recruiter strip's card" | `data-mount="recruiter-strip"` was still emitted and `role.js` still called `JobBoredRecruiterStrip.render`. |
| Posting facts | `tests/role-case-model.test.mjs` → `identity posting facts`; `tests/role-case-render.test.mjs` → `posting dates and salary on the rail` | `identity` carried no `postedAt` / `closesAt` / `postingSalary` / `closesInDays`; the rail rendered no `Posted`/`Closes` and no `data-pill="closes"`. |
| Strip retirement is real | `tests/recruiter-strip-dossier.test.mjs` (retargeted) | `render`, `dossierHtml`, the panel CSS and the second `sheetsWrite` path were all still present. |
| Fact-input sizing | `tests/role-case-render.test.mjs` → `rail fact inputs hug their value…` | `field-sizing: content` sat in the base rule beside `width: 12ch` — ignored where unsupported, fighting the fallback where supported. |

Nothing was weakened. The two assertions that changed shape rather than being
added are noted in §3.

## 3. What shipped, file and fence

### `8057abb` feat(dossier): one People block — next move sentence, segmented reply, saved marks

- **`role-case-model.js`** — `moves.people.nextMove`, from
  `JobBoredRecruiterStrip.nextAction`. The model passes the strip's own
  `"Unknown"` vocabulary and a short-form follow-up date (`shortDate`,
  `YYYY-MM-DD` → `Sep 4`, pass-through otherwise), so the four *branches* live
  in one place while the date presentation stays the caller's — which is why
  `nextAction` takes a data bag and not a job. `renderCompact` still passes the
  ISO date and is unchanged. (Deviation note in §5.)
- **`role-case.js`** — the People block: `Next move` eyebrow + the sentence in
  a `.case__move` paragraph; `Contact` / `Last contact` unchanged `edit-field`
  inputs (placeholders `Add a contact`, `Aug 30`); `Replied` as
  `.case__seg` + three `.case__seg-b` chips (`aria-pressed`, active chip
  `--on`); the existing `type="date"` follow-up with no Save button; one
  `.case__saved` slot per writable row. `data-mount="recruiter-strip"` deleted.
- **`role-case.css`** — `.case__move` / `-k` / `-v`, `.case__seg` / `-b` /
  `--on`, `.case__saved` / `--on` + the `case-saved` keyframes and its
  `prefers-reduced-motion` opt-out, `.case__kv--people li { align-items:
  center }`. Deleted `.case__v--toggle` and `.case__v--warn`, orphaned by this
  change. No new tokens, no new colors, no card border or shadow.
- **`role.js`** — the `JobBoredRecruiterStrip.render` call site deleted; the
  reply click now reads `data-value` verbatim (and no-ops without one) rather
  than defaulting to `"Yes"`; `paintSavedMarks` + the `jb:write:succeeded`
  listener, with a re-paint at the end of `renderDossier` so a seam-event
  rebuild mid-fade cannot swallow the confirmation (this program's trap 2).
- **`flowing-writes.js`** — `writeReply` passes `Unknown` through. The kickoff
  explicitly authorises this file and `tests/role-writeback-bridge.test.mjs`
  ("check `flowing-writes.writeReply` accepts the three values; if it only
  writes 'Yes', extend it minimally… and add the bridge test case"), which is
  wider than the fence table's `role.js`-only entry; the kickoff is the more
  specific instruction, so it wins. Diff is four lines plus the doc comment.
- **`recruiter-strip.js`** — `nextAction` exported (one line + comment).
- Tests: `role-case-model`, `role-case-render`, `role-case-interactions`,
  `role-writeback-bridge`.

Two existing assertions changed shape rather than being deleted:
`role-case-render`'s lane check now pins the segmented control instead of the
retired toggle button, and `role-case-interactions`'s two recruiter-strip
tests became one that asserts the strip is *never* rendered (the kickoff's
"retarget the existing stub assertion"). The `JobBoredRecruiterStrip` stub
stays in the harness so that assertion has something real to be false about.

### `a9bdbd9` chore(dossier): retire the recruiter strip's dossier panel

- **`recruiter-strip.js`** — deleted `render`, `dossierHtml`,
  `replyButtonsHtml`, `bindActions`, `findAction`, plus `host()` and the
  `REPLY_VALUES` freeze list, which were only used by those. Header comment
  rewritten to say what the module is now.
- **`recruiter-strip.css`** — deleted `.brief__recruiter-strip` and every
  dossier-panel rule (`__head`, `__controls`, `__reply-group`, `__facts`,
  `__reply`, `__save`, `__date`, `__follow-up`, and their focus-visible
  entries), keeping the `#jb-submission-*` half of the shared selectors.
- **`renderCompact` is byte-identical.** I snapshotted its output over three
  fixtures *before* touching the file and
  `tests/recruiter-strip-dossier.test.mjs` now asserts string equality against
  those snapshots — `pipeline.js` paints it on every kanban card, so drift
  fails loudly instead of reaching the board. Every `--compact` rule kept.

### `2bfdd48` feat(dossier): posting dates, closing-soon pill, posted salary on the rail

- **`role-case-model.js`** — `identity.postedAt` / `.closesAt` /
  `.postingSalary` (strings, `""` when absent) and **`identity.closesInDays`**
  (this is where the day count lives — the kickoff left the name to me),
  `null` when absent or unparseable, computed with the same ceil-from-now rule
  as `nextAction.daysUntil` so the two rail dates cannot disagree by a day.
- **`role-case.js`** — `Posted …` then `Closes …` in the rail meta, in that
  order after `Found …`; a `case__pill--due` / `data-pill="closes"` amber pill
  for `closesInDays <= 14` (`Closes in N days` / `Closes today` /
  `Closed N days ago`), and the meta line suppressed when the pill shows so
  the same date is never stated twice; the posting's salary as the salary
  input's **placeholder** (never its value — a blur must not write the
  posting's number into the user's sheet) with a `scrape` source tag after it,
  only when the sheet's own salary is empty.

### `4d49a54` fix(dossier): rail fact inputs hug their value where field-sizing is supported

- **`role-case.css`** — `width: 12ch` is now the unconditional fallback
  (`role.js` re-sizes in `ch` there), and `field-sizing: content` +
  `width: auto` + `min-width: 6ch` move behind
  `@supports (field-sizing: content)`. Pinned by a new case in
  `tests/role-case-render.test.mjs`.

### Files touched outside the fence table

`flowing-writes.js` and `tests/role-writeback-bridge.test.mjs` — both named by
the kickoff, see above. Nothing else.

### Visual check (not required by the DoD, done anyway)

`npm run test:e2e-smoke` writes `.lane-evidence/V1-case-desktop.png`. In it the
People block reads: `PEOPLE` → crimson `NEXT MOVE` + *Find a recruiter contact*
in Lora italic → four ledger rows, the `YES · NO · UNKNOWN` chips with `NO`
filled navy. No boxed card, no shadow, no second Follow-up field. On the rail,
`Austin, TX` and `$185–230k` hug their values in Chrome, which is the
`@supports` block doing its job.

## 4. Floor results

```
$ npm test
ℹ tests 2903
ℹ suites 705
ℹ pass 2902
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 13803.089583
EXIT_TEST=0
```

The one `todo` is `tests/submission-record-audit.test.mjs` — "blocked on the
canonical-ownership gate; no legal Sheet column or IndexedDB store", pre-existing
since `0a17994` and untouched by this lane.

```
$ npm run lint:js
> eslint .
LINT_OK

$ npm run test:contract:all
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
CONTRACT_OK

$ npm run typecheck:server
> tsc --noEmit --project server/tsconfig.json
TYPECHECK_OK

$ npm run smoke:jb-v2
✔ smoke 1/13 … ✔ smoke 13/13: tools/lint-tokens.mjs passes (0 findings)
ℹ tests 13
ℹ pass 13
ℹ fail 0
SMOKE_OK

$ node tools/lint-tokens.mjs --quiet
0 findings across 16 file(s)

$ npm run test:e2e-smoke
  ✓  1 boot-smoke.spec.mjs:93 › greenfield boot produces zero console errors (3.6s)
  ✓  2 boot-smoke.spec.mjs:102 › every <script src> in the served HTML returns 200 (331ms)
  ✓  3 boot-smoke.spec.mjs:128 › screen S0 — the demo board — is the cold-start surface (316ms)
  ✓  4 boot-smoke.spec.mjs:144 › demo cards render watermarked, with a fit score (317ms)
  ✓  5 boot-smoke.spec.mjs:161 › JobBoredOneFlow.open() renders a beat (396ms)
  ✓  6 boot-smoke.spec.mjs:182 › requestDiscoverySetup() renders the wizard shell (423ms)
  ✓  7 case-dossier.spec.mjs:227 › The Case renders in a real browser from seeded pipeline data (5.2s)
  7 passed (11.2s)
EXIT_SMOKE=0

$ npm run test:e2e-journey        # second run — see §5
  ✓   1 … ✓  12 critical-journey.spec.mjs:614 › should serve the dashboard's own /profile … (314ms)
  12 passed (17.9s)
EXIT_JOURNEY=0
```

DoD item 3:

```
$ node tools/lint-tokens.mjs --quiet
0 findings across 16 file(s)

$ grep -n "recruiter-strip" role-case.js role.js
(no output; exit 1)
```

## 5. Anything unverified, and the judgement calls

1. **The journey suite failed once, then passed twice.** The first full run
   after commit 4 failed on `critical-journey.spec.mjs:540` ("should say on
   screen that closing the flow paused it") at
   `await expect(page.locator(FLOW_MOUNT)).toBeHidden()`. Re-running that test
   alone passed (806ms), and a second full-suite run passed 12/12. Nothing in
   this lane touches the one-flow, its mount or its Escape handling — the files
   are `role*`, `recruiter-strip*` and `flowing-writes.js`. I am recording it as
   flaky rather than clean; the trace is at
   `test-results/critical-journey-should-sa-6e0ee--closing-the-flow-paused-it/trace.zip`
   if the integrator wants it. **Not verified: whether it is deterministically
   flaky or ordering-sensitive.**

2. **`Follow up on Sep 4` vs. the ISO date — deliberate, flagged.** The brief's
   example sentences use `Sep 4`, and `nextAction` is required to be the one
   source of truth while `renderCompact` stays byte-identical (it says
   `Follow up on 2026-09-04` on kanban cards). Those pull opposite ways if
   `nextAction` owns the formatting. I resolved it by keeping `nextAction` a
   pure function of its `data` bag and letting each caller supply the date it
   wants to speak: the Case passes a short form, the card passes ISO. Both
   branch identically; only the noun differs. If the integrator would rather
   the Case say `2026-09-04` to match the rail pill, `shortDate` in
   `role-case-model.js` is the single line to drop.

3. **`28px tall, 44px minimum hit area via padding` cannot be done with padding
   alone** — padding grows the box, so a 28px chip with 44px of padding-derived
   height is 44px tall. I built the visible chip at `min-height: 28px` and
   extended the hit area with `.case__seg-b::after { inset: -8px 0;
   min-height: 44px }`, which is 28 + 2×8 = 44. Same outcome, different
   mechanism than the brief's word.

4. **`bridge-registry.js:463–470` is now dead** — it still assigns
   `JobBoredRecruiterStrip.host = { sheetsWrite: { updateFollowUpDate,
   updateJobResponseFlag } }`, and nothing reads it now that `host()` is gone.
   The file is outside this lane's fence so I left it; the two writers
   themselves are still live for the legacy drawer (`app-compat.js`,
   `sheets-writeback.js`), so only the eight-line `recruiterStrip.host` block
   is removable. Flagged as cleanup, not done.

5. **The posting facts are proven against fixtures only.** No `postedAt`,
   `closesAt` or `postingSalary` exists anywhere in the repo yet — lane B adds
   them to the scraper, the card attrs and `dawn-data.js`. The names I built
   against are the ones the ground rules fix (`job.postedAt` / `job.closesAt` /
   `job.postingSalary`, strings, `""` when absent). **Not verified end to end
   until B lands**; the browser screenshot shows no Posted/Closes line because
   the seeded fixture carries none, which is the correct empty behaviour.

6. **The saved mark is not covered by a browser test.** It is asserted in the
   node:vm DOM harness (appears, is row-scoped, clears on the timer, survives a
   re-render). In a real browser a `jb:write:succeeded` may also kick a
   `jb:pipeline:rendered` cascade; the re-paint in `renderDossier` is what
   should carry the mark through that, but I did not observe it against a live
   Sheet write. Lane C's wire-level proof is the natural place to confirm it.

7. **The four commits are feature-shaped, not test-then-impl pairs.** The
   kickoff heads its test list "test-first, each its own commit" and then names
   exactly four commit messages, all feature-shaped. I wrote the tests first
   and red-first (§2) but landed each with its implementation under the named
   message, so the four messages stay accurate to their diffs.
