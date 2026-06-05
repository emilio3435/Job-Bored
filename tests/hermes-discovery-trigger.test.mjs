import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(
  repoRoot,
  "integrations",
  "hermes-job-hunt",
  "scripts",
  "discovery-trigger.sh",
);
const script = readFileSync(scriptPath, "utf8");

test("Hermes discovery trigger remains valid bash", () => {
  execFileSync("bash", ["-n", scriptPath], { stdio: "pipe" });
});

test("Hermes discovery trigger reloads webhook secret after worker restart", () => {
  assert.match(
    script,
    /restart_worker_after_secret_mismatch[\s\S]*read_webhook_secret_from_env[\s\S]*post_webhook/,
    "401 recovery must re-read .env before retrying the webhook",
  );
  assert.match(
    script,
    /grep -E '\^BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=' "\$WORKER_ENV" \| tail -1/,
    "webhook secret must match the worker env parser (last duplicate wins)",
  );
});

test("Hermes discovery trigger self-heals stale webhook secrets once", () => {
  assert.match(
    script,
    /if \[ "\$HTTP_STATUS" = "401" \]; then[\s\S]*restart_worker_after_secret_mismatch[\s\S]*post_webhook/,
    "401 webhook auth failures should restart the local worker and retry once",
  );
  assert.match(
    script,
    /\*browser-use-discovery\*\|\*src\/server\.ts\*/,
    "the restart path should only target the known discovery worker process",
  );
  assert.match(
    script,
    /Refusing to restart unknown process on port \$WORKER_PORT/,
    "unknown listeners on the worker port must not be killed",
  );
});

test("Hermes discovery trigger stays under Dobby's script watchdog", () => {
  const pollStart = script.indexOf('if [ -n "$RUN_ID" ]; then');
  assert.notEqual(pollStart, -1, "async run polling block must exist");
  const pipelineStart = script.indexOf("# ─── Read Pipeline", pollStart);
  assert.notEqual(pipelineStart, -1, "Pipeline summary must come after run polling");
  const pollBlock = script.slice(pollStart, pipelineStart);

  assert.match(pollBlock, /\[ "\$STATUS" = "completed" \]/);
  assert.match(pollBlock, /\[ "\$STATUS" = "partial" \]/);
  assert.match(pollBlock, /\[ "\$STATUS" = "empty" \]/);
  assert.match(pollBlock, /\[ "\$STATUS" = "failed" \]/);
  assert.match(
    script,
    /BROWSER_USE_DISCOVERY_POLL_TIMEOUT_SECONDS:-540/,
    "the default polling window must leave headroom below Dobby's 600s script timeout",
  );
  assert.match(
    pollBlock,
    /JobBored Discovery accepted and still running after \$\{POLL_TIMEOUT_SECONDS\}s/,
    "a long-running async worker run should report still-running status before Dobby kills the script",
  );
  assert.match(
    pollBlock,
    /ERROR: Discovery run failed/,
    "a terminal failed worker run should make the cron fail before reading Pipeline rows",
  );
  assert.match(
    pollBlock,
    /ERROR: Discovery run reached unrecognized terminal status/,
    "future unknown terminal statuses should not be treated as success",
  );
});

test("Hermes discovery trigger supports Dobby's GitHub checkout path", () => {
  assert.match(
    script,
    /\$HOME\/GitHub\/emilio3435\/Job-Bored/,
    "Dobby's checkout is not always at ~/Job-Bored",
  );
  assert.match(
    script,
    /Worker directory not found: \$WORKER_DIR/,
    "bad repo path configuration should produce a direct setup error",
  );
});
