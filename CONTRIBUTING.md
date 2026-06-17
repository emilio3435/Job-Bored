# Contributing

Thank you for thinking about contributing to JobBored. This file gets you
from a fresh clone to a merged PR.

If you're stuck at any step, open a
[Discussion](https://github.com/emilio3435/Job-Bored/discussions) — getting
unblocked counts as a contribution too.

## Table of contents

- [The 60-second mental model](#the-60-second-mental-model)
- [Get the dev loop running](#get-the-dev-loop-running)
- [Running the tests](#running-the-tests)
- [Maintainer-enforced quality gate](#maintainer-enforced-quality-gate)
- [How code is organized](#how-code-is-organized)
- [Submitting a PR](#submitting-a-pr)
- [Style + conventions that matter](#style--conventions-that-matter)
- [Contract changes](#contract-changes-discovery-webhook--pipeline-sheet)
- [What I'll do on my end](#what-ill-do-on-my-end)

## The 60-second mental model

- **Local-first.** No backend you have to host. The dashboard reads/writes
  Google Sheets directly from the browser. Discovery + drafting talk to either
  a tiny local Node worker or your own AI provider.
- **Classic globals, not ESM-in-the-browser.** Every browser file is a
  top-level IIFE on a `window.*` namespace. We do this on purpose: no build
  step, no bundler, every script tag is its own debuggable unit. Cross-module
  references go through a [bridge layer](bridge-registry.js) — search there
  if a function feels orphaned.
- **The test gate is real.** 1,800+ tests run on every PR. The gate
  (`npm test`) must end **0 fail / 0 skip**. Lint, typecheck, and Playwright
  smoke also have to be clean. Red PRs don't merge.

## Get the dev loop running

```bash
git clone https://github.com/emilio3435/Job-Bored.git
cd Job-Bored
nvm use         # Node 24.x — see .nvmrc
npm install     # ~30s; dashboard + server deps
npm run dev     # dashboard :8080 + scraper + local discovery worker
```

Open <http://localhost:8080> and follow the on-screen wizard.
Greenfield-mode (skips any saved state) lives at
<http://localhost:8080/?greenfield=1>.

**Worth knowing:**

- `npm start` is the same as `npm run dev` minus the discovery worker — handy
  when you're not touching discovery.
- `npm run web-only` is the dashboard alone (no scraper, no worker) — handy
  for pure-UI changes.
- The first-run wizard will ask for an AI provider key. OpenRouter's free
  tier (no credit card) is the friction-free option.

## Running the tests

This is the contract:

```bash
npm test                  # 1,800+ behavioral tests via scripts/run-tests.mjs
npx eslint .              # zero warnings (no-undef + no-unused-vars + a few)
npm run typecheck:repo    # JSDoc-driven type checking
npm run test:contract:all # discovery webhook + Pipeline schema fixtures
```

`npm test` is the one that has to be green. **Never** run
`node --test tests/*.test.mjs` directly — that glob silently skips
`tests/integration/` and you'll merge code that breaks integration.

**Pinning new behavior:** the repo prefers behavioral tests that load a
module into a `node:vm` context with stubbed `window` / `document` / host
bridges (see [`tests/enhancements-wizard.test.mjs`](tests/enhancements-wizard.test.mjs)
or [`tests/discovery-cross-rec.test.mjs`](tests/discovery-cross-rec.test.mjs)
for patterns). Source-sniff regex pins are fine for CSS / copy / wiring.

**The mutation check:** before you call a behavioral test done, temporarily
break the behavior in the source. The test should fail. Revert. Tests that
can't fail are decoration, not coverage.

## Maintainer-enforced quality gate

The merge bar is enforced by GitHub branch protection on `main` plus a few
project-local conventions. Read this section before opening a PR — every
item below is enforced in CI or by the merge rules.

### Branch protection on `main`

`main` is protected. Direct pushes are blocked; every change goes through a
pull request. The `main` ruleset currently **enforces** these checks — a
failure blocks the merge:

- `contract-tests` — discovery webhook, Pipeline schema, ATS scorecard, and
  integration-skill link checks.
- `test` — `npm run typecheck:repo`, `npm test`, and the discovery worker
  test suite.
- `scan` — gitleaks secret scan ([gitleaks.yml](.github/workflows/gitleaks.yml)).

These additional checks run on every PR and are **intended to become
required** — the maintainer must add each to the branch-protection ruleset
before it blocks a merge:

- `lint` — `npm run lint:repo` (ESLint + skill lint).
- `coverage` — `c8` coverage gate (see [Coverage floor and ratchet](#coverage-floor-and-ratchet)).
- `audit-prod` — `npm audit --omit=dev --audit-level=high`.
- `pr-lint` — Conventional Commit title check (see below).

Two checks are **advisory** (`continue-on-error: true`) and never block a
merge:

- `e2e-smoke` — Playwright boot + visibility smoke. Flakes here surface
  signal but won't hold you up.
- `audit-dev` — advisory `npm audit` summary across all dependencies
  (including dev).

PRs also require review from a CODEOWNERS owner (see
[CODEOWNERS](#codeowners)) before merge.

### Conventional PR titles

PR titles are checked by the `pr-lint` workflow and must start with one
of:

- `feat:` — new user-facing capability
- `fix:` — bug fix
- `chore:` — repo hygiene, no production change
- `perf:` — performance improvement
- `test:` — only adds or fixes tests
- `docs:` — only docs
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `build:` — build system or external dependency change
- `ci:` — CI configuration change
- `style:` — formatting-only change
- `revert:` — reverts a previous change

Only the **title** is checked; the body is freeform. This matches the
commit-message convention already used in the repo's history.

### Coverage floor and ratchet

The repo uses [`c8`](https://github.com/bcoe/c8) for coverage. The floor
is enforced in CI via `.c8rc.json` and the current thresholds are:

| Metric      | Floor  |
| ----------- | ------ |
| statements  | 49.5%  |
| branches    | 60%    |
| functions   | 49.5%  |
| lines       | 49.5%  |

The floor **only ratchets up**, never down. Adding source code without a
matching test is a merge blocker: the new coverage measurement has to
clear the existing threshold. If you're touching a hard-to-test surface,
pair the change with a regression test for the behavior you care about
(VW-style behavioral harness, mock-the-host-bridge) — not a no-op regex
sniff.

### CODEOWNERS

Review routing is configured in
[`.github/CODEOWNERS`](.github/CODEOWNERS). The maintainer
(`emilio3435`) is the default owner; tighter directory-level rules
override the default as the project grows. If you're adding a new
top-level directory or major subsystem, propose a CODEOWNERS update in
the same PR.

## How code is organized

```
.
├── index.html                  # The whole app surface; classic-script tags
├── app.js                      # The hub — wires every module's host bridge
├── bridge-registry.js          # Cross-module method registry (the seams)
├── *-wizard*.js                # First-run, profile, discovery, enhancements
├── settings-*.js               # Settings modal tabs
├── css/                        # Stylesheets (legacy- = original; tokens-v2 +
│                               # jb-v2 = newer design system)
├── partials/                   # HTML pulled into index.html at serve time
├── integrations/
│   └── browser-use-discovery/  # The TypeScript discovery worker (Node)
├── server/                     # Materials drafting + ATS scoring (Node)
├── scripts/
│   ├── run-tests.mjs           # The canonical test runner
│   └── lib/                    # Shared script utilities
├── tests/                      # Behavioral + contract tests (node:test)
│   ├── integration/            # Full-stack flow tests
│   └── e2e-smoke/              # Playwright boot + visibility smoke
└── docs/                       # Long-form: SELF-HOSTING, contract, ADRs
```

## Submitting a PR

1. **Pick a branch name with a prefix:** `feat/`, `fix/`, `chore/`, `docs/`,
   `test/`, `perf/`, `refactor/`. From `main`:

   ```bash
   git checkout -b fix/wizard-cta-clickthrough
   ```

2. **Write a failing test first**, then the fix, then green it. (Pin tests
   for pure copy/CSS changes are fine.)

3. **Run the gate locally** before pushing. If `npm test` is red on your
   branch, CI will be too — save yourself the round trip.

4. **One commit per logical change.** Imperative subjects under 72 chars.
   The body explains *why*, not *what* (the diff shows what). Trailer:

   ```
   Co-Authored-By: <Your Name> <your@email>
   ```

5. **Open the PR** against `main`. The
   [PR template](.github/pull_request_template.md) walks you through what
   to include.

6. **Expect a review.** First-pass feedback target: 48 hours. If a week
   passes silently, please nudge — I dropped it.

## Style + conventions that matter

These rules exist because we hit the bugs they prevent:

- **Browser code = classic global IIFE on `window.*`.** No ESM, no
  `import` / `export` in `.js` files served to the browser. Top-level state
  lives on an explicit namespace
  (`window.JobBoredApp.firstRunWizard = { … }`).
- **Cross-module calls go through a host bridge.** Don't reach into another
  module's globals directly — wire a method through
  [`bridge-registry.js`](bridge-registry.js) and call it via the lazy
  `host()` getter. A missing bridge key silently no-ops, so contract tests
  pin every one.
- **Match the surrounding style.** Double quotes. Two-space indent.
  Defensive `typeof` guards on host methods. `_`-prefixed unused params.
- **No `.skip`**, no committed `.only`. The gate enforces this.
- **Honest UI over silent failures.** If a save can fail, the user has to
  see it. If a status can't be known, the badge says "unknown" — not "✓".
- **Don't add a CDN to the critical path.** Vendored fonts, vendored pdf.js
  and mammoth, vendored worker assets. Network-dependent first paint isn't
  a tradeoff we make.

## Contract changes (discovery webhook + Pipeline sheet)

The agent–dashboard contract is documented in
**[AGENT_CONTRACT.md](AGENT_CONTRACT.md)** and
**[docs/CONTRACT-HARDENING-PLAN.md](docs/CONTRACT-HARDENING-PLAN.md)**. If
you change how the dashboard **sends** discovery webhooks or **reads/writes**
Pipeline columns, the machine-checkable artifacts must stay in sync.

### Discovery POST (Interface B)

When **`triggerDiscoveryRun`** in [app.js](app.js) or
[schemas/discovery-webhook-request.v1.schema.json](schemas/discovery-webhook-request.v1.schema.json)
changes:

1. Update the JSON Schema and **[examples/](examples/)** fixtures.
2. Update **[AGENT_CONTRACT.md](AGENT_CONTRACT.md)** and add a row in
   **[docs/CONTRACT-CHANGELOG.md](docs/CONTRACT-CHANGELOG.md)**.
3. Run **`npm run test:contract`** (and **`npm run test:contract:all`**
   before pushing).

### Pipeline rows (Interface A)

When **status dropdown values**, **priority symbols**, **response (S)
values**, **column headers**, or **`parsePipelineCSV`** column indices in
[app.js](app.js) change:

1. Update **[schemas/pipeline-row.v1.json](schemas/pipeline-row.v1.json)**
   (header row + enums).
2. Align **[README.md](README.md)** Sheet Structure and
   **[AGENT_CONTRACT.md](AGENT_CONTRACT.md)** as needed.
3. Run **`npm run test:pipeline-contract`** (or
   **`npm run test:contract:all`**).

### Integration skills

Files under **`integrations/**/SKILL.md`** must reference
**`AGENT_CONTRACT.md`** and
**`schemas/discovery-webhook-request.v1.schema.json`** (checked by
**`npm run lint:skills`**).

### Deferred roadmap items

**Phase 3** (optional discovery response body) and **Phase 5** (ecosystem /
n8n export / ClawHub) in the hardening plan are **not** part of the core
repo contract until the product prioritizes them — see
[docs/CONTRACT-HARDENING-PLAN.md](docs/CONTRACT-HARDENING-PLAN.md).

## What I'll do on my end

- Review your PR within 48 hours, or tell you when I will.
- Be specific in feedback. "Could you split this into two commits?" beats
  "this needs work."
- Credit you on the merge commit's trailer line if you're new to the repo.
- Not gatekeep: a smaller, simpler PR than I'd write myself is still a PR
  I'm happy to merge.

By participating, you agree to the project's
[Code of Conduct](CODE_OF_CONDUCT.md).
