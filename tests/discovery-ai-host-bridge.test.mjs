import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const bridgeRegistryJs = readFileSync(
  new URL("../bridge-registry.js", import.meta.url),
  "utf8",
);
const drawerJs = readFileSync(
  new URL("../discovery-drawer.js", import.meta.url),
  "utf8",
);

describe("discovery AI host bridge", () => {
  it("does not bind extracted drawer AI helpers as bare identifiers at bridge registration", () => {
    const drawerBridgeStart = bridgeRegistryJs.indexOf(
      "discovery.drawer.host = {",
    );
    assert.ok(drawerBridgeStart > 0, "drawer host bridge should exist");

    const drawerBridgeEnd = bridgeRegistryJs.indexOf("};", drawerBridgeStart);
    const drawerBridge = bridgeRegistryJs.slice(
      drawerBridgeStart,
      drawerBridgeEnd,
    );

    assert.doesNotMatch(drawerBridge, /\bcallDiscoveryAiGemini,\s*$/m);
    assert.doesNotMatch(drawerBridge, /\bcallDiscoveryAiOpenAI,\s*$/m);
    assert.doesNotMatch(drawerBridge, /\bcallDiscoveryAiAnthropic,\s*$/m);
    assert.match(
      drawerBridge,
      /callDiscoveryAiGemini\(\.\.\.args\)\s*\{\s*return discovery\.drawer\.callDiscoveryAiGemini\(\.\.\.args\);/s,
    );
  });

  it("exports the drawer AI helpers used by app and onboarding host bridges", () => {
    const exportStart = drawerJs.indexOf("Object.assign(drawer, {");
    assert.ok(exportStart > 0, "drawer export block should exist");

    const exportEnd = drawerJs.indexOf("});", exportStart);
    const exportsBlock = drawerJs.slice(exportStart, exportEnd);

    for (const helper of [
      "parseJsonSafeForSuggestions",
      "resolveGeminiModel",
      "callDiscoveryAiGemini",
      "callDiscoveryAiOpenAI",
      "callDiscoveryAiAnthropic",
    ]) {
      assert.match(exportsBlock, new RegExp(`\\b${helper}\\b`));
    }
  });
});
