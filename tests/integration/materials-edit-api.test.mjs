import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { EventEmitter, once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import express from "../../server/node_modules/express/index.js";
import { commitModelAsRun, regeneratePackage } from "../../server/materials-regenerate.mjs";
import { createMaterialsVersionService, registerMaterialsEditRoutes } from "../../server/materials-versions.mjs";
import { deriveNodes } from "../../server/materials-nodes.mjs";

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
let commitHold;

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
const commit = async (input, deps) => {
  if (commitHold) { commitHold.entered(); await commitHold.wait; }
  return browserAvailable
    ? commitModelAsRun(input, { ...deps, pdfSession, critic: async () => ({ status: "pass", issues: [] }) })
    : Promise.reject(Object.assign(new Error("Browser unavailable"), { statusCode: 503, code: "browser_unavailable" }));
};

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
async function seed(renderModel = model, feature = "both") {
  const slug = `example-${++sequence}`;
  const dir = join(root, slug);
  const runDir = join(dir, "runs", "r0");
  await mkdir(runDir, { recursive: true });
  const run = { runId: "r0", slug, feature, requestedAt: "2026-09-27T10:00:00.000Z", finishedAt: "2026-09-27T10:00:00.000Z", template: { family: "signal", source: "default" }, artifacts: [{ path: "resume.pdf", pages: 1 }] };
  for (const folder of [dir, runDir]) {
    await writeFile(join(folder, "run.json"), JSON.stringify(run));
    await writeFile(join(folder, "render-model.json"), JSON.stringify(renderModel));
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ company: "Example", title: "Analyst", runId: "r0" }));
  await writeFile(join(dir, "resume.pdf"), "old PDF");
  return { slug, dir, path: `/api/applications/${slug}` };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function fakeStream() {
  return Object.assign(new EventEmitter(), {
    chunks: [], writableEnded: false,
    setHeader() {}, flushHeaders() {},
    write(chunk) { this.chunks.push(chunk); },
    end() { if (this.writableEnded) return; this.writableEnded = true; this.emit("end"); },
  });
}
async function readyProposal(svc, pkg, scope = "all") {
  const started = await svc.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten the resume", scope, lockFacts: true });
  const res = fakeStream();
  const ended = once(res, "end");
  await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), res);
  await ended;
  return started.proposalId;
}

it("B2-1 claims start before yielding to a concurrent call", async () => {
  const first = await seed();
  const body = { doc: "resume", baseRunId: "r0", instruction: "Shorten the resume", scope: "all", lockFacts: true };
  const starts = await Promise.allSettled([service.start(first.slug, body), service.start(first.slug, body)]);
  assert.equal(starts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(starts.find((result) => result.status === "rejected")?.reason.code, "materials_pending");
});

it("B2-1 marks accept as accepting before publish and rejects a duplicate", async () => {
  const second = await seed();
  const id = await readyProposal(service, second);
  const entered = deferred();
  const release = deferred();
  commitHold = { entered: entered.resolve, wait: release.promise };
  let accepting;
  try {
    accepting = service.accept(second.slug, id, { accept: ["o1"], confirmUnverified: [] });
    await entered.promise;
    const stored = JSON.parse(await readFile(join(second.dir, "proposals", `${id}.json`), "utf8"));
    assert.equal(stored.status, "accepting");
    const duplicate = service.accept(second.slug, id, { accept: ["o1"], confirmUnverified: [] });
    const outcome = await Promise.race([duplicate.then(() => "accepted", (error) => error.code), new Promise((resolve) => setTimeout(() => resolve("waiting"), 200))]);
    assert.equal(outcome, "materials_pending");
    release.resolve();
    await accepting;
    await duplicate.catch(() => {});
    assert.equal((await service.versions(await service.dirFor(second.slug), "resume")).versions.length, 2);
  } finally { release.resolve(); if (accepting) await accepting.catch(() => {}); commitHold = null; }
});

it("B2-2 shares the publish claim with regenerate during accept", async () => {
  const pkg = await seed();
  const id = await readyProposal(service, pkg);
  const entered = deferred();
  const release = deferred();
  commitHold = { entered: entered.resolve, wait: release.promise };
  try {
    const accepting = service.accept(pkg.slug, id, { accept: ["o1"], confirmUnverified: [] });
    await entered.promise;
    await assert.rejects(regeneratePackage({ slug: pkg.slug, template: "dossier" }, { applicationsRoot: root, pdfSession, critic: async () => ({ status: "pass", issues: [] }) }), { statusCode: 409, code: "materials_pending" });
    release.resolve();
    await accepting;
    assert.equal((await service.versions(await service.dirFor(pkg.slug), "resume")).versions.length, 2);
  } finally { release.resolve(); commitHold = null; }
});

it("B2-2 rechecks the expected base inside the claimed publish section", async () => {
  const pkg = await seed();
  const { withPackagePublishClaim } = await import("../../server/materials-regenerate.mjs");
  assert.equal(typeof withPackagePublishClaim, "function");
  const current = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  await writeFile(join(pkg.dir, "run.json"), JSON.stringify({ ...current, runId: "r1" }));
  let wrote = false;
  await assert.rejects(withPackagePublishClaim(await service.dirFor(pkg.slug), "r0", async () => { wrote = true; }), { statusCode: 409, code: "stale_base" });
  assert.equal(wrote, false);
});

it("B2-3 reconnects to an in-flight stream through done and cleans up on response close", async () => {
  const pkg = await seed();
  releaseFetch = null;
  const started = await service.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "wait for stop", scope: "all", lockFacts: true });
  const first = fakeStream();
  const firstEnd = once(first, "end");
  await service.stream(pkg.slug, started.proposalId, new EventEmitter(), first);
  for (let i = 0; i < 100 && !releaseFetch; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(releaseFetch);
  const second = fakeStream();
  const secondEnd = once(second, "end");
  try {
    await service.stream(pkg.slug, started.proposalId, new EventEmitter(), second);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(second.writableEnded, false);
    assert.ok(second.listenerCount("close") > 0);
    const disconnected = fakeStream();
    await service.stream(pkg.slug, started.proposalId, new EventEmitter(), disconnected);
    disconnected.emit("close");
    assert.equal(disconnected.listenerCount("close"), 0);
    assert.equal(disconnected.writableEnded, false);
  } finally { releaseFetch(); releaseFetch = null; }
  await Promise.all([firstEnd, secondEnd]);
  assert.match(second.chunks.join(""), /event: done\ndata: {"status":"ready"}/);
});

it("B2-4 requires confirmation for manual facts absent from the ledger", async () => {
  const pkg = await seed();
  const invented = { opId: "m1", op: "replace", node: "line:beta", text: "Tracked 72 daily shipments for Kafka in 2025." };
  await assert.rejects(service.accept(pkg.slug, "", { doc: "resume", baseRunId: "r0", manualOps: [invented] }, true), { code: "unverified_confirmation_required" });
  const committed = await service.accept(pkg.slug, "", { doc: "resume", baseRunId: "r0", manualOps: [invented], confirmUnverified: ["m1"] }, true);
  assert.equal(committed.statusCode, 200);
  const run = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  assert.ok(run.edit.ops[0].facts.includes("72"));
  assert.ok(run.edit.ops[0].facts.includes("Kafka"));
  const insertPkg = await seed();
  const inventedClaim = { opId: "m2", op: "insert", after: "b:acme:c14", claimId: "unknown-claim", text: "Built a daily exception review." };
  await assert.rejects(service.accept(insertPkg.slug, "", { doc: "resume", baseRunId: "r0", manualOps: [inventedClaim] }, true), { code: "unverified_confirmation_required" });
});

it("B2-4 rechecks selected proposal ops even if their flags are absent", async () => {
  const pkg = await seed();
  const invented = { opId: "o9", op: "replace", node: "line:beta", text: "Tracked 72 daily shipments for Kafka in 2025." };
  const svc = createMaterialsVersionService({
    applicationsRoot: root,
    pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" },
    propose: async () => ({ ops: [invented], blocked: [], summary: { changes: 1, removals: 0, wordsDelta: 0, lossPct: 0, pages: 1, unverified: 0 } }),
    commit,
  });
  const id = await readyProposal(svc, pkg);
  await assert.rejects(svc.accept(pkg.slug, id, { accept: ["o9"], confirmUnverified: [] }), { code: "unverified_confirmation_required" });
  const saved = await svc.accept(pkg.slug, id, { accept: ["o9"], confirmUnverified: ["o9"] });
  assert.equal(saved.statusCode, 200);
  const run = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  assert.ok(run.edit.ops[0].facts.includes("Kafka"));
});

it("B2-5 applies proposal accept manualOps in the same saved run", async () => {
  const pkg = await seed();
  const id = await readyProposal(service, pkg);
  const manual = { opId: "m1", op: "replace", node: "b:acme:c14", text: "Measured carrier delays and reduced fulfillment delays 38%." };
  const result = await service.accept(pkg.slug, id, { accept: ["o1"], manualOps: [manual], confirmUnverified: [] });
  assert.equal(result.statusCode, 200);
  const run = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  assert.deepEqual(run.edit.accepted, ["o1", "m1"]);
  assert.deepEqual(run.edit.ops.map((entry) => entry.opId), ["o1", "m1"]);
  const saved = JSON.parse(await readFile(join(pkg.dir, "render-model.json"), "utf8"));
  assert.equal(saved.documents.resume.sections[0].entries[0].bullets[0].runs.map((run) => run.t ?? run.n ?? run.hl ?? "").join(""), manual.text);
});

it("B2-7 keeps v0 pinned without calling it starred", async () => {
  const pkg = await seed();
  const list = await service.versions(await service.dirFor(pkg.slug), "resume");
  assert.equal(list.versions[0].pinned, true);
  assert.equal(list.versions[0].starred, false);
});

it("B2-8 lets only one of a racing reject and accept finish", async () => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const pkg = await seed();
    const id = await readyProposal(service, pkg);
    const outcomes = await Promise.allSettled([
      service.reject(pkg.slug, id),
      service.accept(pkg.slug, id, { accept: ["o1"], confirmUnverified: [] }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal((await service.versions(await service.dirFor(pkg.slug), "resume")).versions.length, outcomes[1].status === "fulfilled" ? 2 : 1);
  }
});

it("B2-9 validates the proposal and manual edit as one shape-valid batch", async () => {
  const pkg = await seed();
  const svc = createMaterialsVersionService({
    applicationsRoot: root,
    pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" },
    propose: async () => ({ ops: [{ opId: "o1", op: "remove", node: "b:acme:c19" }], blocked: [], summary: { changes: 1, removals: 1, wordsDelta: -8, lossPct: 10, pages: 1, unverified: 0 } }),
    commit,
  });
  const id = await readyProposal(svc, pkg, ["b:acme:c19"]);
  const manual = { opId: "m1", op: "insert", after: "b:acme:c14", claimId: "replacement-claim", text: "Documented the team handoff process." };
  const result = await svc.accept(pkg.slug, id, { accept: ["o1"], manualOps: [manual], confirmUnverified: ["m1"] });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(await readFile(join(pkg.dir, "render-model.json"), "utf8"));
  assert.deepEqual(saved.documents.resume.sections[0].entries[0].bullets.map((bullet) => bullet.claimId), ["c14", "replacement-claim"]);
  const outside = await seed();
  const outsideId = await readyProposal(svc, outside, ["b:acme:c14"]);
  await assert.rejects(svc.accept(outside.slug, outsideId, { accept: ["o1"], manualOps: [manual], confirmUnverified: ["m1"] }), { statusCode: 400, code: "out_of_scope" });
});

it("B2-10 rejects a moved base after the publish claim is first read", async () => {
  const pkg = await seed();
  const id = await readyProposal(service, pkg);
  const entered = deferred();
  const release = deferred();
  commitHold = { entered: entered.resolve, wait: release.promise };
  let accepting;
  try {
    accepting = service.accept(pkg.slug, id, { accept: ["o1"], confirmUnverified: [] });
    await entered.promise;
    const current = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
    await writeFile(join(pkg.dir, "run.json"), JSON.stringify({ ...current, runId: "moved-during-render" }));
    release.resolve();
    await assert.rejects(accepting, { statusCode: 409, code: "stale_base" });
    assert.equal(JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8")).runId, "moved-during-render");
    assert.equal(await readFile(join(pkg.dir, "resume.pdf"), "utf8"), "old PDF");
  } finally { release.resolve(); if (accepting) await accepting.catch(() => {}); commitHold = null; }
});

it("B2-12 preserves a stranded accepting status until rejection removes it", async () => {
  const pkg = await seed();
  const id = randomUUID();
  await mkdir(join(pkg.dir, "proposals"));
  const path = join(pkg.dir, "proposals", `${id}.json`);
  await writeFile(path, JSON.stringify({ id, doc: "resume", baseRunId: "r0", status: "accepting", createdAt: new Date().toISOString(), ops: [], events: [] }));
  const cold = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" }, fetchImpl, commit });
  await assert.rejects(cold.accept(pkg.slug, id, { accept: ["o1"], confirmUnverified: [] }), { statusCode: 409, code: "proposal_not_ready" });
  assert.equal(JSON.parse(await readFile(path, "utf8")).status, "accepting");
  await cold.reject(pkg.slug, id);
  await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
  const next = await cold.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten the resume", scope: "all", lockFacts: true });
  assert.ok(next.proposalId);
});

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
  const acceptedQa = JSON.parse(await readFile(join(pkg.dir, "qa.resume.json"), "utf8"));
  assert.equal(acceptedQa.runId, accepted.body.run.runId);
  assert.equal(acceptedQa.contract, "materials.qa.v3");
  assert.equal(acceptedQa.state, "not_rescored");
  assert.equal(acceptedQa.disposition, null);
  assert.equal((await service.versions(safeDir, "resume")).versions.length, 2);
  const restored = await service.restore(pkg.slug, "r0");
  assert.equal(restored.statusCode, 200);
  assert.equal((await service.versions(safeDir, "resume")).versions.length, 3);
  const last = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  assert.equal(last.restoredFrom, "r0");
  assert.equal(JSON.parse(await readFile(join(pkg.dir, "qa.resume.json"), "utf8")).runId, last.runId);
  assert.equal(JSON.parse(await readFile(join(pkg.dir, "runs", "r0", "run.json"), "utf8")).runId, "r0");

  const stale = await seed();
  browserAvailable = false;
  try {
    const result = await service.accept(stale.slug, "", { doc: "resume", baseRunId: "r0", manualOps: [op] }, true);
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.run.pdf, "stale");
    assert.match(await readFile(join(stale.dir, "resume.html"), "utf8"), /Tracked shipments\./);
    const staleQa = JSON.parse(await readFile(join(stale.dir, "qa.resume.json"), "utf8"));
    assert.equal(staleQa.contract, "materials.qa.v3");
    assert.equal(staleQa.state, "not_rescored");
    assert.equal(staleQa.disposition, null);
    assert.ok(staleQa.gates.some(gate => gate.id === "pdf_unrendered" && gate.kind === "hard" && !gate.pass));
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
  assert.deepEqual(events.map((entry) => entry.event), ["stage", "stage", "stage", "stage", "op", "blocked", "stage", "proposal", "done"]);
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

async function persistSnapshot(path, snapshot) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(snapshot));
  await rename(temp, path);
}

function streamEvents(res) {
  return res.chunks.join("").split("\n\n").filter((part) => part.startsWith("event: ")).map((part) => {
    const [, event, data] = /^event: ([^\n]+)\ndata: (.+)$/s.exec(part);
    return { event, data: JSON.parse(data) };
  });
}

async function heldMeasuring({ fail = false, reconnectWhileHeld = false } = {}) {
  const pkg = await seed();
  const entered = deferred(), release = deferred(), claimed = deferred(), finished = deferred();
  let held = false;
  const terminalWrites = new Set();
  const svc = createMaterialsVersionService({ applicationsRoot: root,
    pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" },
    propose: async () => ({ ops: [op, { ...op }], blocked: [], summary: { changes: 1 }, factCheck: "model" }),
    onTransition: ({ to }) => { if (to === "partial") claimed.resolve(); },
    persistProposal: async (path, snapshot) => {
      snapshot = structuredClone(snapshot);
      if (!held && snapshot.events.at(-1)?.data.stage === "measuring") {
        held = true; entered.resolve(); await release.promise;
        if (fail) throw new Error("injected measuring failure");
      }
      await persistSnapshot(path, snapshot);
      if (snapshot.events.at(-1)?.event === "done") {
        const key = `${snapshot.status}:${snapshot.events.length}`;
        if (terminalWrites.has(key)) finished.resolve();
        terminalWrites.add(key);
      }
    },
  });
  const started = await svc.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten", lockFacts: true });
  const res = fakeStream();
  await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), res);
  await entered.promise;
  const stopping = svc.stop(pkg.slug, started.proposalId);
  await claimed.promise;
  if (reconnectWhileHeld) {
    const connected = deferred();
    const reconnect = fakeStream();
    reconnect.flushHeaders = connected.resolve;
    const joining = svc.stream(pkg.slug, started.proposalId, new EventEmitter(), reconnect);
    await connected.promise;
    try { assert.deepEqual(streamEvents(reconnect).filter((row) => row.event === "done"), []); }
    finally { release.resolve(); await joining; await stopping; }
  }
  release.resolve(); // Release the serialized writer before awaiting Stop.
  const stopped = await stopping;
  await finished.promise;
  const path = join(pkg.dir, "proposals", `${started.proposalId}.json`);
  return { pkg, svc, id: started.proposalId, res, stopped, stored: JSON.parse(await readFile(path, "utf8")) };
}

it("SCRP-B1 held-measuring Stop persists only partial and unique opIds", async () => {
  const { stored, stopped, res } = await heldMeasuring();
  const doneStatuses = stored.events.filter((row) => row.event === "done").map((row) => row.data.status);
  assert.deepEqual(doneStatuses, ["partial"]);
  assert.equal(stored.status, "partial");
  assert.equal(stopped.status, "partial");
  assert.equal(new Set(stored.ops.map((row) => row.opId)).size, stored.ops.length);
  assert.deepEqual(streamEvents(res).filter((row) => row.event === "done").map((row) => row.data.status), ["partial"]);
});

it("SCRP-B2 processing exception after Stop preserves partial; repeated Stop and reconnect agree", async () => {
  const { pkg, svc, id, stored, stopped } = await heldMeasuring({ fail: true });
  assert.equal(stored.status, "partial");
  assert.deepEqual(stored.events.filter((row) => row.event === "done").map((row) => row.data.status), ["partial"]);
  assert.deepEqual(await svc.stop(pkg.slug, id), stopped);
  const reconnected = fakeStream();
  await svc.stream(pkg.slug, id, new EventEmitter(), reconnected);
  assert.deepEqual(streamEvents(reconnected).filter((row) => row.event === "done").map((row) => row.data.status), ["partial"]);
  assert.equal(new Set(stored.ops.map((row) => row.opId)).size, stored.ops.length);
});

it("SCRP-B17 reconnect cannot replay a queued done before its snapshot persists", async () => {
  await heldMeasuring({ reconnectWhileHeld: true });
});

it("SCRP-B3 reject drains queued writes without resurrecting a proposal", async () => {
  const pkg = await seed();
  const entered = deferred(), release = deferred(), wrote = deferred(), claimed = deferred();
  const svc = createMaterialsVersionService({ applicationsRoot: root,
    pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" },
    onTransition: ({ to }) => { if (to === "rejected") claimed.resolve(); },
    persistProposal: async (path, snapshot) => {
      snapshot = structuredClone(snapshot);
      if (snapshot.events.length) { entered.resolve(); await release.promise; }
      await persistSnapshot(path, snapshot);
      if (snapshot.events.length) wrote.resolve();
    },
  });
  const started = await svc.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten", lockFacts: true });
  const res = fakeStream();
  await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), res);
  await entered.promise;
  const rejecting = svc.reject(pkg.slug, started.proposalId);
  await claimed.promise;
  // Both the reject and the queued writer settle before checking the file.
  release.resolve();
  await Promise.all([rejecting, wrote.promise]);
  await assert.rejects(readFile(join(pkg.dir, "proposals", `${started.proposalId}.json`)), { code: "ENOENT" });
  res.emit("close");
});

async function storedProposal(pkg, overrides = {}) {
  const id = randomUUID();
  const row = { id, doc: "resume", baseRunId: "r0", instruction: "Shorten", scope: "all", lockFacts: true, createdAt: new Date().toISOString(), status: "ready", ops: [op], events: [{ event: "blocked", data: { reason: "locked", detail: "Protected fact." } }], summary: { changes: 1 }, factCheck: "model", factCheckReason: "Checked.", targetPages: 1, chips: ["shorter"], dir: "private-path", profile: { private: true }, ...overrides };
  await mkdir(join(pkg.dir, "proposals"), { recursive: true });
  await writeFile(join(pkg.dir, "proposals", `${id}.json`), JSON.stringify(row));
  return row;
}

it("SCRP-B12 thrown SSE failures expose fixed code messages and no private exception text", async () => {
  for (const [code, expectedCode, message] of [
    ["network", "provider_failed", "The AI provider did not complete the request. Try again."],
    ["http_429", "rate_limited", "The AI provider is rate limited. Wait and try again."],
    ["writer_truncated", "reply_cut_off", "The AI reply was cut off. Try a smaller edit."],
    ["writer_blocked", "provider_refused", "The AI provider declined this edit. Try another instruction."],
    ["llm_unconfigured", "llm_unconfigured", "The AI model isn’t set up correctly. Check it in Settings, then try again."],
    ["ENOENT", "editor_failed", "Scribe could not complete this edit. Try again."],
  ]) {
    const pkg = await seed();
    const svc = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" }, propose: async () => { throw Object.assign(new Error("private payload /secret/path stack token=example"), { code }); } });
    const id = await readyProposal(svc, pkg);
    const stored = JSON.parse(await readFile(join(pkg.dir, "proposals", `${id}.json`), "utf8"));
    assert.deepEqual(stored.events.find((row) => row.event === "error").data, { code: expectedCode, message });
    assert.deepEqual(stored.events.filter((row) => row.event === "done").map((row) => row.data.status), ["failed"]);
    assert.doesNotMatch(JSON.stringify(stored.events), /private|secret|stack|token=/);
  }
});

it("SCRP-B19 recovery and replay project safe legacy blocked/error rows without writing them", async () => {
  const pkg = await seed();
  const row = await storedProposal(pkg, { events: [
    { event: "blocked", data: { reason: "invalid_model", detail: "private provider payload /secret/path", op: { opId: "old-1", node: "private/path", headers: { Authorization: "example" } } } },
    { event: "error", data: { code: "ENOENT", message: "private stack /secret/path" } },
    { event: "done", data: { status: "ready" } },
  ] });
  const path = join(pkg.dir, "proposals", `${row.id}.json`);
  const before = await readFile(path, "utf8");
  const open = await service.open(pkg.slug);
  assert.deepEqual(open.proposal.blocked, [{ op: { opId: "old-1" }, reason: "invalid_model", detail: "The suggested edit is not valid for this document." }]);
  const res = fakeStream(); await service.stream(pkg.slug, row.id, new EventEmitter(), res);
  assert.doesNotMatch(res.chunks.join(""), /private|secret|stack|Authorization|headers/);
  assert.equal(await readFile(path, "utf8"), before);
});

it("SCRP-B4 GET open projects safe fields across restart and sibling documents", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  const row = await storedProposal(pkg, { doc: "coverLetter" });
  const path = join(pkg.dir, "proposals", `${row.id}.json`);
  const before = await readFile(path, "utf8");
  const response = await request(`${pkg.path}/edits/open`);
  assert.equal(response.status, 200);
  const expected = { proposalId: row.id, doc: "coverLetter", baseRunId: "r0", instruction: "Shorten", scope: "all", lockFacts: true, createdAt: row.createdAt, status: "ready", ops: [op], blocked: [{ reason: "locked", detail: "This edit would change a protected fact." }], summary: row.summary, factCheck: "model", factCheckReason: "Checked." };
  assert.deepEqual(response.data, { proposal: expected });
  const restarted = createMaterialsVersionService({ applicationsRoot: root });
  assert.deepEqual(await restarted.open(pkg.slug), { proposal: expected });
  assert.equal(await readFile(path, "utf8"), before);
  await assert.rejects(service.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "edit", lockFacts: true }), { code: "materials_pending" });
});

it("SCRP-B5 GET open excludes finished empty and expired rows without filesystem changes", async (t) => {
  if (!(await needsSocket(t))) return;
  const missing = await seed();
  assert.deepEqual((await request(`${missing.path}/edits/open`)).data, { proposal: null });
  await assert.rejects(readdir(join(missing.dir, "proposals")), { code: "ENOENT" });
  const pkg = await seed();
  for (const status of ["accepted", "failed", "rejected"]) await storedProposal(pkg, { status });
  for (const status of ["ready", "partial"]) await storedProposal(pkg, { status, ops: [] });
  await storedProposal(pkg, { status: "pending", createdAt: "2000-01-01T00:00:00.000Z" });
  const files = await readdir(join(pkg.dir, "proposals"));
  assert.deepEqual((await request(`${pkg.path}/edits/open`)).data, { proposal: null });
  assert.deepEqual(await readdir(join(pkg.dir, "proposals")), files);
  for (const status of ["pending", "partial", "accepting"]) {
    const row = await storedProposal(pkg, { status });
    assert.equal((await request(`${pkg.path}/edits/open`)).data.proposal.status, status);
    await rm(join(pkg.dir, "proposals", `${row.id}.json`));
  }
});

it("SCRP-B6 GET open returns explicit multiple-open conflict and inherits path/auth guards", async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed();
  const rows = [await storedProposal(pkg), await storedProposal(pkg, { doc: "coverLetter", status: "partial" })];
  const response = await request(`${pkg.path}/edits/open`);
  assert.equal(response.status, 409);
  assert.equal(response.data.code, "multiple_open_proposals");
  assert.deepEqual(response.data.proposals.sort((a, b) => a.proposalId.localeCompare(b.proposalId)), rows.map(({ id, doc, status }) => ({ proposalId: id, doc, status })).sort((a, b) => a.proposalId.localeCompare(b.proposalId)));
  assert.equal((await request('/api/applications/bad%2Fslug/edits/open')).status, 400);
  const escape = await seed();
  await symlink(root, join(escape.dir, "proposals"));
  assert.equal((await request(`${escape.path}/edits/open`)).data.code, "path_escape");
  const guarded = express();
  guarded.use((_req, res) => res.status(401).json({ code: "unauthorized" }));
  registerMaterialsEditRoutes(guarded, { service });
  const listener = await new Promise((done) => { const handle = guarded.listen(0, "127.0.0.1", () => done(handle)); });
  try { assert.equal((await fetch(`http://127.0.0.1:${listener.address().port}${pkg.path}/edits/open`)).status, 401); }
  finally { await new Promise((done) => listener.close(done)); }
});

it("SCRP-B7 restarted pending stream resets ops and journal before reprocessing", async () => {
  const pkg = await seed();
  const row = await storedProposal(pkg, { status: "pending", events: [{ event: "op", data: { op: { ...op, text: "Old text." } } }, { event: "done", data: { status: "ready" } }] });
  const restarted = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" }, propose: async () => ({ ops: [op], blocked: [], summary: { changes: 1 }, factCheck: "model" }) });
  const res = fakeStream(); const ended = once(res, "end");
  await restarted.stream(pkg.slug, row.id, new EventEmitter(), res); await ended;
  const saved = JSON.parse(await readFile(join(pkg.dir, "proposals", `${row.id}.json`), "utf8"));
  assert.deepEqual(saved.ops, [op]);
  assert.deepEqual(streamEvents(res).filter((event) => event.event === "done").map((event) => event.data.status), ["ready"]);
  assert.deepEqual(saved.events.filter((event) => event.event === "done").map((event) => event.data.status), ["ready"]);
  assert.deepEqual(streamEvents(res).filter((event) => event.event === "op").map((event) => event.data.op.text), [op.text]);
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

it("legacy duplicate node ids do not block version history or read-only preview", async (t) => {
  if (!(await needsSocket(t))) return;
  const oldModel = structuredClone(model);
  const entries = oldModel.documents.resume.sections[0].entries;
  entries[0].line = "Built a planning tool.";
  entries.push({ employerId: entries[0].employerId, org: "Example", meta: [], line: "Led another project." });
  const pkg = await seed(oldModel);
  const nextRun = { runId: "r1", slug: pkg.slug, requestedAt: "2026-09-28T10:00:00.000Z", finishedAt: "2026-09-28T10:00:00.000Z", template: { family: "signal", source: "edit" } };
  await mkdir(join(pkg.dir, "runs", "r1"), { recursive: true });
  await writeFile(join(pkg.dir, "runs", "r1", "run.json"), JSON.stringify(nextRun));
  await writeFile(join(pkg.dir, "runs", "r1", "render-model.json"), JSON.stringify(model));
  await writeFile(join(pkg.dir, "run.json"), JSON.stringify(nextRun));

  const list = await request(`${pkg.path}/versions?doc=resume`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.versions.map((row) => row.runId), ["r1", "r0"]);
  assert.equal(list.data.currentRunId, "r1");
  assert.ok(list.data.versions.every((row) => row.words > 0));
  const letterList = await request(`${pkg.path}/versions?doc=cover_letter`);
  assert.equal(letterList.status, 200);
  assert.equal(letterList.data.versions.length, 2);

  const selected = await request(`${pkg.path}/versions/r0/model`);
  assert.equal(selected.status, 200);
  assert.deepEqual(selected.data.nodes, []);
  const preview = await request(`${pkg.path}/preview`, "POST", { doc: "resume", baseRunId: "r0", ops: [] });
  assert.equal(preview.status, 200);
  assert.ok(preview.data.html.startsWith("<!doctype html>"));
  assert.equal(preview.data.html.includes("data-node="), false);
  assert.ok(preview.data.words > 0);
  const letterPreview = await request(`${pkg.path}/preview`, "POST", { doc: "cover_letter", baseRunId: "r0" });
  assert.equal(letterPreview.status, 200);
  assert.ok(letterPreview.data.words > 0);
  const edited = await request(`${pkg.path}/preview`, "POST", { doc: "resume", baseRunId: "r0", ops: [op] });
  assert.equal(edited.status, 400);
  assert.equal(edited.data.code, "invalid_model");
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

it("POST preview renders valid draft models that fall outside edit shape limits", async (t) => {
  if (!(await needsSocket(t))) return;
  const cases = [
    ["resume short statement", "resume", (draft) => { draft.documents.resume.statement.runs = [{ t: "Staff analyst" }]; }],
    ["cover letter with a short resume statement", "cover_letter", (draft) => { draft.documents.resume.statement.runs = [{ t: "Staff analyst" }]; }],
    ["resume one bullet", "resume", (draft) => { draft.documents.resume.sections.find((section) => section.kind === "experience").entries[0].bullets.splice(1); }],
    ["resume no bullets", "resume", (draft) => { draft.documents.resume.sections.find((section) => section.kind === "experience").entries[0].bullets = []; }],
    ["cover letter one paragraph", "cover_letter", (draft) => { draft.documents.coverLetter.paragraphs.splice(1); }],
    ["cover letter two paragraphs", "cover_letter", (draft) => { draft.documents.coverLetter.paragraphs.splice(2); }],
  ];

  for (const [label, doc, alter] of cases) {
    const draft = structuredClone(model);
    alter(draft);
    const pkg = await seed(draft);
    for (const payload of [{ doc, baseRunId: "r0" }, { doc, baseRunId: "r0", ops: [] }]) {
      const preview = await request(`${pkg.path}/preview`, "POST", payload);
      assert.equal(preview.status, 200, `${label} should render without edit-shape validation: ${preview.data.code || preview.data.error || preview.status}`);
      assert.match(preview.data.html, /^<!doctype html>/);
      assert.ok(preview.data.words > 0, `${label} should return a useful word count`);
    }
  }
  const pkg = await seed();
  const invalid = await request(`${pkg.path}/preview`, "POST", { doc: "resume", baseRunId: "r0", ops: { length: 0 } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, "invalid_model");
  const malformedModel = structuredClone(model);
  malformedModel.contract = "wrong-contract";
  const malformedPkg = await seed(malformedModel);
  const malformedPreview = await request(`${malformedPkg.path}/preview`, "POST", { doc: "resume", baseRunId: "r0" });
  assert.equal(malformedPreview.status, 400);
  assert.equal(malformedPreview.data.code, "invalid_model");
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
  assert.deepEqual(events.map((e) => e.event), ["stage", "stage", "stage", "stage", "op", "op", "stage", "proposal", "done"]);
  assert.deepEqual(events.filter((e) => e.event === "stage").map((e) => e.data.stage), ["reading", "drafting", "checking facts", "checking", "measuring"]);
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

it("SCRP-B8 committed 503 accept manual restore include nonretryable run metadata; ordinary 503 stays ordinary", async () => {
  const pkg = await seed();
  const id = await readyProposal(service, pkg);
  browserAvailable = false;
  try {
    const accepted = await service.accept(pkg.slug, id, { accept: ["o1"], confirmUnverified: [] });
    const manual = await service.accept(pkg.slug, "", { doc: "resume", baseRunId: accepted.body.run.runId, manualOps: [{ ...op, text: "Tracked daily shipments." }] }, true);
    const restored = await service.restore(pkg.slug, "r0");
    for (const [index, result] of [accepted, manual, restored].entries()) {
      assert.equal(result.statusCode, 503);
      assert.equal(result.body.code, "browser_unavailable");
      assert.equal(result.body.run.pdf, "stale");
      assert.ok(result.body.run.runId);
      assert.equal(result.body.retryable, false);
      assert.equal(result.body.run.n, index + 1);
      assert.ok(result.body.versions.some((version) => version.runId === result.body.run.runId));
    }
    assert.equal(restored.body.run.restoredFrom, "r0");
  } finally { browserAvailable = true; }
  const restored = await service.restore(pkg.slug, "r0");
  assert.equal(restored.body.run.n, 4);
  assert.equal(restored.body.versions.length, 5);
  const ordinary = createMaterialsVersionService({ applicationsRoot: root, commit: async () => { throw Object.assign(new Error("Provider failed."), { statusCode: 503, code: "provider_failed" }); } });
  const before = await readFile(join(pkg.dir, "run.json"), "utf8");
  await assert.rejects(ordinary.restore(pkg.slug, "r0"), { statusCode: 503, code: "provider_failed" });
  assert.equal(await readFile(join(pkg.dir, "run.json"), "utf8"), before);
});

it("SCRP-B9 committed save preserves sibling PDF on success and browser failure for both docs", async () => {
  for (const [doc, stem, sibling, change] of [
    ["resume", "resume", "cover-letter", op],
    ["coverLetter", "cover-letter", "resume", { opId: "letter-edit", op: "replace", node: "p:p3", text: "I welcome a conversation about improving daily operations." }],
  ]) {
    for (const available of [true, false]) {
      const pkg = await seed();
      await writeFile(join(pkg.dir, `${sibling}.pdf`), "sibling PDF bytes");
      const beforeModel = JSON.parse(await readFile(join(pkg.dir, "render-model.json"), "utf8"));
      browserAvailable = available;
      try {
        const result = await service.accept(pkg.slug, "", { doc, baseRunId: "r0", manualOps: [change] }, true);
        assert.equal(result.statusCode, available ? 200 : 503);
        assert.equal(await readFile(join(pkg.dir, `${sibling}.pdf`), "utf8"), "sibling PDF bytes");
        const saved = JSON.parse(await readFile(join(pkg.dir, "render-model.json"), "utf8"));
        assert.deepEqual(saved.documents[doc === "resume" ? "coverLetter" : "resume"], beforeModel.documents[doc === "resume" ? "coverLetter" : "resume"]);
        if (!available) await assert.rejects(readFile(join(pkg.dir, `${stem}.pdf`)), { code: "ENOENT" });
      } finally { browserAvailable = true; }
    }
  }
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

it("SCRP-B14 manual returns 409 materials_pending for persisted same or sibling open proposals", async (t) => {
  if (!(await needsSocket(t))) return;
  for (const status of ["pending", "ready", "partial", "accepting"]) {
    for (const proposalDoc of ["resume", "coverLetter"]) {
      const pkg = await seed();
      const row = await storedProposal(pkg, { status, doc: proposalDoc });
      const runBefore = await readFile(join(pkg.dir, "run.json"), "utf8");
      const proposalBefore = await readFile(join(pkg.dir, "proposals", `${row.id}.json`), "utf8");
      const result = await request(`${pkg.path}/edits/manual`, "POST", { doc: "resume", baseRunId: "r0", manualOps: [op] });
      assert.equal(result.status, 409);
      assert.equal(result.data.code, "materials_pending");
      assert.equal(await readFile(join(pkg.dir, "run.json"), "utf8"), runBefore);
      assert.equal(await readFile(join(pkg.dir, "proposals", `${row.id}.json`), "utf8"), proposalBefore);
      await service.reject(pkg.slug, row.id);
      assert.equal((await request(`${pkg.path}/edits/manual`, "POST", { doc: "resume", baseRunId: "missing", manualOps: [op] })).data.code, "stale_base");
      const invented = { ...op, text: "Tracked 72 daily shipments for Kafka in 2025." };
      assert.equal((await request(`${pkg.path}/edits/manual`, "POST", { doc: "resume", baseRunId: "r0", manualOps: [invented] })).data.code, "unverified_confirmation_required");
      assert.equal((await request(`${pkg.path}/edits/manual`, "POST", { doc: "resume", baseRunId: "r0", manualOps: [op] })).status, 200);
    }
  }
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

it("SCRP-B10 restore adds n and versions for ready and stale PDFs", async () => {
  for (const available of [true, false]) {
    const pkg = await seed(); browserAvailable = available;
    try {
      const result = await service.restore(pkg.slug, "r0");
      assert.equal(result.body.run.n, 1);
      assert.equal(result.body.versions.length, 2);
      assert.equal(result.body.versions[0].runId, result.body.run.runId);
    } finally { browserAvailable = true; }
  }
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
    [`${pkg.path}/edits/open`, "GET"],
    [`${pkg.path}/versions/r0/model`, "GET"],
    [`${pkg.path}/preview`, "POST", { doc: "resume", baseRunId: "r0" }],
    [`${pkg.path}/edits`, "POST", { doc: "resume", baseRunId: "r0", instruction: "edit", lockFacts: true }],
    [`${pkg.path}/versions/r0/restore`, "POST", {}],
    [`${pkg.path}/edits/manual`, "POST", { doc: "resume", baseRunId: "r0", manualOps: [op] }],
  ]) assert.equal((await request(path, method, body)).data.code, "materials_pending");
});


it("edits historical single-document runs without validating an unrequested shell", async () => {
  for (const [feature, doc, other, change] of [
    ["resume", "resume", "coverLetter", op],
    ["cover_letter", "coverLetter", "resume", { opId: "letter-edit", op: "replace", node: "p:p1", text: "I build clear daily reports for operations teams." }],
  ]) {
    const legacy = structuredClone(model);
    if (other === "coverLetter") {
      legacy.documents.coverLetter.paragraphs = [];
      const entry = legacy.documents.resume.sections.find((section) => section.kind === "experience").entries[0];
      for (const claimId of ["c22", "c23", "c24"]) entry.bullets.push({ claimId, runs: [{ t: "Built clear daily reports." }] });
    }
    else legacy.documents.resume.statement.runs = [{ t: "Analyst" }];
    const pkg = await seed(legacy, feature);
    const svc = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" }, commit,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        const content = body.messages[0].content.includes("materials.fact-check.v1")
          ? [{ opId: change.opId, supported: true, reason: "Supported paraphrase." }] : { ops: [change] };
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
      },
    });
    const loaded = await svc.model(pkg.slug, "r0");
    assert.deepEqual(Object.keys(loaded.model.documents), [doc]);
    assert.equal((await svc.versions(await svc.dirFor(pkg.slug), other)).versions.length, 0, "shell is absent from document history");
    const started = await svc.start(pkg.slug, { doc, baseRunId: "r0", instruction: "Make the wording clearer", scope: "all", lockFacts: true });
    const res = fakeStream();
    const ended = once(res, "end");
    await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), res);
    await ended;
    const stored = JSON.parse(await readFile(join(pkg.dir, "proposals", `${started.proposalId}.json`), "utf8"));
    assert.deepEqual(stored.events.filter((e) => e.event === "blocked"), []);
    assert.equal(stored.ops.length, 1);
    const preview = await svc.preview(pkg.slug, { doc, baseRunId: "r0", ops: stored.ops });
    assert.ok(preview.html.includes(change.text));
    const accepted = await svc.accept(pkg.slug, started.proposalId, { accept: [change.opId], confirmUnverified: [] });
    assert.equal(accepted.statusCode, 200);
    const saved = await svc.model(pkg.slug, accepted.body.run.runId);
    assert.equal(saved.nodes.find((node) => node.id === change.node).text, change.text);
    assert.deepEqual(Object.keys(saved.model.documents), [doc]);
    assert.deepEqual(JSON.parse(await readFile(join(pkg.dir, "runs/r0/render-model.json"), "utf8")), legacy, "historical source remains immutable");
  }
});

it("all-scope proposals stay within the selected document", async () => {
  const pkg = await seed();
  const svc = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ops: [{ opId: "wrong-doc", op: "replace", node: "sal", text: "Hello team," }] }) } }] }) }),
  });
  const id = await readyProposal(svc, pkg);
  const stored = JSON.parse(await readFile(join(pkg.dir, "proposals", `${id}.json`), "utf8"));
  assert.deepEqual(stored.ops, []);
  assert.equal(stored.events.find((event) => event.event === "blocked").data.reason, "out_of_scope");
});


it("manual edits and restores retain the historical source document feature", async () => {
  const legacy = structuredClone(model);
  legacy.documents.coverLetter.paragraphs = [];
  const pkg = await seed(legacy, "resume");
  const svc = createMaterialsVersionService({ applicationsRoot: root, commit });
  const manual = await svc.accept(pkg.slug, "manual", { doc: "resume", baseRunId: "r0", manualOps: [op] }, true);
  assert.equal(manual.statusCode, 200);
  const current = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  current.feature = "both";
  await writeFile(join(pkg.dir, "run.json"), JSON.stringify(current));
  const restored = await svc.restore(pkg.slug, "r0");
  assert.equal(restored.statusCode, 200);
  const run = JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8"));
  assert.equal(run.feature, "resume");
  assert.deepEqual(Object.keys((await svc.model(pkg.slug, run.runId)).model.documents), ["resume"]);
});

it("keeps malformed requested documents and ambiguous both-document runs blocked", async () => {
  for (const feature of ["cover_letter", "both"]) {
    const malformed = structuredClone(model);
    malformed.documents.coverLetter.paragraphs = [];
    const pkg = await seed(malformed, feature);
    const svc = createMaterialsVersionService({ applicationsRoot: root, commit });
    const doc = feature === "cover_letter" ? "coverLetter" : "resume";
    const edit = feature === "cover_letter" ? { opId: "salutation", op: "replace", node: "sal", text: "Hello team," } : op;
    await assert.rejects(svc.preview(pkg.slug, { doc, baseRunId: "r0", ops: [edit] }), { reason: "invalid_model" });
  }
});


it("edits the latest version of either document after a sibling-only run", async () => {
  for (const [firstDoc, firstFeature, siblingDoc, siblingFeature, change] of [
    ["resume", "resume", "coverLetter", "cover_letter", op],
    ["coverLetter", "cover_letter", "resume", "resume", { opId: "letter-change", op: "replace", node: "p:p1", text: "I build clear daily reports for operations teams." }],
  ]) {
    const first = structuredClone(model);
    delete first.documents[siblingDoc];
    const pkg = await seed(first, firstFeature);
    const sibling = structuredClone(model);
    delete sibling.documents[firstDoc];
    const siblingRunDir = join(pkg.dir, "runs/r1");
    await mkdir(siblingRunDir);
    const laterRun = { runId: "r1", slug: pkg.slug, feature: siblingFeature, requestedAt: "2026-09-28T10:00:00.000Z", finishedAt: "2026-09-28T10:00:00.000Z", template: { family: "signal", source: "default" } };
    await writeFile(join(siblingRunDir, "render-model.json"), JSON.stringify(sibling));
    await writeFile(join(siblingRunDir, "run.json"), JSON.stringify(laterRun));
    await writeFile(join(pkg.dir, "run.json"), JSON.stringify(laterRun));
    const svc = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" }, commit,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        const content = body.messages[0].content.includes("materials.fact-check.v1")
          ? [{ opId: change.opId, supported: true, reason: "Supported paraphrase." }] : { ops: [change] };
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
      },
    });
    const listing = await svc.versions(await svc.dirFor(pkg.slug), firstDoc);
    assert.equal(listing.currentRunId, "r0");
    const started = await svc.start(pkg.slug, { doc: firstDoc, baseRunId: listing.currentRunId, instruction: "Clarify the wording", scope: "all", lockFacts: true });
    const res = fakeStream(); const ended = once(res, "end");
    await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), res); await ended;
    const accepted = await svc.accept(pkg.slug, started.proposalId, { accept: [change.opId], confirmUnverified: [] });
    assert.equal(accepted.statusCode, 200);
    const saved = await svc.model(pkg.slug, accepted.body.run.runId);
    assert.equal(saved.nodes.find((node) => node.id === change.node).text, change.text);
    const siblingListing = await svc.versions(await svc.dirFor(pkg.slug), siblingDoc);
    assert.equal(siblingListing.currentRunId, "r1", "sibling keeps its own model version");
    assert.deepEqual((await svc.model(pkg.slug, "r1")).model, sibling);
    await assert.rejects(svc.start(pkg.slug, { doc: firstDoc, baseRunId: "r0", instruction: "Edit again", scope: "all", lockFacts: true }), { code: "stale_base" });
  }
});

it("rejected repair versions cannot become the current editable document", async () => {
  const first = structuredClone(model); delete first.documents.coverLetter;
  const pkg = await seed(first, "resume");
  for (const [id, feature, adopted, day] of [["r1", "cover_letter", true, "28"], ["r2", "resume", false, "29"]]) {
    const m = structuredClone(model); delete m.documents[feature === "resume" ? "coverLetter" : "resume"];
    const run = { runId: id, slug: pkg.slug, feature, requestedAt: `2026-09-${day}T10:00:00.000Z`, finishedAt: `2026-09-${day}T10:00:00.000Z`, repair: { adopted }, template: { family: "signal", source: "default" } };
    const runDir = join(pkg.dir, "runs", id); await mkdir(runDir);
    await writeFile(join(runDir, "run.json"), JSON.stringify(run));
    await writeFile(join(runDir, "render-model.json"), JSON.stringify(m));
    if (adopted) await writeFile(join(pkg.dir, "run.json"), JSON.stringify(run));
  }
  const svc = createMaterialsVersionService({ applicationsRoot: root });
  const list = await svc.versions(await svc.dirFor(pkg.slug), "resume");
  assert.equal(list.currentRunId, "r0");
  assert.equal(list.versions.length, 2, "rejected repair remains viewable");
  await assert.rejects(svc.start(pkg.slug, { doc: "resume", baseRunId: "r2", instruction: "Edit rejected repair", scope: "all", lockFacts: true }), { code: "stale_base" });
});


it("allows retry after every proposed edit was blocked", async () => {
  const pkg = await seed();
  const svc = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ops: [{ opId: "blocked", op: "replace", node: "seat:acme", text: "Director" }] }) } }] }) }),
  });
  const blockedId = await readyProposal(svc, pkg);
  const stored = JSON.parse(await readFile(join(pkg.dir, "proposals", `${blockedId}.json`), "utf8"));
  assert.deepEqual(stored.ops, []);
  assert.equal(stored.status, "ready");
  const retry = await svc.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "Try a different edit", scope: "all", lockFacts: true });
  assert.ok(retry.proposalId);
  assert.notEqual(retry.proposalId, blockedId);
});

it("editing an older combined run preserves the newer sibling document", async () => {
  for (const [doc, siblingDoc, siblingFeature, change] of [
    ["resume", "coverLetter", "cover_letter", op],
    ["coverLetter", "resume", "resume", { opId: "letter-change", op: "replace", node: "p:p1", text: "I build clear daily reports for operations teams." }],
  ]) {
    const pkg = await seed();
    const sibling = structuredClone(model); delete sibling.documents[doc];
    if (siblingDoc === "coverLetter") sibling.documents.coverLetter.salutation = "Hello updated team,";
    else sibling.documents.resume.sections.find((s) => s.kind === "earlier").entries[0].line = "Updated daily reporting.";
    const dir = join(pkg.dir, "runs/r1"); await mkdir(dir);
    const run = { runId: "r1", slug: pkg.slug, feature: siblingFeature, requestedAt: "2026-09-28T10:00:00.000Z", finishedAt: "2026-09-28T10:00:00.000Z", template: { family: "signal", source: "default" } };
    await writeFile(join(dir, "run.json"), JSON.stringify(run));
    await writeFile(join(dir, "render-model.json"), JSON.stringify(sibling));
    await writeFile(join(pkg.dir, "run.json"), JSON.stringify(run));
    const siblingFile = siblingDoc === "resume" ? "resume.html" : "cover-letter.html";
    await writeFile(join(pkg.dir, siblingFile), "current sibling artifact");
    const svc = createMaterialsVersionService({ applicationsRoot: root, commit });
    const saved = await svc.accept(pkg.slug, "", { doc, baseRunId: "r0", manualOps: [change] }, true);
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(Object.keys((await svc.model(pkg.slug, saved.body.run.runId)).model.documents), [doc]);
    assert.equal((await svc.versions(await svc.dirFor(pkg.slug), siblingDoc)).currentRunId, "r1");
    assert.deepEqual((await svc.model(pkg.slug, "r1")).model, sibling);
    assert.equal(await readFile(join(pkg.dir, siblingFile), "utf8"), "current sibling artifact");
  }
});


it("edits a legacy two-paragraph letter using its existing sentences", async () => {
  const legacy = structuredClone(model); delete legacy.documents.resume;
  const letter = legacy.documents.coverLetter;
  const first = { id: "p1", beat: "thesis", text: "I build daily reports and reduced delays 38%. I turn clear data into useful decisions. I also built a daily exception review.", words: 24,
    links: [{ text: "daily reports", href: "https://example.com/reports" }] };
  const close = { id: "p1-split", beat: "next-step", text: "Could we compare one daily operations report?" };
  letter.paragraphs = [first, close];
  letter.pullQuote = { text: "I also built a daily exception review.", fromParagraph: first.id };
  const pkg = await seed(legacy, "cover_letter");
  const change = { opId: "letter-close", op: "replace", node: "p:p1-split", text: "Could we review one daily operations report?" };
  const svc = createMaterialsVersionService({ applicationsRoot: root, commit, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const content = body.messages[0].content.includes("materials.fact-check.v1")
        ? [{ opId: change.opId, supported: true, reason: "Supported paraphrase." }] : { ops: [change] };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
    },
  });
  const rawBefore = await readFile(join(pkg.dir, "runs/r0/render-model.json"), "utf8");
  const loaded = await svc.model(pkg.slug, "r0");
  assert.deepEqual(await svc.model(pkg.slug, "r0"), loaded, "normalization is idempotent");
  const normalized = loaded.model.documents.coverLetter;
  assert.equal(normalized.paragraphs.length, 3);
  assert.equal(new Set(normalized.paragraphs.map((p) => p.id)).size, 3);
  assert.equal(normalized.paragraphs.map((p) => p.text).join(" "), [first.text, close.text].join(" "));
  assert.equal(normalized.paragraphs.filter((p) => p.links?.length).length, 1);
  assert.deepEqual(normalized.paragraphs.find((p) => p.links?.length).links, first.links);
  const quoted = normalized.paragraphs.find((p) => p.id === normalized.pullQuote.fromParagraph);
  assert.ok(quoted.text.includes(normalized.pullQuote.text));
  for (const part of normalized.paragraphs.filter((p) => "words" in p)) assert.equal(part.words, part.text.trim().split(/\s+/).length);
  const metric = loaded.nodes.find((n) => n.text.includes("38%"));
  await assert.rejects(svc.preview(pkg.slug, { doc: "coverLetter", baseRunId: "r0", ops: [{ opId: "metric", op: "replace", node: metric.id, text: metric.text.replace("38%", "39%") }] }), { reason: "locked" });
  assert.ok((await svc.preview(pkg.slug, { doc: "coverLetter", baseRunId: "r0", ops: [change] })).html.includes(change.text));
  const started = await svc.start(pkg.slug, { doc: "coverLetter", baseRunId: "r0", instruction: "Make the close clearer", scope: "all", lockFacts: true });
  const res = fakeStream(); const ended = once(res, "end");
  await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), res); await ended;
  const proposed = JSON.parse(await readFile(join(pkg.dir, "proposals", `${started.proposalId}.json`), "utf8"));
  assert.equal(proposed.ops.length, 1);
  assert.deepEqual(proposed.events.filter((e) => e.event === "blocked"), []);
  const saved = await svc.accept(pkg.slug, started.proposalId, { accept: [change.opId], confirmUnverified: [] });
  assert.equal(saved.statusCode, 200);
  assert.equal((await svc.model(pkg.slug, saved.body.run.runId)).nodes.find((n) => n.id === change.node).text, change.text);
  assert.equal(await readFile(join(pkg.dir, "runs/r0/render-model.json"), "utf8"), rawBefore);
});

it("keeps unsplittable legacy letters and other invalid models blocked", async () => {
  const legacy = structuredClone(model); delete legacy.documents.resume;
  legacy.documents.coverLetter.paragraphs = [
    { id: "p1", beat: "thesis", text: "One unbroken sentence" },
    { id: "p2", beat: "next-step", text: "Another unbroken sentence" },
  ];
  const pkg = await seed(legacy, "cover_letter");
  const svc = createMaterialsVersionService({ applicationsRoot: root });
  await assert.rejects(svc.preview(pkg.slug, { doc: "coverLetter", baseRunId: "r0", ops: [{ opId: "close", op: "replace", node: "p:p2", text: "Another clear sentence" }] }), { reason: "invalid_model" });
});


it("legacy paragraph splitting preserves link labels and refuses ambiguous shapes", async () => {
  const blockedParagraphs = [
    [],
    [{ id: "p1", beat: "thesis", text: "I build reports. I review results. I act on findings." }],
    [{ id: "p1", beat: "thesis", text: "I build reports. I review results." }, { id: "p2", beat: "next-step", text: "" }],
    [{ id: "p1", beat: "thesis", text: "Mr. Rivera builds reports" }, { id: "p2", beat: "next-step", text: "No boundary here" }],
    [{ id: "p1", beat: "thesis", text: "I build reports. I review results.", links: [{ text: "I build reports. I review results.", href: "https://example.com/reports" }] }, { id: "p2", beat: "next-step", text: "No boundary here" }],
  ];
  for (const paragraphs of blockedParagraphs) {
    const legacy = structuredClone(model); delete legacy.documents.resume;
    legacy.documents.coverLetter.paragraphs = paragraphs;
    const pkg = await seed(legacy, "cover_letter");
    const svc = createMaterialsVersionService({ applicationsRoot: root });
    await assert.rejects(svc.preview(pkg.slug, { doc: "coverLetter", baseRunId: "r0", ops: [{ opId: "sal", op: "replace", node: "sal", text: "Dear hiring team," }] }), { reason: "invalid_model" });
  }
  for (const feature of ["both", "unknown"]) {
    const legacy = structuredClone(model);
    legacy.documents.coverLetter.paragraphs = [
      { id: "p1", beat: "thesis", text: "I build reports. I review results." },
      { id: "p2", beat: "next-step", text: "Could we compare notes?" },
    ];
    const pkg = await seed(legacy, feature);
    const svc = createMaterialsVersionService({ applicationsRoot: root });
    await assert.rejects(svc.preview(pkg.slug, { doc: "coverLetter", baseRunId: "r0", ops: [{ opId: "sal", op: "replace", node: "sal", text: "Dear hiring team," }] }), { reason: "invalid_model" });
  }
});


it("SCRP-B21 R1-#1 regenerate merges each document's current run after single-document saves", async () => {
  for (const savedDocs of [["resume"], ["coverLetter"], ["resume", "coverLetter"]]) {
    const pkg = await seed();
    for (const doc of savedDocs) {
      await service.accept(pkg.slug, "", { doc, baseRunId: "r0", manualOps: [doc === "resume" ? op : {
        opId: "letter-edit", op: "replace", node: "p:p3", text: "I welcome a conversation about improving daily operations.",
      }], confirmUnverified: [] }, true);
    }
    const sources = {};
    for (const doc of ["resume", "coverLetter"]) {
      const listing = await service.versions(pkg.dir, doc);
      sources[doc] = (await service.model(pkg.slug, listing.currentRunId)).model.documents[doc];
      sources[doc].templateId = doc === "resume" ? "dossier.resume" : "dossier.letter";
    }
    const result = await regeneratePackage({ slug: pkg.slug, template: "dossier" }, {
      applicationsRoot: root, pdfSession, critic: async () => ({ status: "pass", issues: [] }),
      targetLogoLoader: async () => null, employerLogoLoader: async () => [], readSavedResume: async () => null,
    });
    assert.deepEqual(result.template.templateIds, { resume: "dossier.resume", coverLetter: "dossier.letter" });
    const published = JSON.parse(await readFile(join(pkg.dir, "render-model.json"), "utf8"));
    assert.deepEqual(published.documents, sources);
    assert.equal(JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8")).feature, "both");
    for (const stem of ["resume", "cover-letter"]) assert.match(await readFile(join(pkg.dir, `${stem}.html`), "utf8"), /data-family="dossier"/);
  }
});


it("SCRP-B22 R1-#2+#3 D19 letter restore has its own numbering and leaves the resume byte-equal", async (t) => {
  if (!(await needsSocket(t))) return;
  for (const available of [true, false]) {
    const pkg = await seed();
    const saved = await service.accept(pkg.slug, "", { doc: "resume", baseRunId: "r0", manualOps: [op], confirmUnverified: [] }, true);
    const before = {};
    for (const name of ["resume.html", "resume.pdf", "resume.txt", "qa.resume.json"]) before[name] = await readFile(join(pkg.dir, name));
    const original = await readFile(join(pkg.dir, "runs", "r0", "render-model.json"));
    const resumeList = await service.versions(pkg.dir, "resume");
    browserAvailable = available;
    let restored;
    try { restored = await request(`${pkg.path}/versions/r0/restore`, "POST", { doc: "cover_letter" }); }
    finally { browserAvailable = true; }
    assert.equal(restored.status, available ? 200 : 503);
    assert.equal(restored.data.run.n, 1);
    assert.deepEqual(restored.data.versions.map((row) => row.source), ["restore", "draft"]);
    assert.equal(restored.data.versions[0].runId, restored.data.run.runId);
    assert.deepEqual(await service.versions(pkg.dir, "resume"), resumeList);
    assert.equal((await service.versions(pkg.dir, "resume")).currentRunId, saved.body.run.runId);
    for (const [name, bytes] of Object.entries(before)) assert.deepEqual(await readFile(join(pkg.dir, name)), bytes, name);
    assert.deepEqual(await readFile(join(pkg.dir, "runs", "r0", "render-model.json")), original);
    assert.equal(JSON.parse(await readFile(join(pkg.dir, "run.json"), "utf8")).feature, "cover_letter");
  }
});


it("SCRP-B23 R1-#4 a failed terminal write delivers done and reconnect replays without rejection", async () => {
  const pkg = await seed();
  let failed = false;
  const svc = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" }, fetchImpl,
    persistProposal: async (path, snapshot) => {
      if (!failed && snapshot.events.at(-1)?.event === "done") {
        failed = true;
        throw Object.assign(new Error("Fictional terminal persistence failure"), { code: "ENOSPC" });
      }
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot));
      await rename(temporary, path);
    },
  });
  const started = await svc.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten", lockFacts: true });
  const first = fakeStream();
  const ended = once(first, "end");
  let timer;
  try {
    await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), first);
    const delivered = await Promise.race([ended.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), 500); })]);
    assert.equal(delivered, true, "failed terminal persistence must not hang the stream");
    assert.equal(failed, true);
    assert.equal(first.chunks.join("").match(/event: done/g)?.length, 1);
    assert.match(first.chunks.join(""), /"status":"ready"/);
    assert.doesNotMatch(first.chunks.join(""), /Fictional terminal persistence failure|ENOSPC/);
    // Let final housekeeping finish, then reconnect through the same real queue.
    await new Promise((resolve) => setImmediate(resolve));
    const replay = fakeStream();
    const replayed = once(replay, "end");
    await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), replay);
    await replayed;
    assert.equal(replay.chunks.join("").match(/event: done/g)?.length, 1);
    assert.match(replay.chunks.join(""), /"status":"ready"/);
    const stored = JSON.parse(await readFile(join(pkg.dir, "proposals", `${started.proposalId}.json`), "utf8"));
    assert.equal(stored.status, "ready");
    assert.equal(stored.events.filter((row) => row.event === "done").length, 1);
  } finally { clearTimeout(timer); first.end(); first.emit("close"); }
});


it("SCRP-B24 R1-#5 malformed ready rows agree between GET open and the role gates", async () => {
  const pkg = await seed();
  await mkdir(join(pkg.dir, "proposals"));
  const id = randomUUID();
  await writeFile(join(pkg.dir, "proposals", `${id}.json`), JSON.stringify({
    id, doc: "resume", status: "ready", baseRunId: "r0", createdAt: new Date().toISOString(), events: [],
  }));
  assert.deepEqual(await service.open(pkg.slug), { proposal: null });
  const started = await service.start(pkg.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten", lockFacts: true });
  await service.reject(pkg.slug, started.proposalId);
  const saved = await service.accept(pkg.slug, "", { doc: "resume", baseRunId: "r0", manualOps: [op], confirmUnverified: [] }, true);
  assert.equal(saved.statusCode, 200);
});


it("SCRP-B26 R1-#7 proposal promise queues are pruned after terminal close, accept and reject", async () => {
  const observed = [];
  const NativeMap = globalThis.Map;
  let svc;
  try {
    globalThis.Map = class extends NativeMap { constructor(...args) { super(...args); observed.push(this); } };
    svc = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: "openai", resolvedModel: "stub", apiKey: "example" }, fetchImpl, commit });
  } finally { globalThis.Map = NativeMap; }
  const queues = (id) => observed.map((map) => map.get(id)).filter((value) => value instanceof Promise);
  const drained = async (id) => {
    for (let i = 0; i < 3; i++) {
      await Promise.all(queues(id).map((promise) => promise.catch(() => {})));
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(queues(id).length, 0, "settled per-proposal promises must be released");
  };
  const rejected = await seed();
  const pending = await svc.start(rejected.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten", lockFacts: true });
  assert.equal(queues(pending.proposalId).length, 1, "instrumentation observes the real persistence queue");
  await svc.reject(rejected.slug, pending.proposalId);
  await drained(pending.proposalId);
  const accepted = await seed();
  const id = await readyProposal(svc, accepted);
  await drained(id);
  await svc.accept(accepted.slug, id, { accept: ["o1"], confirmUnverified: [] });
  await drained(id);
  const stopped = await seed();
  const partial = await svc.start(stopped.slug, { doc: "resume", baseRunId: "r0", instruction: "Shorten", lockFacts: true });
  await svc.stop(stopped.slug, partial.proposalId);
  await drained(partial.proposalId);
});


it("SCRP-B28 R1-#25 production error envelope preserves a committed nonretryable 503", async () => {
  // Import the real envelope while suppressing index's auto-start and startup migrations.
  // No serving stack or default port is opened by this test.
  const listen = express.application.listen;
  let preventedStartup = false;
  let withApiErrorEnvelope;
  try {
    express.application.listen = function () { preventedStartup = true; return this; };
    ({ withApiErrorEnvelope } = await import("../../server/index.mjs"));
  } finally { express.application.listen = listen; }
  assert.equal(preventedStartup, true);
  assert.equal(typeof withApiErrorEnvelope, "function", "the real production envelope must be exported");
  const pkg = await seed();
  browserAvailable = false;
  let saved;
  try { saved = await service.accept(pkg.slug, "", { doc: "resume", baseRunId: "r0", manualOps: [op], confirmUnverified: [] }, true); }
  finally { browserAvailable = true; }
  const body = withApiErrorEnvelope(saved.statusCode, saved.body);
  assert.equal(saved.statusCode, 503);
  assert.equal(body.retryable, false);
  assert.equal(body.code, "browser_unavailable");
  assert.deepEqual(body.run, saved.body.run);
  assert.deepEqual(body.versions, saved.body.versions);
  assert.equal(body.run.pdf, "stale");
  assert.ok(body.run.runId);
  assert.equal(body.versions[0].runId, body.run.runId);
  assert.equal(withApiErrorEnvelope(503, { error: "A fictional transient failure", code: "internal_error" }).retryable, true);
});

it('SCRP-B30 R2-#4 failed terminal persistence finishes both concurrent subscribers once', async () => {
  const pkg = await seed(); let failed = false; let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const fetching = new Promise(resolve => { entered = resolve; });
  const svc = createMaterialsVersionService({ applicationsRoot: root,
    pin: { provider: 'openai', resolvedModel: 'stub', apiKey: 'example' },
    fetchImpl: async (...args) => { entered(); await gate; return fetchImpl(...args); },
    persistProposal: async (path, snapshot) => {
      if (!failed && snapshot.events.at(-1)?.event === 'done') { failed = true; throw new Error('Fictional write failure'); }
      await writeFile(`${path}.tmp`, JSON.stringify(snapshot)); await rename(`${path}.tmp`, path);
    },
  });
  const started = await svc.start(pkg.slug, { doc: 'resume', baseRunId: 'r0', instruction: 'Shorten', lockFacts: true });
  const streams = [fakeStream(), fakeStream()];
  const ended = streams.map(stream => once(stream, 'end'));
  let timer;
  try {
    await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), streams[0]); await fetching;
    await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), streams[1]); release();
    const allEnded = await Promise.race([Promise.all(ended).then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 500); })]);
    assert.equal(allEnded, true, 'every subscriber must finish after a failed terminal write');
    assert.equal(failed, true);
    for (const stream of streams) {
      assert.equal(stream.chunks.join('').match(/event: done/g)?.length, 1);
      assert.match(stream.chunks.join(''), /"status":"ready"/);
    }
    await new Promise(resolve => setImmediate(resolve));
    const stored = JSON.parse(await readFile(join(pkg.dir, 'proposals', `${started.proposalId}.json`), 'utf8'));
    assert.equal(stored.events.filter(row => row.event === 'done').length, 1);
  } finally { clearTimeout(timer); release(); for (const stream of streams) { stream.end(); stream.emit('close'); } }
});

it('SCRP-B51 R4-#1 confirmed manual adjacency violations stay 400 locked and persist nothing', async (t) => {
  if (!await needsSocket(t)) return;
  for (const doc of ['resume', 'coverLetter']) {
    const input = structuredClone(model); const id = doc === 'resume' ? 'b:acme:c14' : 'p:p2';
    if (doc === 'resume') input.documents.resume.sections.find(s => s.kind === 'experience').entries[0].bullets[0].runs = [{ t: 'Processed ' }, { n: '38' }, { t: ' shipments.' }];
    else input.documents.coverLetter.paragraphs[1].text = 'Processed 38 shipments.';
    const pkg = await seed(input);
    for (const figure of ['38%', '%38', '$38', '38$', '38,000', ',00038', '🄁38', '38🄁']) {
      const res = await fetch(base + pkg.path + '/edits/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc, baseRunId: 'r0', manualOps: [{ opId: 'edge', op: 'replace', node: id, text: 'Processed ' + figure + ' shipments.' }], confirmUnverified: ['edge'] }) });
      assert.equal(res.status, 400, doc + figure); assert.equal((await res.json()).code, 'locked');
    }
    const listing = await (await fetch(base + pkg.path + '/versions?doc=' + doc)).json();
    assert.equal(listing.versions.length, 1); assert.equal(listing.currentRunId, 'r0');
    assert.deepEqual(JSON.parse(await readFile(join(pkg.dir, 'render-model.json'), 'utf8')), input);
  }
});

for (const doc of ['resume', 'coverLetter']) it(`SCRP-B80 D29 ${doc} manual locked blocks reject unchanged figures even when confirmed`, async (t) => {
  if (!(await needsSocket(t))) return;
  for (const confirmed of [false, true]) {
    const pkg = await seed();
    const id = doc === 'resume' ? 'stmt' : 'p:p2';
    const node = deriveNodes(model).find(n => n.id === id);
    const res = await request(`${pkg.path}/edits/manual`, 'POST', {
      doc, baseRunId: 'r0', manualOps: [{ opId: 'd29', op: 'replace', node: id, text: node.text + ' Today.' }],
      confirmUnverified: confirmed ? ['d29'] : [],
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.code, 'locked');
    assert.deepEqual(JSON.parse(await readFile(join(pkg.dir, 'render-model.json'), 'utf8')), model);
    assert.deepEqual((await readdir(join(pkg.dir, 'runs'))), ['r0']);
    if (doc === 'resume') {
      const whole = await request(`${pkg.path}/edits/manual`, 'POST', {
        doc, baseRunId: 'r0', manualOps: [{ opId: 'whole', op: 'replace', node: 'seat:acme', text: 'Director' }],
        confirmUnverified: confirmed ? ['whole'] : [],
      });
      assert.equal(whole.status, 400); assert.equal(whole.data.code, 'locked');
    }
  }
});

for (const doc of ['resume', 'coverLetter']) it(`SCRP-B84 R7-#4 ${doc} committed unrelated AI edit preserves the approximation`, async () => {
  const before = structuredClone(model), text = 'Cut costs ~40% across teams.', next = 'Cut costs ~40% across all teams.';
  const node = doc === 'resume' ? 'b:acme:c14' : 'p:p2';
  if (doc === 'resume') before.documents.resume.sections.find(s => s.kind === 'experience').entries[0].bullets[0].runs = [{ t: 'Cut costs ~' }, { n: '40%' }, { t: ' across teams.' }];
  else before.documents.coverLetter.paragraphs[1].text = text;
  const pkg = await seed(before), edit = { opId: 'approx', op: 'replace', node, text: next };
  const svc = createMaterialsVersionService({ applicationsRoot: root, pin: { provider: 'openai', resolvedModel: 'fixture', apiKey: 'example' }, commit,
    propose: async () => ({ ops: [edit], blocked: [], summary: { changes: 1 }, factCheck: 'model' }),
  });
  const started = await svc.start(pkg.slug, { doc, baseRunId: 'r0', instruction: 'Clarify teams.', scope: [node], lockFacts: true });
  const stream = fakeStream(), ended = once(stream, 'end');
  await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), stream); await ended;
  const saved = await svc.accept(pkg.slug, started.proposalId, { accept: ['approx'], confirmUnverified: ['approx'] });
  const stored = (await svc.model(pkg.slug, saved.body.run.runId)).model;
  assert.equal(deriveNodes(stored).find(n => n.id === node).text, next);
  const published = JSON.parse(await readFile(join(pkg.dir, 'render-model.json'), 'utf8'));
  assert.deepEqual(published.documents[doc === 'resume' ? 'coverLetter' : 'resume'], before.documents[doc === 'resume' ? 'coverLetter' : 'resume']);
});

for (const doc of ['resume', 'coverLetter']) it(`SCRP-B85 R7-#6 ${doc} plaintext manual save preserves literal angle text and escapes rendering`, async (t) => {
  if (!(await needsSocket(t))) return;
  const pkg = await seed(), node = doc === 'resume' ? 'line:beta' : 'p:p3';
  const text = 'Kept latency <50ms and uptime >99.9% all year. Keep <plan> and <b>literal</b> visible.';
  const saved = await request(`${pkg.path}/edits/manual`, 'POST', {
    doc, baseRunId: 'r0', manualOps: [{ opId: 'angles', op: 'replace', node, text }], confirmUnverified: ['angles'],
  });
  assert.equal(saved.status, 200);
  const stored = await request(`${pkg.path}/versions/${saved.data.run.runId}/model`);
  assert.equal(stored.data.nodes.find(n => n.id === node).text, text);
  const preview = await request(`${pkg.path}/preview`, 'POST', { doc, baseRunId: saved.data.run.runId, ops: [] });
  assert.equal(preview.status, 200);
  assert.ok(preview.data.html.includes('&lt;50ms'));
  assert.ok(preview.data.html.includes('&gt;99.9%'));
  assert.ok(preview.data.html.includes('&lt;plan&gt;'));
  assert.ok(preview.data.html.includes('&lt;b&gt;literal&lt;/b&gt;'));
  assert.equal(preview.data.html.includes('<b>literal</b>'), false);
  const published = JSON.parse(await readFile(join(pkg.dir, 'render-model.json'), 'utf8'));
  assert.deepEqual(published.documents[doc === 'resume' ? 'coverLetter' : 'resume'], model.documents[doc === 'resume' ? 'coverLetter' : 'resume']);
});

for (const doc of ['resume', 'coverLetter']) for (const first of ['manual', 'AI']) {
  it(`SCRP-B90 R8-#2 ${doc} rejects manual edits to locks created by an earlier ${first} op`, async (t) => {
    if (!(await needsSocket(t))) return;
    const input = structuredClone(model), node = doc === 'resume' ? 'b:acme:c14' : 'p:p3';
    if (doc === 'resume') input.documents.resume.sections.find(s => s.kind === 'experience').entries[0].bullets[0].runs = [{ t: 'Reduced delays across teams.' }];
    const pkg = await seed(input);
    assert.equal(deriveNodes(input).find(n => n.id === node).locked.spans.length, 0);
    const createLock = { opId: 'create-lock', op: 'replace', node, text: 'Reduced delays 38% across teams.' };
    const editLocked = { opId: 'edit-locked', op: 'replace', node, text: 'Reduced delays 38% across all teams.' };
    let path = `${pkg.path}/edits/manual`, body = { doc, baseRunId: 'r0', manualOps: [createLock, editLocked], confirmUnverified: ['create-lock', 'edit-locked'] };
    if (first === 'AI') {
      const svc = createMaterialsVersionService({ applicationsRoot: root, commit, pin: { provider: 'openai', resolvedModel: 'fixture', apiKey: 'example' },
        propose: async () => ({ ops: [createLock], blocked: [], summary: { changes: 1 }, factCheck: 'model' }),
      });
      const started = await svc.start(pkg.slug, { doc, baseRunId: 'r0', instruction: 'Clarify delays.', scope: [node], lockFacts: true });
      const stream = fakeStream(), ended = once(stream, 'end');
      await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), stream); await ended;
      assert.equal(JSON.parse(await readFile(join(pkg.dir, 'proposals', `${started.proposalId}.json`), 'utf8')).status, 'ready');
      path = `${pkg.path}/edits/${started.proposalId}/accept`;
      body = { accept: ['create-lock'], manualOps: [editLocked], confirmUnverified: ['create-lock', 'edit-locked'] };
    }
    const res = await request(path, 'POST', body);
    assert.equal(res.status, 400); assert.equal(res.data.code, 'locked');
    assert.deepEqual(JSON.parse(await readFile(join(pkg.dir, 'render-model.json'), 'utf8')), input);
    assert.deepEqual(await readdir(join(pkg.dir, 'runs')), ['r0']);
  });
}

for (const doc of ['resume', 'coverLetter']) it(`SCRP-B91 R8-#3 ${doc} manual literal text round-trips through save reopen and escaped preview`, async (t) => {
  if (!(await needsSocket(t))) return;
  for (const text of ['Use snake_case.', 'Use file_name.', 'Use A* search.', 'Keep <team_name> visible.', '> expected', '[portfolio](https://example.com)', '  Keep Cafe\u0301 *literal* text.\nNext line.  ']) {
    const pkg = await seed(), node = doc === 'resume' ? 'line:beta' : 'p:p3';
    const saved = await request(`${pkg.path}/edits/manual`, 'POST', {
      doc, baseRunId: 'r0', manualOps: [{ opId: 'literal', op: 'replace', node, text }], confirmUnverified: ['literal'],
    });
    assert.equal(saved.status, 200, text);
    const reopened = createMaterialsVersionService({ applicationsRoot: root });
    assert.equal((await reopened.model(pkg.slug, saved.data.run.runId)).nodes.find(n => n.id === node).text, text);
    const preview = await request(`${pkg.path}/preview`, 'POST', { doc, baseRunId: saved.data.run.runId, ops: [] });
    assert.equal(preview.status, 200);
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    assert.ok(preview.data.html.includes(escaped), text);
    const published = JSON.parse(await readFile(join(pkg.dir, 'render-model.json'), 'utf8'));
    assert.deepEqual(published.documents[doc === 'resume' ? 'coverLetter' : 'resume'], model.documents[doc === 'resume' ? 'coverLetter' : 'resume']);
  }
});

for (const doc of ['resume', 'coverLetter']) it(`SCRP-B93 R9-#1/#2 ${doc} AI cleanup and locks still apply on a manually saved block`, async () => {
  const node = doc === 'resume' ? 'b:acme:c14' : 'p:p3';
  const manualText = doc === 'resume' ? 'Measured carrier delays and reduced fulfillment delays 38% for the team. ' : 'I would welcome a conversation about improving delays 38% in daily operations. ';
  const aiEdit = async (pkg, baseRunId, text, node) => {
    const svc = createMaterialsVersionService({ applicationsRoot: root, commit, pin: { provider: 'openai', resolvedModel: 'fixture', apiKey: 'example' },
      propose: async () => ({ ops: [{ opId: 'ai', op: 'replace', node, text }], blocked: [], summary: { changes: 1 }, factCheck: 'model' }),
    });
    const started = await svc.start(pkg.slug, { doc, baseRunId, instruction: 'Emphasize.', scope: [node], lockFacts: true });
    const stream = fakeStream(), ended = once(stream, 'end');
    await svc.stream(pkg.slug, started.proposalId, new EventEmitter(), stream); await ended;
    const edited = await svc.accept(pkg.slug, started.proposalId, { accept: ['ai'], confirmUnverified: ['ai'] });
    return (await svc.model(pkg.slug, edited.body.run.runId)).nodes.find(n => n.id === node);
  };
  const stage = async (node, manualText) => {
    const pkg = await seed();
    const saved = await service.accept(pkg.slug, '', { doc, baseRunId: 'r0', manualOps: [{ opId: 'manual', op: 'replace', node, text: manualText }], confirmUnverified: ['manual'] }, true);
    return { pkg, runId: saved.body.run.runId };
  };
  const locked = await stage(node, manualText);
  const stored = await aiEdit(locked.pkg, locked.runId, manualText.trim().replace('38%', '3*8%'), node);
  assert.equal(stored.text, manualText.trim());
  assert.ok(stored.locked.spans.length > 0);
  assert.equal(stored.text.slice(...stored.locked.spans[0]), '38%');
  const plainNode = doc === 'resume' ? 'line:beta' : 'p:p1';
  const marked = await stage(plainNode, 'Tracked daily shipments across teams. ');
  const emphasized = await aiEdit(marked.pkg, marked.runId, 'Tracked **daily** shipments across teams.', plainNode);
  assert.equal(emphasized.text.includes('**'), false);
});
