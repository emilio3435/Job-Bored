#!/usr/bin/env bash
# Hosted-mode auth probe. Binds the IPv4-mapped loopback literal, which the server treats as
# non-loopback (hosted) while staying reachable only from this machine.
#   bash .lane-evidence/probes/probe-e-hosted.sh
source "$(dirname "$0")/lib-server.sh"
P=18151; B="http://127.0.0.1:$P"
c() { local label="$1"; shift; printf '\n## %s\n' "$label"; curl -s -w '\n[HTTP %{http_code}]' "$@"; echo; }
echo "### A: hosted, no JOBBORED_API_TOKEN set (render.yaml default)"
LISTEN_HOST="::ffff:127.0.0.1" start_api $P || exit 1
c "GET /health" $B/health
c "GET /api/llm-config" $B/api/llm-config
c "OPTIONS from https://user.github.io (no COMMAND_CENTER_ALLOWED_ORIGINS)" -X OPTIONS -H 'Origin: https://user.github.io' -H 'Access-Control-Request-Method: POST' $B/api/scrape-job
stop_api $P
echo; echo "### B: hosted, JOBBORED_API_TOKEN=probe-token"
LISTEN_HOST="::ffff:127.0.0.1" start_api $P JOBBORED_API_TOKEN=probe-token COMMAND_CENTER_ALLOWED_ORIGINS=https://user.github.io || exit 1
c "packaged browser call shape (settings-modal.js:301 postLlmConfigPin: content-type only, no token)" -X POST -H 'Origin: https://user.github.io' -H 'content-type: application/json' -d '{"provider":"gemini","model":"m"}' $B/api/llm-config
c "same call with Authorization: Bearer probe-token" -X POST -H 'Origin: https://user.github.io' -H 'Authorization: Bearer probe-token' -H 'content-type: application/json' -d '{"provider":"gemini","model":"m"}' $B/api/llm-config
c "wrong token" -H 'x-api-token: nope' $B/api/llm-config
stop_api $P
rm -f "$SBX/.jobbored/llm.json"
echo; echo "### C: browser callers that attach the hosted token (definitions excluded)"
cd "$ROOT"
echo "helper call sites: $(rg -n 'applyHostedApiAuth(Headers)?\(|getJobBoredApiToken\(|getHostedApiToken\(' -g '*.js' . -g '!node_modules' -g '!tests/**' -g '!.lane-evidence' | grep -v -E '^\./hosted-api-auth\.js|function getJobBoredApiToken' | wc -l | tr -d ' ')"
echo "fetch sites to the API that send no token:"
rg -n 'fetch\((jobBoredApiUrl|base|ctx\.base|profileUrl|profileApiPath)' -g '*.js' . -g '!node_modules' -g '!tests/**' -g '!.lane-evidence' -g '!integrations/**' | wc -l
