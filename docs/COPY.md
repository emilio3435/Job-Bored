# JobBored voice sheet

One page for everyone writing onboarding, error or docs copy (GFX X4).
When a sentence in the product disagrees with this page, the page wins.

## Rules

1. **Body copy is literal.** Say what happens and what to do next, in the
   user's words. No "fuel", "engine", "brain" or "scout" in a sentence that
   gives an instruction.
2. **At most one light metaphor per beat, and only in its title.** The body
   under that title is literal. Example: "Now give it a brain." as a title is
   fine; "the brain needs a key" in the body is not.
3. **One name per concept.** Use the names in the table below, everywhere,
   including errors, aria-labels and docs.
4. **Every failure names its fix.** One sentence for what went wrong, one
   action. Never apologize, never blame the user, never say "something went
   wrong" alone.
5. **Say "unknown" when you don't know.** A check that could not run is not a
   check that failed. "This page couldn't reach JobBored" — never "JobBored
   isn't installed" unless something proved it.
6. **Honest time.** The Client ID takes about 10 minutes; the whole setup
   takes about 20–25. Don't round down.
7. **Sentence case, plain verbs, no trailing "→"** on buttons. A button says
   what it does ("Open JobBored", "Copy setup command"), and the result keeps
   the same word ("Copied.").
8. **Name Google's own labels exactly** (Advanced → Go to JobBored (unsafe);
   Authorized JavaScript origins; Data access; Audience → Test users), so the
   user can find them on Google's screen.

## One name per concept

| Concept | Say | Don't say |
| --- | --- | --- |
| The Google OAuth credential the user makes | **Client ID** | app key, OAuth client, Google app key, credentials |
| The copy of JobBored the user runs | **JobBored on this computer** (or just "JobBored") | the local server, the backend, the dev-server, localhost app |
| The hosted website | **this website** / **this page** | the hosted app, the SaaS |
| The Mac app | **the JobBored app** | the desktop runtime, Electron |
| Starting it on a Mac, until the app ships | **double-click start.command in the JobBored folder** | npm start, npm run dev |
| Starting it once the app ships (ping `runtime:"desktop"`) | **Open the JobBored app** | — |
| Starting it anywhere else | **run ./start.sh in the JobBored folder** | npm start, npm run dev, "the start command" |
| The sheet JobBored creates | **your sheet** / "JobBored Pipeline {date}" | the database, the backend |
| The tab JobBored reads | **the Pipeline tab** | the sheet tab, worksheet |
| The SerpApi key | **SerpApi key** | fuel, search key |
| The one onboarding sequence | **the setup flow** (steps 1–6) | login gate, first-run wizard, onboarding wizard |

The start hints are produced by one function, `localServerHint()` in
`local-server.js`, so B2, B3 and B5 never disagree. Copy that needs to say how
to start JobBored calls it rather than writing its own sentence.

## Privacy sentences (use these verbatim)

- Sheets permission: "Google will ask to let JobBored see and edit your Google
  Sheets, and read your name and email. JobBored only opens the sheet it
  creates or the one you paste."
- Where data lives: "JobBored has no server that sees your data."
- Sign-in storage: "Your sign-in lasts for this tab only; your Client ID and
  Sheet link are saved in this browser."
- Hosted page: "JobBored runs on your computer."
