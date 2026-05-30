# Hermes history

Hermes was originally an autonomous apply-bot. Today it's an LLM-powered materials drafter behind the scraper server's materials API. The shift is visible in the repo's residue.

## The original gates

Hermes's apply-bot lifecycle had 7 gates (0 through 6):

| Gate | Purpose | Active today? |
| --- | --- | --- |
| 0 | Pre-flight — URL valid, profile present | yes |
| 1 | Approval required — `approvalStatus` column set | yes |
| 2 | Application form readiness — Browser Use session | no |
| 3 | Materials present — resume + letter | yes |
| 4 | Submit confirmation | no |
| 5 | Post-submit logging — Pipeline write-back | yes |
| 6 | Verification follow-up | no |

Gates 2, 4, and 6 required Browser Use to drive the actual apply form. This proved unreliable and high-risk (accidentally submitting a half-baked application is hard to undo). The lane was shelved.

## The materials pivot

The repo refocused Hermes on what it was actually good at: turning a JD + the user's profile into a strong draft. Today's flow:

```
Dashboard → scraper server → Hermes (Python) → files under ~/.hermes/...
```

No Browser Use, no apply form, no submit gate. The user owns the apply action.

## Why the gate vocabulary lingers

`HERMES_MATERIALS_HANDOFF.md`, the `integrations/hermes-job-hunt/SKILL.md`, and the Python scripts still mention gates. They are accurate for the gates that are active (0, 3, 5) and historical for the rest. Anyone editing Hermes scripts should preserve gate 0/3/5 hooks but is free to delete gate 2/4/6 scaffolding when they encounter it.

## Profile evolution

Hermes used to own its own profile JSON under `integrations/hermes-job-hunt/profile/`. The canonical profile is now `~/.jobbored/profile.json`, managed by `server/user-profile.mjs`. Migration is one-shot via `POST /profile/migrate` (server-side, calls `server/legacy-profile-migrator.mjs`).

## Quality gates

The quality checks (sparse resume, weak letter) live server-side in `server/materials-quality.mjs`, not in Hermes itself. This keeps the LLM call simple in Python and concentrates judgment in one Node module that's easier to test.

## Related

- [Hermes app](../apps/hermes.md)
- [Materials feature](../features/materials.md)
- [Scraper server](../apps/scraper-server.md)
