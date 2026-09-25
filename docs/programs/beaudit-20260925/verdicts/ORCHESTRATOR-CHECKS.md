# Orchestrator checks (opus, this session) — 2026-09-25

The orchestrator re-ran every P0 reproducer itself after Muse, from each lane worktree at `f227fbb`, and confirmed the one row Muse could not run from the lane worktree (A10). Every run left no listener on the lane's port range and no tracked-file change.

| Row | Command (from the lane worktree root) | Result |
|---|---|---|
| A1 | `sh .lane-evidence/probes/repro-a1-crash.sh` | REPRODUCED: `before: health=200` → `after: health=DOWN`, `worker process: EXITED`, `TypeError: Invalid URL at … src/server.ts:1021:22` |
| C1 | `HOME="$PWD/.lane-evidence/home" node --experimental-strip-types .lane-evidence/probes/C-ssrf-session.mjs` | REPRODUCED: `session(no command) loopback -> {"mode":"fetch","text":"PROBE-INTERNAL-SECRET path=/secret"}`; `policy(http://169.254.169.254.nip.io/) -> "extractable"` |
| E1 | `bash .lane-evidence/probes/probe-e-cors.sh` | REPRODUCED: rebound `POST /api/llm-config` → `200`, pin on disk becomes `{provider:'openai_compatible', model:'exfil', baseUrl:'https://attacker.test/v1', keyPresent:false}`; `/health` then reports `atsConfigured:true` |
| G1 | `node .lane-evidence/probes/g-relay-open-proxy.mjs` | REPRODUCED: `anon POST / -> relay 202`, `anon POST /webhook -> relay 202`, `anon POST /anything/else -> relay 202`, upstream sees `secret: probe-secret` |
| G2 | `bash .lane-evidence/probes/g-build-mirror.sh && bash .lane-evidence/probes/g-start-servers.sh && bash .lane-evidence/probes/g-profile-rebind.sh` | REPRODUCED: rebound write `{"ok":true,…}  [200]`, readback `PROBE-REBIND-WRITE` |
| A10 | `grep` over `prs/PR-{107,108,109,113}.diff` | CONFIRMED: #107 and #109 each add `export function resolveDiscoveryRunLogError` to `sheets/discovery-runs-writer.ts`; #108 adds `formatDiscoveryRunLogError` to the same file and `run-status-store.ts`; #113 edits the same `error:` field. Any two conflict. |

Muse verdict totals (verdicts/VERDICT-<L>.json): A 23/23 REPRODUCED (+A10 could not run → checked above) · B 28/28 · C 41 REPRODUCED + 1 UNCLEAR (C12) · D 34/34 · E 26/26 · F 34/34 · G 32/32 · H 22/22 (+H9 could not run: live Telegram). NOT-REPRODUCED: 0.
