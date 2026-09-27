// GFX DESK-A R20/R24: the staged bundle carries runtime files only; the
// self-check fails on tests, docs, caches, env files, config.js or keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findScriptClosure, isExcludedPath, isRuntimeSource, planRuntimeDependencies, scanBareImports, selfCheckStage } from "../scripts/stage.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("R20: runtime sources are in, dev and personal files are out", () => {
  for (const rel of [
    "index.html", "app.js", "style.css", "dev-server.mjs", "package.json", "package-lock.json", "CNAME",
    "config.example.js", "jobbored.svg", "assets/chrome/x.svg", "partials/a.html", "templates/t.html",
    "schemas/s.json", "prompts/p.md", "css/oneflow.css", "lib/x.js", "vendor/pdf.js",
    "server/index.mjs", "server/ai/x.mjs", "server/package-lock.json",
    "integrations/browser-use-discovery/src/server.ts", "integrations/browser-use-discovery/bin/a.mjs",
    "integrations/browser-use-discovery/package.json",
    "integrations/hermes-job-hunt/resume-template/resume.html", "integrations/hermes-job-hunt/scripts/logo_resolver.py",
    "scripts/lib/runtime-env.mjs",
  ]) {
    assert.equal(isRuntimeSource(rel), true, rel);
  }
  for (const rel of [
    "config.js", "README.md", "eslint.config.mjs", "playwright.config.mjs", "redact_secrets.py", "render.yaml",
    ".gitleaks.toml", "tests/a.test.mjs", "docs/x.md", "desktop/main.mjs", "tools/lint.mjs",
    "integrations/browser-use-discovery/tests/a.test.ts", "integrations/browser-use-discovery/docs/x.md",
    "integrations/hermes-job-hunt/profile/profile.md", "integrations/hermes-job-hunt/README.md",
    "scripts/run-tests.mjs", "server/.env.example", "server/.env", ".lane-evidence/r.md",
  ]) {
    assert.equal(isRuntimeSource(rel), false, rel);
  }
});

test("R20: the exclusion predicate catches every banned shape", () => {
  for (const rel of [
    "server/tests/a.mjs", "node_modules/x/test/a.js", "node_modules/x/__tests__/a.js", "docs/a.md",
    "node_modules/x/docs/a.md", "coverage/lcov.info", ".lane-evidence/r.md", "assets/screenshots/a.png",
    "node_modules/.cache/k", "server/node_modules/.cache/tls/key.pem", ".env", "server/.env.local",
    "integrations/browser-use-discovery/.env", "config.js", "certs/dev.pem", "x/id_rsa", "x/id_ed25519.pub",
    "k/service-account-key.json", "k/google_token.json", "a/b.p12", "a/b.key", ".npmrc", "server/.npmrc",
  ]) {
    assert.equal(isExcludedPath(rel), true, rel);
  }
  for (const rel of ["server/config.js", "integrations/browser-use-discovery/src/sheets/credential-readiness.ts", "node_modules/zod/index.js", "keys.js"]) {
    assert.equal(isExcludedPath(rel), false, rel);
  }
});

test("R20: the self-check fails on a planted secret or test and passes when clean", () => {
  const root = mkdtempSync(join(tmpdir(), "jb-stage-check-"));
  try {
    const plant = (/** @type {string} */ rel) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), "x");
    };
    plant("index.html");
    plant("server/index.mjs");
    assert.deepEqual(selfCheckStage(root), []);
    plant("server/.env");
    plant("node_modules/x/test/a.js");
    plant("config.js");
    assert.deepEqual(selfCheckStage(root).sort(), ["config.js", "node_modules/x/test", "server/.env"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R24: the scripts closure follows dev-server's imports and spawns, not dev tools", () => {
  const closure = findScriptClosure(REPO);
  for (const rel of ["scripts/bootstrap-local-discovery.mjs", "scripts/deploy-cloudflare-relay.mjs", "scripts/install-keep-alive.mjs", "scripts/lib/runtime-env.mjs"]) {
    assert.ok(closure.has(rel), rel);
  }
  for (const rel of ["scripts/run-tests.mjs", "scripts/desktop-selftest.mjs"]) assert.ok(!closure.has(rel), rel);
});

test("R24: runtime-imported devDependencies are promoted; undeclared imports fail the stage", () => {
  const plan = planRuntimeDependencies(
    { dependencies: { zod: "^4" }, devDependencies: { ajv: "^8", "ajv-formats": "^3", eslint: "^9" } },
    new Set(["zod", "ajv", "ajv-formats", "fs", "node:path", "child_process"]),
  );
  assert.deepEqual(plan.dependencies, { zod: "^4", ajv: "^8", "ajv-formats": "^3" });
  assert.deepEqual(plan.promoted, ["ajv", "ajv-formats"]);
  assert.throws(() => planRuntimeDependencies({ dependencies: {} }, new Set(["left-pad"])), /left-pad/);
});

test("R24: the import scan finds the worker's bare imports and ignores strings and builtins", () => {
  const found = scanBareImports(REPO, ["integrations/browser-use-discovery/src/profile/load-user-profile.ts", "dev-server.mjs"]);
  assert.ok(found.has("ajv") && found.has("ajv-formats"));
  for (const name of found) assert.match(name, /^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/);
  assert.ok(![...found].some((n) => n === "fs" || n.startsWith("node:")));
});
