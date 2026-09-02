import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadDemoBoard, readRepoFile, textOf } from "./oneflow-l4-harness.mjs";

/* ============================================================
   SIXBEATS V1 — screen S0 must look like the product (claim U1).

   WHY these claims: the founder's cold-start screenshot
   (docs/programs/sixbeats-20260902/SIXBEATS-SPEC.md, claim U1) shows a
   bare kanban of demo cards — no page header, no wordmark, no framing —
   with the invitation card collapsed into a corner pill and most of the
   viewport empty. The approved prototype (reference/six-beats-prototype.
   html, screen S0) shows the target: a header strip, a FRAMED board in
   the product's card language, and the invitation as the visual centre
   of gravity, sitting ON the board.

   The probes below are structural, not aesthetic: they pin the parts a
   screenshot can only show and a reviewer can only eyeball —

     1. the header strip (wordmark + the sample-pipeline kicker),
     2. the invitation on first mount, the pill ONLY after the escape,
     3. the framed board, with stage identity on every column and card,
     4. the cascade fix — S0's own type rules must outrank the global
        `body.jb-v2 h3 / p` rules that were silently eating them,
     5. the 390 px layout — one column, invitation above the board.

   (4) is the mechanism behind U1: `body.jb-v2 h3 {font-size:...}` in
   jb-type.css is specificity 0,1,1; `.oneflow-demo__column-title` is
   0,1,0. Every heading and paragraph on S0 rendered at the global type
   scale instead of the board's, which is what made the shipped screen
   read as an unstyled dump.
   ============================================================ */

const STAGES = ["new", "researching", "applied", "phone-screen", "interviewing", "offer"];

// ---------------------------------------------------------------
// css/oneflow.css region reader — V1's fence is the L4 region only.
// ---------------------------------------------------------------

const CSS = readRepoFile("css/oneflow.css");

/** The text of one fenced region, comments stripped. */
function region(name) {
  const marks = [...CSS.matchAll(/\/\* ONEFLOW:([A-Z0-9]+) \*\//g)];
  const index = marks.findIndex((m) => m[1] === name);
  assert.ok(index >= 0, `css/oneflow.css has no /* ONEFLOW:${name} */ fence`);
  const start = marks[index].index;
  const end = index + 1 < marks.length ? marks[index + 1].index : CSS.length;
  return CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Flat [selector, declarations] pairs, @media blocks included by condition. */
function rules(css, { insideMedia = null } = {}) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const head = css.slice(i, open).trim();
    // Brace-match so a nested @media block is consumed whole.
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") depth -= 1;
      j += 1;
    }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith("@")) {
      if (/^@media/.test(head)) out.push(...rules(body, { insideMedia: head }));
    } else if (head) {
      out.push({ selector: head, body, media: insideMedia });
    }
    i = j;
  }
  return out;
}

/** Declared value of `prop` in a rule body, or null. */
function decl(body, prop) {
  const match = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]+)`));
  return match ? match[1].trim() : null;
}

const L4 = region("L4");
const L4_RULES = rules(L4);

// ---------------------------------------------------------------
// 1 · The header strip
// ---------------------------------------------------------------

describe("S0 header strip — a zero-config visitor lands on a product, not a dump (U1)", () => {
  it("renders a header strip carrying the JobBored wordmark", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const header = root.querySelector(".oneflow-demo__header");
    assert.ok(header, "S0 needs a page header strip — the shipped screen had none");
    const wordmark = header.querySelector(".oneflow-demo__wordmark");
    assert.ok(wordmark, "the strip carries the product wordmark");
    assert.equal(
      textOf(wordmark).replace(/\s+/g, ""),
      "JobBored",
      "the wordmark reads JobBored — the first pixel names the product",
    );
  });

  it("puts the sample-pipeline kicker in the strip, verbatim", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const header = root.querySelector(".oneflow-demo__header");
    const note = header.querySelector(".oneflow-demo__note");
    assert.ok(note, "the kicker belongs to the header strip, not to the loose page");
    assert.equal(
      textOf(note),
      "Sample pipeline — this is what a set-up JobBored looks like.",
      "normative string — em-dash and full stop included",
    );
  });

  it("keeps the header when the fixture cannot be fetched", async () => {
    // No board is not the same as no product: the strip still frames the ask.
    const env = loadDemoBoard({
      fetchImpl: async () => ({ ok: false, status: 404, async json() { return null; } }),
    });
    const root = await env.board.mount();
    assert.ok(root.querySelector(".oneflow-demo__wordmark"));
    assert.equal(root.querySelector(".oneflow-demo__card"), null);
  });
});

// ---------------------------------------------------------------
// 2 · The invitation is the centre of gravity
// ---------------------------------------------------------------

describe("S0 invitation — visible on first mount, never auto-collapsed (U1)", () => {
  /** The retired session flag the shipped build read at mount time. */
  const RETIRED_PILL_FLAG = "jobbored_oneflow_demo_pill_collapsed";

  it("shows the invitation card on first mount", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    assert.ok(root.querySelector(".oneflow-demo__invite"), "the card is the ask");
    assert.equal(
      root.querySelector(".oneflow-demo__pill"),
      null,
      "the pill is the collapsed state — it must not be the opening state",
    );
  });

  it("ignores a stale collapse flag from an earlier visit", async () => {
    // This is the U1 screenshot: a returning visitor got the corner pill and
    // an empty viewport, with the whole deal reduced to a 200 px button.
    const env = loadDemoBoard({ sessionSeed: { [RETIRED_PILL_FLAG]: "1" } });
    const root = await env.board.mount();
    assert.ok(
      root.querySelector(".oneflow-demo__invite"),
      "a fresh page load always opens on the invitation, never on the pill",
    );
    assert.equal(root.querySelector(".oneflow-demo__pill"), null);
  });

  it("renders the pill only after 'Poke around first'", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    assert.equal(root.querySelector(".oneflow-demo__pill"), null);
    root
      .querySelectorAll("[data-oneflow-demo-action]")
      .find((node) => textOf(node) === "Poke around first")
      .dispatch("click", { preventDefault() {} });
    const pill = root.querySelector(".oneflow-demo__pill");
    assert.ok(pill, "the escape collapses the card to the pill");
    assert.equal(textOf(pill), "Set up JobBored — 15 min ▸");
    assert.ok(
      pill.querySelector(".oneflow-demo__pill-mark"),
      "the pill is designed — it carries the mark, not just a label",
    );
    assert.equal(root.querySelector(".oneflow-demo__invite"), null);
  });

  it("sits ON the framed board, not loose on the page", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const frame = root.querySelector(".oneflow-demo__frame");
    assert.ok(frame, "the board is framed");
    assert.ok(
      frame.querySelector(".oneflow-demo__ask"),
      "spec §4: the invitation sits over the board — value first, ask on top",
    );
    assert.ok(frame.querySelector(".oneflow-demo__board"), "and so does the board");
  });
});

// ---------------------------------------------------------------
// 3 · The board speaks the product's card language
// ---------------------------------------------------------------

describe("S0 board — the product's own card language (U1)", () => {
  it("gives every column its stage identity", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const columns = root.querySelectorAll(".oneflow-demo__column");
    assert.ok(columns.length >= 4, "the fixture spans at least four stages");
    for (const column of columns) {
      const stage = STAGES.find((key) =>
        column.classList.contains(`oneflow-demo__column--${key}`),
      );
      assert.ok(
        stage,
        `a column rendered without a stage class: ${column.className}`,
      );
    }
  });

  it("gives every card its stage rail class", async () => {
    const env = loadDemoBoard();
    const root = await env.board.mount();
    const cards = root.querySelectorAll(".oneflow-demo__card");
    assert.equal(cards.length, 8);
    for (const card of cards) {
      assert.ok(
        STAGES.some((key) => card.classList.contains(`oneflow-demo__card--stage-${key}`)),
        `a card rendered without a stage rail: ${card.className}`,
      );
    }
  });

  it("paints the rail from the shipped stage tokens", () => {
    for (const stage of STAGES) {
      const rule = L4_RULES.find(
        (r) => !r.media && r.selector.includes(`.oneflow-demo__card--stage-${stage}`),
      );
      assert.ok(rule, `L4 has no rail rule for stage "${stage}"`);
      assert.match(
        rule.body,
        /--jb-stage-|--stage-rail-/,
        `stage "${stage}" must reuse the shipped stage tokens, not a new colour`,
      );
    }
  });
});

// ---------------------------------------------------------------
// 4 · The cascade fix — the mechanism behind U1
// ---------------------------------------------------------------

describe("S0 type scale — S0's rules must outrank the global element rules (U1)", () => {
  /* jb-type.css ships `body.jb-v2 h3 {font-size: var(--jb-text-xl)}` and
     `body.jb-v2 p {font-size: var(--jb-text-base)}` — specificity 0,1,1. A
     lone `.oneflow-demo__role` is 0,1,0 and loses, which is why the shipped
     board rendered its column titles at 22 px and its kickers at 15 px. Every
     S0 rule that sets type has to carry the `.oneflow-demo` ancestor. */
  const TYPE_PROPS = ["font-size", "font-family", "font-weight", "line-height"];

  it("scopes every type-setting S0 rule under .oneflow-demo", () => {
    const offenders = [];
    for (const rule of L4_RULES) {
      if (!/\.oneflow-demo__/.test(rule.selector)) continue;
      if (!TYPE_PROPS.some((prop) => decl(rule.body, prop))) continue;
      for (const part of rule.selector.split(",").map((s) => s.trim())) {
        if (!/\.oneflow-demo__/.test(part)) continue;
        // ".oneflow-demo .oneflow-demo__x" (0,2,0) beats "body.jb-v2 h3".
        if (!/^\.oneflow-demo[\s.]/.test(part)) offenders.push(part);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "these S0 type rules lose to body.jb-v2 h3 / p and render at the wrong scale",
    );
  });

  it("keeps every S0 rule inside the L4 fence", () => {
    for (const name of ["CORE", "L1", "L2", "L3"]) {
      assert.ok(
        !/\.oneflow-demo\b/.test(region(name)),
        `S0 styling leaked out of the L4 fence into ONEFLOW:${name}`,
      );
    }
  });
});

// ---------------------------------------------------------------
// 5 · 390 px — one column, the ask above the board
// ---------------------------------------------------------------

describe("S0 at 390 px — one column, invitation above the board (U1)", () => {
  const MOBILE = L4_RULES.filter(
    (r) => r.media && /max-width/.test(r.media),
  );

  it("has a mobile breakpoint at or above 390 px", () => {
    assert.ok(MOBILE.length, "L4 ships no mobile rules for S0");
    const widths = [...new Set(MOBILE.map((r) => r.media))].map((m) =>
      Number(String(m.match(/max-width:\s*(\d+)/)?.[1] || 0)),
    );
    assert.ok(
      widths.some((w) => w >= 390),
      `the 390 px viewport must be covered; breakpoints are ${widths.join(", ")}`,
    );
  });

  it("collapses the board to a single column", () => {
    const rule = MOBILE.find((r) => r.selector.includes(".oneflow-demo__board"));
    assert.ok(rule, "no mobile rule for the board");
    assert.match(
      String(decl(rule.body, "grid-template-columns")),
      /^1fr$/,
      "a six-column grid on a 390 px phone is the shipped bug",
    );
  });

  it("lifts the invitation out of the overlay and above the board", () => {
    const rule = MOBILE.find((r) => r.selector.includes(".oneflow-demo__ask"));
    assert.ok(rule, "no mobile rule for the invitation");
    assert.match(
      String(decl(rule.body, "position")),
      /^static|^relative/,
      "the fixed/absolute overlay cuts the cards in half on a phone",
    );
    assert.equal(
      decl(rule.body, "order"),
      "-1",
      "the ask reads first on a phone — you scroll INTO the sample, not past it",
    );
  });
});
