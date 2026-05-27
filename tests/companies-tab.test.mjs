import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadCompaniesTab(overrides = {}) {
  const source = await readFile(join(repoRoot, "companies-tab.js"), "utf8");
  const document = {
    readyState: "loading",
    addEventListener() {},
    getElementById() {
      return null;
    },
    createElement() {
      return { style: {}, setAttribute() {}, appendChild() {} };
    },
  };
  const window = {};
  const context = {
    window,
    document,
    navigator: { userAgent: "test" },
    console,
    URL,
    setTimeout,
    clearTimeout,
    Math: overrides.Math || Math,
  };
  vm.runInNewContext(source, context, { filename: "companies-tab.js" });
  return window.JobBoredCompaniesTab;
}

describe("companies-tab — pure helpers", () => {
  it("sortCompaniesByName sorts case-insensitively by company name", async () => {
    const tab = await loadCompaniesTab();
    const sorted = tab.sortCompaniesByName([
      { name: "Ramp", companyKey: "ramp" },
      { name: "airtable", companyKey: "airtable" },
      { name: "Notion", companyKey: "notion" },
    ]);
    assert.deepEqual(
      sorted.map((c) => c.companyKey),
      ["airtable", "notion", "ramp"],
    );
  });

  it("filterCompanies matches name, domain, and companyKey substrings", async () => {
    const tab = await loadCompaniesTab();
    const list = [
      { name: "Notion", companyKey: "notion", domains: ["notion.so"] },
      { name: "Ramp", companyKey: "ramp", domains: ["ramp.com"] },
      { name: "Figma", companyKey: "figma", domains: ["figma.com"] },
    ];
    assert.equal(tab.filterCompanies(list, "").length, 3);
    assert.deepEqual(
      tab.filterCompanies(list, "not").map((c) => c.companyKey),
      ["notion"],
    );
    assert.deepEqual(
      tab.filterCompanies(list, ".com").map((c) => c.companyKey),
      ["ramp", "figma"],
    );
    assert.deepEqual(tab.filterCompanies(list, "absent"), []);
  });

  it("renderCompanyList renders an empty state when given no companies", async () => {
    const tab = await loadCompaniesTab();
    const container = { innerHTML: "" };
    tab.renderCompanyList(container, [], {
      emptyTitle: "No companies yet",
      emptyHint: "Run discovery.",
    });
    assert.match(container.innerHTML, /companies-empty/);
    assert.match(container.innerHTML, /No companies yet/);
    assert.match(container.innerHTML, /Run discovery\./);
  });

  it("renderCompanyList uses Eliminate button for active companies", async () => {
    const tab = await loadCompaniesTab();
    const container = { innerHTML: "" };
    tab.renderCompanyList(
      container,
      [{ name: "Notion", companyKey: "notion", domains: ["notion.so"] }],
      { action: "eliminate" },
    );
    assert.match(container.innerHTML, /companies-row__action--skip/);
    assert.match(container.innerHTML, /data-company-action="eliminate"/);
    assert.match(container.innerHTML, /data-company-key="notion"/);
    assert.match(container.innerHTML, />Eliminate</);
  });

  it("renderCompanyList uses Restore button for skipped companies", async () => {
    const tab = await loadCompaniesTab();
    const container = { innerHTML: "" };
    tab.renderCompanyList(
      container,
      [{ name: "Figma", companyKey: "figma", domains: [] }],
      { action: "restore" },
    );
    assert.match(container.innerHTML, /companies-row__action--restore/);
    assert.match(container.innerHTML, /data-company-action="restore"/);
    assert.match(container.innerHTML, />Restore</);
  });

  it("renderCompanyList disables the action button when companyKey is missing", async () => {
    const tab = await loadCompaniesTab();
    const container = { innerHTML: "" };
    tab.renderCompanyList(container, [{ name: "Unknown", companyKey: "" }], {
      action: "eliminate",
    });
    assert.match(container.innerHTML, /disabled>Eliminate/);
  });

  it("renderCompanyRow escapes company names and domains to prevent HTML injection", async () => {
    const tab = await loadCompaniesTab();
    const html = tab.__test.renderCompanyRow(
      {
        name: '<script>alert("xss")</script>',
        companyKey: "xss",
        domains: ["<b>bad</b>"],
      },
      "eliminate",
    );
    assert.ok(!html.includes("<script>"), "raw <script> tag should be escaped");
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;b&gt;bad&lt;\/b&gt;/);
  });
});

// Coerce an array returned from the vm.runInNewContext realm into the outer
// realm so assert.deepStrictEqual's prototype check is happy.
const plain = (arr) => [...arr];

describe("companies-tab — pickRandomCompanies", () => {
  const fixture = [
    { name: "Alpha", companyKey: "alpha" },
    { name: "Bravo", companyKey: "bravo" },
    { name: "Charlie", companyKey: "charlie" },
    { name: "Delta", companyKey: "delta" },
    { name: "Echo", companyKey: "echo" },
  ];

  it("returns exactly n entries when n is within range", async () => {
    const tab = await loadCompaniesTab();
    const picked = tab.pickRandomCompanies(fixture, 3);
    assert.equal(picked.length, 3);
  });

  it("returns [] when n is 0", async () => {
    const tab = await loadCompaniesTab();
    assert.equal(tab.pickRandomCompanies(fixture, 0).length, 0);
  });

  it("returns [] when the input list is empty", async () => {
    const tab = await loadCompaniesTab();
    assert.equal(tab.pickRandomCompanies([], 5).length, 0);
  });

  it("returns the full list when n is larger than the list length", async () => {
    const tab = await loadCompaniesTab();
    const picked = tab.pickRandomCompanies(fixture, 99);
    assert.equal(picked.length, fixture.length);
    const returnedKeys = plain(picked).map((c) => c.companyKey).sort();
    const inputKeys = fixture.map((c) => c.companyKey).sort();
    assert.deepEqual(returnedKeys, inputKeys);
  });

  it("returns distinct entries with no duplicates", async () => {
    const tab = await loadCompaniesTab();
    const picked = tab.pickRandomCompanies(fixture, 4);
    const keys = plain(picked).map((c) => c.companyKey);
    const unique = new Set(keys);
    assert.equal(unique.size, keys.length, "no duplicates in the returned slice");
    for (const key of keys) {
      assert.ok(
        fixture.some((c) => c.companyKey === key),
        `returned key ${key} must come from the input`,
      );
    }
  });

  it("is deterministic when Math.random is stubbed", async () => {
    // Stub Math.random so Fisher-Yates shuffles deterministically. The test
    // asserts reproducibility with the same seed, not a specific order.
    let seed = 0;
    const seeds = [0.1, 0.4, 0.7, 0.2, 0.55];
    const stubbedMath = Object.assign(Object.create(Math), Math, {
      random: () => seeds[seed++ % seeds.length],
    });
    const tab = await loadCompaniesTab({ Math: stubbedMath });
    seed = 0;
    const first = plain(tab.pickRandomCompanies(fixture, 3)).map(
      (c) => c.companyKey,
    );
    seed = 0;
    const second = plain(tab.pickRandomCompanies(fixture, 3)).map(
      (c) => c.companyKey,
    );
    assert.deepEqual(first, second);
    assert.equal(first.length, 3);
  });

  it("returns [] when n is negative", async () => {
    const tab = await loadCompaniesTab();
    assert.equal(tab.pickRandomCompanies(fixture, -2).length, 0);
  });

  it("handles non-array input defensively", async () => {
    const tab = await loadCompaniesTab();
    assert.equal(tab.pickRandomCompanies(null, 3).length, 0);
    assert.equal(tab.pickRandomCompanies(undefined, 3).length, 0);
  });
});

describe("companies-tab — buildCombinedLibrary", () => {
  it("tags active entries with source='active' and history entries with source='history'", async () => {
    const tab = await loadCompaniesTab();
    const merged = tab.buildCombinedLibrary({
      active: [{ name: "Notion", companyKey: "notion" }],
      history: [{ name: "Figma", companyKey: "figma" }],
    });
    const byKey = Object.fromEntries(merged.map((c) => [c.companyKey, c]));
    assert.equal(byKey.notion.source, "active");
    assert.equal(byKey.figma.source, "history");
  });

  it("dedupes by companyKey — active wins on collision", async () => {
    const tab = await loadCompaniesTab();
    const merged = tab.buildCombinedLibrary({
      active: [{ name: "Notion (active)", companyKey: "notion" }],
      history: [{ name: "Notion (history)", companyKey: "notion" }],
    });
    assert.equal(merged.length, 1);
    assert.equal(merged[0].source, "active");
    assert.equal(merged[0].name, "Notion (active)");
  });

  it("returns [] for empty or missing input", async () => {
    const tab = await loadCompaniesTab();
    assert.equal(tab.buildCombinedLibrary({}).length, 0);
    assert.equal(tab.buildCombinedLibrary({ active: [], history: [] }).length, 0);
    assert.equal(tab.buildCombinedLibrary(null).length, 0);
    assert.equal(tab.buildCombinedLibrary(undefined).length, 0);
  });

  it("ignores entries without a companyKey", async () => {
    const tab = await loadCompaniesTab();
    const merged = tab.buildCombinedLibrary({
      active: [
        { name: "Ramp", companyKey: "ramp" },
        { name: "Keyless" },
        { name: "", companyKey: "" },
      ],
      history: [{ name: "Airtable", companyKey: "airtable" }],
    });
    assert.deepEqual(
      plain(merged).map((c) => c.companyKey),
      ["ramp", "airtable"],
    );
  });

  it("preserves active-before-history ordering", async () => {
    const tab = await loadCompaniesTab();
    const merged = tab.buildCombinedLibrary({
      active: [
        { name: "A", companyKey: "a" },
        { name: "B", companyKey: "b" },
      ],
      history: [
        { name: "C", companyKey: "c" },
        { name: "D", companyKey: "d" },
      ],
    });
    assert.deepEqual(
      plain(merged).map((c) => c.companyKey),
      ["a", "b", "c", "d"],
    );
    assert.deepEqual(
      plain(merged).map((c) => c.source),
      ["active", "active", "history", "history"],
    );
  });

  it("does not mutate the input arrays", async () => {
    const tab = await loadCompaniesTab();
    const active = [{ name: "Ramp", companyKey: "ramp" }];
    const history = [{ name: "Figma", companyKey: "figma" }];
    const beforeActive = JSON.parse(JSON.stringify(active));
    const beforeHistory = JSON.parse(JSON.stringify(history));
    tab.buildCombinedLibrary({ active, history });
    assert.deepEqual(active, beforeActive);
    assert.deepEqual(history, beforeHistory);
  });

  it("returns entries with the source property attached without mutating originals", async () => {
    const tab = await loadCompaniesTab();
    const activeEntry = { name: "Ramp", companyKey: "ramp" };
    const merged = tab.buildCombinedLibrary({ active: [activeEntry], history: [] });
    assert.equal(merged.length, 1);
    assert.equal(merged[0].source, "active");
    assert.equal(Object.prototype.hasOwnProperty.call(activeEntry, "source"), false);
  });
});
