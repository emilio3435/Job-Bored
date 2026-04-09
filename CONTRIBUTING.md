# Contributing

## Contract changes (discovery webhook + Pipeline sheet)

The agent–dashboard contract is documented in **[AGENT_CONTRACT.md](AGENT_CONTRACT.md)** and **[docs/CONTRACT-HARDENING-PLAN.md](docs/CONTRACT-HARDENING-PLAN.md)**. If you change how the dashboard **sends** discovery webhooks or **reads/writes** Pipeline columns, keep machine-checkable artifacts in sync.

### Discovery POST (Interface B)

When **`triggerDiscoveryRun`** in [app.js](app.js) or [schemas/discovery-webhook-request.v1.schema.json](schemas/discovery-webhook-request.v1.schema.json) changes:

1. Update the JSON Schema and **[examples/](examples/)** fixtures.
2. Update **[AGENT_CONTRACT.md](AGENT_CONTRACT.md)** and a row in **[docs/CONTRACT-CHANGELOG.md](docs/CONTRACT-CHANGELOG.md)**.
3. Run **`npm run test:contract`** (also **`npm run test:contract:all`** before pushing).

### Pipeline rows (Interface A)

When **status dropdown values**, **priority symbols**, **response (S) values**, **column headers**, or **`parsePipelineCSV`** column indices in [app.js](app.js) change:

1. Update **[schemas/pipeline-row.v1.json](schemas/pipeline-row.v1.json)** (header row + enums).
2. Align **[README.md](README.md)** Sheet Structure and **[AGENT_CONTRACT.md](AGENT_CONTRACT.md)** as needed.
3. Run **`npm run test:pipeline-contract`** (or **`npm run test:contract:all`**).

### Integration skills

Files under **`integrations/**/SKILL.md`** must reference **`AGENT_CONTRACT.md`** and **`schemas/discovery-webhook-request.v1.schema.json`** (checked by **`npm run lint:skills`\*\*).

### Deferred roadmap items

**Phase 3** (optional discovery response body) and **Phase 5** (ecosystem / n8n export / ClawHub) in the hardening plan are **not** part of the core repo contract until product prioritizes them; see [docs/CONTRACT-HARDENING-PLAN.md](docs/CONTRACT-HARDENING-PLAN.md).
