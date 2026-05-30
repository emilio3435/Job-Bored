# Data models

## Pipeline row (Interface A)

Authoritative schema: `schemas/pipeline-row.v1.json`. Mirror narrative in `AGENT_CONTRACT.md` and `README.md` "Sheet Structure".

Columns (abbreviated; see the schema for full constraints):

| Letter | Field | Notes |
| --- | --- | --- |
| A | Date Found | ISO date |
| B | Company | required |
| C | Role | required |
| D | Location | |
| E | Compensation | string (`$150k-200k`, etc.) |
| F | Source | `Greenhouse`, `LinkedIn`, etc. |
| G | Link | unique key for dedupe |
| H | Stage | enum |
| I | Priority | enum |
| J | Notes | |
| K | Applied At | ISO date |
| L | Last Contact | ISO date |
| M | Follow-up At | ISO date |
| N | Reply | enum (`Yes`, `No`, `Waiting`, …) |
| O | Heard Back | enum (`Yes`, `No`, `Maybe`) |
| ... | optional columns | `Source URL`, `Posted At`, `Fit Score`, `Match Reasoning`, `Pre-Filter Reason`, `Closed At`, `Cleanup Note`, `Approval Status`, … |

Enums for `Stage`, `Priority`, `Reply`, `Heard Back` are defined in the schema. The worker only writes "optional" columns when the user has the header on the sheet (see [sheets writer](../apps/discovery-worker/sheets-writer.md)).

## UserProfile

Authoritative schema: `server/contracts/user-profile.schema.json`. TypeScript twin: `integrations/browser-use-discovery/src/contracts/user-profile.ts`. Persisted at `~/.jobbored/profile.json` (atomic writes via `server/user-profile.mjs`).

Top-level fields:

```
{
  schemaVersion: 1,
  identity: { name, email?, phone?, location? },
  titles: string[],
  locations: string[],
  workAuthorization: string,
  compRange: { minUsd, maxUsd? },
  mustHaves: string[],
  niceToHaves: string[],
  dealbreakers: string[],
  fitWeights: { skills, comp, location, mission, growth },
  experience: ExperienceEntry[],
  skills: { primary: string[], secondary: string[], learning: string[] },
  resumes: ResumeSnapshot[],
  samples: SampleSnapshot[],
  preferences: { autoFollowupDays?, preferredOutreachChannels? },
  meta: { updatedAt, source }
}
```

Starter templates exist for common roles — see `buildStarterTemplate` in `server/user-profile.mjs`.

## Discovery webhook request

See [discovery webhook contract](../api/discovery-webhook.md) for the full payload table.

## DiscoveryRuns row

Written by the worker, read by `runs-tab.js`.

| Field | Description |
| --- | --- |
| `RunId` | UUID / ULID per run |
| `StartedAt` | ISO timestamp |
| `Status` | `completed`, `completed_with_errors`, `failed` |
| `Counts` | JSON-encoded `{ scouted, scored, written }` |
| `Companies` | Companies considered (comma list or JSON) |
| `SourcesUsed` | Source ids used (`ats_greenhouse`, `grounded_web`, …) |
| `Errors` | Error summary string |
| `WrittenLinks` | URLs written this run (optional) |

## Blacklist row

Two columns: `Link`, `Reason`. The worker reads before append; the dashboard's "Hide this" action appends.

## ATS scorecard

Authoritative: `schemas/ats-scorecard-request.v1.schema.json` and `..._response.v1.schema.json`. See [ATS feature](../features/ats-scorecard.md).

## Internal events (browser)

`AGENT_CONTRACT.md` "Dossier event family" documents:

- `jb:ats:state`, `jb:ats:state:request`, `jb:ats:modal:open`
- `jb:role:opened`, `jb:role:closed`, `jb:role:action`, `jb:role:note`, `jb:role:writeback`
- `jb:pipeline:move`

These are not part of the agent contract; they are dispatched on `window` and `document` for cross-module coordination.

## Related

- [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md)
- [Discovery webhook contract](../api/discovery-webhook.md)
