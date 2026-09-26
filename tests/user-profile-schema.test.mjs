import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStarterTemplate,
  listStarterTemplateIds,
  validateProfile,
} from "../server/user-profile.mjs";

describe("user-profile schema", () => {
  it("F10: accepts writingSamples so the drafter voice branch can run", () => {
    const tpl = buildStarterTemplate(listStarterTemplateIds()[0]);
    const out = validateProfile({
      ...tpl,
      writingSamples: ["Short declarative sentences. Concrete nouns."],
    });
    assert.equal(out.ok, true, JSON.stringify(out.errors || []));
  });

  it("F10: still rejects unknown top-level fields", () => {
    const tpl = buildStarterTemplate(listStarterTemplateIds()[0]);
    const out = validateProfile({ ...tpl, bogusField: 1 });
    assert.equal(out.ok, false);
  });
});
