import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadLocalServer({ config, platform = "MacIntel" } = {}) {
  const win = { navigator: { platform } };
  if (config) win.COMMAND_CENTER_CONFIG = config;
  const ctx = { window: win, setTimeout, clearTimeout, Object, Array, String, Number, JSON, Promise, URL };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, "local-server.js"), "utf8"), ctx);
  return win.JobBoredLocalServer;
}

describe("GFX-R13 · the desktop app's own config names the start sentence", () => {
  it("says open the JobBored app when config.js carries jobBoredRuntime: desktop", () => {
    const api = loadLocalServer({ config: { jobBoredRuntime: "desktop" } });
    assert.equal(api.localServerHint(), "open the JobBored app");
    assert.equal(api.localServerHint("Linux x86_64"), "open the JobBored app");
  });

  it("keeps the source-checkout sentences without the config key", () => {
    assert.equal(
      loadLocalServer().localServerHint(),
      "double-click start.command in the JobBored folder",
    );
    assert.equal(
      loadLocalServer({ platform: "Linux x86_64" }).localServerHint(),
      "run ./start.sh in the JobBored folder",
    );
  });

  it("lets an explicit runtime override the config either way", () => {
    const api = loadLocalServer({ config: { jobBoredRuntime: "desktop" } });
    assert.equal(
      api.localServerHint({ platform: "MacIntel", runtime: "source" }),
      "double-click start.command in the JobBored folder",
    );
    assert.equal(
      loadLocalServer().localServerHint({ runtime: "desktop" }),
      "open the JobBored app",
    );
  });
});

describe("GFX-DOCK-375 · the phone dock stacks its message instead of wrapping it off-screen", () => {
  const css = readFileSync(join(ROOT, "css/oneflow.css"), "utf8");
  const phone = css.slice(css.indexOf(".discovery-setup-wizard--spine .discovery-setup-wizard__footer--dock {\n    position: sticky;"));

  it("turns wrapping off for a dock that holds a message or a busy line", () => {
    assert.match(
      phone,
      /__footer--dock:has\(> \.discovery-setup-wizard__message\),[\s\S]*?__footer--dock:has\(> \.discovery-setup-wizard__busy\) \{\s*flex-wrap: nowrap;/,
    );
  });

  it("lets the message size to its content in the column dock", () => {
    assert.match(phone, /__footer--dock\s+\.discovery-setup-wizard__message \{\s*flex: 0 0 auto;/);
  });
});
