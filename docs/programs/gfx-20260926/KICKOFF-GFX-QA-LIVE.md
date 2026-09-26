# Lane QA-LIVE: one live greenfield walkthrough (astra · xhigh, **single run**, computer use)

You are the **only** live QA pass this program gets. Codex quota is precious, so work efficiently: one pass, no re-runs of steps that already passed, and no exploration outside this script.

**Goal:** a brand-new user's path through JobBored on the integrated build, recorded beat by beat. Every friction point, false message, dead end, visual defect or unclear sentence is recorded with a screenshot and a severity.

**What's running (don't start, stop or restart anything):**
- The integration build's dashboard at **http://localhost:8080/**, with its API on :3847. Both run with an isolated `HOME`, so nothing you do touches Emilio's real data.
- Emilio's live discovery worker on :8644. **Don't make anything restart it.**

**Browser:**
- Use a **fresh, empty Chrome profile** (a new guest window or a new profile): no extensions, no stored site data. Chrome has the Local Network Access prompts under test.
- Start at `http://localhost:8080/?greenfield=1`.
- Check each beat at a desktop window size (~1440 wide) and also at a narrow window (~400 wide).

**Emilio does three steps himself. When you reach each one, stop and wait for him; announce it with a clear line in your output and a `cmux notify`.**
1. **B1:** pasting his Google OAuth Client ID, then Google sign-in and consent. Tick the Sheets permission.
2. **B2:** pasting his Gemini API key.
3. **B5:** pasting his SerpApi key.

You never type, read aloud, screenshot or log any key or token. **Blur or crop screenshots taken while a key is in a field.**

**The script:**
1. **Cold open:** record the first screen.
2. **B1 (Google + Sheet):**
   - Check the Client ID detour: open by default, every step linked (open each Cloud Console link once, confirm it resolves, then close it), "name the app JobBored", the scope step, the localhost-vs-127.0.0.1 note.
   - Wait for Emilio at the paste, sign-in and consent step.
   - Confirm a sheet named "JobBored Pipeline {date}" is created, and an "Open your sheet ↗" link appears (no popup).
   - Try "Connect an existing sheet instead" once with an obviously invalid link, and record the message.
3. **B2 (AI):** check Gemini is first and pre-selected. Wait for Emilio's key. Check the consent row: choose **"Not now"** first, then check once more and choose "Save it". Record the ✓ or ✗ line.
4. **B3 (Resume):**
   - Use "I'd rather start from a template" (Engineer); don't upload personal files.
   - Record the progress stages.
   - If drafting runs, record the stall watch if it shows. **Don't wait more than 95 s.**
5. **B4 (Your fit):**
   - Check the grouped sections, the visible narrative with its counter, the tag inputs, drag handles and keyboard move, the salary control and its help text, Preferences collapsed.
   - Try adding a 9th role (the cap), an empty chip, and a narrative under 20 characters; record the inline errors.
   - Then "Looks like me →".
6. **B5 (Discovery):**
   - Before pasting, press Save & verify with an obviously fake key (`0000…0000`), and record the diagnosis and the single fix action.
   - Wait for Emilio's real key; Save & verify must pass.
   - Then, on the connect panel, choose **"Skip for now"**. **Never press any Connect, Set it up for me, Fix, or full-boot action**; those can restart the live :8644 worker.
7. **B6 (Done):** record the payoff; the skipped connect should show soft copy. **Don't press "Run discovery now."**
8. **Phone width:** at about 400 px, reopen one beat that shows an error line (B5 with the fake key is fine). The error must be visible, not off-screen.
9. **The Mac app:**
   - Open `/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/4307f7f5-795c-4642-aeca-584c929df011/scratchpad/appcopy.MB3J/JobBored.app`. It's ad-hoc signed, so right-click → Open is fine.
   - It should **attach** to the running :8080 and :3847 servers ("Running from …") and name the :8644 owner. It must not start duplicates.
   - **Decline** any "manage LaunchAgents" offer, any "Start at login", and any "Move to Applications".
   - Use its tray **Open JobBored**: it must open `http://localhost:8080/`.
   - Then Quit the app and check that :8080, :3847 and :8644 are **still running** (it must not kill what it didn't start).

**Report:** write `/Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/reports/QA-LIVE.md`, and screenshots to `/Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/reports/qa-live/`.
- The report's first line is `DONE` or `BLOCKED: <why>`.
- Then a table: `# | beat | step | expected | observed | severity P0/P1/P2/pass | screenshot`.
- Then a short list of the top five fixes.
- Mark each finding **observed** (you saw it) or **inferred**.

**Stop when:** the script is complete and the report is written, or you are blocked twice on the same step.

**Never:**
- push, open PRs, or change any repo file;
- kill processes;
- touch `~/Library/LaunchAgents`, `~/.jobbored`, or any key.
