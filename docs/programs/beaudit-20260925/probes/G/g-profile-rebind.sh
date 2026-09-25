#!/bin/bash
# Probe G: DNS-rebinding shape against the dev-server /profile proxy.
# A rebound page at http://evil.example:<port> issuing same-origin fetch() sends
# Host: evil.example:<port> + Sec-Fetch-Site: same-origin and no Origin on GET.
# Needs sandbox dev-server on 18170 (JOBBORED_API_PORT=18171) and sandbox API on 18171 (see g-start-servers.sh).
B=${B:-http://127.0.0.1:18170}
H='Host: evil.example:18170'
echo "== GET /profile (rebound, same-origin fetch shape)"
curl -s -w '  [%{http_code}]\n' -H "$H" -H 'Sec-Fetch-Site: same-origin' "$B/profile"
echo "== POST /profile (rebound; browsers send Origin on POST -> Origin: http://evil.example:18170)"
curl -s -w '  [%{http_code}]\n' -H "$H" -H 'Origin: http://evil.example:18170' -H 'Sec-Fetch-Site: same-origin' -H 'content-type: application/json' \
  -d '{"schemaVersion":1,"identity":{"name":"PROBE-REBIND-WRITE"},"targetRoles":["probe"]}' "$B/profile"
echo "== GET /profile again (did the foreign write land?)"
curl -s -H "$H" -H 'Sec-Fetch-Site: same-origin' "$B/profile" | head -c 300; echo
echo "== control: same headers against /__proxy/discovery-webhook-secret"
curl -s -w '  [%{http_code}]\n' -H "$H" -H 'Sec-Fetch-Site: same-origin' "$B/__proxy/discovery-webhook-secret"
echo "== control: /profile with Sec-Fetch-Site: cross-site + foreign Origin"
curl -s -w '  [%{http_code}]\n' -H 'Origin: https://evil.example' -H 'Sec-Fetch-Site: cross-site' "$B/profile"
echo "== full write chain: fetch a starter template, rename it, POST it back, all with the rebound Host"
T=$(curl -s -X POST -H "$H" -H 'Origin: http://evil.example:18170' -H 'Sec-Fetch-Site: same-origin' "$B/profile/template/engineer" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).template;t.identity.primaryNarrative="PROBE-REBIND-WRITE: this narrative was written by a foreign-Host request through the dev-server proxy.";process.stdout.write(JSON.stringify(t))})')
curl -s -w '  [%{http_code}]\n' -H "$H" -H 'Origin: http://evil.example:18170' -H 'Sec-Fetch-Site: same-origin' -H 'content-type: application/json' -d "$T" "$B/profile" | head -c 200; echo
echo "== readback through the rebound Host"
curl -s -H "$H" -H 'Sec-Fetch-Site: same-origin' "$B/profile" | grep -o 'PROBE-REBIND-WRITE' | head -1
