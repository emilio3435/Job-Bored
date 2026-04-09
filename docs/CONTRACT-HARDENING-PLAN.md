# Plan: Hardening & improving the agent–dashboard contract

This plan extends **`AGENT_CONTRACT.md`**, **`schemas/`**, and **integrations** so the contract stays **clear**, **versioned**, **testable**, and **cheap to maintain**—without adding hosted infrastructure from project maintainers.

**In-repo progress:** Phase 1 complete; Phase 2 core (pipeline row descriptor + tests); Phase 4.1–4.3 complete (`npm run test:contract:all` includes discovery tests, pipeline tests, and skill lint; workflow [.github/workflows/validate-examples.yml](../.github/workflows/validate-examples.yml)). **Phase 3** and **Phase 5** remain optional (see [CONTRIBUTING.md](../CONTRIBUTING.md) “Deferred roadmap items”).

---

## Principles

1. **BYOK forever** — Users own Sheets, OAuth, webhooks; the contract describes behavior, not our servers.
2. **Backward compatibility** — Prefer additive changes; use `schemaVersion` and explicit migration notes for breaks.
3. **Machine-checkable** — Where possible, ship JSON Schema + examples so agents and CI can validate.
4. **Single source of truth** — README column table, `AGENT_CONTRACT`, skills, and app parsers must not diverge silently.

---

## Current inventory (baseline)

| Artifact                                                                                                          | Role                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [AGENT_CONTRACT.md](../AGENT_CONTRACT.md)                                                                         | Human-readable spec: Pipeline rules, discovery POST, empty states |
| [schemas/discovery-webhook-request.v1.schema.json](../schemas/discovery-webhook-request.v1.schema.json)           | JSON Schema for discovery POST (`schemaVersion` 1)                |
| [examples/discovery-webhook-request.v1.json](../examples/discovery-webhook-request.v1.json) (and \*-with-profile) | Offline copy-paste fixtures validated against the schema          |
| [examples/README.md](../examples/README.md)                                                                       | Index for example files + curl snippets                           |
| [integrations/openclaw-command-center/](../integrations/openclaw-command-center/)                                 | OpenClaw/Hermes-oriented skill text                               |
| `app.js` `triggerDiscoveryRun`                                                                                    | Authoritative **sender** of discovery payload                     |
| [`schemas/pipeline-row.v1.json`](../schemas/pipeline-row.v1.json)                                                 | Machine-readable Pipeline column layout + enums + header row      |

---

## Gaps & risks (to address)

| Gap                                                                                                     | Risk                                                                              |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Example JSON fixtures** — [`examples/`](../examples/) + [`examples/README.md`](../examples/README.md) | Addressed: copy-paste shapes + schema validation                                  |
| Pipeline **row descriptor** + CI vs `app.js` / README                                                   | Addressed: `schemas/pipeline-row.v1.json` + `npm run test:pipeline-contract`      |
| **Response** body for discovery webhook undefined                                                       | Agents cannot return structured job ids / errors                                  |
| **Resume / generation** webhook documented in SETUP but not unified with “contract” story               | Two “contracts” feel unrelated                                                    |
| **CI (discovery)**                                                                                      | `npm run test:contract` + GitHub **Validate contract** — fails on discovery drift |
| Skills can drift from `AGENT_CONTRACT`                                                                  | Mitigated by `npm run lint:skills`                                                |

---

## Phase 1 — Documentation & fixtures (low effort, high clarity)

**Goal:** Anyone can implement Interface A or B in an afternoon without reading the whole repo.

| #   | Deliverable                                                                                                       | Notes                                     |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1.1 | Add **`examples/discovery-webhook-request.v1.json`**                                                              | Minimal valid POST body matching `app.js` |
| 1.2 | Add **`examples/discovery-webhook-request.v1-with-profile.json`**                                                 | Full `discoveryProfile` populated         |
| 1.3 | Extend **`AGENT_CONTRACT.md`** with “Copy-paste checklist” for webhook receiver (CORS, 2xx, OPTIONS if preflight) | Link from SETUP                           |
| 1.4 | Add **“Contract changelog”** subsection in `AGENT_CONTRACT.md` or `docs/CONTRACT-CHANGELOG.md`                    | Date + what changed + compat notes        |

**Exit criteria:** New contributor can validate payloads with `examples/` + JSON Schema offline.

**Progress:** 1.1–1.4 shipped.

---

## Phase 2 — Pipeline contract as data (medium effort)

**Goal:** Reduce ambiguity on column types, allowed enums, and header row.

| #   | Deliverable                                                                                   | Notes                                                                           |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 2.1 | **`schemas/pipeline-row.v1.json`** (or CSV descriptor)                                        | Column id, letter, header label, type, optional `enum` for Status/Priority      |
| 2.2 | Document **header row literal** expected in template (exact strings)                          | Helps script validation                                                         |
| 2.3 | Optional **Google Apps Script** or **small Node script** `scripts/validate-sheet-headers.mjs` | Reads Sheet via service account or user token; optional; documented as dev-only |
| 2.4 | Align **README** Sheet Structure table with `pipeline-row` schema                             | Single source: generate table from JSON or add CI check                         |

**Exit criteria:** Enum values for Status (M) and Priority (I) match between docs, schema, and UI (`status-select` in `app.js`).

**Progress:** 2.1–2.2 and 2.4 shipped (`schemas/pipeline-row.v1.json`, README/contract links, `test:pipeline-contract`). 2.3 (optional live Sheet header validation) remains optional.

---

## Phase 3 — Webhook response & observability (optional, version carefully)

**Goal:** Let agents return structured acknowledgment without breaking existing receivers.

| #   | Deliverable                                                                                 | Notes                                          |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 3.1 | **Propose** optional `response` body convention (e.g. `{ "accepted": true, "runId": "…" }`) | **Non-breaking**: dashboard ignores body today |
| 3.2 | If useful, add **`schemaVersion` 2** only for **new** optional request fields               | Keep v1 clients working                        |
| 3.3 | Log **request id** in dashboard (`variationKey` already unique per click)                   | Easier support: user matches agent logs        |

**Exit criteria:** No change required for existing webhooks; new fields are optional and documented.

---

## Phase 4 — Automation & CI

**Goal:** Catch drift automatically.

| #   | Deliverable                                                   | Notes                                                                                                                      |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | **`npm run test:contract`** (or GitHub Action)                | Validate `examples/*.json` against `schemas/*.schema.json`; assert `triggerDiscoveryRun` payload keys match schema         |
| 4.2 | **Lint** `integrations/**/SKILL.md`                           | **`npm run lint:skills`** — requires substrings `AGENT_CONTRACT.md` and `schemas/discovery-webhook-request.v1.schema.json` |
| 4.3 | **Pre-release checklist** in `CONTRIBUTING.md` or release doc | “If you change discovery payload, update schema + examples + AGENT_CONTRACT”                                               |

**Exit criteria:** CI fails if `app.js` discovery payload and schema diverge; pipeline tests fail if Pipeline enums/headers diverge from `app.js` / README.

**Progress:** 4.1–4.3 shipped (`lint:skills`, `CONTRIBUTING.md`, `test:contract:all` in CI).

---

## Phase 5 — Ecosystem

**Goal:** Distribution without maintainer infra.

| #   | Deliverable                                        | Notes                                                    |
| --- | -------------------------------------------------- | -------------------------------------------------------- |
| 5.1 | Publish **OpenClaw skill** to ClawHub (when ready) | Points to tagged release                                 |
| 5.2 | **“Contract compliance”** badge or README section  | “Implements AGENT_CONTRACT v1” for third-party templates |
| 5.3 | **n8n workflow export** (JSON) in `examples/`      | Optional; same webhook + Sheets append pattern           |

---

## Non-goals (explicit)

- Running a **central** webhook or queue for users (violates BYOK).
- **Breaking** existing sheets or v1 webhooks without a major version and migration guide.
- Full **OAuth** server or user database for agents.

---

## Success metrics (lightweight)

- Time for a new implementer to ship **first valid row** (self-reported or community feedback).
- **Zero** silent README vs `app.js` drift for discovery fields (CI enforces).
- **Issues** labeled `contract` trend down after Phase 1–2.

---

## Suggested order of execution

**Current repo:** Phases **1**, **2** (2.1–2.2, 2.4), and **4** (4.1–4.3) are implemented; next optional work is **3** and **5** when prioritized.

1. Phase **1** (fixtures + changelog) + link from `AGENT_CONTRACT.md`
2. Phase **2** (pipeline row schema + header alignment)
3. Phase **4** (minimal CI on examples + schema)
4. Phase **3** only if users need structured responses
5. Phase **5** when the contract stabilizes for a release tag

---

## Related links

- [AGENT_CONTRACT.md](../AGENT_CONTRACT.md)
- [schemas/](../schemas/)
- [integrations/openclaw-command-center/](../integrations/openclaw-command-center/)
