import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deriveNodes } from "../server/materials-nodes.mjs";
import { renderDocument } from "../server/materials-render.mjs";

const fixture = JSON.parse(readFileSync(new URL("../docs/programs/editor-20260927/fixtures/model.json", import.meta.url), "utf8"));
const letterKinds = new Set(["salutation", "paragraph"]);
const unrendered = {
  signal: { resume: ["intro"], coverLetter: [] },
  dossier: { resume: ["intro"], coverLetter: [] },
  editorial: { resume: [], coverLetter: [] },
};

for (const family of Object.keys(unrendered)) {
  for (const doc of ["resume", "coverLetter"]) {
    test(`${family} ${doc} marks every rendered addressable block once`, () => {
      const model = structuredClone(fixture);
      model.template.family = family;
      const expected = deriveNodes(model)
        .filter(({ kind }) => (doc === "coverLetter") === letterKinds.has(kind))
        .map(({ id }) => id);
      const html = renderDocument(model, doc);
      const actual = [...html.matchAll(/\bdata-node="([^"]*)"/g)].map((match) => match[1]);
      assert.equal(new Set(actual).size, actual.length, "duplicate data-node");
      for (const id of actual) assert.ok(expected.includes(id), `extra data-node ${id}`);
      assert.deepEqual(expected.filter((id) => !actual.includes(id)), unrendered[family][doc], "missing rendered block ids");
    });
  }
}

test("user-derived ids are escaped as HTML attributes", () => {
  const model = structuredClone(fixture);
  model.documents.resume.sections[0].entries[0].employerId = 'contoso"<&';
  const html = renderDocument(model, "resume");
  assert.match(html, /data-node="seat:contoso&quot;&lt;&amp;"/);
  assert.match(html, /data-node="b:contoso&quot;&lt;&amp;:c14"/);
  assert.doesNotMatch(html, /data-node="seat:contoso"<&"/);
});

test("inline venture and toolkit blocks get their own patchable spans", () => {
  const model = structuredClone(fixture);
  model.documents.resume.sections.push({
    kind: "ventures",
    label: "Ventures",
    entries: [{ employerId: "contoso", org: "Contoso", meta: ["2024"], seat: "Founder", line: "Built a planning tool." }],
  });
  for (const family of ["signal", "editorial"]) {
    model.template.family = family;
    const html = renderDocument(model, "resume");
    assert.match(html, /<span data-node="seat:contoso">Founder<\/span>/);
    assert.match(html, /<span data-node="line:contoso">Built a planning tool\.<\/span>/);
    assert.match(html, /<b>Contoso<\/b>/);
    if (family === "editorial") {
      assert.match(html, /<b>Analytics<\/b> <span data-node="tool:Analytics">SQL, Spreadsheets<\/span>/);
    }
  }
});

test("a duplicate claim still renders every family without partial node annotations", () => {
  const model = structuredClone(fixture);
  const entry = model.documents.resume.sections[0].entries[0];
  entry.bullets.push(structuredClone(entry.bullets[0]));
  assert.throws(() => deriveNodes(model), /duplicate node id: b:acme:c14/);
  for (const family of Object.keys(unrendered)) {
    model.template.family = family;
    for (const doc of ["resume", "coverLetter"]) {
      const html = renderDocument(model, doc);
      assert.doesNotMatch(html, /\bdata-node=/, `${family} ${doc} has partial annotations`);
      if (doc === "resume") {
        assert.equal(html.split("Measured carrier delays and built a weekly dashboard for the operations team.").length - 1, 2);
      }
    }
  }
});
