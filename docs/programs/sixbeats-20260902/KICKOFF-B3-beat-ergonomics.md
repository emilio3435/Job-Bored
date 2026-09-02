# Lane B3 — beat-ergonomics (claims C2, C4, C5, C6)

Read `SIXBEATS-SPEC.md`, the ONEFLOW ground rules, spec §3.4, §5 B2/B3/B5. Fence: `oneflow-beat-resume.js`, `oneflow-beat-ai.js`, `oneflow-beat-discovery.js`, `onboarding-flow.js` (the close hook only), `config-overrides.js` (`maybeApplyGreenfieldUrlReset` only), tests `tests/sixbeats-b3-*.test.mjs`.

**Mission:** Four small, red-first ergonomics repairs:
- **C2** Beat 3's template grid gains a secondary action "Back to upload or paste" that returns to the dropzone with any pasted text preserved.
- **C4** After `maybeApplyGreenfieldUrlReset()` applies the reset, strip `greenfield`/`fresh`/`reset` from the URL with `history.replaceState` so a refresh resumes the saved beat instead of re-resetting. Keep the persisted mask behavior exactly as is.
- **C5** When the flow closes via Escape or the Close button, show the existing toast with "Setup paused — pick up anytime from the corner pill." (closing is pausing, spec §3.4). No confirm dialog.
- **C6** For the live checks in Beat 2 (`Check & continue`) and Beat 5 fuel (`Save & verify`): after 2 s the busy stage shows an elapsed label ("still checking… 4 s"); after 15 s the stage flips to "Taking longer than usual" with the message slot offering "Try again" — the underlying request is not cancelled.

Use the `tests/oneflow-l1-*`/`l3-*` harness patterns; one probe per claim, red first. DoD: probes green, full floor green (pasted), report complete, committed locally, never pushed.
