# UX01 — JobBored front end and UX, 0 → 1 (opus · medium)

Goal: Turn JobBored into the simplest way for a stranger to find jobs, tailor applications, and track them, by scraping the whole front end with parallel auditors and returning one succinct spec and one mockup of the changes to build.

Success means:
- Eight audit reports in `docs/programs/ux01-20260925/audit/`, one per lens below, every finding in the schema below with evidence from the running app or the code.
- `docs/programs/ux01-20260925/SPEC.md`, two pages at most, in the shape under Phase 2.
- One mockup, published as an Artifact: the redesigned screens drawn on the proposed tokens, each change tagged with its SPEC id, with the Phase 1 "before" screenshot beside it.
- Emilio has the SPEC path and the mockup link.

Stop when: SPEC.md and the mockup are in front of Emilio. Wait for his approval, including the cut he wants, before any build lane starts.

Constraints:
- Run every agent on the opus family at medium effort. This program overrides the xhigh default in the routing table. Effort comes from the agent definition: create `.claude/agents/jb-ux-auditor.md` with `model: opus` and `effort: medium`, confirm the first auditor's session shows medium, then launch the rest. Use this definition, not the global `frontend-developer` agent. That one assumes React and Tailwind in `client/`, and JobBored is vanilla JS with custom elements.
- Phase 1 and 2 agents read, run the app, and write only their own report files. Product code stays untouched until Emilio approves the spec.
- Emilio publishes: all work stays local, and pushes, PRs, and deploys are his.

## Designing for
A stranger who cloned the open-source repo, on any OS, with a Google Sheet and an AI key, who wants to go from zero to a tailored, tracked application in one sitting. Emilio's own setup is just one of many.

## Read first (orchestrator, before fanning out)
- `DESIGN.md`, `JB-UI.md`, `JB-A11Y.md`, `WELCOME.md`, `DAWN.md`, `LATTICE.md`, `SCRIBE.md`, `PIPELINE-CARDS-HANDOFF.md`, `AGENTS.md`, `AGENT_CONTRACT.md`.
- Open PRs #117 and #120 (materials v2 and v3 "volt" resume and cover-letter redesigns). Treat them as prior art for the Tailor lens and cite them.
- `gh pr list` and the live cmux workspaces. Fence around anything in flight.

## Facts to hand every auditor
- `index.html` loads 36 stylesheets: `style.css` `:root` tokens, `tokens-v2.css` plus the `body.jb-v2` layer, 11 `css/legacy-*.css` files, per-surface sheets (dawn, lattice, today, pipeline, role-case, scribe, welcome, oneflow…), and `jb-v2-legacy-hide.css` last. Two token systems coexist, and measuring that is the central design-system finding.
- Markup lives in `partials/`. `index.html` includes those files, and `dev-server.mjs` expands the includes at read time.
- Run `npm start`: the dashboard is on :8080 and the API on :3847 (set `jobBoredApiUrl` in `config.js`). Open `?greenfield=1` to see first run. To reach the signed-in dashboard headless, stage the fake `command_center_*` OAuth keys and stub `showSheetAccessGate`.
- Keep the Sheet write-back contracts intact: `data-action`, `data-stable-key`, `expandedJobKeys`, and the selectors in `PIPELINE-CARDS-HANDOFF.md`.

## Phase 1 — Scrape (8 auditors, launched in one message)
Each auditor reads its surfaces, drives them in the running app at 1440px and 375px wide, saves screenshots to `audit/shots/<lens>/`, and writes `audit/<lens>.md`.

| # | Lens | Surfaces |
|---|---|---|
| 1 | Design system | All 36 stylesheets, tokens-v2, jb-ui, jb-type, jb-deco, jb-a11y, visual-themes. Count distinct colors, font sizes, spacing values, radii, and shadows; map what is dead, duplicated, or overridden. |
| 2 | First run | Login gate, welcome, the oneflow beats (google, resume, fit, ai, discovery, payoff), onboarding celebration. Measure time and clicks to the first tracked job. |
| 3 | Find | Discovery drawer, wizard, run preview, runs tab, coach, ingest-url flow, companies tab. |
| 4 | Track (CRM) | Pipeline cards, stage registry and transitions, today, daily brief, dawn, lattice, recruiter strip, mark-submitted, expired review, whats-next banner. |
| 5 | Tailor and apply | Role case (dossier), materials queue, scribe, letter, resume generation, ats-scorecard, fit profile, submission flow. |
| 6 | Settings and states | Settings modal and tabs, setup doctor, and every empty, loading, error, and offline state in the app, copy included. |
| 7 | Access and responsive | Keyboard paths, focus order, contrast, accessible names (run axe), layouts at 375px, reduced motion, CSS and JS payload. |
| 8 | Modern patterns | Research Teal, Huntr, Simplify, and current Linear-grade tools. Return the ten patterns JobBored should adopt, each tied to a JobBored surface and a finding id. |

Finding schema, one row each:
`id · lens · surface · file:line · evidence (screenshot path or quoted code) · type (bug | hole | tweak | feature | system) · severity P0–P3 · user impact in one sentence · fix · effort S/M/L · confirmed | inferred`

Each report closes with its top five findings, ranked by impact ÷ effort.

## Phase 2 — Spec and mockup (orchestrator)
Merge the eight reports, drop duplicates across lenses, and rank what's left. Then write SPEC.md in this shape, two pages at most:

1. **The problem**: the five findings that cost users the most, each with its evidence.
2. **Design language**: one token file as the single source, with a named type scale, a 4px spacing grid, color roles, motion rules, a component list (keep, merge, retire), and the path off the `legacy-*.css` layer.
3. **Changes**: a numbered list, one line per change: what changes, which finding ids it fixes, which files it touches, and its effort. Order the list along the journey: Find → Tailor → Apply → Track.
4. **Out of scope**: what this program leaves for later.
5. **Build lanes**: at most six lanes with disjoint file ownership. The token-consolidation lane lands first.
6. **Acceptance**: before and after numbers for stylesheets loaded, distinct colors, distinct font sizes, clicks to the first tracked job, and axe violations.

Load the `artifact-design` skill, then build the mockup as a single HTML page on the proposed tokens with realistic example data. It covers first run, the Today and Pipeline board, and the role case. Tag each change with its SPEC number and show its Phase 1 "before" screenshot beside it, at desktop and 375px. Publish it with the Artifact tool and send Emilio both links.

## Phase 3 — Build (only after Emilio approves)
Run the approved lanes with the `orchestrate` skill as opus FE lanes at medium effort (`claude-elioai --model opus --effort medium --permission-mode auto`). Name them `UX01 · <lane> · opus · <MM-DD>` and give each its own worktree off `feat/ux-zero-to-one`, cut from `main`. Muse verifies each lane and Grok reviews each diff, per the routing table. Scope each component's CSS under its root class, because `body.jb-v2 h3/p` (0,1,1) outranks single-class rules. In Playwright, set reduced motion with `page.emulateMedia` and assert `matchMedia`.

The floor for every lane, with output pasted into the lane report:
```
npm run lint:js
npm test
npm run test:e2e-smoke
npm run test:e2e-journey
npm run test:e2e-visual
```
Refresh visual baselines only for changes the spec intends, and list each refreshed baseline with a before and after pair.

## Report back
Lead with what changed for the user, then give the Acceptance numbers before and after. Label each claim confirmed, inferred, or unknown, and name anything skipped.
