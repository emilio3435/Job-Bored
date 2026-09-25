#!/bin/sh
# Probe: bundled browser command forwards a metadata/loopback URL to agent-browser `open` with no SSRF check.
# Run from worktree root: sh .lane-evidence/probes/C-ssrf-browser-command.sh
rm -f .lane-evidence/C-fake-agent-browser.argv
echo '{"url":"http://169.254.169.254/latest/meta-data/","instruction":"x","timeoutMs":3000}' | \
  AGENT_BROWSER_PATH="$PWD/.lane-evidence/probes/fake-agent-browser.sh" BROWSER_USE_DISCOVERY_AGENT_BROWSER_SOCKET_DIR="$PWD/.lane-evidence/sock" \
  node integrations/browser-use-discovery/bin/browser-use-agent-browser.mjs; echo "exit=$?"
echo "--- argv seen by agent-browser:"; cat .lane-evidence/C-fake-agent-browser.argv
