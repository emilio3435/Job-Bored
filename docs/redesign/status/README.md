# Dossier Direction F — lane status files

Each lane worker writes a JSON status file here when it finishes (or blocks).
The orchestrator reads these to decide whether phase 2 can proceed.

## Schema

```json
{
  "lane": "ats-state-bus" | "writeback-bridge" | "css" | "brief" | "workshop" | "integration" | "tests-screens",
  "branch": "dossier-df/<lane>",
  "status": "in-progress" | "completed" | "blocked",
  "files_changed": ["string", "..."],
  "tests_run": [
    { "command": "npm test -- ...", "result": "passed" | "failed", "notes": "optional" }
  ],
  "screenshots": ["docs/redesign/screenshots/...png", "..."],
  "events_emitted_or_listened": [
    "jb:ats:state",
    "jb:ats:state:request",
    "jb:ats:modal:open",
    "jb:role:writeback"
  ],
  "contract_concerns": "free-form text or null",
  "notes": "free-form text or null",
  "started_at": "ISO 8601 timestamp",
  "ended_at": "ISO 8601 timestamp"
}
```

## File naming

`dossier-df-<lane>.json` — matches the handoff file naming under
`docs/redesign/handoffs/`.

Examples:
- `dossier-df-ats-state-bus.json`
- `dossier-df-writeback-bridge.json`
- `dossier-df-css.json`
- `dossier-df-brief.json`
- `dossier-df-workshop.json`
- `dossier-df-integration.json`
- `dossier-df-tests-screens.json`

## Orchestrator readiness check

Phase 2 (integration + tests-screens) may proceed only when all five phase-1
files exist with `"status": "completed"`:

```bash
for lane in ats-state-bus writeback-bridge css brief workshop; do
  jq -e '.status == "completed"' \
    "docs/redesign/status/dossier-df-$lane.json" >/dev/null \
    || echo "[$lane] not ready"
done
```
