#!/usr/bin/env node
/** Back-to-back engines in an isolated HOME. --stub is offline; --live is orchestrator-only. */
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const live = args.includes("--live");
const option = (key, fallback) => { const at = args.indexOf(key); return at >= 0 ? args[at + 1] : fallback; };
const count = Number(option("--jobs", live ? "10" : "2"));
if (!Number.isInteger(count) || count < 1) throw new Error("--jobs must be a positive integer");
const repo = fileURLToPath(new URL("../", import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = resolve(option("--out", join(repo, ".lane-evidence", "compare", stamp)));
const temporary = await mkdtemp(join(tmpdir(), "jb-lean-compare-"));
const originalHome = homedir();
// No user-owned files are read on the dry-run path.
if (live) await cp(option("--source-root", join(originalHome, ".jobbored")), join(temporary, ".jobbored"), { recursive: true, dereference: false });
process.env.HOME = temporary;
process.env.JOBBORED_PROFILE_PATH = join(temporary, ".jobbored", "profile.json");
process.env.JOBBORED_APPLICATIONS_ROOT = join(temporary, ".jobbored", "applications");
process.env.JOBBORED_EVAL = "1";
await mkdir(output, { recursive: true });
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const json = async path => JSON.parse(await readFile(path, "utf8"));
const maybeJson = async path => json(path).catch(() => null);
const pause = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const rows = [];
let child;
let baseUrl;
async function startApi() {
  const probe = createServer();
  await new Promise((ok, fail) => { probe.once("error", fail); probe.listen(0, "127.0.0.1", ok); });
  const port = probe.address().port;
  await new Promise(ok => probe.close(ok));
  if ([3847, 8080, 8644].includes(port)) return startApi();
  child = spawn(process.execPath, [join(repo, "server", "index.mjs")], { cwd: repo, env: { ...process.env, PORT: String(port), LISTEN_HOST: "127.0.0.1" }, stdio: "ignore" });
  baseUrl = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 120; n += 1) {
    if (child.exitCode !== null) throw new Error("Temporary API exited before health became ready");
    if (await fetch(`${baseUrl}/health`).then(r => r.ok).catch(() => false)) return;
    await pause(250);
  }
  throw new Error("Temporary API did not become ready");
}
async function runLive(job, engine, dest) {
  const dir = join(process.env.JOBBORED_APPLICATIONS_ROOT, job.slug);
  const posting = await readFile(join(dir, "job-description.md"), "utf8");
  const existing = await readdir(join(dir, "runs")).catch(() => []);
  const current = await maybeJson(join(dir, "run.json"));
  if (current?.cacheKey) { delete current.cacheKey; await writeFile(join(dir, "run.json"), JSON.stringify(current, null, 2) + "\n"); }
  const started = Date.now();
  const response = await fetch(`${baseUrl}/api/applications/${job.slug}/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: job.slug, company: job.company, title: job.title, feature: "both", engine, jobDescription: posting, resumeFrom: "snapshot" }) });
  if (!response.ok) throw new Error(`Compare request failed (${response.status}) for ${engine}`);
  await response.json();
  for (let n = 0; n < 2400; n += 1) {
    const pending = await maybeJson(join(dir, "pending.json"));
    if (!pending) break;
    await pause(250);
    if (n === 2399) throw new Error("Compare run deadline exceeded");
  }
  const created = (await readdir(join(dir, "runs"))).filter(id => !existing.includes(id));
  let runId;
  for (const id of created) {
    const candidate = await maybeJson(join(dir, "runs", id, "run.json"));
    if (candidate?.kind === "run") runId = id;
  }
  if (!runId) throw new Error("Compare request completed without a new immutable run");
  const runDir = join(dir, "runs", runId);
  const run = await json(join(runDir, "run.json"));
  if (run.engine !== engine && engine === "lean") throw new Error("Eval engine override did not reach the run");
  await cp(runDir, dest, { recursive: true });
  return { run, qa: await json(join(runDir, "qa.json")), elapsed: Date.now() - started, calls: run.stages.reduce((n, stage) => n + (stage.call?.attempts || (stage.llm ? 1 : 0)), 0), provenance: (await maybeJson(join(runDir, "lean.json")))?.provenance || [] };
}
async function runStub(job, engine, dest) {
  const fixture = await import("../tests/fixtures/lean/fixture.mjs");
  const { runPipeline } = await import("../server/materials-pipeline.mjs");
  const { deterministicExtract } = await import("../server/materials-jd-extract.mjs");
  const { leanQa } = await import("../server/materials-lean.mjs");
  const dir = join(temporary, job.slug, engine);
  await mkdir(dir, { recursive: true });
  const stub = fixture.provider();
  const counters = { extract: 0, write: 0, judge: 0 };
  const started = Date.now();
  const result = await runPipeline({ dir, runId: `${engine}-stub`, payload: { slug: job.slug, company: job.company, title: job.title, feature: "both", engine }, ledger: fixture.ledger, resumeText: fixture.resumeText, jdText: job.posting,
    jdSource: "paste", gate: { verdict: "usable", confidence: 1, signals: {} }, pin: fixture.pin, fetchImpl: stub.fetchImpl, voiceProfile: null, openSession: fixture.fakeSession, requirePdf: true,
    services: { resumeRead: fixture.resumeRead, resolveMaterialLogos: async () => ({ marks: [], targetMark: null }),
      extractJd: async input => { counters.extract += 1; return { extract: deterministicExtract(input), degraded: false }; },
      draftSlots: async ({ outline, ledger, feature }) => { counters.write += 1; return { draft: { contract: "materials.draft.v2", jdHash: "sha256:0", ledgerHash: ledger.ledgerHash, statement: feature === "resume" ? fixture.response().statement : "", bullets: feature === "resume" ? outline.featured.flatMap(g => g.claimIds).map(claimId => ({ claimId, text: ledger.claims.find(c => c.id === claimId).text })) : [], earlier: feature === "resume" ? outline.earlier.map(claimId => ({ claimId, text: ledger.claims.find(c => c.id === claimId).text })) : [], letter: feature === "cover_letter" ? fixture.letter : { hook: "", companyInsight: "", proof1: "", proof2: "", ask: "" } }, sourceRefs: [], degraded: false }; },
      judgeMaterials: async () => { counters.judge += 1; return { status: "ok", judgment: { documents: [] }, meta: { provider: "stub", model: "stub", promptVersion: "stub", latencyMs: 0 } }; },
      runHardGates: async () => [],
      buildQaRecord: input => leanQa({ ...input, disposition: "READY" }),
    },
  });
  await cp(join(dir, "runs", result.runId), dest, { recursive: true });
  return { run: await json(join(dest, "run.json")), qa: await json(join(dest, "qa.json")), elapsed: Date.now() - started, calls: engine === "lean" ? stub.requests.length : counters.extract + counters.write + counters.judge, provenance: (await maybeJson(join(dest, "lean.json")))?.provenance || [] };
}
try {
  let jobs;
  if (live) {
    const root = process.env.JOBBORED_APPLICATIONS_ROOT;
    const saved = await readdir(root, { withFileTypes: true });
    jobs = [];
    for (const entry of saved) if (entry.isDirectory() && /^[a-z0-9][a-z0-9-]{0,127}$/.test(entry.name)) {
      const manifest = await maybeJson(join(root, entry.name, "manifest.json"));
      const source = await maybeJson(join(root, entry.name, "resume-source.json"));
      const posting = await readFile(join(root, entry.name, "job-description.md"), "utf8").catch(() => "");
      if (manifest?.company && manifest?.title && source && posting.trim()) jobs.push({ slug: entry.name, company: manifest.company, title: manifest.title });
    }
    jobs = jobs.slice(0, count);
    if (jobs.length !== count) throw new Error(`Requested ${count} saved jobs; only ${jobs.length} have complete inputs`);
    await startApi();
  } else {
    const fixture = await import("../tests/fixtures/lean/fixture.mjs");
    const other = await readFile(new URL("../tests/fixtures/lean/posting-2.txt", import.meta.url), "utf8");
    jobs = Array.from({ length: count }, (_, i) => ({ slug: `fictional-${i + 1}`, company: i % 2 ? "Maple Transit" : "Harbor Fleet", title: "Operations Analyst", posting: i % 2 ? other : fixture.jdText }));
  }
  for (const job of jobs) {
    const results = {};
    for (const engine of ["legacy", "lean"]) {
      const dest = join(output, job.slug, engine);
      results[engine] = await (live ? runLive : runStub)(job, engine, dest);
    }
    const prose = results.lean.provenance.flatMap(p => p.facts.map(f => `<tr><td>${esc(p.field)}</td><td>${f.kind === "number" ? esc(f.token) : ""}</td><td>${f.kind === "name" ? esc(f.token) : ""}</td><td>${esc(p.text)}</td><td>${esc(f.sourceId)}: ${esc(f.source)}</td></tr>`)).join("\n");
    const stats = Object.entries(results).map(([engine, result]) => `<p>${engine}: ${result.qa.disposition}; ${result.elapsed}ms; ${result.calls} ${live ? "call attempts" : "stubbed stage calls"}${result.run.held ? "; Held" : ""}</p>`).join("\n");
    const documents = ["resume", "cover-letter"].map(doc => `<div class="pair"><section><h3>Legacy ${doc}</h3><iframe title="Legacy ${doc}" src="${job.slug}/legacy/${doc}.pdf"></iframe><a href="${job.slug}/legacy/${doc}.html">HTML</a></section><section><h3>Lean ${doc}</h3><iframe title="Lean ${doc}" src="${job.slug}/lean/${doc}.pdf"></iframe><a href="${job.slug}/lean/${doc}.html">HTML</a></section></div>`).join("\n");
    rows.push(`<article><h2>${esc(job.company)} · ${esc(job.title)}</h2>\n${stats}\n${documents}\n<details><summary>Lean checked number and name provenance</summary><table><thead><tr><th>Field</th><th>Numbers</th><th>Names</th><th>Draft prose</th><th>Resume source</th></tr></thead><tbody>${prose}</tbody></table></details></article>`);
  }
  const html = ['<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1">', '<title>TAILOR engine comparison</title>', '<style>body{font:16px system-ui;background:#f3f1ed;color:#1b1930;margin:24px}h1{font-family:Georgia}article{background:white;padding:24px;margin:24px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}iframe{width:100%;height:780px;border:1px solid #ccc}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ddd;text-align:left}details{margin:16px 0}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style>', '</head>', '<body>', '<h1>TAILOR · Legacy and lean</h1>', `<p>${live ? "Isolated copies of saved applications; metered provider calls." : "OFFLINE DRY RUN · Fictional inputs, stubbed providers and PDF sessions. Browser layout and live quality remain unverified."}</p>`, `<p>${count} jobs; engines run back to back for each job. Checked bullet facts appear below each pair.</p>`, ...rows, '</body>', '</html>', ''].join("\n");
  const path = join(output, "index.html"); await writeFile(path, html);
  console.log(`mode=${live ? "live" : "stub"} jobs=${count}`);
  console.log(`output=${relative(repo, path)}`);
  console.log("First 30 lines:"); console.log(html.split("\n").slice(0, 30).join("\n"));
} finally {
  if (child) { child.kill("SIGTERM"); await new Promise(ok => { if (child.exitCode !== null) ok(); else child.once("exit", ok); }); }
}
