import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suggestContactFromSources } from "../server/profile-resume-sync.mjs";

/* ============================================================
   RESJ K2-SOURCE, under JOBQA's rule: the browser's text is read
   alone. "stored" only answers an explicit source:saved request;
   "merged" no longer exists. Fictional text.
   ============================================================ */

describe("suggestContactFromSources names the source honestly (K2-SOURCE, JOBQA)", () => {
  const SAVED = "Jordan Rivera\nGrowth Marketing Leader\nAustin, TX | (512) 555-0147 | jordan.rivera@example.com\n";

  it("should say 'none' when the browser's readable text had no details, and never fall back to the saved resume", async () => {
    const note = "Job search notes, 2026: keep applying to growth roles this spring.\n";
    const result = await suggestContactFromSources({ resumeText: note }, { readSaved: async () => SAVED });
    assert.equal(result.source, "none");
    assert.equal(result.requestGarbled, false);
    assert.deepEqual(result.values, {});
  });

  it("should say 'request' when the browser's text has details, with nothing added from the saved resume", async () => {
    const partial = "Jordan Rivera\nHead of Growth\njordan@rivera.example.org\n";
    const result = await suggestContactFromSources({ resumeText: partial }, { readSaved: async () => SAVED });
    assert.equal(result.source, "request");
    assert.equal(result.values.email, "jordan@rivera.example.org");
    assert.equal(result.values.phone, undefined, "the saved phone stays out");
  });

  it("should say 'stored' only for an explicit source:saved request with no text", async () => {
    const result = await suggestContactFromSources({ source: "saved" }, { readSaved: async () => SAVED });
    assert.equal(result.source, "stored");
    assert.equal(result.values.email, "jordan.rivera@example.com");
  });
});
