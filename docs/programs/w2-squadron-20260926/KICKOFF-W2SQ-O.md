# W2SQ lane O: Ops and hosted

Read `.lane-evidence/KICKOFF-W2SQ-_SHARED.md` first. It is binding.

## Outcome
Goal: close BEAUDIT wave-2 lane **O** (Ops and hosted) register claims in this worktree (`feat/w2sq-O`), each proven by a test that went red first.
Success means: every claim below is either fixed with a named red-then-green test, or deferred with a written reason. The floor is green. Commits are local.
Stop when: the report's first line reads `DONE`, or you are blocked twice on the same thing (`BLOCKED: <why>`).

## Claims (read each row in `.lane-evidence/ref/REGISTER.md`)
G5, G6, G7, G8, G9, G11, H14, G12, G13, G14, G15, G16, G19, G20, E5, E6

Locked decisions that apply: §0.4 (see `.lane-evidence/ref/SPEC-BEAUDIT-20260925.md` §0).

## Fence (you own these; stay inside)
- scripts/** (not setup.mjs)
- dev-server.mjs (worker lifecycle, installers and Tailscale sections)
- server/Dockerfile, server/.dockerignore, render.yaml
- package.json (scripts), .github/workflows/ci.yml, .github/workflows/pages.yml
- integrations/browser-use-discovery/src/server.ts (/health payload identity fields only)
- README.md (platform matrix and hosted sections)
- tests for these claims

## Probes to promote into tests (under `.lane-evidence/ref/probes-*`)
- G/g-port-collision.sh
- G/g-respawn-hold.sh
- G/g-fullboot-foreign-checkout.mjs
- G/g-autostart-status-artifact.mjs
- G/g-keepalive-tailscale.mjs
- G/g-env-writer-dollar.mjs
- E/probe-e-docker-sim.sh
- E/probe-e-hosted.sh

## Notes from the audit plan
Worker /health gains {repoRoot, version, envSources}; the starter names the port owner and holds instead of exiting; hosted mode works end to end (E5, E6) per §0.4.

## Additions to O (orchestrator)
- `package.json`: edit the `scripts` block only. Lane E owns dependency versions.

## Floor
Run the shared floor. Your report's section 4 must paste the tails of `npm run lint:repo`, `npm run typecheck:repo` and `npm test`, plus the worker suite and the e2e suites your claims touched.
