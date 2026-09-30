#!/usr/bin/env node
/** Private scratch-only probe. Names and read evidence stay under INGEST_OUT. */
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(import.meta.url);
const repo = dirname(dirname(script));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const inside = (path, root) => path === root || path.startsWith(`${root}${sep}`);

// Resolve existing ancestors too, so a not-yet-created path through a symlink
// cannot bypass the real-home or repository boundary.
async function canonical(path) {
  let current = resolve(path);
  const tail = [];
  for (;;) {
    try { return join(await realpath(current), ...tail); }
    catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      if (dirname(current) === current) throw error;
      tail.unshift(relative(dirname(current), current));
      current = dirname(current);
    }
  }
}

async function repositoryRoots() {
  const roots = [await canonical(repo)];
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    roots.push(await canonical(dirname(resolve(repo, common))));
  } catch { /* This worktree's boundary remains enforced outside git. */ }
  return roots;
}

async function assertCopySafe(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Unsafe scratch HOME: symlinks are refused.");
    if (entry.isDirectory()) await assertCopySafe(join(root, entry.name));
  }
}

function pinnedKeys(raw) {
  const values = Array.isArray(raw) ? raw : raw?.keys || raw?.employers;
  if (!Array.isArray(values) || !values.length) throw new Error("Pinned keys must be a nonempty array outside the repo.");
  return values.map((value, index) => {
    const keys = typeof value === "string" ? [value] : value?.aliasKeys || value?.aliases || [value?.aliasKey];
    if (!Array.isArray(keys) || !keys.length || keys.some((key) => typeof key !== "string" || !key.trim())) throw new Error("Pinned keys are invalid.");
    return { label: `E${index + 1}`, keys: [...new Set(keys)] };
  });
}

async function spawnWorker({ mode, home, outputPath, jobPath }) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:JOBBORED_|HERMES_)/u.test(key)) delete env[key];
  Object.assign(env, { HOME: home, USERPROFILE: home,
    JOBBORED_PROFILE_PATH: join(home, ".jobbored", "profile.json"),
    JOBBORED_LLM_CONFIG_PATH: join(home, ".jobbored", "llm.json"),
    JOBBORED_APPLICATIONS_ROOT: join(home, ".jobbored", "applications"),
    INGEST_PROBE_WORKER: mode, INGEST_WORKER_OUT: outputPath, INGEST_JOB: jobPath,
  });
  await new Promise((done, fail) => {
    // Provider/drafter logs are discarded. Only the worker's evidence file is
    // consumed; neither raw provider errors nor names reach the terminal.
    execFile(process.execPath, [script], { env, cwd: repo, timeout: 900_000, maxBuffer: 16 * 1024 * 1024 }, (error) => {
      if (error) fail(new Error("Probe worker failed; no private diagnostic was printed.")); else done();
    });
  });
}

/** env is the public input; runWorker replaces only the isolated worker for offline tests. */
export async function runIngestLiveProbe(env = process.env, { runWorker = spawnWorker, stdout = (line) => process.stdout.write(`${line}\n`) } = {}) {
  for (const key of ["HOME", "INGEST_SCRATCH_HOME", "INGEST_PINNED_KEYS", "INGEST_JOB", "INGEST_OUT"]) {
    if (!env[key] || !isAbsolute(env[key])) throw new Error("Probe refuses missing or non-absolute input paths.");
  }
  const realHome = await canonical(userInfo().homedir);
  const [home, scratch, keysPath, jobPath, out] = await Promise.all([env.HOME, env.INGEST_SCRATCH_HOME, env.INGEST_PINNED_KEYS, env.INGEST_JOB, env.INGEST_OUT].map(canonical));
  for (const path of [home, scratch, out, keysPath, jobPath]) if (path === realHome || inside(path, join(realHome, ".jobbored"))) throw new Error("Unsafe real HOME or .jobbored path refused.");
  const roots = await repositoryRoots();
  if (roots.some((root) => [keysPath, out].some((path) => inside(path, root)))) throw new Error("Pinned keys and output must stay outside the repo.");
  if (inside(out, scratch) || inside(scratch, out) || inside(keysPath, out) || inside(jobPath, out)) throw new Error("Unsafe overlap between inputs and output refused.");
  const runsText = String(env.INGEST_RUNS ?? "5");
  const runs = Number(runsText);
  if (!/^[1-9]\d*$/u.test(runsText) || !Number.isSafeInteger(runs)) throw new Error("INGEST_RUNS must be a positive integer.");
  const pinned = pinnedKeys(JSON.parse(await readFile(keysPath, "utf8")));
  await readFile(jobPath, "utf8");
  await assertCopySafe(scratch);
  // Exclusive directory creation prevents overwriting another probe's evidence.
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out);
  const summary = { runs: [], passed: 0, draft: null };
  let draftHome;
  for (let index = 1; index <= runs; index += 1) {
    const dir = join(out, `read-${index}`);
    const copy = join(dir, "home");
    await mkdir(dir);
    await cp(scratch, copy, { recursive: true, errorOnExist: true, force: false });
    for (const name of ["claim-ledger.json", "ingest-result.json"]) {
      try { await rename(join(copy, ".jobbored", name), join(copy, ".jobbored", `${name}.before-probe`)); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const outputPath = join(dir, "worker-result.json");
    await runWorker({ mode: "read", home: copy, outputPath, jobPath });
    const evidence = JSON.parse(await readFile(outputPath, "utf8"));
    const ledger = evidence.ledger;
    const present = new Set((ledger?.employers || []).flatMap((employer) => employer.aliases || []));
    const keys = pinned.map((entry) => ({ label: entry.label, hash: hash(entry.keys[0]).slice(0, 8), present: entry.keys.every((key) => present.has(key)) }));
    const pass = ledger?.ingest?.status === "ready" && keys.every((key) => key.present);
    summary.runs.push({ run: index, pass, keys, textHash: String(ledger?.ingest?.textSha256 || "").slice(0, 8) });
    if (pass) summary.passed += 1;
    for (const entry of keys) stdout(`${entry.label} ${entry.present && pass ? "PASS" : "FAIL"} ${entry.hash}`);
    // Prefer a complete read for the package probe; fall back to the last
    // incomplete read so its named refusal can be captured as evidence.
    if (pass || !draftHome) draftHome = copy;
  }
  const draftDir = join(out, "draft");
  await mkdir(draftDir);
  const outputPath = join(draftDir, "worker-result.json");
  await runWorker({ mode: "draft", home: draftHome, outputPath, jobPath });
  summary.draft = JSON.parse(await readFile(outputPath, "utf8"));
  await writeFile(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

export async function runProbeWorker(deps = {}) {
  const home = process.env.HOME;
  // Even a manually invoked internal worker must pass the real-home guard.
  const realHome = await canonical(userInfo().homedir);
  if (!home || await canonical(home) === realHome || inside(await canonical(home), join(realHome, ".jobbored"))) throw new Error("Unsafe worker HOME refused.");
  if (!["read", "draft"].includes(process.env.INGEST_PROBE_WORKER)) throw new Error("Unsafe worker mode refused.");
  const destination = await canonical(process.env.INGEST_WORKER_OUT || "");
  const expected = process.env.INGEST_PROBE_WORKER === "read"
    ? join(dirname(home), "worker-result.json") : join(dirname(dirname(home)), "draft", "worker-result.json");
  if (destination !== await canonical(expected)) throw new Error("Unsafe worker evidence path refused.");
  process.env.JOBBORED_PROFILE_PATH = join(home, ".jobbored", "profile.json");
  process.env.JOBBORED_LLM_CONFIG_PATH = join(home, ".jobbored", "llm.json");
  process.env.JOBBORED_APPLICATIONS_ROOT = join(home, ".jobbored", "applications");
  if (inside(destination, join(realHome, ".jobbored")) || (await repositoryRoots()).some((root) => inside(destination, root))) throw new Error("Unsafe worker evidence path refused.");
  const { ensureLedger } = await import("../server/materials-ledger-build.mjs");
  const { readProfile } = await import("../server/user-profile.mjs");
  const { loadLlmConfig, resolveActivePin } = await import("../server/llm-config.mjs");
  const resumeText = await readFile(join(home, ".jobbored", "resume.txt"), "utf8");
  const pin = deps.pin || await resolveActivePin(loadLlmConfig());
  if (process.env.INGEST_PROBE_WORKER === "read") {
    const profile = await readProfile();
    const ledger = await ensureLedger({ profile: profile.ok ? profile.profile : null, resumeText, pin, fetchImpl: deps.fetchImpl || globalThis.fetch, callStage: deps.structureCallStage });
    const result = JSON.parse(await readFile(ledger.ingest.resultPath, "utf8"));
    await writeFile(destination, JSON.stringify({ ledger, result }, null, 2));
  } else {
    const { createMaterialsDrafter } = await import("../server/materials-drafter.mjs");
    const job = JSON.parse(await readFile(process.env.INGEST_JOB, "utf8"));
    if (!/^[a-z0-9][a-z0-9_-]*$/iu.test(job.slug)) throw new Error("Unsafe job slug refused.");
    const applicationsRoot = join(dirname(destination), "applications");
    const drafter = createMaterialsDrafter({ applicationsRoot, intel: false,
      loadPin: () => pin, resolvePin: async () => pin,
      fetchImpl: deps.fetchImpl || globalThis.fetch, structureCallStage: deps.structureCallStage,
      ...(Object.hasOwn(deps, "openSession") ? { openSession: deps.openSession } : {}),
      logoLoader: async () => [], employerLogoLoader: async () => [], targetLogoLoader: async () => null,
    });
    await drafter.enqueue({ ...job, resume: { source: "saved", filename: "resume.txt", text: resumeText, addedAt: new Date().toISOString() } });
    await drafter.runUntilIdle();
    const dir = join(applicationsRoot, job.slug);
    let pending = null;
    try { pending = JSON.parse(await readFile(join(dir, "pending.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    let model = null;
    try { model = JSON.parse(await readFile(join(dir, "render-model.json"), "utf8")); } catch { /* refused or no published model */ }
    const entries = (model?.documents?.resume?.sections || []).flatMap((section) => section.entries || []);
    await writeFile(destination, JSON.stringify({ ok: !pending && Boolean(model), pending, fittedEmployers: entries.map((entry) => entry.org).filter(Boolean), packageDir: dir }, null, 2));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.env.INGEST_PROBE_WORKER) await runProbeWorker();
    else {
      const result = await runIngestLiveProbe();
      if (result.passed !== result.runs.length || !result.draft?.ok) process.exitCode = 1;
    }
  } catch {
    process.stderr.write("Probe refused or failed. Private diagnostics were not printed.\n");
    process.exitCode = 1;
  }
}
