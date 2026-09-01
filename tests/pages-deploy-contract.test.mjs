import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { assembleIndex } from "../scripts/assemble-index.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  join(repoRoot, ".github", "workflows", "pages.yml"),
  "utf8",
);

describe("GitHub Pages deployment contract", () => {
  it("deploys an assembled dashboard artifact from main", () => {
    assert.match(workflow, /push:\s*\n\s+branches: \[main\]/);
    assert.match(workflow, /node scripts\/assemble-index\.mjs --write/);
    assert.match(workflow, /cp index\.assembled\.html _site\/index\.html/);
    assert.match(
      workflow,
      /cp config\.example\.js _site\/config\.js/,
      "the public artifact must serve a placeholder config.js instead of logging a 404",
    );
    assert.match(workflow, /actions\/upload-pages-artifact@v4/);
    assert.match(workflow, /path: _site/);
    assert.match(workflow, /actions\/deploy-pages@v4/);
  });

  it("puts protected modal surfaces into the deployed index", () => {
    const assembled = assembleIndex(repoRoot);
    assert.doesNotMatch(assembled, /<!--\s*@include\s+/);
    assert.match(assembled, /id="discoveryRunPreviewTemplate"/);
    assert.match(assembled, /id="discoveryRunPreviewMount"/);
  });
});
