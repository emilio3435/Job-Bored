import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildStarterTemplate,
  listStarterTemplateIds,
  readProfile,
  writeProfileAtomic,
} from "../server/user-profile.mjs";

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "jb-profile-atomic-"));
  process.env.JOBBORED_PROFILE_PATH = join(dir, "profile.json");
  return dir;
}

describe("F6: writeProfileAtomic", () => {
  it("never exposes a no_profile window to concurrent readers", async () => {
    const dir = sandbox();
    const tpl = buildStarterTemplate(listStarterTemplateIds()[0]);
    await writeProfileAtomic(tpl);
    let missing = 0;
    let reads = 0;
    let done = false;
    const reader = (async () => {
      while (!done) {
        reads += 1;
        const r = await readProfile();
        if (!r.ok && r.reason === "no_profile") missing += 1;
        await new Promise((r2) => setImmediate(r2));
      }
    })();
    for (let i = 0; i < 20; i += 1) {
      await writeProfileAtomic({ ...tpl });
    }
    done = true;
    await reader;
    assert.ok(reads > 0, `expected concurrent reads in ${dir}`);
    assert.equal(missing, 0, `${missing}/${reads} reads saw no_profile`);
  });

  it("prunes backups instead of growing one per save", async () => {
    sandbox();
    const tpl = buildStarterTemplate(listStarterTemplateIds()[0]);
    for (let i = 0; i < 12; i += 1) {
      await writeProfileAtomic({ ...tpl });
    }
    const backups = readdirSync(join(process.env.JOBBORED_PROFILE_PATH, "..")).filter((n) =>
      n.includes(".bak."),
    );
    assert.ok(backups.length <= 5, `expected <= 5 backups, saw ${backups.length}`);
    assert.ok(backups.length >= 1, "expected at least one backup to survive");
  });
});
