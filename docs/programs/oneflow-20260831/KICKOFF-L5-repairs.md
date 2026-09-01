# Lane L5 — repairs & docs (Phase 0 items no beat lane owns)

Read GROUND-RULES.md, SUBSTRATE.md, spec §10 Phase 0. Fence: `scripts/oauth-bootstrap.mjs` (+ its server route/tests), `scripts/install-repo.mjs`, `scripts/doctor.mjs`, `setup-doctor.js`, `auth-session.js` (one publish line), `README.md`, `QUICKSTART.md`, `SETUP.md`.

**Mission:** The standalone repairs and the doc story — everything here ships value even if the flow slipped a week.

1. **gcloud OAuth bootstrap:** `scripts/oauth-bootstrap.mjs` mints a Workforce Identity client (:150-164), not a Web-application OAuth client — the button fails even on ok:true. Per spec B1 the one-click is absent until real. Delete the script, its dev-server route, and its tests; leave the gate button untouched (the gate dies in L7) but make its handler a no-op returning the manual-steps toast so nothing dangles in the interim.
2. **Node gate:** `scripts/install-repo.mjs` (:24, :69) — replace `major === 24` with `major >= 20`, update the message to name the supported range, keep the stamp logic. Red-first test.
3. **CLI doctor:** `scripts/doctor.mjs` (:347-356) warns on the git-tracked `integrations/browser-use-discovery/package-lock.json` for every fresh clone — make the check flag only genuinely unexpected lockfiles.
4. **Setup doctor:** publish `window.gisInitStartedAt` from `auth-session.js` (:40-41 already documents the latent bug) so `gis_stuck` (:164) can fire; red-first test that `detect()` can now return true.
5. **Docs, one story:** README gains the OAuth consent-screen step; the authorized-origin example becomes `http://localhost:8080`; the clone block (:235-236) gets a target dir; the API list drops Drive; document `npm run web-only` as the zero-install path. SETUP.md: pipeline columns 17 → 25 (match `app-config-core.js:197-223`); resolve the "Edit config.js" vs "No manual edits needed" contradiction in favor of no-manual-edits. QUICKSTART stays the canonical short path; align its step names with the six-beat flow's names (Google → AI → Resume → Fit → Discovery) without documenting unshipped details — one paragraph, present tense.

## Tests — tests/oneflow-l5-*.test.mjs
Node-range gate; doctor lockfile check; gis publish + gis_stuck detectability; oauth-bootstrap removal leaves no dangling route (grep-proof in report). Doc claims that are testable (column list) asserted against `app-config-core.js`.

## DoD
Full floor green (pasted). Report complete; committed locally, never pushed.
