# Lane SPIKE-RT: Option C spikes S1 (runtime) and S3 (read-only bundle, greenfield)

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `PLAN.md`, section "Option C", which lists the blockers and the spike table
- `SPEC.md` §0, D8–D12

This is a **spike**: you write no product code. You deliver evidence and a verdict. The one exception is throwaway scratch files under `desktop-spike/`, which you commit so the result can be reproduced; the integration branch never merges it.

**Routing (D12):** planned for sol; runs on **opus** while pool X is walled.

**Goal:** answer two questions with commands and pasted output.
- **S1:** can the Electron release we would ship run JobBored's three servers on its own embedded Node? That means `ELECTRON_RUN_AS_NODE=1` with `process.execPath`, with `node:sqlite` importable and `--experimental-strip-types` running `integrations/browser-use-discovery/src/server.ts`.
- **S3:** run from a read-only copy of the repo with an empty `HOME`, and check whether the stack boots and a greenfield user gets through B1–B5 with no write attempted inside the bundle.

**Success means:**
- `docs/programs/gfx-20260926/reports/SPIKE-S1-runtime.md` records:
  - the Electron version tried (latest stable, installed with `npm i electron@latest` inside `desktop-spike/` only);
  - `process.versions.node`;
  - the result of `import('node:sqlite')`;
  - whether strip-types runs `server.ts`;
  - the verdict: **PASS** (drop the bundled Node) or **FAIL** (bundle a universal Node 24), with the exact error.
- `docs/programs/gfx-20260926/reports/SPIKE-S3-readonly.md` records:
  - a copy of the runtime files made unwritable (`chmod -R a-w`);
  - `HOME` pointed at an empty temp dir;
  - the three servers started directly with `node` on **high ports**: dev-server `PORT=18480`, scraper 18481, worker 18482, using env overrides (find how each reads its port);
  - curl probes of `/__proxy/ping`, `/health` and the worker health;
  - a headless Playwright walk (if feasible) through the dashboard's first beats, or curl coverage of the endpoints B1–B5 call;
  - **every** EACCES, EROFS or ENOENT write attempt, with file:line and the relocation proposed (see PLAN's Option C blocker 2);
  - whether a missing `config.js` still lets the dashboard boot.
- Every started process is killed at the end. The report shows `lsof` confirming ports 18480–18482 are free.

**Stop when:** both reports are written with pasted evidence and verdicts, or you are blocked twice.

## Fence

- `desktop-spike/**` (scratch)
- `docs/programs/gfx-20260926/reports/SPIKE-S1-runtime.md`, `SPIKE-S3-readonly.md`
- your `.lane-evidence` report

**Do NOT touch** any product file.
- Never bind 8080, 8644 or 3847.
- Never read or copy `~/.jobbored`; your `HOME` is a fresh temp dir.
- Never write to `~/Library/LaunchAgents`.

## Non-negotiables

- Use no real keys. The worker may refuse to start without some env; record what it needs instead of supplying real secrets.
- Run no npm install at the repo root. Install only inside `desktop-spike/`.

## Definition of Done

Both spike reports hold pasted command output and a one-line verdict at the top. The LANE-REPORT's first line is `DONE`.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
