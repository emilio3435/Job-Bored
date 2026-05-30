# Hermes (JHOS)

Active contributors: emilio3435

## Purpose

`integrations/hermes-job-hunt/` is the optional Python orchestrator for resume + cover-letter drafting. It runs locally (typically out of `~/.hermes/job-hunt/.venv`), reads Pipeline rows, generates materials, and drops them under `~/.hermes/job-hunt/applications/<slug>/` so the scraper server's materials API can serve them to the dashboard.

It is also the historical home of an apply-bot path (Gates 1–6) that has been shelved; the materials lane is the active surface.

## Directory layout

```
integrations/hermes-job-hunt/
├── requirements.txt
├── scripts/
│   ├── materials-request.sh        # Entry: requested by the scraper server
│   ├── materials-from-pending.py   # Reads pending.json → draft
│   ├── repair-materials.sh         # Repair entry
│   ├── promote-to-approved.sh      # Move draft to approved state
│   ├── pipeline-reconcile.py       # Reconcile sheet ↔ disk
│   └── ...
├── resume-template/                # ATS-safe DOCX/HTML template
├── cover-letter-template/          # Letter template
├── profile/                        # Hermes-side profile JSON (legacy; migrate to ~/.jobbored/profile.json)
├── tests/
└── HANDOFF-*.md, SKILL.md, README.md
```

## Lifecycle

```mermaid
graph LR
    A[Dashboard: Request materials] --> B[POST /api/applications/:slug/request]
    B --> C[server spawns materials-request.sh]
    C --> D[materials-from-pending.py<br/>reads pending.json + JD]
    D --> E[LLM drafts resume + letter]
    E --> F[Render via DOCX/HTML templates]
    F --> G[Write files under<br/>~/.hermes/job-hunt/applications/<slug>/]
    G --> H[Scraper server lists files<br/>materials-queue.js / role-materials.js]
    H --> I[User reviews in Dossier]
    I --> J[promote-to-approved.sh / repair-materials.sh]
```

## Gates (legacy apply-bot path)

- **Gate 0** — Pre-flight (URL valid, profile present)
- **Gate 1** — Approval required: `approvalStatus = "Approved"` in column X
- **Gate 2** — Application form readiness (Browser Use session)
- **Gate 3** — Materials present (resume + letter PDF/DOCX)
- **Gate 4** — Submit confirmation
- **Gate 5** — Post-submit logging (Pipeline write-back)
- **Gate 6** — Verification follow-up

The apply-bot gates are documented in handoff notes and `SKILL.md`. They are **not** active in the current dashboard surface — Hermes today operates only on Gate 0 / 3 / 5 for the materials lane.

## Integration points

- **Scraper server** — the only HTTP boundary. The server spawns Hermes scripts and reads their output manifests.
- **Pipeline sheet** — Hermes reads via the same OAuth / service account as the worker; reconcile script writes status changes.
- **User profile** — `~/.jobbored/profile.json` (the canonical UserProfile) is the source of truth. `legacy-profile-migrator.mjs` in the server migrates the older Hermes-local profile into it.

## Entry points for modification

- New materials format → add a template under `resume-template/` or `cover-letter-template/` and wire it in `materials-from-pending.py`.
- New gate / lifecycle hook → add a script under `scripts/` and surface it via the scraper server (`server/application-materials.mjs` / `materials-request.mjs`).
- Quality gates (sparse-resume detection, weak-letter detection) live in `server/materials-quality.mjs` — server-side, not Python-side.

## Tests

- `integrations/hermes-job-hunt/tests/` (Python)
- Root-side coverage in `tests/application-materials.test.mjs`, `tests/materials-request-endpoint.test.mjs`, `tests/materials-repair.test.mjs`

## Related

- [Scraper server](scraper-server.md) — the HTTP layer in front of Hermes
- [Materials feature](../features/materials.md) — the browser surface
- [Background / Hermes history](../background/index.md)
