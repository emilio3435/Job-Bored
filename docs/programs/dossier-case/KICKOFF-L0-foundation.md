# Kickoff · L0 foundation (claim A) — the shared text substrate

Read `docs/programs/dossier-case/GROUND-RULES.md` first. Then execute, in order and exactly as written:

- Resilience plan **Task 1** — `jb-text.js` (`window.JobBoredText`) + `tests/jb-text.test.mjs` + the `index.html` script tag before `jb-ui.js`.
- Resilience plan **Task 2** — `server/shared/text-normalize.mjs` + `tests/text-normalize.test.mjs`.

Plan: `docs/superpowers/plans/2026-08-31-dossier-render-resilience.md` (Tasks 1–2). Spec: `docs/superpowers/specs/2026-08-31-dossier-render-resilience-design.md` §3–§4.

**Mission.** Every other lane in this program imports what you build. Land the two modules with the exact public names in the plan (`decodeEntities, stripMarkdownInline, stripListGlyph, itemText, normalizeInline, normalizeMultiline, toBlocks, clip, escapeHtml, escapeAttr` on the client; `decodeHtmlEntities, stripMarkdownInline, stripListGlyph, normalizeJobText, normalizeInlineField, htmlToText` on the server).

**Fence.** Only the files in the L0 row of the ground rules. Do not touch any consumer.

**Non-negotiables.** Single-level entity decode (trap 4). Word-boundary clip with the prefix/boundary assertions as written (trap 5). The two `NAMED_ENTITIES` maps must be byte-identical between the client and server modules — diff them before you commit.

**Definition of Done.**
1. `node --test tests/jb-text.test.mjs tests/text-normalize.test.mjs` green.
2. `node --test tests/index-html-cold-start.test.mjs tests/index-html-size.test.mjs` green.
3. Full floor green (ground rules §Floor) — output pasted in `LANE-REPORT-L0.md` §4.
4. Two commits on your branch with the plan's messages.
