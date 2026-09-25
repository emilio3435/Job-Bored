DONE

# BUILD-REPORT-X — Egress (lane X, BEAUDIT wave 0)

Branch fix/beaudit-w0-x, cut from fix/beaudit-w0-p. HEAD 576e1d64. Nothing pushed.

## Claims done
- C1 (P0): sessionManager.run now fetches through safeFetch: DNS-pinned, every redirect hop validated, 4 MB cap. It refuses a private literal before any browser command spawns, and the fetch fallback is guarded too. Commit 21f493dd.
- C2 (P0): bin/browser-use-agent-browser.mjs resolves the target and refuses a private literal or DNS answer before it spawns agent-browser. It re-checks the URL the browser lands on after open and withholds the page if that URL is private. Commit 0f85ba8c.
- D15 (P0): checkJobPostingUrl goes through safeFetch with a 4 MB cap. A blocked Link returns status unknown with source invalid_url, so the row goes to review. The result shape is unchanged, so no contract bump. Commit 9a1c9382.
- C8: on a cross-origin redirect, safeFetch strips credential headers (authorization, cookie, x-goog-api-key, x-api-key, plus names matching api-key, token, secret, auth or session). It follows the fetch spec's method rules (303, and a POST 301/302, become a bodiless GET), refuses to replay a body across origins, and honors redirect "error" and "manual". Commit 4e4a41ed.
- C9 (+E19): pinnedFetch now streams instead of buffering. safeFetch caps the body at maxBytes (default 32 MB) while it streams and cancels the upstream, which destroys the socket, once it passes the cap. A content-length over the cap is rejected up front. Commit 4e4a41ed.
- E8 (+C11): the classifier decodes the IPv4 embedded in NAT64 64:ff9b::/96, 6to4 2002::/16, Teredo 2001:0::/32 and ::ffff:0:0/96. It also blocks local-use NAT64 64:ff9b:1::/48, 198.18/15, fec0::/10 and ff00::/8, for both literals and DNS answers. Commit 4e4a41ed.
- C16: session-ssrf.test.ts adds the missing cases: loopback on the real transport, a metadata redirect, a rebinding name, the command path, the fetch fallback and the body cap.
- Lane-D ask: request.abortSignal already reached sessionManager.run. It now reaches safeFetch, and a test pins it: 'session passes request.abortSignal through to the fetch path'.

- Repair round (commit 3be7c031), for the three review findings:
  1. Provider deadline: safeFetch now reads the final body before it resolves, under the caller's signal. A timer that providers/shared.ts clears once safeFetch settles therefore still covers a server that sends headers and then stalls. The maxBytes cap and the upstream cancel still apply while the body streams.
  2. Content-Encoding: responseFromIncomingMessage (the pinned transport's Response builder, now exported so tests can drive it) decodes gzip, x-gzip, deflate, br, and zstd where Node supports it. It drops the stale content-encoding and content-length headers, and the cap counts decoded bytes. pinnedFetch sends accept-encoding "gzip, deflate, br" when the caller sets none. session.ts and expired-job-cleanup.ts pick this up with no change of their own.
  3. Fence: the maxBytes line in server/security-boundaries.d.mts is reverted, so the file now matches the branch base. The typed option lives in src/net/safe-fetch.ts.

- Repair round 2 (commit 3c6cebae), for the P1 at server/security-boundaries.mjs:492: a 3xx that safeFetch returns instead of following (no Location, or redirect "manual") went back before readCappedBody. Since pinnedFetch resolves at headers, fetchWithTimeout cleared its timer and a stalled body hung discovery. Those responses now go through readCappedBody (capped, abortable, status and Location kept).

- Repair round 3 (commit 2a24d31a), for the review findings:
  1. BLOCKING, server/security-boundaries.mjs:839: "deflate" now sniffs the zlib header (CM=8, (CMF*256+FLG)%31==0) and uses createInflate for wrapped bodies and createInflateRaw for raw ones, as platform fetch does. Test: "decodes a deflate-raw body before the caller parses it" (tests/safe-fetch-egress.test.mjs). The wrapped "deflate" case still passes.
  2. BLOCKING, bin/browser-use-agent-browser.mjs:59: a new unbracketHost() strips the IPv6 brackets before resolvedAddressesArePrivate (isIP and DNS), in createConnectLookup, and on the pinnedFetch request hostname. Public literals like https://[2606:4700:4700::1111]/jobs pass again. ::1, fc00::/7, fe80::/10 and ::ffff:127.0.0.1 stay blocked. Tests cover the validator, safeFetch, the agent-browser command (including a real spawn with a fake agent-browser), the session and cleanup.
  3. expired-job-cleanup.ts: checked the diff against the base. Outside checkJobPostingUrl it touches only the safe-fetch import (line 11) and the MAX_POSTING_BODY_BYTES module constant (line 506), which the widened fence allows. Nothing else outside the function changed. Kept as is.

- Repair round 4 (commit fbe6c68d), for server/security-boundaries.mjs:612: the up-front `declared > limit` check rejected bodyless HEAD and 304 responses whose Content-Length describes a larger representation. It now runs only when `response.body` exists; both the pinned transport and platform fetch hand HEAD/304 back with a null body. Streamed bodies are still capped while read.

- Repair round 5 (commit 576e1d64), for bin/browser-use-agent-browser.mjs:42: the entry check compared path.resolve(argv[1]) with fileURLToPath(import.meta.url), so a launch through a symlink never ran main() and exited 0 with empty output. The check now compares realpathSync of both paths, and falls back to the plain compare if realpath throws.

## Claims deferred
None.

## Tests added (red, then green)

### Repair round 5
Test "agent-browser command still runs when invoked through a symlink" (integrations/browser-use-discovery/tests/browser/agent-browser-bin-ssrf.test.ts). It symlinks the CLI into a temp dir, runs the link with a fake agent-browser, and expects exit 0 with PROBE-PAGE-BODY in the output.
RED (before the fix): `AssertionError: The input did not match the regular expression /PROBE-PAGE-BODY/. actual: ''` (exit 0 with empty stdout, the reported failure), ℹ pass 0, ℹ fail 1.
GREEN (after): whole file ℹ pass 10, ℹ fail 0.

### Repair round 4
Test "ignores content-length over maxBytes on bodyless HEAD and 304 responses" (tests/safe-fetch-egress.test.mjs): HEAD 200 and GET 304, `new Response(null, {status, headers: {'content-length': '33554433'}})`, default 32 MB cap.
RED (before the fix): `Error: Response body exceeds 33554432 bytes  code: 'BODY_TOO_LARGE'`, ℹ pass 0, ℹ fail 1.
GREEN (after): whole file ℹ pass 48, ℹ fail 0.

### Repair round 3
RED (tests/safe-fetch-egress.test.mjs, before the fix):
```
  ✖ decodes a deflate-raw body before the caller parses it
  ✖ allows a public IPv6 literal without a DNS lookup
  ✖ safeFetch reaches a public IPv6 literal through the transport
  ✔ still blocks private IPv6 literal http://[::1]/ (and fc00::1, fd12:3456::1, fe80::1, ::ffff:127.0.0.1, ::ffff:7f00:1)
```
RED (agent-browser-bin-ssrf.test.ts): `✖ agent-browser command opens a public IPv6 literal without a DNS lookup`; the 4 private IPv6 refusals pass.
RED (session-ssrf + expired-job-cleanup-ssrf, security-boundaries.mjs stashed to base-of-round): `✖ session visits a public IPv6 literal and still refuses a private one`, `✖ checkJobPostingUrl checks a public IPv6 literal Link and refuses a private one` (pass 14, fail 2).
GREEN: safe-fetch-egress 47/47; agent-browser-bin-ssrf 9/9; session + cleanup 16/16. Raw output: .lane-evidence/repair3-{red,green}-*.txt.


### safe-fetch-egress
```
RED:
  ✖ drops credential headers when a redirect changes origin (promoted C-safefetch-redirect-headers probe) (4.131375ms)
  ✖ strips api-key, authorization and cookie headers on a cross-origin GET redirect (0.480583ms)
  ✔ keeps credential headers on a same-origin redirect (0.160584ms)
  ✖ turns a 303 (and a POST 302) into a bodiless GET (0.18575ms)
  ✖ honors redirect: "error" for fixed-host API calls (0.295125ms)
✖ C8 safeFetch redirect credential stripping (5.617209ms)
  ✖ errors the body and cancels the source once maxBytes is passed (69.306125ms)
  ✖ rejects up front when content-length is over maxBytes (0.262584ms)
  ✖ passes bodies under the cap through untouched and keeps the final URL (0.700083ms)
  ✖ tags blocked targets with code SSRF_BLOCKED (0.298875ms)
✖ C9 safeFetch streaming body cap (70.709292ms)
  ✖ blocks literal http://[64:ff9b::7f00:1]/ (0.256334ms)
  ✖ blocks literal http://[64:ff9b::a9fe:a9fe]/ (0.064209ms)
  ✖ blocks literal http://[64:ff9b::127.0.0.1]/ (0.048709ms)
  ✖ blocks literal http://[64:ff9b:1::a00:5]/ (0.045125ms)
  ✖ blocks literal http://[2002:7f00:1::]/ (0.042417ms)
  ✖ blocks literal http://[2002:a9fe:a9fe::1]/ (0.048834ms)
  ✖ blocks literal http://[2001:0:4136:e378:8000:63bf:80ff:fffe]/ (0.039458ms)
  ✖ blocks literal http://198.18.0.1/ (0.0365ms)
  ✖ blocks literal http://198.19.255.254/ (0.031875ms)
  ✖ blocks literal http://[fec0::1]/ (0.037334ms)
  ✖ blocks literal http://[ff02::1]/ (0.048083ms)
  ✖ blocks literal http://[::ffff:0:7f00:1]/ (0.038708ms)
  ✔ allows public literal http://[64:ff9b::808:808]/ (0.038125ms)
  ✔ allows public literal http://[2002:808:808::1]/ (0.018083ms)
  ✔ allows public literal http://[2606:4700:4700::1111]/ (0.0185ms)
  ✔ allows public literal http://198.20.0.1/ (0.02225ms)
  ✔ allows public literal http://8.8.8.8/ (0.016166ms)
  ✖ blocks a DNS answer of 64:ff9b::7f00:1 (0.105083ms)
  ✖ blocks a DNS answer of 2002:a9fe:a9fe::1 (0.038792ms)
  ✖ blocks a DNS answer of 198.18.5.5 (0.033ms)
  ✖ blocks a DNS answer of fec0::5 (0.038041ms)
✖ E8 SSRF classifier covers embedded-IPv4 and reserved ranges (promoted probe-e-ssrf) (1.249208ms)
ℹ pass 6
ℹ fail 24
✖ failing tests:
✖ drops credential headers when a redirect changes origin (promoted C-safefetch-redirect-headers probe) (4.131375ms)
✖ strips api-key, authorization and cookie headers on a cross-origin GET redirect (0.480583ms)
✖ turns a 303 (and a POST 302) into a bodiless GET (0.18575ms)
✖ honors redirect: "error" for fixed-host API calls (0.295125ms)
✖ errors the body and cancels the source once maxBytes is passed (69.306125ms)
✖ rejects up front when content-length is over maxBytes (0.262584ms)
✖ passes bodies under the cap through untouched and keeps the final URL (0.700083ms)
✖ tags blocked targets with code SSRF_BLOCKED (0.298875ms)
✖ blocks literal http://[64:ff9b::7f00:1]/ (0.256334ms)
✖ blocks literal http://[64:ff9b::a9fe:a9fe]/ (0.064209ms)
✖ blocks literal http://[64:ff9b::127.0.0.1]/ (0.048709ms)
✖ blocks literal http://[64:ff9b:1::a00:5]/ (0.045125ms)
✖ blocks literal http://[2002:7f00:1::]/ (0.042417ms)
✖ blocks literal http://[2002:a9fe:a9fe::1]/ (0.048834ms)
✖ blocks literal http://[2001:0:4136:e378:8000:63bf:80ff:fffe]/ (0.039458ms)
✖ blocks literal http://198.18.0.1/ (0.0365ms)
✖ blocks literal http://198.19.255.254/ (0.031875ms)
✖ blocks literal http://[fec0::1]/ (0.037334ms)
✖ blocks literal http://[ff02::1]/ (0.048083ms)
✖ blocks literal http://[::ffff:0:7f00:1]/ (0.038708ms)
✖ blocks a DNS answer of 64:ff9b::7f00:1 (0.105083ms)
✖ blocks a DNS answer of 2002:a9fe:a9fe::1 (0.038792ms)
✖ blocks a DNS answer of 198.18.5.5 (0.033ms)
✖ blocks a DNS answer of fec0::5 (0.038041ms)
GREEN:
ℹ pass 30
ℹ fail 0
```

### session-ssrf
```
RED:
✖ session refuses a loopback page on the real transport and the server sees no hit (12.017917ms)
✖ session refuses a loopback URL before calling fetch (0.63625ms)
✖ session refuses a redirect to cloud metadata and never fetches the second hop (0.147167ms)
✖ session refuses a hostname that resolves to loopback (127.0.0.1.nip.io) (51.068208ms)
✖ session refuses a private URL before spawning the browser command, with no fetch fallback (4.74275ms)
✖ session fetch fallback after a failed command is also guarded (3.904417ms)
✖ session caps an endless page body instead of buffering it (42.195708ms)
✔ session passes request.abortSignal through to the fetch path (13.089792ms)
ℹ pass 1
ℹ fail 7
✖ failing tests:
✖ session refuses a loopback page on the real transport and the server sees no hit (12.017917ms)
GREEN:
✔ session refuses a loopback page on the real transport and the server sees no hit (3.485292ms)
✔ session refuses a loopback URL before calling fetch (0.14725ms)
✔ session refuses a redirect to cloud metadata and never fetches the second hop (1.781125ms)
✔ session refuses a hostname that resolves to loopback (127.0.0.1.nip.io) (0.149334ms)
✔ session refuses a private URL before spawning the browser command, with no fetch fallback (0.095584ms)
✔ session fetch fallback after a failed command is also guarded (7.697167ms)
✔ session caps an endless page body instead of buffering it (2.0725ms)
✔ session passes request.abortSignal through to the fetch path (13.108542ms)
✔ browser session falls back to direct fetch when no command is configured (3.366292ms)
✔ browser session times out a hung command and falls back to direct fetch (1008.400375ms)
ℹ pass 10
ℹ fail 0
```

### cleanup-ssrf
```
RED:
✖ checkJobPostingUrl never fetches a loopback Link and flags it for review (11.800875ms)
✖ checkJobPostingUrl refuses a redirect to cloud metadata (0.532291ms)
✖ checkJobPostingUrl refuses a hostname that resolves to a private address (0.517459ms)
✖ checkJobPostingUrl follows a public redirect and reports the final URL (0.127084ms)
ℹ pass 0
ℹ fail 4
GREEN:
✔ checkJobPostingUrl never fetches a loopback Link and flags it for review (3.955708ms)
✔ checkJobPostingUrl refuses a redirect to cloud metadata (1.90425ms)
✔ checkJobPostingUrl refuses a hostname that resolves to a private address (0.15275ms)
✔ checkJobPostingUrl follows a public redirect and reports the final URL (1.611625ms)
ℹ pass 4
ℹ fail 0
```

### agent-browser-bin-ssrf
```
RED:
✖ agent-browser command refuses a metadata URL before spawning agent-browser (274.251042ms)
✔ agent-browser command opens a public URL (234.055667ms)
✖ agent-browser command withholds the page when the browser lands on a private URL (182.037ms)
✖ agent-browser target check resolves DNS before open (rebinding name) (2.775458ms)
✖ integrations/browser-use-discovery/tests/browser/agent-browser-bin-ssrf.test.ts (59983.546125ms)
ℹ pass 1
GREEN:
✔ agent-browser command refuses a metadata URL before spawning agent-browser (37.235041ms)
✔ agent-browser command opens a public URL (197.184083ms)
✔ agent-browser command withholds the page when the browser lands on a private URL (266.466625ms)
✔ agent-browser target check resolves DNS before open (rebinding name) (13.633208ms)
ℹ pass 4
ℹ fail 0
```

Files: tests/safe-fetch-egress.test.mjs (C8, C9, E8; promotes C-safefetch-redirect-headers.mjs and probe-e-ssrf.mjs), integrations/browser-use-discovery/tests/browser/session-ssrf.test.ts (C1, C16; promotes C-ssrf-session.mjs), integrations/browser-use-discovery/tests/sheets/expired-job-cleanup-ssrf.test.ts (D15; promotes p14-cleanup-loopback-fetch.mjs), integrations/browser-use-discovery/tests/browser/agent-browser-bin-ssrf.test.ts (C2; promotes C-ssrf-browser-command.sh).
The red agent-browser run also hung the test file for 60 s, because importing the bin ran main() on stdin. The entrypoint guard fixes that.
The abort pass-through test passed at red: it pins existing behavior and was not a defect.

### Repair round (3be7c031)
Red came first, before any decoding or buffering (the log is in repair-red-safefetch.txt and repair-red-callers.txt):
```
✖ decodes a gzip body before the caller parses it      actual: '\x1F\x8B\b...' (raw gzip)
✖ decodes a br body before the caller parses it        actual: raw brotli bytes
✖ decodes a deflate body before the caller parses it   actual: 'x\x9C...' (raw zlib)
✖ caps the decoded bytes, not the compressed ones      Missing expected rejection.
✖ keeps the caller's deadline active until the body is consumed   safeFetch must reject at the deadline; got body outcome hung
✖ session decodes a gzip page before reading its title            actual: raw gzip bytes
✖ checkJobPostingUrl decodes a gzip posting before classifying it actual: 'unknown' expected: 'open'
```
Green (repair-green-safefetch.txt and repair-green-callers.txt):
```
tests/safe-fetch-egress.test.mjs   ℹ tests 35 ℹ pass 35 ℹ fail 0
session-ssrf + expired-job-cleanup-ssrf + agent-browser-bin-ssrf   ℹ tests 18 ℹ pass 18 ℹ fail 0
```
One test changed: "errors the body and cancels the source once maxBytes is passed" now expects safeFetch itself to reject, because the body is read before it resolves.

### Repair round 2 (3c6cebae)
Red (repair2-red.txt), before the fix:
```
✖ keeps the deadline active for a 302 without Location whose body stalls (1503.11375ms)   safeFetch must reject at the deadline; got body outcome hung
✖ keeps the deadline active for a manual-mode redirect whose body stalls (1503.599167ms)  safeFetch must reject at the deadline; got body outcome hung
✔ still returns a completed manual-mode redirect with its status and Location
ℹ tests 8 ℹ pass 6 ℹ fail 2
```
Green (repair2-green.txt): tests/safe-fetch-egress.test.mjs  ℹ tests 38 ℹ pass 38 ℹ fail 0. No existing test changed.

## Floor output (repair round 5, run on the tree committed as 576e1d64, HOME=$(mktemp -d), PLAYWRIGHT_BROWSERS_PATH set; every command exit 0)
```
lint exit 0        (npm run lint:repo: eslint clean, OK integrations/openclaw-command-center/SKILL.md)
typecheck exit 0   (npm run typecheck:repo, tsc clean for browser-use-discovery and server)
test exit 0        (npm test: ℹ tests 3160, pass 3148, fail 0, cancelled 0, skipped 0, todo 12)
bud exit 0         (npm run test:browser-use-discovery: ℹ tests 767, pass 767, fail 0, skipped 0)
contract exit 0    (npm run test:contract:all: all OK lines)
```
The 12 todo items are the pre-existing "target behavior" markers owned by other lanes (for example E7 in lane L). They are not failures.

## Unverified
- Repair 3: the pinned transport connecting to a public IPv6 literal (the unbracketed request hostname) has no test, because a hermetic test cannot open a public socket and the transport refuses loopback. The validation and lookup paths are tested. / residuals
- The full pinned transport (pinnedFetch plus DNS pin) is not run end to end against a live host, because tests may not reach the network and the transport refuses loopback. The loopback tests do run its Response builder (decoding) and safeFetch's buffered, capped, signal-bound read. They do not exercise the default accept-encoding header.
- During the red run only, the nip.io session case resolved 127.0.0.1.nip.io over real DNS, because the deps seam did not exist yet. The green tests are hermetic.
- The agent-browser landing check is best effort. A real browser can still follow a mid-page redirect or re-resolve DNS between the pre-check and its own connect. Only the reported landing URL is re-checked.
- Outside the fence, not edited: server/shared/gemini-url-context-scrape.mjs should pass redirect "error" for its fixed-host API call (the C8 second half, now supported by safeFetch). server/shared/job-scraper-core.mjs could pass maxBytes: MAX_HTML_BYTES instead of checking after buffering. career-surface-resolver's classifyCareerSurfaceSourcePolicy still labels 127.0.0.1.nip.io as extractable, but every fetch is now refused at connect.
- server/security-boundaries.d.mts is back to the branch base (repair round). It does not declare responseFromIncomingMessage; only JS/strip-types tests import that export. expired-job-cleanup.ts gained a module constant and a safe-fetch import that serve checkJobPostingUrl.
