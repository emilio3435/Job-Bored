import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const jbV2Css = readFileSync(join(repoRoot, "jb-v2.css"), "utf8");
const chromeCss = readFileSync(join(repoRoot, "flowing-chrome.css"), "utf8");
const dawnCss = readFileSync(join(repoRoot, "dawn.css"), "utf8");
const pipelineCss = readFileSync(join(repoRoot, "pipeline.css"), "utf8");
const latticeCss = readFileSync(join(repoRoot, "lattice.css"), "utf8");

describe("v2 flowing page width", () => {
  it("defines one shared content width for dashboard and kanban regions", () => {
    assert.ok(
      jbV2Css.includes("--jb-flow-max: 1220px;") &&
        jbV2Css.includes("--jb-flow-gutter: clamp(16px, 3vw, 32px);") &&
        jbV2Css.includes("--jb-flow-content-width: min("),
      "jb-v2.css should define the shared v2 content width tokens",
    );
  });

  it("aligns the sticky top chrome to the same content gutter", () => {
    assert.ok(
        chromeCss.includes("padding-inline: max(") &&
        chromeCss.includes("var(--jb-flow-gutter, 32px)") &&
        chromeCss.includes("var(--jb-flow-max, 1220px)") &&
        chromeCss.includes("calc((100% - var(--jb-flow-max, 1220px)) / 2)") &&
        chromeCss.includes("padding-inline: var(--jb-flow-gutter, 12px);") &&
        chromeCss.includes("right: var(--jb-flow-gutter, 18px);"),
      "flowing top chrome should align with the shared dashboard width",
    );
  });

  it("uses the shared content width for the brief and kanban surfaces", () => {
    for (const [name, css] of [
      ["dawn.css", dawnCss],
      ["pipeline.css", pipelineCss],
      ["lattice.css", latticeCss],
    ]) {
      assert.ok(
        css.includes("width: var(--jb-flow-content-width") &&
          css.includes("margin:") &&
          css.includes("auto"),
        `${name} should center itself on the shared v2 content width`,
      );
    }
  });
});
