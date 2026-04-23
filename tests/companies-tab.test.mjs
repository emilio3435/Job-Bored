import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadCompaniesTab() {
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
