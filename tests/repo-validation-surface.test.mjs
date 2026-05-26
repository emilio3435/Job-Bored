import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getRepoInstallPlan, installRepo } from "../scripts/install-repo.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readManifestCommands() {
  const manifest = readFileSync(join(repoRoot, ".factory/services.yaml"), "utf8");
  const commandsSection = manifest.match(/commands:\n([\s\S]*?)\nservices:/);
  assert.ok(commandsSection, "Expected commands section in .factory/services.yaml");

  const commands = {};
  for (const line of commandsSection[1].split("\n")) {
    const match = /^\s{2}([a-z]+):\s*(.+)$/.exec(line);
    if (match) {
      commands[match[1]] = match[2].trim();
    }
  }
  return commands;
}

function readManifestText() {
  return readFileSync(join(repoRoot, ".factory/services.yaml"), "utf8");
}

async function createScratchRepo() {
  const scratchRoot = await mkdtemp(join(tmpdir(), "job-bored-install-"));
  await mkdir(join(scratchRoot, "server"), { recursive: true });
  await writeFile(
    join(scratchRoot, "package.json"),
    `${JSON.stringify({ name: "scratch-root", private: true }, null, 2)}\n`,
  );
  await writeFile(
    join(scratchRoot, "package-lock.json"),
    `${JSON.stringify({ name: "scratch-root", lockfileVersion: 3 }, null, 2)}\n`,
  );
  await writeFile(
    join(scratchRoot, "server", "package.json"),
    `${JSON.stringify({ name: "scratch-server", private: true }, null, 2)}\n`,
  );
  await writeFile(
    join(scratchRoot, "server", "package-lock.json"),
    `${JSON.stringify({ name: "scratch-server", lockfileVersion: 3 }, null, 2)}\n`,
  );
  return scratchRoot;
}

function createInstallRunner(calls) {
  return async (command, args, { cwd }) => {
    calls.push({ command, args, cwd });
    await mkdir(join(cwd, "node_modules"), { recursive: true });
    await mkdir(join(cwd, "server", "node_modules"), { recursive: true });
    return 0;
  };
}

async function runDiscoveryWorkerEnvProbe(script, envOverrides = {}) {
  const scratchRoot = await mkdtemp(join(tmpdir(), "job-bored-worker-env-"));
  await mkdir(join(scratchRoot, "integrations", "browser-use-discovery"), {
    recursive: true,
  });
  await writeFile(
    join(scratchRoot, "integrations", "browser-use-discovery", ".env"),
    "BROWSER_USE_DISCOVERY_HOST=0.0.0.0\nBROWSER_USE_DISCOVERY_PORT=8644\n",
  );
  const probeScript = script.replace(
    /node --experimental-strip-types integrations\/browser-use-discovery\/src\/server\.ts$/,
    "node -e 'console.log(JSON.stringify({host:process.env.BROWSER_USE_DISCOVERY_HOST,port:process.env.BROWSER_USE_DISCOVERY_PORT}))'",
  );
  assert.notEqual(probeScript, script, "expected package script probe rewrite");

  const env = { ...process.env };
  delete env.BROWSER_USE_DISCOVERY_HOST;
  delete env.BROWSER_USE_DISCOVERY_PORT;
  const result = spawnSync("bash", ["-lc", probeScript], {
    cwd: scratchRoot,
    encoding: "utf8",
    env: { ...env, ...envOverrides },
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || "expected discovery worker env probe to pass",
  );
  return JSON.parse(result.stdout.trim());
}

describe("repo validation surface", () => {
  it("routes manifest validation commands through shared repo scripts", async () => {
    const pkg = JSON.parse(
      await readFile(join(repoRoot, "package.json"), "utf8"),
    );
    const manifestCommands = readManifestCommands();

    assert.equal(pkg.scripts["install:repo"], "node scripts/install-repo.mjs");
    assert.equal(pkg.scripts["doctor"], "node scripts/doctor.mjs");
    assert.equal(pkg.scripts["prestart"], "node scripts/install-repo.mjs");
    assert.equal(pkg.scripts["predev"], "node scripts/install-repo.mjs");
    assert.equal(
      pkg.scripts["setup:auto"],
      "npm run install:repo && npm run discovery:bootstrap-local",
    );
    assert.equal(
      pkg.scripts["discovery:keep-alive"],
      "node scripts/discovery-keep-alive.mjs",
    );
    assert.match(
      pkg.scripts["start:discovery-worker"],
      /JOBBORED_START_DISCOVERY_PORT="\$\{BROWSER_USE_DISCOVERY_PORT:-\}"/,
    );
    assert.match(
      pkg.scripts["start:discovery-worker"],
      /BROWSER_USE_DISCOVERY_PORT="\$\{JOBBORED_START_DISCOVERY_PORT:-\$\{BROWSER_USE_DISCOVERY_PORT:-8644\}\}"/,
    );
    assert.doesNotMatch(
      pkg.scripts["start:discovery-worker"],
      /BROWSER_USE_DISCOVERY_PORT=8644(?:\s|$)/,
    );
    assert.equal(
      pkg.scripts["test:repo"],
      "npm run test:contract:all && node --test tests/*.test.mjs && npm run test:browser-use-discovery",
    );
    assert.equal(pkg.scripts["lint:repo"], "npm run lint:skills");
    assert.equal(
      pkg.scripts["typecheck:repo"],
      "node --check app.js && node --check discovery-payload.js && node --check expired-review.js && node --check dev-server.mjs && node --check discovery-wizard-local.js && node --check discovery-wizard-probes.js && node --check discovery-wizard-relay.js && node --check discovery-wizard-shell.js && node --check discovery-wizard-verify.js && node --check settings-tabs.js && node --check settings-profile-tab.js && node --check user-content-store.js && node --check resume-bundle.js && node --check resume-generate.js && node --check document-templates.js && node --check scripts/run-scheduled-discovery.mjs && node --check scripts/run-scheduled-expired-cleanup.mjs && node --check scripts/install-expired-cleanup-schedule.mjs && node --check scripts/uninstall-expired-cleanup-schedule.mjs && node --check scripts/install-repo.mjs && node --check scripts/doctor.mjs && node --check server/index.mjs && node --check server/job-scraper.mjs && node --check server/ats-request-payload.mjs && node --check server/ats-scorecard.mjs",
    );
    assert.equal(
      pkg.scripts["web-only:https"],
      "COMMAND_CENTER_TLS=1 node dev-server.mjs",
    );

    assert.deepEqual(
      await runDiscoveryWorkerEnvProbe(pkg.scripts["start:discovery-worker"], {
        BROWSER_USE_DISCOVERY_HOST: "127.0.0.9",
        BROWSER_USE_DISCOVERY_PORT: "9123",
      }),
      { host: "127.0.0.9", port: "9123" },
    );

    assert.deepEqual(manifestCommands, {
      install: "npm run install:repo",
      test: "npm run test:repo",
      lint: "npm run lint:repo",
      typecheck: "npm run typecheck:repo",
    });

    assert.match(
      readManifestText(),
      /\n  web_tls:\n    start: npm run web-only:https\n    stop: if lsof -ti tcp:8080 >\/dev\/null; then lsof -ti tcp:8080 \| xargs kill; fi\n    healthcheck: curl -skf https:\/\/localhost:8080\/\n    port: 8080\n    depends_on: \[\]/,
    );
  });

  it("keeps documented npm run commands backed by package scripts", async () => {
    const pkg = JSON.parse(
      await readFile(join(repoRoot, "package.json"), "utf8"),
    );
    const docs = [
      "README.md",
      "SETUP.md",
      "DEPLOY-SCRAPER.md",
      "docs/README.md",
      "docs/SETTINGS-SCHEDULE.md",
      "templates/github-actions/README.md",
      "templates/cloudflare-worker/README.md",
    ];
    const documented = new Set();
    for (const rel of docs) {
      const text = await readFile(join(repoRoot, rel), "utf8");
      const re = /npm run ([a-z0-9:_-]+)/g;
      let match;
      while ((match = re.exec(text))) {
        documented.add(match[1]);
      }
    }
    const missing = [...documented].filter((script) => !pkg.scripts[script]);
    assert.deepEqual(missing, []);
  });

  it("documents hosted run status token polling and exact statusPath preservation", async () => {
    const docs = [
      "AGENT_CONTRACT.md",
      "SETUP.md",
      "docs/CONTRACT-CHANGELOG.md",
      "docs/GITHUB-PAGES.md",
      "docs/BROWSER-USE-DISCOVERY-WORKER-ARCHITECTURE.md",
      "docs/BROWSER-USE-DISCOVERY-WORKER-SWARM-REFERENCE.md",
    ];
    for (const rel of docs) {
      const text = await readFile(join(repoRoot, rel), "utf8");
      assert.match(text, /statusPath/);
      assert.match(text, /statusToken/);
      assert.match(text, /preserve[^.\n]*(?:statusPath|path)[^.\n]*exact/i);
      assert.match(text, /\/runs\/:runId|\/runs\/<runId>|\/runs\/run_123/);
    }
  });

  it("marks dependencies fresh after installRepo records the current inputs", async () => {
    const scratchRoot = await createScratchRepo();
    const calls = [];

    const installResult = await installRepo({
      repoRoot: scratchRoot,
      runner: createInstallRunner(calls),
      silent: true,
    });
    const plan = await getRepoInstallPlan(scratchRoot);

    assert.equal(installResult.installed, true);
    assert.equal(calls.length, 1);
    assert.equal(plan.shouldInstall, false);
    assert.equal(plan.reason, "dependencies_fresh");
    assert.ok(
      existsSync(join(scratchRoot, "node_modules", ".repo-install-state.json")),
      "expected install marker to be written under node_modules",
    );
  });

  it("reruns when dependency inputs change even if node_modules already exist", async () => {
    const scratchRoot = await createScratchRepo();
    await installRepo({
      repoRoot: scratchRoot,
      runner: createInstallRunner([]),
      silent: true,
    });

    await writeFile(
      join(scratchRoot, "server", "package-lock.json"),
      `${JSON.stringify(
        {
          name: "scratch-server",
          lockfileVersion: 3,
          packages: { "": { version: "2.0.0" } },
        },
        null,
        2,
      )}\n`,
    );

    const plan = await getRepoInstallPlan(scratchRoot);
    const calls = [];
    const refreshResult = await installRepo({
      repoRoot: scratchRoot,
      runner: createInstallRunner(calls),
      silent: true,
    });

    assert.equal(plan.shouldInstall, true);
    assert.equal(plan.reason, "dependency_inputs_changed");
    assert.deepEqual(plan.changedInputs, ["server/package-lock.json"]);
    assert.equal(calls.length, 1);
    assert.equal(refreshResult.installed, true);
    assert.equal((await getRepoInstallPlan(scratchRoot)).shouldInstall, false);
  });

  it("skips npm entirely when the install marker already matches current inputs", async () => {
    const scratchRoot = await createScratchRepo();
    await installRepo({
      repoRoot: scratchRoot,
      runner: createInstallRunner([]),
      silent: true,
    });

    const calls = [];
    const result = await installRepo({
      repoRoot: scratchRoot,
      runner: async () => {
        calls.push("called");
        return 0;
      },
      silent: true,
    });

    assert.equal(result.installed, false);
    assert.deepEqual(calls, []);
  });
});
