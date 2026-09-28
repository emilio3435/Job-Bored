#!/usr/bin/env bash
# Lane H static evidence. Read-only; no network; run from the worktree root.
set -u
H=integrations/hermes-job-hunt
S=$H/scripts
echo "## H-PII: personal identity hardcoded in a PUBLIC repo and used as the filler's answers"
grep -n -E '"(email|phone|zip)":' $S/filler_profile.py $S/greenhouse_filler.py | sed -E 's/: "[^"]+"/: "<redacted-real-value>"/'
grep -n "filler_profile.CANDIDATE\[" $S/universal_filler.py | head -3
echo "## H-IDS: real Pipeline sheet ID and Telegram chat ID committed"
grep -n "SHEET_ID = \|SHEET_ID=" $S/followup_monitor.py $S/followup-monitor.py $S/gate2-status-watcher.py $S/triage_pipeline.py
grep -n '"chatId"' $H/approval-contract.v1.json
echo "## H-GATES: submit paths and their gates"
grep -n "gate1_check\|lock_acquire(\|wait_for_gate2_confirmation(company" $S/apply-orchestrator.py
grep -n 'JHOS_GATE2_CONFIRMED\|gate2_confirmed' $S/universal_filler.py | head -6
grep -n 'dry-run\|dry_run=args\|submit_btn.click\|results\["submitted"\] = True' $S/greenhouse_filler.py
grep -n -i 'gate\|approv' $S/greenhouse_filler.py | head -3; echo "(greenhouse_filler: no gate/approval references above = none)"
echo "## H-ARGV: secrets placed in process argv"
grep -n "tok = '\$ACCESS_TOKEN'\|x-discovery-secret: \$WEBHOOK_SECRET" $S/discovery-trigger.sh
echo "## H-DEPS: requirements.txt vs imports"
cat $H/requirements.txt; grep -n "^import httpx\|^from playwright" $S/universal_filler.py
echo "## H-RUNTIME: runtime copy on this machine (cron targets ~/.hermes/job-hunt/scripts)"
test -d "$HOME/.hermes/job-hunt/scripts" && echo "runtime scripts present" || echo "runtime scripts ABSENT at $HOME/.hermes/job-hunt/scripts"
test -f "$HOME/.hermes/google_token.json" && echo "google_token.json present" || echo "google_token.json absent"
grep -n "cp(HERMES_SOURCE_DIR" -A4 scripts/setup.mjs
echo "## H-DUP: follow-up monitor twin files"
cmp $S/followup_monitor.py $S/followup-monitor.py && echo "followup_monitor.py == followup-monitor.py (byte-identical)"
echo "## H-TRIAGE: frozen date + import-time bulk write"
grep -n "TODAY = datetime(2026\|batchUpdate" $S/triage_pipeline.py
echo "## H-TELEGRAM: getUpdates consumer + shared bot token"
grep -rn "getUpdates" $S --include=*.py
grep -n "hermes\" / \".env\"\|TELEGRAM_BOT_TOKEN" $S/gate2_telegram.py | head -4
echo "## H-TOKENWRITE: shared token file rewritten non-atomically by N scripts"
grep -n "google_token.json\|TOKEN_PATH.write_text\|open(TOKEN_PATH, \"w\")\|open(TOKEN_PATH, 'w')\|google_token.json', 'w'" $S/*.py $S/*.sh | grep -v "^.*#" | grep -E "write|'w'|\"w\""
echo "## H-EVIDENCE: orchestrator never passes a screenshot to write_evidence"
grep -n "write_evidence(" $S/apply-orchestrator.py
echo "## H-TZ: fixed UTC-5 offsets"
grep -c "timedelta(hours=-5)" $S/*.py | grep -v ":0"
