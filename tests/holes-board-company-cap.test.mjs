/**
 * HOLES BOARD — R18: the per-company cap keys on a normalized company name.
 *
 * "Stripe, Inc." and "Stripe" are one company. Before R18 the key was only
 * trimmed and lower-cased, so a legal suffix or a stray comma split one
 * employer into two buckets and each bucket got its own three-card allowance.
 * pipeline.js keeps a local fallback for when company-cap.js is absent; it must
 * produce the same key, or the board caps differently depending on load order.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const companyCapJs = readFileSync(join(repoRoot, "company-cap.js"), "utf8");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");

function loadCompanyCap() {
  const win = {};
  vm.runInNewContext(companyCapJs, { window: win, console }, { filename: "company-cap.js" });
  return win.JobBoredCompanyCap;
}

/** pipeline.js with company-cap.js absent, so its local fallback key runs. */
function loadPipelineFallbackKey() {
  const marker = "  function stageLabel(stageKey) {";
  const instrumented = pipelineJs.replace(
    marker,
    "  root.__pipelineTest = { companyKey: companyKey, capCardsByFit: capCardsByFit };\n\n" + marker,
  );
  assert.notEqual(instrumented, pipelineJs, "pipeline.js instrumentation marker moved");
  const win = {};
  const doc = { readyState: "loading", addEventListener() {}, body: null, querySelector() { return null; } };
  vm.runInNewContext(instrumented, { window: win, document: doc, console, setTimeout, Date }, { filename: "pipeline.js" });
  return win.__pipelineTest;
}

const SAME_COMPANY = [
  ["Stripe", "Stripe, Inc."],
  ["Stripe", "STRIPE INC"],
  ["Stripe", "Stripe Inc."],
  ["Acme", "Acme Corp."],
  ["Acme", "Acme Corporation"],
  ["Globex", "Globex, LLC"],
  ["Initech", "Initech GmbH"],
  ["Umbrella", "Umbrella Co., Ltd."],
  ["Hooli", "  hooli  limited "],
  ["Jane Street", "Jane  Street"],
];

describe("R18 · companyKey normalizes legal suffixes and punctuation", () => {
  for (const [a, b] of SAME_COMPANY) {
    it(`should key "${b}" the same as "${a}"`, () => {
      const cap = loadCompanyCap();
      assert.equal(cap.companyKey({ company: b }), cap.companyKey({ company: a }));
    });
  }

  it("should keep distinct companies distinct", () => {
    const cap = loadCompanyCap();
    assert.notEqual(cap.companyKey({ company: "Stripe" }), cap.companyKey({ company: "Square" }));
    assert.notEqual(cap.companyKey({ company: "Co Labs" }), cap.companyKey({ company: "Labs" }));
  });

  it("should not reduce a name that is only a suffix to an empty key", () => {
    const cap = loadCompanyCap();
    assert.notEqual(cap.companyKey({ company: "Inc." }), "", "a lone suffix is still a company name");
    assert.equal(cap.companyKey({ company: "" }), "");
    assert.equal(cap.companyKey(null), "");
  });

  it("should cap 'Stripe, Inc.' and 'Stripe' rows as one company", () => {
    const cap = loadCompanyCap();
    const cards = [
      { jobKey: "1", company: "Stripe", fitScore: 9 },
      { jobKey: "2", company: "Stripe, Inc.", fitScore: 8 },
      { jobKey: "3", company: "Stripe Inc", fitScore: 7 },
      { jobKey: "4", company: "stripe", fitScore: 6 },
    ];
    const kept = cap.capCardsByFit(cards);
    assert.deepEqual(kept.map((c) => c.jobKey), ["1", "2", "3"], "four Stripe rows keep three");
    const hidden = cap.summarizeHidden(cards, kept);
    assert.equal(hidden.length, 1);
    assert.equal(hidden[0].hidden, 1);
  });

  it("should give pipeline.js's local fallback the same key as company-cap.js", () => {
    const cap = loadCompanyCap();
    const pipe = loadPipelineFallbackKey();
    for (const [a, b] of SAME_COMPANY) {
      assert.equal(pipe.companyKey({ company: b }), cap.companyKey({ company: b }), `fallback key for "${b}"`);
      assert.equal(pipe.companyKey({ company: a }), cap.companyKey({ company: a }), `fallback key for "${a}"`);
    }
  });
});
