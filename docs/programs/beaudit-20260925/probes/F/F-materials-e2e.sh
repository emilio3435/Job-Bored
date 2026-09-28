#!/usr/bin/env bash
# Lane F reproducer: server materials loop against a stub LLM, sandbox HOME.
# Run from the worktree root:  bash .lane-evidence/probes/F-materials-e2e.sh
# Starts stub-llm on 18161 and the API on 18160 (HOME=.lane-evidence/home-e2e),
# drives five scenarios, prints evidence, then kills both servers.
# No network beyond 127.0.0.1: fetch egress is blocked by no-egress.mjs and
# Playwright is pointed at a missing browser dir so PDF render skips.
set -u
ROOT="$(pwd)"
P="$ROOT/.lane-evidence/probes"
OUT="$P/out"
H="$ROOT/.lane-evidence/home-e2e-$(date +%s)"   # fresh sandbox HOME per run
API=http://127.0.0.1:18160
mkdir -p "$H/.jobbored" "$OUT" "$H/tpl"; : > "$OUT/stub-log.jsonl"
# Pin the logo-manifest writer to a sandbox dir. Without this, POST /profile
# rewrites the TRACKED integrations/hermes-job-hunt/resume-template/logos.json
# (finding F7 — this probe's first run did exactly that).
export HERMES_RESUME_TEMPLATE_DIR="$H/tpl"
cat > "$H/.jobbored/llm.json" <<'JSON'
{ "provider": "local", "model": "stub-model", "apiKey": "", "baseUrl": "http://127.0.0.1:18161/v1", "updatedAt": "" }
JSON
echo good > "$P/stub-mode.txt"
STUB_PORT=18161 node "$P/stub-llm.mjs" > "$OUT/stub.log" 2>&1 & STUB=$!
HOME="$H" PORT=18160 LISTEN_HOST=127.0.0.1 PLAYWRIGHT_BROWSERS_PATH="$ROOT/.lane-evidence/no-browsers" \
  node --import "$P/no-egress.mjs" server/index.mjs > "$OUT/api-e2e.log" 2>&1 & SRV=$!
trap 'kill $STUB $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -sf "$API/health" >/dev/null && break; sleep 0.25; done
curl -s "$API/health"; echo

# A non-Emilio user: save a Fit Profile for "Pat Probe" and stage a resume.
TPL=$(curl -s -X POST "$API/profile/template/$(curl -s -X POST "$API/profile/template/x" | node -pe 'JSON.parse(require("fs").readFileSync(0)).available[0]')")
echo "$TPL" | node -e '
const t=JSON.parse(require("fs").readFileSync(0)).template; t.identity.primaryNarrative="Pat Probe is a data engineer at Probe Corp who builds warehouse pipelines and streaming ingestion.";
process.stdout.write(JSON.stringify(t));' > "$OUT/pat-profile.json"
echo "POST /profile (Pat Probe):"; curl -s -X POST -H 'content-type: application/json' --data @"$OUT/pat-profile.json" "$API/profile"; echo
mkdir -p "$H/.jobbored"; printf 'Pat Probe\nData engineer at Probe Corp 2019-2026.\n' > "$H/.jobbored/resume.txt"

JD='We are hiring a Data Platform Engineer to build warehouse pipelines, streaming ingestion, observability, reliability tooling and analytics infrastructure. You will partner with analysts, product managers and platform teams to modernize our warehouse, design streaming ingestion jobs, improve observability dashboards, and ship reliability improvements. Requirements: five years of experience with warehouse modeling, streaming ingestion, Python, SQL, orchestration, observability and cloud platforms. Nice to have: experience mentoring engineers, writing design documents, and running incident reviews across distributed analytics platforms and data pipelines in production environments.'
putjd() { curl -s -X PUT -H 'content-type: application/json' --data "$(node -e 'console.log(JSON.stringify({text:process.argv[1],source:"user-paste"}))' "$JD")" "$API/api/applications/$1/job-description"; echo; }
req() { curl -s -X POST -H 'content-type: application/json' --data "{\"company\":\"Acme Analytics\",\"title\":\"Data Platform Engineer\",\"feature\":\"$2\"$3}" "$API/api/applications/$1/request"; echo; }
wait_done() { for i in $(seq 1 80); do [ -f "$H/.jobbored/applications/$1/pending.json" ] || return 0; grep -q '"phase": "failed"' "$H/.jobbored/applications/$1/pending.json" && return 0; sleep 0.25; done; }

echo "=== S1 good stub: whose resume does a non-Emilio user get? (F1) ==="
putjd s1-good; T0=$(date +%s); req s1-good resume ""; wait_done s1-good; echo "wall_s=$(( $(date +%s) - T0 ))"
ls "$H/.jobbored/applications/s1-good"
grep -o -E '<h1 class="name">[^<]*</h1>|[a-z0-9._%+-]+@gmail[.]com|Audacy' "$H/.jobbored/applications/s1-good/resume.html" | sort | uniq -c
grep -c "Pat Probe" "$H/.jobbored/applications/s1-good/resume.html" | sed 's/^/Pat Probe occurrences in resume.html: /'
echo "-- qa-report.md"; cat "$H/.jobbored/applications/s1-good/qa-report.md"
echo "-- stub calls for S1:"; cat "$OUT/stub-log.jsonl"
S1CALLS=$(wc -l < "$OUT/stub-log.jsonl")

echo "=== S2 empty model output (F3) ==="
echo empty > "$P/stub-mode.txt"; putjd s2-empty >/dev/null; req s2-empty both ""; wait_done s2-empty
cat "$H/.jobbored/applications/s2-empty/pending.json" | node -pe 'const p=JSON.parse(require("fs").readFileSync(0));JSON.stringify(p.progress)'
echo "manifest pending:"; curl -s "$API/api/applications/s2-empty/manifest" | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0)).pending?.progress)'
echo "stub calls for S2: $(( $(wc -l < "$OUT/stub-log.jsonl") - S1CALLS ))"; S2=$(wc -l < "$OUT/stub-log.jsonl")

echo "=== S3 truncated JSON (maxOutput 4096 hit) ==="
echo truncated > "$P/stub-mode.txt"; putjd s3-trunc >/dev/null; req s3-trunc both ""; wait_done s3-trunc
node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1])).progress.message' "$H/.jobbored/applications/s3-trunc/pending.json"
echo "stub calls for S3: $(( $(wc -l < "$OUT/stub-log.jsonl") - S2 ))"; S3=$(wc -l < "$OUT/stub-log.jsonl")

echo "=== S4 provider HTTP 500 ==="
echo http500 > "$P/stub-mode.txt"; putjd s4-500 >/dev/null; req s4-500 both ""; wait_done s4-500
node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1])).progress.message' "$H/.jobbored/applications/s4-500/pending.json"
echo "stub calls for S4: $(( $(wc -l < "$OUT/stub-log.jsonl") - S3 ))"; S4=$(wc -l < "$OUT/stub-log.jsonl")

echo "=== S5 jobDescription in request body is dropped by normalizeRequestBody (F9) ==="
echo good > "$P/stub-mode.txt"
req s5-bodyjd both ",\"jobDescription\":$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$JD")"; wait_done s5-bodyjd
node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1])).progress.message' "$H/.jobbored/applications/s5-bodyjd/pending.json"
ls "$H/.jobbored/applications/s5-bodyjd"
echo "stub calls for S5: $(( $(wc -l < "$OUT/stub-log.jsonl") - S4 ))"

echo "=== S6 repair notes arrive as 'Voice samples' (F8) ==="
S6=$(wc -l < "$OUT/stub-log.jsonl")
curl -s -X POST -H 'content-type: application/json' --data '{"feature":"resume"}' "$API/api/applications/s1-good/repair" | head -c 600; echo
wait_done s1-good
tail -n +$((S6+1)) "$OUT/stub-log.jsonl" | node -e 'for (const l of require("fs").readFileSync(0,"utf8").trim().split("\n")) { const e=JSON.parse(l); console.log(JSON.stringify({n:e.n,isEditor:e.isEditor,userHasVoiceSamples:e.userHasVoiceSamples,voiceSamplesHead:e.voiceSamplesHead})); }'
echo "=== egress attempts blocked ==="; grep -c "no-egress" "$OUT/api-e2e.log" || true
