import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { commitModelAsRun } from "../server/materials-regenerate.mjs";
import { validateRunRecord } from "../server/materials-package.mjs";

const model = JSON.parse(readFileSync(new URL("../docs/programs/editor-20260927/fixtures/model.json", import.meta.url), "utf8"));

it("commits an accepted edit as an immutable run with its edit block", async () => {
  const root = await mkdtemp(join(tmpdir(), "jb-edit-commit-"));
  const dir = join(root, "example-role");
  try {
    await mkdir(dir);
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ company: "Example", title: "Analyst" }));
    const edit = { prompt: "Shorter summary", proposalId: "proposal-1", accepted: ["o1"], rejected: ["o2"], ops: [{ opId: "o1", op: "replace", node: "line:beta", text: "Tracked shipments." }] };
    const session = async () => ({
      measure: async () => ({ fits: true, scrollHeight: 1056, clientHeight: 1056, lastTextBottom: 1000, limit: 1027, blockedRequests: 0 }),
      pdf: async (_html, path) => { await writeFile(path, "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n"); return { path, pages: 1, blockedRequests: 0 }; },
      rasterize: async (src) => src,
      close: async () => {},
    });
    const result = await commitModelAsRun({ dir, model, feature: "both", source: "edit", parentRunId: "original-run", edit }, {
      pdfSession: session,
      now: () => new Date("2026-09-27T12:00:00.000Z"),
      critic: async () => ({ status: "pass", issues: [] }),
    });
    const run = JSON.parse(await readFile(join(dir, "runs", result.runId, "run.json"), "utf8"));
    assert.equal(validateRunRecord(run).ok, true);
    assert.equal(run.template.source, "edit");
    assert.deepEqual(run.edit, edit);
    assert.equal((await readFile(join(dir, "run.json"), "utf8")), (await readFile(join(dir, "runs", result.runId, "run.json"), "utf8")));
    assert.ok((await readFile(join(dir, "runs", result.runId, "resume.html"), "utf8")).includes("data-family=\"signal\""));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
