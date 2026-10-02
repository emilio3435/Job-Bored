import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

test("S10: image uses only npm ci, a non-root user and a public healthcheck", () => {
  const dockerfile = read("server/Dockerfile");
  assert.doesNotMatch(dockerfile, /npm install/);
  assert.match(dockerfile, /RUN npm ci --omit=dev/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^HEALTHCHECK .*\/health/m);
});

test("S9: image installs system Chromium and selects its executable", () => {
  const dockerfile = read("server/Dockerfile");
  assert.match(dockerfile, /apk add --no-cache python3 chromium/);
  assert.match(dockerfile, /^ENV JOBBORED_CHROMIUM_PATH=\/usr\/bin\/chromium-browser$/m);
});

test("S2: Docker requires staged assets and Render keeps the checkout root", () => {
  const dockerfile = read("server/Dockerfile");
  assert.match(dockerfile, /WORKDIR \/app\/server/);
  assert.match(dockerfile, /run node scripts\/stage-server-image-assets.mjs before docker build/);
  assert.match(dockerfile, /mv \.image-assets\/\* \.\./);
  const render = read("render.yaml");
  assert.doesNotMatch(render, /rootDir: server/);
  assert.match(render, /runtime: docker/);
  assert.match(render, /dockerfilePath: \.\/server\/Dockerfile.render/);
  assert.match(render, /dockerContext: \./);
  assert.doesNotMatch(render, /buildCommand:|startCommand:/);
  assert.match(render, /healthCheckPath: \/health/);
  for (const path of ["server/**", "schemas/**", "templates/materials/**", "vendor/fonts/**"]) {
    assert.ok(render.includes(path), path);
  }
});

test("S11: blocking CI builds both hosted images and checks auth, templates and PDF", () => {
  const ci = read(".github/workflows/ci.yml");
  const job = ci.match(/^  server-image-smoke:\n([\s\S]*?)(?=^  [\w-]+:\n|$(?![\s\S]))/m)?.[1];
  assert.ok(job, "server-image-smoke job exists");
  assert.doesNotMatch(job, /continue-on-error:/);
  for (const text of ["node scripts/stage-server-image-assets.mjs", "server/Dockerfile.render", "docker build", "docker run", "/health", "401", "/api/materials/templates", "Authorization: Bearer", "/health?deep=1", "renderPdfIfPossible"]) {
    assert.ok(job.includes(text), text);
  }
});

test("S9: Render image installs and selects Chromium without native runtime assumptions", () => {
  assert.ok(existsSync(join(repoRoot, "server/Dockerfile.render")), "Render Dockerfile exists");
  const dockerfile = read("server/Dockerfile.render");
  assert.match(dockerfile, /apk add --no-cache python3 chromium/);
  assert.match(dockerfile, /JOBBORED_CHROMIUM_PATH=\/usr\/bin\/chromium-browser/);
  assert.match(dockerfile, /USER node/);
  for (const dir of ["schemas", "templates/materials", "vendor/fonts"]) assert.ok(dockerfile.includes(`COPY ${dir}/`), dir);
});

test("S11: required test aggregate refuses failed, skipped or cancelled hosted images", () => {
  const ci = read(".github/workflows/ci.yml");
  const aggregate = ci.match(/^  test:\n([\s\S]*?)(?=^  [\w-]+:\n)/m)?.[1];
  assert.ok(aggregate);
  const script = aggregate.split("run: |\n")[1].split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  for (const image of ["failure", "skipped", "cancelled", "success"]) {
    const run = spawnSync("bash", ["-e", "-c", script], { env: { ...process.env, SHARD_RESULT: "success", IMAGE_RESULT: image } });
    assert.equal(run.status === 0, image === "success", image);
  }
  assert.match(aggregate, /needs: \[test-shard, server-image-smoke\]/);
  assert.match(aggregate, /IMAGE_RESULT: \$\{\{ needs.server-image-smoke.result \}\}/);
});

test("S2: materials consumers load staged schemas, templates and fonts in isolation", async () => {
  const script = join(repoRoot, "scripts/stage-server-image-assets.mjs");
  assert.ok(existsSync(script), "build-time asset stager exists");
  const { stageServerImageAssets } = await import(script);
  const scratch = mkdtempSync(join(tmpdir(), "holes-host-assets-"));
  try {
    const serverDir = join(scratch, "app/server");
    mkdirSync(serverDir, { recursive: true });
    cpSync(join(repoRoot, "server"), serverDir, {
      recursive: true,
      filter: (path) => !["node_modules", ".image-assets"].includes(path.split("/").at(-1)) && !path.split("/").at(-1).startsWith(".env"),
    });
    stageServerImageAssets({ repoRoot, serverDir });
    for (const name of ["schemas", "templates", "vendor"]) {
      renameSync(join(serverDir, ".image-assets", name), join(scratch, "app", name));
    }
    symlinkSync(join(repoRoot, "server/node_modules"), join(serverDir, "node_modules"), "dir");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", "import {checkSchemas, checkTemplates, checkFonts} from './health-deep.mjs'; console.log(JSON.stringify([checkSchemas(),checkTemplates(),checkFonts()]));"], { cwd: serverDir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const checks = JSON.parse(result.stdout.trim());
    assert.ok(checks.every((check) => check.ok), result.stdout);
    assert.ok(checks[0].count >= 8);
    assert.ok(checks[1].families.includes("signal"));
    assert.ok(checks[2].faces > 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("S2: staged server-only image answers deep health and authenticated templates", async () => {
  const script = join(repoRoot, "scripts/stage-server-image-assets.mjs");
  assert.ok(existsSync(script), "build-time asset stager exists");
  const { stageServerImageAssets } = await import(script);
  const scratch = mkdtempSync(join(tmpdir(), "holes-host-image-"));
  const serverDir = join(scratch, "app", "server");
  let child;
  try {
    mkdirSync(serverDir, { recursive: true });
    cpSync(join(repoRoot, "server"), serverDir, {
      recursive: true,
      filter: (path) => !["node_modules", ".image-assets"].includes(path.split("/").at(-1)) && !path.split("/").at(-1).startsWith(".env"),
    });
    const staged = join(serverDir, ".image-assets");
    mkdirSync(staged);
    writeFileSync(join(staged, "stale.txt"), "stale");
    stageServerImageAssets({ repoRoot, serverDir });
    assert.equal(existsSync(join(staged, "stale.txt")), false, "old staged content is cleared");
    for (const name of ["schemas", "templates", "vendor"]) renameSync(join(staged, name), join(scratch, "app", name));
    rmSync(staged, { recursive: true });
    symlinkSync(join(repoRoot, "server/node_modules"), join(serverDir, "node_modules"), "dir");
    const port = await new Promise((done, reject) => {
      const probe = createServer();
      probe.on("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const value = probe.address().port;
        probe.close(() => done(value));
      });
    });
    child = spawn(process.execPath, ["index.mjs"], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH || "", HOME: join(scratch, "home"),
        PORT: String(port), LISTEN_HOST: "0.0.0.0",
        JOBBORED_API_TOKEN: "image-test-token", COMMAND_CENTER_ALLOWED_ORIGINS: "https://dashboard.example",
        HERMES_APPLICATIONS_ROOT: join(scratch, "applications"), JOBBORED_LOGOS_DIR: join(scratch, "logos"),
      },
      stdio: "ignore",
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null) break;
      if ((await fetch(`${base}/health`).catch(() => null))?.ok) { ready = true; break; }
      await sleep(100);
    }
    assert.ok(ready, "staged server boots");
    assert.equal((await fetch(`${base}/api/materials/templates`)).status, 401);
    const headers = { Authorization: "Bearer image-test-token" };
    const deep = await fetch(`${base}/health?deep=1`, { headers });
    assert.equal(deep.status, 200);
    const health = await deep.json();
    for (const name of ["schemas", "templates", "fonts"]) assert.equal(health.checks[name].ok, true);
    const templates = await fetch(`${base}/api/materials/templates`, { headers });
    assert.equal(templates.status, 200);
    assert.ok((await templates.json()).templates.length > 0);
  } finally {
    if (child && child.exitCode === null) {
      const stopped = new Promise((done) => child.once("exit", done));
      child.kill("SIGKILL");
      await stopped;
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
