import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadDemoBoard,
  readRepoFile,
  textOf,
} from "./oneflow-l4-harness.mjs";

/* ============================================================
   Screen S0 — the demo board (ONE-FLOW-ONBOARDING-SPEC §4).

   WHY these claims: the teardown found a cold start that opens with a
   credential ask and shows nothing of the product. §4's whole job is to
   invert that — the promise, with data, BEFORE any ask. So the probes
   assert the three things that make the give real:

     1. the fixture is curated, deterministic, and shaped like a board
        (locked decision §11.4 — a bundled fixture, never a generated
        sample, so cold start costs zero AI calls and never varies),
     2. the board renders as a self-contained, honestly-watermarked
        overlay that unmounts the moment real rows arrive (§4 "Exit"),
     3. the invitation ↔ corner-pill round-trip survives a re-mount, so
        "Poke around first" is a real escape and not a dead end.
   ============================================================ */

const FIXTURE = JSON.parse(readRepoFile("fixtures/demo-pipeline.json"));

/** Every tag name in a rendered subtree — the fake DOM matches ids and
    classes, not tag selectors, so structural claims walk the tree. */
function tagsIn(node) {
  if (!node) return [];
  return [node.tagName, ...(node.children || []).flatMap(tagsIn)];
}

describe("S0 fixture — fixtures/demo-pipeline.json (spec §4, §11.4)", () => {
  it("ships exactly 8 curated rows", () => {
    assert.equal(FIXTURE.rows.length, 8, "spec §4 says ~8 rows across stages");
  });

  it("every row carries a fit score and a one-line 'why it fits'", () => {
    for (const row of FIXTURE.rows) {
      assert.ok(
        Number.isInteger(row.fitScore) && row.fitScore >= 0 && row.fitScore <= 100,
        `${row.jobKey} needs an integer 0–100 fitScore`,
      );
      assert.ok(
        typeof row.whyItFits === "string" && row.whyItFits.trim().length > 0,
        `${row.jobKey} needs a "why it fits" line`,
      );
      assert.ok(
        row.whyItFits.length <= 140,
        `${row.jobKey}'s reason must stay one line (got ${row.whyItFits.length} chars)`,
      );
    }
  });

  it("spreads across stages so the board reads as a pipeline, not an inbox", () => {
    const stages = new Set(FIXTURE.rows.map((r) => r.stage));
    assert.ok(
      stages.size >= 4,
      `demo rows must span at least 4 stages, got ${[...stages].join(", ")}`,
    );
  });

  it("uses only canonical stage-registry keys", () => {
    // A fixture stage the registry can't normalize would render as an
    // orphan column the moment anyone reuses this data.
    const registry = readRepoFile("stage-registry.js");
    for (const row of FIXTURE.rows) {
      assert.match(
        registry,
        new RegExp(`"${row.stage}"`),
        `stage "${row.stage}" is not a stage-registry key`,
      );
    }
    for (const row of FIXTURE.rows) {
      assert.ok(
        !["rejected", "passed", "expired"].includes(row.stage),
        "archived stages are collapsed by default — a demo row there is invisible",
      );
    }
  });

  it("carries no personal data — no emails, phone numbers, or URLs", () => {
    const raw = readRepoFile("fixtures/demo-pipeline.json");
    assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(raw), "no email addresses");
    assert.ok(!/\+?\d[\d ().-]{8,}\d/.test(raw), "no phone numbers");
    assert.ok(!/https?:\/\//i.test(raw), "no live links in demo data");
  });

  it("has unique job keys so the renderer can key rows without collisions", () => {
    const keys = FIXTURE.rows.map((r) => r.jobKey);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("S0 demo board — mount / unmount (spec §4)", () => {
  it("mounts a self-contained overlay seeded from the fixture", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    assert.ok(root, "mount() returns the overlay root");
    assert.equal(env.board.isActive(), true);
    assert.equal(
      env.document.body.children.includes(root),
      true,
      "the board mounts into the page, not into the wizard shell",
    );
    const cards = root.querySelectorAll(".oneflow-demo__card");
    assert.equal(cards.length, 8, "one card per fixture row");
  });

  it("watermarks every card DEMO — the board must never read as real data", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const chips = root.querySelectorAll(".oneflow-demo__chip");
    assert.equal(chips.length, 8, "every card carries its own DEMO chip");
    for (const chip of chips) assert.equal(textOf(chip), "DEMO");
    assert.equal(
      root.classList.contains("oneflow-demo--watermarked"),
      true,
      "the reduced-opacity treatment is a class on the root, not per-card styling",
    );
  });

  it("renders each row's fit score and reason so the promise is legible", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const text = textOf(root);
    for (const row of FIXTURE.rows) {
      assert.ok(text.includes(row.company), `${row.company} is on the board`);
      assert.ok(text.includes(row.role), `${row.role} is on the board`);
      assert.ok(text.includes(row.whyItFits), `${row.jobKey}'s reason is shown`);
      assert.ok(text.includes(String(row.fitScore)), `${row.jobKey}'s score is shown`);
    }
  });

  it("opens a READ-ONLY detail on card click — nothing on this board writes", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const card = root.querySelectorAll(".oneflow-demo__card")[0];
    card.dispatch("click", { preventDefault() {}, stopPropagation() {} });
    const detail = root.querySelector(".oneflow-demo__detail");
    assert.ok(detail, "a detail panel opens");
    assert.ok(
      textOf(detail).includes(FIXTURE.rows[0].whyItFits),
      "the detail shows the clicked row",
    );
    assert.deepEqual(
      tagsIn(detail).filter((t) => ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(t)),
      [],
      "read-only: the demo detail offers no editable or actionable control",
    );
    assert.equal(detail.getAttribute("aria-readonly"), "true");
  });

  it("unmount() removes the overlay and reports inactive", async () => {
    const env = loadDemoBoard();
    await env.board.mount();
    env.board.unmount();
    assert.equal(env.board.isActive(), false);
    assert.equal(env.document.body.children.length, 0);
  });

  it("degrades to the invitation alone when the fixture can't be fetched", async () => {
    // A file:// open or a 404 must still deliver the ask — the board is the
    // sweetener, the invitation is the point.
    const env = loadDemoBoard({
      fetchImpl: async () => ({ ok: false, status: 404, async json() { return null; } }),
    });
    const root = await env.board.mount();
    assert.ok(root, "the invitation still mounts");
    assert.equal(root.querySelectorAll(".oneflow-demo__card").length, 0);
    assert.ok(
      textOf(root).includes("This is your job hunt on autopilot."),
      "the normative invitation copy still lands",
    );
  });

  it("unmounts itself when the first real Sheet rows render (spec §4 Exit)", async () => {
    const env = loadDemoBoard();
    await env.board.mount();
    assert.equal(env.board.isActive(), true);
    // The pipeline controller is the call-only source of truth for "are
    // there real rows"; the demo board never reaches into the renderer.
    env.window.JobBoredApp = {
      pipelineController: { getPipelineData: () => [{ jobKey: "real-1" }] },
    };
    env.board._onPipelineRendered();
    assert.equal(env.board.isActive(), false, "first real row replaces the fixture");
  });

  it("stays mounted while the real pipeline is still empty", async () => {
    const env = loadDemoBoard();
    await env.board.mount();
    env.window.JobBoredApp = {
      pipelineController: { getPipelineData: () => [] },
    };
    env.board._onPipelineRendered();
    assert.equal(env.board.isActive(), true);
  });
});

describe("S0 invitation card — normative copy (spec §4)", () => {
  it("ships the headline, the deal, and the privacy sentence verbatim", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const card = root.querySelector(".oneflow-demo__invite");
    assert.ok(card, "the invitation card renders over the board");
    const text = textOf(card);
    assert.ok(text.includes("This is your job hunt on autopilot."));
    assert.ok(
      text.includes(
        "Set it up once — about fifteen focused minutes — and roles scored against your fit land here every morning.",
      ),
      "the time promise is verbatim, em-dashes included",
    );
    assert.ok(
      text.includes(
        "Your resume and pipeline stay in your Google Sheet and on this machine.",
      ),
      "spec §8.3 — every data ask carries its privacy sentence",
    );
  });

  it("labels both actions verbatim", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const labels = root
      .querySelectorAll(".oneflow-demo__invite-action")
      .map((el) => textOf(el));
    assert.deepEqual(labels, ["Make it mine — 15 min, once", "Poke around first"]);
  });
});

describe("S0 invitation ↔ corner pill round-trip (spec §4 Interactions)", () => {
  function clickByLabel(root, label) {
    const el = root
      .querySelectorAll("[data-oneflow-demo-action]")
      .find((node) => textOf(node) === label);
    assert.ok(el, `no control labelled "${label}"`);
    el.dispatch("click", { preventDefault() {}, stopPropagation() {} });
    return el;
  }

  it("'Make it mine — 15 min, once' opens the flow", async () => {
    const env = loadDemoBoard();
    const opened = [];
    env.window.JobBoredOneFlow = { open: (id) => opened.push(id) };
    const root = await env.board.mount();
    clickByLabel(root, "Make it mine — 15 min, once");
    assert.equal(opened.length, 1, "the primary hands straight to the flow");
  });

  it("'Poke around first' collapses the card to the corner pill", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    clickByLabel(root, "Poke around first");
    assert.equal(
      root.querySelector(".oneflow-demo__invite"),
      null,
      "the card is gone",
    );
    const pill = root.querySelector(".oneflow-demo__pill");
    assert.ok(pill, "the corner pill takes its place");
    assert.equal(textOf(pill), "Set up JobBored — 15 min ▸");
  });

  it("the collapse persists across the session — a remount shows the pill", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    clickByLabel(root, "Poke around first");
    env.board.unmount();
    const again = await env.board.mount();
    assert.equal(
      again.querySelector(".oneflow-demo__invite"),
      null,
      "the card must not reappear inside the same session",
    );
    assert.ok(again.querySelector(".oneflow-demo__pill"));
  });

  it("a fresh session gets the full card back", async () => {
    const env = loadDemoBoard(); // no session seed
    const root = await env.board.mount();
    assert.ok(root.querySelector(".oneflow-demo__invite"));
  });

  it("the pill reopens the flow", async () => {
    const env = loadDemoBoard();
    const opened = [];
    env.window.JobBoredOneFlow = { open: (id) => opened.push(id) };
    const root = await env.board.mount();
    clickByLabel(root, "Poke around first");
    clickByLabel(root, "Set up JobBored — 15 min ▸");
    assert.equal(opened.length, 1, "the pill is a real re-entry, not decoration");
  });

  it("survives a missing sessionStorage (private mode) without losing the card", async () => {
    const env = loadDemoBoard();
    delete env.window.sessionStorage;
    const root = await env.board.mount();
    assert.ok(
      root.querySelector(".oneflow-demo__invite"),
      "storage is a convenience; the invitation is not gated on it",
    );
  });
});

describe("S0 — locked decision: no pipeline-render.js edits", () => {
  it("the demo board never reaches into the real renderer", () => {
    // Comments are allowed to NAME the decision; code must not break it.
    const code = readRepoFile("oneflow-demo-board.js")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/renderPipeline|JobBoredPipelineRender|pipelineRender/.test(code),
      "S0 is a SELF-CONTAINED overlay (SUBSTRATE locked decision) — it must not drive pipeline-render.js",
    );
  });
});
