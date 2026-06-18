import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeCanaryLabel } from "./fixtures/codex-autopilot-canary.mjs";

describe("Codex autopilot canary", () => {
  it("normalizes labels for stable PR automation reports", () => {
    assert.equal(normalizeCanaryLabel("  PR Autopilot Canary  "), "pr-autopilot-canary");
  });
});
