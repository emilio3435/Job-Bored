# Materials editor: UX research (Opus agent, 2026-09-27)

**Core bet:** the LLM returns **structured edit ops** against a resume model where every section, entry and bullet has a stable ID. It never returns HTML or free prose. The ops are:
- `{op:"replace", id, text}`
- `{op:"remove", id}`
- `{op:"insert", after, text}`

Why this matters:
- **Structural diffs:** operations keyed by ID are what make a structural diff possible.
- **Locked facts:** a locked field can simply refuse any operation aimed at it.
- **Template integrity:** the model never touches markup, so formatting can't break.
- **Streaming:** changes can be applied one operation at a time.
- **Validation:** operations go through the existing `structured-output-validator.js` before they are applied.

## 1. Patterns to borrow
- **Chat drives, the document shows.** Chat sits in a narrow column; the rendered resume sits in a wide one. A message produces a proposal, which appears on the document as marks. The chat bubble only summarizes it, for example "4 changes · 1 removal · +12 words · still 1 page".
- **Suggesting mode, inline on the document:**
  - insertions are underlined;
  - deletions are struck through;
  - each changed block gets a margin mark.
  Side-by-side is used only for comparing versions, never for reviewing a live proposal.
- **Accept or reject each change:** a ✓/✗ sits in the margin of each change.
  - "Accept all" is the primary button; "Reject all" is secondary.
  - Keys: `j`/`k` move between changes; `a`/`r` accept or reject the focused one.
  - Nothing is saved as a version until the user accepts.
- **Quick-action chips:** Punchier, Shorter, Fit to 1 page, Match JD keywords, More formal, Quantify.
  - A chip pre-fills an editable prompt. It never sends on its own.
  - Every request carries a scope: the whole document or the current selection.
- **Selection-scoped edits:** selecting text or focusing a bullet opens a popover with Rewrite / Shorten / Emphasize… / Ask.
  - The request carries `scope: [ids]`.
  - The server rejects any operation outside that scope.
- **Version timeline:** a linear list.
  - Each entry shows the prompt that produced it, a timestamp, and the change in words and pages.
  - Restoring appends a new version ("Restored from v4"); it never deletes anything.
  - Pin or star important versions. No branching.
- **Undo:** Cmd/Ctrl+Z undoes the last accepted batch, with a toast to confirm. Chat undo is kept separate from text undo.
- **Optimistic UI with honest progress:**
  - The user's message appears immediately.
  - While the proposal streams in, the document shows `aria-busy`.
  - The status reads in stages: Reading resume → Drafting 3 edits (2/3) → Checking facts → Measuring length.
  - A Stop button keeps every operation that has already finished and marks the proposal as partial.

## 2. Diffing
**Two levels.**
1. **Structural diff by ID:** detects bullets and sections that were added, removed, moved or changed.
2. **Word-level diff inside each changed bullet:**
   - Tokenize on `/(\s+|[.,;:()\/])/`.
   - Merge the unchanged gaps of two words or fewer between changes, so the highlighting doesn't turn into confetti.

**Library:** vendor fast-myers-diff (MIT, under 4 KB, O(ND), works on arrays). The fallback is roughly 120 lines of hand-written Myers.

**Accessible rendering:**
- Use `<ins>`/`<del>` plus visually hidden "inserted: … end inserted" text. Screen readers don't reliably announce ins/del.
- Insert style: mint-tint background plus a 2px underline.
- Delete style: strikethrough in `--jb-err`.
- Margin glyph: `+`, `−` or `~`.
- A changed block gets a 3px left rule: navy while pending, mint once accepted.
- A "Show changes" toggle (key `D`) switches the marks on and off.

## 3. Live preview
**Live:**
- An `<iframe srcdoc>` renders the same `templates/materials/<family>/resume.html` and CSS that the PDF uses.
- Each operation is applied to a shadow model, and only the changed node is patched by `data-id`, throttled to 150 ms.
- A live page count comes from `scrollHeight` against the page box, with a dashed page-break line.

**On demand:**
- The PDF is built when requested: "Rendering PDF…" → "Ready · 2s · 1 page".
- The preview is labelled "approximate" until a PDF exists for the current version hash; after that it reads "Matches PDF".

**Streaming:** tokens stream into the chat bubble's proposal line and into a single "writing…" bullet. The preview commits whole operations only; tokens never stream straight into the document.

## 4. Accessibility and keyboard
- **Landmarks and focus:**
  - Chat is `role="log"` (polite).
  - The document is a named region: "Resume, version 7".
  - The timeline is a list.
  - F6 cycles focus between the three.
  - Esc closes and returns focus to the element that opened the editor.
- **Announcements:**
  - One polite status region, announced at stage changes and at the end.
  - Assertive only for errors or blocked edits.
  - Never announce individual tokens.
- **Reduced motion:** no typewriter effect and no highlight fade; fades only. Motion tokens are 120, 200 and 320 ms.
- **Targets:** at least 44 px on phones, with explicit labels such as "Accept change 2 of 4: summary".

## 5. Layout: a dock that becomes a sheet
**At rest:** a collapsed dock bar at the bottom of the role section. It shows:
- the version;
- the page count;
- the last change;
- a one-line composer.

**When a proposal lands:** the dock grows to about 40vh. "Expand" opens a 92vh bottom sheet at `--jb-z-drawer`.

**1440 px:**
- Document on the left, about 62%.
- Chat on the right, about 38%, with Chat and Versions tabs.
- Compare puts two columns in the document pane.

**390 px:**
- Full screen, with a Doc / Chat / Versions segmented control.
- The composer is pinned using `visualViewport`.
- The editor auto-switches to Doc when a proposal arrives, with a sticky "4 changes · Accept all" bar.
- Compare becomes an A/B toggle.

## 6. Guards against LLM-specific failures
- **Invented facts:** check every proposal against the source profile (master resume plus fit profile) for new proper nouns, numbers, dates, titles and skills. Anything new is marked "Unverified", needs its own confirmation, and is skipped by Accept all.
- **Locked facts:** employer, title, dates, degree and metrics are locked by default. The server blocks any `replace` on a locked span, and the chat shows that it was blocked.
- **Silent content loss:**
  - A loss meter per proposal.
  - Every `remove` is a separate change.
  - A banner if more than 20% of the words would be removed.
- **Length drift:** a target page count is set once. Anything past it shows an overflow line and a "Trim to fit" chip.
- **Formatting damage:** impossible by construction. Operations carry text only, and markdown and HTML are stripped out.
- **Keyword stuffing:** show keyword coverage before and after. Flag any keyword that appears in more than two bullets.
- **Never overwrite:** every accepted batch becomes a new version. v0 (the original upload) is pinned and can't be deleted.

**Sources:**
- fast-myers-diff (gliese1337)
- MDN `<del>`
- manuelsanchezdev.com on screen readers and ins/del
- WAI-ARIA `role=log` and `aria-live`

**Grounding:**
- Three template families share `templates/materials/*/family.schema.json`.
- The motion tokens are 120, 200 and 320 ms; the drawer z-index is 800.
- `role-materials.js` has no diff and no version history.
