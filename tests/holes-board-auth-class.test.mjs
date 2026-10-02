/**
 * HOLES BOARD — B10: the v2 regions reveal on a class app-bootstrap.js owns,
 * not on a style-string :has().
 *
 * jb-v2-legacy-hide.css revealed .page-top and the region hosts only while
 * #dashboard's inline style attribute did not contain the literal text
 * "display: none". That is a match on how a writer happens to spell the style,
 * not on whether the dashboard is shown. app-bootstrap.js now keeps
 * body.jb-authed in step with #dashboard's visibility (set when the script
 * runs, then kept by a MutationObserver on the style attribute), and the CSS
 * gates on body.jb-v2.jb-authed with the declarations it always had.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const bootstrapJs = read("app-bootstrap.js");
const legacyHideCss = read("jb-v2-legacy-hide.css");

function makeEl(id) {
  const classes = new Set();
  return {
    id,
    style: {},
    dataset: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle(c, force) {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
  };
}

/** MutationObserver stand-in: records what it watches; the test fires it. */
function makeObserverClass() {
  const instances = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      instances.push(this);
    }
    observe(target, options) {
      this.targets.push({ target, options });
    }
    disconnect() {
      this.targets = [];
    }
  }
  return {
    FakeMutationObserver,
    instances,
    /** Deliver a style-attribute mutation on `target` to every observer of it. */
    styleChanged(target) {
      for (const mo of instances) {
        if (!mo.targets.some((t) => t.target === target)) continue;
        mo.callback([{ type: "attributes", attributeName: "style", target }], mo);
      }
    },
  };
}

/**
 * Run app-bootstrap.js the way the deferred script runs: the body exists,
 * DOMContentLoaded has not fired, body.jb-v2 is not set yet.
 */
function runBootstrap({ dashboardDisplay = "none", withDashboard = true, withObserver = true } = {}) {
  const elements = new Map();
  const dashboard = withDashboard ? makeEl("dashboard") : null;
  if (dashboard && dashboardDisplay != null) dashboard.style.display = dashboardDisplay;
  if (dashboard) elements.set("dashboard", dashboard);
  const body = makeEl("body");
  const doc = {
    readyState: "loading",
    body,
    documentElement: makeEl("html"),
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  };
  const observers = makeObserverClass();
  const win = { JobBoredStartupLog: { mark() {} } };
  if (withObserver) win.MutationObserver = observers.FakeMutationObserver;
  const ctx = {
    window: win,
    document: doc,
    console: { info() {}, warn() {}, error() {}, log() {} },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    CustomEvent: class CustomEvent {},
  };
  vm.createContext(ctx);
  vm.runInContext(bootstrapJs, ctx, { filename: "app-bootstrap.js" });
  return {
    body,
    dashboard,
    observers,
    authed: () => body.classList.contains("jb-authed"),
    setDashboardDisplay(value) {
      dashboard.style.display = value;
      observers.styleChanged(dashboard);
    },
  };
}

/** Rules of a stylesheet as { selectors: string[], body: string }, comments stripped. */
function rulesOf(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")),
    body: m[2],
  }));
}

function ruleFor(css, selector) {
  return rulesOf(css).find((r) => r.selectors.includes(selector));
}

describe("B10 · app-bootstrap.js keeps body.jb-authed in step with #dashboard", () => {
  it("should set body.jb-authed as soon as the script runs when #dashboard is shown — before DOMContentLoaded adds body.jb-v2", () => {
    // index.html's prepaint guard strips the inline style for a cached session.
    assert.equal(runBootstrap({ dashboardDisplay: "" }).authed(), true);
    assert.equal(runBootstrap({ dashboardDisplay: "block" }).authed(), true);
  });

  it("should leave body.jb-authed off while #dashboard is display: none — signed-out pages keep the regions hidden", () => {
    assert.equal(runBootstrap({ dashboardDisplay: "none" }).authed(), false);
  });

  it("should follow every later #dashboard style write through a MutationObserver on its style attribute", () => {
    const env = runBootstrap({ dashboardDisplay: "none" });
    const watching = env.observers.instances.flatMap((mo) => mo.targets).filter((t) => t.target === env.dashboard);
    assert.equal(watching.length, 1, "exactly one observer on #dashboard");
    assert.equal(watching[0].options.attributes, true);
    assert.ok(
      Array.from(watching[0].options.attributeFilter || []).includes("style"),
      "the observer must watch the style attribute",
    );

    // revealDashboardShell() in sheet-access-setup.js
    env.setDashboardDisplay("block");
    assert.equal(env.authed(), true, "the dashboard is revealed after sign-in");
    // showSheetAccessGate() in sheet-access-setup.js
    env.setDashboardDisplay("none");
    assert.equal(env.authed(), false, "a gate in front of the dashboard hides the regions again");
  });

  it("should not throw without MutationObserver or #dashboard (vm harnesses, engines without the API) and leave the class off with no dashboard", () => {
    assert.doesNotThrow(() => runBootstrap({ withObserver: false, dashboardDisplay: "" }));
    assert.equal(runBootstrap({ withObserver: false, dashboardDisplay: "" }).authed(), true, "the initial sync still runs");
    let env;
    assert.doesNotThrow(() => {
      env = runBootstrap({ withDashboard: false });
    });
    assert.equal(env.authed(), false, "no #dashboard means no signed-in surface");
  });
});

describe("B10 · jb-v2-legacy-hide.css gates the v2 regions on body.jb-v2.jb-authed", () => {
  it("should no longer match the inline style text of #dashboard", () => {
    assert.ok(!legacyHideCss.includes('[style*="display: none"]'), "the style-string gate is gone");
    assert.doesNotMatch(legacyHideCss, /:has\(#dashboard/, "no :has(#dashboard ...) gate is left");
  });

  it("should reveal .page-top as flex once authed — the same declaration the style gate had", () => {
    const rule = ruleFor(legacyHideCss, "body.jb-v2.jb-authed .page-top");
    assert.ok(rule, "body.jb-v2.jb-authed .page-top rule must exist");
    assert.match(rule.body, /^\s*display:\s*flex !important;\s*$/);
  });

  for (const region of ["dawn", "today", "pipeline", "role"]) {
    it(`should reveal [data-region="${region}"] as block once authed`, () => {
      const rule = ruleFor(legacyHideCss, `body.jb-v2.jb-authed [data-region="${region}"]`);
      assert.ok(rule, `body.jb-v2.jb-authed [data-region="${region}"] rule must exist`);
      assert.match(rule.body, /^\s*display:\s*block !important;\s*$/);
    });
  }

  it("should reveal Welcome only in onboarding mode, as flex, once authed", () => {
    const rule = ruleFor(legacyHideCss, 'body.jb-v2.jb-authed [data-region="welcome"][data-mode="onboarding"]');
    assert.ok(rule, "the onboarding Welcome reveal must exist");
    assert.match(rule.body, /^\s*display:\s*flex !important;\s*$/);
  });

  it("should keep every region hidden by default until the class is set", () => {
    for (const sel of [
      "body.jb-v2 .page-top",
      'body.jb-v2 [data-region="dawn"]',
      'body.jb-v2 [data-region="today"]',
      'body.jb-v2 [data-region="pipeline"]',
      'body.jb-v2 [data-region="role"]',
      'body.jb-v2 [data-region="welcome"]',
    ]) {
      const rule = ruleFor(legacyHideCss, sel);
      assert.ok(rule, `${sel} default hide must exist`);
      assert.match(rule.body, /display:\s*none !important;/);
    }
  });
});
