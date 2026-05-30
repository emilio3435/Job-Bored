# Onboarding (Welcome)

Nine-step paced first-run flow. The user provides Sheet ID and OAuth client ID, signs in, optionally uploads a resume, and gets a brief tour of the Pipeline / Dossier / Discovery surfaces.

## Modules

| File | Role |
| --- | --- |
| `welcome.js` | State machine + DOM |
| `welcome.css` | Styles |
| `WELCOME.md` | Design intent |
| `setup-doctor.js` | One-click self-heal for greenfield setups |
| `fit-profile-wizard.js` | In-flow profile capture |

## State machine

The flow is gated step-by-step. The dashboard suppresses deep links (e.g., `?setup=discovery`) until onboarding completes — the deferred link is stashed in `PENDING_DISCOVERY_SETUP_KEY` and replayed at the end (`app.js:5780`).

## Doctor

`setup-doctor.js` provides a small diagnostic surface: checks Sheet ID format, OAuth client format, scraper reachability, discovery webhook reachability, and offers a "Fix this" button per failure. The browser surface for the npm-side `npm run doctor` script.

## Tests

- `tests/welcome.test.mjs`
- `tests/setup-doctor.test.mjs`
- `tests/fit-profile-wizard.test.mjs`

## Related

- [Settings](settings.md)
- [Getting started](../overview/getting-started.md)
