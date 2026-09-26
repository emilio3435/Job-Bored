// BEAUDIT G7: side-effect-free /health identity fields for the discovery
// worker. Launchers (the dev server, the starter) kill or reuse only a
// worker whose repoRoot equals their own checkout; anything else is reported
// as foreign, never replaced. Mirrors the A14 router pattern: pure module,
// tested directly, wired in by server.ts.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkerEnvSources {
  /**
   * The runtime env file pointer the worker was given
   * (BROWSER_USE_DISCOVERY_WORKER_ENV / BROWSER_USE_DISCOVERY_ENV_FILE /
   * DISCOVERY_ENV_FILE), or null when the worker's built-in default applies.
   * A path, never a value.
   */
  runtimeEnvFile: string | null;
}

export interface WorkerIdentityFields {
  repoRoot: string;
  version: string;
  envSources: WorkerEnvSources;
}

/**
 * The repo root is derived from the server module's own URL, not from
 * process.cwd() — the worker must report where its CODE lives even when a
 * launcher started it with another cwd.
 */
export function resolveWorkerRepoRoot(serverModuleUrl: string): string {
  let dir = dirname(fileURLToPath(serverModuleUrl));
  // <repoRoot>/integrations/browser-use-discovery/src/server.ts
  for (let depth = 0; depth < 3; depth += 1) {
    dir = dirname(dir);
  }
  return dir;
}

/** The repo's package version. "" when the manifest cannot be read. */
export function resolveWorkerVersion(repoRoot: string): string {
  try {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof manifest?.version === "string" ? manifest.version : "";
  } catch {
    return "";
  }
}

type EnvRecord = Record<string, string | undefined>;

export function resolveWorkerEnvSources(env: EnvRecord): WorkerEnvSources {
  const explicit =
    ["BROWSER_USE_DISCOVERY_WORKER_ENV", "BROWSER_USE_DISCOVERY_ENV_FILE", "DISCOVERY_ENV_FILE"]
      .map((key) => String(env[key] || "").trim())
      .find(Boolean) || null;
  return { runtimeEnvFile: explicit };
}

export function resolveWorkerIdentityFields(
  serverModuleUrl: string,
  env: EnvRecord = process.env,
): WorkerIdentityFields {
  const repoRoot = resolveWorkerRepoRoot(serverModuleUrl);
  return {
    repoRoot,
    version: resolveWorkerVersion(repoRoot),
    envSources: resolveWorkerEnvSources(env),
  };
}
