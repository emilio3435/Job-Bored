/* UX01 cleanup lane cA (TR-20 / DS-08). The browser proof is
   tests/e2e-smoke/pipeline-rendered-event.spec.mjs; these pin the source
   seams so a refactor cannot quietly put the DOM trigger back. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");

describe("TR-20: jb:pipeline:rendered drives the v2 repaints", () => {
  it("should dispatch jb:pipeline:rendered with detail.count from pipeline-render.js", () => {
    const src = read("pipeline-render.js");
    assert.match(src, /new CustomEvent\("jb:pipeline:rendered", \{ detail: \{ count, total \} \}\)/);
    assert.equal((src.match(/emitPipelineRendered\(/g) || []).length, 4, "definition plus the three render exits");
  });

  it("should repaint the v2 board from app.js on the event", () => {
    const src = read("app.js");
    assert.match(src, /addEventListener\("jb:pipeline:rendered", function \(\) \{\s*const board = window\.JobBoredPipeline;/);
  });

  it("should make Dawn listen to the event instead of observing #jobCards", () => {
    const src = read("dawn.js");
    assert.match(src, /addEventListener\("jb:pipeline:rendered"/);
    assert.doesNotMatch(src, /getElementById\("jobCards"\)/);
  });
});

describe("DS-08: jb-v2-legacy-hide.css keeps no rule for a region that no longer exists", () => {
  it("should not hide [data-region=\"letter\"], which index.html no longer renders", () => {
    assert.doesNotMatch(read("index.html"), /data-region="letter"/);
    assert.doesNotMatch(read("jb-v2-legacy-hide.css"), /\[data-region="letter"\]/);
  });
});
