import assert from "node:assert/strict";
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

describe("repo validation surface", () => {
  it("routes manifest validation commands through shared repo scripts", async () => {
    const pkg = JSON.parse(
      await readFile(join(repoRoot, "package.json"), "utf8"),
    );
    const manifestCommands = readManifestCommands();

    assert.equal(pkg.scripts["install:repo"], "node scripts/install-repo.mjs");
    assert.equal(
      pkg.scripts["test:repo"],
      "npm run test:contract:all && node --test tests/*.test.mjs && npm run test:browser-use-discovery",
    );
    assert.equal(pkg.scripts["lint:repo"], "npm run lint:skills");
    assert.equal(
      pkg.scripts["typecheck:repo"],
      "node --check app.js && node --check dev-server.mjs && node --check discovery-wizard-local.js && node --check discovery-wizard-probes.js && node --check discovery-wizard-relay.js && node --check discovery-wizard-shell.js && node --check discovery-wizard-verify.js && node --check settings-tabs.js && node --check user-content-store.js && node --check resume-bundle.js && node --check resume-generate.js && node --check document-templates.js && node --check scripts/install-repo.mjs && node --check server/index.mjs && node --check server/job-scraper.mjs && node --check server/ats-scorecard.mjs",
    );

    assert.deepEqual(manifestCommands, {
      install: "npm run install:repo",
      test: "npm run test:repo",
      lint: "npm run lint:repo",
      typecheck: "npm run typecheck:repo",
    });
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
