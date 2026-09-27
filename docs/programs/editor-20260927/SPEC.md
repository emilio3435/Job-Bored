# SCRIBE v2: the materials review-and-edit desk

Program `editor-20260927`. Base: main `98903e29`. Inputs: `reports/CODE-RECON.md` (R#n = recon defect n) and `reports/UX-RESEARCH.md`. Mockup: `mockup/index.html`. Labels: **[C]** confirmed in code at 98903e29, **[I]** inferred, **[U]** unknown until probed.

**Goal:** replace the page-bottom Scribe with an edit desk bound to one role's materials package. The user asks for changes in a chat composer, reviews them as suggesting-mode marks on the real template render, accepts or rejects each one, and browses, compares and restores prior versions. Every accepted batch becomes a server run that Preview, PDF and Download serve.

**Success means:**
- a signed-in user with no package sees no Scribe at all (R1);
- "make the summary punchier" on a real package returns a proposal whose marks render on the Signal/Dossier/Editorial preview;
- accepting two of three changes writes `runs/<runId>/` with `source:"edit"`, and `resume.pdf` then carries only those two;
- the version list shows every run with its prompt, and Restore appends a run;
- all 22 recon defects are closed per §7;
- the §8 specs pass, including the first browser spec Scribe has ever had.

**Stop when:** §8 is green on an integration branch, Muse's floor output is pasted, and Emilio has the branch to push. It also stops if a §0 decision is unanswered when its lane is due, or if the §5 CSP probe fails. In either case, report it and wait.

---

## §0 Decisions for Emilio

Each decision lists the recommended option first.

1. **Where edits live.**
   - **(a) Recommended: the server package is the source of truth.** A new edit endpoint commits each accepted batch as an immutable `runs/<runId>/`, and the run list becomes the version history. Preview, PDF and ATS text always agree, because one renderer produces all three. The cost: Scribe needs the local API on :3847. That is already true for every materials action today [C: `role-case.js:158-164` disables drafting when the server is down].
   - **(b) Keep IndexedDB `generatedDrafts`.** Nothing changes on the server. The drawback is that edits stay invisible to the PDF (R5) and history stays per-browser, so R10 and R13 persist.

2. **Edit contract.**
   - **(a) Recommended: structured edit-ops.** The request carries `replace | remove | insert`, keyed by node id over `materials.render-model.v1`. This gives per-change accept, locked facts, a loss meter, and no damage to the formatting.
   - **(b) Full regeneration**, meaning `callEditor` with the instruction as scorecard. It is simpler, but you can only diff it afterwards: no scope guarantees, and it can silently rewrite locked facts.

3. **Progress transport.**
   - **(a) Recommended: SSE-framed `fetch` streaming from :3847**, read with `ReadableStream`, not `EventSource`. `apiFetch` may add hosted-auth headers (`role-materials.js:34-37` [C]), and EventSource cannot send them. It emits stage and op events, but not tokens: `callJsonStage` is non-streaming [C], so ops arrive together once the one LLM call ends and are then validated and emitted one by one.
   - **(b) Poll `GET …/edits/:id` every 1.5 s.** Less code, but the stage line lags and Stop is coarse.
   - Token streaming would need provider streaming in `materials-writer.mjs`. It is out of v1.

4. **Preview under the CSP.**
   - **(a) Recommended: the server renders, the client injects.** `POST …/preview` returns the `renderDocument` HTML string. That needs no Chromium, because fonts and CSS are already inlined [C: `materials-render.mjs:822-850`]. The client sets it as the `srcdoc` of `<iframe sandbox="allow-same-origin">` (no scripts) and patches nodes by `data-node`.
     - `connect-src` already allows `127.0.0.1:*`; `img-src data:` and `font-src data:` cover the inlined logos and fonts [C].
     - [U] The claim that a `srcdoc` document is not blocked by `frame-src https://accounts.google.com` (srcdoc is not fetched, but it inherits the parent CSP) must be proven by the §5 probe before FE lanes start.
   - **(b) Widen `frame-src` to `http://127.0.0.1:3847`** and iframe `…/files/resume.html`. Simpler, but it widens a security boundary, can't show unaccepted proposals, and fails on hosted Pages with a tailnet API.
   - **(c) Client-side render.** This needs `templates/` to be public and a port of the render engine to the browser. Reject: two renderers would drift.

5. **v1 scope.**
   - **(a) Recommended: resume and cover letter both,** through one node-id scheme. The letter is simpler (3–4 `paragraphs[]` with an `id` each [C]).
   - **(b) Resume only first.** This saves about one FE day, but the tabs would stay half-broken (R8).

6. **Dark mode.** `tokens-v2.css` has no dark tier, and no app stylesheet reads `prefers-color-scheme` [C].
   - **(a) Recommended: v1 ships light only.** The mockup's dark values are a proposal for a later tokens program.
   - **(b) Add a dark tier now.** This touches every region.

7. **Manual typing in the document.**
   - **(a) Recommended: click a block to edit it in place.** On blur this becomes a `replace` op, author `you`, auto-accepted into a new run (debounced 2 s), so there is one path to disk.
   - **(b) Chat-only edits.** No free typing at all.

---

## §1 Information architecture

The old `[data-region="scribe"]` (`index.html:465-481`) is **deleted**. Scribe v2 mounts inside the Case Materials section (`role-case.js:446-450` → `role-materials.js` doc rows) as `<jb-scribe slug doc>`, scoped under `body.jb-v2 [data-region="role"] .scribe` (the cascade trap).

**States:**

| State | When | What renders |
|---|---|---|
| **Absent** | No package, server down, or signed out | Nothing: no node in the DOM (R1, R2) |
| **Dock** (collapsed) | The package has `render-model.json` | One bar under the doc rows. It shows `Resume v4 · 1 page · "Shorter summary" 2h ago`, a one-line composer, chips on focus, and Expand |
| **Proposal landed** | A proposal is open | The dock grows to 40vh: summary line, first 3 marks, Accept all, Review. The composer stays |
| **Sheet, ≥1024** | Expand or Review | A 92vh bottom sheet at `--jb-z-drawer` with a scrim. The document takes 62% (template render plus a 44px margin rail). The side column takes 38% with tabs Chat / Versions. A header row holds doc tabs, page count, facts lock, Show changes, Compare, and Close |
| **Sheet, 600–1023** | | Same split at 55/45. Versions is a tab |
| **Sheet, <600** | | Full screen with a segmented control Doc / Chat / Versions. The composer is pinned to `visualViewport`. When a proposal arrives it auto-switches to Doc, with a sticky `3 changes · Accept all` bar |
| **Compare** | Toggle in the header | The document pane splits A / B (≥1024), or becomes an A/B segmented toggle (<1024). Marks show the diff from A to B, and no accept controls are shown |
| **Busy** | Proposal in flight | Document `aria-busy`, the stage line, and Stop |
| **Blocked or error** | 409 pending, 503 browser, provider error | An inline line in the chat log with one fix action. The dock never disappears |

The draft buttons ("Tailor resume" / "Draft cover letter") stay in the docket, because they are the drafter. The notes field moves into the composer as "Ask for a redraft instead" (R17).

## §2 Interaction spec

**Composer.**
- A textarea that autogrows from 1 to 6 lines. Enter sends and Shift+Enter adds a newline.
- **Scope pill:** `Whole resume` by default. With a selection or focused block it reads `2 bullets selected ×`, and the request carries `scope:[nodeIds]`.
- **Chips:** Punchier, Shorter, Fit to 1 page, Match JD keywords, Quantify, More formal, plus `+ <missing JD term>` from `keywordCoverage`.
  - A chip **fills** the composer; it never sends.
  - Chips are a customizable list. "Edit chips" lets the user add, rename or remove them, stored in the `user-content-store` preferences.

**Selection popover.** Selecting text or focusing a block in the preview shows Rewrite, Shorten, Emphasize…, Ask, and Edit text.

**Proposal.**
- The chat bubble summarizes the proposal: `3 changes · 1 removal · −14 words · still 1 page`.
- The document shows suggesting-mode marks:
  - `<ins>` with a mint-tint fill and a 2px underline in `--jb-accent-ink`;
  - `<del>` struck through in `--jb-err`;
  - hidden "inserted: … end inserted" text for screen readers.
- Each changed block gets a 3px left rule (navy while pending, mint once accepted) and a margin glyph `+ − ~` with ✓ / ✗ buttons.
- Word-level diff runs inside a block, and unchanged gaps of two words or fewer are merged.

**Accept or reject.**
- Per-change controls, plus **Accept all** (primary, navy) and Reject all.
- Accept all **skips** changes flagged Unverified; each of those needs its own ✓.
- Nothing hits disk until the user commits. The commit button reads `Save as v5 (2 accepted)`; after 3 s idle with every change decided, it commits automatically.
- Commit calls `POST …/accept`, which creates a new run. The preview then reads "Matches PDF" once the run's PDF exists.

**Guards.**
- **Facts locked** chip, on by default. Employer, title, dates, degree and metric runs `n` are locked. The server returns `blocked` for an op that targets them, and the chat shows `Blocked: would change "2019–2023"`.
- **Unverified:** an op that introduces a number, proper noun or tool absent from the ledger (`claimById`, `metricsForClaim` [C]) and the master resume gets an amber `Unverified` tag.
- **Loss meter:** `−14 words (4%)`. Above 20% removed, a banner appears: `This removes 22% of your resume. Review each removal.`
- **Length:** a live page count comes from the preview's `[data-page]` height, labelled `≈1 page` until the PDF confirms it. When the count goes over `template.pageBudget`, an overflow line appears along with a "Trim to fit" chip.

**Progress (honest).** One stage line, advanced only by server events:
1. `Reading resume`
2. `Drafting edits`
3. `Checking facts (2/3)`
4. `Measuring length`
5. `Ready`

- **Stop** aborts the request, keeps validated ops, and marks the proposal `partial`.
- There is no fake percentage and no typewriter effect.

**Versions** (tab or pane). A linear list, newest first:
- Each row shows `v5`, the prompt or `Manual edit` or `Restored from v2` or `Drafted`, relative time, `±words`, pages, and the template.
- `v0` (the first drafted run) is pinned and can't be unpinned or removed. Any other row can be starred.
- Row actions are View (a read-only preview), Compare with current, and Restore as new.
- Nothing is ever deleted.

**Undo.** Cmd/Ctrl+Z (focus outside a text field) restores the previous version as a new run, and a toast offers `Restored v4 · Undo`. Chat history is never undone.

**Show changes** (key `D`) hides the marks and renders the clean proposed text.

**Doc tabs.** Resume and Cover letter are a real `role="tablist"` with `aria-controls` and arrow keys (R8). Each tab has its own version list.

**Template.** An Appearance menu is filled from `GET /api/materials/templates` (R9). Choosing a family calls the existing `POST …/regenerate {template}`, which creates a new run labelled `Template: Dossier`.

## §3 Data and API contract

All routes live on the Express app in `server/index.mjs` under `/api/applications/:slug/`, with the existing slug validation. The lock is **one open proposal per slug**. They return 409 `materials_pending` while `pending.json` exists, matching `regeneratePackage` [C].

**Node ids** (`server/materials-nodes.mjs`, which is pure, plus a browser twin — see §3.5) are derived from the model and are stable across runs:

| Node | Id | Text source | Locked parts |
|---|---|---|---|
| Resume statement | `stmt` | `statement.runs` | `n` runs |
| Intro | `intro` | `intro.runs` | `n` runs |
| Experience entry seat | `seat:<employerId>` | `entries[].seat` | whole (title) |
| Bullet | `b:<employerId>:<claimId>` | `bullets[].runs` | `n` runs |
| One-line entry | `line:<employerId>` | `entries[].line` | none |
| Credential line | `cred:<claimId or index>` | `lines[].runs` | whole (degree) |
| Toolkit group | `tool:<label>` | `groups[].items` joined | none, but checked against the ledger |
| Letter paragraph | `p:<paragraphs[].id>` | `text` | numbers |
| Salutation | `sal` | `salutation` | none |

`org`, `meta` (dates) and `readouts` are never addressable. Templates gain a `data-node="<id>"` attribute on each addressable element in all three families. This is additive and changes no pixels, which the visual spec asserts.

### 3.1 Edit-op schema

This is `schemas/materials-edit-op.v1.schema.json`:

```json
{ "opId": "o1", "op": "replace", "node": "b:acme:c14", "text": "Cut p95 checkout latency 38% by…",
  "rationale": "Leads with the metric", "flags": ["unverified"], "facts": ["Kafka"] }
{ "opId": "o2", "op": "remove", "node": "b:acme:c19" }
{ "opId": "o3", "op": "insert", "after": "b:acme:c14", "claimId": "c22", "text": "…" }
```

- `text` is plain. Markdown and HTML are stripped, then `tagDraftMetrics` [C: `materials-metric-tag.mjs:37`] rebuilds the `runs`.
- `insert` must name a ledger `claimId`; otherwise it is `unverified`, and the user must confirm it.
- The server rejects any op that:
  - is out of scope;
  - targets a locked part;
  - breaks the schema's shape limits: bullets 2–4 per entry, statement 20–55 words, letter paragraphs 3–4 [C: render-model schema];
  - fails `validateRenderModel` once applied.

### 3.2 Endpoints

| Method and path | Request | Response |
|---|---|---|
| `GET /versions?doc=resume` | | `{versions:[{runId, n, createdAt, source:"draft"\|"regenerate"\|"edit"\|"manual"\|"restore", label, prompt?, parentRunId?, pinned, starred, pages?, words, family}], currentRunId}`. This reads `runs/*/run.json` and adds `versions.json` (stars only) |
| `GET /versions/:runId/model` | | `{model, nodes:[{id, kind, text, locked:{whole?:bool, spans:[[s,e]]}}]}` |
| `POST /preview` | `{doc, baseRunId, ops?:[…]}` | `{html, words, pageBudget}`: `renderDocument` of base+ops, with no Chromium |
| `POST /edits` | `{doc, baseRunId, instruction ≤2000, scope:"all"\|[nodeId], lockFacts:true, targetPages?, chips?:[]}` | `202 {proposalId, streamUrl}`, or `409 stale_base` if `baseRunId` is not current |
| `GET /edits/:id/stream` | | SSE (§3.3) |
| `POST /edits/:id/stop` | | `{status:"partial", ops}` |
| `POST /edits/:id/accept` | `{accept:[opId], confirmUnverified:[opId], manualOps?:[op]}` | `{run:{runId, n, pages, pdf:"ready"\|"stale"}, versions}`. `503 browser_unavailable` writes HTML with `pdf:"stale"` and never blocks the text |
| `DELETE /edits/:id` | | `204` (reject all) |
| `POST /versions/:runId/restore` | | `{run}`, a new run with `source:"restore"` and `restoredFrom` |
| `PUT /versions/:runId/star` | `{starred}` | `{ok}` |

Manual in-place edits post `accept` with `manualOps` and no `proposalId`, via `POST /edits/manual`, and produce `source:"manual"`.

### 3.3 SSE events

`event: <name>\ndata: <json>`. The events are:
- `stage` `{stage:"reading"|"drafting"|"checking"|"measuring", done?, total?}`
- `op` `{op}`, one per validated op
- `blocked` `{op, reason:"locked"|"out_of_scope"|"shape"|"invalid_model", detail}`
- `proposal` `{summary:{changes, removals, wordsDelta, lossPct, pages, unverified}}`
- `error` `{code, message, fix?}`
- `done` `{status:"ready"|"partial"|"failed"}`

The heartbeat is a `: ping` comment every 15 s.

### 3.4 Server reuse

- **New `server/materials-edit.mjs`:**
  - `proposeEdits()` builds the prompt from nodes, instruction, scope, JD extract and ledger claims. It calls **`callJsonStage`** [C: `materials-writer.mjs:777`] with a new `materials.edit.v1` system prompt, the same pin resolution, and validation through `structured-output-validator.js`.
  - `callEditor` is **not** reused. It rewrites writer JSON against a critic scorecard, not the render model [C: `:825-832`]. Only its provider client is shared, through `callJsonStage`.
- **Refactor `regeneratePackage`:**
  - Extract its tail (open the PDF session → `renderPackage` → write the HTML → `writePackageRecords`) into `commitModelAsRun({dir, model, feature, source, parentRunId, edit})`. `regenerate`, `accept` and `restore` all call it.
  - `retargetModel` stays the template switch.
- **`materials-run.v1` schema change:** add `edit | manual | restore` to `template.source`, plus an optional `edit:{prompt, proposalId, accepted:[opId], rejected:[opId], ops:[…]}` and `restoredFrom`. The contract lane lands this first, then `test:materials-contract`.
- Proposals persist at `<pkg>/proposals/<id>.json` until they are accepted or deleted. They are swept after 7 days.

### 3.5 Client modules

These are the new root files, in the static allowlist:
- `scribe-v2.js`: the element, states and keyboard.
- `scribe-v2-api.js`: fetch, the SSE reader and the stale-base retry.
- `scribe-v2-diff.js`: structural diff by node id, word-level Myers with gap merging, and a vendored `fast-myers-diff` (MIT) or a hand-rolled port of about 120 lines.
- `scribe-v2.css`.
- Node ids come from `GET …/model` (`nodes[]`), so the client never re-derives them.
- Kept from the old code: the save-state machine's truth rules, `keywordCoverage`, `jb:ats:state`, and `JobBoredA11y.live.announce`.

## §4 Accessibility, keyboard, tokens

**Landmarks and focus:**
- The sheet is `role="dialog" aria-modal="true" aria-labelledby`, with focus trapped inside. Esc closes it and returns focus to the opener.
- The document is `role="region" aria-label="Resume, version 5, proposal with 3 changes"`.
- Chat is `role="log" aria-live="polite"`. Versions is a list.
- There is one polite status region for stage changes and results. Assertive announcements are reserved for errors and blocked ops.

**Keys** (active when focus is not in a text field):

| Key | Action |
|---|---|
| `j` / `k` | Next / previous change |
| `a` / `r` | Accept / reject the focused change |
| `Shift+A` | Accept all verified changes |
| `D` | Show changes |
| `c` | Compare |
| `/` | Focus the composer |
| `F6` | Cycle doc → chat → versions |
| `Cmd/Ctrl+Enter` | Send |
| `Cmd/Ctrl+Z` | Undo the last saved batch |
| `Esc` | Stop, then close |
| Arrows | In tablists and the segmented control |

**Controls:** every button is labelled, for example `Accept change 2 of 3: summary`. Hit targets are at least 44px under 600px and at least 32px on desktop.

**Reduced motion:** the sheet fades instead of sliding, and there are no highlight pulses. Durations use the 120/200/320 tokens.

**Tokens:**
- Primary actions are `--jb-action` / `--jb-on-action`.
- Anything filled with mint uses `--jb-on-accent` text, never `--jb-ink-inverse` (R18).
- Sentences use `--jb-type-small` (13) or larger. `--jb-type-label` (11) is reserved for mono caps labels (R19).
- Status uses `--jb-warn` (Unverified), `--jb-err` (del, blocked) and `--jb-accent-ink` (ins).
- `aria-disabled="true"` gets a styled 55% opacity and `cursor:not-allowed` (R22).
- There are no new colour literals, so `lint:tokens` must pass. `--jb-mint-ink`, `--jb-rose-soft` and `--jb-ink-soft` are read by `role-case.css` but defined nowhere [C]. Scribe v2 must not read them.

## §5 CSP probe (gate before FE)

The probe is a Playwright spec under the real CSP from `scripts/lib/browser-csp-policy.mjs`. It injects `<iframe sandbox="allow-same-origin" srcdoc>` holding a real `renderDocument` output (inline `<style>`, `data:` fonts and logos). It then asserts:
- no `securitypolicyviolation` events;
- `contentDocument.querySelector('[data-page]').scrollHeight > 0`.

If the probe fails, stop and bring §0-4(b) back to Emilio.

## §6 Out of scope

- The drafter pipeline and its prompts.
- Token streaming.
- Branching versions.
- Multi-user editing.
- Dark mode (§0-6).
- The ATS rescore redesign. It keeps today's `<jb-fit-ring>`, moved into the sheet header as a button (R4 is fixed by binding it to `slug`).

## §7 Recon defect map

| R | Defect | Disposition |
|---|---|---|
| 1 | `display:block !important` on an empty region | **Fixed:** the region is deleted; Scribe renders only when bound |
| 2 | `min-height:100vh` | **Obsoleted:** the new CSS has no viewport minimum outside the sheet |
| 3 | Dead Refine | **Obsoleted:** replaced by `POST /edits` |
| 4 | Rescore unbound | **Fixed:** the score adapter takes `slug` + `runId` |
| 5 | Edits never reach the package | **Fixed:** every accept is a run |
| 6 | Blank print | **Obsoleted:** Print opens the run's PDF |
| 7 | Done does nothing | **Obsoleted:** Close is the dialog's close |
| 8 | Tabs don't switch; no ARIA | **Fixed:** §2 tablist |
| 9 | Empty Appearance select | **Fixed:** filled from `/api/materials/templates` |
| 10 | Autosave overwrites the wrong row | **Obsoleted:** runs are immutable, and `409 stale_base` catches races |
| 11 | "Refined" label on manual edits | **Fixed:** `source:"manual"` |
| 12 | Job-key mismatch empties the rail | **Obsoleted:** keyed by package `slug` |
| 13 | Version-number race | **Fixed:** `n` is derived from sorted run timestamps server-side, and the per-slug lock serializes writes |
| 14 | Run history never shown | **Fixed:** `GET /versions` |
| 15 | No diff, compare, chat or prompt history | **Fixed:** §2, §3.5 |
| 16 | False "single undo step" | **Fixed:** undo = restore-as-new |
| 17 | Notes far from redraft; Repair ignores them | **Fixed** (notes in the composer). The Repair half is **out of scope** (drafter) |
| 18 | White on mint | **Fixed:** `--jb-on-accent` |
| 19 | 10–11px sentences | **Fixed:** type floor |
| 20 | Two visual languages | **Fixed:** Scribe v2 uses the Case's paper/navy language; mint is used only for accepted and inserted states |
| 21 | Dead legacy code | **Fixed:** delete list in PLAN §Delete |
| 22 | `aria-disabled` unstyled; list rebuilt every notify | **Fixed:** styled, and the version list diffs by `runId` |

## §8 Test plan

**Unit** (`tests/*.test.mjs`, run by `npm test`):
- `materials-nodes`: ids are stable across `retargetModel`, locked spans, and round-trip.
- `materials-edit-apply`: each op kind, the scope reject, the locked reject, the shape limits, and `validateRenderModel` after apply.
- `materials-edit-facts`: Unverified detection for numbers, proper nouns and tools against a fixture ledger.
- `scribe-v2-diff`: structural cases (add, remove, change) and word-level cases including gap merging and punctuation tokens.
- `scribe-v2-keyboard`: j/k/a/r/D under jsdom; they are ignored inside a textarea.

**Contract:**
- `schemas/materials-edit-op.v1` and the updated `materials-run.v1` join `scripts/test-materials-contract.mjs`.
- One happy path and one error case per endpoint in `tests/integration/materials-edit-api.test.mjs`, with a stub `callJsonStage` and `pdfSession:null`. Cases: 409 pending, 409 stale_base, 400 out-of-scope, SSE event order, and a 503 browser that still writes the HTML.

**Browser:**
- **e2e-smoke `scribe-csp-srcdoc`:** the §5 probe.
- **e2e-journey `scribe-edit-journey`:** uses the hermetic harness with `installHostIsolation`, which stubs `/__proxy/*` and `/profile/*`, plus a stubbed API. The journey:
  1. Signed in with no package, there is no `.scribe` node.
  2. With a package, the dock appears.
  3. Send a chip prompt, then check the stage line and marks.
  4. `j a j r`, then commit, then assert that `POST /accept` carried `[o1]` and that the version list shows v1 with the prompt.
  5. Compare shows A/B.
  6. Restore appends a version.
  7. Esc returns focus.
- **e2e-visual `scribe-v2`:** dock, proposal and sheet at 1440, and full screen with each segment at 390. Asserts no horizontal scroll, both reduced-motion states (use `page.emulateMedia`), and contrast of the primary button.
- **e2e-onboarding:** runs unchanged as a regression check, confirming that R1 no longer leaks a Scribe block after sign-in.

## §0 locked (Emilio, 2026-09-27 10:00 CT)
- D1 Edits live in the **server package**; every accepted batch is an immutable run; runs are the version history.
- D2 **Structured edit ops** (replace/insert/remove on stable block ids); templates gain `data-node` with a pixel-identity visual test.
- D4 Preview = **server-rendered HTML in a sandboxed `srcdoc` iframe**; the CSP probe spec gates FE lanes.
- D5+D6 v1 = **resume + cover letter, light theme only**.
- D3 (streamed stage updates over fetch, poll fallback) and D7 (direct typing saves a "manual" version) take the spec's recommendations.
