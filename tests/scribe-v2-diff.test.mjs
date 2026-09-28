/* scribe-v2-diff.test.mjs — EDITOR lane F2.

   A proposal is reviewed as suggesting-mode marks on the real render
   (SPEC §2): a word-level diff inside each block, unchanged gaps of two
   words or fewer merged into the change, figures and punctuation kept as
   their own tokens, and a structural diff by node id (one change per op,
   glyph + − ~). The loss meter and the "Accept all skips Unverified" rule
   read off summarize(). markElement writes the marks into the template's
   own markup without flattening it, so a bold metric survives.

   Harness: node:vm with tests/fixtures/jb-dom.mjs for the DOM half. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { makeEnv } from "./fixtures/jb-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = makeEnv();
vm.runInNewContext(readFileSync(join(repoRoot, "scribe-v2-diff.js"), "utf8"), win);
const D = win.JBScribeDiff;

const plain = (v) => JSON.parse(JSON.stringify(v));
/* "same [-del-]{+ins+}" — one line per diff, easy to read in a failure. */
const show = (parts) => parts.map((p) => (p.kind === "ins" ? `{+${p.text}+}` : p.kind === "del" ? `[-${p.text}-]` : p.text)).join("");
/* What a block reads as once the change is taken, and before it. */
const after = (parts) => parts.filter((p) => p.kind !== "del").map((p) => p.text).join("");
const before = (parts) => parts.filter((p) => p.kind !== "ins").map((p) => (p.a != null ? p.a : p.text)).join("");

describe("diffWords: word-level Myers", () => {
  it("should find no change in identical text", () => {
    assert.deepEqual(plain(D.diffWords("Cut latency 38%.", "Cut latency 38%.")), [{ kind: "same", text: "Cut latency 38%." }]);
  });

  it("should mark one swapped word and keep the rest", () => {
    assert.equal(show(D.diffWords("Built a weekly dashboard for ops.", "Built a daily dashboard for ops.")), "Built a [-weekly-]{+daily+} dashboard for ops.");
  });

  it("should always reproduce both sides exactly", () => {
    const pairs = [
      ["Measured carrier delays and built a weekly dashboard for the operations team.", "Measured carrier delays and reduced delays through a weekly operations dashboard."],
      ["Operations analyst who reduced fulfillment delays 38% through careful measurement.", "Operations analyst who cut fulfillment delays 38% by measuring carriers weekly."],
      ["", "New line."],
      ["Old line.", ""],
      ["a b c d e f g", "g f e d c b a"],
    ];
    for (const [a, b] of pairs) {
      const parts = D.diffWords(a, b);
      assert.equal(before(parts), a, `A side of ${JSON.stringify(a)}`);
      assert.equal(after(parts), b, `B side of ${JSON.stringify(b)}`);
    }
  });

  it("should fold an unchanged gap of two words into one change", () => {
    /* "the old" sits between two edits: one mark, not a stutter. */
    assert.equal(
      show(D.diffWords("Led the old move to services.", "Ran the old rebuild to services.")),
      "[-Led the old move-]{+Ran the old rebuild+} to services.",
    );
  });

  it("should keep an unchanged gap of three words as its own text", () => {
    assert.equal(
      show(D.diffWords("Led a big checkout move today.", "Ran a big checkout rebuild today.")),
      "[-Led-]{+Ran+} a big checkout [-move-]{+rebuild+} today.",
    );
  });

  it("should treat punctuation as its own token and keep figures whole", () => {
    assert.equal(show(D.diffWords("Cut delays 38%.", "Cut delays 38%!")), "Cut delays 38%[-.-]{+!+}");
    assert.deepEqual(plain(D.tokenize("Saved $4.1M, 2.3M runs")), ["Saved", " ", "$4.1M", ",", " ", "2.3M", " ", "runs"]);
    assert.equal(show(D.diffWords("Cut latency 38% by moving it.", "Cut p95 latency 38% by moving it.")), "Cut {+p95 +}latency 38% by moving it.");
  });

  it("should not call a template's line breaks an edit", () => {
    const parts = D.diffWords("\n      Led the team.\n    ", "Led the team.");
    assert.equal(parts.filter((p) => p.kind !== "same").length, 0);
    assert.equal(before(parts), "\n      Led the team.\n    ", "A's own whitespace is kept for marking in place");
  });

  it("should mark a whole insertion or a whole removal", () => {
    assert.equal(show(D.diffWords("", "New line.")), "{+New line.+}");
    assert.equal(show(D.diffWords("Old line.", "")), "[-Old line.-]");
  });

  it("should replace a block too large to diff rather than hang", () => {
    const big = Array.from({ length: 4200 }, (_, i) => `w${i}`).join(" ");
    const parts = D.diffWords(big, "short");
    assert.deepEqual(plain(parts.map((p) => p.kind)), ["del", "ins"]);
  });
});

describe("changesFromOps: the structural diff by node id", () => {
  const text = { stmt: "Operations analyst who reduced delays 38%.", "b:acme:c19": "Documented the handoff process." };
  const textOf = (id) => text[id] || "";
  const ops = [
    { opId: "o1", op: "replace", node: "stmt", text: "Operations analyst who cut delays 38%.", rationale: "punchier" },
    { opId: "o2", op: "insert", after: "b:acme:c14", claimId: "c22", text: "Mentored 4 coordinators.", flags: ["unverified"] },
    { opId: "o3", op: "remove", node: "b:acme:c19" },
  ];

  it("should give each op its glyph, block and word tallies", () => {
    const changes = plain(D.changesFromOps(ops, textOf));
    assert.deepEqual(changes.map((c) => [c.opId, c.kind, c.glyph, c.node]), [
      ["o1", "replace", "~", "stmt"],
      ["o2", "insert", "+", "b:acme:c14"],
      ["o3", "remove", "−", "b:acme:c19"],
    ]);
    assert.equal(show(changes[0].parts), "Operations analyst who [-reduced-]{+cut+} delays 38%.");
    assert.deepEqual([changes[1].added, changes[1].delta], [3, 3]);
    assert.deepEqual([changes[2].removed, changes[2].delta], [4, -4]);
  });

  it("should carry the Unverified flag from the server", () => {
    const changes = D.changesFromOps(ops, textOf);
    assert.deepEqual(changes.map((c) => c.unverified), [false, true, false]);
  });
});

describe("summarize: what saving now would do", () => {
  const changes = [
    { opId: "o1", kind: "replace", delta: -3, unverified: false },
    { opId: "o2", kind: "insert", delta: 5, unverified: true },
    { opId: "o3", kind: "remove", delta: -20, unverified: false },
  ];

  it("should count every change as proposed until it is decided", () => {
    const s = plain(D.summarize(changes, {}, 100));
    assert.deepEqual(
      [s.changes, s.removals, s.pending, s.unverified, s.wordsDelta, s.lossWords, s.lossPct],
      [3, 1, 3, 1, -18, 23, 23],
    );
  });

  it("should drop a rejected change out of the words and the loss", () => {
    const s = plain(D.summarize(changes, { o3: "rejected", o1: "accepted" }, 100));
    assert.deepEqual([s.accepted, s.rejected, s.pending, s.wordsDelta, s.lossWords, s.lossPct], [1, 1, 1, 2, 3, 3]);
  });

  it("should stop counting an unverified change as to-check once it is confirmed", () => {
    assert.equal(D.summarize(changes, { o2: "accepted" }, 100).unverified, 0);
  });
});

describe("markElement: marks written into the template's own markup", () => {
  function block(doc, pieces) {
    const el = doc.createElement("p");
    el.setAttribute("data-node", "stmt");
    for (const piece of pieces) {
      if (typeof piece === "string") el.appendChild(doc.createTextNode(piece));
      else {
        const b = doc.createElement("span");
        b.className = "n";
        b.appendChild(doc.createTextNode(piece.n));
        el.appendChild(b);
      }
    }
    doc.body.appendChild(el);
    return el;
  }
  const marks = (el, tag) => el.querySelectorAll(`${tag}.scribe-mark`).map((m) => m.children[1].textContent);
  const srText = (el) => el.querySelectorAll(".scribe-mark-sr").map((s) => s.textContent);

  it("should mark a rewrite around a bold metric and keep the metric's element", () => {
    const doc = makeEnv().document;
    /* Three unchanged words ("fulfillment delays 38%") separate the two
       edits, so the metric is never folded into a change. */
    const el = block(doc, ["Operations analyst who reduced fulfillment delays ", { n: "38%" }, " through careful work."]);
    const metric = el.children[1];
    const parts = D.diffWords(el.textContent, "Operations analyst who cut fulfillment delays 38% by measuring weekly.");
    D.markElement(el, parts);
    assert.ok(el.children.includes(metric), "the metric span is the same node, still in the block");
    assert.equal(metric.textContent, "38%");
    assert.deepEqual(plain(marks(el, "del")), ["reduced", "through careful work"]);
    assert.deepEqual(plain(marks(el, "ins")), ["cut", "by measuring weekly"]);
  });

  it("should give screen readers inserted and deleted boundaries", () => {
    const doc = makeEnv().document;
    const el = block(doc, ["Built a weekly dashboard."]);
    D.markElement(el, D.diffWords(el.textContent, "Built a daily dashboard."));
    assert.deepEqual(plain(srText(el)), ["deleted: ", " end deleted", "inserted: ", " end inserted"]);
  });

  it("should strike every text run of a removed block, nested ones too", () => {
    const doc = makeEnv().document;
    const el = block(doc, ["Cut costs ", { n: "$4.1M" }, " a year."]);
    D.markElement(el, [{ kind: "del", text: el.textContent }]);
    assert.deepEqual(plain(marks(el, "del")), ["Cut costs ", "$4.1M", " a year."]);
    assert.equal(el.children[1].className, "n", "the metric keeps its element");
    assert.deepEqual(plain(marks(el.children[1], "del")), ["$4.1M"], "and is struck from inside it");
  });

  it("should put an insertion at the end of the block", () => {
    const doc = makeEnv().document;
    const el = block(doc, ["Led the team"]);
    D.markElement(el, D.diffWords(el.textContent, "Led the team of six"));
    assert.deepEqual(plain(marks(el, "ins")), [" of six"]);
    assert.equal(el.children[el.children.length - 1].tagName, "INS");
  });

  it("should fill a copied neighbour so a new block keeps the template's structure", () => {
    const doc = makeEnv().document;
    const li = doc.createElement("li");
    const marker = doc.createElement("span");
    marker.className = "k";
    const textSpan = doc.createElement("span");
    textSpan.appendChild(doc.createTextNode("Old neighbour text."));
    li.appendChild(marker);
    li.appendChild(textSpan);
    D.markInserted(li, "Mentored 4 coordinators.");
    assert.equal(li.children[0], marker, "the marker cell stays first");
    assert.deepEqual(plain(marks(textSpan, "ins")), ["Mentored 4 coordinators."]);
    assert.ok(!li.textContent.includes("Old neighbour"), "the copy's own text is gone");
  });

  it("should write a new bullet into the content, not a metric kicker (Grok F2-LEAD)", () => {
    /* Dossier's metric lead: <li><span class="k">38%</span><span>text</span></li> */
    const doc = makeEnv().document;
    const li = doc.createElement("li");
    const kicker = doc.createElement("span");
    kicker.className = "k";
    kicker.appendChild(doc.createTextNode("38%"));
    const content = doc.createElement("span");
    content.appendChild(doc.createTextNode(" fewer fulfillment delays after a weekly carrier dashboard."));
    li.appendChild(kicker);
    li.appendChild(content);
    D.markInserted(li, "Mentored 4 coordinators.");
    assert.deepEqual(plain(marks(content, "ins")), ["Mentored 4 coordinators."], "the text lands in the content column");
    assert.equal(kicker.querySelectorAll("ins").length, 0, "nothing in the kicker");
    assert.equal(kicker.textContent, "", "and the neighbour's metric is not carried over");
  });

  it("should put a block back exactly as it was", () => {
    const doc = makeEnv().document;
    const el = block(doc, ["Operations analyst who reduced delays ", { n: "38%" }, "."]);
    const original = el.textContent;
    D.markElement(el, D.diffWords(original, "Analyst who cut delays 38% fast."));
    el.appendChild(Object.assign(doc.createElement("span"), { className: "scribe-stub" }));
    el.setAttribute("data-scribe-op", "replace");
    D.unmarkElement(el);
    assert.equal(el.textContent, original);
    assert.equal(el.querySelectorAll(".scribe-mark").length, 0);
    assert.equal(el.getAttribute("data-scribe-op"), null);
  });
});

describe("markStyles: one stylesheet for marks in a frame", () => {
  it("should read every colour from the app's tokens", () => {
    const asked = [];
    const css = D.markStyles((name) => { asked.push(name); return `var-${name}`; });
    assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), "no colour literal of its own");
    for (const token of ["--jb-mint-tint", "--jb-accent-ink", "--jb-err", "--jb-action", "--jb-mint", "--jb-warn"]) {
      assert.ok(asked.includes(token), `reads ${token}`);
    }
    assert.match(css, /html\.scribe-clean del\.scribe-mark\{display:none\}/, "Show changes off hides deletions");
    assert.match(css, /\[data-scribe-state=accepted\] del\.scribe-mark,\[data-scribe-state=rejected\] ins\.scribe-mark\{display:none\}/);
  });
});
