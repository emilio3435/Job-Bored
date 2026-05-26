# /goal — Discovery drawer follow-ups + first-run coach (parallel cmux swarm)

Paste the block below into `/goal` in Claude Code to launch a 2-lane parallel
swarm in cmux. Each lane is independent (different files, different tests) so
they can run concurrently and merge cleanly.

---

```text
Goal: Ship two follow-ups to the discovery-drawer consolidation that just
landed on feat/flowing-page — finalize the Profile-tab removal and add a
first-run coachmark tutorial inside the drawer — in two parallel cmux lanes
that can be merged independently.

Success means:
- Lane A "settings-profile-removal-verify" is green: no DOM, JS, or doc
  reference to settings-panel-profile / settings-tab-profile anywhere in the
  repo; `npm run typecheck:repo` clean; `npm test -- tests/discovery-drawer-payload.test.mjs`
  green; a headless-Chrome smoke at `npm run web-only` confirms (1) the drawer
  still opens with five sub-tabs, (2) Settings modal shows exactly five tabs
  (Setup / Sheet / Scraping / ATS Scoring / AI Providers), (3) the
  briefcase/materials nav button still opens the Materials modal with the
  resume + profile form preserved.
- Lane B "discovery-coach-first-run" is green: new file
  `discovery-coach.js` attached as `window.JobBoredDiscoveryCoach`; CSS rules
  added to `style.css` for `.discovery-coachmark` + `.discovery-coachmark__step`;
  a `?` button in the drawer header restarts the coach; on first drawer open
  (localStorage flag `command_center_discovery_coach_done` absent) the coach
  auto-fires non-blocking, walks five steps (Search → highlight #dpTargetRoles,
  Sources → highlight #dpPresetBrowserPlusAts, Automation → highlight
  #settingsProfileScheduleLocalEnable, Connection → highlight
  #settingsDiscoveryGuideBtn, History → highlight
  #discoveryDrawerOpenRunsBtn), advancing on a "Next" button per step and
  reading `getDiscoveryReadinessSnapshot()` to skip already-configured steps;
  closing the coach sets the localStorage flag and a green "You're set" toast
  fires via the existing `showToast()` helper.
- A new test file `tests/discovery-coach.test.mjs` asserts (a) the
  localStorage flag is the gate, (b) the coach exposes
  `start({ force })`, `next()`, `skip()`, `dismiss()` on
  `window.JobBoredDiscoveryCoach`, (c) the readiness-aware skip path skips
  Connection when `getDiscoveryReadinessSnapshot()` returns
  `webhookConfigured: true`, (d) the coach DOES NOT auto-fire on subsequent
  drawer opens once the flag is set.
- A headless-Chrome smoke (re-using the harness at
  `scripts/smoke-discovery-drawer.mjs`) confirms the coach overlay appears
  on first drawer open and disappears after "Got it" / dismiss; subsequent
  opens do not retrigger it.
- Both lanes leave the existing 25/25 discovery-drawer-payload tests, 44/44
  settings-profile-schedule-card tests, and `npm run typecheck:repo` green.
- A single PR per lane is opened against feat/flowing-page with a 3-line
  summary + a screenshot or DOM-snapshot block from the headless smoke.

Stop when:
- Both lanes have green PRs, the headless smoke output is pasted in each PR
  description, and no pre-existing tests outside the touched files have
  regressed. Do not push to main. Do not merge the PRs — leave them for
  human review.

Constraints:
- Do not regress any of these IDs in the drawer (preserve verbatim):
  #dpTargetRoles, #dpPresetBrowserPlusAts, #settingsProfileScheduleLocalEnable,
  #settingsDiscoveryWebhookUrl, #settingsDiscoveryWebhookSecret,
  #settingsDiscoveryGuideBtn, #settingsAppsScriptDetails,
  #discoveryDrawerOpenRunsBtn, #discoveryDrawerOpenDoctorBtn,
  #dd-tab-{search,sources,automation,connection,history},
  #dd-panel-{search,sources,automation,connection,history}.
- The Materials/briefcase nav button (#materialsBtn → openMaterialsModal())
  is the only remaining home for the resume + profile form. Do not delete or
  rename it; do not move its markup.
- The coach must be non-blocking — the drawer stays interactive while it is
  visible. Use a small floating coachmark positioned relative to the
  highlighted element. No backdrop, no modal overlay.
- The coach must obey `prefers-reduced-motion: reduce` (no slide-in
  animation when set).
- No new npm dependencies. The coach must be a single vanilla-JS file
  attached to `window`, matching the existing module style.
- Do not touch the discovery webhook contract, schemas, or worker code.
- Do not modify the failing test
  tests/discovery-payload-sanitization.test.mjs — that failure pre-existed
  on feat/flowing-page and is tracked separately.

Lane split (parallel cmux):
  Lane A "settings-profile-removal-verify":
    Files: docs/SETTINGS-SCHEDULE.md, SETUP.md, README.md, AGENT_CONTRACT.md
    (search/replace any "Settings → Profile" or "Settings → Discovery" text);
    plus a verification sweep over *.js and *.test.mjs for stale ID strings.
    Tests: `npm test -- tests/discovery-drawer-payload.test.mjs`;
    `npm run typecheck:repo`; headless smoke at
    `node scripts/smoke-discovery-drawer.mjs` (against a running
    `npm run web-only` on :8080).
  Lane B "discovery-coach-first-run":
    New file: discovery-coach.js (~150 lines).
    Edit: index.html — add the `?` button to the drawer header
    (#discoveryDrawerHeader area, next to the existing close button) wired
    to `JobBoredDiscoveryCoach.start({ force: true })`.
    Edit: style.css — add `.discovery-coachmark`, `.discovery-coachmark__step`,
    `.discovery-coachmark__cta` rules using existing JobBored color tokens
    (no new hex). Respect reduced-motion media query.
    Edit: app.js — load `discovery-coach.js` before `app.js` in index.html's
    script-load order; call `JobBoredDiscoveryCoach.start({ force: false })`
    from inside openDiscoveryDrawer() right after sub-tab init.
    New tests: tests/discovery-coach.test.mjs (4 assertions above).

Hand-off:
  Each lane returns: (1) the PR URL, (2) the test summary (pass/fail per
  file), (3) the headless-smoke output block (`20 pass, 0 fail` shape),
  (4) a 2-sentence note on anything the human reviewer should manually
  verify.
```

---

## Notes for the operator

- The smoke harness is now permanent at
  `scripts/smoke-discovery-drawer.mjs`. Both lanes invoke it via
  `node scripts/smoke-discovery-drawer.mjs` against a running `npm run web-only`.
- The pre-existing `npm run web-only` server is bound to port 8080 — leave it
  running between lanes so each agent can run the headless smoke without
  port conflicts.
- Both lanes need `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  available. cmux containers without Chrome should use `--headless` Chromium
  if available, or fall back to jsdom (degraded coverage).
