import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineCss = readFileSync(join(repoRoot, "pipeline.css"), "utf8");

function ruleBody(selector) {
  const idx = pipelineCss.indexOf(selector + " {");
  assert.ok(idx >= 0, `pipeline.css should declare ${selector}`);
  return pipelineCss.slice(idx, pipelineCss.indexOf("}", idx));
}

describe("UX01 C2 / AX-06: pressed pipeline chip contrast", () => {
  it("a pressed chip on the mint fill uses --jb-on-accent text, not inverse ink", () => {
    const body = ruleBody(
      'body.jb-v2 [data-region="pipeline"] .pipe-tool__chip[aria-pressed="true"]',
    );
    assert.match(body, /background:\s*var\(--jb-mint\)/);
    assert.match(body, /color:\s*var\(--jb-on-accent\)/);
    assert.doesNotMatch(body, /--jb-ink-inverse/);
  });
});
