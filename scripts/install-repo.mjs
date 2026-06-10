#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveNpmInvocation } from "./lib/spawn-npm.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = join(scriptDir, "..");
export const DEPENDENCY_INPUTS = [
  "package.json",
  "package-lock.json",
  "server/package.json",
  "server/package-lock.json",
];

const ROOT_NODE_MODULES = "node_modules";
const SERVER_NODE_MODULES = "server/node_modules";
const INSTALL_STAMP_FILE = ".repo-install-state.json";
const REQUIRED_NODE_MAJOR = 24;

function getInstallStampPath(repoRoot = REPO_ROOT) {
  return join(repoRoot, ROOT_NODE_MODULES, INSTALL_STAMP_FILE);
}

async function hashFile(filePath) {
  try {
    const contents = await readFile(filePath);
    return createHash("sha256").update(contents).digest("hex");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function buildDependencyFingerprint(repoRoot = REPO_ROOT) {
  const fingerprint = {};
  for (const relativePath of DEPENDENCY_INPUTS) {
    fingerprint[relativePath] = await hashFile(join(repoRoot, relativePath));
  }
  return fingerprint;
}

async function readInstallStamp(repoRoot = REPO_ROOT) {
  try {
    const raw = await readFile(getInstallStampPath(repoRoot), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== 1) return null;
    if (!parsed.inputs || typeof parsed.inputs !== "object") return null;
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    return null;
  }
}

function hasNodeModules(repoRoot = REPO_ROOT) {
  return {
    root: existsSync(join(repoRoot, ROOT_NODE_MODULES)),
    server: existsSync(join(repoRoot, SERVER_NODE_MODULES)),
  };
}

export function getNodeVersionCheck(version = process.version) {
  const match = /^v?(\d+)\./.exec(String(version || ""));
  const major = match ? Number(match[1]) : NaN;
  return {
    version,
    required: `>=${REQUIRED_NODE_MAJOR} <${REQUIRED_NODE_MAJOR + 1}`,
    ok: Number.isInteger(major) && major === REQUIRED_NODE_MAJOR,
  };
}

function assertNodeVersion() {
  const check = getNodeVersionCheck();
  if (check.ok) return;
  throw new Error(
    `Node ${check.required} is required; current runtime is ${check.version || "unknown"}.`,
  );
}

export async function getRepoInstallPlan(repoRoot = REPO_ROOT) {
  const stamp = await readInstallStamp(repoRoot);
  const inputs = await buildDependencyFingerprint(repoRoot);
  const modules = hasNodeModules(repoRoot);

  if (!modules.root && !modules.server) {
    return {
      shouldInstall: true,
      reason: "node_modules_missing",
      changedInputs: [],
      inputs,
    };
  }

  if (!modules.root) {
    return {
      shouldInstall: true,
      reason: "root_node_modules_missing",
      changedInputs: [],
      inputs,
    };
  }

  if (!modules.server) {
    return {
      shouldInstall: true,
      reason: "server_node_modules_missing",
      changedInputs: [],
      inputs,
    };
  }

  if (!stamp) {
    return {
      shouldInstall: true,
      reason: "install_marker_missing",
      changedInputs: [],
      inputs,
    };
  }

  const changedInputs = DEPENDENCY_INPUTS.filter(
    (relativePath) => stamp.inputs[relativePath] !== inputs[relativePath],
  );
  if (changedInputs.length) {
    return {
      shouldInstall: true,
      reason: "dependency_inputs_changed",
      changedInputs,
      inputs,
    };
  }

  return {
    shouldInstall: false,
    reason: "dependencies_fresh",
    changedInputs: [],
    inputs,
  };
}

function runCommand(command, args, { cwd }) {
  return new Promise((resolve, reject) => {
    // npm is a .cmd batch file on native Windows; resolve the shimmed
    // invocation so the prestart/predev hook works there too.
    const invocation = resolveNpmInvocation(command);
    const child = spawn(invocation.command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
      shell: invocation.shell,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// Normalize a runner's return into a numeric exit code. The default runCommand
// above (and most other internal callers) returns a number, but scripts/setup.mjs
// passes its own runCommand that resolves `{ status }` — accept both contracts so
// installRepo works through either runner. An unknown shape is treated as failure
// (1) so we never silently succeed on a malformed result.
function toExitCode(result) {
  if (typeof result === "number") return result;
  if (result && typeof result.status === "number") return result.status;
  return 1;
}

async function writeInstallStamp(repoRoot = REPO_ROOT, inputs) {
  const stampPath = getInstallStampPath(repoRoot);
  await mkdir(dirname(stampPath), { recursive: true });
  await writeFile(
    stampPath,
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        inputs,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function recordInstallStamp(repoRoot = REPO_ROOT) {
  assertNodeVersion();
  const fingerprint = await buildDependencyFingerprint(repoRoot);
  await writeInstallStamp(repoRoot, fingerprint);
  return { ok: true, inputs: fingerprint };
}

export async function installRepo({
  repoRoot = REPO_ROOT,
  runner = runCommand,
  silent = false,
} = {}) {
  assertNodeVersion();
  const plan = await getRepoInstallPlan(repoRoot);
  if (!plan.shouldInstall) {
    if (!silent) {
      console.log(
        `[install:repo] Dependencies already fresh (${plan.reason}).`,
      );
    }
    return { ...plan, installed: false };
  }

  if (!silent) {
    const detail = plan.changedInputs.length
      ? `: ${plan.changedInputs.join(", ")}`
      : "";
    console.log(`[install:repo] Running npm install (${plan.reason}${detail}).`);
  }

  let exitCode = toExitCode(await runner("npm", ["install"], { cwd: repoRoot }));
  if (exitCode !== 0) {
    throw new Error(`npm install exited with code ${exitCode}`);
  }

  if (!existsSync(join(repoRoot, SERVER_NODE_MODULES))) {
    if (!silent) {
      console.log(
        "[install:repo] Root install did not populate server/node_modules; running fallback install.",
      );
    }
    exitCode = toExitCode(
      await runner("npm", ["install", "--prefix", "./server"], {
        cwd: repoRoot,
      }),
    );
    if (exitCode !== 0) {
      throw new Error(`npm install --prefix ./server exited with code ${exitCode}`);
    }
  }

  const fingerprint = await buildDependencyFingerprint(repoRoot);
  await writeInstallStamp(repoRoot, fingerprint);
  return { ...(await getRepoInstallPlan(repoRoot)), installed: true };
}

function parseArgs(argv) {
  return {
    checkOnly: argv.includes("--check"),
    json: argv.includes("--json"),
    stampOnly: argv.includes("--stamp-only"),
  };
}

function isMainModule() {
  return process.argv[1]
    ? fileURLToPath(import.meta.url) === resolvePath(process.argv[1])
    : false;
}

if (isMainModule()) {
  const { checkOnly, json, stampOnly } = parseArgs(process.argv.slice(2));
  try {
    assertNodeVersion();
    const result = stampOnly
      ? await recordInstallStamp()
      : checkOnly
        ? await getRepoInstallPlan()
        : await installRepo();
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    console.error(
      `[install:repo] ${error && error.message ? error.message : error}`,
    );
    process.exitCode = 1;
  }
}
