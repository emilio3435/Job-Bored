# Flash family resolution repair

Goal: remove the outdated Flash version pin and keep onboarding, drafting, and discovery on the selected moving Flash family.
Success means: legacy generated pins normalize correctly, the provider receives a valid moving alias, saved choices stay logical, explicit other models remain untouched, and independent checks pass before the preview restarts.
Stop when: the reviewed local fix is running and Emilio can retry onboarding, or a precise blocker remains.

## Confirmed cause

The old browser resolver translated `gemini-flash` into `gemini-3.7-flash` and wrote that resolved version back into preferences. Onboarding then posted that concrete value to the server configuration. The server also used a numbered fallback and cached numbered catalog results for an hour.

## Intended behavior

| Value | Saved preference | Gemini request model |
| --- | --- | --- |
| Flash family / blank | gemini-flash | gemini-flash-latest |
| Legacy generated gemini-3.7-flash | gemini-flash on normal browser/config save | gemini-flash-latest |
| Other explicit versions, Pro or Lite | preserved | preserved |

Google documents `gemini-flash-latest` as a moving alias in its [model guide](https://ai.google.dev/gemini-api/docs/models). It may follow stable, preview, or experimental releases. The choice intentionally follows that alias instead of a catalog snapshot.

The old app stored 3.7 without provenance, so a manual choice of that same exact id cannot be distinguished from an automatically generated one. This repair treats that legacy default as the family; other explicit versions remain pinned. No tool reads or rewrites owner credential files or browser storage. Normal application normalization and save paths handle the model preference.

## Verification plan and boundary

Behavioral RED fixtures reproduce browser, server and worker stale-pin behavior. Final floors will run from `/private/tmp/jobbored-flash-verify`, a clean source snapshot with dependency links and no owner configuration files. The running preview keeps its configuration links throughout testing. Floors: `npm run lint:repo`, `npm run typecheck:repo`, `npm test`, `npm run test:repo`; independent Grok diff review and Muse verification.

The screenshot's high-demand message is a provider capacity error. Updating family resolution does not guarantee capacity availability. Synthetic 503/429 checks must preserve that error without repeated model-switch retries. No live AI request with the user's resume is part of automated verification.

## Verification checkpoint before current-main integration

Grok independently reviewed the implementation and returned PASS. Muse ran repository lint and typecheck (exit 0), the full root suite (4,654 pass, zero failures, eight existing TODOs), and both focused worker files (13/13). The initial root run found one obsolete raw-alias URL expectation; only that expectation changed, preserving its dispatch and output-budget assertions.

The broader host `test:repo` passed contracts and its root subset (4,621 pass, eight TODOs), then reported 945/946 worker tests passing. `VAL-ROUTE-016` depended on external preflight timing and overwrote its captured company failure. The test now uses synthetic HTML, restores fetch in finally, and checks all captured failures while retaining the named-company diagnostic and warning assertions. Grok reviewed that correction; the complete worker rerun passed 946/946. These are checkpoint results, not a claim that the final integrated candidate passed.

While verification ran, main advanced to `5d5b9a59` and another session switched localhost back to main. The candidate will integrate that revision and repeat the required floors before any localhost switch. No owner credential file was opened by this task.
