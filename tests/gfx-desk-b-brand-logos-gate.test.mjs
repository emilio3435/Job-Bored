// GFX DESK-B blocker 3: on a fresh Mac /usr/bin/python3 is a shim that pops
// Apple's "Install developer tools" dialog, and the logo resolver runs on
// every profile save. It is skipped in desktop mode, when `xcode-select -p`
// fails, or when JOBBORED_LOGO_RESOLVER=off; uploads still become marks and
// everything else falls back to the renderer's monogram.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logoResolverGate, readResolvedMarks, runResolver } from "../server/brand-logos.mjs";

const PNG = Buffer.concat([
  Buffer.from("\x89PNG\r\n\x1a\n", "binary"),
  Buffer.from("0000000d49484452000000100000001008060000001ff3ff61", "hex"),
]);
const never = () => {
  throw new Error("the developer-tools probe must not run here");
};

describe("GFX-DESK-B blocker 3 logoResolverGate", () => {
  it("JOBBORED_LOGO_RESOLVER=off wins everywhere", () => {
    assert.deepEqual(
      logoResolverGate({ env: { JOBBORED_LOGO_RESOLVER: "off" }, platform: "linux", probeDeveloperTools: never }),
      { enabled: false, reason: "disabled" },
    );
  });

  it("desktop mode never probes and never runs python3", () => {
    assert.deepEqual(
      logoResolverGate({ env: { JOBBORED_DESKTOP: "1" }, platform: "darwin", probeDeveloperTools: never }),
      { enabled: false, reason: "desktop" },
    );
  });

  it("a Mac without developer tools skips it", () => {
    assert.deepEqual(
      logoResolverGate({ env: {}, platform: "darwin", probeDeveloperTools: () => false }),
      { enabled: false, reason: "developer_tools_missing" },
    );
  });

  it("a Mac with developer tools, and any other OS, runs it", () => {
    assert.equal(logoResolverGate({ env: {}, platform: "darwin", probeDeveloperTools: () => true }).enabled, true);
    assert.equal(logoResolverGate({ env: {}, platform: "linux", probeDeveloperTools: never }).enabled, true);
  });
});

describe("GFX-DESK-B blocker 3 runResolver behind the gate", () => {
  let root;
  let templateRoot;
  let marker;
  let savedPath;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "gfx-desk-b-logos-"));
    templateRoot = join(root, "logos");
    marker = join(root, "python3-was-run");
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "python3"), `#!/bin/sh\necho run >> '${marker}'\nexit 0\n`);
    chmodSync(join(bin, "python3"), 0o755);
    mkdirSync(join(templateRoot, "uploads"), { recursive: true });
    writeFileSync(join(templateRoot, "uploads", "logo-acme.png"), PNG);
    writeFileSync(
      join(templateRoot, "logos.json"),
      JSON.stringify({
        logos: [
          { slug: "acme", label: "Acme", upload: "uploads/logo-acme.png" },
          { slug: "globex", label: "Globex", domain: "globex.example" },
        ],
      }),
    );
    savedPath = process.env.PATH;
    process.env.PATH = `${bin}:${savedPath}`;
  });

  after(() => {
    process.env.PATH = savedPath;
    rmSync(root, { recursive: true, force: true });
  });

  it("skipped: no python3, the upload becomes a mark, the rest is a monogram", async () => {
    const rows = await runResolver({
      templateRoot,
      platform: "darwin",
      probeDeveloperTools: () => false,
    });
    assert.equal(existsSync(marker), false, "python3 never ran");
    assert.deepEqual(
      rows.map(({ slug, source }) => ({ slug, source })),
      [
        { slug: "acme", source: "upload" },
        { slug: "globex", source: "monogram" },
      ],
    );
    assert.deepEqual(readFileSync(join(templateRoot, "assets", "logo-acme.png")), PNG);
    const marks = await readResolvedMarks({ templateRoot });
    assert.deepEqual(marks.map((m) => m.slug), ["acme"]);
  });

  it("desktop mode skips it without probing", async () => {
    await runResolver({ templateRoot, env: { JOBBORED_DESKTOP: "1" }, probeDeveloperTools: never });
    assert.equal(existsSync(marker), false);
  });

  it("enabled: python3 runs as before", async () => {
    await runResolver({ templateRoot, env: {}, platform: "darwin", probeDeveloperTools: () => true });
    assert.equal(existsSync(marker), true, "the gate, not a missing python3, is what skipped it");
  });
});
