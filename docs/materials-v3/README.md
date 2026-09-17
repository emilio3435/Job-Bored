# Materials v3 — Volt

Replacement design for JobBored resume + cover-letter generation: a new visual system **and** a new backend operating mechanism. Supersedes the "Readout" proposal in PR #117 (`docs/materials-v2/`), which was rejected as archaic and document-y.

| Doc | What it is |
| --- | --- |
| [Visual system spec](../superpowers/specs/2026-09-17-materials-v3-volt-design.md) | Volt: tokens, type, layout grammar, three signature moves, forbidden list, template contract, variants, acceptance criteria |
| [Operating mechanism spec](../superpowers/specs/2026-09-17-materials-v3-mechanism-design.md) | Fifteen-stage pipeline, seven data contracts, claim ledger, fit solver, delint, QA + rubric, JobBored↔Hermes executor boundary, BYOK/gemini-flash alignment |
| [Implementation plan](../superpowers/plans/2026-09-17-materials-v3.md) | Nine slices with file maps, acceptance criteria, and the tests that must change on purpose |
| [Side by side](side-by-side.md) | Why the #117 mocks read archival, signal by signal, and the mechanism gaps this package closes |
| [3E mocks + artifacts](mocks/3e-ai-marketing-analytics-manager/) | Print-ready HTML and PDF, ATS text twins, and one fixture per pipeline contract |

## The short version

**Visually:** white sheet, two vendored families (Geist + JetBrains Mono), one electric indigo accent, one column, whitespace as the primary material. Three signature moves and no fourth: the caret after the name, the statement block with one highlighted clause, and verified metrics set in mono so numbers read as data. No serif, no cream, no texture, no page frame, no chips, no charts.

**Mechanically:** facts move into a normalized claim ledger, layout moves into dumb templates over `materials.render-model.v1`, and pagination moves into a deterministic fit solver with an ordered trim ladder. The model makes three narrow, schema-bound calls — extract, select-by-ID, draft — plus a conditional anti-AI pass that never sees the posting. Every stage writes an inspectable artifact and appends to a `run.json` ledger.

## Fixture snapshot (3E, Volt 1.0)

| | |
| --- | --- |
| Resume | 1 page, 376 visible words, 2 featured employers, 3 bullets each |
| Cover letter | 1 page, 200 words, 4 paragraphs |
| LLM calls | 3 of 4 allowed (delint's rewrite was skipped — the deterministic prepass found nothing) |
| QA | rubric 11/12, 12 checks pass, 1 review: `constraint_conflict` (Denver vs Colorado-excluding-Denver) |

Open the HTML mocks in a browser and print-preview at US Letter. They are the acceptance snapshot for layout and voice; implementation should beat them on process, not clone the prose.
