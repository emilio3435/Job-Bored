import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival } from "./oneflow-l1-harness.mjs";

/* ============================================================
   HOLES AUTH — the setup flow says when it can't save progress.

   A14 a progress save the browser refuses is said once, not swallowed.

   Against the real onboarding-flow.js in the L1 arrival sandbox.
   ============================================================ */

describe("A14 · a refused progress save is said, once", () => {
  it("tells the user their setup progress lasts only for this tab", async () => {
    const env = loadArrival();
    env.store.saveOnboardingFlowState = async () => {
      throw new Error("QuotaExceededError: the quota has been exceeded");
    };
    await env.flow.open("google");
    await env.flow.open("ai");

    const toasts = env.host.__calls.filter((c) => c.name === "showToast");
    assert.equal(toasts.length, 1, "said once, however many saves fail");
    assert.match(toasts[0].args[0], /couldn't save your setup progress/i);
    assert.equal(toasts[0].args[1], "warning");
  });

  it("stays quiet when saves land", async () => {
    const env = loadArrival();
    await env.flow.open("google");
    assert.equal(env.host.__calls.filter((c) => c.name === "showToast").length, 0);
  });
});
