/* global window */
/** Fictional Scribe service for browser regressions; never starts the live stack. */
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import express from "../../server/node_modules/express/index.js";
import { createMaterialsVersionService, registerMaterialsEditRoutes } from "../../server/materials-versions.mjs";
import { commitModelAsRun } from "../../server/materials-regenerate.mjs";
import { renderDocument } from "../../server/materials-render.mjs";
import { openPdfSession } from "../../server/materials-pdf.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureModel = JSON.parse(readFileSync(join(repoRoot, "docs/programs/editor-20260927/fixtures/model.json"), "utf8"));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Injectable writer/commit/PDF; real routes, publication claims and disk persistence. */
export async function startScribeRealService(options = {}) {
  const tempParent = resolve(options.tempParent || join(repoRoot, ".lane-evidence", "tmp"));
  if (!tempParent.startsWith(repoRoot + sep)) throw new Error("Scribe fixture root must be inside this worktree.");
  await mkdir(tempParent, { recursive: true });
  const root = await mkdtemp(join(tempParent, "scribe-service-"));
  const priorEnv = {};
  for (const [key, file] of Object.entries({ JOBBORED_PROFILE_PATH: "profile.json", JOBBORED_LLM_CONFIG_PATH: "llm.json" })) {
    priorEnv[key] = process.env[key];
    process.env[key] = join(root, file);
  }
  let hold;
  let sequence = 0;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PUT, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.post("/api/applications/:slug/edits", async (_req, _res, next) => {
    const waiting = hold;
    if (waiting) { waiting.entered.resolve(); await waiting.release.promise; if (hold === waiting) hold = null; }
    next();
  });
  const service = createMaterialsVersionService({
    applicationsRoot: root,
    pin: { provider: "openai", resolvedModel: "fixture", apiKey: "example" },
    propose: options.propose || (async ({ nodes }) => ({ ops: [{ opId: "fixture-edit", op: "replace", node: nodes.some((node) => node.id === "line:beta") ? "line:beta" : "p:p3", text: nodes.some((node) => node.id === "line:beta") ? "Tracked shipments." : "I welcome a conversation about improving daily operations." }], blocked: [], summary: { changes: 1 }, factCheck: "model" })),
    commit: options.commit || ((input, deps) => commitModelAsRun(input, {
      ...deps, critic: async () => ({ status: "pass", issues: [] }),
      targetLogoLoader: async () => null, employerLogoLoader: async () => [],
    })),
    pdfSession: options.pdfSession,
  });
  registerMaterialsEditRoutes(app, { service });
  const server = await new Promise((done, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => done(listener));
    listener.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    root, baseUrl, service,
    /** Hold the next POST until released, including before its proposal ID exists. */
    deferStart() {
      if (hold) throw new Error("A Scribe start is already deferred.");
      hold = { entered: deferred(), release: deferred() };
      return { entered: hold.entered.promise, release: hold.release.resolve };
    },
    async seed({ slug = `acme-example-${++sequence}`, model = fixtureModel, feature = "both", renderPdf = false } = {}) {
      if (!/^[a-zA-Z0-9_-]+$/.test(slug)) throw new Error("Invalid fictional slug.");
      const dir = join(root, slug);
      const runDir = join(dir, "runs", "r0");
      await mkdir(runDir, { recursive: true });
      model = structuredClone(model);
      if (feature === "resume") delete model.documents.coverLetter;
      if (feature === "cover_letter") delete model.documents.resume;
      const session = renderPdf ? await (options.pdfSession || openPdfSession)() : null;
      if (renderPdf && !session) throw new Error("The installed PDF browser is unavailable.");
      const artifacts = [];
      try {
        for (const [doc, stem] of [["resume", "resume"], ["coverLetter", "cover-letter"]]) {
          if (!model.documents[doc]) continue;
          const html = renderDocument(model, doc);
          await writeFile(join(dir, `${stem}.html`), html);
          if (session) {
            const pdf = await session.pdf(html, join(dir, `${stem}.pdf`));
            artifacts.push({ path: `${stem}.pdf`, pages: pdf.pages });
            await writeFile(join(runDir, `${stem}.pdf`), await readFile(join(dir, `${stem}.pdf`)));
          }
          await writeFile(join(runDir, `${stem}.html`), html);
        }
      } finally { await session?.close(); }
      const run = { runId: "r0", slug, feature, requestedAt: "2026-09-27T10:00:00.000Z", finishedAt: "2026-09-27T10:00:00.000Z", template: { family: model.template.family, source: "default" }, artifacts };
      for (const folder of [dir, runDir]) {
        await writeFile(join(folder, "run.json"), JSON.stringify(run));
        await writeFile(join(folder, "render-model.json"), JSON.stringify(model));
      }
      await writeFile(join(dir, "manifest.json"), JSON.stringify({ company: "Acme", title: "Operations Analyst", runId: "r0" }));
      return { slug, dir, baseRunId: "r0", model, path: `/api/applications/${slug}` };
    },
    /** Call after the hermetic fence; only this service's origin is allowed through. */
    async pointPage(page) {
      await page.route(`${baseUrl}/**`, (route) => route.continue());
      await page.evaluate((base) => {
        window.COMMAND_CENTER_CONFIG = { ...window.COMMAND_CENTER_CONFIG, jobPostingScrapeUrl: base, scribeV2Api: "live" };
      }, baseUrl);
    },
    async close() {
      hold?.release.resolve();
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      for (const [key, value] of Object.entries(priorEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
