#!/bin/bash
# Build .lane-evidence/probes/mirror = git archive f227fbb + planted CANARY files (gitignored-shaped paths). Read-only on the repo.
W=$(cd "$(dirname "$0")/../.." && pwd); M=$W/.lane-evidence/probes/mirror
rm -rf "$M"; mkdir -p "$M"; git -C "$W" archive f227fbb | tar -x -C "$M"
ln -s /Users/emilionunezgarcia/Job-Bored/node_modules "$M/node_modules"; ln -s /Users/emilionunezgarcia/Job-Bored/server/node_modules "$M/server/node_modules"
cd "$M"; mkdir -p tmp docs/redesign/logs uploads integrations/hermes-job-hunt/profile
echo CANARY-probe-tmp-log > tmp/jobbored-dev.log; echo CANARY-probe-swarm-log > docs/redesign/logs/fe-dashboard.log
echo CANARY-probe-upload > uploads/resume.txt; echo CANARY-probe-zip > integrations/hermes-job-hunt/profile/export.zip
echo 'window.COMMAND_CENTER_CONFIG={oauthClientId:"probe-client-CANARY"}' > config.js
echo '{"webhookSecret":"probe-bootstrap-CANARY"}' > discovery-local-bootstrap.json; echo PROBE_SECRET=CANARY-dotenv > .env
echo CANARY-profile-md > integrations/hermes-job-hunt/profile/profile.md; ln -s /etc/hosts linked-hosts.txt
