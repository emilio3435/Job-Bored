// HOLES HUNT-FE: the Hunts sub-tab is wired into the discovery drawer (spec
// §1: HUNT owns DISCOVERY_SUBTAB_ORDER's entry, #dd-tab-hunts and
// #dd-panel-hunts), its markup is inlined in the drawer partial (§1b.3: no
// nested @include), index.html loads it in a HUNT-FE tag block, and its CSS
// is tokens-only and phone-safe.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createDom } from "./fixtures/jb-a11y-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

function bootDrawer() {
  const dom = createDom();
  const drawer = dom.make("div", { id: "discoveryDrawer" });
  const tablist = dom.make("nav", { id: "discoverySubtabs", role: "tablist" }, drawer);
  const ids = ["search", "sources", "automation", "connection", "history", "hunts"];
  for (const id of ids) {
    dom.make("button", { id: `dd-tab-${id}`, role: "tab", "data-subtab": id }, tablist);
    dom.make("section", { id: `dd-panel-${id}`, role: "tabpanel" }, drawer);
  }
  vm.runInNewContext(read("discovery-drawer.js"), dom.context, { filename: "discovery-drawer.js" });
  dom.window.JobBoredDiscovery.drawer.initDiscoverySubtabs();
  return dom;
}

test("HUNT-FE-DRAWER-1: Hunts is the sixth sub-tab, after History, and switches like the others", () => {
  const dom = bootDrawer();
  assert.deepEqual(
    Array.from(dom.window.JobBoredDiscoveryDrawerSubtabs.ORDER),
    ["search", "sources", "automation", "connection", "history", "hunts"],
  );
  const doc = dom.document;
  doc.getElementById("dd-tab-hunts").click();
  assert.equal(doc.getElementById("dd-tab-hunts").getAttribute("aria-selected"), "true");
  assert.equal(doc.getElementById("dd-tab-hunts").getAttribute("tabindex"), "0");
  assert.equal(doc.getElementById("dd-panel-hunts").hidden, false);
  assert.equal(doc.getElementById("dd-panel-history").hidden, true);
  doc.getElementById("dd-tab-history").click();
  dom.pressOn(doc.getElementById("dd-tab-history"), "ArrowRight");
  assert.equal(doc.getElementById("dd-panel-hunts").hidden, false, "ArrowRight from History lands on Hunts");
});

test("HUNT-FE-DRAWER-2: the partial carries the Hunts tab and an inlined panel with its mount points", () => {
  const html = read("partials/discovery-drawer.html");
  const historyTab = html.indexOf('id="dd-tab-history"');
  const huntsTab = html.indexOf('id="dd-tab-hunts"');
  assert.ok(historyTab > 0 && huntsTab > historyTab, "the Hunts tab follows History");
  const tab = html.slice(html.lastIndexOf("<button", huntsTab), html.indexOf("</button>", huntsTab));
  for (const attr of [
    'role="tab"',
    'class="discovery-subtab"',
    'data-subtab="hunts"',
    'aria-controls="dd-panel-hunts"',
    'aria-selected="false"',
    'tabindex="-1"',
  ]) {
    assert.ok(tab.includes(attr), `tab has ${attr}`);
  }
  const historyPanel = html.indexOf('id="dd-panel-history"');
  const start = html.indexOf('id="dd-panel-hunts"');
  assert.ok(start > historyPanel, "the Hunts panel follows History");
  const panel = html.slice(html.lastIndexOf("<section", start), html.indexOf("<!-- /HUNT-FE", start));
  for (const attr of ['role="tabpanel"', 'aria-labelledby="dd-tab-hunts"', "hidden"]) {
    assert.ok(panel.includes(attr), `panel has ${attr}`);
  }
  assert.match(panel, /data-hunts-status[^>]*role="status"[^>]*aria-live="polite"|role="status"[^>]*aria-live="polite"[^>]*data-hunts-status/);
  for (const mount of ["data-hunts-hitlist", "data-hunts-saved", "data-hunts-oneoffs", "data-hunts-oneoffs-wrap"]) {
    assert.ok(panel.includes(mount), `panel has ${mount}`);
  }
  assert.equal((panel.match(/role="list"/g) || []).length, 3, "three lists keep list semantics");
  assert.match(panel, /<h3[^>]*>Hitlist<\/h3>/);
  assert.match(panel, /<h3[^>]*>Saved hunts<\/h3>/);
  assert.equal(panel.includes("@include"), false, "no nested include");
});

test("HUNT-FE-DRAWER-3: index.html loads the hunts stylesheet and deferred scripts in a HUNT-FE block, before app-bootstrap", () => {
  const html = read("index.html");
  assert.match(html, /<!-- HUNT-FE[^>]*-->\s*<link rel="stylesheet" href="css\/hunts\.css" \/>/);
  const at = (needle) => {
    const i = html.indexOf(needle);
    assert.ok(i > 0, `index.html has ${needle}`);
    return i;
  };
  const drawer = at('<script src="discovery-drawer.js');
  const hitlist = at('<script src="hunts-hitlist.js?v=1" defer></script>');
  const store = at('<script src="hunts-store.js?v=1" defer></script>');
  const ui = at('<script src="hunts-ui.js?v=1" defer></script>');
  const boot = at('<script src="app-bootstrap.js');
  assert.ok(drawer < hitlist && hitlist < store && store < ui && ui < boot);
  assert.ok(html.lastIndexOf("<!-- HUNT-FE", hitlist) > drawer, "scripts sit in a HUNT-FE block");
});

test("HUNT-FE-DRAWER-4: css/hunts.css is tokens-only, focus-visible and laid out for 375px", () => {
  const css = read("css/hunts.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(css), false, "no hex colours");
  assert.equal(/\b(?:rgba?|hsla?)\(/i.test(css), false, "no rgb()/hsl() colours");
  assert.match(css, /\.hunts-switch:focus-visible\s*\{[^}]*var\(--jb-focus-color\)/);
  assert.match(css, /\.hunts-switch\[aria-checked="true"\]/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /min-height: 2\.75rem/, "44px touch targets");
  assert.match(css, /overflow-wrap: anywhere/, "long labels wrap instead of scrolling sideways");
});
