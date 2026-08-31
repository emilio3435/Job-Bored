/**
 * F4-C — date-windowed metrics helper.
 *
 * UX-02: "Last 30 days" must be a real date window, not the current snapshot.
 * P2: terminal zero ≠ unavailable ≠ partial; funnel rows are not false buttons.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadHelper() {
  let source;
  try {
    source = await readFile(join(repoRoot, "metrics-date-window.js"), "utf8");
  } catch (err) {
    assert.fail("metrics-date-window.js must exist as the isolated F4-C helper: " + err.message);
  }
  const sandbox = {
    window: {},
    Date,
    Number,
    String,
    Object,
    Array,
    Math,
    JSON,
    console,
    parseInt,
  };
  vm.runInNewContext(source, sandbox, { filename: "metrics-date-window.js" });
  assert.ok(
    sandbox.window.JobBoredMetricsDateWindow,
    "helper must attach window.JobBoredMetricsDateWindow",
  );
  return sandbox.window.JobBoredMetricsDateWindow;
}

function isoDaysAgo(now, days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("F4C-UX02-WINDOW: Last 30 days is a real date window", () => {
  it("excludes jobs whose event date is older than the window", async () => {
    const api = await loadHelper();
    const now = new Date("2026-05-20T12:00:00Z");
    const jobs = [
      { stage: "new", foundAt: isoDaysAgo(now, 10), title: "In window" },
      { stage: "new", foundAt: isoDaysAgo(now, 90), title: "Too old" },
      { stage: "applied", foundAt: isoDaysAgo(now, 5), title: "Applied in window" },
      { stage: "applied", foundAt: isoDaysAgo(now, 40), title: "Applied too old" },
    ];
    const result = api.buildWindowedMetrics(jobs, { now, windowDays: 30, dateField: "foundAt" });
    assert.equal(result.window.days, 30);
    assert.equal(result.source, "foundAt");
    assert.equal(result.denominator.inWindow, 2);
    assert.equal(result.denominator.dated, 4);
    assert.equal(result.denominator.total, 4);
    const discovered = result.funnel.find((row) => row.kind === "discovered");
    const applied = result.funnel.find((row) => row.kind === "applied");
    assert.equal(discovered.count, 1, "90-day-old New must not count as last-30-days");
    assert.equal(applied.count, 1, "40-day-old Applied must not count as last-30-days");
    assert.equal(result.availability, "complete");
    const surfaced = result.byTheNumbers.find((row) => row.label === "roles surfaced");
    assert.equal(surfaced.value, 1);
    assert.equal(surfaced.delta, "last 30 days");
  });

  it("does not treat a current snapshot as last-30-days when no dates exist", async () => {
    const api = await loadHelper();
    const now = new Date("2026-05-20T12:00:00Z");
    const jobs = [
      { stage: "new", title: "No date A" },
      { stage: "applied", title: "No date B" },
    ];
    const result = api.buildWindowedMetrics(jobs, { now, windowDays: 30, dateField: "foundAt" });
    assert.equal(result.availability, "unavailable");
    assert.equal(result.denominator.inWindow, 0);
    assert.equal(result.denominator.dated, 0);
    assert.equal(result.denominator.total, 2);
    const surfaced = result.byTheNumbers.find((row) => row.label === "roles surfaced");
    assert.equal(surfaced.availability, "unavailable");
    assert.notEqual(
      surfaced.delta,
      "last 30 days",
      "must not label an undated snapshot as last 30 days",
    );
  });
});

describe("F4C-P2-ZERO: zero vs unavailable vs partial, no funnel false buttons", () => {
  it("classifies measured zero, unavailable source, and partial sample distinctly", async () => {
    const api = await loadHelper();
    const now = new Date("2026-05-20T12:00:00Z");

    const zero = api.buildWindowedMetrics(
      [{ stage: "expired", foundAt: isoDaysAgo(now, 3) }],
      { now, windowDays: 30, dateField: "foundAt" },
    );
    assert.equal(zero.availability, "zero");
    const zeroDiscovered = zero.funnel.find((row) => row.kind === "discovered");
    assert.equal(zeroDiscovered.count, 0);
    assert.equal(zeroDiscovered.availability, "zero");

    const partial = api.buildWindowedMetrics(
      [
        { stage: "new", foundAt: isoDaysAgo(now, 2), title: "dated" },
        { stage: "new", title: "undated" },
      ],
      { now, windowDays: 30, dateField: "foundAt" },
    );
    assert.equal(partial.availability, "partial");
    assert.equal(partial.denominator.dated, 1);
    assert.equal(partial.denominator.total, 2);
    assert.equal(partial.funnel.find((row) => row.kind === "discovered").count, 1);
  });

  it("renders non-actionable funnel rows as divs, not false buttons", async () => {
    const api = await loadHelper();
    const html = api.renderFunnelRowHtml({
      kind: "discovered",
      label: "Discovered",
      count: 4,
      availability: "complete",
      actionable: false,
    });
    assert.match(html, /<div\b[^>]*class="[^"]*brief-funnel__row/);
    assert.doesNotMatch(html, /<button\b/);
    assert.match(html, /role="listitem"/);

    const button = api.renderFunnelRowHtml({
      kind: "applied",
      label: "Applied",
      count: 2,
      availability: "complete",
      actionable: true,
    });
    assert.match(button, /<button\b/);
  });
});
