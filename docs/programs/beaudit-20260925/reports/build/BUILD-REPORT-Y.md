DONE

# BUILD-REPORT-Y: Relay path retirement (RGHA), 2026-09-25

Branch feat/beaudit-w1-y. Commits: 63fd4219 ("fix(discovery): GitHub Actions refuses a relay webhook URL with a note") be8087c3 (repair round 1: "test(discovery): stub fetch in VAL-ROUTE-010 so preflight never hits network") and 17e74660 (repair round 2: "fix(discovery): accept Apps Script 302; refuse only JobBored relays"). Nothing pushed or merged.

## Claims done
- **RGHA**: done. A GitHub Actions workflow whose COMMAND_CENTER_DISCOVERY_WEBHOOK_URL is a relay now exits non-zero with the migration note: redeploy the relay with --sheet-id and let Cloudflare Cron schedule runs, or point the secret at the worker's public URL or an Apps Script /exec URL.
  - (Superseded by repair round 2, below.) A relay was either any `workers.dev` host (checked case-insensitively, with any port, path, query or userinfo removed; no POST is sent), or a 401 whose body is the relay's own refusal (`{"error":"Unauthorized"}` or `relay_token_not_configured`). The worker's own 401 body (`{ok:false,...}`) does not count as a relay.
  - Any other receiver still gets the POST. A non-2xx answer now fails the job instead of passing silently.
  - templates/github-actions/command-center-discovery.yml and .github/workflows/command-center-discovery.yml are now byte-identical. The repo copy had drifted: it used an inline jq payload and had no checkout step. settings-profile-tab.js embeds the template verbatim, and the new line array was generated from the file.
  - The empty SECRET_HEADER array now expands portably, as `${arr[@]+"${arr[@]}"}`, so the script also runs under bash 3.2.
  - Copy: the Settings Tier 3 secrets step says the relay is not a target. The wizard's relay deploy prompt gained step 6: do not point GitHub Actions at the relay; its Cloudflare Cron schedules runs. docs/SETTINGS-SCHEDULE.md and templates/github-actions/README.md now say the workflow stops on a relay URL.

## Claims deferred
- None.

## Repair round (Muse floor failure: VAL-ROUTE-010)
- Symptom: test:browser-use-discovery failed with 805 tests, 804 passing, 1 failing ("grounded_web should have querySummary with modifier-driven search queries").
- Cause (confirmed): the failure predates this lane, which never touched the worker. VAL-ROUTE-010 let strict preflight fetch https://example.com for real. When that took longer than the source timeout (the failing run took 12006ms), the grounded collection aborted ("This operation was aborted") and querySummary came back empty. The test failed in 3 of 6 local runs before the fix.
- Fix: the test stubs globalThis.fetch with a 200 HTML page and restores it in finally. The assertions are unchanged, and no src/ file changed.
- Red: a stub that hangs until abort reproduces the same assertion failure (pass 0, fail 1).
- Green: 10 of 10 isolated runs passed, about 0.2s each.

## Fence leeway edits
- integrations/browser-use-discovery/tests/webhook/routing-enforcement.test.ts (repair round): a test-only fetch stub for VAL-ROUTE-010, as the Muse repair asked. It is outside lanes S and L's src fences.
- partials/discovery-drawer.html: the Settings Tier 3 copy lives in this partial, not in settings-profile-tab.js. I added one sentence to the secrets step and nothing else.

## Tests added (red, then green)
- **New: tests/relay-github-actions-refusal.test.mjs** (14 tests). It extracts the template's `run:` script and runs it under bash, with a fake `curl` (logs argv and answers FAKE_STATUS/FAKE_BODY) and a fake `node` first on PATH. No network is used.
  - Red 1 (.lane-evidence/rgha-red.txt): pass 2, fail 8.
    - The four relay cases failed because no migration note was printed.
    - The repo workflow was not identical to the template.
    - The three non-relay "posts" cases failed on macOS bash 3.2's `SECRET_HEADER[@]: unbound variable`. That is a portability failure, not the claim. GitHub's bash 5 would have posted, but also exited 0 on any HTTP status.
  - Red 2, copy tests (.lane-evidence/rgha-copy-red.txt): pass 10, fail 4 (Settings step, wizard prompt, two docs).
  - Green (.lane-evidence/rgha-copy-green.txt): pass 14, fail 0.
  - Related suites (discovery-wizard-*, settings-*, relay-*, cloudflare-relay-*): pass 306, fail 0.
- No existing test changed. tests/relay-github-actions-retired.test.mjs (lane R) still passes.

## Repair round 2 (second-vendor review, two P2s)
- **P2, template line 78: Apps Script 302.** Apps Script runs doPost, then answers 302 to a one-time `script.googleusercontent.com/macros/echo` URL. The 2xx-only check made that exit 1. Fix: curl now writes `%{http_code} %{redirect_url}`. On a 302 or 303 whose Location host is exactly `script.googleusercontent.com`, the job reads the echo by GET, without `x-discovery-secret` and without `-L`, and uses that status. No other redirect is followed. The job fails with "It redirected to <host>; point ... at the final URL".
- **P2, template line 55: all of workers.dev refused.** The up-front refusal now matches only JobBored relay worker names: `jobbored-discovery-relay.*.workers.dev`, `jobbored-discovery-relay-*.workers.dev` (the deploy script's default `jobbored-discovery-relay-<suffix>`), and `command-center-forward.*.workers.dev` (the wrangler.toml name). `custom-discovery.account.workers.dev/webhook` now gets its POST. A relay under a custom name is still caught by the relay-auth 401 check.
- The template, the repo workflow and the Settings-generated copy stay identical. The JS line array was regenerated from the template.
- Docs: the "workflow now stops" paragraph in templates/github-actions/README.md and docs/SETTINGS-SCHEDULE.md now names the relay worker names and the Apps Script 302 handling.
- Test changes in tests/relay-github-actions-refusal.test.mjs (now 22 tests):
  - Generic workers.dev relay URLs became JobBored relay names, because the pinned behavior changed. The commit body says so.
  - New: `custom-discovery.account.workers.dev/webhook` and `my-discovery.jobbored-discovery-relay.workers.dev/webhook` are posted.
  - New: a realistic Apps Script 302 (a Moved Temporarily HTML body plus an echo Location with `&`). Expected: exit 0, a POST then a GET, no `-d` or POST on the GET, and the secret not sent.
  - New: an echo that answers 500 fails the job.
  - New: a 302 to another host fails without being followed.
  - New: the Settings-generated (9:30) workflow handles the Apps Script, custom workers.dev and relay cases.
  - Red against the pre-fix workflow files (.lane-evidence/rgha-repair2-red.txt): pass 18, fail 4. The failures are the custom workers.dev URL, the nested jobbored-discovery-relay subdomain, the Apps Script 302, and the Settings-generated run.
  - Green: pass 22, fail 0.

## Floor (repair round 2; fresh HOME=$(mktemp -d), PLAYWRIGHT_BROWSERS_PATH set; logs in .lane-evidence/floor-repair2/)
```
lint:repo exit=0                    lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
typecheck:repo exit=0               no errors
test exit=0                         ℹ tests 3757 ℹ pass 3749 ℹ fail 0 ℹ skipped 0 ℹ todo 8
test:browser-use-discovery exit=0   ℹ tests 805 ℹ pass 805 ℹ fail 0 ℹ skipped 0
test:contract:all exit=0            12 OK, 0 FAIL
test:e2e-smoke exit=0               24 passed
test:e2e-journey exit=0             33 passed
test:e2e-onboarding exit=0          7 passed
```

## Floor (repair round 1; fresh HOME=$(mktemp -d), PLAYWRIGHT_BROWSERS_PATH set; logs in .lane-evidence/floor-repair/)
```
lint:repo EXIT:0                    lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
typecheck:repo EXIT:0               no errors
test EXIT:0                         ℹ tests 3749 ℹ pass 3741 ℹ fail 0 ℹ cancelled 0 ℹ skipped 0 ℹ todo 8
test:browser-use-discovery EXIT:0   ℹ tests 805 ℹ pass 805 ℹ fail 0 ℹ cancelled 0 ℹ skipped 0 ℹ todo 0
test:contract:all EXIT:0            12 OK, 0 FAIL
test:e2e-smoke EXIT:0               24 passed
test:e2e-journey EXIT:0             33 passed
test:e2e-onboarding EXIT:0          7 passed
```
The 8 todo tests in `test` belong to lane L (E7 error envelope). They are not failures.

## Unverified
- Other runDiscovery tests in routing-enforcement.test.ts may still reach the network during preflight. Only VAL-ROUTE-010 was in scope for this repair.
- No real GitHub Actions run. The script ran under local bash 3.2 with a fake curl, not on ubuntu-latest bash 5.
- The worker public URL and Apps Script paths ran only against a fake curl. The 302 handling assumes Apps Script's documented echo host, script.googleusercontent.com; no live Apps Script was called.
