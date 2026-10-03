/* R1 reviewer probe: does a Scribe save change what template switch (regenerate) and restore do?
   Run from a tree root: node .lane-evidence/r1-probes/be-template-switch.mjs */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tree = resolve(process.argv[2] || ".");
const imp = (rel) => import(pathToFileURL(join(tree, rel)).href);
const { startScribeRealService } = await imp("tests/e2e-fixtures/scribe-real-service.mjs");
const { regeneratePackage } = await imp("server/materials-regenerate.mjs");

const svc = await startScribeRealService({ tempParent: join(tree, ".lane-evidence", "tmp") });
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const family = async (dir, file) => {
  const html = await readFile(join(dir, file), "utf8");
  return (html.match(/data-family="([a-z]+)"/) || html.match(/family-([a-z]+)/) || html.match(/templates\/materials\/([a-z]+)\//) || [])[1] || `unknown(${html.length}b)`;
};
const call = async (method, path, body) => {
  const res = await fetch(svc.baseUrl + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* sse or empty */ }
  return { status: res.status, body: parsed, text };
};
const edit = async (pkg, doc, baseRunId) => {
  const started = await call("POST", `${pkg.path}/edits`, { doc, baseRunId, instruction: "tighten", lockFacts: true });
  if (started.status !== 202) return { started };
  await call("GET", `${pkg.path}/edits/${started.body.proposalId}/stream`);
  const saved = await call("POST", `${pkg.path}/edits/${started.body.proposalId}/accept`, { accept: ["fixture-edit"] });
  return { started, saved };
};
const state = async (pkg, label) => {
  const run = await json(join(pkg.dir, "run.json"));
  const model = await json(join(pkg.dir, "render-model.json"));
  console.log(label, JSON.stringify({
    topRun: run.runId.slice(-12), feature: run.feature, source: run.template?.source, templateFamily: run.template?.family,
    topModelDocs: Object.keys(model.documents), topModelFamily: model.template.family,
    resumeHtmlFamily: await family(pkg.dir, "resume.html"), letterHtmlFamily: await family(pkg.dir, "cover-letter.html"),
  }));
};
try {
  const pkg = await svc.seed({ renderPdf: true });
  await state(pkg, "seeded        ");
  const first = await edit(pkg, "resume", pkg.baseRunId);
  console.log("resume save   ", first.saved?.status, JSON.stringify(first.saved?.body?.run));
  await state(pkg, "after resume  ");
  const regen = await regeneratePackage({ slug: pkg.slug, template: "dossier" }, {
    applicationsRoot: svc.root, critic: async () => ({ status: "pass", issues: [] }),
    targetLogoLoader: async () => null, employerLogoLoader: async () => [], readSavedResume: async () => null,
  }).catch((error) => ({ error: error.message, code: error.code }));
  console.log("regenerate    ", JSON.stringify({ ok: regen.ok, error: regen.error, template: regen.template }));
  await state(pkg, "after switch  ");

  // Second package: restore numbering seen from the letter desk after a resume save.
  const pkg2 = await svc.seed({ renderPdf: true });
  const save2 = await edit(pkg2, "resume", pkg2.baseRunId);
  const letterBefore = (await call("GET", `${pkg2.path}/versions?doc=coverLetter`)).body;
  const restored = await call("POST", `${pkg2.path}/versions/r0/restore`, {});
  const letterAfter = (await call("GET", `${pkg2.path}/versions?doc=coverLetter`)).body;
  const resumeAfter = (await call("GET", `${pkg2.path}/versions?doc=resume`)).body;
  console.log("restore r0 from the letter desk after one resume save:", JSON.stringify({
    resumeSaveStatus: save2.saved?.status,
    letterListBefore: letterBefore.versions.map((v) => `v${v.n}`),
    restoreStatus: restored.status, bodyRunN: restored.body.run.n,
    bodyVersions: restored.body.versions?.map((v) => `v${v.n}:${v.source}`),
    letterListAfter: letterAfter.versions.map((v) => `v${v.n}:${v.source}`),
    resumeListAfter: resumeAfter.versions.map((v) => `v${v.n}:${v.source}`),
  }));
} finally { await svc.close(); }
