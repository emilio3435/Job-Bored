/**
 * A second Google identity on an already-configured install must get a
 * way INTO setup, not a dead-end gate. Observed 2026-09-01: signing in as
 * a different account → the configured sheet 403s → "Couldn't load this
 * sheet" with only Settings / Reload. The one-flow's demo board and Beat 1
 * only engage when no sheet is configured, so the gate's error mode is the
 * only place this user can be met.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCutover, settle } from "./oneflow-l6-harness.mjs";

const BTN = "sheetAccessGateStartFreshBtn";

describe("gate error mode — a signed-in identity that cannot read the sheet", () => {
  it("offers 'Set up JobBored for this account' when a token is present", async () => {
    const env = loadCutover({ sheetId: "SHEET_OF_ANOTHER_ACCOUNT", signedIn: true });
    env.setup.showSheetAccessGate("error");
    await settle();
    const btn = env.document.getElementById("sheetAccessGateScreen").querySelector("#" + BTN);
    assert.ok(btn, "the start-fresh action must be rendered in error mode");
    assert.notEqual(btn.hidden, true, "…and visible while signed in");
    assert.match(btn.textContent, /Set up JobBored for this account/);
  });

  it("does not offer it while signed out (sign-in is the right next step then)", async () => {
    const env = loadCutover({ sheetId: "SHEET_OF_ANOTHER_ACCOUNT", signedIn: false });
    env.setup.showSheetAccessGate("error");
    await settle();
    const btn = env.document.getElementById("sheetAccessGateScreen").querySelector("#" + BTN);
    assert.ok(!btn || btn.hidden === true);
  });

  it("clicking it masks the sheet, resets legacy completion, and opens Beat 1 already signed in", async () => {
    const env = loadCutover({ sheetId: "SHEET_OF_ANOTHER_ACCOUNT", signedIn: true });
    const store = env.window.CommandCenterUserContent;
    await store.completeInfraSetup();
    await store.completeOnboarding();

    env.setup.showSheetAccessGate("error");
    await settle();
    env.document.getElementById("sheetAccessGateScreen").querySelector("#" + BTN).dispatch("click");
    await settle(12);

    const patch = env.calls.find((c) => c.name === "mergeStoredConfigOverridePatch");
    assert.ok(patch, "the configured sheet must be masked in the override store");
    assert.deepEqual(JSON.parse(JSON.stringify(patch.args[0])), { sheetId: "" });
    assert.equal(await store.isInfraSetupComplete(), false, "legacy infra flag reset (spec §3.3 would otherwise mark the flow complete)");
    assert.equal(await store.isOnboardingComplete(), false, "legacy onboarding flag reset");
    assert.equal(env.openBeat(), "google", "Beat 1 owns the surface — it creates this account's own sheet");
    assert.notEqual(env.document.getElementById("sheetAccessGateScreen").style.display, "flex", "the gate stands down");
  });
});
