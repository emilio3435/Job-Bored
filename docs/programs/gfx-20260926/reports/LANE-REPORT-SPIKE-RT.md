DONE

## 1. Mission
Option C spikes S1 (Electron runtime) and S3 (read-only bundle, greenfield). Evidence only; no product code. Ran on opus per D12.

## 2. Claims that went red first
- S1: `POST /__proxy/start-discovery-worker` on the Electron dev-server gave `worker_start_timeout`. The cause is greenfield, not the runtime (the child reported `Node.js v24.21.0`, which is Electron's). It became S3 F1.
- S3 (all in `SPIKE-S3-readonly.md` §4):
  - F1: the worker dies without `~/.jobbored/browser-use-discovery/.env` (`config.ts:847`).
  - F2: full-boot `force_restart` is a no-op, because `lsof` isn't on `/usr/bin:/bin`.
  - F3: `discovery-local-bootstrap.json` gets EACCES (`start-discovery-worker-local.mjs:215,239`).
  - F4: `spawn node ENOENT` (`:558`).
- Ledger: D8–D12, PLAN Option C blockers 1–2.

## 3. What shipped, file and fence
- `36c10fa2` desktop-spike/** scratch: package.json (+lock, electron 44.4.5), s1-three-servers.sh, s3-readonly.sh, s3-edges.sh, s3-walk.mjs, s3-write-tracer.mjs, .gitignore (node_modules).
- `c3f014da` docs/programs/gfx-20260926/reports/SPIKE-S1-runtime.md (**PASS, drop the bundled Node**), SPIKE-S3-readonly.md (**PASS with 4 fixes**).
- No product file touched.

## 4. Floor results
```
$ npm run lint:repo   -> exit=0
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md

> command-center@0.1.0 lint:tokens
> node tools/lint-tokens.mjs

lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
$ npm run typecheck:repo   -> exit=0


> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
$ gitleaks protect --staged --redact
INF scanned ~46094 bytes (46.09 KB) in 10.8ms
INF no leaks found
$ lsof -nP -iTCP:18480-18482 -sTCP:LISTEN
lsof exit=1 (1 = nothing listening)
```
The kickoff names no test files, so no `node --test` ran. Pre-commit validation passed on both commits.

## 5. Unverified / sandbox refused
- **Not verified:**
  - B1 Google sign-in (needs real OAuth);
  - `/profile/from-resume` and `/__proxy/serpapi-check` (third-party calls with keys);
  - `fix-setup` and `install-keep-alive` (global tunnel and launchd state, fenced);
  - the python3 logo resolver (not reached: empty logos);
  - TLS on a fresh bundle;
  - the x64 and universal Electron build;
  - behaviour when signed (S2).
- **Harness refused one command:** the hook blocked an `rm -rf` of scratch edge dirs. I worked around it by writing to fresh dirs; nothing needed deleting.
- **For the integrator:**
  - DESK-B/BE-FUEL should take F1 and F2 as P1.
  - Staging must exclude `node_modules/.cache`: it carried a localhost TLS key into the bundle.
  - A missing `config.js` returns 403 `text/plain`, not 404, and throws a console error on every greenfield load.
- **Deviation:** the kickoff's commit trailer names a different Claude-Session URL than this session's. I used the kickoff's lines as written.
