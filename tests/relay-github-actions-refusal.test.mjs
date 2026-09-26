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
  // Fake curl: logs its argv, honours -o and -w ("%{http_code}" and
  // "%{redirect_url}"), and answers the first call with FAKE_STATUS /
  // FAKE_BODY / FAKE_REDIRECT and any later call with FAKE_STATUS_2 /
  // FAKE_BODY_2.
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
      'n="$(grep -c -- "--END--" "$FAKE_CURL_LOG")"',
      'status="$FAKE_STATUS"; body="$FAKE_BODY"; redirect="${FAKE_REDIRECT:-}"',
      'if [ "$n" -ge 2 ]; then status="${FAKE_STATUS_2:-500}"; body="${FAKE_BODY_2:-}"; redirect=""; fi',
      'if [ -n "$out" ]; then printf "%s" "$body" > "$out"; else printf "%s" "$body"; fi',
      'case "$fmt" in',
      '  "%{http_code} %{redirect_url}") printf "%s %s" "$status" "$redirect" ;;',
      '  "%{http_code}") printf "%s" "$status" ;;',
      '  "") ;;',
      '  *) echo "fake curl: unsupported -w $fmt" >&2; exit 2 ;;',
      'esac',
      "exit 0",
      "",
    ].join("\n"),
  );
}

function runWorkflow({
  url,
  status = "202",
  body = '{"ok":true}',
  redirect = "",
  status2 = "",
  body2 = "",
  secret = "",
  yaml = read(TEMPLATE_PATH),
}) {
  const scriptPath = join(scratch, "run.sh");
  writeFileSync(scriptPath, extractRunScript(yaml));
  rmSync(curlLog, { force: true });
  const res = spawnSync("bash", [scriptPath], {
    cwd: scratch,
    encoding: "utf8",
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: scratch,
      WEBHOOK_URL: url,
      SHEET_ID: "sheet-example-123",
      WEBHOOK_SECRET: secret,
      FAKE_CURL_LOG: curlLog,
      FAKE_STATUS: status,
      FAKE_BODY: body,
      FAKE_REDIRECT: redirect,
      FAKE_STATUS_2: status2,
      FAKE_BODY_2: body2,
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
  for (const url of [
    "https://jobbored-discovery-relay-main.someone.workers.dev/",
    "https://jobbored-discovery-relay.someone.workers.dev/",
    "https://command-center-forward.someone.workers.dev/",
  ]) {
    it(`the JobBored relay worker ${url} exits non-zero before any POST`, () => {
      const r = runWorkflow({ url });
      assert.notEqual(r.code, 0, r.output);
      assertMigrationNote(r.output);
      assert.equal(r.calls.length, 0, "no POST is sent to a known relay host");
    });
  }

  it("a relay host in any case, with a path and port, is still a relay", () => {
    const r = runWorkflow({
      url: "https://JobBored-Discovery-Relay-Main.Example.WORKERS.dev:443/webhook?x=1",
    });
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
    "https://custom-discovery.account.workers.dev/webhook",
    "https://my-discovery.jobbored-discovery-relay.workers.dev/webhook",
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

  // Apps Script web apps answer a POST with 302 to a one-time
  // script.googleusercontent.com/macros/echo URL once doPost has run; the
  // response body lives behind that GET. This is what a real deployment sends.
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/EXAMPLE/exec";
  const ECHO_URL =
    "https://script.googleusercontent.com/macros/echo?user_content_key=EXAMPLE_KEY&lib=EXAMPLE_LIB";
  const MOVED_BODY =
    '<HTML><HEAD><TITLE>Moved Temporarily</TITLE></HEAD><BODY><H1>Moved Temporarily</H1>The document has moved <A HREF="' +
    ECHO_URL.replace(/&/g, "&amp;") +
    '">here</A>.</BODY></HTML>';

  it("an Apps Script 302 to its content echo succeeds and reads the result by GET", () => {
    const r = runWorkflow({
      url: APPS_SCRIPT_URL,
      status: "302",
      body: MOVED_BODY,
      redirect: ECHO_URL,
      status2: "200",
      body2: '{"ok":true,"event":"command-center.discovery"}',
      secret: "example-secret-value",
    });
    assert.equal(r.code, 0, r.output);
    assert.equal(r.calls.length, 2, "one POST, then one GET of the echo URL");
    const post = r.calls[0].split("\n");
    assert.ok(post.includes(APPS_SCRIPT_URL) && post.includes("POST"));
    const get = r.calls[1].split("\n");
    assert.ok(get.includes(ECHO_URL), "follows the Location it was given");
    assert.ok(!get.includes("POST") && !get.includes("-d"), "the echo is read by GET, never re-posted");
    assert.ok(
      !get.some((a) => a.includes("example-secret-value")),
      "the webhook secret is not sent to the redirect target",
    );
    assert.match(r.output, /"event":"command-center\.discovery"/);
  });

  it("the Settings-generated workflow handles the Apps Script 302 and a custom workers.dev handler", () => {
    const yaml = loadSettingsSchedule().buildGithubActionsYaml(9, 30);
    const apps = runWorkflow({
      yaml,
      url: APPS_SCRIPT_URL,
      status: "302",
      body: MOVED_BODY,
      redirect: ECHO_URL,
      status2: "200",
      body2: '{"ok":true}',
    });
    assert.equal(apps.code, 0, apps.output);
    assert.equal(apps.calls.length, 2);
    const custom = runWorkflow({ yaml, url: "https://custom-discovery.account.workers.dev/webhook" });
    assert.equal(custom.code, 0, custom.output);
    assert.equal(custom.calls.length, 1);
    const relay = runWorkflow({ yaml, url: "https://jobbored-discovery-relay-main.acct.workers.dev/" });
    assert.notEqual(relay.code, 0, relay.output);
    assert.equal(relay.calls.length, 0);
  });

  it("an Apps Script echo that fails still fails the job", () => {
    const r = runWorkflow({
      url: APPS_SCRIPT_URL,
      status: "302",
      body: MOVED_BODY,
      redirect: ECHO_URL,
      status2: "500",
      body2: "boom",
    });
    assert.notEqual(r.code, 0, r.output);
  });

  it("a 302 to any other host fails the job and is not followed", () => {
    const r = runWorkflow({
      url: "https://worker.example-tailnet.ts.net/webhook",
      status: "302",
      body: "",
      redirect: "https://elsewhere.example.com/login",
      status2: "200",
      body2: '{"ok":true}',
      secret: "example-secret-value",
    });
    assert.notEqual(r.code, 0, r.output);
    assert.equal(r.calls.length, 1, "the redirect is not followed");
    assert.doesNotMatch(r.output, /Cloudflare Cron/);
  });

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
