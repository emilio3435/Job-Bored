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

## Transport — where does your agent run? (pick your adventure)

The endpoint defaults to `127.0.0.1`. How your agent reaches it depends on where the agent runs relative to the worker:

**Tier 1 — Same machine (default, easiest).** Agent and worker on one box → POST to `http://127.0.0.1:8644/pipeline-update`. Zero networking, nothing leaves the device. Best for local/dev and most self-hosters.

**Tier 2 — Agent elsewhere, worker on your machine (tunnel).** If your agent runs on another box or in the cloud, expose the worker over a tunnel and POST to that URL. **Tailscale Funnel** gives a *stable* HTTPS `.ts.net` address (`tailscale funnel --bg 8644`); ngrok works too. Trade-off: the worker becomes publicly reachable (still secret-gated) and the secret travels the internet over TLS — keep it private, rotate if leaked.

**Tier 3 — Always-on hosted worker (cloud relay/deploy).** Deploy the worker to an always-on host (Render / Cloud Run / Fly; the repo supports it) so any agent reaches it 24/7, independent of your laptop. Most robust; you host the worker and its Google credential.

**Agent capability check (Tiers 2–3).** The mirror is a `POST` with a custom header and JSON body. Some agent URL tools are GET-only — confirm yours can send an authenticated POST (custom header + body), or drive it from a runtime that can (shell, SDK). If your agent cannot make an authenticated POST at all, prefer Tier 1 (co-locate) or have the agent write the Sheet directly via a Google Sheets connector instead.

**Secret handling (Tiers 2–3).** Never hardcode the webhook secret in an agent's prompt — prompts are stored and readable. Inject it through a task/env secret store, read it from a mounted file at runtime, or keep the call on a machine that already holds the secret (`~/.jobbored/browser-use-discovery/.env`).

## Wiring the job-opportunity-watcher (reference agent)

This is a change to your **agent's** prompt, not the repo. After the watcher records a
new development in its tracker, add a step that POSTs the update above with the
matching job's URL and the new stage/note. The watcher keeps drafting replies as before —
this only mirrors progressions into the Pipeline so the dashboard card moves.
