// GFX DESK-D: structural guard for .github/workflows/desktop-mac.yml.
// The workflow only runs on GitHub, so these checks pin its safety rails
// locally: drafts only, signing gated on secrets + manual dispatch, pinned
// actions, secrets routed through env:, minimal permissions, no live ports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(ROOT, ".github/workflows/desktop-mac.yml");
const LIVE_PORTS = ["8080", "8644", "3847"];

// No YAML parser is a repo dependency; Ruby (Psych) and PyYAML ship on
// macOS and the GitHub Ubuntu runners. Either converts the file to JSON.
function loadYaml(file) {
  const parsers = [
    ["ruby", ["-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.safe_load(File.read(ARGV[0])))", file]],
    ["python3", ["-c", "import json,sys,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))", file]],
  ];
  const errors = [];
  for (const [cmd, args] of parsers) {
    try {
      return JSON.parse(execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    } catch (err) {
      errors.push(`${cmd}: ${err.message.split("\n")[0]}`);
    }
  }
  throw new Error(`no YAML parser available (${errors.join("; ")})`);
}

const raw = readFileSync(WORKFLOW, "utf8");
const wf = loadYaml(WORKFLOW);
// YAML 1.1 parsers read the bare key `on` as boolean true.
const triggers = wf.on ?? wf.true;
const jobs = wf.jobs ?? {};
const allSteps = Object.entries(jobs).flatMap(([job, j]) =>
  (j.steps ?? []).map((s) => ({ job, ...s })),
);
const SIGN_SECRET = /secrets\.(MAC_CSC_|APPLE_)/;
const envText = (step) => JSON.stringify(step.env ?? {});

test("triggers: workflow_dispatch with version, pull_request on desktop paths only", () => {
  assert.deepEqual(Object.keys(triggers).sort(), ["pull_request", "workflow_dispatch"]);
  assert.ok(triggers.workflow_dispatch.inputs?.version, "dispatch needs a version input");
  assert.equal(triggers.workflow_dispatch.inputs.version.required, true);
  assert.deepEqual(
    [...triggers.pull_request.paths].sort(),
    [".github/workflows/desktop-mac.yml", "desktop/**", "scripts/lib/runtime-env.mjs"],
  );
});

test("build-mac: macos-15, 60 min, concurrency per ref", () => {
  assert.equal(jobs["build-mac"]?.["runs-on"], "macos-15");
  assert.equal(jobs["build-mac"]["timeout-minutes"], 60);
  assert.match(String(wf.concurrency?.group ?? ""), /github\.ref/);
});

test("never publishes: --publish never on every build, drafts only, no tag push", () => {
  assert.doesNotMatch(raw, /publish[\s:=]+["']?always/i);
  assert.doesNotMatch(raw, /--draft[= ]false|draft:\s*false/);
  assert.doesNotMatch(raw, /\bgit\s+(push|tag)\b/);
  const builds = allSteps.filter((s) => /electron-builder/.test(s.run ?? ""));
  assert.ok(builds.length > 0, "an electron-builder step exists");
  for (const s of builds) {
    assert.match(s.run, /--mac dmg zip --universal --publish never/, `${s.name}: build flags`);
  }
  const creates = allSteps.filter((s) => /gh release create/.test(s.run ?? ""));
  assert.ok(creates.length > 0, "draft-release creates a release");
  for (const s of creates) assert.match(s.run, /gh release create[^\n]*--draft/);
  assert.doesNotMatch(raw, /gh release edit/);
  assert.match(raw, /emilio3435\/jobbored-desktop/);
});

test("signing is gated on MAC_CSC_LINK and workflow_dispatch", () => {
  const gate = jobs["build-mac"].steps.find((s) => s.id === "gate");
  assert.ok(gate, "a step with id: gate computes the SIGN output");
  assert.equal(gate.env?.MAC_CSC_LINK, "${{ secrets.MAC_CSC_LINK }}");
  assert.match(gate.run, /-n "\$MAC_CSC_LINK"/);
  assert.match(gate.run, /workflow_dispatch/);
  assert.match(String(jobs["build-mac"].outputs?.sign ?? ""), /steps\.gate\.outputs\.sign/);

  for (const s of allSteps.filter((st) => st.id !== "gate" && SIGN_SECRET.test(envText(st)))) {
    assert.match(String(s.if ?? ""), /steps\.gate\.outputs\.sign == 'true'/, `${s.name} must be gated`);
  }
  const builds = jobs["build-mac"].steps.filter((s) => /electron-builder/.test(s.run ?? ""));
  const unsigned = builds.filter((s) => /steps\.gate\.outputs\.sign != 'true'/.test(String(s.if ?? "")));
  assert.equal(unsigned.length, 1, "exactly one unsigned build step, gated on sign != 'true'");
  assert.equal(String(unsigned[0].env?.CSC_IDENTITY_AUTO_DISCOVERY), "false");
  assert.doesNotMatch(envText(unsigned[0]), /secrets\./, "unsigned build sees no secret");
  for (const b of builds.filter((s) => s !== unsigned[0])) {
    assert.match(String(b.if ?? ""), /steps\.gate\.outputs\.sign == 'true'/);
  }

  const draft = jobs["draft-release"];
  assert.ok(draft, "draft-release job exists");
  assert.deepEqual([draft.needs].flat(), ["build-mac"]);
  assert.match(draft.if, /github\.event_name == 'workflow_dispatch'/);
  assert.match(draft.if, /needs\.build-mac\.outputs\.sign == 'true'/);
});

test("key material lives under RUNNER_TEMP and is removed in an always() step", () => {
  assert.doesNotMatch(raw, /set -x|set -o xtrace/);
  const writesKey = allSteps.filter((s) => /\.p8|\.p12|keychain/.test(s.run ?? "") && s.id !== "gate");
  assert.ok(writesKey.length > 0);
  assert.match(raw, /umask 077|chmod 600/);
  assert.match(raw, /::add-mask::/);
  const cleanup = allSteps.find((s) => /always\(\)/.test(String(s.if ?? "")) && /rm -f/.test(s.run ?? ""));
  assert.ok(cleanup, "an always() cleanup step removes key files");
  assert.match(cleanup.run, /RUNNER_TEMP/);
  assert.match(cleanup.run, /delete-keychain/);
});

test("every uses: is pinned to a 40-char SHA with a version comment", () => {
  const usesLines = raw.split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
  assert.ok(usesLines.length > 0);
  for (const line of usesLines) {
    assert.match(line, /uses:\s*[\w.-]+\/[\w.\/-]+@[0-9a-f]{40}\s+#\s*v\d/, line.trim());
  }
});

test("no secrets.* or inputs.* expression inside a run: script", () => {
  for (const s of allSteps) {
    if (!s.run) continue;
    assert.doesNotMatch(s.run, /secrets\./, `${s.job}/${s.name}: secret in run`);
    assert.doesNotMatch(s.run, /\$\{\{[^}]*inputs\./, `${s.job}/${s.name}: input interpolated in run`);
  }
});

test("permissions are minimal: contents read, nothing writable", () => {
  assert.deepEqual(wf.permissions, { contents: "read" });
  for (const [name, j] of Object.entries(jobs)) {
    for (const [scope, level] of Object.entries(j.permissions ?? {})) {
      assert.notEqual(level, "write", `${name}.${scope} must not be write`);
    }
  }
  assert.doesNotMatch(raw, /write-all/);
});

test("smoke test runs the packaged app on alternate ports, never the live ones", () => {
  const smoke = allSteps.find((s) => String(s.env?.JOBBORED_DESKTOP_SMOKE) === "1");
  assert.ok(smoke, "a step runs with JOBBORED_DESKTOP_SMOKE=1");
  const text = `${envText(smoke)}\n${smoke.run}`;
  const ports = Object.entries(smoke.env).filter(([k]) => /PORT/.test(k)).map(([, v]) => String(v));
  assert.ok(ports.length >= 3, "smoke declares its alternate ports");
  for (const p of LIVE_PORTS) assert.ok(!text.includes(p), `smoke must not use live port ${p}`);
  assert.ok(allSteps.some((s) => /app-bundle/.test(s.run ?? "") && /excluded/i.test(s.name ?? "")));
});

test("never a required check: ci.yml does not reference this workflow", () => {
  const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.doesNotMatch(ci, /desktop-mac|build-mac/);
});
