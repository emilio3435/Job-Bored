#!/bin/zsh
# usage: run-codex-lane.sh <lane> <profile> <model> <effort> <cwd> <prompt-file> [sandbox]
lane=$1 prof=$2 model=$3 effort=$4 cwd=$5 prompt=$6 sbx=${7:-read-only}
ev=$cwd/.lane-evidence; mkdir -p $ev
codex exec -p $prof -m $model -c "model_reasoning_effort=\"$effort\"" -s $sbx -c 'approval_policy="never"' \
  -C $cwd --skip-git-repo-check --json -o $ev/REPORT-$lane.md - < $prompt >> $ev/$lane.jsonl 2>> $ev/$lane.err
echo $? >> $ev/$lane.exit
