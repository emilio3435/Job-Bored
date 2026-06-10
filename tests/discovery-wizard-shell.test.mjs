import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const shellSrc = readFileSync(
  join(repoRoot, "discovery-wizard-shell.js"),
  "utf8",
);

// =====================================================================
// Minimal DOM stub. renderWizardShell builds and mounts a real element
// tree, so the stub supports createElement, attribute storage, child
// trees, classList, basic [attr] selectors, and event listener
// tracking. requestAnimationFrame is a no-op so the focus pass skips —
// these tests assert structure, not focus behavior.
// =====================================================================

class FakeClassList {
  constructor() {
    this.classes = new Set();
  }
  add(...c) {
    for (const x of c) if (x) this.classes.add(x);
  }
  remove(...c) {
    for (const x of c) this.classes.delete(x);
  }
  contains(c) {
    return this.classes.has(c);
  }
  toggle(c, on) {
    if (on === undefined) {
      if (this.classes.has(c)) this.classes.delete(c);
      else this.classes.add(c);
      return !this.classes.has(c);
    }
    if (on) this.classes.add(c);
    else this.classes.delete(c);
    return on;
  }
}

function matches(node, sel) {
  if (!node || !sel) return false;
  const attrMatch = sel.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attrMatch) {
    const [, name, val] = attrMatch;
    // `id` is assigned as a property by createEl's `key in el` branch, so
    // the attrs Map never sees it — fall back to the id property.
    if (name === "id") {
      return val === undefined ? !!node.id : node.id === val;
    }
    if (val === undefined) return node.attrs && node.attrs.has(name);
    return node.attrs && node.attrs.get(name) === val;
  }
  if (sel.startsWith("#")) {
    return node.id === sel.slice(1);
  }
  if (sel.startsWith(".")) {
    return node.classList && node.classList.contains(sel.slice(1));
  }
  return false;
}

function findFirst(root, sel) {
  if (matches(root, sel)) return root;
  for (const c of root.children || []) {
    const found = findFirst(c, sel);
    if (found) return found;
  }
  return null;
}

function findAll(root, sel) {
  const out = [];
  if (matches(root, sel)) out.push(root);
  for (const c of root.children || []) out.push(...findAll(c, sel));
  return out;
}

class FakeEl {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this._text = "";
    this.id = "";
    this._listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.tabIndex = 0;
    this.htmlFor = "";
    this.type = "";
    this.value = "";
    this.placeholder = "";
    this.rows = 0;
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
    if (k === "hidden") this.hidden = true;
    if (k === "id") this.id = String(v);
  }
  getAttribute(k) {
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  removeAttribute(k) {
    this.attrs.delete(k);
    if (k === "hidden") this.hidden = false;
  }
  hasAttribute(k) {
    return this.attrs.has(k);
  }
  appendChild(child) {
    if (child) {
      this.children.push(child);
      child.parentNode = this;
    }
    return child;
  }
  append(...kids) {
    for (const c of kids) if (c) this.appendChild(c);
  }
  replaceChildren(...kids) {
    this.children = [];
    for (const c of kids) if (c) this.appendChild(c);
  }
  // Mirror real DOM semantics: className assignment syncs classList (the
  // shell's createEl sets el.className = "a b c"; class selectors must see it).
  get className() {
    return [...this.classList.classes].join(" ");
  }
  set className(v) {
    this.classList.classes = new Set(
      String(v || "")
        .split(/\s+/)
        .filter(Boolean),
    );
  }
  // Mirror real DOM semantics: reading textContent aggregates own text +
  // descendants (so assertions on parent nodes see child labels).
  get textContent() {
    return (
      this._text + this.children.map((c) => c.textContent || "").join("")
    );
  }
  set textContent(v) {
    this._text = String(v == null ? "" : v);
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get parentElement() {
    return this.parentNode;
  }
  get offsetParent() {
    return this.parentNode || null;
  }
  get offsetWidth() {
    return 0;
  }
  scrollIntoView() {}
  scrollBy() {}
  focus() {
    // Record focus so the a11y focus-on-open test can assert which element
    // the shell moved focus to. Harmless to structure tests (they never read
    // it). Also mirror the browser's document.activeElement via the owner doc.
    this.__focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  contains(el) {
    if (el === this) return true;
    for (const c of this.children) if (c.contains && c.contains(el)) return true;
    return false;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener() {}
  querySelector(sel) {
    return findFirst(this, sel);
  }
  querySelectorAll(sel) {
    return findAll(this, sel);
  }
  closest(sel) {
    let node = this;
    while (node) {
      if (matches(node, sel)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

function makeFakeDocument() {
  const elements = new Map();
  const doc = {
    activeElement: null,
    body: new FakeEl("body"),
    createElement(tag) {
      const el = new FakeEl(tag);
      el.ownerDocument = doc;
      return el;
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    register(id) {
      const el = new FakeEl("div");
      el.id = id;
      el.ownerDocument = doc;
      elements.set(id, el);
      return el;
    },
    contains() {
      return true;
    },
  };
  doc.body.ownerDocument = doc;
  return doc;
}

function loadShell({ rafImpl } = {}) {
  const doc = makeFakeDocument();
  doc.register("discoverySetupWizardMount");
  doc.register("goLiveSetupWizardMount");
  const win = {};
  const ctx = {
    window: win,
    document: doc,
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    // Structure tests keep rAF a no-op (focus pass skipped). The a11y test
    // passes a capturing impl so it can run the focus pass deterministically.
    requestAnimationFrame: rafImpl || (() => {}),
    Object,
    Set,
    Map,
    Array,
    Number,
  };
  vm.createContext(ctx);
  vm.runInContext(shellSrc, ctx, { filename: "discovery-wizard-shell.js" });
  return {
    window: win,
    document: doc,
    root: win.JobBoredDiscoveryWizard,
    shell: win.JobBoredDiscoveryWizard.shell,
  };
}

// =====================================================================
// Discovery-unchanged regression lock (spec §9). A no-`mountId`/no-
// `variant` `renderWizardShell` call must reproduce today's behavior
// exactly: mount id, header title, normalization.
// =====================================================================

describe("renderWizardShell defaults — discovery-unchanged regression lock", () => {
  it("root.mount.id is the discovery mount id", () => {
    const { root } = loadShell();
    assert.equal(root.mount.id, "discoverySetupWizardMount");
    assert.equal(root.mount.shellClassName, "discovery-setup-wizard-root");
  });

  it("normalizeSnapshot with no variant returns discovery readiness defaults", () => {
    const { shell } = loadShell();
    const out = shell.normalizeSnapshot({});
    // Discovery readiness fields must be filled in with documented defaults.
    assert.equal(out.engineState, "none");
    assert.equal(out.appsScriptState, "none");
    assert.equal(out.recommendedFlow, "local_agent");
    assert.equal(out.localRecoveryState, "ok");
    assert.equal(out.sheetConfigured, false);
    assert.equal(out.tunnelReady, false);
  });

  it("normalizeSnapshot coerces unknown enum values to discovery defaults", () => {
    const { shell } = loadShell();
    const out = shell.normalizeSnapshot({
      engineState: "totally_made_up",
      recommendedFlow: "not_a_flow",
    });
    assert.equal(out.engineState, "none");
    assert.equal(out.recommendedFlow, "local_agent");
  });

  it("normalizeWizardState with no variant uses 'detect' currentStep + discovery flow default", () => {
    const { shell } = loadShell();
    const out = shell.normalizeWizardState({});
    assert.equal(out.currentStep, "detect");
    assert.equal(out.flow, "local_agent");
    assert.equal(out.version, 1);
  });

  it("renderWizardShell with no mountId/variant renders into the discovery mount with 'Discovery setup' header", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      steps: [{ id: "detect", label: "Status", title: "T", description: "D" }],
      state: { currentStep: "detect" },
    });
    const discoveryMount = document.getElementById("discoverySetupWizardMount");
    const goLiveMount = document.getElementById("goLiveSetupWizardMount");
    // Discovery mount was opened.
    assert.equal(discoveryMount.hidden, false);
    assert.equal(discoveryMount.getAttribute("aria-hidden"), "false");
    // Go-live mount was NOT touched.
    assert.equal(goLiveMount.children.length, 0);
    // Header title is the discovery default.
    const titleNode = discoveryMount.querySelector(
      '[id="discoverySetupWizardTitle"]',
    );
    assert.ok(titleNode, "title h2 must be rendered");
    assert.equal(titleNode.textContent, "Discovery setup");
    // Context carries the headerTitle default and discovery variant.
    assert.equal(shell.lastRender.context.headerTitle, "Discovery setup");
    assert.equal(shell.lastRender.context.variant, "discovery");
    assert.equal(shell.lastRender.context.mountId, "discoverySetupWizardMount");
  });
});

// =====================================================================
// Generic variant — second mount, custom header, no discovery coercion
// =====================================================================

describe("renderWizardShell variant:'generic' — second wizard on a second mount", () => {
  it("normalizeSnapshot with variant 'generic' passes the input through unchanged", () => {
    const { shell } = loadShell();
    const input = {
      engineState: "totally_made_up",
      recommendedFlow: "not_a_flow",
      tailscale: { installed: true, dnsName: "mac.tailnet.ts.net" },
    };
    const out = shell.normalizeSnapshot(input, "generic");
    // No discovery defaults grafted on.
    assert.equal(out.engineState, "totally_made_up");
    assert.equal(out.recommendedFlow, "not_a_flow");
    assert.deepEqual(out.tailscale, input.tailscale);
    // Discovery-only fields must NOT have been filled with defaults.
    assert.equal(out.sheetConfigured, undefined);
    assert.equal(out.localRecoveryState, undefined);
  });

  it("normalizeWizardState with variant 'generic' preserves caller-provided flow + currentStep", () => {
    const { shell } = loadShell();
    const out = shell.normalizeWizardState(
      { currentStep: "path_select", flow: "tailscale" },
      "generic",
    );
    assert.equal(out.currentStep, "path_select");
    assert.equal(out.flow, "tailscale");
    assert.equal(out.version, 1);
    // Discovery-only fields not present.
    assert.equal(out.transportMode, undefined);
    assert.equal(out.result, undefined);
  });

  it("renders into a second mount with a custom header and generic variant", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      mountId: "goLiveSetupWizardMount",
      headerTitle: "Use JobBored on other devices",
      variant: "generic",
      steps: [
        {
          id: "path_select",
          label: "Path",
          title: "Pick a path",
          description: "Tailscale mesh or cloud deploy.",
        },
      ],
      state: { currentStep: "path_select" },
      snapshot: { whatever: true },
    });
    const goLiveMount = document.getElementById("goLiveSetupWizardMount");
    const discoveryMount = document.getElementById(
      "discoverySetupWizardMount",
    );
    assert.equal(goLiveMount.hidden, false);
    assert.equal(goLiveMount.getAttribute("aria-hidden"), "false");
    // Discovery mount stays untouched (no children appended).
    assert.equal(discoveryMount.children.length, 0);
    // Header reflects the custom title.
    const titleNode = goLiveMount.querySelector(
      '[id="discoverySetupWizardTitle"]',
    );
    assert.ok(titleNode, "title h2 must be rendered");
    assert.equal(titleNode.textContent, "Use JobBored on other devices");
    // Context flags
    assert.equal(shell.lastRender.context.variant, "generic");
    assert.equal(shell.lastRender.context.mountId, "goLiveSetupWizardMount");
    // Snapshot was NOT coerced into the discovery schema.
    assert.equal(shell.lastRender.context.snapshot.whatever, true);
    assert.equal(shell.lastRender.context.snapshot.localRecoveryState, undefined);
  });

  it("the shared CSS root class is applied to both mounts", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      steps: [{ id: "detect", label: "S" }],
    });
    shell.renderWizardShell({
      mountId: "goLiveSetupWizardMount",
      headerTitle: "Go live",
      variant: "generic",
      steps: [{ id: "path_select", label: "P" }],
    });
    const discoveryMount = document.getElementById(
      "discoverySetupWizardMount",
    );
    const goLiveMount = document.getElementById("goLiveSetupWizardMount");
    assert.ok(
      discoveryMount.classList.contains("discovery-setup-wizard-root"),
      "discovery mount must carry the shared root class",
    );
    assert.ok(
      goLiveMount.classList.contains("discovery-setup-wizard-root"),
      "go-live mount must carry the same shared root class so CSS applies",
    );
  });
});

// =====================================================================
// Per-mount delegate binding — a second mount must receive its own
// click + key delegate listeners. A boolean _delegatesBound flag (the
// old shape) would skip-bind the second mount and silently break
// every action in the new wizard.
// =====================================================================

describe("bindDelegatesOnce — per-mount registry, not a global boolean", () => {
  it("each mount gets its own click + keydown listeners after render", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      steps: [{ id: "detect", label: "S" }],
    });
    shell.renderWizardShell({
      mountId: "goLiveSetupWizardMount",
      headerTitle: "Go live",
      variant: "generic",
      steps: [{ id: "path_select", label: "P" }],
    });
    const discoveryMount = document.getElementById(
      "discoverySetupWizardMount",
    );
    const goLiveMount = document.getElementById("goLiveSetupWizardMount");
    assert.equal(
      (discoveryMount._listeners.get("click") || []).length,
      1,
      "discovery mount: exactly one click delegate",
    );
    assert.equal(
      (discoveryMount._listeners.get("keydown") || []).length,
      1,
      "discovery mount: exactly one keydown delegate",
    );
    assert.equal(
      (goLiveMount._listeners.get("click") || []).length,
      1,
      "go-live mount: must also get a click delegate (a boolean flag would skip this)",
    );
    assert.equal(
      (goLiveMount._listeners.get("keydown") || []).length,
      1,
      "go-live mount: must also get a keydown delegate",
    );
    // Bound-mount registry tracks both mounts.
    assert.ok(shell._boundMounts instanceof Set);
    assert.equal(shell._boundMounts.size, 2);
    assert.ok(shell._boundMounts.has(discoveryMount));
    assert.ok(shell._boundMounts.has(goLiveMount));
  });

  it("rendering the same mount twice does not double-bind", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      steps: [{ id: "detect", label: "S" }],
    });
    shell.renderWizardShell({
      steps: [{ id: "detect", label: "S" }],
    });
    const discoveryMount = document.getElementById(
      "discoverySetupWizardMount",
    );
    assert.equal(
      (discoveryMount._listeners.get("click") || []).length,
      1,
      "second render on the same mount must reuse the existing delegate",
    );
  });
});

// =====================================================================
// Source-shape gate — the generic variant must bypass the discovery
// option-grid `wizard_choose_flow_local/existing/no_webhook` mapping
// and always use the `wizard_choose_flow_${item.flow}` fallback so
// the new wizard's flows aren't silently remapped to discovery flows.
// =====================================================================

describe("option-grid action mapping — generic variant uses the fallback", () => {
  it("the conditional skipping flowMap[] is wired in the shell source", () => {
    assert.match(
      shellSrc,
      /context\.variant === "generic"[\s\S]*?wizard_choose_flow_\$\{item\.flow\}/,
      "variant:'generic' must take the wizard_choose_flow_${flow} branch (skip the discovery flowMap)",
    );
  });
});

// =====================================================================
// Focus management on open (#7, a11y). When a wizard renders open — the
// auto-open path included — keyboard/SR users must not be stranded behind
// the overlay: focus moves INTO the wizard. The shared shell does this in
// a requestAnimationFrame after mount, for BOTH the discovery and go-live
// mounts (both render through renderWizardShell). The structure tests stub
// rAF to a no-op; here we run it so the focus pass is exercised.
// =====================================================================

describe("renderWizardShell — focus-on-open (a11y, #7)", () => {
  function renderAndFlush(input) {
    const rafCbs = [];
    const { document, shell } = loadShell({ rafImpl: (cb) => rafCbs.push(cb) });
    shell.renderWizardShell(input);
    // Run the deferred focus pass the shell scheduled via rAF.
    rafCbs.forEach((cb) => cb());
    return { document, shell };
  }

  it("moves focus into the discovery wizard when it opens", () => {
    const { document } = renderAndFlush({
      steps: [{ id: "detect", label: "Status", title: "T", description: "D" }],
      state: { currentStep: "detect" },
    });
    const mount = document.getElementById("discoverySetupWizardMount");
    const panel = mount.querySelector("[data-wizard-panel]");
    assert.ok(panel, "the wizard must render a focusable panel");
    assert.equal(
      document.activeElement,
      panel,
      "focus must land inside the wizard (the dialog panel) on open, not stay behind the overlay",
    );
    assert.ok(mount.contains(document.activeElement), "active element is within the wizard");
  });

  it("moves focus into the go-live wizard when it opens", () => {
    const { document } = renderAndFlush({
      mountId: "goLiveSetupWizardMount",
      variant: "generic",
      headerTitle: "Use JobBored on other devices",
      steps: [{ id: "path_select", label: "Path", title: "T", description: "D" }],
      state: { currentStep: "path_select" },
    });
    const mount = document.getElementById("goLiveSetupWizardMount");
    const panel = mount.querySelector("[data-wizard-panel]");
    assert.ok(panel, "the go-live wizard must render a focusable panel");
    assert.equal(
      document.activeElement,
      panel,
      "focus must land inside the go-live wizard on open",
    );
  });

  it("does NOT move focus when the caller opts out with focus:false", () => {
    const { document } = renderAndFlush({
      steps: [{ id: "detect", label: "Status", title: "T", description: "D" }],
      state: { currentStep: "detect" },
      focus: false,
    });
    assert.equal(
      document.activeElement,
      null,
      "focus:false must leave focus untouched (e.g. background re-render)",
    );
  });
});

// =====================================================================
// Continuity (P2): the setup tracks render a persistent journey strip
// (Profile ✓ → Job discovery → Other devices) + a mascot thumb in the
// shell header, so the shell wizards read as chapters of ONE flow
// instead of a different product from the mascot-card wizards.
// =====================================================================

describe("renderWizardShell — journey strip + mascot (continuity)", () => {
  const baseInput = {
    steps: [{ id: "detect", label: "Status", title: "T", description: "D" }],
    state: { currentStep: "detect" },
  };

  it("renders the three-stage journey strip with the current stage marked (devices)", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      ...baseInput,
      mountId: "goLiveSetupWizardMount",
      variant: "generic",
      journeyStage: "devices",
    });
    const mount = document.getElementById("goLiveSetupWizardMount");
    const strip = mount.querySelector(".discovery-setup-wizard__journey");
    assert.ok(strip, "journey strip must render when journeyStage is provided");
    const current = mount.querySelector(".discovery-setup-wizard__journey-step--current");
    assert.ok(current, "one stage must be current");
    assert.match(current.textContent, /Other devices/);
    const done = mount.querySelectorAll(".discovery-setup-wizard__journey-step--done");
    assert.equal(done.length, 2, "Profile + Job discovery read as done on the devices stage");
  });

  it("marks Job discovery current (Profile done) on the discovery stage", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({ ...baseInput, journeyStage: "discovery" });
    const mount = document.getElementById("discoverySetupWizardMount");
    const current = mount.querySelector(".discovery-setup-wizard__journey-step--current");
    assert.match(current.textContent, /Job discovery/);
    assert.equal(
      mount.querySelectorAll(".discovery-setup-wizard__journey-step--done").length,
      1,
    );
  });

  it("renders no strip and no mascot when not asked (non-setup consumers unchanged)", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell(baseInput);
    const mount = document.getElementById("discoverySetupWizardMount");
    assert.equal(mount.querySelector(".discovery-setup-wizard__journey"), null);
    assert.equal(mount.querySelector(".discovery-setup-wizard__mascot-thumb"), null);
  });

  it("renders the mascot thumb in the header when mascotSrc is provided", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      ...baseInput,
      mascotSrc: "assets/jobbored-brand-mascot-kit/exports/04-mascot-poses/pose-01-laptop-thinking.webp",
    });
    const mount = document.getElementById("discoverySetupWizardMount");
    const img = mount.querySelector(".discovery-setup-wizard__mascot-thumb");
    assert.ok(img, "mascot thumb must render");
    assert.match(img.attrs.get("src") || "", /pose-01-laptop-thinking/);
  });
});

describe("wizard motion — one entrance signature across every surface (delight pass)", () => {
  const SIGNATURE = "cubic-bezier(0.16, 1, 0.3, 1)";
  it("the shell panel animates in (it used to hard-pop) with the canonical curve + reduced-motion guard", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../css/legacy-discovery-setup-wizard.css", import.meta.url), "utf8");
    assert.match(css, /\.discovery-setup-wizard__panel\s*\{[^}]*animation:[^}]*jbWizardIn/s, "shell panel must enter, not pop");
    assert.ok(css.includes(SIGNATURE), "shell uses the canonical curve");
    assert.match(css, /@keyframes jbWizardIn/);
    assert.match(css, /prefers-reduced-motion[^}]*\{[^}]*\.discovery-setup-wizard__panel[^}]*\{[^}]*animation:\s*none/s, "reduced-motion users get no entrance animation");
  });
  it("onboarding + first-run panels share the same curve and duration (no per-wizard timing)", async () => {
    const { readFileSync } = await import("node:fs");
    const onboarding = readFileSync(new URL("../css/legacy-onboarding.css", import.meta.url), "utf8");
    const firstRun = readFileSync(new URL("../css/legacy-first-run-wizard.css", import.meta.url), "utf8");
    for (const [name, css, sel] of [["onboarding", onboarding, ".onboarding-panel"], ["first-run", firstRun, ".first-run-panel"]]) {
      const rule = css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)));
      assert.ok(rule.includes("0.32s"), `${name} panel uses the canonical 0.32s duration`);
      assert.ok(rule.includes(SIGNATURE), `${name} panel uses the canonical curve`);
    }
  });
});

describe("wizard button vocabulary — one language (delight pass)", () => {
  it("advance buttons say Continue and terminal buttons say Finish, across all shell wizards", async () => {
    const { readFileSync } = await import("node:fs");
    const files = ["discovery-wizard-ui.js", "go-live-wizard-ui.js", "enhancements-wizard-ui.js"];
    for (const f of files) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      assert.ok(!src.includes('label: "Next"'), `${f}: bare "Next" is banned — advance buttons say Continue`);
      assert.ok(!src.includes('label: "Next: '), `${f}: "Next: …" prefixes are banned — the rail already names the next step`);
    }
    const enh = readFileSync(new URL("../enhancements-wizard-ui.js", import.meta.url), "utf8");
    assert.match(enh, /id: "enhancements_finish", label: "Finish"/, "terminal action says Finish, not Done");
    const gl = readFileSync(new URL("../go-live-wizard-ui.js", import.meta.url), "utf8");
    assert.match(gl, /id: "go_live_finish",\s*label: "Finish"/s, "go-live terminal action says Finish, not Close");
  });
});

describe("wizard shell repaint — warm-paper skin (delight pass)", () => {
  it("done rail segments are solid mint with real checkmarks; the frame is warm paper", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../css/legacy-discovery-setup-wizard.css", import.meta.url), "utf8");
    assert.match(css, /__seg--done \.discovery-setup-wizard__seg-label::before\s*\{\s*content: "✓ "/s, "completed steps show a checkmark, not just a tint");
    assert.ok(css.includes("rgba(251, 246, 235, 0.92)"), "the step frame uses the warm cream paper, not slate white");
  });
});

describe("wizard progress — one mint language across card wizards too (delight pass)", () => {
  it("first-run + profile progress fills use the shell's mint gradient; first-run done pills get checkmarks", async () => {
    const { readFileSync } = await import("node:fs");
    const fr = readFileSync(new URL("../css/legacy-first-run-wizard.css", import.meta.url), "utf8");
    const ob = readFileSync(new URL("../css/legacy-onboarding.css", import.meta.url), "utf8");
    for (const [name, css] of [["first-run", fr], ["onboarding", ob]]) {
      assert.ok(css.includes("var(--jb-mint, #5fcb8e)"), `${name} progress uses the brand mint`);
      assert.match(css, /progress-bar__fill[^}]*\{[^}]*linear-gradient\(\s*90deg/s, `${name} fill is the gradient, not flat accent`);
    }
    assert.match(fr, /__item--done::before\s*\{\s*content: "✓ "/s, "done pills carry the same checkmark as the shell rail");
  });
});

describe("wizard typography — one title scale (delight pass)", () => {
  it("step titles share the shell's scale across all three wizard families", async () => {
    const { readFileSync } = await import("node:fs");
    const files = [
      ["css/legacy-discovery-setup-wizard.css", ".discovery-setup-wizard__step-title"],
      ["css/legacy-first-run-wizard.css", ".first-run-step-title"],
      ["css/legacy-onboarding.css", ".onboarding-step-title"],
    ];
    for (const [file, sel] of files) {
      const css = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const idx = css.lastIndexOf(`${sel} {`);
      const rule = css.slice(idx, css.indexOf("}", idx));
      assert.ok(rule.includes("var(--text-xl)"), `${sel} uses the unified title scale`);
      assert.ok(rule.includes("font-weight: 750"), `${sel} uses the unified title weight`);
    }
  });
});

describe("renderWizardShell — bonus journey stage (enhancements continuity)", () => {
  it("journeyStage bonus renders every stage done with none current", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      steps: [{ id: "detect", label: "Status", title: "T", description: "D" }],
      state: { currentStep: "detect" },
      journeyStage: "bonus",
    });
    const mount = document.getElementById("discoverySetupWizardMount");
    assert.equal(
      mount.querySelectorAll(".discovery-setup-wizard__journey-step--done").length,
      3,
      "all three stages read done on the bonus track",
    );
    assert.equal(
      mount.querySelector(".discovery-setup-wizard__journey-step--current"),
      null,
      "nothing is current — setup is complete",
    );
  });
});
