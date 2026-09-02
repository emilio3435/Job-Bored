/**
 * SIXBEATS-2 NEW-9 — B5's numbered steps glued their marker to the sentence
 * before them.
 *
 * On screen the rerun read:
 *   `1. Create a free SerpApi account (Google login works, no card needed).1 · Create your free account ↗`
 * Two numberings fighting each other: a literal "1." typed into the step's
 * own text, and a deep link whose label starts "1 ·" rendered inline right
 * behind the full stop.
 *
 * The fix is markup, not words: the steps are a real ordered list, so the
 * browser draws the marker at the start of the line, and each deep link is
 * its own block. The sentences a reader sees are unchanged (spec §5 B5 —
 * "three numbered steps with deep links"; the digits were always
 * presentation).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDiscoveryBeat, readRepoFile } from "./oneflow-l3-harness.mjs";

const css = readRepoFile("css/oneflow.css");

/** The declaration block of one selector, or "" when it is not there. */
function ruleFor(selector) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return "";
  return css.slice(at, css.indexOf("}", at));
}

describe("SIXBEATS2 NEW-9 · the fuel steps are a real ordered list", () => {
  it("no step types its own number — the list draws the marker", async () => {
    const env = loadDiscoveryBeat();
    await env.flow.open("discovery");
    const steps = [...env.mount.querySelectorAll(".oneflow-fuel__step")];
    assert.equal(steps.length, 3, "spec §5 B5: three steps");
    for (const step of steps) {
      assert.doesNotMatch(
        step.textContent,
        /^\s*\d+\.\s/,
        "a hand-typed '1.' is what collided with the link label behind it",
      );
    }
    assert.match(steps[0].textContent, /^Create a free SerpApi account/);
    assert.match(steps[1].textContent, /^Copy your API key from the dashboard/);
    assert.match(steps[2].textContent, /^Paste it below and hit Save & verify/);
  });

  it("keeps the <ol>/<li> structure the marker depends on", async () => {
    const env = loadDiscoveryBeat();
    await env.flow.open("discovery");
    const list = env.mount.querySelector(".oneflow-fuel__steps");
    assert.ok(list, "the steps live in a list");
    assert.equal(list.tagName, "OL", "an ordered list, so the order is semantic");
    for (const step of list.children) assert.equal(step.tagName, "LI");
  });

  it("still deep-links steps 1 and 2, inside their own step", async () => {
    const env = loadDiscoveryBeat();
    await env.flow.open("discovery");
    const steps = [...env.mount.querySelectorAll(".oneflow-fuel__step")];
    assert.equal(
      steps[0].querySelector("[href]").getAttribute("href"),
      "https://serpapi.com/users/sign_up",
    );
    assert.equal(
      steps[1].querySelector("[href]").getAttribute("href"),
      "https://serpapi.com/manage-api-key",
    );
    assert.equal(steps[2].querySelector("[href]"), null, "step 3 is the key field");
  });

  it("styles the list so the marker renders and the link starts its own line", () => {
    // The CSS half of the same claim; the geometry is measured for real in
    // tests/e2e-visual/fuel-and-polish.spec.mjs.
    const list = ruleFor(".oneflow-fuel__steps");
    assert.doesNotMatch(
      list,
      /list-style:\s*none/,
      "list-style: none is why there was no marker to put on the line start",
    );
    assert.match(list, /list-style:\s*decimal/);
    assert.match(ruleFor(".oneflow-fuel__step"), /display:\s*list-item/);
    assert.match(
      ruleFor(".oneflow-fuel__step .oneflow-beat__keylink"),
      /display:\s*block/,
      "an inline deep link is what glued '1 ·' to the previous full stop",
    );
  });
});
