# Reference

Authoritative lookup tables for configuration, data shapes, dependencies, and source docs.

## Pages

- [Configuration](configuration.md) — env vars + `config.js` overrides per app
- [Data models](data-models.md) — Pipeline schema, UserProfile, discovery webhook
- [Dependencies](dependencies.md) — runtime deps with one-line purposes

## Source-of-truth files

| File | Purpose |
| --- | --- |
| `schemas/pipeline-row.v1.json` | Pipeline row contract |
| `schemas/discovery-webhook-request.v1.schema.json` | Discovery webhook contract |
| `schemas/ats-scorecard-request.v1.schema.json` | ATS scorecard request |
| `schemas/ats-scorecard-response.v1.schema.json` | ATS scorecard response |
| `server/contracts/user-profile.schema.json` | UserProfile JSON schema |
| `integrations/browser-use-discovery/src/contracts.ts` | Worker TypeScript contracts |
| `integrations/browser-use-discovery/src/contracts/user-profile.ts` | UserProfile TypeScript twin |
