import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wizard = readFileSync(join(root, "fit-profile-wizard.js"), "utf8");
const editor = readFileSync(join(root, "fit-profile-editor.js"), "utf8");

describe("ONEFLOW L2 — Settings fit-profile copy matches repaired behavior", () => {
  it("L2-FIT-HINT: says locations apply only to hybrid/onsite, never Any or Remote only", () => {
    assert.match(
      wizard,
      /Used only when Hybrid OK or Onsite OK is selected\. Any and Remote only ignore this\./,
    );
  });

  it("L2-FIT-EDITOR-COPY: names the rendered Rescore button without the Task #6 fossil", () => {
    assert.doesNotMatch(editor, /Task #6/);
    assert.match(editor, /click Rescore\./);
  });
});
