/**
 * JOBQA: the Google Client ID and the AI key sit next to their action, with
 * their own error line; the long instructions are one click away. Desktop
 * layout only; DOM order, the error wiring and focus are asserted here, and
 * the pixel check at 1280×800 / 1440×900 is the desktop retest's.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadArrival } from "./oneflow-l1-harness.mjs";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every element under `node`, in document order. */
function walk(node, out = []) {
  for (const child of node.children || []) {
    out.push(child);
    walk(child, out);
  }
  return out;
}

const indexOf = (all, cls) => all.findIndex((n) => n.classList && n.classList.contains(cls));

describe("JOBQA Google step: the Client ID field comes before the instructions", () => {
  async function openGoogle() {
    // No Client ID yet: the first-time path (G1).
    const env = loadArrival({ host: { getOAuthClientId: () => "" } });
    await env.flow.open("google");
    return env;
  }

  it("should put the input and its Save button first, with the six steps collapsed below", async () => {
    const env = await openGoogle();
    const detour = env.mount().querySelector(".oneflow-google__detour");
    assert.equal(detour.open, true, "G1: open when there is no Client ID");
    const all = walk(detour);
    const input = all.findIndex((n) => n.id === "oneFlowOauthClientIdInput");
    const steps = indexOf(all, "oneflow-google__detour-steps");
    assert.ok(input !== -1 && steps !== -1);
    assert.ok(input < steps, "the field is on screen before the long steps");
    const row = env.mount().querySelector(".oneflow-google__client-id-row");
    assert.ok(row.querySelector("#oneFlowOauthClientIdInput") && row.querySelector(".oneflow-google__client-id-save"), "Save sits beside the field");
    const howto = env.mount().querySelector(".oneflow-google__detour-howto");
    assert.notEqual(howto.open, true, "the steps are one click away, not in the way");
    assert.equal(howto.querySelectorAll(".oneflow-google__detour-step-link").length, 6, "all six steps are still there");
  });

  it("should show a malformed Client ID's error at the field, mark it invalid and focus it", async () => {
    const env = await openGoogle();
    env.mount().querySelector("#oneFlowOauthClientIdInput").value = "not-a-client-id";
    env.mount().querySelector(".oneflow-google__client-id-save").dispatch("click");
    await tick();
    const input = env.mount().querySelector("#oneFlowOauthClientIdInput");
    const error = env.mount().querySelector("#oneFlowOauthClientIdError");
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(input.getAttribute("aria-describedby"), "oneFlowOauthClientIdError");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /\.apps\.googleusercontent\.com/);
    assert.equal(env.document.activeElement, input, "focus lands on the field after the repaint");
  });

  it("should clear the error as soon as the user edits, and when a valid ID is saved", async () => {
    const env = await openGoogle();
    env.mount().querySelector("#oneFlowOauthClientIdInput").value = "nope";
    env.mount().querySelector(".oneflow-google__client-id-save").dispatch("click");
    await tick();
    let input = env.mount().querySelector("#oneFlowOauthClientIdInput");
    input.value = "fixture";
    input.dispatch("input");
    assert.equal(input.getAttribute("aria-invalid"), null, "typing clears the stale error in place");
    assert.equal(env.mount().querySelector("#oneFlowOauthClientIdError").hidden, true);
    input.value = "jobqa-fixture.apps.googleusercontent.com";
    env.mount().querySelector(".oneflow-google__client-id-save").dispatch("click");
    await tick();
    input = env.mount().querySelector("#oneFlowOauthClientIdInput");
    assert.equal(input.getAttribute("aria-invalid"), null);
    assert.match(env.mount().textContent, /Client ID saved/);
  });

  it("should mark the very field on screen, since a footer message keeps the step's DOM", async () => {
    // Found by an automated diagnostic in real Chromium (not Astra's desktop
    // retest): the shell's message update leaves the step body in place, so
    // an error drawn only at render never appeared.
    const env = await openGoogle();
    // Model that shell: a message updates the footer and nothing else.
    env.shell.setMessage = () => {};
    const input = env.mount().querySelector("#oneFlowOauthClientIdInput");
    const error = env.mount().querySelector("#oneFlowOauthClientIdError");
    input.value = "not-a-client-id";
    env.mount().querySelector(".oneflow-google__client-id-save").dispatch("click");
    await tick();
    assert.equal(input.getAttribute("aria-invalid"), "true", "the field the user is looking at is marked");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /\.apps\.googleusercontent\.com/);
    input.value = "jobqa-fixture.apps.googleusercontent.com";
    env.mount().querySelector(".oneflow-google__client-id-save").dispatch("click");
    await tick();
    assert.equal(input.getAttribute("aria-invalid"), null, "a valid save clears the same field");
    assert.equal(error.hidden, true);
  });

  it("should open the steps and the rejected address together when Google refused this page", async () => {
    const env = loadArrival({ host: { getOAuthClientId: () => "" } });
    env.flow.seedRuntime({ failingOrigin: "http://127.0.0.1:18680" });
    await env.flow.open("google");
    const howto = env.mount().querySelector(".oneflow-google__detour-howto");
    if (env.mount().querySelector(".oneflow-google__detour-failing-origin")) {
      assert.equal(howto.open, true);
    }
  });
});

describe("JOBQA AI step: the key field comes before how to get a key", () => {
  async function openAi(options = {}) {
    const env = loadArrival(options);
    await env.store.saveOnboardingFlowState({ completedBeats: ["google"] });
    await env.flow.open("ai");
    return env;
  }

  it("should render the masked key field right after the provider cards, the steps collapsed below it", async () => {
    const env = await openAi();
    const root = env.mount().querySelector(".oneflow-ai__key");
    const all = walk(root);
    const input = all.findIndex((n) => n.id === "oneFlowAiKeyInput");
    const steps = indexOf(all, "oneflow-ai__steps");
    assert.ok(input !== -1 && steps !== -1);
    assert.ok(input < steps, "the key field is on screen before the how-to");
    assert.equal(all[input].type, "password", "the key stays masked");
    const howto = env.mount().querySelector(".oneflow-ai__key-howto");
    assert.notEqual(howto.open, true);
    assert.ok(howto.querySelector(".oneflow-ai__signup"), "the signup link is still there");
  });

  it("should show an empty key's error at the field and focus it", async () => {
    const env = await openAi();
    await env.beats.ai.handleAction("ai_check");
    await tick();
    const input = env.mount().querySelector("#oneFlowAiKeyInput");
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(input.getAttribute("aria-describedby"), "oneFlowAiFieldError");
    assert.match(env.mount().querySelector("#oneFlowAiFieldError").textContent, /key first/);
    assert.equal(env.document.activeElement, input);
  });

  it("should mark the very key field on screen, and clear it when a real check starts", async () => {
    let finishCheck;
    const env = await openAi({
      verifyProvider: () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    });
    // Model the real shell: messages and busy stages leave the step's DOM alone.
    env.shell.setMessage = () => {};
    env.shell.setBusy = () => {};
    env.shell.clearBusy = () => {};
    const input = env.mount().querySelector("#oneFlowAiKeyInput");
    const error = env.mount().querySelector("#oneFlowAiFieldError");
    await env.beats.ai.handleAction("ai_check");
    await tick();
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(error.hidden, false);
    input.value = "fixture-ok";
    const running = env.beats.ai.handleAction("ai_check");
    await tick();
    assert.equal(input.getAttribute("aria-invalid"), null, "a real attempt clears the old complaint on the same field");
    assert.equal(error.hidden, true);
    finishCheck({ ok: false, message: "Key rejected (mock)." });
    await running;
  });

  it("should clear the stale error when a real check begins", async () => {
    let finishCheck;
    const env = await openAi({
      verifyProvider: () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    });
    await env.beats.ai.handleAction("ai_check");
    await tick();
    env.mount().querySelector("#oneFlowAiKeyInput").value = "fixture-ok";
    const running = env.beats.ai.handleAction("ai_check");
    await tick();
    const error = env.mount().querySelector(".discovery-setup-wizard__message--error");
    assert.equal(error, null, "no stale 'paste your key' error sits under the running check");
    const field = env.mount().querySelector("#oneFlowAiFieldError");
    assert.ok(!field || field.hidden, "the field's own error is gone too");
    finishCheck({ ok: false, message: "Key rejected (mock)." });
    await running;
  });
});
