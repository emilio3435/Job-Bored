import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { expandIndexIncludes } from "../scripts/lib/expand-index-includes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("index.html decomposition", () => {
  it("keeps on-disk index.html under 5000 lines", () => {
    const source = readFileSync(join(repoRoot, "index.html"), "utf8");
    const lines = source.split("\n").length;
    assert.ok(lines < 5000, `index.html is ${lines} lines; target is <5000`);
  });

  it("expands partial includes into full dashboard markup", () => {
    const expanded = expandIndexIncludes(
      readFileSync(join(repoRoot, "index.html"), "utf8"),
      repoRoot,
    );
    assert.match(expanded, /id="discoveryDrawer"/);
    assert.match(expanded, /id="discoveryPathsModal"/);
    assert.match(expanded, /id="ingestManualModal"/);
    assert.ok(
      expanded.split("\n").length > 5500,
      "expanded markup should retain full modal surface area",
    );
  });
});
