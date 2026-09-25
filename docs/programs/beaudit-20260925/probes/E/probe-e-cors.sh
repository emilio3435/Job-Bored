#!/usr/bin/env bash
# CORS / origin / DNS-rebinding probe (loopback mode). Run from worktree root:
#   bash .lane-evidence/probes/probe-e-cors.sh
source "$(dirname "$0")/lib-server.sh"
P=18150; B="http://127.0.0.1:$P"
mkdir -p "$SBX/.jobbored"
printf '{"provider":"gemini","model":"probe-model","apiKey":"probe-key-canary","baseUrl":"","updatedAt":""}\n' > "$SBX/.jobbored/llm.json"
start_api $P || exit 1
c() { local label="$1"; shift; printf '\n## %s\n' "$label"; curl -s -D - -o /tmp/.e_body_$$ "$@" | grep -i -E '^(HTTP|access-control-allow-origin)' | tr -d '\r'; cat /tmp/.e_body_$$; rm -f /tmp/.e_body_$$; echo; }
c "OPTIONS preflight, foreign origin" -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' $B/api/llm-config
c "OPTIONS preflight, allowed dashboard origin" -X OPTIONS -H 'Origin: http://localhost:8080' -H 'Access-Control-Request-Method: POST' $B/api/llm-config
c "POST cross-origin, foreign origin" -X POST -H 'Origin: https://evil.example' -H 'content-type: application/json' -d '{"provider":"openai_compatible","model":"x","baseUrl":"https://evil.example/v1"}' $B/api/llm-config
c "X-Forwarded-Host spoof (should be ignored)" -X OPTIONS -H 'Origin: https://evil.example' -H 'X-Forwarded-Host: evil.example' -H 'X-Forwarded-Proto: https' $B/api/llm-config
c "Origin: null (sandboxed iframe / file://)" -X POST -H 'Origin: null' -H 'content-type: application/json' -d '{}' $B/api/llm-config
echo; echo "### DNS-rebinding shape: Host and Origin both = attacker name that resolves to 127.0.0.1"
c "GET /api/llm-config with Host=rebind.attacker.test:$P, Origin=http://rebind.attacker.test:$P" -H "Host: rebind.attacker.test:$P" -H "Origin: http://rebind.attacker.test:$P" $B/api/llm-config
c "POST /api/llm-config hijack pin via rebinding" -X POST -H "Host: rebind.attacker.test:$P" -H "Origin: http://rebind.attacker.test:$P" -H 'content-type: application/json' -d '{"provider":"openai_compatible","model":"exfil","apiKey":"","baseUrl":"https://attacker.test/v1"}' $B/api/llm-config
echo "## pin on disk after hijack (key field presence only):"
node -e 'const j=require(process.argv[1]); console.log({provider:j.provider, model:j.model, baseUrl:j.baseUrl, keyPresent: !!j.apiKey})' "$SBX/.jobbored/llm.json"
c "GET /health reports ATS now configured against attacker baseUrl" $B/health
echo "## 2.2 MB JSON body to /api/llm-config"
node -e 'process.stdout.write(JSON.stringify({provider:"a".repeat(2200000),model:"m"}))' > "$SBX/big.json"
curl -s -w '\n[HTTP %{http_code}]\n' -X POST -H 'content-type: application/json' --data-binary @"$SBX/big.json" $B/api/llm-config
stop_api $P
rm -f "$SBX/.jobbored/llm.json" "$SBX/big.json"
