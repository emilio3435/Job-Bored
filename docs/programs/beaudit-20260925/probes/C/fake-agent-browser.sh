#!/bin/sh
# Stand-in for agent-browser: records argv, returns minimal JSON. No network.
echo "$@" >> "$(dirname "$0")/../C-fake-agent-browser.argv"
case "$*" in *" open "*) echo '{"success":true,"data":{"url":"x","title":"t"}}';; *) echo '{"success":true,"data":{"html":"<p>internal</p>","text":"internal page text"}}';; esac
