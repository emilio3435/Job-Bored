// BEAUDIT lane H — repo-level guards for the shelved Hermes apply path.
// H2: the Python normalizer and lead-normalizer.ts share one parity fixture.
// H6/H19: ungated or dead submit/write scripts stay deleted.
// H7: no CLI live mode and no env-flag Gate 2 bypass.
// H8/H21: no owner identity or IDs in tracked Hermes files.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeLeadUrl } from "../integrations/browser-use-discovery/src/normalize/lead-normalizer.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hermes = join(repoRoot, "integrations", "hermes-job-hunt");
const scripts = join(hermes, "scripts");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "__pycache__" || name === ".venv" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test("lead-normalizer.ts matches the shared URL parity fixture (Python pins the same file)", () => {
  const fixture = JSON.parse(readFileSync(join(hermes, "tests", "fixtures", "url-normalize-parity.json"), "utf8"));
  assert.ok(fixture.cases.length >= 15);
  for (const { input, expected } of fixture.cases) {
    assert.equal(normalizeLeadUrl(input), expected, `normalizeLeadUrl(${JSON.stringify(input)})`);
  }
});

test("ungated and dead Hermes submit/write scripts stay deleted", () => {
  for (const rel of [
    "greenhouse_filler.py",
    "triage_pipeline.py",
    "ats_adapters",
    "install-rotated-worker-keys.sh",
  ]) {
    assert.equal(existsSync(join(scripts, rel)), false, `${rel} must not ship`);
  }
});

test("only apply-orchestrator.py can start a live filler run", () => {
  const livePattern = /dry_run\s*=\s*False|gate2_confirmed\s*=\s*True|gate2_confirmed=\(/;
  const offenders = walk(scripts)
    .filter((p) => p.endsWith(".py"))
    .filter((p) => !p.endsWith("apply-orchestrator.py"))
    .filter((p) => livePattern.test(readFileSync(p, "utf8")))
    .map((p) => relative(repoRoot, p));
  assert.deepEqual(offenders, []);
  for (const path of [join(scripts, "universal_filler.py"), join(hermes, ".env.example")]) {
    assert.equal(readFileSync(path, "utf8").includes("JHOS_GATE2_CONFIRMED"), false, relative(repoRoot, path));
  }
  assert.equal(/add_argument\("--submit"/.test(readFileSync(join(scripts, "universal_filler.py"), "utf8")), false);
});

test("tracked Hermes code and contracts carry no owner identity or IDs", () => {
  const files = [
    ...walk(scripts).filter((p) => !p.includes(`${join("scripts", "materials_watcher")}`)),
    ...walk(join(hermes, "tests")),
    join(hermes, "approval-contract.v1.json"),
    join(hermes, "approval-contract.local.example.json"),
    join(hermes, "approval-guard-spec.md"),
    join(hermes, ".env.example"),
    join(hermes, "profile", "filler-profile.example.json"),
  ].filter((p) => /\.(py|sh|js|json|md|example|txt)$/.test(p) || p.endsWith(".env.example"));
  const problems = [];
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    const rel = relative(repoRoot, path);
    // Telegram supergroup ids look like -100 followed by 10 digits; only the
    // neutral example id may appear.
    for (const m of text.matchAll(/-100\d{10}/g)) {
      if (m[0] !== "-1001234567890" && !/^-1000000000\d{3}$/.test(m[0])) problems.push(`${rel}: chat id ${m[0].slice(0, 6)}…`);
    }
    // Google Sheet ids are 44-char base64url tokens in a Sheets context.
    if (/SHEET_ID\s*=\s*["'][A-Za-z0-9_-]{40,}["']/.test(text)) problems.push(`${rel}: hardcoded SHEET_ID`);
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
      const domain = m[1].toLowerCase();
      if (!/(^|\.)example\.(com|org|net)$/.test(domain) && !/\.(png|jpg|svg)$/.test(domain)) {
        problems.push(`${rel}: email at ${domain}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the Hermes pytest suite runs in CI", () => {
  const workflow = join(repoRoot, ".github", "workflows", "hermes-pytest.yml");
  assert.equal(existsSync(workflow), true, "a CI job must run integrations/hermes-job-hunt/tests");
  const text = readFileSync(workflow, "utf8");
  assert.match(text, /pytest/);
  assert.match(text, /integrations\/hermes-job-hunt\/tests/);
  assert.match(text, /requirements-dev\.txt/);
});
