// BEAUDIT H13 / H15 / H16 — discovery-trigger.sh must not put the Google
// access token or the webhook secret in any process argv (readable by every
// local user through `ps`), must refresh the shared token through the atomic
// helper, and must read the Pipeline without a row cap.
//
// The script runs end to end against shims: a `curl` on PATH and a
// HERMES_PYTHON wrapper record every argv. No network is used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "integrations", "hermes-job-hunt", "scripts", "discovery-trigger.sh");
const TOKEN_CANARY = "ya29.canary-access-token-4242";
const SECRET_CANARY = "canary-webhook-secret-4242";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "hermes-trigger-argv-"));
  const bin = join(root, "bin");
  const hermesHome = join(root, ".hermes");
  const workerDir = join(root, "worker");
  mkdirSync(bin, { recursive: true });
  mkdirSync(hermesHome, { recursive: true });
  mkdirSync(join(workerDir, "state"), { recursive: true });
  writeFileSync(join(hermesHome, "google_token.json"), JSON.stringify({ token: "stale" }));
  writeFileSync(
    join(workerDir, "state", "worker-config.json"),
    JSON.stringify({ sheetId: "sheet-example-id", targetRoles: ["Analyst"] }),
  );
  writeFileSync(join(workerDir, ".env"), `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=${SECRET_CANARY}\n`);

  const argvLog = join(root, "argv.log");
  const captured = join(root, "captured");
  mkdirSync(captured);

  // HERMES_PYTHON wrapper: log argv; fake the Google token step and the
  // Pipeline summary step; run everything else with the real python3.
  const pyWrapper = join(bin, "fake-python");
  writeFileSync(
    pyWrapper,
    `#!/usr/bin/env bash
printf 'python %s\\n' "$*" >> "${argvLog}"
case "$*" in
  *"No Pipeline data found"*) exit 0 ;;
  *load_google_credentials*|*google.oauth2*) printf '%s\\n' "${TOKEN_CANARY}"; exit 0 ;;
esac
exec python3 "$@"
`,
  );
  chmodSync(pyWrapper, 0o755);

  // curl shim: log argv, capture @file bodies/headers, answer 200 {"ok":true}.
  const curlShim = join(bin, "curl");
  writeFileSync(
    curlShim,
    `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >> "${argvLog}"
case "$*" in *"/health"*) exit 0 ;; esac
out=""; prev=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then out="$a"; fi
  case "$prev" in
    -d|--data|--data-binary|--data-raw) case "$a" in @*) cp "\${a#@}" "${captured}/payload"; stat -f '%Lp' "\${a#@}" > "${captured}/payload.mode" 2>/dev/null || stat -c '%a' "\${a#@}" > "${captured}/payload.mode";; *) printf '%s' "$a" > "${captured}/payload-inline";; esac ;;
    -H|--header) case "$a" in @*) cp "\${a#@}" "${captured}/headers"; stat -f '%Lp' "\${a#@}" > "${captured}/headers.mode" 2>/dev/null || stat -c '%a' "\${a#@}" > "${captured}/headers.mode";; esac ;;
    -K|--config) cp "$a" "${captured}/config"; stat -f '%Lp' "$a" > "${captured}/config.mode" 2>/dev/null || stat -c '%a' "$a" > "${captured}/config.mode" ;;
  esac
  prev="$a"
done
if [ -n "$out" ]; then printf '{"ok":true,"message":"accepted"}' > "$out"; fi
printf '200'
`,
  );
  chmodSync(curlShim, 0o755);

  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: root,
    HERMES_HOME: hermesHome,
    HERMES_JOB_HUNT_HOME: join(hermesHome, "job-hunt"),
    HERMES_PYTHON: pyWrapper,
    BROWSER_USE_DISCOVERY_WORKER_DIR: workerDir,
    BROWSER_USE_DISCOVERY_WORKER_LOG: join(root, "worker.log"),
    TMPDIR: root,
  };
  return { root, argvLog, captured, env };
}

test("discovery trigger keeps the access token and webhook secret out of argv", () => {
  const box = sandbox();
  execFileSync("bash", [scriptPath], { env: box.env, stdio: "pipe", timeout: 60_000 });
  const argv = readFileSync(box.argvLog, "utf8");
  assert.ok(argv.includes("/webhook"), "the webhook POST must have run");
  assert.equal(argv.includes(TOKEN_CANARY), false, "Google access token appeared in a process argv");
  assert.equal(argv.includes(SECRET_CANARY), false, "webhook secret appeared in a process argv");

  // The values still reach the worker, through mode-600 files curl reads.
  const payload = readFileSync(join(box.captured, "payload"), "utf8");
  assert.equal(JSON.parse(payload).googleAccessToken, TOKEN_CANARY);
  const headerSource = existsSync(join(box.captured, "headers"))
    ? join(box.captured, "headers")
    : join(box.captured, "config");
  assert.match(readFileSync(headerSource, "utf8"), new RegExp(SECRET_CANARY));
  for (const name of ["payload.mode", "headers.mode", "config.mode"]) {
    const modeFile = join(box.captured, name);
    if (existsSync(modeFile)) assert.equal(readFileSync(modeFile, "utf8").trim(), "600", name);
  }
});

test("discovery trigger refreshes the shared token through the atomic helper", () => {
  const script = readFileSync(scriptPath, "utf8");
  assert.equal(/jhos_common/.test(script), true, "token refresh must go through jhos_common.load_google_credentials");
  assert.equal(/with open\([^)]*google_token\.json[^)]*'w'\)/.test(script), false, "no direct token rewrite");
});

test("discovery trigger reads the Pipeline without a row cap", () => {
  const script = readFileSync(scriptPath, "utf8");
  assert.equal(/A1:[A-Z]+\d+/.test(script), false, "Pipeline ranges must be open-ended");
});
