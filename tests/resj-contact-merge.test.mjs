import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suggestContactFromSources } from "../server/profile-resume-sync.mjs";

/* ============================================================
   RESJ K2-OTHER merged the request's links with the saved
   resume's. JOBQA removes that merge: on a shared computer the
   saved resume can be someone else's, and the merge put their
   phone and links on a new person's form. The request's text is
   now read alone. Fictional text only.
   ============================================================ */

describe("contact suggestions never mix in the saved resume's details (JOBQA, was K2-OTHER)", () => {
  const REQUEST = "Ada Lovelace\nData Engineer\nnotes.example.org | blog.example.org | speakerdeck.com/ada\n";
  const SAVED = "Morgan Existing\nPlatform Architect\n(555) 010-2222 | github.com/morgan-existing | behance.net/morgan\n";

  it("should suggest only what the uploaded text has, even when the saved resume has more", async () => {
    let savedRead = false;
    const result = await suggestContactFromSources(
      { resumeText: REQUEST },
      { readSaved: async () => ((savedRead = true), SAVED) },
    );
    assert.equal(result.source, "request");
    assert.equal(savedRead, false, "the saved resume is not even read when the browser sends text");
    assert.match(result.values.links.website, /notes\.example\.org/);
    assert.equal(result.values.phone, undefined, "no phone from the saved resume");
    assert.equal(result.values.links.github, undefined, "no GitHub from the saved resume");
    const others = (result.values.links.other || []).map((o) => o.url).join(" ");
    assert.doesNotMatch(others, /behance|morgan/i, "no saved-resume links in the overflow either");
  });

  it("should read the saved resume only on an explicit source:saved with no text (Settings' Re-fill)", async () => {
    const result = await suggestContactFromSources({ source: "saved" }, { readSaved: async () => SAVED });
    assert.equal(result.source, "stored");
    assert.match(result.values.links.github, /github\.com\/morgan-existing/);
  });
});
