import assert from "node:assert/strict";
import net from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyNetDefaults } from "../server/net-defaults.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("importing net-defaults sets a 2000 ms attempt timeout", () => {
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), 2000);
});

test("JOBBORED_NET_FAMILY_ATTEMPT_MS overrides the timeout; 0 leaves it alone", () => {
  assert.equal(applyNetDefaults({ JOBBORED_NET_FAMILY_ATTEMPT_MS: "3500" }), 3500);
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), 3500);
  assert.equal(applyNetDefaults({ JOBBORED_NET_FAMILY_ATTEMPT_MS: "0" }), null);
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), 3500);
  assert.equal(applyNetDefaults({ JOBBORED_NET_FAMILY_ATTEMPT_MS: "junk" }), 2000);
  assert.equal(applyNetDefaults({}), 2000);
});

for (const entry of [
  "server/index.mjs",
  "dev-server.mjs",
  "scripts/start-scraper-local.mjs",
  "scripts/start-discovery-worker-local.mjs",
  "integrations/browser-use-discovery/src/server.ts",
]) {
  test(`${entry} imports net-defaults before any other import`, () => {
    const src = readFileSync(join(root, entry), "utf8");
    const imports = [...src.matchAll(/^import\s.*$/gm)].map((m) => m[0]);
    assert.match(imports[0], /net-defaults\.mjs";$/);
  });
}
