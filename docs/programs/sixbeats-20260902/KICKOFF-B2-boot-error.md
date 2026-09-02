# Lane B2 — boot-error (claim C1: cold start throws before the user does anything)

Read `SIXBEATS-SPEC.md`, the ONEFLOW ground rules, `evidence/gemini-walkthrough-REPORT.md` §S0. Fence: RCA first; then ONE owning file, named in your report before you edit it.

**Mission:** On `/?greenfield=1` first paint an uncaught `TypeError: Cannot read properties of null (reading 'appendChild')` fires. Find the source, fix it there, and pin it.

Method (systematic — root cause before any fix):
1. Reproduce with a Playwright script in `.lane-evidence/` that captures `pageerror` with the stack; run it against your own dev server (`PORT=<free>`) on `/?greenfield=1` and on `/` (configured). Paste the stack.
2. Trace the null: which `getElementById`/`querySelector` returned null, on which script, at which point in the deferred load order. Check `index.html` mount order, the demo-board mount, `today.js`, and any module that appends at parse time.
3. Red-first test at the module level (the vm-harness pattern in `tests/oneflow-l6-harness.mjs`) that reproduces the null path, then the minimal fix at the source. Guarding the symptom is not the fix unless the report proves the element legitimately cannot exist at that moment.
4. Re-run the Playwright capture: zero page errors on both URLs. Paste it.

DoD: test green, full floor green (pasted), the Playwright capture pasted before and after, report names the root cause in one sentence, committed locally, never pushed.
