/* R1 reviewer probe: R0 queue under a failed terminal write; locked blocked rows; gate vs GET open. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tree = resolve(process.argv[2] || ".");
const imp = (rel) => import(pathToFileURL(join(tree, rel)).href);
const { startScribeRealService } = await imp("tests/e2e-fixtures/scribe-real-service.mjs");
const { createMaterialsVersionService, registerMaterialsEditRoutes } = await imp("server/materials-versions.mjs");
const { proposeEdits } = await imp("server/materials-edit.mjs");
const express = (await imp("server/node_modules/express/index.js")).default;

const unhandled = [];
process.on("unhandledRejection", (error) => { unhandled.push(String(error?.message || error)); });

const seedHost = await startScribeRealService({ tempParent: join(tree, ".lane-evidence", "tmp") });
const mount = async (deps) => {
  const app = express(); app.use(express.json());
  const service = createMaterialsVersionService({ applicationsRoot: seedHost.root, pin: { provider: "openai", resolvedModel: "fixture", apiKey: "example" }, ...deps });
  registerMaterialsEditRoutes(app, { service });
  const server = await new Promise((done) => { const l = app.listen(0, "127.0.0.1", () => done(l)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); return new Promise((done) => server.close(done)); } };
};
const call = async (base, method, path, body, ms = 2500) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const text = await res.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { /* sse */ }
    return { status: res.status, body: parsed, text };
  } catch (error) { return { status: 0, hung: error.name === "AbortError", text: "" }; }
  finally { clearTimeout(timer); }
};
const writeJson = async (path, value) => { const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value)); await rename(temp, path); };

try {
  /* 1. The terminal `done` snapshot fails to persist (disk full, folder removed). */
  const pkg = await seedHost.seed();
  const failing = await mount({
    propose: async () => ({ ops: [{ opId: "e1", op: "replace", node: "line:beta", text: "Tracked shipments." }], blocked: [], summary: { changes: 1 }, factCheck: "model" }),
    persistProposal: async (path, snapshot) => {
      if (snapshot.events?.at(-1)?.event === "done") throw Object.assign(new Error("ENOSPC: no space left on device, write '/private/secret/path'"), { code: "ENOSPC" });
      await writeJson(path, snapshot);
    },
  });
  const started = await call(failing.base, "POST", `${pkg.path}/edits`, { doc: "resume", baseRunId: "r0", instruction: "tighten", lockFacts: true });
  const first = await call(failing.base, "GET", `${pkg.path}/edits/${started.body.proposalId}/stream`);
  await new Promise((done) => setTimeout(done, 200));
  const again = await call(failing.base, "GET", `${pkg.path}/edits/${started.body.proposalId}/stream`);
  const stop = await call(failing.base, "POST", `${pkg.path}/edits/${started.body.proposalId}/stop`, {});
  const open = await call(failing.base, "GET", `${pkg.path}/edits/open`);
  console.log("1 failed terminal write:", JSON.stringify({
    firstStream: first.hung ? "HUNG (no done within 2.5 s)" : first.text.match(/event: \w+/g),
    reconnect: again.hung ? "HUNG (no done within 2.5 s)" : (again.text.match(/event: \w+/g) || `ended, ${again.text.length} bytes`),
    stop: [stop.status, stop.body?.code], openStatus: open.body?.proposal?.status, openOps: open.body?.proposal?.ops?.length,
    unhandledRejections: unhandled,
  }));
  await failing.close();

  /* 2. What the real proposeEdits emits for a locked-fact violation. */
  const model = JSON.parse(await readFile(join(tree, "docs/programs/editor-20260927/fixtures/model.json"), "utf8"));
  const { deriveNodes } = await imp("server/materials-nodes.mjs");
  const lockedNode = deriveNodes(model).find((node) => node.locked?.whole || node.locked?.spans?.length);
  const reply = { ops: [{ opId: "x1", op: "replace", node: lockedNode.id, text: "Completely different words here." }] };
  const result = await proposeEdits({
    model, instruction: "rewrite", pin: { provider: "openai", resolvedModel: "fixture", apiKey: "example", baseUrl: "https://example.invalid/v1" },
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
  }).catch((error) => ({ error: error.message }));
  console.log("2 locked node", lockedNode.id, JSON.stringify(lockedNode.text.slice(0, 40)), "→ blocked rows:", JSON.stringify(result.blocked || result));

  /* 3. Role gate vs GET open on a stored row GET open calls absent. */
  const pkg3 = await seedHost.seed();
  const plain = await mount({});
  await mkdir(join(pkg3.dir, "proposals"), { recursive: true });
  const id = randomUUID();
  await writeFile(join(pkg3.dir, "proposals", `${id}.json`), JSON.stringify({ id, doc: "resume", baseRunId: "r0", instruction: "x", scope: "all", lockFacts: true, createdAt: new Date().toISOString(), status: "ready", events: [] }));
  const openMalformed = await call(plain.base, "GET", `${pkg3.path}/edits/open`);
  const startMalformed = await call(plain.base, "POST", `${pkg3.path}/edits`, { doc: "resume", baseRunId: "r0", instruction: "tighten", lockFacts: true });
  console.log("3 ready row without an ops array:", JSON.stringify({ getOpen: openMalformed.body, postEdits: [startMalformed.status, startMalformed.body?.code] }));
  await plain.close();
} finally { await seedHost.close(); }
