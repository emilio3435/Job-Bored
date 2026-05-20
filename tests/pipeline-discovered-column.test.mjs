import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");
const pipelineCss = readFileSync(join(repoRoot, "pipeline.css"), "utf8");

describe("v2 pipeline Discovered column", () => {
  it("places the Discovered stage before Researching", () => {
    const discovered = pipelineJs.indexOf('{ key: "new",          label: "Discovered" }');
    const researching = pipelineJs.indexOf('{ key: "researching",  label: "Researching" }');

    assert.ok(discovered >= 0, "STAGES should include the new/Discovered stage");
    assert.ok(researching >= 0, "STAGES should include Researching");
    assert.ok(discovered < researching, "Discovered must be the far-left stage");
  });

  it("renders discovered jobs as normal draggable sticker cards", () => {
    assert.ok(
      pipelineJs.includes('var cards = s.key === "new" ? (vm.untriaged || []) : (stageMap[s.key] || []);'),
      "new/discovered should source cards from vm.untriaged inside the normal column loop",
    );
    assert.ok(
      pipelineJs.includes("frag.appendChild(StickerCard(c, { stage: s.key }))"),
      "discovered cards should render through StickerCard, not a separate button rail",
    );
    assert.ok(
      pipelineJs.includes('e.target.closest(".pipe-sticker[data-stable-key]")'),
      "drag binding should apply to discovered cards because they are pipe-sticker elements",
    );
  });

  it("removes the old right-side untriaged rail", () => {
    assert.equal(pipelineJs.includes("pipe-untri"), false, "pipeline renderer should not emit the old rail");
    assert.equal(pipelineCss.includes("pipe-untri"), false, "pipeline CSS should not keep old rail selectors");
    assert.ok(
      pipelineCss.includes("var(--pipe-col-new)") &&
        pipelineCss.includes("var(--pipe-col-researching)") &&
        pipelineCss.includes("var(--pipe-col-offer)") &&
        pipelineCss.includes("var(--pipe-col-expired)"),
      "pipeline board should allocate real column tracks for visible stages",
    );
  });
});
