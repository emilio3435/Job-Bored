#!/usr/bin/env bash
# The onboarding AI beat (oneflow-beat-ai.js:149, :524-535) pins provider "local" with a baseUrl and no key.
# ATS normalizes any unknown provider to gemini (server/ats-scorecard.mjs:826-840).
#   bash .lane-evidence/probes/probe-e-local-pin.sh
source "$(dirname "$0")/lib-server.sh"
P=18153; B="http://127.0.0.1:$P"
export JOBBORED_LLM_CONFIG_PATH="$SBX/.jobbored/llm-localpin.json"
rm -f "$JOBBORED_LLM_CONFIG_PATH"
start_api $P || exit 1
echo "## POST pin exactly as oneflow-beat-ai.js builds it for Local"
curl -s -X POST -H 'content-type: application/json' -d '{"provider":"local","model":"gemma4:e2b","apiKey":"","baseUrl":"http://127.0.0.1:11434/v1"}' $B/api/llm-config; echo
echo "## GET /health (ATS view of the same pin)"
curl -s $B/health; echo
echo "## POST /api/ats-scorecard minimal valid payload"
curl -s -w '\n[HTTP %{http_code}]\n' -X POST -H 'content-type: application/json' -d '{"event":"command-center.ats-scorecard","schemaVersion":1,"feature":"cover_letter","docText":"Dear hiring manager, I build things.","job":{"title":"Engineer","company":"Acme"}}' $B/api/ats-scorecard
stop_api $P
echo "## other consumers of the same pin accept 'local':"
cd "$ROOT"; rg -n '"local"' server/profile-from-resume.mjs server/profile-rescore-worker.mjs server/materials-drafter.mjs | head -5
rm -f "$JOBBORED_LLM_CONFIG_PATH"
