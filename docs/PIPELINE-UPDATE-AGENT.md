# Driving the pipeline from an external agent

The discovery worker exposes `POST /pipeline-update` (local-first, `x-discovery-secret`).
Any agent that detects a job-search development can advance the matching Pipeline row.

## Request

```bash
curl -s -X POST http://127.0.0.1:8644/pipeline-update \
  -H "content-type: application/json" \
  -H "x-discovery-secret: $BROWSER_USE_DISCOVERY_WEBHOOK_SECRET" \
  -d '{
    "event": "command-center.pipeline-update",
    "schemaVersion": 1,
    "sheetId": "<your-sheet-id>",
    "job": { "url": "<job url already in your pipeline>" },
    "fields": { "stage": "Interviewing", "lastContact": "2026-06-18", "note": "recruiter replied", "didTheyReply": "Yes" }
  }'
```

Response: `{ "ok": true, "updated": true, "matchedBy": "url", "row": <n> }`.
Unknown row → `404`; bad secret → `401`. See `AGENT_CONTRACT.md` for the full field list.

## Wiring the job-opportunity-watcher (reference agent)

This is a change to your **agent's** prompt, not the repo. After the watcher records a
new development in its tracker, add a step that POSTs the update above with the
matching job's URL and the new stage/note. The watcher keeps drafting replies as before —
this only mirrors progressions into the Pipeline so the dashboard card moves.
