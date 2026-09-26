# GFX lanes

## Quota readings, 2026-09-26 07:41–07:44 CT (native: Ant Hill snapshot dated 09-24, stale → QUOTA BLIND)

| Pool | Reading | Resets | Source |
|---|---|---|---|
| A: Claude Max (both seats) | 81% of weekly limit used | Thu Oct 2, 07:00 CT | `claude /usage`, seat 1 (seat 2 is the same account) |
| X: Codex Pro (Sol, Astra, Luna) | **100%, rate_limit_reached** | Tue Sep 29, 20:22 CT | `codex app-server` → `account/rateLimits/read` |
| X: reset credit | 1 "Full reset" available | expires Oct 22 | same call |
| K: Grok | unknown (auth file shape changed; not read) | — | — |
| M: Muse | unknown (dashboard only) | Sunday 19:00 | — |
| G: Gemini | unknown (no reliable %) | — | — |

## Lanes

| Lane | Family | Worktree | Report | Status |
|---|---|---|---|---|
| B5-RESCUE (inline) | opus (Agent tool) | ~/Job-Bored.worktrees/gfx-b5 | agent hand-back | running: C7, N5, N7 |
| GFX · plan check · grok | grok-host (pool K) | ~/Job-Bored (read-only) | reports/VERDICT-grok-plan-check.md | 08:05 WALLED: Grok weekly limit; workspace 117 closed, pid 2573 killed; nothing bought |
| GFX · plan check · grok-cursor | grok-cursor (pool C) | ~/Job-Bored (read-only) | reports/VERDICT-grok-plan-check.md | 08:08 respawned on Emilio's "grok-cursor"; grok-cursor also takes the per-lane diff reviews |
| GEMINI copy inventory / test infra | gemini-explore (pool G) | gfx-integration (plan mode) | reports/GEMINI-*.md | DONE 08:16: copy inventory (618 rows, 3/3 spot-checks exact) + test-infra map (spot-checked) |

Walls: pool X until Tue Sep 29 20:22 · pool K weekly · pool A 81%.
| SPIKE-RT (S1+S3) | opus · medium (seat 1, pool A) | ~/Job-Bored.worktrees/gfx-spike-rt | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-spike-rt/.lane-evidence/LANE-REPORT-SPIKE-RT.md | DONE 08:23: S1 PASS (Electron 44.4.5 embedded Node 24.21 runs all 3 servers; drop bundled Node); S3 PASS w/ 4 fixes; workspace 119 closed |
| BE-FUEL | opus · medium (seat 1, pool A) | ~/Job-Bored.worktrees/gfx-be-fuel | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-be-fuel/.lane-evidence/LANE-REPORT-BE-FUEL.md | DONE 08:38, floor re-run by orch, merged 3bc36f1c + test follow-up 3843e0b5 (29b7a3f6); ws120 closed; muse verify running |
| BE-CORE | opus · medium (seat 1, pool A) | ~/Job-Bored.worktrees/gfx-be-core | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-be-core/.lane-evidence/LANE-REPORT-BE-CORE.md | DONE 08:47, orch floor: lint/type 0, 314/314 unit, 845/845 worker; merged + script tags c8783617; ws121 closed |
| FE-B1 | opus · medium (seat 1, pool A) + /frontend-design | ~/Job-Bored.worktrees/gfx-fe-b1 | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-fe-b1/.lane-evidence/LANE-REPORT-FE-B1.md | DONE 09:13 + follow-up 32260662; orch floor 563/563 then integration 1225/1225; merged; ws122 closed |
| FE-B4 | opus · medium (seat 1, pool A) + /frontend-design | ~/Job-Bored.worktrees/gfx-fe-b4 | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-fe-b4/.lane-evidence/LANE-REPORT-FE-B4.md | DONE 09:19; orch floor 370/370; merged; B4 save fixed (profileWrites=1); VAL-001 now blocked only by B2 model pin -> FE-B2B3; ws123 closed |
| quota 08:55 | pool A 83% weekly (was 81% at 07:41) — 4 lanes + spike used ~2pts | | | |
| FE-B2B3 | opus · medium (seat 1, pool A) + /frontend-design | ~/Job-Bored.worktrees/gfx-fe-b2b3 | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-fe-b2b3/.lane-evidence/LANE-REPORT-FE-B2B3.md | DONE 09:46; orch floor 377/377; merged; e2e-onboarding 7/7 (VAL-001 GREEN) + journey 33/33; ws124 closed |
| FE-B5 | opus · medium (seat 1, pool A) + /frontend-design | ~/Job-Bored.worktrees/gfx-fe-b5 | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-fe-b5/.lane-evidence/LANE-REPORT-FE-B5.md | DONE 09:56; orch floor 515/515; merged; ws125 closed |
| FOLLOW-UP DOCK-375 | P1 from FE-B2B3: footer dock message slot off-screen at 375px (every beat's error invisible on phones); shared ONEFLOW:CORE CSS; queued for next slot | | | |
| DESK-B | opus · medium (seat 1, pool A) | ~/Job-Bored.worktrees/gfx-desk-b | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-desk-b/.lane-evidence/LANE-REPORT-DESK-B.md | DONE; orch floor 446/446 + runtime marker 2231e374 (red-first); merged; integration 1598/1598, worker 845, e2e 7/7+33/33; ws126 closed |
| DESK-A | opus · medium (seat 1, pool A) | ~/Job-Bored.worktrees/gfx-desk-a | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-desk-a/.lane-evidence/LANE-REPORT-DESK-A.md | DONE 13:08; orch: 47/47 desktop tests, packaged smoke from copy outside checkout ok (runtime desktop, ports freed, live worker untouched); DMG 256MB (universal Electron 507MB Frameworks); merged; ws127 closed |
| DESK-D | opus · medium (seat 1, pool A) | ~/Job-Bored.worktrees/gfx-desk-d | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-desk-d/.lane-evidence/LANE-REPORT-DESK-D.md | DONE 12:46; orch: lint 0, 10/10, action SHAs verified upstream; merged; ws128 closed |
| SOL-HARDEN | sol · xhigh (pool X) | ~/Job-Bored.worktrees/gfx-sol-harden | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-sol-harden/.lane-evidence/LANE-REPORT-SOL-HARDEN.md | spawned 12:49; owns GFX-REG-1 (9 chain regressions) + BE adversarial review + leftovers |
| quota 12:47 | pool X (Codex) RESET: 0% used, resets Sat Oct 3 11:59; reset credit still unused (1). Emilio: Sol xhigh where needed, Astra xhigh very sparingly. Pool A 86%. | | | |
| FULL-SUITE 12:47 | HOME-isolated npm test on integration 36f2c966: 4556 pass / 9 FAIL (all tests/integration/onboarding-chain-convergence.test.mjs); origin/main baseline 0 fail; host unchanged both runs. GFX-REG-1 -> SOL-HARDEN. Lesson: lane floors skipped tests/integration/ | | | |
| BOARD | Live progress page: https://claude.ai/artifact/D4VLstP6XFaqoF6e5EuQvB (source: scratchpad board/gfx-board.html; republish on every lane event) | | | |
| QA-LIVE | astra · xhigh (pool X, cua) | integration :8080 isolated HOME | reports/QA-LIVE.md | spawned 13:26; single run; Emilio does B1 client-ID+sign-in, B2 key, B5 key |
| QA-LIVE guard 16:53 | QA-LIVE alive at handoff: cmux workspace:113 "Astra QA testing run", codex pid 43860 (`-p cua -m gpt-6-astra` xhigh, cwd gfx-integration). UXD spawn touched none of it: no input, messages, closes, binds or kills | | | |
| quota 16:53 | pool X (Codex) 3% weekly used, resets Sat Oct 3 11:59 CT, reset credit still 1 unused (`codex app-server` → `account/rateLimits/read`). Pool A: UNKNOWN fresh (no non-interactive probe); last reading 86% at 12:47, stale | | | |
| UXD-FE | opus · medium (seat 1, pool A) + /frontend-design | ~/Job-Bored.worktrees/gfx-uxd-fe (feat/gfx-uxd-fe) | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-uxd-fe/.lane-evidence/LANE-REPORT-UXD-FE.md | spawned 16:53:59 on base dd45a692; cmux workspace:142 "GFX · UXD-FE · opus · 09-26"; pid 34039 pins verified (claude-opus-5-5, effort medium, auto) |
| UXD-BE | sol · high (pool X; Emilio's explicit order) | ~/Job-Bored.worktrees/gfx-uxd-be (feat/gfx-uxd-be) | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-uxd-be/.lane-evidence/LANE-REPORT-UXD-BE.md | spawned 16:54:06 on base dd45a692; cmux workspace:143 "GFX · UXD-BE · sol · 09-26"; pid 35127 pins verified (gpt-6-sol, reasoning high, profile be-hard) |
| cmux sweep 17:08 | closed ws2, ws116 (bare shells) and ws1, ws118 grok-cursor, ws129 SOL-HARDEN (idle, work merged); resume handles in docs/cleanup/2026-09-26-cmux-inventory.md. grok-cursor must be respawned for UXD diff reviews. QA-LIVE, UXD-FE/BE and ws104 untouched | | | |
| SOL-TAILNET | sol · xhigh (pool X) | ~/Job-Bored.worktrees/gfx-sol-tailnet | /Users/emilionunezgarcia/Job-Bored.worktrees/gfx-sol-tailnet/.lane-evidence/LANE-REPORT-SOL-TAILNET.md | spawned 17:08; D13 owner-only tailnet setup |
| UXD align 17:11 | **aligned**: identical AGREED CONTRACT block in both UXD reports (sha256 b1e4db62…); additive progress.heartbeatAt (15s) + counters + current + sources(≤8); FE live ≤30s / quiet 30–120s / stalled >120s. Both lanes now in phase 2 | | | |
| UXD-BE result 17:25 | DONE: commit 7a6b2ba1 on feat/gfx-uxd-be (10 files, +383/−14; schema+example+AGENT_CONTRACT+CHANGELOG moved together). Lane floor: lint 0, typecheck 0, contract:all 0, touched suites 148/148, gitleaks clean; its full worker suite was sandbox-blocked (EPERM loopback). Orch re-ran `npm run test:browser-use-discovery` in the worktree with an isolated HOME: 936/936, 0 fail. Not merged | | | |
| UXD-FE result 17:26 | DONE: commits d8e9d8df + 45b28a99 on feat/gfx-uxd-fe. Lane floor: lint 0, typecheck 0, 482/482 root suites, visual 9/9 (Chromium, port 0), e2e-journey discovery green, gitleaks clean. Open §5 items for integrator: e2e check against the instrumented worker once both merge; decide whether tests/gfx-uxd-fe-visual.mjs moves to tests/e2e-visual/; pre-existing "— —" in the Runs Why cell. Not merged | | | |
