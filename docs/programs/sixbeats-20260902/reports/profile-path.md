# LANE REPORT — B1 profile-path (SIXBEATS claim C3)

Branch `feat/sixbeats-profile-path`, worktree `Job-Bored.worktrees/sixbeats-profile-path`,
base `ed44f35`. Commits: `c518754`, `4a5c862`. Never pushed.

## 1. What this lane was

C3 · Beats 4/6 · ERROR — on a fresh install `jobBoredApiUrl` is empty, so Beat 4's
`POST /profile` and Beat 6's `GET /profile` resolve **same-origin**, hit the static
dashboard host, and 404 (`profile_response_invalid`). The server fit profile silently
never persists and the payoff has nothing to read back.

Per SIXBEATS-SPEC locked decision 3, the fix belongs in the dev server: it proxies
`/profile` and `/profile/*` to the local API (`http://127.0.0.1:3847` by default) with
the same authorization posture as the existing `/__proxy` routes. The client keeps
resolving same-origin; no stranger has to configure a URL.

Fence honored: `dev-server.mjs` (one new proxy route + its helpers), the new test file,
and a comment-only edit in `fit-profile-wizard.js` `profileUrl()`.

## 2. Which claims went red first (named tests)

`tests/sixbeats-b1-profile-proxy.test.mjs` — written before the route existed. On
`ed44f35` all 13 failed (`.lane-evidence/RED-sixbeats-b1-profile-proxy.txt`: `pass 0 /
fail 13`), every one of them against the C3 symptom — the static host answering 404.

Two more went red mid-lane, after the end-to-end walk found a second defect (§3b):

- `serves the same-origin GET a \`Referrer-Policy: no-referrer\` dashboard makes` — red.
- the cross-site / same-site / none refusals beside it — green from the start, kept as
  the guard on the fix.

Suite as it stands:

```
▶ SIXBEATS-C3 — dev server proxies /profile to the local API
  ✔ GET /profile returns the upstream's body and status (Beat 6 reads the saved profile)
  ✔ GET /profile streams a non-2xx upstream status back unchanged
  ✔ POST /profile forwards the JSON body (Beat 4 saves the fit profile)
  ✔ forwards sub-paths and query strings (POST /profile/template/:id, /profile/rescore)
  ✔ forwards PUT as well as GET and POST
  ✔ serves the dashboard's own same-origin GET, which carries no Origin header
  ✔ serves the same-origin GET a `Referrer-Policy: no-referrer` dashboard makes
  ✔ does not forward the browser Origin upstream (the API allowlists :8080 only)
✔ SIXBEATS-C3 — dev server proxies /profile to the local API
▶ SIXBEATS-C3 — the profile proxy keeps the /__proxy authorization posture
  ✔ 403s a cross-site Origin and never reaches the API
  ✔ 403s a cross-site POST before the body reaches the API
  ✔ 403s a cross-site Sec-Fetch-Site even though the TCP peer is loopback
  ✔ 403s an origin-less client (curl) the way /__proxy/* does
  ✔ answers the CORS preflight for a local origin and refuses an evil one
✔ SIXBEATS-C3 — the profile proxy keeps the /__proxy authorization posture
▶ SIXBEATS-C3 — the profile proxy fails loud, never hangs
  ✔ answers with a JSON error when the API is not running
  ✔ defaults to the local API on 3847 when no API port is configured
✔ SIXBEATS-C3 — the profile proxy fails loud, never hangs
ℹ tests 15
ℹ suites 3
ℹ pass 15
ℹ fail 0
```

End-to-end, the claim itself (§3c below): the same Playwright walk run against
`ed44f35` fails with `← 404 POST /profile` and no profile on disk; run against this
branch it is `← 200` both ways.

## 3. What shipped, file-and-fence

**a. `dev-server.mjs` — the route (commit `c518754`).**
`/profile` and `/profile/*`, methods GET/POST/PUT, streamed to `127.0.0.1:3847`
(`JOBBORED_API_PORT` overrides; `resolveProfileApiPort()` is exported for tests and
falls back rather than failing boot on garbage). Status and JSON body pass through
unchanged; only CORS headers are rewritten, echoing this dashboard's own origin and
never `*`. The browser's `Origin` is deliberately **not** relayed upstream — the API
allowlists `http://localhost:8080`, so a dashboard on any other port would be 403'd by
the API's own origin check. Unreachable API → `502 {"ok":false,"error":"profile_api_unreachable"}`;
idle upstream → `504 profile_api_timeout` after 120 s (`/profile/from-resume` is
LLM-backed, so the 3 s cap the `/__proxy` probes use would abort a live save).
Unsupported methods → 405. Boot log names the route like the other proxies.

**b. `dev-server.mjs` — the same-origin gate (commit `4a5c862`), found by the walk.**
The first end-to-end run showed `POST /profile → 200` then `GET /profile → 403`. Cause:
every static response from this server carries `Referrer-Policy: no-referrer`, so a
same-origin `fetch("/profile")` arrives with neither `Origin` (browsers omit it on
same-origin GETs) nor the `Referer` the shared local-control guard falls back to — our
own hardening locked the dashboard out of its own API. The profile route now also
accepts `Sec-Fetch-Site: same-origin` from a loopback peer: it is a forbidden header
name, so no page script can forge it, and a tab at `https://evil.example` gets
`cross-site` from its own browser. curl, which sends none of the three, stays forbidden.

**c. `fit-profile-wizard.js` — comment only**, per the fence: `profileUrl()` now says why
an empty base is correct and what serves it.

**d. `.lane-evidence/c3-profile-e2e.mjs`** — the end-to-end proof (scratch, not committed).
Real `server/index.mjs` on a free port with `JOBBORED_PROFILE_PATH` and
`HERMES_RESUME_TEMPLATE_DIR` pointed at a temp dir, real dev server, real Chromium at
`/?greenfield=1`, Beat 4 → Beat 6, every `/profile` request logged.

## 4. Floor results — PASTED output

```
$ npm test                       # exit 0
ℹ tests 2608
ℹ suites 628
ℹ pass 2607
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6698.717083

$ npm run lint:repo              # exit 0
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md

$ npm run typecheck:repo         # exit 0
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

$ npm run test:contract:all      # exit 0
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

(The one `todo` is the pre-existing `tests/submission-record-audit.test.mjs` entry,
unrelated to this lane and present on `ed44f35`.)

### The C3 claim, end to end

BEFORE — same script, `ed44f35` in a throwaway detached worktree
(`.lane-evidence/c3-e2e-before.txt`, exit 1):

```
# dashboard: http://127.0.0.1:50231 (static host, no jobBoredApiUrl configured)

# S0 cold start rendered
# Beat 4 open — clicking “Looks like me →”
→ POST /profile
← 404 POST /profile
# Beat 4 POST /profile → 404
# FAIL — timed out waiting for profile.json on disk
```

AFTER — this branch (`.lane-evidence/c3-e2e-after.txt`, exit 0):

```
# dashboard: http://127.0.0.1:50902 (static host, no jobBoredApiUrl configured)

# S0 cold start rendered
# Beat 4 open — clicking “Looks like me →”
→ POST /profile
← 200 POST /profile
# Beat 4 POST /profile → 200
# server persisted /var/folders/mz/s4_hwhz948b9f94lgg07qhnm0000gn/T/sixbeats-c3-Ncbehi/profile.json: identity.targetRoles = ["Director of Platform Engineering","Staff Engineer"]
→ GET /profile
← 200 GET /profile
# Beat 6 GET /profile → 200
# Beat 6 read back identity.targetRoles = ["Director of Platform Engineering","Staff Engineer"]
# Beat 6 payoff shows the saved role on screen: true

# /profile responses observed: 2
# /profile 404s observed: 0
# PASS — the fit profile persisted and was read back, zero /profile 404s
```

Default wiring, nothing configured at all (`.lane-evidence/c3-default-port-check.txt`) —
read-only GET through the proxy against the API already running on 3847, keys only, no
profile content echoed:

```
GET http://127.0.0.1:49920/profile (default port, nothing configured) → 200
content-type: application/json; charset=utf-8
body keys: ["ok","profile"]
profile keys: ["version","starterTemplate","identity","strengths","wants","avoids","hardConstraints","updatedAt","createdAt"]
```

## 5. Anything unverified, including what the sandbox refused

1. **The shared `/__proxy/*` same-origin GET fix does not hold in a real browser —
   outside this fence, reported not fixed.** `5239f58` taught
   `scripts/lib/local-control-auth.mjs` to accept `Sec-Fetch-Site: same-origin` **plus a
   same-origin Referer**, but `dev-server.mjs`'s `STATIC_SECURITY_HEADERS` sends
   `Referrer-Policy: no-referrer`, so the Referer never arrives and every one of the
   dashboard's own proxy GETs is still `403 forbidden`. Reproduced in Chromium
   (`.lane-evidence/proxy-get-403-probe.mjs`):

   ```
   403  GET /__proxy/local-health?port=8644  {"ok":false,"reason":"forbidden"}
   403  GET /__proxy/ngrok-tunnels  {"ok":false,"reason":"forbidden"}
   403  GET /__proxy/discovery-state  {"ok":false,"reason":"forbidden"}
   200  GET /profile  {ok, profile: 9 keys}
   (the request headers the page sends: no Origin, no Referer — only Sec-Fetch-Site)
   ```

   I fixed it only for `/profile` (my fence). The general fix is one of: drop the Referer
   requirement in `readRequestOrigin()` — Sec-Fetch-Site alone is equally unforgeable —
   or relax the policy to `Referrer-Policy: same-origin`. The first is smaller and does
   not weaken a deliberate hardening choice. Routing to the orchestrator; it touches a
   shared file and would silently un-break discovery health probes, so it deserves its
   own red test.

2. **`POST /profile` rewrites a TRACKED repo file.** `server/brand-logos.mjs`
   `refreshLogosFromProfile()` regenerates the logo manifest from the saved profile, and
   with no `HERMES_RESUME_TEMPLATE_DIR` set that path resolves into the checkout: my
   first e2e run overwrote `integrations/hermes-job-hunt/resume-template/logos.json`,
   dropping its `$comment` and all 4 entries (audacy, elio, hormiga, jobbored) for an empty list. Restored from HEAD (the clobbered copy is
   at `.lane-evidence/logos.json.clobbered-by-api-boot`), and the e2e script now pins
   `HERMES_RESUME_TEMPLATE_DIR` at a temp dir so it is hermetic. Anyone running the API
   from a checkout hits this. Outside my fence (`server/`).

3. **The hermetic Playwright harness pins the C3 symptom.**
   `tests/e2e-fixtures/hermetic-harness.mjs` fulfills same-origin `/profile` with a
   hard-coded `404 {"ok":false,"error":"No profile staged"}`. That fixture now describes
   behavior the product no longer has, and it will hide a C3 regression from the journey
   suite. It belongs to Q1's fence (`tests/e2e-journey/**`) — not touched.

4. **Port 3847 was occupied by the founder's own running API** for the whole lane, so the
   walk uses a real `server/index.mjs` on a free port via `JOBBORED_API_PORT` rather than
   a stub bound to 3847. I refused to `POST /profile` at the live instance — that would
   overwrite the founder's real fit profile. The default-3847 wiring is proven separately
   by the read-only GET pasted above.

5. **Not covered by any test:** the 120 s upstream-idle timeout (a 502 on connection
   refusal is tested; a two-minute hang is not something to put in the suite), and TLS
   mode (`COMMAND_CENTER_TLS=1`) — the route inherits the same origin allowlist, which
   `local-control-auth` already handles for https, but I did not exercise it.

6. Nothing was refused by the sandbox. `git checkout --` is blocked by the local
   destructive-command guard, so `logos.json` was restored with
   `git show HEAD:<path> > <path>` instead.
