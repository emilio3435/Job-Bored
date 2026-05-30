# Fun facts

Things that surprised me about this codebase. The list is curated, not exhaustive.

## The themed-module habit

Browser modules are named after evocative things, not their function:

- **Dawn** → Daily Brief
- **Lattice** → kanban
- **Pipeline** (the file, not the feature) → horizontal sticker board
- **Role / Dossier** → expanded role view
- **Letter** → cover-letter editor
- **Scribe** → ATS workspace
- **Flowing** → sticky top chrome and the cross-surface shared store
- **JB-UI** → web components (`<jb-fit-ring>`, `<jb-spark>`)
- **Welcome** → onboarding
- **Hermes** → Python materials orchestrator

Reading `dawn.js` and learning it has nothing to do with sunrise visualization is a rite of passage. The [glossary](overview/glossary.md) is the cheat sheet.

## One human, many agents

97% of commits (414/417) are authored by `emilio3435`. But 71% (296/417) are **co-authored** by some agent: Factory Droid (`factory-droid[bot]`), Claude Code, Cursor Agent, Codex, Warp. The repo is effectively a long-running "directional-prompting" experiment.

## `app.js` is bigger than the entire scraper server

24,289 lines vs ~5,946 lines for `server/`. The browser dashboard is the heaviest component by far.

## The discovery worker has its own bigger files

`grounded-search.ts` is 4,132 lines — bigger than `style.css` minus blank lines. Most of that mass is prompt-engineering scaffolding, grounding adapter fallbacks (cloud → CLI → fetch), and matching against `host-signatures.ts`.

## Three rewrites of "how the worker is reached"

1. Direct browser → local worker (CORS via dev-server)
2. Browser → Apps Script `/exec` → user's other endpoints
3. Browser → Cloudflare Worker relay → ngrok tunnel → local worker

The third is current. `scripts/install-cloudflare-relay.mjs` + `scripts/discovery-keep-alive.mjs` keep it stable across ngrok URL rotations. `HANDOFF-cloudflare-tunnel.md` documents the in-progress 3-tier selection model.

## 14 ATS providers

Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, Workable, Breezy, Personio, Recruitee, Teamtailor, Jobvite, Taleo, SuccessFactors. The number creeps up — every time the user encountered a job board that wasn't covered, a new adapter showed up.

## The script name with the most words is the most useful one

`scripts/install-discovery-tunnel-autostart.mjs` — installs an OS-level autostart for the discovery tunnel so the user doesn't have to remember to start ngrok every morning. Quietly the most "this is a real product" piece in the repo.

## The repo runs on Node 24 + npm 11

Pinned in `.nvmrc`, `.node-version`, and `engines`. The discovery worker uses `node --experimental-strip-types --test` for TypeScript tests — no `tsc` build step. This is unusually modern for a "just open it in your browser" product.

## 26 root markdown files

The agent-coding rules in `AGENTS.md` ask for surgical changes, but the human + agents keep dropping handoff notes (`*HANDOFF*.md`) at the root every time a long session ends. The result is a doc surface that needs its own [cleanup opportunities](cleanup-opportunities.md) entry.

## You can run discovery without any LLM access

If you set no Gemini / OpenAI / Anthropic / SerpApi keys and only configure the ATS lanes, the worker will still produce candidates by hitting public Greenhouse/Lever/Ashby/etc. APIs and using only the deterministic scorer in `frontier-scorer.ts`. The matcher LLM gate is optional.

## The `/runs/:runId` token model is per-run, not per-user

Each run gets a fresh `statusToken`. Leaking it gives access to one run's status, not the user's account or other runs. Inspired by the same model GitHub uses for action run logs.

## The repo originally wasn't called JobBored

Look at any code path — every constant says **`COMMAND_CENTER_`**. The product was renamed externally; the codebase moved on without bothering to rename. See [lore](lore.md).

## Related

- [By the numbers](by-the-numbers.md)
- [Lore](lore.md)
- [Glossary](overview/glossary.md)
