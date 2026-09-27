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

export const BOOTSTRAP_STATE_FILENAME = "discovery-local-bootstrap.json";

/** The desktop app marks every child it spawns with JOBBORED_DESKTOP=1. */
export function isDesktopRuntime(env = process.env) {
  return clean(env && env.JOBBORED_DESKTOP) === "1";
}

function jobBoredHomeFrom(env, cwd) {
  return expandUserPath(env.JOBBORED_HOME || DEFAULT_JOBBORED_HOME, { cwd });
}

function repoFile(env, repoRoot, cwd, filename) {
  const root = expandUserPath(repoRoot || env.JOBBORED_REPO || DEFAULT_JOBBORED_REPO, { cwd });
  return join(root, filename);
}

/**
 * discovery-local-bootstrap.json. JOBBORED_BOOTSTRAP_STATE_PATH wins; the
 * desktop app keeps it in ~/.jobbored (its bundle is read-only, GFX F3);
 * source mode keeps it at the repo root, as it always was. Every reader and
 * writer goes through here so the two can't disagree.
 */
export function bootstrapStatePath({
  env = process.env,
  repoRoot = "",
  cwd = process.cwd(),
} = {}) {
  const explicit = clean(env.JOBBORED_BOOTSTRAP_STATE_PATH);
  if (explicit) return expandUserPath(explicit, { cwd });
  if (isDesktopRuntime(env)) return join(jobBoredHomeFrom(env, cwd), BOOTSTRAP_STATE_FILENAME);
  return repoFile(env, repoRoot, cwd, BOOTSTRAP_STATE_FILENAME);
}

/**
 * The dashboard's config.js. Desktop: ~/.jobbored/desktop/config.js
 * (JOBBORED_DASHBOARD_CONFIG_PATH wins there). Source: <repo>/config.js.
 */
export function dashboardConfigPath({
  env = process.env,
  repoRoot = "",
  cwd = process.cwd(),
} = {}) {
  if (!isDesktopRuntime(env)) return repoFile(env, repoRoot, cwd, "config.js");
  const explicit = clean(env.JOBBORED_DASHBOARD_CONFIG_PATH);
  if (explicit) return expandUserPath(explicit, { cwd });
  return join(jobBoredHomeFrom(env, cwd), "desktop", "config.js");
}

/** Where dev-server caches its self-signed localhost certificate. */
export function tlsCacheDir({
  env = process.env,
  repoRoot = "",
  cwd = process.cwd(),
} = {}) {
  if (isDesktopRuntime(env)) return join(jobBoredHomeFrom(env, cwd), "tls");
  return repoFile(env, repoRoot, cwd, join("node_modules", ".cache", "command-center-dev-server"));
}
