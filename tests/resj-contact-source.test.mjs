import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suggestContactFromSources } from "../server/profile-resume-sync.mjs";

/* ============================================================
   RESJ K2 review fix K2-SOURCE (Grok, 1caa65dc): "merged" only
   when the browser's text really added a field. Fictional text.
   ============================================================ */

describe("suggestContactFromSources names the source honestly (K2-SOURCE)", () => {
  const SAVED = "Jordan Rivera\nGrowth Marketing Leader\nAustin, TX | (512) 555-0147 | jordan.rivera@example.com\n";

  it("should say 'stored' when the browser's readable text had no details at all", async () => {
    const note = "Job search notes, 2026: keep applying to growth roles this spring.\n";
    const result = await suggestContactFromSources({ resumeText: note }, { readSaved: async () => SAVED });
    assert.equal(result.source, "stored");
    assert.equal(result.requestGarbled, false);
    assert.equal(result.values.email, "jordan.rivera@example.com");
  });

  it("should still say 'merged' when both sources added fields", async () => {
    const partial = "Jordan Rivera\nHead of Growth\njordan@rivera.example.org\n";
    const result = await suggestContactFromSources({ resumeText: partial }, { readSaved: async () => SAVED });
    assert.equal(result.source, "merged");
  });
});
