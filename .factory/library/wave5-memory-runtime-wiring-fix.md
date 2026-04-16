## wave5-memory-runtime-wiring-fix

- Added `integrations/browser-use-discovery/src/state/run-discovery-memory-store.ts` as the runtime adapter that exposes `loadSnapshot`, `writeExploitOutcome`, and `learnRoleFamilyFromLead` in the contract shape expected by `run-discovery`.
- `src/server.ts` now uses that adapter for shared run dependencies so local async webhook runs no longer hit `writeExploitOutcome is not a function` during the learn phase.
- Local manual smoke on `2026-04-16` reached terminal status for `run_986672c7974845a3b014698154904aa0` without the memory API TypeError, but the configured service-account credential failed later on write with `invalid_grant` / `Invalid JWT Signature`.
- Future validators that need real sheet writes should refresh or replace the service-account file referenced by `integrations/browser-use-discovery/.env` before re-running local/public smoke.
