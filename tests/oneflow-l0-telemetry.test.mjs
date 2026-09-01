import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import {
  FakeCustomEvent,
  makeFakeDocument,
  readRepoFile,
} from "./oneflow-l0-harness.mjs";

/* ============================================================
   ONEFLOW spec §9 + SUBSTRATE "Telemetry (L0)": the flow's funnel
   vocabulary must live in the SAME frozen STEPS table as the legacy
   chain's, so every emitter references STEPS.* and a typo cannot fork
   a step name at runtime.
   ============================================================ */

function loadTelemetry() {
  const doc = makeFakeDocument();
  const win = { CustomEvent: FakeCustomEvent };
  const ctx = {
    window: win,
    document: doc,
    console: { warn() {} },
    Object,
    String,
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("onboarding-telemetry.js"), ctx, {
    filename: "onboarding-telemetry.js",
  });
  return { telemetry: win.JobBoredOnboardingTelemetry, doc };
}

describe("onboarding telemetry — one-flow vocabulary (spec §9)", () => {
  const EXPECTED = {
    FLOW_OPENED: "flow_opened",
    BEAT_OPENED: "beat_opened",
    BEAT_COMPLETED: "beat_completed",
    BEAT_SKIPPED: "beat_skipped",
    BEAT_ABANDONED: "beat_abandoned",
    FLOW_COMPLETED: "flow_completed",
    KEY_CHECK: "key_check",
    FIRST_RESULTS: "first_results",
  };

  it("exposes every one-flow step under a STEPS.* key", () => {
    const { telemetry } = loadTelemetry();
    for (const [key, value] of Object.entries(EXPECTED)) {
      assert.equal(
        telemetry.STEPS[key],
        value,
        `STEPS.${key} must be "${value}" so emitters never inline the literal`,
      );
    }
  });

  it("keeps the legacy chain's steps — the flow adds, never replaces", () => {
    const { telemetry } = loadTelemetry();
    for (const key of [
      "FIRST_RUN_DONE",
      "DISCOVERY_OPENED",
      "DISCOVERY_FINISHED",
      "GO_LIVE_OPENED",
      "GO_LIVE_FINISHED",
      "LATER_PRESSED",
      "BOTH_DONE",
    ]) {
      assert.ok(telemetry.STEPS[key], `legacy STEPS.${key} must survive`);
    }
  });

  it("STEPS stays frozen so a runtime typo cannot add a step", () => {
    const { telemetry } = loadTelemetry();
    assert.equal(Object.isFrozen(telemetry.STEPS), true);
    try {
      telemetry.STEPS.BEAT_OPENED = "beat_opened_typo";
    } catch (_) {
      /* strict-mode throw is also an acceptable freeze */
    }
    assert.equal(telemetry.STEPS.BEAT_OPENED, "beat_opened");
  });

  it("emits a beat step as a jobbored:onboarding CustomEvent with its detail", () => {
    const { telemetry, doc } = loadTelemetry();
    telemetry.emit(telemetry.STEPS.BEAT_COMPLETED, { beat: "ai", provider: "openrouter" });
    assert.equal(doc._events.length, 1);
    assert.equal(doc._events[0].type, "jobbored:onboarding");
    // The event object is built inside the vm realm, so compare fields
    // rather than prototypes.
    assert.deepEqual({ ...doc._events[0].detail }, {
      step: "beat_completed",
      beat: "ai",
      provider: "openrouter",
    });
  });
});
