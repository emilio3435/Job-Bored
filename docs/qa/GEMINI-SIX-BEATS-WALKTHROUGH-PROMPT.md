# Prompt for Gemini 3.7 — Six-Beats onboarding walkthrough (observe, record, document — do not fix)

Copy everything below the line into the Gemini session. Provide the two secrets it asks for when it pauses.

---

Goal: Walk JobBored's new six-beat onboarding end to end as a first-time user, video-record every screen and interaction, and produce two files — an evidence report of every step, hold-up, error, and friction point, and a kickoff prompt a superior orchestrator model will use to run a fleet of Opus 5 agents that revamps the stepper.

Success means:
- `docs/qa/2026-09-01-six-beats-walkthrough/REPORT.md` exists with one section per surface (S0, Beat 1–6, the post-setup board) and per entry path (§Paths), each holding: expected behavior quoted from the spec, observed behavior, the video timestamp, the screenshot filename, console and network evidence, wall-clock time spent, and a friction tag.
- `docs/qa/2026-09-01-six-beats-walkthrough/media/` holds the recordings (`.webm` or `.mp4`) and every screenshot named `<surface>-<nn>-<short-label>.png`.
- `docs/qa/2026-09-01-six-beats-walkthrough/KICKOFF-FABLE.md` exists in the exact template under §Kickoff, with every finding carried over as a numbered, reproducible claim.
- Every observation is something you saw on screen or in DevTools, quoted or screenshotted. The report contains zero diagnoses, zero proposed fixes, zero speculation about causes.
- Secrets appear nowhere in any file you write.

Stop when: both files are written, every surface and path in §Coverage has a section, and the media folder holds a recording for each path. If a beat cannot be passed after three honest attempts, document the dead end with evidence and continue to the next path; a documented dead end is a complete section.

Constraints:
- You observe and record. A superior model performs root-cause analysis and fixes. Write "Observed:" and "Evidence:", never "Because" or "Fix".
- Read secrets only from the human when you pause for them; type them into the UI; write only the word `<redacted>` in any file.
- Change no source file. Run no git write command. Your only writes are inside `docs/qa/2026-09-01-six-beats-walkthrough/`.

## Context

Repo: `/Users/emilionunezgarcia/Job-Bored` (branch `main`, tip 5239f58 or later). Read these before starting, in order:
1. `docs/ONE-FLOW-ONBOARDING-SPEC.md` — the normative spec. §4 is screen S0, §5 B1–B6 are the six beats. Copy strings in §4/§5 are what the screens MUST say.
2. `docs/programs/oneflow-20260831/SUBSTRATE.md` — the architecture the orchestrator will fence lanes on. You reference its file-ownership map in the kickoff.
3. `docs/programs/oneflow-20260831/reports/l8-e2e.md` §5 — what the shipping team already declared unverified (nobody has looked at this flow in a real browser before you).

The six beats, in order: Google (sheet auto-created) → AI provider (required, live-verified key) → Resume (upload, AI drafts the profile) → Your fit (one review screen) → Discovery (required SerpApi "fuel" panel, then Tailscale connect) → You're live (the single celebration + payoff, then "Run discovery now").

Start the app: `npm run web-only` serves `http://localhost:8080`. Open DevTools with Console and Network tabs visible in every recording. Record at 1440×900 and again at 390×844 (mobile) for S0 and Beat 4; record every other surface at 1440×900.

Known and already logged — tag these `KNOWN` when you see them, still screenshot them, spend no time on them: `config.js` returns 403 (intentional); a "What is waiting on you" strip renders above the login gate; `/__proxy/*` 403s if you are on a build older than 5239f58.

## Coverage — record every one of these paths as its own video

Path A — zero-config first visit: open `http://localhost:8080/?greenfield=1`. Document S0 exactly as it paints, before touching anything. Then click "Poke around first", document the pill, click the pill, document the reopened card. Then click "Make it mine — 15 min, once" and walk Beats 1–6 to the post-setup board, clicking "Run discovery now" at the end and recording until either the first job card appears or 3 minutes elapse.

Path B — second Google identity on a configured install: open `http://localhost:8080/` with no parameter, sign in with the second account the human names, document the gate you land on, click "Set up JobBored for this account", and walk Beats 1–6 again.

Path C — interruption and resume: on a fresh Path A run, refresh the page in the middle of Beat 3 and again in the middle of Beat 5; document where each refresh lands. Press Escape inside Beat 4; document what the board shows and what re-entry lands on.

Path D — the honest failures: in Beat 2 paste a deliberately wrong key and press "Check & continue"; in Beat 5 paste a wrong SerpApi key and press "Save & verify"; in Beat 5 click "Skip the connection for now" and document the Beat 6 variant that follows.

Pause and ask the human for: (1) an OpenRouter key (Beat 2), (2) a SerpApi key (Beat 5), (3) the second Google account to use for Path B, (4) whether Tailscale is installed on this machine. Ask once, up front, before Path A.

## What to capture at every screen

For each screen or state change, in this order:
1. Screenshot (full viewport) → `media/<surface>-<nn>-<label>.png`.
2. The headline, sub-headline, primary button label, and any progress/spine label, quoted verbatim — then the spec's expected strings beside them.
3. Wall-clock seconds since the previous screen, and the "about N min left" label if one is shown.
4. Every console error or warning, verbatim, with the source file and line the console names.
5. Every failed or slow (>2 s) network request: method, URL, status, duration.
6. A friction tag from this fixed set: `BLOCKER` (cannot proceed) · `ERROR` (an error is shown or logged) · `FROZEN` (no visible feedback for >2 s after an action) · `MISMATCH` (copy or layout differs from spec) · `UGLY` (visual quality: alignment, spacing, contrast, empty space, missing framing, inconsistent components) · `CONFUSING` (you had to guess what to do next) · `SLOW` · `KNOWN` · `OK`.
7. For every `UGLY` tag, name the specific element and the specific property (e.g. "invitation card collapsed to a 36px pill in the lower-right corner while 70% of the viewport is empty; no page header, no wordmark, no framing around the demo columns").

Judge visual quality against the two design references in the repo: `css/oneflow.css` is the shipped styling, and the product's paper/navy/mint token system is in `tokens-v2.css`. Anything that reads as unstyled, default-browser, or unframed gets `UGLY` with a screenshot.

## REPORT.md structure

```
# Six Beats walkthrough — <date>, build <sha>
## Summary table
| Surface | Path | Tags | Time | Video | Notes |
## Environment (OS, browser + version, viewport sizes, Tailscale installed?, build sha)
## Path A — zero-config
### S0 · demo board
Expected (spec §4): …   Observed: …   Evidence: media/…, video A @ mm:ss, console: …   Tags: …
### Beat 1 · Google  … (same shape, one subsection per beat and per state change within it)
### Beat 6 · You're live → board
## Path B — second identity
## Path C — interruption and resume
## Path D — honest failures
## Every console error seen (deduplicated, verbatim, with which surface produced it)
## Every network failure seen (deduplicated)
## Timing: promised "about N min left" labels vs actual minutes per beat
## Things the spec promises that never appeared on screen (quote the spec line, cite the screenshot)
```

## Kickoff — write `KICKOFF-FABLE.md` in exactly this template

```
# Kickoff — Six Beats revamp (from the <date> walkthrough)

Goal: Bring JobBored's six-beat onboarding to the quality the spec promises — every surface framed, every action answered on screen within 2 s, every copy string matching spec — by orchestrating Opus 5 lanes against the numbered claims below.

Success means:
  - Every `BLOCKER`, `ERROR`, `FROZEN`, and `MISMATCH` claim below has a red-first test that fails on today's build and passes on the lane's branch.
  - Every `UGLY` claim below has a before/after screenshot pair in the lane report and a one-line statement of the property that changed.
  - Full floor green on the integration branch: `npm test`, `npm run lint:repo`, `npm run typecheck:repo`, `npm run test:contract:all`, `npm run test:e2e-journey`, `npm run test:e2e-smoke`.
  - A second Gemini walkthrough of Path A on the finished branch records zero `BLOCKER`/`ERROR`/`FROZEN` tags and lists every remaining `UGLY` tag as accepted by the human.

Stop when: the integration branch is merged to main through the CI gate and the second walkthrough report is filed beside this one.

Evidence: docs/qa/2026-09-01-six-beats-walkthrough/REPORT.md (read it fully first; every claim below cites it).

## Claims (one per finding — reproducible, no diagnosis)
C1 · <surface> · <tag> · "<verbatim observation>" · repro: <path + step> · evidence: <screenshot/video ref>
C2 · …

## Suggested lane cut (the orchestrator decides; this groups claims by SUBSTRATE.md fence)
- Lane S0-visual: claims … (fence: oneflow-demo-board.js, css/oneflow.css ONEFLOW:L4)
- Lane shell-visual: claims … (fence: discovery-wizard-shell.js, css/oneflow.css ONEFLOW:CORE)
- Lane beat-<n>: claims … (fence per SUBSTRATE.md ownership map)
- Lane e2e: re-pin tests/e2e-journey and tests/e2e-smoke on every claim above

## Worker stack
FE lanes run Opus 5 high via `claude --model opus --effort high --permission-mode auto`. Each lane writes LANE-REPORT-<lane>.md first, commits locally, never pushes. The orchestrator runs the floor itself before every merge.
```

Fill the Claims list from your report — one line per tag you recorded other than `OK` and `KNOWN`, in the order you met them. Fill the lane cut by matching each claim's surface to the ownership map in SUBSTRATE.md. Leave every other line of the template exactly as written.

## Pace and honesty

Walk at the speed of a curious first-time user, not a script: read each screen before acting, and record how long you hesitated. Write down the moment you were unsure what to click — that hesitation is a finding. When something looks fine, say `OK` and move on; padding the report with praise hides the signal. When you cannot tell whether something is a bug or intended, record it with the tag that matches what you saw and the words "unclear whether intended" — the reviewing model decides.
