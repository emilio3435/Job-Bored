# Lane V2 — shell-visual (claims U2, C7: one spine, a framed shell, usable on a phone)

Read `SIXBEATS-SPEC.md`, `GROUND-RULES-ADDENDUM.md`, the ONEFLOW ground rules, spec §3.5 and §5, and open `reference/six-beats-prototype.html` (any beat) beside the app's shell. Fence: `discovery-wizard-shell.js`, `css/oneflow.css` inside `/* ONEFLOW:CORE */` only.

**Mission:** Make the one shell look and behave like the prototype: a header with the "Set up JobBored" title and Close; the 6-segment spine with labels and the minutes-remaining label — and NOTHING else as a progress indicator (today a second step-rail row renders beneath the spine, claim U2); the beat card framed with the prototype's spacing; the busy stage list and message slot styled as in the prototype; on 390×844 the actions sit in a sticky bottom bar and the body scrolls (claim C7).

Deliver:
1. Red-first probes in `tests/sixbeats-v2-*.test.mjs`: when a host passes `spine`, no `.discovery-setup-wizard__step-rail` (or equivalent) renders; header contains the title; the mobile layout class applies under 480 px (assert the CSS rule exists and the DOM hook is present); the three legacy hosts still render byte-identically when they pass no spine (extend the L0 identity lock, do not weaken it).
2. The visual work in the fence.
3. Before/after screenshots of Beat 1 and Beat 4 at both viewports in `.lane-evidence/`, pasted into the report.

DoD: probes green, full floor green (pasted), screenshots pasted, report complete, committed locally, never pushed.
