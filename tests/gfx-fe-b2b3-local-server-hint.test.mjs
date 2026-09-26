import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

/* GFX X1 / R13: localServerHint learns the desktop runtime. Once the ping
   says `runtime:"desktop"`, the JobBored app is how JobBored starts, so the
   one start sentence names the app; the source checkout keeps its Mac/other
   sentences, and the old positional signature keeps working. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function load(navigator) {
  const win = navigator ? { navigator } : {};
  const ctx = { window: win, setTimeout, clearTimeout, Object, Array, String, Number, JSON, Promise, URL };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, "local-server.js"), "utf8"), ctx);
  return win.JobBoredLocalServer;
}

describe("GFX X1 · R13 · localServerHint({ platform, runtime })", () => {
  const api = load();

  it("names the JobBored app on the desktop runtime, whatever the platform", () => {
    for (const platform of ["MacIntel", "Win32", "Linux x86_64", undefined]) {
      assert.equal(api.localServerHint({ platform, runtime: "desktop" }), "open the JobBored app");
    }
  });

  it("keeps the source-checkout sentences for any other runtime", () => {
    assert.equal(
      api.localServerHint({ platform: "MacIntel", runtime: "source" }),
      "double-click start.command in the JobBored folder",
    );
    assert.equal(api.localServerHint({ platform: "Win32", runtime: "" }), "run ./start.sh in the JobBored folder");
    assert.equal(api.localServerHint({ platform: "Linux x86_64" }), "run ./start.sh in the JobBored folder");
  });

  it("an object without a platform reads the navigator", () => {
    const mac = load({ platform: "MacIntel" });
    assert.equal(mac.localServerHint({ runtime: "source" }), "double-click start.command in the JobBored folder");
    assert.equal(mac.localServerHint({}), "double-click start.command in the JobBored folder");
  });

  it("the old positional signature still works", () => {
    assert.equal(api.localServerHint("MacIntel"), "double-click start.command in the JobBored folder");
    assert.equal(api.localServerHint("Win32"), "run ./start.sh in the JobBored folder");
    assert.equal(load({ platform: "MacIntel" }).localServerHint(), "double-click start.command in the JobBored folder");
  });
});
