#!/bin/bash
# Probe G: every /__proxy route x {no origin, foreign Origin, cross-site, trusted Origin (GET only)}.
# Sandbox dev-server on 18170 only. Mutations are sent only with untrusted origins (gate at dev-server.mjs:2348 fires before dispatch).
B=${B:-http://127.0.0.1:18170}
R="GET:/__proxy/local-health GET:/__proxy/ngrok-tunnels GET:/__proxy/discovery-webhook-secret GET:/__proxy/discovery-health GET:/__proxy/tailscale-state GET:/__proxy/install-keep-alive/status GET:/__proxy/install-worker-autostart/status GET:/__proxy/discovery-state POST:/__proxy/fix-setup POST:/__proxy/start-discovery-worker POST:/__proxy/kill-stale POST:/__proxy/full-boot POST:/__proxy/install-doctor POST:/__proxy/discovery-env-key POST:/__proxy/serpapi-check POST:/__proxy/tailscale-serve POST:/__proxy/install-keep-alive DELETE:/__proxy/install-keep-alive POST:/__proxy/install-worker-autostart DELETE:/__proxy/install-worker-autostart"
printf '%-8s %-45s %6s %6s %6s %6s %6s\n' METHOD ROUTE none foreign xsite null-origin preflight
for r in $R; do m=${r%%:*}; p=${r#*:}
  a=$(curl -s -o /dev/null -w '%{http_code}' -X $m "$B$p")
  b=$(curl -s -o /dev/null -w '%{http_code}' -X $m -H 'Origin: https://evil.example' "$B$p")
  c=$(curl -s -o /dev/null -w '%{http_code}' -X $m -H 'Sec-Fetch-Site: cross-site' -H 'Referer: https://evil.example/' "$B$p")
  d=$(curl -s -o /dev/null -w '%{http_code}' -X $m -H 'Origin: null' "$B$p")
  e=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://evil.example' -H "Access-Control-Request-Method: $m" "$B$p")
  printf '%-8s %-45s %6s %6s %6s %6s %6s\n' $m $p $a $b $c $d $e
done
echo "--- trusted Origin, read-only GETs ---"
for p in /__proxy/discovery-webhook-secret /__proxy/discovery-state /__proxy/install-keep-alive/status; do
  curl -s -D - -o /dev/null -H 'Origin: http://127.0.0.1:18170' "$B$p" | grep -i '^HTTP\|access-control-allow-origin'
done
