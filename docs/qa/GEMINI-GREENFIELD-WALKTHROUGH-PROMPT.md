# Prompt for Gemini 3.8 Flash — greenfield onboarding walkthrough (observe, time, record; do not fix)

Copy everything below the line into a fresh Gemini 3.8 Flash session that has browser control and a shell on the machine where JobBored runs.

---

Goal: Walk JobBored from a blank browser to a completed discovery run exactly as a first-time user would, and produce one evidence report that records every screen, every ask the product makes of the user, every input the user gives, every system response, and how long each took — so that breakages, missing links, and mis-communications can be read off the report without re-running anything.

Success means:
  - `docs/qa/<YYYY-MM-DD>-greenfield-walkthrough/REPORT.md` exists and follows the §REPORT.md structure below, section for section.
  - Every step row carries a wall-clock timestamp, an elapsed time, a screenshot filename that exists in `media/`, and a one-line verdict from the fixed vocabulary in §Verdicts.
  - Every claim of a defect quotes the on-screen text verbatim and cites the screenshot, the console capture, and the network capture that show it.
  - Before writing any `ERROR`, `MISMATCH`, `BLOCKED-*`, or `REPEAT-ASK` verdict, re-open the screenshot you cite and confirm every quoted string in the row appears in it. A row whose quoted text is not in its own screenshot is invalid: re-take the screenshot or downgrade the verdict. (The 2026-09-02 report described a modal its own screenshot did not show, and listed drawer tabs as Settings tabs.)
  - Record the build as `git rev-parse --short HEAD` of the checkout actually served, captured at the start of the run, and never claim a build you did not check out.
  - The report states, in its own section, every surface listed in §Coverage that you did NOT reach, with the reason and the screenshot of where you stopped.
  - No secret, key, token, or sheet id appears anywhere in the report or media; write `[redacted]` in its place.

Stop when: REPORT.md is written, every §Coverage surface has either a step section or an entry in the "Not reached" section, and `media/` holds one screenshot per step row. When a step cannot be passed after three honest attempts, record the dead end with evidence and continue to the next surface; a documented dead end is a complete section.

Constraints:
  - Record and continue. When something breaks, capture it and move to the next step in the flow. Fixing, editing code, editing config files, and diagnosing root causes are the job of a different agent reading your report.
  - Leave ports 8080, 3847, and 8644 running. Start nothing on them and kill nothing on them.
  - Enter only the inputs listed in §Inputs. When a screen asks for something not listed there, record the ask verbatim, screenshot it, mark the step `ASK-UNPLANNED`, and use the field's Skip or Back control if one exists; otherwise stop that path and document it.
  - Run only the shell commands listed in §Shell. The report's value is in what a user sees, so a command a user would never type stays out of the walk.

## Context

JobBored is a local-first job-hunt dashboard. A first-time user meets a six-beat onboarding: a sample board (screen S0) with an invitation card, then Beat 1 Google, Beat 2 AI, Beat 3 Resume, Beat 4 Your fit, Beat 5 Discovery (fuel = SerpApi key, then a connection step), Beat 6 You're live (with "Run discovery now" and "Take me to my dashboard"). After the flow, the dashboard has a Discovery drawer with its own Connection tab and an "Open discovery setup" control that opens an older standalone setup wizard.

The founder's own last walk ended like this: after finishing the six beats, pressing Run discovery led into a Tailscale / other-device setup sequence and a second, older wizard screen sequence he had not expected. Your report must show exactly what a user sees at that point, in order, with timings, so the seam between the six beats and the older discovery surfaces is visible.

The dev stack is already running:
  - Dashboard: http://localhost:8080
  - API: http://localhost:3847
  - Discovery worker: http://127.0.0.1:8644
  - Stack log: /tmp/jobbored-dev.log (read-only for you)

Greenfield entry: open `http://localhost:8080/?greenfield=1` in a fresh browser profile or incognito window. That parameter resets stored credentials for the session and is spent on first load.

## Coverage — reach every one of these, in this order

1. S0 sample board: the invitation card and both of its buttons.
2. Beat 1 Google: sign-in, and the "connect an existing sheet" alternative.
3. Beat 2 AI: provider choice, key entry, live verification.
4. Beat 3 Resume: upload path AND paste path AND the template grid's way back.
5. Beat 4 Your fit: what is prefilled, what the user is asked to confirm.
6. Beat 5 Discovery: the SerpApi "Save & verify" step; then the connection step — record whether it offers Tailscale, what it says about other devices, and every button on that panel.
7. Beat 6 You're live: both actions. Take "Run discovery now" first.
8. Whatever appears after "Run discovery now": every screen, drawer, wizard, toast, and dialog, in the order they appear, until either a run is accepted or you hit a dead end.
9. The Discovery drawer opened from the dashboard header: each tab, and what "Open discovery setup" opens.
10. Interruption: press Escape mid-Beat 3, then reload the page. Record where you land and whether the pasted text is still there.
11. The Settings modal, once, to record what it asks for that the six beats already asked for.

## Inputs — the only values you type

  - Google account: the test account the operator gives you at session start. If none is given, record the sign-in screen and mark Beat 1 `BLOCKED-NEEDS-OPERATOR`, then continue with "connect an existing sheet" only if a sheet URL was also given.
  - AI provider: OpenRouter. Key: the value in the environment variable `WALK_OPENROUTER_KEY`. If unset, mark Beat 2 `BLOCKED-NEEDS-OPERATOR`.
  - Resume: the file `docs/qa/fixtures/walkthrough-resume.txt` for the paste path; for upload, the same file. If missing, paste this line and mark the step `INPUT-SUBSTITUTED`: `Senior Product Designer, Design Systems. 8 years. Denver, CO. Remote or hybrid. $180k floor.`
  - SerpApi key: the value of `WALK_SERPAPI_KEY`. If unset, mark Beat 5 fuel `BLOCKED-NEEDS-OPERATOR` and record what the screen offers next.
  - Every other field: accept the default the screen shows.

## Shell — the only commands you run

  - `date "+%H:%M:%S"` before and after each step, for the timestamps.
  - `tail -n 40 /tmp/jobbored-dev.log` after any error, to capture the server side.
  - `echo ${WALK_OPENROUTER_KEY:+set}${WALK_OPENROUTER_KEY:-unset}` and the same for `WALK_SERPAPI_KEY`, once at the start, to record whether the inputs exist.

## Timing protocol

  - Start a step's clock the moment the screen you are recording becomes interactive. Stop it when the next screen becomes interactive or when the flow shows a terminal state (success message, error, dead end).
  - Record two numbers per step: user time (seconds you spent reading and typing) and wait time (seconds between your last input and the system's response). Estimate honestly; a range like `4–6 s` is fine.
  - When a screen shows a promise like "about 15 min left" or "almost done", record the promise verbatim next to the actual elapsed time at that point.

## What to capture at every step

Take the screenshot first, then write the row. For each step record:
  - `ts`: wall clock from `date`.
  - `surface`: which beat, drawer, wizard, toast, or dialog.
  - `ask`: what the screen asks the user to do or provide, quoted verbatim.
  - `input`: what you did or typed (`[redacted]` for secrets).
  - `response`: what the system showed, quoted verbatim, including toast text and button state changes.
  - `user_s` and `wait_s`.
  - `shot`: `media/NN-surface.png`.
  - `verdict`: one word from §Verdicts.
  - `console`: count of new console errors since the previous step, and the first line of each, verbatim.
  - `network`: any request that returned 4xx or 5xx since the previous step: method, path, status.

## Verdicts — the only allowed values

  - `OK`: the ask was clear, the input worked, the response arrived within 2 s, and the next step was obvious.
  - `SLOW`: as OK, but the response took longer than 2 s.
  - `UNCLEAR`: the screen asked for something and you had to guess what it meant or where to click.
  - `ASK-UNPLANNED`: the screen asked for an input outside §Inputs.
  - `REPEAT-ASK`: the screen asked for something an earlier screen already collected.
  - `MISMATCH`: the on-screen copy names a control, command, or step that does not exist on that screen.
  - `ERROR`: an error message, toast, or console error appeared; quote it.
  - `DEAD-END`: no control on the screen leads forward, and Close or Back returns to a screen that leads back here.
  - `BLOCKED-NEEDS-OPERATOR`: an input in §Inputs was not provided.
  - `INPUT-SUBSTITUTED`: you used the fallback input named in §Inputs.

## REPORT.md structure — use these headings exactly

```
# Greenfield walkthrough — <date>, build <first 7 chars of `git rev-parse HEAD`>

## Summary table
| step | ts | surface | verdict | user_s | wait_s | shot |
(one row per step, in order)

## Environment
OS, browser + version, viewport, whether WALK_OPENROUTER_KEY and WALK_SERPAPI_KEY were set, Tailscale installed (yes/no/unknown, from what the screen said, not from a command).

## Steps
### 01 · S0 · sample board
(the full capture block from §What to capture)
### 02 · Beat 1 · Google
… one subsection per step, numbered to match the summary table …

## After "Run discovery now" — the exact sequence
A numbered list of every surface that appeared, in order, each with its screenshot. This section answers: what does a user see between pressing the button and either a run being accepted or a dead end.

## Asks the product made of the user, in order
A plain list: one line per ask, quoted verbatim, with the surface it came from and whether an earlier surface had already collected it.

## Promised time vs actual time
| surface | promise (verbatim) | elapsed at that point |

## Every console error seen
Deduplicated, verbatim, with the step number that first produced it.

## Every failed network request seen
Deduplicated: method, path, status, step number.

## Not reached
Every §Coverage item you did not reach, the reason, and the screenshot of where you stopped.

## Three things a first-time user would most likely give up on
Pick from your own verdicts. One sentence each, each citing a step number.
```

## Honesty rules

  - Write only what a screenshot in `media/` shows. When you are unsure what you saw, take another screenshot and describe that.
  - Quote on-screen text by copying it; paraphrase belongs in the `verdict` column only.
  - When a step has no error, write `console: 0` and `network: none` explicitly.
  - When you did not reach a surface, say so in "Not reached"; an absent section reads as "worked fine" and is the one outcome that makes this report worthless.
