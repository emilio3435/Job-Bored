# Six-Beats acceptance rerun — observe, record, document (do not fix)

Works as a prompt for any capable agent with a browser (Gemini, or a Claude lane with Playwright). Paste everything below the line.

---

Goal: Re-walk JobBored's six-beat onboarding on the polished build (main @ cf0da4d or later), video-record every path, and produce an evidence report that says — per surface and per finding of the 2026-09-01 walkthrough — FIXED, STILL PRESENT, REGRESSED, or NEW, so a human can accept or reject the SIXBEATS program.

Success means:
- `docs/qa/2026-09-02-six-beats-rerun/REPORT.md` exists with the structure in §Report, one section per surface (S0, Beats 1–6, post-setup board) and per path (A–D).
- `docs/qa/2026-09-02-six-beats-rerun/media/` holds one recording per path (`path-a-desktop.webm`, `path-a-mobile.webm`, `path-b-desktop.webm`, `path-c-desktop.webm`, `path-d-desktop.webm`) and screenshots named `<surface>-<nn>-<label>.png`. **Every filename cited in the report exists in that folder, and no two screenshots are byte-identical** (the 09-01 run cited names that did not exist and shipped 20 duplicates — that is a failed run).
- The report's summary table carries a verdict column against the 09-01 findings (U1, U2, U3, C1–C7) plus any NEW tag, each with a screenshot or video timestamp as evidence.
- Zero diagnoses, zero proposed fixes, zero speculation about causes. "Observed:" and "Evidence:" only.
- Secrets appear nowhere in any file you write.

Stop when: the report and media are written and every path in §Coverage has a section. A dead end after three honest attempts is documented with evidence and you move on.

Constraints:
- Observe and record only. A superior model performs root-cause analysis and fixes.
- Read secrets only from the human when you pause for them; write only `<redacted>` in files.
- Change no source file. Run no git write command. Write only inside `docs/qa/2026-09-02-six-beats-rerun/`.

## Context
Repo `/Users/emilionunezgarcia/Job-Bored`, branch `main` (confirm `git rev-parse --short HEAD` ≥ cf0da4d and record it). Read first: `docs/ONE-FLOW-ONBOARDING-SPEC.md` §4–§5 (normative copy), `docs/programs/sixbeats-20260902/SIXBEATS-SPEC.md` (the claims this build addressed), and `docs/programs/sixbeats-20260902/evidence/gemini-walkthrough-REPORT.md` (the 09-01 baseline you are diffing against — treat its screenshots as unreliable; trust only what you see now).

The six beats: Google (sheet auto-created) → AI provider (required, live-verified key) → Resume (upload, AI drafts the profile) → Your fit (one review screen) → Discovery (required SerpApi fuel, then Tailscale connect) → You're live (single celebration, then "Run discovery now").

Start the app from the repo with `PORT=8095 node dev-server.mjs` (never 8080 — the founder's instance may be running there) and, in a second terminal, `npm run start:scraper` for the local API on 3847. Record at 1440×900; record S0 and Beat 4 again at 390×844. DevTools Console + Network visible in every recording. Both Gemini keys were rotated on 2026-09-02 and the worker env is `~/.jobbored/browser-use-discovery/.env`; if a Gemini-powered step still fails, record the exact response — do not retry more than three times.

Known and intentional — tag `KNOWN`, screenshot once, move on: `config.js` returns 403; a "What is waiting on you" strip renders above the login gate.

Pause once, up front, and ask the human for: an OpenRouter key (Beat 2), a SerpApi key (Beat 5), the second Google account for Path B, whether Tailscale is installed.

## Coverage — one recording per path
- **Path A — zero-config:** `http://localhost:8095/?greenfield=1`. Document S0 exactly as it paints. Click "Poke around first" → pill → click pill → document what opens. Then "Make it mine — 15 min, once" and walk Beats 1–6 to the board; click "Run discovery now" and record until a job card appears or 3 minutes pass.
- **Path B — second identity:** `http://localhost:8095/` with no parameter, sign in as the second account, document the gate, click "Set up JobBored for this account", walk Beats 1–6.
- **Path C — interruption:** fresh Path A; refresh mid-Beat 3 and mid-Beat 5 (note whether the URL still carries `greenfield=1` after the first load — it should not); Escape inside Beat 4, document the toast text and what re-entry lands on.
- **Path D — honest failures:** wrong OpenRouter key in Beat 2; wrong SerpApi key in Beat 5; "Skip the connection for now" in Beat 5 and the Beat 6 variant that follows.

## Capture at every screen
1. Screenshot → `media/<surface>-<nn>-<label>.png` (unique content, unique name).
2. Headline, sub, primary button, spine label — quoted verbatim, with the spec's expected strings beside them.
3. Seconds since the previous screen; the "about N min left" label if shown.
4. Console errors/warnings verbatim with file:line; failed or >2 s network requests with method, URL, status, ms.
5. One tag from: `BLOCKER · ERROR · FROZEN · MISMATCH · UGLY · CONFUSING · SLOW · KNOWN · OK`. For `UGLY`, name the element and the property.
6. For each 09-01 finding this surface relates to, a verdict: FIXED / STILL PRESENT / REGRESSED / NEW.

## Report
```
# Six Beats rerun — <date>, build <sha>
## Verdict table
| 09-01 finding | Surface | 09-01 tag | Now | Verdict | Evidence |
(U1, U2, U3, C1, C2, C3, C4, C5, C6, C7, then any NEW rows)
## Summary of new findings (anything not in the 09-01 list)
## Environment
## Path A … Path D (one subsection per surface, the §Capture fields in order)
## Every console error seen (deduplicated, verbatim, with surface)
## Every network failure seen (deduplicated)
## Timing: promised "about N min left" vs actual minutes per beat
## Media index (every file in media/, with the section that cites it)
```
Walk at a curious first-timer's pace; record hesitations as findings. `OK` is a complete entry — padding hides signal.
