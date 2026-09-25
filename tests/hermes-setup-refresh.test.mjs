// BEAUDIT H12 — `npm run setup:hermes` must refresh the Hermes code in the
// runtime copy (cron runs the runtime copy), while leaving the user's own
// files (profile, local contract override, state) alone.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runSetup } from "../scripts/setup.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hermesSource = join(repoRoot, "integrations", "hermes-job-hunt");

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), "hermes-setup-refresh-"));
  const scratchRepo = join(root, "repo");
  await mkdir(join(scratchRepo, "integrations", "browser-use-discovery"), { recursive: true });
  await writeFile(join(scratchRepo, "config.example.js"), "window.COMMAND_CENTER_CONFIG = {};\n");
  const hermesHome = join(root, ".hermes");
  const jobHunt = join(hermesHome, "job-hunt");
  const env = {
    JOBBORED_HOME: join(root, ".jobbored"),
    HERMES_HOME: hermesHome,
    HERMES_JOB_HUNT_HOME: jobHunt,
    HERMES_APPLICATIONS_DIR: join(jobHunt, "applications"),
  };
  const runner = async (command, args) => {
    if (args[0] === "-m" && args[1] === "venv") {
      await mkdir(join(jobHunt, ".venv", "bin"), { recursive: true });
      await writeFile(join(jobHunt, ".venv", "bin", "python"), "#!/bin/sh\n");
    }
    return { status: 0 };
  };
  return { scratchRepo, jobHunt, env, runner };
}

test("setup:hermes overwrites stale runtime scripts and the contract without --force", async () => {
  const box = await scratch();
  await mkdir(join(box.jobHunt, "scripts"), { recursive: true });
  await writeFile(join(box.jobHunt, "scripts", "gate2_telegram.py"), "THREAD_ID = 314  # stale runtime copy\n");
  await writeFile(join(box.jobHunt, "approval-contract.v1.json"), "{\"stale\": true}\n");

  await runSetup({ mode: "hermes", repoRoot: box.scratchRepo, env: box.env, skipInstall: true, runner: box.runner });

  const runtime = await readFile(join(box.jobHunt, "scripts", "gate2_telegram.py"), "utf8");
  const source = await readFile(join(hermesSource, "scripts", "gate2_telegram.py"), "utf8");
  assert.equal(runtime, source, "runtime gate2_telegram.py must match the repo copy");
  const contract = await readFile(join(box.jobHunt, "approval-contract.v1.json"), "utf8");
  assert.equal(contract, await readFile(join(hermesSource, "approval-contract.v1.json"), "utf8"));
});

test("setup:hermes keeps the user's profile and local contract override", async () => {
  const box = await scratch();
  await mkdir(join(box.jobHunt, "profile"), { recursive: true });
  await writeFile(join(box.jobHunt, "profile", "profile.md"), "# my real profile\n");
  await writeFile(join(box.jobHunt, "profile", "filler-profile.json"), "{\"mine\": true}\n");
  await writeFile(join(box.jobHunt, "approval-contract.local.json"), "{\"gate2\": {\"chatId\": 1}}\n");

  await runSetup({ mode: "hermes", repoRoot: box.scratchRepo, env: box.env, skipInstall: true, runner: box.runner });

  assert.equal(await readFile(join(box.jobHunt, "profile", "profile.md"), "utf8"), "# my real profile\n");
  assert.equal(await readFile(join(box.jobHunt, "profile", "filler-profile.json"), "utf8"), "{\"mine\": true}\n");
  assert.equal(
    await readFile(join(box.jobHunt, "approval-contract.local.json"), "utf8"),
    "{\"gate2\": {\"chatId\": 1}}\n",
  );
});

test("setup:hermes removes runtime copies of scripts deleted from the repo", async () => {
  const box = await scratch();
  await mkdir(join(box.jobHunt, "scripts", "ats_adapters"), { recursive: true });
  await writeFile(join(box.jobHunt, "scripts", "greenhouse_filler.py"), "# live submit, no gates\n");
  await writeFile(join(box.jobHunt, "scripts", "triage_pipeline.py"), "# bulk status writes\n");
  await writeFile(join(box.jobHunt, "scripts", "ats_adapters", "workday.py"), "# dead\n");

  await runSetup({ mode: "hermes", repoRoot: box.scratchRepo, env: box.env, skipInstall: true, runner: box.runner });

  assert.equal(existsSync(join(box.jobHunt, "scripts", "greenhouse_filler.py")), false);
  assert.equal(existsSync(join(box.jobHunt, "scripts", "triage_pipeline.py")), false);
  assert.equal(existsSync(join(box.jobHunt, "scripts", "ats_adapters")), false);
});
