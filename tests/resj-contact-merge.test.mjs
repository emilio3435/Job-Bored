import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suggestIdentityFromResume } from "../server/profile-identity.mjs";
import { mergeSuggestions, suggestContactFromSources } from "../server/profile-resume-sync.mjs";

/* ============================================================
   RESJ K2 review fix K2-OTHER (Grok, 1caa65dc): the merge keeps
   overflow links from both resumes.
   Fictional text only.
   ============================================================ */

/** @param {string[]} urls */
function withOther(urls) {
  const s = suggestIdentityFromResume("");
  s.links.other = urls.map((url) => ({ value: { label: new URL(url).hostname, url }, confidence: 0.5 }));
  return s;
}

describe("mergeSuggestions keeps overflow links from both sources (K2-OTHER)", () => {
  it("should union other-links by URL, request order first, capped at three", () => {
    const request = withOther(["https://notes.example.org/", "https://blog.example.org/"]);
    const saved = withOther(["https://blog.example.org/", "https://portfolio.example.net/", "https://talks.example.net/"]);
    const { suggestions, usedSecondary } = mergeSuggestions(request, saved);
    assert.deepEqual(
      suggestions.links.other.map((o) => o.value.url),
      ["https://notes.example.org/", "https://blog.example.org/", "https://portfolio.example.net/"],
    );
    assert.equal(usedSecondary, true, "a link only the saved resume had counts as its contribution");
  });

  it("should not count a duplicate link as the saved resume's contribution", () => {
    const request = withOther(["https://blog.example.org/"]);
    const saved = withOther(["https://blog.example.org/"]);
    assert.equal(mergeSuggestions(request, saved).usedSecondary, false);
  });
});

describe("the saved resume's website survives losing the one website slot (K2-OTHER round 2)", () => {
  it("should move the saved website into the other links, request links first, cap three", async () => {
    const request = "Ada Lovelace\nData Engineer\nnotes.example.org | blog.example.org | speakerdeck.com/ada\n";
    const saved = "Ada Lovelace\nData Engineer\n(555) 010-2222 | github.com/ada-lovelace | behance.net/ada\n";
    const result = await suggestContactFromSources({ resumeText: request }, { readSaved: async () => saved });
    assert.equal(result.source, "merged");
    assert.match(result.values.links.website, /notes\.example\.org/);
    assert.match(result.values.links.github, /github\.com\/ada-lovelace/);
    const others = result.values.links.other.map((o) => o.url);
    assert.equal(others.length, 3, JSON.stringify(others));
    assert.match(others[0], /blog\.example\.org/);
    assert.match(others[1], /speakerdeck\.com\/ada/);
    assert.match(others[2], /behance\.net\/ada/, "the saved website is kept, not dropped");
  });
});
