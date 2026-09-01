import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getApplicationsRoot,
  migrateHermesApplicationsIfNeeded,
} from "../server/application-materials.mjs";

describe("getApplicationsRoot", () => {
  it("prefers JOBBORED_APPLICATIONS_ROOT", () => {
    assert.equal(
      getApplicationsRoot({ JOBBORED_APPLICATIONS_ROOT: "/tmp/jb-apps" }),
      "/tmp/jb-apps",
    );
  });

  it("falls back to HERMES_APPLICATIONS_ROOT for tests", () => {
    assert.equal(
      getApplicationsRoot({ HERMES_APPLICATIONS_ROOT: "/tmp/hermes-apps" }),
      "/tmp/hermes-apps",
    );
  });

  it("defaults under ~/.jobbored/applications", () => {
    const root = getApplicationsRoot({});
    assert.match(root, /\.jobbored\/applications$/);
  });
});

describe("migrateHermesApplicationsIfNeeded", () => {
  it("copies leftover Hermes packages into an empty JobBored root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-mig-"));
    const hermes = join(dir, "hermes");
    const dest = join(dir, "jobbored");
    await mkdir(join(hermes, "eab-role"), { recursive: true });
    await writeFile(join(hermes, "eab-role", "pending.json"), "{}");
    const result = await migrateHermesApplicationsIfNeeded({
      JOBBORED_APPLICATIONS_ROOT: dest,
      HERMES_APPLICATIONS_LEGACY_ROOT: hermes,
    });
    assert.equal(result.copied, 1);
    assert.equal(await readFile(join(dest, "eab-role", "pending.json"), "utf8"), "{}");
    await rm(dir, { recursive: true, force: true });
  });

  it("does not copy when dest already has a slug", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-mig-"));
    const hermes = join(dir, "hermes");
    const dest = join(dir, "jobbored");
    await mkdir(join(hermes, "eab-role"), { recursive: true });
    await writeFile(join(hermes, "eab-role", "pending.json"), "{}");
    await mkdir(join(dest, "other"), { recursive: true });
    await writeFile(join(dest, "other", "pending.json"), "{}");
    const result = await migrateHermesApplicationsIfNeeded({
      JOBBORED_APPLICATIONS_ROOT: dest,
      HERMES_APPLICATIONS_LEGACY_ROOT: hermes,
    });
    assert.equal(result.copied, 0);
    await rm(dir, { recursive: true, force: true });
  });
});
