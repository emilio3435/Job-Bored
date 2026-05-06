# Contract changelog

Human-readable history of changes to **[AGENT_CONTRACT.md](../AGENT_CONTRACT.md)**, **[schemas/](../schemas/)**, and **[examples/](../examples/)**. For the roadmap (fixtures, CI, pipeline schema), see **[CONTRACT-HARDENING-PLAN.md](CONTRACT-HARDENING-PLAN.md)**.

| Date (UTC) | Change                                                                                                                                                                                             | Compatibility                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 2026-05-06 | Added optional discovery webhook `companyAllowlist` for per-run company picker overrides. Updated schema, example fixture, and `AGENT_CONTRACT.md`; no `schemaVersion` bump because old receivers can ignore the field. | Additive — optional request field.          |
| 2026-04-09 | ATS server now auto-loads `server/.env` (`dotenv`) and exposes ATS config status in `/health`; added persistent env template `server/ats-env.example`.                                             | Additive — runtime configuration hardening. |
| 2026-04-09 | Added ATS scorecard contracts: `schemas/ats-scorecard-request.v1.schema.json`, `schemas/ats-scorecard-response.v1.schema.json`, and fixtures under `examples/`. Added `npm run test:ats-contract`. | Additive — new ATS interface contract.      |
| 2026-04-08 | Added `examples/discovery-webhook-request.v1.json` and `examples/discovery-webhook-request.v1-with-profile.json` aligned with `triggerDiscoveryRun` in `app.js`.                                   | Additive — examples only.                   |
| 2026-04-08 | Documented **Webhook receiver checklist** in `AGENT_CONTRACT.md` (CORS, 2xx, OPTIONS). Linked from `SETUP.md`.                                                                                     | Additive — documentation.                   |
| 2026-04-08 | Introduced **`npm run test:contract`** — validates example JSON against `schemas/discovery-webhook-request.v1.schema.json` and checks discovery `payload` keys in `app.js` match the schema.       | Additive — CI/dev tooling.                  |
| 2026-04-08 | Added **`schemas/pipeline-row.v1.json`** and **`npm run test:pipeline-contract`** — Pipeline header row + enums aligned with README and `app.js` status/priority lists.                            | Additive — machine-readable Interface A.    |
| 2026-04-08 | Added **`npm run lint:skills`**, **`npm run test:contract:all`**, **[CONTRIBUTING.md](../CONTRIBUTING.md)** contract checklist; GitHub **Validate contract** runs the full suite.                  | Additive — contributor + CI tooling.        |

**Versioning reminder:** Breaking changes to the discovery POST body should bump **`schemaVersion`** in the schema, `app.js`, and this log, with a migration note for implementers.
