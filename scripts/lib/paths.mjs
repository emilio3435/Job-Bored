import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_JOBBORED_REPO = join(homedir(), "Job-Bored");
export const DEFAULT_JOBBORED_HOME = join(homedir(), ".jobbored");
export const DEFAULT_HERMES_HOME = join(homedir(), ".hermes");

function clean(value) {
  return String(value || "").trim();
}

export function expandUserPath(raw, { cwd = process.cwd() } = {}) {
  const value = clean(raw);
  if (!value) return "";
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return resolve(cwd, value);
}

export function displayPath(pathname) {
  const value = clean(pathname);
  if (!value) return "";
  const home = homedir();
  if (value === home) return "~";
  if (value.startsWith(`${home}/`)) return `~/${value.slice(home.length + 1)}`;
  return value;
}

export function resolveJobBoredPaths({
  env = process.env,
  repoRoot = "",
  cwd = process.cwd(),
} = {}) {
  const jobBoredRepo = expandUserPath(
    env.JOBBORED_REPO || repoRoot || DEFAULT_JOBBORED_REPO,
    { cwd },
  );
  const jobBoredHome = expandUserPath(env.JOBBORED_HOME || DEFAULT_JOBBORED_HOME, {
    cwd,
  });
  const workerHome = expandUserPath(
    env.BROWSER_USE_DISCOVERY_WORKER_HOME ||
      join(jobBoredHome, "browser-use-discovery"),
    { cwd },
  );
  const browserUseDiscoveryDir = expandUserPath(
    env.BROWSER_USE_DISCOVERY_WORKER_DIR ||
      join(jobBoredRepo, "integrations", "browser-use-discovery"),
    { cwd },
  );
  const workerConfig = expandUserPath(
    env.BROWSER_USE_DISCOVERY_WORKER_CONFIG ||
      env.BROWSER_USE_DISCOVERY_CONFIG_PATH ||
      join(workerHome, "worker-config.json"),
    { cwd },
  );
  const workerEnv = expandUserPath(
    env.BROWSER_USE_DISCOVERY_WORKER_ENV ||
      env.BROWSER_USE_DISCOVERY_ENV_FILE ||
      join(workerHome, ".env"),
    { cwd },
  );
  const workerStateDb = expandUserPath(
    env.BROWSER_USE_DISCOVERY_STATE_DB_PATH ||
      join(workerHome, "worker-state.sqlite"),
    { cwd },
  );
  const hermesHome = expandUserPath(env.HERMES_HOME || DEFAULT_HERMES_HOME, {
    cwd,
  });
  const hermesJobHuntHome = expandUserPath(
    env.HERMES_JOB_HUNT_HOME || join(hermesHome, "job-hunt"),
    { cwd },
  );
  const hermesApplicationsDir = expandUserPath(
    env.HERMES_APPLICATIONS_DIR ||
      join(hermesJobHuntHome, "applications"),
    { cwd },
  );

  return {
    jobBoredRepo,
    jobBoredHome,
    browserUseDiscoveryDir,
    workerHome,
    workerConfig,
    workerEnv,
    workerStateDb,
    hermesHome,
    hermesJobHuntHome,
    hermesApplicationsDir,
  };
}
