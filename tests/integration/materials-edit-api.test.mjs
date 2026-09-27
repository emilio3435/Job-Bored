import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { EventEmitter, once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import express from "../../server/node_modules/express/index.js";
import { commitModelAsRun } from "../../server/materials-regenerate.mjs";
import { createMaterialsVersionService, registerMaterialsEditRoutes } from "../../server/materials-versions.mjs";

const model = JSON.parse(readFileSync(new URL("../../docs/programs/editor-20260927/fixtures/model.json", import.meta.url), "utf8"));
const op = { opId: "o1", op: "replace", node: "line:beta", text: "Tracked shipments." };
const second = { opId: "o2", op: "replace", node: "b:acme:c14", text: "Measured carrier delays and reduced fulfillment delays 38%." };
let root;
let server;
let base;
let socketError;
let service;
let app;
let browserAvailable = true;
let releaseFetch;

const fetchImpl = async (_url, init) => {
  const request = JSON.parse(init.body);
  assert.match(request.messages[0].content, /materials\.edit\.v1/);
  if (request.messages[1].content.includes("wait for stop")) await new Promise((resolve) => { releaseFetch = resolve; });
  const ops = request.messages[1].content.includes("include blocked")
    ? [op, { opId: "o3", op: "replace", node: "stmt", text: "Short statement without the locked metric." }]
    : [op, second];
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ops }) } }] }) };
};
const pdfSession = async () => ({
  measure: async () => ({ fits: true, scrollHeight: 1056, clientHeight: 1056, lastTextBottom: 1000, limit: 1027, blockedRequests: 0 }),
  pdf: async (_html, path) => { await writeFile(path, "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n"); return { path, pages: 1, blockedRequests: 0 }; },
  rasterize: async (src) => src,
  close: async () => {},
});
const commit = (input, deps) => browserAvailable
  ? commitModelAsRun(input, { ...deps, pdfSession, critic: async () => ({ status: "pass", issues: [] }) })
  : Promise.reject(Object.assign(new Error("Browser unavailable"), { statusCode: 503, code: "browser_unavailable" }));

before(async () => {
  root = await mkdtemp(join(tmpdir(), "jb-editor-api-"));
  app = express();
  app.use(express.json());
  service = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" }, fetchImpl, commit });
  registerMaterialsEditRoutes(app, { service });
});
async function needsSocket(t) {
  if (base) return true;
  if (socketError) { t.skip(`ephemeral loopback unavailable: ${socketError?.code || socketError}`); return false; }
  try {
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  } catch (error) { socketError = error; }
  if (!base) { t.skip(`ephemeral loopback unavailable: ${socketError?.code || socketError}`); return false; }
  return true;
}
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (root) await rm(root, { recursive: true, force: true });
});

let sequence = 0;
async function seed() {
  const slug = `example-${++sequence}`;
  const dir = join(root, slug);
  const runDir = join(dir, "runs", "r0");
  await mkdir(runDir, { recursive: true });
  const run = { runId: "r0", slug, feature: "both", requestedAt: "2026-09-27T10:00:00.000Z", finishedAt: "2026-09-27T10:00:00.000Z", template: { family: "signal", source: "default" }, artifacts: [{ path: "resume.pdf", pages: 1 }] };
  for (const folder of [dir, runDir]) {
    await writeFile(join(folder, "run.json"), JSON.stringify(run));
    await writeFile(join(folder, "render-model.json"), JSON.stringify(model));
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ company: "Example", title: "Analyst", runId: "r0" }));
  await writeFile(join(dir, "resume.pdf"), "old PDF");
  return { slug, dir, path: `/api/applications/${slug}` };
}

async function request(path, method = "GET", body) {
  const response = await httpCall(path, method, body);
  return { status: response.status, data: response.status === 204 ? null : JSON.parse(response.text) };
}
function httpCall(path, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = httpRequest(`${base}${path}`, { method, headers: payload === null ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}
async function proposal(pkg, instruction = "Shorten the resume") {
  const started = await request(`${pkg.path}/edits`, "POST", { doc: "resume", baseRunId: "r0", instruction, scope: "all", lockFacts: true });
  assert.equal(started.status, 202);
  return started.data.proposalId;
}
async function stream(pkg, id) {
  const response = await httpCall(`${pkg.path}/edits/${id}/stream`);
  assert.equal(response.status, 200);
  return response.text.split("\n\n").filter((part) => part.startsWith("event: ")).map((part) => {
    const [, event, data] = /^event: ([^\n]+)\ndata: (.+)$/s.exec(part) || [];
    return { event, data: JSON.parse(data) };
  });
}

it("service path validates proposal, stream, commit, restore and stale PDF without loopback", async () => {
  const pkg = await seed();
  const safeDir = await service.dirFor(pkg.slug);
  const listed = await service.versions(safeDir, "resume");
  assert.equal(listed.versions[0].runId, "r0");
  assert.match((await service.preview(pkg.slug, { doc: "resume", baseRunId: "r0", ops: [op] })).html, /Tracked shipments\./);
  const started = await service.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten the resume", scope: "all", lockFacts: true });
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    chunks: [], writableEnded: false,
    setHeader() {}, flushHeaders() {},
    write(chunk) { this.chunks.push(chunk); },
    end() { this.writableEnded = true; this.emit("end"); },
  });
  const ended = once(res, "end");
  await service.stream(pkg.slug, started.proposalId, req, res);
  await ended;
  assert.match(res.chunks.join(""), /event: stage\ndata: {"stage":"reading"}/);
  assert.match(res.chunks.join(""), /event: done\ndata: {"status":"ready"}/);
  const accepted = await service.accept(pkg.slug, started.proposalId, { accept: ["o1"], confirmUnverified: [] });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.run.pdf, "ready");
  assert.equal((await service.versions(safeDir, "resume")).versions.length, 2);
  const restored = await service.restore(pkg.slug, "r0");
  assert.equal(restored.statusCode, 200);
  assert.equal((await service.versions(safeDir, "resume")).versions.length, 3);
  const last = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  assert.equal(last.restoredFrom, "r0");
  assert.equal(JSON.parse(await readFile(join(pkg.dir, "runs", "r0", "run.json"), "utf8")).runId, "r0");

  const stale = await seed();
  browserAvailable = false;
  try {
    const result = await service.accept(stale.slug, "", { doc: "resume", baseRunId: "r0", manualOps: [op] }, true);
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.run.pdf, "stale");
    assert.match(await readFile(join(stale.dir, "resume.html"), "utf8"), /Tracked shipments\./);
  } finally { browserAvailable = true; }
});

it("service SSE emits blocked shape and Stop retains validated partial ops", async () => {
  const pkg = await seed();
  const blocked = await service.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "include blocked", scope: "all", lockFacts: true });
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), { chunks: [], writableEnded: false, setHeader() {}, flushHeaders() {}, write(chunk) { this.chunks.push(chunk); }, end() { this.writableEnded = true; this.emit("end"); } });
  const ended = once(res, "end");
  await service.stream(pkg.slug, blocked.proposalId, req, res);
  await ended;
  const events = res.chunks.join("").split("\n\n").filter((part) => part.startsWith("event: ")).map((part) => {
    const [, event, data] = /^event: ([^\n]+)\ndata: (.+)$/s.exec(part);
    return { event, data: JSON.parse(data) };
  });
  assert.deepEqual(events.map((entry) => entry.event), ["stage", "stage", "stage", "op", "blocked", "stage", "proposal", "done"]);
  assert.equal(events.find((entry) => entry.event === "blocked").data.reason, "locked");
  assert.equal(events.find((entry) => entry.event === "blocked").data.op.opId, "o3");
  await service.reject(pkg.slug, blocked.proposalId);

  const partial = await service.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten the resume", scope: "all", lockFacts: true });
  let stopping;
  const partialRes = Object.assign(new EventEmitter(), {
    writableEnded: false, chunks: [],
    setHeader() {}, flushHeaders() {},
    write(chunk) { this.chunks.push(chunk); if (chunk.startsWith("event: op") && !stopping) stopping = service.stop(pkg.slug, partial.proposalId); },
    end() { this.writableEnded = true; this.emit("end"); },
  });
  const partialEnded = once(partialRes, "end");
  await service.stream(pkg.slug, partial.proposalId, new EventEmitter(), partialRes);
  await partialEnded;
  const stopped = await stopping;
  assert.equal(stopped.status, "partial");
  assert.equal(stopped.ops[0].opId, "o1");
  assert.match(partialRes.chunks.join(""), /event: done\ndata: {"status":"partial"}/);
});

it("GET versions and model expose immutable runs, nodes and 404 errors", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  const list = await request(`${pkg.path}/versions?doc=resume`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.versions.map((v) => [v.runId, v.n, v.pinned, v.source]), [["r0", 0, true, "draft"]]);
  assert.equal(list.data.currentRunId, "r0");
  assert.equal((await request(`${pkg.path}/versions?doc=wrong`)).status, 400);
  const selected = await request(`${pkg.path}/versions/r0/model`);
  assert.equal(selected.status, 200);
  assert.equal(selected.data.nodes.find((node) => node.id === "stmt").locked.spans.length, 1);
  assert.equal((await request(`${pkg.path}/versions/missing/model`)).status, 404);
});

it("POST preview renders base plus validated ops without a browser", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  const preview = await request(`${pkg.path}/preview`, "POST", { doc: "resume", baseRunId: "r0", ops: [op] });
  assert.equal(preview.status, 200);
  assert.match(preview.data.html, /Tracked shipments\./);
  assert.equal(preview.data.pageBudget, 1);
  assert.ok(preview.data.words > 0);
  const invalid = await request(`${pkg.path}/preview`, "POST", { doc: "resume", baseRunId: "r0", ops: [{ ...op, node: "seat:acme" }] });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, "locked");
});

it("POST edits enforces stale base and one open proposal; SSE event order and shape", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  assert.equal((await request(`${pkg.path}/edits`, "POST", { doc: "resume", baseRunId: "old", instruction: "edit", scope: "all", lockFacts: true })).data.code, "stale_base");
  assert.equal((await request(`${pkg.path}/edits`, "POST", { doc: "resume", baseRunId: "r0", instruction: "edit", scope: ["p:p1"], lockFacts: true })).data.code, "out_of_scope");
  const id = await proposal(pkg);
  assert.equal((await request(`${pkg.path}/edits`, "POST", { doc: "resume", baseRunId: "r0", instruction: "edit", scope: "all", lockFacts: true })).data.code, "materials_pending");
  assert.equal((await request(`${pkg.path}/edits/bad/stream`)).status, 400);
  const events = await stream(pkg, id);
  assert.deepEqual(events.map((e) => e.event), ["stage", "stage", "stage", "op", "op", "stage", "proposal", "done"]);
  assert.deepEqual(events.filter((e) => e.event === "stage").map((e) => e.data.stage), ["reading", "drafting", "checking", "measuring"]);
  assert.equal(events.at(-1).data.status, "ready");
  assert.equal(events.find((e) => e.event === "op").data.op.opId, "o1");
  assert.equal(events.find((e) => e.event === "proposal").data.summary.changes, 2);
});

it("POST stop retains partial ops and rejects an unknown proposal", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  const id = await proposal(pkg, "wait for stop");
  const pendingStream = stream(pkg, id);
  for (let i = 0; i < 100 && !releaseFetch; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(releaseFetch);
  const stopped = await request(`${pkg.path}/edits/${id}/stop`, "POST", {});
  assert.deepEqual(stopped.data, { status: "partial", ops: [] });
  releaseFetch(); releaseFetch = null;
  const events = await pendingStream;
  assert.equal(events.at(-1).data.status, "partial");
  assert.equal((await request(`${pkg.path}/edits/00000000-0000-0000-0000-000000000000/stop`, "POST", {})).status, 404);
});

it("POST accept writes selected ops as a new run and rejects unconfirmed or stale edits", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  const id = await proposal(pkg); await stream(pkg, id);
  assert.equal((await request(`${pkg.path}/edits/${id}/accept`, "POST", { accept: ["missing"], confirmUnverified: [] })).status, 400);
  const accepted = await request(`${pkg.path}/edits/${id}/accept`, "POST", { accept: ["o1"], confirmUnverified: [] });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.run.pdf, "ready");
  assert.equal(accepted.data.run.n, 1);
  const run = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  assert.equal(run.template.source, "edit");
  assert.deepEqual(run.edit.accepted, ["o1"]);
  assert.deepEqual(run.edit.rejected, ["o2"]);
  assert.equal((await request(`${pkg.path}/edits/${id}/accept`, "POST", { accept: ["o1"], confirmUnverified: [] })).data.code, "proposal_not_ready");
});

it("POST accept returns 503 browser_unavailable after saving HTML and a stale-PDF run", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  const id = await proposal(pkg); await stream(pkg, id);
  browserAvailable = false;
  try {
    const accepted = await request(`${pkg.path}/edits/${id}/accept`, "POST", { accept: ["o1"], confirmUnverified: [] });
    assert.equal(accepted.status, 503);
    assert.equal(accepted.data.code, "browser_unavailable");
    assert.equal(accepted.data.run.pdf, "stale");
    assert.match(await readFile(join(pkg.dir, "resume.html"), "utf8"), /Tracked shipments\./);
    assert.equal((await readFile(join(pkg.dir, "run.json"), "utf8")).includes('"source": "edit"'), true);
    assert.equal((await readFile(join(pkg.dir, "runs", "r0", "run.json"), "utf8")).includes('"runId":"r0"'), true);
  } finally { browserAvailable = true; }
});

it("DELETE proposal rejects all and leaves the run untouched", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed(); const id = await proposal(pkg);
  assert.equal((await request(`${pkg.path}/edits/${id}`, "DELETE")).status, 204);
  assert.equal((await request(`${pkg.path}/edits/${id}`, "DELETE")).status, 404);
  assert.equal(JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8")).runId, "r0");
});

it("POST manual saves a manual version and rejects cross-document ops", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  const bad = await request(`${pkg.path}/edits/manual`, "POST", { doc: "resume", baseRunId: "r0", manualOps: [{ opId: "m1", op: "replace", node: "sal", text: "Hello" }] });
  assert.equal(bad.data.code, "out_of_scope");
  const saved = await request(`${pkg.path}/edits/manual`, "POST", { doc: "resume", baseRunId: "r0", manualOps: [op] });
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8")).template.source, "manual");
});

it("POST restore appends a new run without deleting its source and errors on an unknown source", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  assert.equal((await request(`${pkg.path}/versions/missing/restore`, "POST", {})).status, 404);
  const restored = await request(`${pkg.path}/versions/r0/restore`, "POST", {});
  assert.equal(restored.status, 200);
  assert.equal(restored.data.run.restoredFrom, "r0");
  const run = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  assert.equal(run.template.source, "restore");
  assert.equal(run.restoredFrom, "r0");
  assert.equal(JSON.parse(await readFile(join(pkg.dir, "runs", "r0", "run.json"), "utf8")).runId, "r0");
  assert.equal((await request(`${pkg.path}/versions?doc=resume`)).data.versions.length, 2);
});

it("PUT star stores only stars in versions.json and keeps v0 pinned", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  assert.equal((await request(`${pkg.path}/versions/r0/star`, "PUT", { starred: false })).data.code, "pinned_version");
  const saved = await request(`${pkg.path}/edits/manual`, "POST", { doc: "resume", baseRunId: "r0", manualOps: [op] });
  const id = saved.data.run.runId;
  assert.deepEqual((await request(`${pkg.path}/versions/${id}/star`, "PUT", { starred: true })).data, { ok: true });
  assert.deepEqual(JSON.parse(await readFile(join(pkg.dir, "versions.json"), "utf8")), { stars: { [id]: true } });
  assert.equal((await request(`${pkg.path}/versions/${id}/star`, "PUT", { starred: "yes" })).status, 400);
});

it("all Scribe routes honor pending.json before edits", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  await writeFile(join(pkg.dir, "pending.json"), "{}");
  for (const [path, method, body] of [
    [`${pkg.path}/versions/r0/model`, "GET"],
    [`${pkg.path}/preview`, "POST", { doc: "resume", baseRunId: "r0" }],
    [`${pkg.path}/edits`, "POST", { doc: "resume", baseRunId: "r0", instruction: "edit", lockFacts: true }],
    [`${pkg.path}/versions/r0/restore`, "POST", {}],
    [`${pkg.path}/edits/manual`, "POST", { doc: "resume", baseRunId: "r0", manualOps: [op] }],
  ]) assert.equal((await request(path, method, body)).data.code, "materials_pending");
});
