#!/usr/bin/env node
/**
 * Stages the read-only app the desktop build ships (GFX R20, R24):
 * runtime files only, into desktop/app-bundle/ (gitignored).
 *
 *   node scripts/stage.mjs
 *
 * Sources come from `git ls-files`, so untracked files (config.js, .env,
 * uploads) can never ride along. Production deps are installed fresh with
 * `npm ci`/`install --omit=dev --ignore-scripts` into the stage, from the
 * repo's lockfiles. A self-check then
 * fails the stage if any test, doc, cache, env file, config.js or key file
 * made it in.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(DESKTOP_DIR, "..");
export const STAGE_DIR = join(DESKTOP_DIR, "app-bundle");

const ROOT_FILE = /^[^/]+\.(html|js|css|svg)$/;
const ROOT_EXTRA = new Set(["dev-server.mjs", "package.json", "package-lock.json", "CNAME", "LICENSE"]);
const RUNTIME_DIRS = [
  "assets/",
  "partials/",
  "templates/",
  "schemas/",
  "prompts/",
  "css/",
  "lib/",
  "vendor/",
  "server/",
  "integrations/browser-use-discovery/src/",
  "integrations/browser-use-discovery/bin/",
  "integrations/hermes-job-hunt/resume-template/",
  "integrations/hermes-job-hunt/cover-letter-template/",
  "integrations/hermes-job-hunt/scripts/",
  "scripts/lib/",
];
const RUNTIME_FILES = new Set(["integrations/browser-use-discovery/package.json"]);

const BANNED_SEGMENTS = new Set(["test", "tests", "__tests__", "docs", "coverage", ".lane-evidence", "screenshots", ".cache", ".github"]);
const KEY_FILE = [
  /\.(pem|key|p12|pfx|p8|cer|crt|keychain|keystore|jks|mobileprovision|provisionprofile)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/,
  /^\.(npmrc|netrc)$/,
  /^service-account.*\.json$/i,
  /token.*\.json$/i,
  /credentials?.*\.json$/i,
];

/**
 * Anything that must never be in the bundle.
 * @param {string} rel POSIX path relative to the stage
 */
export function isExcludedPath(rel) {
  const parts = rel.split("/");
  const base = parts[parts.length - 1];
  if (parts.some((p) => BANNED_SEGMENTS.has(p))) return true;
  if (base.startsWith(".env")) return true;
  if (rel === "config.js") return true;
  return KEY_FILE.some((re) => re.test(base));
}

/**
 * A tracked repo file the running app needs (scripts/*.mjs are added by
 * findScriptClosure instead).
 * @param {string} rel
 */
export function isRuntimeSource(rel) {
  if (isExcludedPath(rel)) return false;
  if (!rel.includes("/")) return ROOT_FILE.test(rel) || ROOT_EXTRA.has(rel);
  if (RUNTIME_FILES.has(rel)) return true;
  if (rel.endsWith(".md") && !rel.startsWith("prompts/")) return false;
  return RUNTIME_DIRS.some((dir) => rel.startsWith(dir));
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SCRIPT_JOIN_RE = /["']scripts["']\s*,\s*["']([\w.-]+\.mjs)["']/g;
const SCRIPT_LITERAL_RE = /["'](?:\.\/)?scripts\/([\w.-]+\.mjs)["']/g;

/**
 * The scripts/*.mjs the servers import or spawn, found by following relative
 * imports (static and dynamic) and `join(ROOT, "scripts", "x.mjs")` spawns
 * from dev-server.mjs, server/ and scripts/lib/.
 * @param {string} repoRoot
 * @param {string[]} tracked
 */
export function findScriptClosure(repoRoot, tracked = gitLsFiles(repoRoot)) {
  const trackedSet = new Set(tracked);
  const seeds = tracked.filter(
    (rel) => rel === "dev-server.mjs" || /^server\/.*\.m?js$/.test(rel) || /^scripts\/lib\/.*\.mjs$/.test(rel),
  );
  const closure = new Set(seeds.filter((rel) => rel.startsWith("scripts/")));
  const queue = [...seeds];
  const seen = new Set(queue);
  while (queue.length) {
    const rel = /** @type {string} */ (queue.shift());
    const text = readFileSync(join(repoRoot, rel), "utf8");
    const found = [];
    for (const m of text.matchAll(IMPORT_RE)) found.push(normalize(join(dirname(rel), m[1])));
    for (const m of text.matchAll(SCRIPT_JOIN_RE)) found.push(`scripts/${m[1]}`);
    for (const m of text.matchAll(SCRIPT_LITERAL_RE)) found.push(`scripts/${m[1]}`);
    for (const dep of found) {
      if (!trackedSet.has(dep) || seen.has(dep)) continue;
      seen.add(dep);
      if (dep.startsWith("scripts/")) {
        closure.add(dep);
        queue.push(dep);
      }
    }
  }
  return closure;
}

const BARE_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^./"'][^"']*)["']/g;
const PACKAGE_NAME_RE = /^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/;
const BUILTINS = new Set(builtinModules);

/**
 * Package names imported by the given files (builtins and non-names dropped).
 * @param {string} root
 * @param {string[]} files
 */
export function scanBareImports(root, files) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const rel of files) {
    for (const m of readFileSync(join(root, rel), "utf8").matchAll(BARE_IMPORT_RE)) {
      const spec = m[1];
      if (spec.startsWith("node:")) continue;
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!PACKAGE_NAME_RE.test(name) || BUILTINS.has(name)) continue;
      names.add(name);
    }
  }
  return names;
}

/**
 * The root dependencies the staged app needs. The root package.json lists
 * some runtime imports (the worker's ajv, ajv-formats) as devDependencies;
 * those are promoted here, at their locked versions, and an import declared
 * nowhere fails the stage.
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} pkg
 * @param {Set<string>} imports
 */
export function planRuntimeDependencies(pkg, imports) {
  const deps = { ...(pkg.dependencies ?? {}) };
  const dev = pkg.devDependencies ?? {};
  /** @type {string[]} */
  const promoted = [];
  /** @type {string[]} */
  const missing = [];
  for (const name of [...imports].sort()) {
    if (name.startsWith("node:") || BUILTINS.has(name) || Object.hasOwn(deps, name)) continue;
    if (Object.hasOwn(dev, name)) {
      deps[name] = dev[name];
      promoted.push(name);
    } else {
      missing.push(name);
    }
  }
  if (missing.length) throw new Error(`[stage] runtime imports not declared in package.json: ${missing.join(", ")}`);
  return { dependencies: deps, promoted };
}

/** Runtime files outside server/ (which has its own package.json). */
const ROOT_RUNTIME_CODE = /^(dev-server\.mjs|scripts\/.*\.mjs|integrations\/browser-use-discovery\/(src|bin)\/.*\.(m?js|ts))$/;

/** @param {string} repoRoot */
function gitLsFiles(repoRoot) {
  const out = spawnSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`);
  return out.stdout.split("\0").filter(Boolean);
}

/**
 * Every banned path in the stage (directories reported once, not descended).
 * @param {string} root
 * @returns {string[]}
 */
export function selfCheckStage(root) {
  /** @type {string[]} */
  const bad = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(root, full).split("\\").join("/");
      if (isExcludedPath(rel)) {
        bad.push(rel);
        continue;
      }
      if (lstatSync(full).isDirectory()) walk(full);
    }
  };
  walk(root);
  return bad;
}

/** Removes banned directories npm ci brought in (package tests, docs, caches). */
function pruneNodeModules(/** @type {string} */ root) {
  /** @param {string} dir */
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(root, full).split("\\").join("/");
      if (isExcludedPath(rel)) {
        rmSync(full, { recursive: true, force: true });
        continue;
      }
      if (lstatSync(full).isDirectory()) walk(full);
    }
  };
  for (const nm of ["node_modules", "server/node_modules"]) {
    if (existsSync(join(root, nm))) walk(join(root, nm));
  }
}

/** @param {string} prefix @param {"ci" | "install"} verb */
function npmProduction(prefix, verb) {
  const result = spawnSync(
    "npm",
    [verb, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", prefix],
    { stdio: "inherit", env: { ...process.env, npm_config_update_notifier: "false" } },
  );
  if (result.status !== 0) throw new Error(`npm ${verb} --omit=dev failed in ${prefix}`);
}

export function stage({ repoRoot = REPO_ROOT, dest = STAGE_DIR, log = console.error } = {}) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const tracked = gitLsFiles(repoRoot);
  const scripts = findScriptClosure(repoRoot, tracked);
  const files = tracked.filter((rel) => isRuntimeSource(rel) || (scripts.has(rel) && !isExcludedPath(rel)));
  for (const rel of files) {
    const from = join(repoRoot, rel);
    if (!existsSync(from) || !lstatSync(from).isFile()) continue;
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    copyFileSync(from, join(dest, rel));
  }
  log(`[stage] copied ${files.length} tracked files (${scripts.size} scripts/*.mjs in the closure)`);
  const rootPkgPath = join(dest, "package.json");
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
  const imports = scanBareImports(dest, files.filter((rel) => ROOT_RUNTIME_CODE.test(rel)));
  const plan = planRuntimeDependencies(rootPkg, imports);
  const { devDependencies: _dev, scripts: _scripts, ...rest } = rootPkg;
  writeFileSync(rootPkgPath, `${JSON.stringify({ ...rest, dependencies: plan.dependencies }, null, 2)}\n`);
  log(`[stage] root runtime deps: ${Object.keys(plan.dependencies).join(", ")}${plan.promoted.length ? ` (promoted from devDependencies: ${plan.promoted.join(", ")})` : ""}`);
  // `install`, not `ci`: the staged package.json differs from the lock's
  // root entry, but every version still comes from the copied lockfile.
  npmProduction(dest, "install");
  npmProduction(join(dest, "server"), "ci");
  pruneNodeModules(dest);
  const bad = selfCheckStage(dest);
  if (bad.length) {
    throw new Error(`[stage] self-check failed; excluded paths present:\n  ${bad.join("\n  ")}`);
  }
  log(`[stage] self-check ok: no tests, docs, caches, env files, config.js or keys in ${relative(repoRoot, dest)}`);
  return { files: files.length, scripts: [...scripts].sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    stage();
  } catch (err) {
    console.error(/** @type {Error} */ (err).message);
    process.exitCode = 1;
  }
}
