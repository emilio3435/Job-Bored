/**
 * SIXBEATS-2 NEW-5 (BLOCKER) — the demo detail was a one-way door.
 *
 * The acceptance rerun opened a demo card on screen S0, and the read-only
 * detail it produced (`position: fixed`, `z-index: 5`, bottom-right) had no
 * close control of any kind. It landed exactly on top of the collapsed
 * "Set up JobBored — 15 min ▸" pill and swallowed its clicks, so a visitor
 * who poked around first and then wanted the product could not get back to
 * the flow without reloading the page.
 *
 * Two halves to the fix, and this file holds the DOM half:
 *   · the detail has a Close control, and Escape closes it too;
 *   · re-opening and closing leave the board itself untouched.
 * The geometry half — the pill's box clear of the detail's, and a real click
 * landing on it — is proven in a browser by
 * tests/e2e-visual/fuel-and-polish.spec.mjs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadDemoBoard } from "./oneflow-l4-harness.mjs";

function openFirstCard(root) {
  const card = root.querySelectorAll(".oneflow-demo__card")[0];
  card.dispatch("click", { preventDefault() {}, stopPropagation() {} });
  return card;
}

const detailOf = (root) => root.querySelector(".oneflow-demo__detail");

describe("SIXBEATS2 NEW-5 · the demo-card detail can be dismissed", () => {
  it("offers a Close control the moment it opens", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    openFirstCard(root);
    const close = detailOf(root).querySelector(".oneflow-demo__detail-close");
    assert.ok(close, "a panel with no way out is the blocker NEW-5 recorded");
    assert.equal(close.tagName, "BUTTON");
    assert.equal(close.type, "button");
    assert.ok(
      (close.getAttribute("aria-label") || "").trim().length,
      "an icon-only control still needs an accessible name",
    );
  });

  it("clicking Close removes the detail and leaves the board standing", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    openFirstCard(root);
    const cardsBefore = root.querySelectorAll(".oneflow-demo__card").length;
    detailOf(root)
      .querySelector(".oneflow-demo__detail-close")
      .dispatch("click", { preventDefault() {}, stopPropagation() {} });
    assert.equal(detailOf(root), null, "the detail is gone, not merely hidden");
    assert.equal(
      root.querySelectorAll(".oneflow-demo__card").length,
      cardsBefore,
      "dismissing a detail must not disturb the board underneath",
    );
  });

  it("Escape closes it, and other keys do not", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    openFirstCard(root);
    detailOf(root).dispatch("keydown", { key: "a", preventDefault() {} });
    assert.ok(detailOf(root), "an unrelated key must not dismiss the panel");
    detailOf(root).dispatch("keydown", { key: "Escape", preventDefault() {} });
    assert.equal(detailOf(root), null, "Escape is how a reader closes an overlay");
  });

  it("re-opens after being closed", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    openFirstCard(root);
    detailOf(root).dispatch("keydown", { key: "Escape", preventDefault() {} });
    const second = root.querySelectorAll(".oneflow-demo__card")[1];
    second.dispatch("click", { preventDefault() {}, stopPropagation() {} });
    assert.ok(detailOf(root), "closing once must not disarm the cards");
  });

  it("still offers nothing that writes — Close is the only control", async () => {
    // The original claim (L4) was that a demo card promises no write it
    // cannot keep. A dismiss control keeps that promise; it changes nothing
    // but its own visibility.
    const env = loadDemoBoard();
    const root = await env.board.mount();
    openFirstCard(root);
    const controls = [];
    const walk = (node) => {
      if (!node) return;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(node.tagName)) {
        controls.push(node);
      }
      for (const child of node.children || []) walk(child);
    };
    walk(detailOf(root));
    assert.equal(controls.length, 1, "exactly one control, and it is the close");
    assert.ok(controls[0].classList.contains("oneflow-demo__detail-close"));
    assert.equal(detailOf(root).getAttribute("aria-readonly"), "true");
  });
});
