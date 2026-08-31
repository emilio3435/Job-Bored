/**
 * F2A-PIPE01-ONE: Lattice does not remain a competing v2 board.
 * Pipeline is canonical. lattice.js must refuse to mount; lattice.css
 * must hide [data-region="lattice"] under body.jb-v2.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const latticeJs = readFileSync(join(repoRoot, "lattice.js"), "utf8");
const latticeCss = readFileSync(join(repoRoot, "lattice.css"), "utf8");
const pipelineCss = readFileSync(join(repoRoot, "pipeline.css"), "utf8");

describe("F2A-PIPE01-ONE: Lattice is the losing v2 board", () => {
  it("lattice.js init refuses to mount a competing board", () => {
    assert.match(
      latticeJs,
      /CANONICAL_BOARD|LOSING_RENDERER|JobBoredV2Boot/,
      "lattice.js must consult the canonical-board contract before rendering",
    );
    const initStart = latticeJs.indexOf("function init()");
    assert.ok(initStart > 0, "lattice.js must still declare init()");
    const initBody = latticeJs.slice(initStart, initStart + 500);
    assert.match(
      initBody,
      /return/,
      "init() must return without rendering when Pipeline is canonical",
    );
    assert.equal(
      /if\s*\(\s*!isOn\(\)\s*\)\s*\{\s*\/\/ legacy mode[\s\S]*return;\s*\}\s*render\(\);/.test(latticeJs),
      false,
      "init() must not fall through to render() whenever body.jb-v2 is on — that is the dual-board bug",
    );
  });

  it("lattice.css hides the lattice region under body.jb-v2 so two boards cannot paint", () => {
    const rootRule = latticeCss.match(/body\.jb-v2\s+\[data-region="lattice"\]\s*\{[^}]*\}/);
    assert.ok(rootRule, 'lattice.css must still scope the region under body.jb-v2');
    assert.match(
      rootRule[0],
      /display:\s*none/,
      "F2A-PIPE01-ONE: [data-region=lattice] must be display:none under body.jb-v2",
    );
  });

  it("pipeline.css still shows the canonical board under body.jb-v2", () => {
    assert.match(
      pipelineCss,
      /body\.jb-v2\s+\[data-region="pipeline"\]\s*\{/,
      "canonical Pipeline region must remain visible under body.jb-v2",
    );
    assert.match(
      pipelineCss,
      /body:not\(\.jb-v2\)\s+\[data-region="pipeline"\]\s*\{\s*display:\s*none/,
      "Pipeline stays hidden when the v2 class is off",
    );
  });
});
