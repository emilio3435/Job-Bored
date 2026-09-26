// Claim RGHA (BEAUDIT lane Y): the GitHub Actions -> Cloudflare relay path is
// retired for good. The relay answers 401 without its per-dashboard bearer
// (G1/G24), and no discovery workflow sends that bearer, so a workflow whose
// COMMAND_CENTER_DISCOVERY_WEBHOOK_URL is a relay used to "succeed" while every
// scheduled run was refused. The workflow now exits non-zero with the
// migration note when the URL is a relay (a workers.dev host, or a 401 whose
// body is the relay-auth refusal), and still posts to any other receiver.
//
// The test runs the workflow's own `run:` script under bash with a fake
// `curl` and a fake `node` first on PATH. No network is used.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const TEMPLATE_PATH = "templates/github-actions/command-center-discovery.yml";
const REPO_WORKFLOW_PATH = ".github/workflows/command-center-discovery.yml";

const scratch = mkdtempSync(join(tmpdir(), "rgha-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function loadSettingsSchedule() {
  const storage = new Map();
  const context = {
    window: {
      setTimeout,
      clearTimeout,
      location: { hostname: "localhost", port: "8080" },
    },
    document: {
      readyState: "loading",
      addEventListener() {},
      getElementById() {
        return null;
      },
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    navigator: { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel" },
    console,
    URL,
    AbortController,
    fetch: async () => {
      throw new Error("no network in RGHA tests");
    },
  };
  vm.createContext(context);
  vm.runInContext(read("config-overrides.js"), context);
  vm.runInContext(read("settings-profile-tab.js"), context);
  return context.window.JobBoredSettingsProfileTab.schedule;
}

// Pull the `run: |` block out of the workflow and dedent it into a script.
function extractRunScript(yaml) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^\s+run: \|\s*$/.test(line));
  assert.ok(start >= 0, "workflow has a run: | block");
  const indent = lines[start].match(/^(\s*)/)[1].length + 2;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && line.match(/^(\s*)/)[1].length < indent) break;
    body.push(line.slice(indent));
  }
  return body
    .join("\n")
    .replace(/\$\{\{\s*github\.event_name\s*\}\}/g, "workflow_dispatch");
}

const binDir = join(scratch, "bin");
const curlLog = join(scratch, "curl.log");
function writeExecutable(path, text) {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}
{
  spawnSync("mkdir", ["-p", binDir]);
  // Fake node: stands in for scripts/run-scheduled-discovery.mjs --dry-run.
  writeExecutable(
    join(binDir, "node"),
    '#!/bin/bash\necho \'{"event":"command-center.discovery","schemaVersion":1,"trigger":"scheduled-github"}\'\n',
  );
  // Fake curl: logs its argv, honours -o and -w "%{http_code}", and answers
  // with FAKE_STATUS / FAKE_BODY.
  writeExecutable(
    join(binDir, "curl"),
    [
      "#!/bin/bash",
      'printf "%s\\n" "$@" >> "$FAKE_CURL_LOG"',
      'echo "--END--" >> "$FAKE_CURL_LOG"',
      'out=""; fmt=""',
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out="$2"; shift 2 ;;',
      '    -w) fmt="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'if [ -n "$out" ]; then printf "%s" "$FAKE_BODY" > "$out"; else printf "%s" "$FAKE_BODY"; fi',
      'if [ -n "$fmt" ]; then printf "%s" "${fmt//%\\{http_code\\}/$FAKE_STATUS}"; fi',
      "exit 0",
      "",
    ].join("\n"),
  );
}

function runWorkflow({ url, status = "202", body = '{"ok":true}' }) {
  const scriptPath = join(scratch, "run.sh");
  writeFileSync(scriptPath, extractRunScript(read(TEMPLATE_PATH)));
  rmSync(curlLog, { force: true });
  const res = spawnSync("bash", [scriptPath], {
    cwd: scratch,
    encoding: "utf8",
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: scratch,
      WEBHOOK_URL: url,
      SHEET_ID: "sheet-example-123",
      WEBHOOK_SECRET: "",
      FAKE_CURL_LOG: curlLog,
      FAKE_STATUS: status,
      FAKE_BODY: body,
    },
  });
  const calls = existsSync(curlLog)
    ? readFileSync(curlLog, "utf8").split("--END--\n").filter(Boolean)
    : [];
  return { code: res.status, output: `${res.stdout}\n${res.stderr}`, calls };
}

function assertMigrationNote(output) {
  assert.match(output, /Cloudflare relay/);
  assert.match(output, /--sheet-id/);
  assert.match(output, /Cloudflare Cron/);
  assert.match(output, /COMMAND_CENTER_DISCOVERY_WEBHOOK_URL/);
  assert.match(output, /public URL|Apps Script/);
}

describe("RGHA: the three discovery workflows are one workflow", () => {
  it("the repo workflow is byte-identical to the template", () => {
    assert.equal(read(REPO_WORKFLOW_PATH), read(TEMPLATE_PATH));
  });

  it("the Settings-generated workflow embeds the template verbatim", () => {
    const schedule = loadSettingsSchedule();
    for (const [h, m] of [
      [6, 0],
      [9, 30],
    ]) {
      assert.equal(
        schedule.buildGithubActionsYaml(h, m),
        schedule.buildGithubActionsYaml(h, m, read(TEMPLATE_PATH)),
      );
    }
  });
});

describe("RGHA: a relay webhook URL is refused with the migration note", () => {
  it("a workers.dev URL exits non-zero before any POST", () => {
    const r = runWorkflow({ url: "https://jobbored-relay.someone.workers.dev/" });
    assert.notEqual(r.code, 0, r.output);
    assertMigrationNote(r.output);
    assert.equal(r.calls.length, 0, "no POST is sent to a known relay host");
  });

  it("a workers.dev host in any case, with a path and port, is still a relay", () => {
    const r = runWorkflow({ url: "https://Relay.Example.WORKERS.dev:443/webhook?x=1" });
    assert.notEqual(r.code, 0, r.output);
    assertMigrationNote(r.output);
  });

  it("a custom-domain relay that answers the relay-auth 401 exits non-zero", () => {
    const r = runWorkflow({
      url: "https://relay.example.com/",
      status: "401",
      body: '{"error":"Unauthorized"}',
    });
    assert.notEqual(r.code, 0, r.output);
    assertMigrationNote(r.output);
  });

  it("a relay with no RELAY_TOKEN (relay_token_not_configured) exits non-zero", () => {
    const r = runWorkflow({
      url: "https://relay.example.com/",
      status: "401",
      body: '{"error":"relay_token_not_configured","message":"x"}',
    });
    assert.notEqual(r.code, 0, r.output);
    assertMigrationNote(r.output);
  });
});

describe("RGHA: a non-relay webhook URL still posts", () => {
  for (const url of [
    "https://worker.example-tailnet.ts.net/webhook",
    "https://script.google.com/macros/s/EXAMPLE/exec",
    "https://workers.dev.example.com/webhook",
  ]) {
    it(`${url} is posted once and the job succeeds on 2xx`, () => {
      const r = runWorkflow({ url });
      assert.equal(r.code, 0, r.output);
      assert.equal(r.calls.length, 1);
      const argv = r.calls[0].split("\n");
      assert.ok(argv.includes(url), `curl posted to ${url}`);
      assert.ok(argv.includes("POST"));
      assert.ok(argv.some((a) => a.includes('"scheduled-github"')), "body is the built payload");
      assert.doesNotMatch(r.output, /Cloudflare Cron/);
    });
  }

  it("a worker's own 401 fails the job without claiming it is a relay", () => {
    const r = runWorkflow({
      url: "https://worker.example-tailnet.ts.net/webhook",
      status: "401",
      body: '{"ok":false,"message":"Unauthorized discovery webhook request."}',
    });
    assert.notEqual(r.code, 0, r.output);
    assert.doesNotMatch(r.output, /Cloudflare Cron/);
  });
});

describe("RGHA: Settings and the wizard stop offering the relay to GitHub Actions", () => {
  it("the Settings Tier 3 secret step names the targets and refuses the relay", () => {
    const html = read("partials/discovery-drawer.html");
    const start = html.indexOf('id="settingsProfileScheduleCloudDownload"');
    const end = html.indexOf('id="settingsProfileScheduleCloudError"');
    assert.ok(start > 0 && end > start);
    const steps = html.slice(start, end).replace(/\s+/g, " ");
    assert.match(steps, /worker's public URL|Apps Script/);
    assert.match(steps, /not a Cloudflare relay/i);
    assert.match(steps, /Cloudflare Cron/);
  });

  it("the wizard's relay deploy prompt says the relay is not a GitHub Actions target", async () => {
    const source = read("discovery-wizard-relay.js");
    assert.match(
      source,
      /Do not point a GitHub Actions workflow at the relay[^"`]*Cloudflare Cron/,
    );
  });

  for (const rel of ["docs/SETTINGS-SCHEDULE.md", "templates/github-actions/README.md"]) {
    it(`${rel} says the workflow now stops on a relay URL`, () => {
      assert.match(read(rel), /workflow (now )?(stops|exits non-zero)[^.]*relay/i);
    });
  }
});
