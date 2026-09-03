import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadPayoff, plain, textOf } from "./oneflow-l4-harness.mjs";

/* ============================================================
   GREENFIELD C4 + C5 — Beat 6 is honest about what is armed.

   GREENFIELD-SPEC §1 F5 / §4.3. B6 rendered "✓ Discovery armed — 3
   sources watching" and an active `Run discovery now` whether or not a
   Sheet existed and whether or not B4 had saved a single role. Pressing
   it fired a run into nothing and returned two error toasts — the last
   screen of onboarding, lying twice.

   The primary now adapts to readiness:
     !sheet          → Connect Google to go live   → B1
     sheet && !roles → Tell it what to look for    → B4
     sheet && roles  → Run discovery now           (unchanged)
   ============================================================ */

const NOT_ARMED_LINE =
  "Not armed yet — finish the step above and it runs on its own.";

const NO_ROLES_PROFILE = {
  profile: {
    identity: { targetRoles: [] },
    strengths: [],
    hardConstraints: { acceptableLocations: [], salaryFloor: null },
  },
};

/** Resolve B6's view model the way the shell's render does. */
function resolve(env, overrides = {}) {
  return env.payoff.resolvePayoffState({
    state: { skipped: {}, completedBeats: [], ...(overrides.flowState || {}) },
    runtime: overrides.runtime || {},
  });
}

async function render(env, overrides = {}) {
  const state = await resolve(env, overrides);
  const container = env.document.createElement("div");
  env.payoff.renderPayoff(container, state);
  return { container, state };
}

const ids = (state) => plain(state.actions).map((a) => a.id);
const primaryOf = (state) =>
  plain(state.actions).find((a) => a.variant === "primary") || null;

function sink() {
  return { messages: [], busy: [], completed: [], goto: [] };
}

function ctxFor(s) {
  return {
    state: { skipped: {}, completedBeats: [] },
    runtime: {},
    setMessage: (text, tone) => s.messages.push([text, tone]),
    setBusy: (id, stages) => s.busy.push([id, stages]),
    clearBusy: () => s.busy.push(["clear"]),
    completeBeat: (detail) => {
      s.completed.push(detail || {});
      return Promise.resolve();
    },
    skipBeat: () => Promise.resolve(),
    goToBeat: (id) => {
      s.goto.push(id);
      return Promise.resolve();
    },
  };
}

describe("GREENFIELD C4 · resolvePayoffState reports readiness", () => {
  it("reports both true when the sheet exists and B4 saved roles", async () => {
    const env = loadPayoff();
    const state = await resolve(env);
    assert.deepEqual(plain(state.readiness), { sheet: true, roles: true });
  });

  it("reports sheet:false when no Sheet was ever connected", async () => {
    const env = loadPayoff({ sheetId: "" });
    const state = await resolve(env);
    assert.equal(state.readiness.sheet, false);
  });

  it("reports roles:false when the saved profile names no target role", async () => {
    const env = loadPayoff({ fitProfile: NO_ROLES_PROFILE });
    const state = await resolve(env);
    assert.equal(state.readiness.sheet, true);
    assert.equal(state.readiness.roles, false);
  });

  it("reports roles:false when the profile server is unreachable", async () => {
    const env = loadPayoff();
    env.window.FitProfileForm.fetchProfile = async () => {
      throw new Error("ECONNREFUSED");
    };
    const state = await resolve(env);
    assert.equal(
      state.readiness.roles,
      false,
      "a search we cannot read is not a search we can promise to run",
    );
  });
});

describe("GREENFIELD C4 · the primary adapts to readiness (spec §4.3)", () => {
  it("no Sheet → 'Connect Google to go live'", async () => {
    const env = loadPayoff({ sheetId: "" });
    const state = await resolve(env);
    const primary = primaryOf(state);
    assert.equal(primary.id, "payoff_connect_google");
    assert.equal(primary.label, "Connect Google to go live");
  });

  it("Sheet but no roles → 'Tell it what to look for'", async () => {
    const env = loadPayoff({ fitProfile: NO_ROLES_PROFILE });
    const state = await resolve(env);
    const primary = primaryOf(state);
    assert.equal(primary.id, "payoff_fix_fit");
    assert.equal(primary.label, "Tell it what to look for");
  });

  it("Sheet and roles → 'Run discovery now', unchanged", async () => {
    const env = loadPayoff();
    const state = await resolve(env);
    const primary = primaryOf(state);
    assert.equal(primary.id, "payoff_run_now");
    assert.equal(primary.label, "Run discovery now");
  });

  it("never offers a discovery run unless BOTH are ready", async () => {
    for (const stubs of [{ sheetId: "" }, { fitProfile: NO_ROLES_PROFILE }]) {
      const state = await resolve(loadPayoff(stubs));
      assert.ok(
        !ids(state).includes("payoff_run_now"),
        `a run into ${JSON.stringify(stubs)} is the two-error-toast dead end F5 names`,
      );
      assert.ok(!ids(state).includes("payoff_run_discovery"));
    }
  });

  it("keeps 'Take me to my dashboard' in every readiness state", async () => {
    for (const stubs of [{}, { sheetId: "" }, { fitProfile: NO_ROLES_PROFILE }]) {
      const state = await resolve(loadPayoff(stubs));
      const escape = plain(state.actions).find((a) => a.id === "payoff_dashboard");
      assert.ok(escape, `payoff_dashboard missing for ${JSON.stringify(stubs)}`);
      assert.equal(escape.label, "Take me to my dashboard");
    }
  });

  it("leaves the skipped-connect variant alone", async () => {
    const env = loadPayoff();
    const state = await resolve(env, {
      flowState: { skipped: { discoveryConnect: true } },
    });
    assert.deepEqual(ids(state), ["payoff_dashboard", "payoff_connect_discovery"]);
  });
});

describe("GREENFIELD C4 · 'What happens now' stops claiming armed", () => {
  it("opens with the locked not-armed line when the Sheet is missing", async () => {
    const env = loadPayoff({ sheetId: "" });
    const { container } = await render(env, {});
    const rows = container
      .querySelector(".oneflow-payoff__now")
      .querySelectorAll(".oneflow-payoff__row");
    assert.ok(rows.length, "the card still renders its list");
    assert.equal(
      textOf(rows[0]),
      NOT_ARMED_LINE,
      "spec §4.3 locks this as the FIRST line when not ready",
    );
  });

  it("opens with the locked not-armed line when no roles were saved", async () => {
    const env = loadPayoff({ fitProfile: NO_ROLES_PROFILE });
    const { container } = await render(env, {});
    const rows = container
      .querySelector(".oneflow-payoff__now")
      .querySelectorAll(".oneflow-payoff__row");
    assert.equal(textOf(rows[0]), NOT_ARMED_LINE);
  });

  it("never says 'Discovery armed' when it is not", async () => {
    for (const stubs of [{ sheetId: "" }, { fitProfile: NO_ROLES_PROFILE }]) {
      const { container } = await render(loadPayoff(stubs), {});
      assert.ok(
        !textOf(container).includes("Discovery armed"),
        `"Discovery armed" with ${JSON.stringify(stubs)} is the lie F5 names`,
      );
    }
  });

  it("still says 'Discovery armed' when it truly is", async () => {
    const { container } = await render(loadPayoff(), {});
    assert.ok(textOf(container).includes("✓ Discovery armed — 3 sources watching"));
    assert.ok(!textOf(container).includes(NOT_ARMED_LINE));
  });
});

describe("GREENFIELD C5 · the two new actions go back into the flow", () => {
  it("payoff_connect_google walks to Beat 1 and nothing else", async () => {
    const env = loadPayoff({ sheetId: "" });
    const s = sink();

    await env.flow.getBeat("payoff").onAction("payoff_connect_google", ctxFor(s));

    assert.deepEqual(plain(s.goto), ["google"]);
    assert.deepEqual(plain(s.completed), [], "it is a detour, not a completion");
    assert.equal(env.calls.discoveryRuns.length, 0, "and it fires no run");
  });

  it("payoff_fix_fit walks to Beat 4 and nothing else", async () => {
    const env = loadPayoff({ fitProfile: NO_ROLES_PROFILE });
    const s = sink();

    await env.flow.getBeat("payoff").onAction("payoff_fix_fit", ctxFor(s));

    assert.deepEqual(plain(s.goto), ["fit"]);
    assert.deepEqual(plain(s.completed), []);
    assert.equal(env.calls.discoveryRuns.length, 0);
  });

  it("neither raises a toast on the way out", async () => {
    const env = loadPayoff({ sheetId: "" });
    const s = sink();

    await env.flow.getBeat("payoff").onAction("payoff_connect_google", ctxFor(s));

    assert.deepEqual(
      plain(env.calls.toasts),
      [],
      "F5's two error toasts were the symptom — the fix cannot ship its own",
    );
  });
});

describe("GREENFIELD C4 · the shell footer follows the resolved readiness", () => {
  async function footerIds(env) {
    await env.flow.goToBeat("payoff");
    return env
      .document.getElementById("oneFlowMount")
      .querySelectorAll(".discovery-setup-wizard__btn")
      .map((btn) => btn.dataset.actionId);
  }

  it("offers Connect Google in the footer when no Sheet exists", async () => {
    const env = loadPayoff({ sheetId: "" });
    assert.deepEqual(plain(await footerIds(env)), [
      "payoff_connect_google",
      "payoff_dashboard",
    ]);
  });

  it("still offers the run in the footer when everything is ready", async () => {
    const env = loadPayoff();
    assert.deepEqual(plain(await footerIds(env)), [
      "payoff_run_now",
      "payoff_dashboard",
    ]);
  });
});
