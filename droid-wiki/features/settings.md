# Settings

Tabbed settings panel: IDs, BYO LLM keys, profile, discovery transport, automation schedule, v2 toggle, theme. Persisted to localStorage with overrides resolved over `config.js`.

## Modules

| File | Role |
| --- | --- |
| `settings-tab-schema.js` | Declarative tab metadata (titles, ids, badges) |
| `settings-tabs.js` | Tab open/close / focus behavior |
| `settings-profile-tab.js` | Profile, fit weights, must-haves |
| `settings-discovery-adapters.js` | Discovery URL / secret / transport helpers |
| `settings-jb-v2-tab.js` | v2 toggle, scroll-spy tuning |
| `app.js` (settings section) | Authoritative state, validation, persistence |

## Overrides

`config.js` (generated from `config.example.js`) is the floor. `localStorage` keys in `COMMAND_CENTER_OVERRIDE_KEYS` (`app.js:373`) override individual fields. Per-tab UIs read/write through helper functions so the validation rules are centralized.

## Sensitive fields

API keys (Gemini, OpenAI, Anthropic, SerpApi) and the discovery webhook secret are masked in the UI by default. They live in `localStorage` only; no server stores them.

`?setup=discovery` deep-links to the Discovery tab → Connection sub-tab and focuses the webhook field. If onboarding is incomplete, the link is stashed via `PENDING_DISCOVERY_SETUP_KEY` (`app.js:5780`) and replayed after onboarding finishes.

## Tests

- `tests/settings-tabs.test.mjs`
- `tests/settings-discovery-adapters.test.mjs`
- `tests/settings-profile-tab.test.mjs`
- `tests/settings-jb-v2-tab.test.mjs`

## Related

- [Onboarding](onboarding.md)
- [Configuration](../reference/configuration.md)
- [Security](../security.md)
