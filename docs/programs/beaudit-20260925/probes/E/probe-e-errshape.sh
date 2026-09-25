#!/usr/bin/env bash
# Error-shape probe for lane E routes. Run from worktree root: bash .lane-evidence/probes/probe-e-errshape.sh
source "$(dirname "$0")/lib-server.sh"
P=18150; B="http://127.0.0.1:$P"
rm -f "$SBX/.jobbored/llm.json"
start_api $P || exit 1
c() { local label="$1"; shift; printf '\n## %s\n' "$label"; curl -s -w '\n[HTTP %{http_code} %{content_type}]' "$@"; echo; }
c "GET /health" $B/health
c "POST /api/scrape-job missing url" -X POST -H 'content-type: application/json' -d '{}' $B/api/scrape-job
c "POST /api/scrape-job private target" -X POST -H 'content-type: application/json' -d '{"url":"http://127.0.0.1:8080/.env"}' $B/api/scrape-job
c "POST /api/scrape-job non-http scheme" -X POST -H 'content-type: application/json' -d '{"url":"file:///etc/passwd"}' $B/api/scrape-job
c "POST /api/scrape-job malformed JSON" -X POST -H 'content-type: application/json' -d '{"url":' $B/api/scrape-job
c "POST /api/ats-scorecard no pin" -X POST -H 'content-type: application/json' -d '{}' $B/api/ats-scorecard
c "GET /api/llm-config no pin" $B/api/llm-config
c "POST /api/llm-config missing fields" -X POST -H 'content-type: application/json' -d '{}' $B/api/llm-config
c "POST /api/llm-config body is JSON array" -X POST -H 'content-type: application/json' -d '[1]' $B/api/llm-config
c "POST /api/llm-config body is JSON null" -X POST -H 'content-type: application/json' -d 'null' $B/api/llm-config
c "GET /api/brand-logos empty template" $B/api/brand-logos
c "POST /api/brand-logos/x not multipart" -X POST -H 'content-type: application/json' -d '{}' $B/api/brand-logos/acme
c "POST /api/brand-logos/acme svg upload (advertised as allowed)" -X POST -F 'file=@-;filename=logo.svg;type=image/svg+xml' $B/api/brand-logos/acme <<< '<svg xmlns="http://www.w3.org/2000/svg"/>'
head -c 2200000 /dev/zero | tr '\0' 'a' > "$SBX/big.txt"
c "POST /api/llm-config 2.2MB body (413 message names ATS)" -X POST -H 'content-type: application/json' --data-binary "{\"provider\":\"$(cat "$SBX/big.txt")\"}" $B/api/llm-config
c "GET /nope unknown route" $B/nope
stop_api $P
