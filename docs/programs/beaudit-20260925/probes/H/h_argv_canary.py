#!/usr/bin/env python3
"""Show that the discovery-trigger.sh pattern (python -c "... tok = '$ACCESS_TOKEN' ...", line 188)
puts the secret in process argv, readable via `ps` by any local user. Same holds for
curl -H "x-discovery-secret: $WEBHOOK_SECRET" (line 201). Uses a planted canary; does not run
discovery-trigger.sh. Run from the worktree root: python3 .lane-evidence/probes/h_argv_canary.py"""
import subprocess
import sys
import time

canary = "probe-canary-token-4242"
code = f"tok = '{canary}'\nimport time; time.sleep(3)"  # same shape as discovery-trigger.sh:188
child = subprocess.Popen([sys.executable, "-c", code])
time.sleep(0.5)
out = subprocess.run(["ps", "-o", "command=", "-p", str(child.pid)], capture_output=True, text=True).stdout
print("ps shows canary in argv:", canary in out)
print("ps line:", out.strip().replace("\n", " | ")[:160])
child.kill()
