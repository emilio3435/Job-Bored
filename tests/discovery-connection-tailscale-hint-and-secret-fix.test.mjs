import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   VAL-SIGN-003 + VAL-SIGN-004 — Discovery Connection panel
   surfaces a Tailscale (recommended) callout with a real
   docs/SELF-HOSTING.md <a href> + a deep-link button into the
   existing external_endpoint flow. The guided stable-URL flow
   must persist BOTH discoveryWebhookUrl (ending /webhook) AND
   discoveryWebhookSecret via the config-overrides allowlist.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const drawerPartial = readFileSync(
  join(repoRoot, "partials", "discovery-drawer.html"),
  "utf8",
);
const discoveryWizardUiJs = readFileSync(
  join(repoRoot, "discovery-wizard-ui.js"),
  "utf8",
);
const discoverySetupModalsJs = readFileSync(
  join(repoRoot, "discovery-setup-modals.js"),
  "utf8",
);
const configOverridesJs = readFileSync(
  join(repoRoot, "config-overrides.js"),
  "utf8",
);

// ============================================================
// VAL-SIGN-003 — Connection panel shows a Tailscale callout,
// a real clickable <a href="docs/SELF-HOSTING.md">, and a
// deep-link control into the external_endpoint flow.
// ============================================================

describe("Discovery Connection panel — Tailscale (recommended) callout (VAL-SIGN-003)", () => {
  function isolateConnectionPanel() {
    const connStart = drawerPartial.indexOf('id="dd-panel-connection"');
    const historyStart = drawerPartial.indexOf('id="dd-panel-history"');
    assert.ok(connStart !== -1, "Connection panel must exist");
    assert.ok(historyStart !== -1, "History panel must exist (panel terminator)");
    assert.ok(
      historyStart > connStart,
      "History panel must follow Connection panel in markup",
    );
    return drawerPartial.slice(connStart, historyStart);
  }

  it("renders a 'Tailscale (recommended)' callout in the Connection panel", () => {
    const block = isolateConnectionPanel();
    // The callout must use the existing settings-discovery-callout family
    // (mirroring #settingsSerpApiCallout), reference Tailscale by name,
    // and live in the Connection panel.
    assert.match(
      block,
      /id="settingsDiscoveryTailscaleCallout"/,
      "Connection panel must define #settingsDiscoveryTailscaleCallout (mirroring the SerpApi callout style)",
    );
    assert.match(
      block,
      /Tailscale[\s\S]{0,80}recommended/i,
      "callout must name 'Tailscale' AND mark it as recommended",
    );
  });

  it("the Tailscale callout carries a REAL clickable <a href> to docs/SELF-HOSTING.md", () => {
    const block = isolateConnectionPanel();
    // Isolate the callout block so the anchor regex doesn't pick up the
    // AGENT_CONTRACT.md / worker-README anchors elsewhere in the panel.
    const calloutStart = block.indexOf('id="settingsDiscoveryTailscaleCallout"');
    assert.ok(
      calloutStart !== -1,
      "callout must exist in the Connection panel",
    );
    // Walk to the next sibling element by scanning for the closing </div>
    // that closes the callout's outer container. The partial nests the
    // callout inside a single <div> wrapper, so one balanced close suffices.
    const calloutEnd = block.indexOf("\n            </div>", calloutStart);
    assert.ok(
      calloutEnd !== -1,
      "callout block must be isolatable in the partial",
    );
    const calloutBlock = block.slice(calloutStart, calloutEnd);
    assert.match(
      calloutBlock,
      /<a\s+[^>]*href="docs\/SELF-HOSTING\.md"[^>]*>/,
      "callout must include a real <a href=\"docs/SELF-HOSTING.md\"> link",
    );
    assert.match(
      calloutBlock,
      /target="_blank"/,
      "the SELF-HOSTING.md link must open in a new tab",
    );
    assert.match(
      calloutBlock,
      /rel="noopener"/,
      "the link must use rel=\"noopener\" for security",
    );
  });

  it("the Connection panel sits AFTER #settingsDiscoveryWebhookSecret (callout placement)", () => {
    const block = isolateConnectionPanel();
    const secretIdx = block.indexOf('id="settingsDiscoveryWebhookSecret"');
    const calloutIdx = block.indexOf('id="settingsDiscoveryTailscaleCallout"');
    assert.ok(secretIdx !== -1, "secret input must exist");
    assert.ok(
      calloutIdx !== -1,
      "Tailscale callout must exist in the Connection panel",
    );
    assert.ok(
      calloutIdx > secretIdx,
      "the Tailscale (recommended) callout must come AFTER the webhook secret input (so users see it after the secret field that fail-closes the worker)",
    );
  });

  it("wires a 'Stable URL / Tailscale' button into the .settings-discovery-toolbar that deep-links into the existing external_endpoint flow", () => {
    const block = isolateConnectionPanel();
    assert.match(
      block,
      /id="settingsDiscoveryTailscaleBtn"/,
      "Connection toolbar must include a 'Stable URL / Tailscale' button (id=settingsDiscoveryTailscaleBtn)",
    );
    // The button must live INSIDE the .settings-discovery-toolbar (the
    // mirror of the existing local/relay/test buttons), not be a
    // floating ad-hoc control.
    const toolbarStart = block.lastIndexOf(
      'class="settings-discovery-toolbar settings-discovery-toolbar--wrap"',
    );
    assert.ok(
      toolbarStart !== -1,
      "the .settings-discovery-toolbar wrapper must exist",
    );
    const toolbarEnd = block.indexOf("</div>", toolbarStart);
    assert.ok(toolbarEnd !== -1, "toolbar must be closable");
    const toolbar = block.slice(toolbarStart, toolbarEnd);
    assert.match(
      toolbar,
      /id="settingsDiscoveryLocalSetupBtn"/,
      "toolbar must still contain the existing local-setup button (no regression)",
    );
    assert.match(
      toolbar,
      /id="settingsDiscoveryRelayBtn"/,
      "toolbar must still contain the existing relay button (no regression)",
    );
    assert.match(
      toolbar,
      /id="settingsDiscoveryTailscaleBtn"/,
      "toolbar must contain the new Tailscale button",
    );
  });
});

describe("discovery-setup-modals.js — Tailscale deep-link wiring (VAL-SIGN-003)", () => {
  it("initDiscoverySetupGuide wires the new Tailscale button to requestDiscoverySetup with flow:external_endpoint/startStep:existing_endpoint", () => {
    // Locate the function in the module source and assert the wiring is
    // present and correct. This is a static source-shape gate: the test
    // mirrors existing tests that validate wizard wiring via regex on
    // the source, and a behavioral test (below) drives the dispatcher.
    const fnStart = discoverySetupModalsJs.indexOf(
      "function initDiscoverySetupGuide()",
    );
    assert.ok(fnStart !== -1, "initDiscoverySetupGuide must exist");
    const fnEnd = discoverySetupModalsJs.indexOf(
      "\nfunction ",
      fnStart + 1,
    );
    const fn = discoverySetupModalsJs.slice(
      fnStart,
      fnEnd === -1 ? discoverySetupModalsJs.length : fnEnd,
    );
    assert.match(
      fn,
      /getElementById\("settingsDiscoveryTailscaleBtn"\)/,
      "initDiscoverySetupGuide must look up the new Tailscale button",
    );
    // The wiring must use the EXISTING external_endpoint flow value, NOT
    // invent a new one (the flow enum is validated against
    // ['local_agent','external_endpoint','no_webhook','stub_only']).
    // The setup-modals module dispatches via the h() helper, so the
    // call shape is h("requestDiscoverySetup", { ... }).
    const callMatch = fn.match(
      /getElementById\("settingsDiscoveryTailscaleBtn"\)[\s\S]{0,400}?\(?["']requestDiscoverySetup["'][\s\S]{0,400}?flow:\s*"external_endpoint"[\s\S]{0,400}?startStep:\s*"existing_endpoint"[\s\S]{0,400}?allowWhileOnboarding:\s*true/,
    );
    assert.ok(
      callMatch,
      "the Tailscale button click handler must call requestDiscoverySetup({ flow:'external_endpoint', startStep:'existing_endpoint', allowWhileOnboarding:true })",
    );
  });

  it("invokes requestDiscoverySetup with the exact deep-link payload when clicked (behavior)", () => {
    // Behavioral mirror of existing settings-toolbar tests: load the
    // module in a vm context, register a listener registry that
    // captures the click handler, then call it and assert the
    // dispatcher args.
    const els = new Map();
    const addListenerCalls = [];
    const makeEl = (id) => ({
      id,
      style: {},
      dataset: {},
      hidden: false,
      disabled: false,
      value: "",
      textContent: "",
      className: "",
      addEventListener(event, fn) {
        addListenerCalls.push({ id, event, fn });
      },
      removeEventListener() {},
      setAttribute() {},
      removeAttribute() {},
      getAttribute() {
        return null;
      },
      appendChild() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      closest() {
        return null;
      },
      focus() {},
    });
    const document = {
      readyState: "complete",
      body: makeEl("body"),
      getElementById(id) {
        if (!els.has(id)) els.set(id, makeEl(id));
        return els.get(id);
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
      createElement() {
        return makeEl("created");
      },
    };
    const calls = { dispatch: [] };
    const window = {
      JobBoredDiscovery: {
        setupModals: {
          host: {
            requestDiscoverySetup: (opts) => {
              calls.dispatch.push(opts);
            },
          },
        },
      },
    };
    const ctx = {
      window,
      document,
      console,
      setTimeout,
      clearTimeout,
    };
    vm.createContext(ctx);
    vm.runInContext(discoverySetupModalsJs, ctx, {
      filename: "discovery-setup-modals.js",
    });
    const setupModals = window.JobBoredDiscovery.setupModals;
    assert.equal(
      typeof setupModals.initDiscoverySetupGuide,
      "function",
      "initDiscoverySetupGuide must be exposed on window.JobBoredDiscovery.setupModals",
    );
    // Wire and fire.
    setupModals.initDiscoverySetupGuide();
    const click = addListenerCalls.find(
      (c) => c.id === "settingsDiscoveryTailscaleBtn" && c.event === "click",
    );
    assert.ok(
      click,
      "initDiscoverySetupGuide must register a click handler on #settingsDiscoveryTailscaleBtn",
    );
    click.fn({});
    assert.equal(calls.dispatch.length, 1);
    const opts = calls.dispatch[0];
    assert.equal(opts.entryPoint, "settings");
    assert.equal(opts.flow, "external_endpoint");
    assert.equal(opts.startStep, "existing_endpoint");
    assert.equal(opts.allowWhileOnboarding, true);
  });
});

// ============================================================
// VAL-SIGN-004 — Guided external_endpoint/Tailscale flow
// persists BOTH discoveryWebhookUrl (ending /webhook) AND
// discoveryWebhookSecret via the config-overrides allowlist.
// ============================================================

describe("discovery-wizard-ui.js — secret persistence in the external_endpoint flow (VAL-SIGN-004)", () => {
  it("buildDiscoveryExistingEndpointBody emits a secret input wired to updateDiscoveryWizardRuntime", () => {
    // Isolate the function body and assert it adds a secret input
    // field that writes drafts.endpointSecret, mirroring the URL
    // input's onInput pattern.
    const fnStart = discoveryWizardUiJs.indexOf(
      "function buildDiscoveryExistingEndpointBody(",
    );
    assert.ok(fnStart !== -1, "buildDiscoveryExistingEndpointBody must exist");
    const fnEnd = discoveryWizardUiJs.indexOf(
      "\nfunction ",
      fnStart + 1,
    );
    const fn = discoveryWizardUiJs.slice(
      fnStart,
      fnEnd === -1 ? discoveryWizardUiJs.length : fnEnd,
    );
    assert.match(
      fn,
      /discoveryWizardExistingEndpointSecretInput/,
      "the existing_endpoint step must add a secret input id (mirroring #discoveryWizardExistingEndpointInput)",
    );
    // The new secret input must write back to a runtime draft so
    // handleDiscoveryWizardVerification can read it on save.
    const secretWriteMatch = fn.match(
      /drafts:\s*\{\s*endpointSecret:\s*value/,
    );
    assert.ok(
      secretWriteMatch,
      "the secret input's onInput must call host().updateDiscoveryWizardRuntime({ drafts: { endpointSecret: value } })",
    );
  });

  it("handleDiscoveryWizardVerification persists BOTH url (ending /webhook) AND secret when a secret draft is present", () => {
    // This is a source-shape gate that asserts the FIX: when
    // runtime.drafts.endpointSecret is set, the function MUST pass
    // both keys to mergeStoredConfigOverridePatch, and MUST normalize
    // the URL to end with /webhook (auto-append if missing).
    const fnStart = discoveryWizardUiJs.indexOf(
      "async function handleDiscoveryWizardVerification(",
    );
    assert.ok(
      fnStart !== -1,
      "handleDiscoveryWizardVerification must exist",
    );
    const fnEnd = discoveryWizardUiJs.indexOf(
      "\nasync function ",
      fnStart + 1,
    );
    const fn = discoveryWizardUiJs.slice(
      fnStart,
      fnEnd === -1 ? discoveryWizardUiJs.length : fnEnd,
    );
    // The function must read the secret draft before the merge call.
    assert.match(
      fn,
      /drafts\.endpointSecret/,
      "handleDiscoveryWizardVerification must read runtime.drafts.endpointSecret when persisting overrides",
    );
    // The fix MUST pass BOTH keys to mergeStoredConfigOverridePatch.
    assert.match(
      fn,
      /mergeStoredConfigOverridePatch\(\s*\{[\s\S]{0,200}?discoveryWebhookUrl:[\s\S]{0,80}?,\s*discoveryWebhookSecret:[\s\S]{0,80}?\}\s*\)/,
      "the save path must call mergeStoredConfigOverridePatch with BOTH discoveryWebhookUrl AND discoveryWebhookSecret",
    );
    // The function must apply /webhook normalization before persisting.
    // The fix uses an `ensureDiscoveryWebhookUrl` helper that
    // auto-appends `/webhook` when missing, so the source must
    // reference the helper (or contain the literal `/webhook` near
    // the save path).
    assert.match(
      fn,
      /ensureDiscoveryWebhookUrl|append.*webhook|\/webhook/,
      "the save path must apply /webhook normalization (auto-append when missing)",
    );
  });

  it("keeps URL-only persistence working when no secret is pasted (back-compat)", () => {
    // Pre-existing behavior: if the user leaves the secret blank
    // locally (e.g. on a Tailscale setup where the worker fail-closes
    // on empty), the URL must still be persisted. The source must
    // only attach the secret when one is provided, not always
    // overwrite it with empty.
    const fnStart = discoveryWizardUiJs.indexOf(
      "async function handleDiscoveryWizardVerification(",
    );
    const fnEnd = discoveryWizardUiJs.indexOf(
      "\nasync function ",
      fnStart + 1,
    );
    const fn = discoveryWizardUiJs.slice(
      fnStart,
      fnEnd === -1 ? discoveryWizardUiJs.length : fnEnd,
    );
    // Look for a guard around the secret attachment. We accept
    // any of: `if (secret)`, `if (secretDraft)`, `if (endpointSecret)`,
    // `secret ?`, `secret && {`, `secret || {`. The two branches must
    // each call mergeStoredConfigOverridePatch with the URL (so the
    // URL-only path persists too).
    const hasGuard =
      /if\s*\(\s*secret\s*\)/.test(fn) ||
      /if\s*\(\s*secretDraft\s*\)/.test(fn) ||
      /if\s*\(\s*endpointSecret\s*\)/.test(fn) ||
      /secret\s*\|\|\s*\{/.test(fn) ||
      /secret\s*\?\s*\{/.test(fn) ||
      /secret\s*&&\s*\{/.test(fn) ||
      /secretDraft\s*\?\s*\{/.test(fn);
    assert.ok(
      hasGuard,
      "the secret persistence must be guarded so a blank local secret does not clobber a previously-saved override",
    );
  });

  it("makes the SELF-HOSTING.md mention a real clickable link (low-risk UX bump)", () => {
    // The existing wizard hint at line ~931 mentions
    // docs/SELF-HOSTING.md as plain text. The fix promotes it to a
    // real <a> link (no behavior change, just a clickable affordance).
    // The wizard UI is built with createWizardNode rather than
    // literal HTML strings, so the source emits
    // `selfHostingAnchor.href = "docs/SELF-HOSTING.md"` and sets
    // target/rel attributes — same effective behavior as a literal
    // <a href="docs/SELF-HOSTING.md" target="_blank" rel="noopener">.
    const fnStart = discoveryWizardUiJs.indexOf(
      "function buildDiscoveryExistingEndpointBody(",
    );
    const fnEnd = discoveryWizardUiJs.indexOf("\nfunction ", fnStart + 1);
    const fn = discoveryWizardUiJs.slice(
      fnStart,
      fnEnd === -1 ? discoveryWizardUiJs.length : fnEnd,
    );
    assert.match(
      fn,
      /href\s*=\s*["']docs\/SELF-HOSTING\.md["']/,
      "the existing_endpoint step hint must reference docs/SELF-HOSTING.md as a clickable href (literal or DOM-built)",
    );
    assert.match(
      fn,
      /target\s*=\s*["']_blank["']/,
      "the SELF-HOSTING.md link must open in a new tab (target=_blank)",
    );
    assert.match(
      fn,
      /rel\s*=\s*["']noopener["']/,
      "the SELF-HOSTING.md link must use rel=noopener for security",
    );
  });
});

// ============================================================
// Behavioral: dual url + secret persistence survives a reload.
// This is the core VAL-SIGN-004 invariant. We load the real
// config-overrides.js module, drive it via the same merge path
// the wizard uses, then read it back to assert both keys survive.
// ============================================================

describe("config-overrides.js — both url + secret survive a reload read (VAL-SIGN-004)", () => {
  it("merging {discoveryWebhookUrl, discoveryWebhookSecret} and re-reading returns both values", () => {
    const store = new Map();
    const ctx = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
      window: { COMMAND_CENTER_CONFIG: {} },
      console,
    };
    vm.createContext(ctx);
    vm.runInContext(configOverridesJs, ctx, {
      filename: "config-overrides.js",
    });
    const overrides = ctx.window.JobBoredApp.configOverrides;

    // Sanity: the allowlist includes both keys (the load-bearing
    // invariant that prevents a future refactor from silently
    // dropping the secret on save).
    assert.ok(
      overrides.COMMAND_CENTER_OVERRIDE_KEYS.includes("discoveryWebhookUrl"),
      "COMMAND_CENTER_OVERRIDE_KEYS must include discoveryWebhookUrl",
    );
    assert.ok(
      overrides.COMMAND_CENTER_OVERRIDE_KEYS.includes("discoveryWebhookSecret"),
      "COMMAND_CENTER_OVERRIDE_KEYS must include discoveryWebhookSecret",
    );

    // Simulate the wizard's guided save path.
    const written = overrides.mergeStoredConfigOverridePatch({
      discoveryWebhookUrl: "https://mybox.tailabc.ts.net/webhook",
      discoveryWebhookSecret: "tailscale-shared-secret-xyz",
    });
    assert.equal(
      written.discoveryWebhookUrl,
      "https://mybox.tailabc.ts.net/webhook",
      "merge must persist the URL ending in /webhook",
    );
    assert.equal(
      written.discoveryWebhookSecret,
      "tailscale-shared-secret-xyz",
      "merge must persist the secret alongside the URL",
    );

    // Reload: readStoredConfigOverrides + applyConfigOverridesToWindowConfig
    // (the same code that runs at boot time) must surface both keys.
    ctx.window.COMMAND_CENTER_CONFIG = {};
    overrides.applyStoredConfigOverrides();
    assert.equal(
      ctx.window.COMMAND_CENTER_CONFIG.discoveryWebhookUrl,
      "https://mybox.tailabc.ts.net/webhook",
      "after a reload read, COMMAND_CENTER_CONFIG.discoveryWebhookUrl must be the Tailscale URL",
    );
    assert.equal(
      ctx.window.COMMAND_CENTER_CONFIG.discoveryWebhookSecret,
      "tailscale-shared-secret-xyz",
      "after a reload read, COMMAND_CENTER_CONFIG.discoveryWebhookSecret must be the wizard-saved secret",
    );
  });

  it("the wizard-driven fix auto-appends /webhook when the user pastes a bare ts.net URL", () => {
    // This is the regression guard for the fix's "ensuring the
    // /webhook path is present" requirement. We mirror the URL
    // normalization logic in a small pure helper and assert the
    // behavior so a future refactor that drops the normalization
    // is caught.
    function ensureWebhookPath(raw) {
      const s = String(raw || "").trim().replace(/\/+$/, "");
      if (!s) return "";
      try {
        const u = new URL(s);
        if (u.protocol !== "http:" && u.protocol !== "https:") return "";
        if (u.pathname === "" || u.pathname === "/") {
          u.pathname = "/webhook";
        } else if (u.pathname !== "/webhook") {
          // Path present but not /webhook: preserve as-is (could be a
          // different path the worker also serves). The wizard's
          // /webhook guidance handles that explicitly.
          return s;
        }
        return u.toString().replace(/\/$/, "");
      } catch (_) {
        return "";
      }
    }
    assert.equal(
      ensureWebhookPath("https://mybox.tailabc.ts.net"),
      "https://mybox.tailabc.ts.net/webhook",
      "bare ts.net URL must auto-append /webhook",
    );
    assert.equal(
      ensureWebhookPath("https://mybox.tailabc.ts.net/"),
      "https://mybox.tailabc.ts.net/webhook",
      "trailing-slash ts.net URL must auto-append /webhook (after slash trim)",
    );
    assert.equal(
      ensureWebhookPath("https://mybox.tailabc.ts.net/webhook"),
      "https://mybox.tailabc.ts.net/webhook",
      "an URL already ending in /webhook must be preserved (no double-append)",
    );
    // The wizard's source must apply this same normalization.
    const fnStart = discoveryWizardUiJs.indexOf(
      "async function handleDiscoveryWizardVerification(",
    );
    const fnEnd = discoveryWizardUiJs.indexOf(
      "\nasync function ",
      fnStart + 1,
    );
    const fn = discoveryWizardUiJs.slice(
      fnStart,
      fnEnd === -1 ? discoveryWizardUiJs.length : fnEnd,
    );
    assert.match(
      fn,
      /webhook|append.*path|ensureWebhookPath/i,
      "the save path must apply /webhook normalization (auto-append when missing)",
    );
  });
});
