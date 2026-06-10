import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { runSetup } from "../scripts/setup.mjs";
import { resolveJobBoredPaths } from "../scripts/lib/paths.mjs";

async function createScratchRepo() {
  const root = await mkdtemp(join(tmpdir(), "jobbored-packaged-"));
  await mkdir(join(root, "integrations", "browser-use-discovery"), {
    recursive: true,
  });
  await writeFile(
    join(root, "config.example.js"),
    "window.COMMAND_CENTER_CONFIG = { sheetId: 'YOUR_SHEET_ID_HERE', oauthClientId: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com' };\n",
  );
  return root;
}

describe("packaged setup", () => {
  it("creates dashboard and discovery defaults under the packaged state home without secrets", async () => {
    const repoRoot = await createScratchRepo();
    const jobBoredHome = await mkdtemp(join(tmpdir(), "jobbored-home-"));
    const env = { JOBBORED_HOME: jobBoredHome };

    const report = await runSetup({
      mode: "discovery",
      repoRoot,
      env,
      skipInstall: true,
    });
    const paths = resolveJobBoredPaths({ env, repoRoot });

    assert.equal(report.paths.workerConfig, paths.workerConfig);
    assert.ok(existsSync(join(repoRoot, "config.js")));
    assert.ok(existsSync(paths.workerConfig));
    assert.ok(existsSync(paths.workerEnv));

    const workerConfig = JSON.parse(await readFile(paths.workerConfig, "utf8"));
    assert.equal(workerConfig.sheetId, "YOUR_SHEET_ID_HERE");
    assert.equal(workerConfig.schedule.enabled, false);

    const workerEnv = await readFile(paths.workerEnv, "utf8");
    assert.match(workerEnv, /BROWSER_USE_DISCOVERY_WORKER_CONFIG=/);
    assert.match(workerEnv, /BROWSER_USE_DISCOVERY_WORKER_ENV=/);
    assert.match(workerEnv, /BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=\n/);
    assert.doesNotMatch(workerEnv, /secret-value|ya29\.|AIza/);
  });

  it("installs optional Hermes into HERMES_JOB_HUNT_HOME and uses the configured applications dir", async () => {
    const repoRoot = await createScratchRepo();
    const hermesHome = await mkdtemp(join(tmpdir(), "hermes-home-"));
    const hermesJobHuntHome = join(hermesHome, "job-hunt");
    const hermesApplicationsDir = join(hermesHome, "materials");
    const calls = [];
    const runner = async (command, args) => {
      calls.push([command, ...args]);
      if (command === "python3" && args[0] === "-m" && args[1] === "venv") {
        await mkdir(join(hermesJobHuntHome, ".venv", "bin"), { recursive: true });
        await writeFile(join(hermesJobHuntHome, ".venv", "bin", "python"), "#!/bin/sh\n");
      }
      return { status: 0 };
    };

    await runSetup({
      mode: "hermes",
      repoRoot,
      env: {
        HERMES_HOME: hermesHome,
        HERMES_JOB_HUNT_HOME: hermesJobHuntHome,
        HERMES_APPLICATIONS_DIR: hermesApplicationsDir,
      },
      skipInstall: true,
      runner,
    });

    assert.ok(existsSync(hermesJobHuntHome));
    assert.ok(existsSync(join(hermesJobHuntHome, ".venv", "bin", "python")));
    assert.ok(existsSync(hermesApplicationsDir));
    assert.ok(existsSync(join(hermesJobHuntHome, "requirements.txt")));
    assert.deepEqual(calls[0].slice(0, 3), ["python3", "-m", "venv"]);
    assert.deepEqual(calls[1].slice(1, 4), ["-m", "pip", "install"]);
  });

  // Minimal distros (and odd PATHs) may not expose a `python3` binary. The
  // venv creation must fall back through the interpreter candidates instead
  // of dying on the first ENOENT.
  it("falls back to `python` when `python3` cannot create the Hermes venv", async () => {
    const repoRoot = await createScratchRepo();
    const hermesHome = await mkdtemp(join(tmpdir(), "hermes-home-"));
    const hermesJobHuntHome = join(hermesHome, "job-hunt");
    const calls = [];
    const runner = async (command, args) => {
      calls.push([command, ...args]);
      if (command === "python3") {
        return { status: 1, error: new Error("spawn python3 ENOENT") };
      }
      if (command === "python" && args[0] === "-m" && args[1] === "venv") {
        await mkdir(join(hermesJobHuntHome, ".venv", "bin"), { recursive: true });
        await writeFile(join(hermesJobHuntHome, ".venv", "bin", "python"), "#!/bin/sh\n");
      }
      return { status: 0 };
    };

    await runSetup({
      mode: "hermes",
      repoRoot,
      env: {
        HERMES_HOME: hermesHome,
        HERMES_JOB_HUNT_HOME: hermesJobHuntHome,
        HERMES_APPLICATIONS_DIR: join(hermesHome, "materials"),
      },
      skipInstall: true,
      runner,
    });

    assert.ok(existsSync(join(hermesJobHuntHome, ".venv", "bin", "python")));
    assert.deepEqual(calls[0].slice(0, 3), ["python3", "-m", "venv"]);
    assert.deepEqual(calls[1].slice(0, 3), ["python", "-m", "venv"]);
  });
});
