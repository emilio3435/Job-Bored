import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createElement,
  flush,
  loadDiscoveryTab,
  RUN_FILES,
  runStatusBody,
} from "./holes-disco-harness.mjs";

/* HOLES DISCO — the discovery drawer: the Run button (D10) and the live
   run card's Cancel / Dismiss controls (D7, D5/D6). */

function loadDrawerTab(options = {}) {
  const tab = loadDiscoveryTab({
    files: [...RUN_FILES, "llm-output-budget.js", "discovery-drawer.js"],
    ...options,
  });
  const { ctx, document } = tab;
  ctx.Element = class Element {};
  const asElement = (el) => Object.assign(Object.create(ctx.Element.prototype), el);

  const head = createElement("header");
  let mount = null;
  head.insertAdjacentElement = (_where, el) => {
    mount = el;
    return el;
  };
  const drawerEl = asElement(createElement("div"));
  drawerEl.style = { display: "flex" };
  drawerEl.querySelector = (sel) => {
    if (sel === ".discovery-drawer__head") return head;
    if (sel === "[data-discovery-live-run]") return mount;
    return null;
  };
  document.elements.set("discoveryDrawer", drawerEl);
  const runBtn = createElement("button");
  document.elements.set("discoveryPrefsRun", runBtn);
  const roles = createElement("input");
  roles.value = "Staff Engineer";
  document.elements.set("dpTargetRoles", roles);
  const keywords = createElement("input");
  keywords.value = "";
  document.elements.set("dpKeywordsInclude", keywords);
  if (options.mountFactory) document.createElement = options.mountFactory;

  const calls = { trigger: [], sync: 0 };
  tab.discovery.readiness = {
    buildDiscoveryWebhookPayload: async (_sheetId, o) => ({
      sheetId: "sheet-1",
      trigger: o.trigger,
      variationKey: o.variationKey || "vk-drawer",
      requestedAt: new ctx.Date().toISOString(),
      discoveryProfile: { targetRoles: "Staff Engineer" },
    }),
  };
  tab.discovery.drawer.host = {
    showToast: (message, tone) => tab.toasts.push({ message: String(message), tone }),
    triggerDiscoveryRun: (opts) => {
      calls.trigger.push(opts);
      return options.trigger ? options.trigger(opts) : { ok: true, kind: "accepted_async" };
    },
    syncDiscoveryButtonState: () => {
      calls.sync += 1;
    },
  };
  tab.discovery.drawer.initDiscoveryDrawer();
  drawerEl.hidden = false;
  return { ...tab, drawerEl, runBtn, calls, asElement, getMount: () => mount };
}

function clickAction(tab, action) {
  const button = tab.asElement(createElement("button"));
  button.getAttribute = (name) => (name === "data-discovery-run-action" ? action : null);
  button.closest = (sel) => (sel === "[data-discovery-run-action]" ? button : null);
  return tab.drawerEl.dispatch("click", { target: button });
}

describe("D10 · the drawer's Run button", () => {
  it("stays open, and gives #discoveryBtn back, when the run never started", async () => {
    const tab = loadDrawerTab({ trigger: () => ({ ok: false, reason: "no_url" }) });
    await tab.runBtn.click();
    assert.equal(tab.calls.trigger.length, 1);
    assert.equal(tab.drawerEl.hidden, false, "the drawer keeps the user's context");
    const openBtn = tab.document.getElementById("discoveryBtn");
    assert.equal(openBtn.classList.contains("loading"), false);
    assert.equal(tab.calls.sync, 1);
  });

  it("never leaves #discoveryBtn stuck loading when the run throws", async () => {
    const tab = loadDrawerTab({
      trigger: () => {
        throw new Error("boom");
      },
    });
    await tab.runBtn.click();
    const openBtn = tab.document.getElementById("discoveryBtn");
    assert.equal(openBtn.classList.contains("loading"), false);
    assert.equal(tab.calls.sync, 1, "button state re-synced");
    assert.equal(tab.drawerEl.hidden, false);
  });

  it("closes once the run has started", async () => {
    const tab = loadDrawerTab();
    await tab.runBtn.click();
    assert.equal(tab.drawerEl.hidden, true);
  });

  it("re-sends an unconfirmed dispatch's variation key so the preview matches the request", async () => {
    const tab = loadDrawerTab();
    tab.tracker.markDispatchUnconfirmed({
      webhookUrl: tab.webhookUrl,
      variationKey: "vk-first",
      requestedAt: new tab.ctx.Date().toISOString(),
    });
    await tab.runBtn.click();
    assert.equal(tab.calls.trigger[0].payload.variationKey, "vk-first");
  });
});

describe("D7 · Cancel on the live run card", () => {
  function watchRun(tab) {
    tab.tracker.beginTracking({ runId: "run_c", statusPath: "/runs/run_c", webhookUrl: tab.webhookUrl });
    tab.tracker.updateFromStatusResponse(runStatusBody("run_c"));
  }

  it("offers Cancel for a run the worker is running", () => {
    const tab = loadDrawerTab();
    watchRun(tab);
    tab.discovery.drawer.syncDiscoveryDrawerLiveRun();
    assert.match(tab.getMount().innerHTML, /data-discovery-run-action="cancel"/);
    assert.match(tab.getMount().innerHTML, />Cancel run</);
  });

  it("cancels through the worker, showing a busy state meanwhile", async () => {
    const tab = loadDrawerTab();
    watchRun(tab);
    tab.discovery.drawer.syncDiscoveryDrawerLiveRun();
    let finish;
    const asked = [];
    tab.status.cancelDiscoveryRun = (runId) => {
      asked.push(runId);
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const clicked = clickAction(tab, "cancel");
    await flush();
    assert.deepEqual(asked, ["run_c"]);
    assert.match(tab.getMount().innerHTML, /Cancelling…/);
    assert.match(tab.getMount().innerHTML, /disabled/);
    finish({ ok: true });
    await clicked;
    await flush();
    assert.doesNotMatch(tab.getMount().innerHTML, /Cancelling…/);
  });

  it("offers Dismiss instead for a run the browser can no longer watch", async () => {
    const tab = loadDrawerTab();
    watchRun(tab);
    tab.tracker.markStatusConnectionLost("Lost the status connection after multiple attempts.");
    tab.discovery.drawer.syncDiscoveryDrawerLiveRun();
    assert.match(tab.getMount().innerHTML, /data-discovery-run-action="dismiss"/);
    assert.doesNotMatch(tab.getMount().innerHTML, /data-discovery-run-action="cancel"/);
    await clickAction(tab, "dismiss");
    assert.equal(tab.tracker.getState().status, "idle");
    assert.equal(tab.getMount().hidden, true);
  });

  it("keeps the same buttons across the one-second repaint", () => {
    let body = null;
    const mountFactory = () => {
      const el = createElement("section");
      el.querySelector = (sel) => {
        if (sel !== "[data-live-run-body]" || !/data-live-run-body/.test(el.innerHTML)) return null;
        if (!body) body = createElement("div");
        return body;
      };
      return el;
    };
    const tab = loadDrawerTab({ mountFactory });
    watchRun(tab);
    tab.discovery.drawer.syncDiscoveryDrawerLiveRun();
    const first = tab.getMount().innerHTML;
    tab.clock.advance(1000);
    tab.discovery.drawer.syncDiscoveryDrawerLiveRun();
    assert.equal(tab.getMount().innerHTML, first, "the card shell (and its buttons) were not rebuilt");
    assert.match(body.innerHTML, /jb-live-run--card/);
  });
});
