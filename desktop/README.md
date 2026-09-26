# JobBored for Mac

A menu-bar app that runs JobBored's three local servers from its own read-only bundle and opens the dashboard at `http://localhost:8080/`. It registers `jobbored://` for the hosted page's **Open JobBored** button. Security notes are in [SECURITY.md](SECURITY.md); the release process is in `docs/DESKTOP-RELEASE.md`.

```
cd desktop
npm ci
npm test               # node --test test/*.test.mjs (no Electron, no real ports)
npm run typecheck
npm run stage          # runtime files + production deps -> app-bundle/, then a self-check
npm start              # unpackaged; runs from app-bundle/ if staged, else the repo
npm run smoke          # JOBBORED_DESKTOP_SMOKE=1: alternate ports, throwaway HOME, exit 0/1
npm run dist:unsigned  # stage + unsigned universal DMG and zip in dist/
```

Smoke mode binds `JOBBORED_SMOKE_DASHBOARD_PORT`, `JOBBORED_SMOKE_API_PORT` and `JOBBORED_SMOKE_WORKER_PORT` (default 18680–18682) and refuses 8080, 8644 and 3847. It prints one `JOBBORED_DESKTOP_SMOKE_RESULT {json}` line.

| File | Role |
|---|---|
| `main.mjs` | Electron shell: single-instance lock, `open-url`, tray, login item, first-run offers, smoke mode |
| `supervisor.mjs` | spawn, attach or conflict, restart with backoff, stop only its own children |
| `protocol.mjs` | the `jobbored://` allowlist |
| `launchagents.mjs` | the opt-in migration of five exact LaunchAgent labels |
| `updater.mjs` | electron-updater with the `emilio3435/jobbored-desktop` feed |
| `scripts/stage.mjs` | builds `app-bundle/` and runs its self-check |
