# Source Preset Contract

## Overview
The discovery webhook now supports canonical source preset selection via `discoveryProfile.sourcePreset` in request payloads.

## Contract Details

### Enum Values
- `browser_only` — Only grounded_web lane executes; ATS lanes are excluded
- `ats_only` — Only ATS lanes (greenhouse, lever, ashby) execute; grounded_web is excluded
- `browser_plus_ats` — Both lane families execute with explicit source attribution

### Validation (parseWebhookRequest)
- Invalid enum values → 400 with field-specific error listing valid values
- Non-string types → 400 with message about expected type
- Both `sourcePreset` and `enabledSources` in `discoveryProfile` → 400 as mutually exclusive
- Omitted `sourcePreset` → passes validation; fallback resolved by config resolver

### Fallback Truth Table (resolveSourcePreset)
1. Request-level preset provided → use it
2. Stored `discoveryProfile.sourcePreset` exists → use stored preset
3. Only `grounded_web` enabled → `browser_only`
4. Only ATS lanes enabled → `ats_only`
5. Mixed/legacy state → `browser_plus_ats`

### SheetId Boundary (VAL-API-007)
- Local mode: allows configured fallback sheetId when request omits it
- Hosted mode: rejects missing sheetId with explicit 400 error

## Files Changed
- `integrations/browser-use-discovery/src/contracts.ts` — SourcePreset type, SOURCE_PRESET_VALUES
- `integrations/browser-use-discovery/src/config.ts` — resolveSourcePreset, mergeDiscoveryConfig updates
- `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts` — sourcePreset validation in parseWebhookRequest
- `schemas/discovery-webhook-request.v1.schema.json` — sourcePreset enum in discoveryProfile
- `integrations/browser-use-discovery/tests/webhook/config.test.ts` — resolver fallback tests
- `integrations/browser-use-discovery/tests/webhook/handle-discovery-webhook.test.ts` — webhook validation tests

## For Routing Enforcement Workers
The `resolveSourcePreset` function in `config.ts` outputs the effective preset. The `EffectiveDiscoveryConfig` type now includes a required `sourcePreset` field. Routing enforcement should gate lane execution based on this resolved preset value.

### effectiveSources vs enabledSources in the routing pipeline
The routing pipeline uses two related but distinct source lists:

- **`effectiveSources`**: Resolved from `sourcePreset` at the start of a run (via `computeEffectiveSources()`). Used by `detectBoards()` to filter which source adapters are invoked at the detect stage. This is the authoritative gate.
- **`enabledSources`**: The full set of sources configured for the worker. Used by `collectListings()` at the list stage, consistent with the already-filtered detections from detect stage.

Architecture guidance: "Source preset is authoritative for lane execution" — the preset resolves to `effectiveSources` which gates detect stage; `enabledSources` at list stage is always consistent with that filtered state.
