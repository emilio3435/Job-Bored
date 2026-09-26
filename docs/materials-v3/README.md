# Materials v3 — Volt template registry

This is the replacement design for JobBored's resume and cover-letter generation. It has two parts: a visual system, which is now a **template registry**, and a new backend operating mechanism. It supersedes the "Readout" proposal in PR #117 (`docs/materials-v2/`), which was rejected as archaic and document-y.

| Doc | What it is |
| --- | --- |
| [Visual system spec](../superpowers/specs/2026-09-17-materials-v3-volt-design.md) | Volt as the shared design language (tokens, facts-only rule, template contract, QA hooks, forbidden list), and the template registry: families, registry rules, the `materialsTemplate` setting, and regeneration (§9) |
| [Operating mechanism spec](../superpowers/specs/2026-09-17-materials-v3-mechanism-design.md) | The fifteen-stage pipeline, seven data contracts, claim ledger, fit solver, delint, QA and rubric, the JobBored↔Hermes executor boundary, and BYOK/gemini-flash alignment |
| [Implementation plan](../superpowers/plans/2026-09-17-materials-v3.md) | Slices with file maps and acceptance criteria. Slice 3 builds the registry, slice 3b the setting and "regenerate in another template", and slice 7 folds `visual-themes.js` into the registry |
| [Side by side](side-by-side.md) | Why the #117 mocks read archival, how Volt 1.0 became a registry of three families, and the mechanism gaps this package closes |
| [3E mocks + artifacts](mocks/3e-ai-marketing-analytics-manager/) | One reference fixture per family (HTML, PDF, design notes), the Volt 1.0 history, and one fixture per pipeline contract |

## The short version

**Visually:** one pipeline, several looks. Volt is the rulebook every template follows: a white sheet, one electric indigo accent, official logos rendered unaltered, figures set as data only when they come from the claim ledger, vendored fonts, the name first in reading order, and one page proven by layout measurement. The templates are families in a registry, and a user picks one in materials preferences:

| Family | From | The idea |
| --- | --- | --- |
| **`signal`** (default) | bake-off take C | The page as a precision instrument: a narrow Volt band with a tick scale, a readout strip of verified figures, and a logo-labelled log |
| `dossier` | take A | Every proof point at once: a hung gutter of verified numbers, and a rail of logos and stack per employer |
| `editorial` | take B | A magazine profile: a Bodoni display name, the statement as a pull quote, and a logo-anchored timeline spine |

More families can be added under the registry rules. Each package records the family it was rendered in and can be regenerated in another family without an LLM call.

**Mechanically:** facts move into a normalized claim ledger, layout moves into dumb templates over `materials.render-model.v1`, and pagination moves into a deterministic fit solver with an ordered trim ladder. The model makes three narrow, schema-bound calls (extract, select-by-ID, draft), plus a conditional anti-AI pass that never sees the posting. Every stage writes an inspectable artifact and appends to a `run.json` ledger.

## Fixture snapshot (3E)

| | signal | dossier | editorial | Volt 1.0 (history) |
| --- | --- | --- | --- | --- |
| Resume | 1 page, 483 words | 1 page, 497 words | 1 page, 492 words | 1 page, 376 words |
| Letter body | 203 words | 203 words | 203 words | 200 words |
| Claims used | all 13 | all 13 | all 13 | 10 of 13 |
| Logos | yes | yes | yes | none |
| Fonts offline today | no (Archivo, Martian Mono on Google Fonts) | yes | no (Bodoni Moda on Google Fonts) | yes |
| Blind judge (weighted) | 70 | 61 | 58 | baseline |

The pipeline fixtures (`jd-extract` → `run`) record the 3E run: 3 of 4 allowed LLM calls (delint's rewrite was skipped because the deterministic prepass found nothing), and QA with a rubric of 11/12, 12 checks passing and 1 review, `constraint_conflict` (Denver vs Colorado-excluding-Denver). Those measurements were taken on the Volt 1.0 render. The family mocks are hand-set reference designs over the full ledger, not renders of that render model. Slice 8 regenerates the package through the real loop.

Open the HTML mocks from inside the repo checkout (fonts and logos are referenced relatively) and print-preview them at US Letter. They are the acceptance snapshot for layout and voice. The implementation should beat them on process, not clone their prose.
