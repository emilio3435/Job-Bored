#!/bin/bash
# Probe: SEC-01/SEC-05 static guard on a sandbox dev-server (mirror under .lane-evidence/probes/mirror with planted CANARY files).
# Start: see .lane-evidence/probes/g-start-devserver.sh ; port 18170
B=${B:-http://127.0.0.1:18170}
for p in /.env /%2eenv /%2e%2e/%2e%2e/etc/hosts /..%2f..%2fetc/hosts /..%5c..%5cetc%5chosts /config.js /CONFIG.JS /Config.js \
  /discovery-local-bootstrap.json /DISCOVERY-LOCAL-BOOTSTRAP.JSON /linked-hosts.txt /%E0%A4%A /%ff /%00 \
  /integrations/hermes-job-hunt/profile/profile.md /integrations/hermes-job-hunt/profile/PROFILE.MD \
  /tmp/jobbored-dev.log /docs/redesign/logs/fe-dashboard.log /uploads/resume.txt /integrations/hermes-job-hunt/profile/export.zip \
  /server/.env /server/%2eenv /.git/config /package.json; do
  out=$(curl -s -o ${TMPDIR:-/tmp}/g-body.$$ -w '%{http_code}' --path-as-is "$B$p"); body=$(head -c 60 ${TMPDIR:-/tmp}/g-body.$$ | tr '\n' ' ')
  echo "$out $p :: $body"
done
rm -f ${TMPDIR:-/tmp}/g-body.$$
echo "--- DNS-rebinding shape (foreign Host header, loopback peer) ---"
curl -s -o /dev/null -w '%{http_code} Host:evil.example /tmp/jobbored-dev.log\n' -H 'Host: evil.example:18170' "$B/tmp/jobbored-dev.log"
curl -s -w ' <- body  (Host: evil.example)\n' -H 'Host: evil.example:18170' "$B/tmp/jobbored-dev.log"
