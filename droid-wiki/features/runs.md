# Runs log

The `DiscoveryRuns` sheet tab is the auditable record of discovery runs. The worker appends one row per run; the dashboard's Discovery drawer → History tab reads them.

## Modules

| File | Role |
| --- | --- |
| `runs-tab.js` | Reads `DiscoveryRuns` and renders the history list |
| `integrations/browser-use-discovery/src/sheets/discovery-runs-writer.ts` | Worker writer |
| `tests/runs-tab.test.mjs` | Renderer tests |

## Row shape

Per [sheets writer](../apps/discovery-worker/sheets-writer.md): `RunId`, `StartedAt`, `Status`, `Counts` (scouted / scored / written), `Companies`, `SourcesUsed`, `Errors`. Extra columns are tolerated.

## Empty / missing tab

If the `DiscoveryRuns` tab doesn't exist on the user's sheet, `runs-tab.js` shows a friendly empty state with a one-click "Add this tab" link.

## Related

- [Discovery feature](discovery.md)
- [Discovery worker · Sheets writer](../apps/discovery-worker/sheets-writer.md)
