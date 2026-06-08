#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { installRepo } from "./install-repo.mjs";
import { displayPath, resolveJobBoredPaths } from "./lib/paths.mjs";

const REPO_ROOT = resolvePath(fileURLToPath(new URL("..", import.meta.url)));
const HERMES_SOURCE_DIR = join(REPO_ROOT, "integrations", "hermes-job-hunt");

function step(level, name, message, details = {}) {
  return { level, name, message, details };
}

function shellValue(value) {
  return JSON.stringify(String(value || ""));
}

function parseArgs(argv) {
  const out = {
    mode: "dashboard",
    skipInstall: false,
    force: false,
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--skip-install") {
      out.skipInstall = true;
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "dashboard" || arg === "discovery" || arg === "hermes" || arg === "all") {
      out.mode = arg;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else {
      throw new Error(`Unknown setup argument: ${arg}`);
    }
  }
  return out;
}

function usage() {
  return `JobBored setup

Usage:
  npm run setup
  npm run setup:dashboard
  npm run setup:discovery
  npm run setup:hermes
  npm run setup:all

Options:
  --skip-install  Skip npm dependency refresh.
  --force         Refresh generated local files when safe.
  --json          Print machine-readable output.

Modes:
  dashboard  Install repo deps and create config.js if missing.
  discovery  Dashboard setup plus ~/.jobbored worker config/env defaults.
  hermes     Install optional Hermes job-hunt runtime under ~/.hermes/job-hunt.
  all        Run dashboard, discovery, and Hermes setup.
`;
}

async function writeFileIfMissing(pathname, contents, { force = false } = {}) {
  if (existsSync(pathname) && !force) return false;
  await mkdir(dirname(pathname), { recursive: true });
  await writeFile(pathname, contents, "utf8");
  return true;
}

async function ensureConfigJs(repoRoot, { force = false } = {}) {
  const target = join(repoRoot, "config.js");
  if (existsSync(target) && !force) {
    return step("ok", "config.js", "config.js already exists.");
  }
  const source = join(repoRoot, "config.example.js");
  const contents = await readFile(source, "utf8");
  await writeFileIfMissing(target, contents, { force });
  return step(
    force ? "ok" : "info",
    "config.js",
    `${force ? "Refreshed" : "Created"} config.js from config.example.js with placeholders.`,
  );
}

function defaultWorkerConfig() {
  return {
    sheetId: "YOUR_SHEET_ID_HERE",
    mode: "local",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    companies: [],
    includeKeywords: [],
    excludeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: 15,
    enabledSources: ["greenhouse", "lever", "ashby", "grounded_web", "serpapi_google_jobs"],
    schedule: { enabled: false, mode: "local" },
  };
}

function defaultWorkerEnv(paths) {
  return [
    "# JobBored local discovery worker env.",
    "# Keep real keys in this ignored local file; do not commit it.",
    `JOBBORED_REPO=${shellValue(paths.jobBoredRepo)}`,
    `JOBBORED_HOME=${shellValue(paths.jobBoredHome)}`,
    "BROWSER_USE_DISCOVERY_RUN_MODE=local",
    "BROWSER_USE_DISCOVERY_HOST=127.0.0.1",
    "BROWSER_USE_DISCOVERY_PORT=8644",
    `BROWSER_USE_DISCOVERY_WORKER_CONFIG=${shellValue(paths.workerConfig)}`,
    `BROWSER_USE_DISCOVERY_CONFIG_PATH=${shellValue(paths.workerConfig)}`,
    `BROWSER_USE_DISCOVERY_WORKER_ENV=${shellValue(paths.workerEnv)}`,
    `BROWSER_USE_DISCOVERY_ENV_FILE=${shellValue(paths.workerEnv)}`,
    `BROWSER_USE_DISCOVERY_STATE_DB_PATH=${shellValue(paths.workerStateDb)}`,
    `BROWSER_USE_DISCOVERY_BROWSER_COMMAND=${shellValue(
      join(
        paths.browserUseDiscoveryDir,
        "bin",
        "browser-use-agent-browser.mjs",
      ),
    )}`,
    "BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://localhost:8081,http://127.0.0.1:8081",
    "BROWSER_USE_DISCOVERY_ASYNC_ACK=true",
    "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=",
    "",
    "# Generic chat/JSON LLM tasks. OpenRouter and local use OpenAI-compatible /chat/completions.",
    "BROWSER_USE_DISCOVERY_LLM_PROVIDER=",
    "BROWSER_USE_DISCOVERY_LLM_API_KEY=",
    "BROWSER_USE_DISCOVERY_LLM_MODEL=",
    "BROWSER_USE_DISCOVERY_LLM_BASE_URL=",
    "BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY=",
    "BROWSER_USE_DISCOVERY_OPENROUTER_MODEL=openai/gpt-oss-120b:free",
    "BROWSER_USE_DISCOVERY_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1",
    "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_API_KEY=",
    "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_MODEL=",
    "BROWSER_USE_DISCOVERY_OPENAI_COMPATIBLE_BASE_URL=",
    "BROWSER_USE_DISCOVERY_LOCAL_API_KEY=",
    "BROWSER_USE_DISCOVERY_LOCAL_MODEL=",
    "BROWSER_USE_DISCOVERY_LOCAL_BASE_URL=",
    "",
    "# Optional Gemini key for Google-tool lanes: url_context and google_search grounding.",
    "BROWSER_USE_DISCOVERY_GEMINI_API_KEY=",
    "SERPAPI_API_KEY=",
    "BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE=",
    "",
  ].join("\n");
}

async function runCommand(command, args, { cwd, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });
    child.on("error", (error) => resolve({ status: 1, error }));
    child.on("close", (status) => resolve({ status: status ?? 1 }));
  });
}

async function runChecked(runner, command, args, options) {
  const result = await runner(command, args, options);
  if (result.status !== 0) {
    const rendered = [command, ...args].join(" ");
    throw new Error(`${rendered} exited with code ${result.status}`);
  }
}

async function setupDashboard({
  repoRoot = REPO_ROOT,
  env = process.env,
  skipInstall = false,
  force = false,
  runner = runCommand,
} = {}) {
  const paths = resolveJobBoredPaths({ env, repoRoot });
  const steps = [];
  if (skipInstall) {
    steps.push(step("info", "dependencies", "Skipped dependency install."));
  } else {
    const result = await installRepo({ repoRoot, runner, silent: true });
    steps.push(
      step(
        "ok",
        "dependencies",
        result.installed
          ? "Installed or refreshed npm dependencies."
          : "npm dependencies are already fresh.",
      ),
    );
  }
  await mkdir(paths.jobBoredHome, { recursive: true });
  steps.push(
    step(
      "ok",
      "state home",
      `Local JobBored state directory is ${displayPath(paths.jobBoredHome)}.`,
    ),
  );
  steps.push(await ensureConfigJs(repoRoot, { force: false }));
  return { paths, steps };
}

async function setupDiscovery({
  repoRoot = REPO_ROOT,
  env = process.env,
  skipInstall = false,
  force = false,
  runner = runCommand,
} = {}) {
  const result = await setupDashboard({
    repoRoot,
    env,
    skipInstall,
    force,
    runner,
  });
  const { paths, steps } = result;
  await mkdir(paths.workerHome, { recursive: true });
  const wroteConfig = await writeFileIfMissing(
    paths.workerConfig,
    `${JSON.stringify(defaultWorkerConfig(), null, 2)}\n`,
    { force },
  );
  steps.push(
    step(
      wroteConfig ? "info" : "ok",
      "worker config",
      `${wroteConfig ? "Created" : "Using"} ${displayPath(paths.workerConfig)}.`,
    ),
  );
  const wroteEnv = await writeFileIfMissing(paths.workerEnv, defaultWorkerEnv(paths), {
    force,
  });
  steps.push(
    step(
      wroteEnv ? "info" : "ok",
      "worker env",
      `${wroteEnv ? "Created" : "Using"} ${displayPath(paths.workerEnv)}.`,
    ),
  );
  return result;
}

function shouldCopyHermesEntry(source) {
  const rel = source.slice(HERMES_SOURCE_DIR.length + 1);
  if (!rel) return true;
  const parts = rel.split("/");
  return !parts.some((part) =>
    [".venv", "applications", "state", "evidence", "__pycache__", "tmp-app"].includes(part),
  );
}

async function setupHermes({
  repoRoot = REPO_ROOT,
  env = process.env,
  skipInstall = false,
  force = false,
  runner = runCommand,
} = {}) {
  const dashboard = await setupDiscovery({
    repoRoot,
    env,
    skipInstall,
    force,
    runner,
  });
  const { paths, steps } = dashboard;
  await mkdir(paths.hermesHome, { recursive: true });
  await cp(HERMES_SOURCE_DIR, paths.hermesJobHuntHome, {
    recursive: true,
    force,
    errorOnExist: false,
    filter: shouldCopyHermesEntry,
  });
  steps.push(
    step(
      "ok",
      "hermes home",
      `Hermes job-hunt runtime is ${displayPath(paths.hermesJobHuntHome)}.`,
    ),
  );
  for (const dir of [
    paths.hermesApplicationsDir,
    join(paths.hermesJobHuntHome, "state"),
    join(paths.hermesJobHuntHome, "evidence"),
  ]) {
    await mkdir(dir, { recursive: true });
  }
  steps.push(
    step(
      "ok",
      "materials folders",
      `Created/verified ${displayPath(paths.hermesApplicationsDir)}, state, and evidence folders.`,
    ),
  );

  // Seed profile inputs from their *.example.md templates on a fresh install,
  // without overwriting a user's real files (mirrors config.example.js -> config.js).
  // The materials drafter reads profile.md / voice.md / resume-bullets.md /
  // job-preferences.md / materials-quality.md; the real files are gitignored, so a
  // fresh clone only ships the templates.
  const profileDir = join(paths.hermesJobHuntHome, "profile");
  try {
    const entries = existsSync(profileDir) ? await readdir(profileDir) : [];
    let seeded = 0;
    for (const name of entries) {
      if (!name.endsWith(".example.md")) continue;
      const realPath = join(profileDir, name.replace(/\.example\.md$/, ".md"));
      if (!existsSync(realPath)) {
        await cp(join(profileDir, name), realPath, { force: false, errorOnExist: false });
        seeded += 1;
      }
    }
    steps.push(
      step(
        "ok",
        "profile seed",
        seeded
          ? `Seeded ${seeded} profile file(s) from *.example.md — edit them with your details.`
          : "Profile files already present; left them untouched.",
      ),
    );
  } catch {
    steps.push(
      step("warn", "profile seed", "Could not seed profile templates; copy profile/*.example.md → *.md manually."),
    );
  }

  const venvPython = join(paths.hermesJobHuntHome, ".venv", "bin", "python");
  if (!existsSync(venvPython)) {
    await runChecked(runner, "python3", ["-m", "venv", join(paths.hermesJobHuntHome, ".venv")], {
      cwd: repoRoot,
      env,
    });
    steps.push(step("ok", "hermes venv", "Created Hermes .venv."));
  } else {
    steps.push(step("ok", "hermes venv", "Hermes .venv already exists."));
  }
  await runChecked(
    runner,
    venvPython,
    ["-m", "pip", "install", "-r", join(paths.hermesJobHuntHome, "requirements.txt")],
    { cwd: repoRoot, env },
  );
  steps.push(step("ok", "hermes deps", "Installed Hermes Python requirements."));

  // Resolve resume logo marks (assets/logo-<slug>.png) from logos.json:
  // uploaded file > favicon (by domain) > omitted. Non-fatal — a missing or
  // blocked logo must never break setup; unresolved marks are simply dropped.
  const logoResolver = join(paths.hermesJobHuntHome, "scripts", "logo_resolver.py");
  if (existsSync(logoResolver)) {
    const logos = await runner(
      venvPython,
      [logoResolver, "--template-dir", join(paths.hermesJobHuntHome, "resume-template")],
      { cwd: repoRoot, env },
    );
    steps.push(
      step(
        logos.status === 0 ? "ok" : "warn",
        "resume logos",
        logos.status === 0
          ? "Resolved resume logo marks (assets/logo-*.png)."
          : "Some resume logos unresolved; the resume still renders (unavailable marks are dropped).",
      ),
    );
  }
  return dashboard;
}

export async function runSetup(options = {}) {
  const mode = options.mode || "dashboard";
  if (mode === "dashboard") return setupDashboard(options);
  if (mode === "discovery") return setupDiscovery(options);
  if (mode === "hermes") return setupHermes(options);
  if (mode === "all") {
    return setupHermes(options);
  }
  throw new Error(`Unsupported setup mode: ${mode}`);
}

function formatSetupReport(report) {
  const lines = ["JobBored setup"];
  for (const item of report.steps) {
    lines.push(`[${item.level}] ${item.name}: ${item.message}`);
  }
  lines.push("");
  lines.push("Next checks:");
  lines.push("  npm run doctor");
  lines.push("  npm run doctor:hermes  # only after optional Hermes setup");
  return `${lines.join("\n")}\n`;
}

function isMainModule() {
  return process.argv[1]
    ? fileURLToPath(import.meta.url) === resolvePath(process.argv[1])
    : false;
}

if (isMainModule()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(usage());
      process.exit(0);
    }
    const report = await runSetup(args);
    process.stdout.write(
      args.json ? `${JSON.stringify(report, null, 2)}\n` : formatSetupReport(report),
    );
  } catch (error) {
    console.error(`[setup] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}
