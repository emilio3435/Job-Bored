import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   The discovery webhook URL and secret must not vanish with the sheet id.

   app-config-core's getters read through getConfig(), which returns null
   whenever cfg.sheetId does not parse. That coupling is right for the
   sheet-shaped getters and wrong for the discovery ones: a saved webhook
   secret is exactly as valid with a masked sheet id as without, and the
   run path took the missing secret at face value — the worker 401'd and
   the user was told to run a bootstrap command (Emilio, 2026-09-02).
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configCoreJs = readFileSync(join(repoRoot, "app-config-core.js"), "utf8");

function loadConfigCore(config) {
  const window = {
    COMMAND_CENTER_CONFIG: { ...config },
    JobBoredApp: { core: { host: {} } },
    location: { search: "", href: "http://localhost:8080/" },
  };
  const ctx = vm.createContext({
    window,
    console,
    URL,
    URLSearchParams,
    sessionStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(configCoreJs, ctx, { filename: "app-config-core.js" });
  return window.JobBoredApp.configCore;
}

const SECRET = "0123456789abcdef0123456789abcdef";
const URL_TS = "https://emilios-mac.tailnet.ts.net/webhook";

describe("discovery webhook getters survive a blank sheet id", () => {
  it("returns the saved secret when sheetId is masked to ''", () => {
    const core = loadConfigCore({ sheetId: "", discoveryWebhookSecret: SECRET });
    assert.equal(core.getDiscoveryWebhookSecret(), SECRET);
  });

  it("returns the saved webhook URL when sheetId is masked to ''", () => {
    const core = loadConfigCore({ sheetId: "", discoveryWebhookUrl: URL_TS });
    assert.equal(core.getDiscoveryWebhookUrl(), URL_TS);
  });

  it("still trims and blanks an unset secret", () => {
    const core = loadConfigCore({ sheetId: "", discoveryWebhookSecret: "   " });
    assert.equal(core.getDiscoveryWebhookSecret(), "");
    assert.equal(loadConfigCore({}).getDiscoveryWebhookSecret(), "");
  });

  it("getConfig() itself still nulls without a sheet — only the discovery getters decouple", () => {
    const core = loadConfigCore({ sheetId: "", discoveryWebhookSecret: SECRET });
    assert.equal(core.getConfig(), null);
  });
});
