import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildStarterTemplate,
  listStarterTemplateIds,
  readProfile,
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

  it("F17: readProfile reports a hand-edited invalid file as invalid_profile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-profile-read-"));
    process.env.JOBBORED_PROFILE_PATH = join(dir, "profile.json");
    writeFileSync(process.env.JOBBORED_PROFILE_PATH, JSON.stringify({ version: 1 }));
    const out = await readProfile();
    assert.equal(out.ok, false);
    assert.equal(out.reason, "invalid_profile");
  });
});
