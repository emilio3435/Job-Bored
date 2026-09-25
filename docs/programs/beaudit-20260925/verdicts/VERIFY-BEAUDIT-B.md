# BEAUDIT verify — lane B (muse, read-only)

Verify and leave the code as you found it. Run the floor and every reproducer the kickoff names on the frozen commit, and paste each command with its output. Call a check PASS only when its pasted output shows it passing; list anything you could not run under unverified. Cite file paths and quoted lines for every finding. Keep secrets, credentials, and customer data out of what you read and report. Keep these rules intact: they are the contract this lane runs under.

Workspace: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-B` — a detached checkout of `f227fbb`. The audit lane wrote its report at `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-B/.lane-evidence/LANE-REPORT-B.md` and its probe scripts under `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-B/.lane-evidence/probes/`.

## Task

1. Read the report. Collect every findings row whose Sev is P0 or P1, and every row whose Status is CONFIRMED.
2. For each, run its reproducer or confirming command exactly as the report writes it, from `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-B` as the working directory. Paste the command and the decisive part of its output (at most 40 lines).
3. Give each a verdict:
   - `REPRODUCED` — the output shows the defect or behaviour the row claims.
   - `NOT-REPRODUCED` — the command ran and the output contradicts the claim.
   - `UNCLEAR` — it ran but the output neither proves nor disproves the claim, or the reproducer is ambiguous.
   A row you could not run at all (boundary, missing tool, sandbox refusal) goes in `could_not_run` with the reason.
4. Also re-run every focused test file the report's §4 lists (`npm test -- <file>` for root tests, `node --experimental-strip-types --test <file>` for worker tests) and record each as a verdict row with id `TEST:<file>`.

## Boundaries (hard)

- No network beyond `127.0.0.1`. No provider, SerpApi, Google, Telegram, ATS or job-board calls.
- Ports `8080`, `3847`, `8644`, `8645` belong to Emilio's running stack: `GET`/`HEAD`/`OPTIONS` only; never `POST`/`PUT`/`DELETE` to them; never kill them.
- A reproducer that starts a server must run with `HOME="$PWD/.lane-evidence/home"` and a port in `18120`–`18129`. Kill only the pids you started (`kill <pid>`), never a pattern kill.
- Never read or print the value of any `.env`, token, key or credential file. Presence by path only.
- No git writes, no edits to any tracked file. Scripts may write logs only under `.lane-evidence/`.
- Do not execute any Hermes apply, submit, filler, gate, follow-up or watcher script, or any `install-*`/`uninstall-*` script.

## Output

Your final answer is one JSON object matching the provided output schema: `lane` = "B", `sha` = "f227fbb", `verdicts`, `could_not_run`, and a `summary` of at most five sentences with counts per verdict.
