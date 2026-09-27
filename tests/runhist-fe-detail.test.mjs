/* RUNHIST FE — the expanded run: a measured account of how it went.
 * Every number comes from the AGREED CONTRACT payload; anything the worker
 * did not measure is absent, never 0 (D5). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detailLegacy,
  detailRunA,
  detailSparse,
  loadRunsLog,
  manyCompanies,
  read,
} from "./runhist-fe-fixtures.mjs";

const RUN_A = {
  runId: "run_a",
  runAt: "2026-09-27T05:08:32.000Z",
  trigger: "manual",
  status: "success",
  durationS: 512,
  durationSAvailability: "value",
  companiesSeen: 3,
  companiesSeenAvailability: "value",
  leadsWritten: 9,
  leadsWrittenAvailability: "value",
  leadsUpdated: 3,
  leadsUpdatedAvailability: "value",
  source: "worker",
  variationKey: "v-a",
  error: "",
  statusPath: "/runs/run_a",
  origin: "both",
};

function stat(html, key) {
  const m = new RegExp(`data-runs-stat="${key}"[^>]*>([^<]*)<`).exec(html);
  return m ? m[1] : null;
}
function section(html, name) {
  return new RegExp(`data-runs-section="${name}"`).test(html);
}
function render(detail, run = RUN_A) {
  return loadRunsLog().renderRunDetailHtml(detail, run, { idBase: "rd-test" });
}

describe("runhist-fe · headline", () => {
  it("says what the run did in one sentence, from measured numbers only", () => {
    const html = render(detailRunA());
    assert.match(
      html,
      /Saved 9 new roles and updated 3 from 539 listings in 8m 32s\./,
    );
  });
});

describe("runhist-fe · funnel", () => {
  it("renders every measured funnel stage with its count", () => {
    const html = render(detailRunA());
    assert.ok(section(html, "funnel"));
    assert.equal(stat(html, "listingsSeen"), "539");
    assert.equal(stat(html, "listingsProcessed"), "539");
    assert.equal(stat(html, "duplicatesInRun"), "41");
    assert.equal(stat(html, "rejected"), "470");
    assert.equal(stat(html, "candidates"), "28");
    assert.equal(stat(html, "written"), "9");
    assert.equal(stat(html, "updated"), "3");
  });

  it("names what was searched: companies, boards, searches", () => {
    const html = render(detailRunA());
    assert.equal(stat(html, "companiesSearched"), "3");
    assert.equal(stat(html, "boardsDetected"), "39");
    assert.equal(stat(html, "queriesRun"), "5");
  });

  it("lists the top rejection reasons in plain words with counts", () => {
    const html = render(detailRunA());
    assert.match(html, /data-runs-reason="skip_title_match"[\s\S]*?210/);
    assert.match(html, /data-runs-reason="headline_mismatch"[\s\S]*?140/);
    assert.doesNotMatch(html, />skip_title_match</, "machine codes stay out of the copy");
  });

  it("bars are proportional to listings seen", () => {
    const html = render(detailRunA());
    const m = /data-runs-bar="candidates"[^>]*style="--runs-share:\s*([\d.]+)[;"]/.exec(html);
    assert.ok(m, "candidates bar carries its share");
    assert.equal(Number(m[1]).toFixed(3), (28 / 539).toFixed(3));
  });
});

describe("runhist-fe · fit scores", () => {
  it("shows average, median, range and a 0..10 histogram", () => {
    const html = render(detailRunA());
    assert.ok(section(html, "fit"));
    assert.equal(stat(html, "fitAvg"), "6.8");
    assert.equal(stat(html, "fitMedian"), "7");
    assert.equal(stat(html, "fitRange"), "3–9");
    assert.equal(stat(html, "fitScored"), "28");
    const bars = html.match(/data-runs-fit-bin="/g) || [];
    assert.equal(bars.length, 11);
    assert.match(html, /role="img"[^>]*aria-label="Fit scores: [^"]*7 roles scored 7[^"]*"/);
  });
});

describe("runhist-fe · per-source breakdown", () => {
  it("renders one row per source with its measured counts", () => {
    const html = render(detailRunA());
    assert.ok(section(html, "sources"));
    assert.match(html, /Company job boards/);
    assert.match(html, /Google Jobs/);
    assert.equal(stat(html, "source-ats-seen"), "525");
    assert.equal(stat(html, "source-ats-timeouts"), "1");
    assert.equal(stat(html, "source-serpapi_google_jobs-accepted"), "8");
  });

  it("a count one source did not report is absent, not 0", () => {
    const html = render(detailRunA());
    assert.equal(stat(html, "source-serpapi_google_jobs-timeouts"), null);
    assert.match(html, /data-runs-absent="source-serpapi_google_jobs-timeouts"/);
  });
});

describe("runhist-fe · timeline", () => {
  it("lists phases in order with durations", () => {
    const html = render(detailRunA());
    assert.ok(section(html, "timeline"));
    const phases = [...html.matchAll(/data-runs-phase="([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(phases, ["scout", "score", "write"]);
    assert.match(html, /Search[\s\S]*?5m 0s/);
    assert.match(html, /Score[\s\S]*?2m 30s/);
    assert.match(html, /Save[\s\S]*?1m 2s/);
  });
});

describe("runhist-fe · where it searched", () => {
  it("names the companies and the searches", () => {
    const html = render(detailRunA());
    assert.ok(section(html, "searched"));
    for (const c of ["Figma", "Notion", "Linear"]) assert.match(html, new RegExp(c));
    assert.match(html, /senior product manager remote/);
    assert.equal(stat(html, "matcherCalls"), "41");
  });

  it("bounds long lists with a +N more disclosure", () => {
    const d = detailRunA();
    d.runStats.searched.companies = manyCompanies(30);
    const html = render(d);
    assert.match(html, /Company 12</);
    assert.match(html, /aria-expanded="false"[^>]*>\+18 more</);
    assert.match(html, /<li[^>]*hidden[^>]*>Company 13</);
  });

  it("says so when the worker dropped labels", () => {
    const d = detailRunA();
    d.runStats.searched.truncated = true;
    assert.match(render(d), /Not every search was recorded\./);
  });

  it("escapes labels", () => {
    const d = detailRunA();
    d.runStats.searched.companies = ['<img src=x onerror="1">'];
    const html = render(d);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
  });
});

describe("runhist-fe · D5 absent is never zero", () => {
  it("a sparse runStats renders only what was measured", () => {
    const html = render(detailSparse());
    assert.equal(stat(html, "listingsSeen"), "12");
    assert.equal(stat(html, "written"), "0", "a measured zero is still shown");
    for (const k of ["listingsProcessed", "duplicatesInRun", "duplicatesVsSheet", "rejected", "candidates", "updated", "companiesSearched", "matcherCalls"]) {
      assert.equal(stat(html, k), null, `${k} must be absent`);
    }
    for (const s of ["fit", "sources", "timeline", "searched"]) {
      assert.equal(section(html, s), false, `${s} section must be absent`);
    }
    assert.doesNotMatch(html, /NaN|undefined|null/);
  });

  it("duplicatesVsSheet renders only when the worker sends it", () => {
    const d = detailRunA();
    assert.equal(stat(render(d), "duplicatesVsSheet"), null);
    d.runStats.funnel.duplicatesVsSheet = 12;
    assert.equal(stat(render(d), "duplicatesVsSheet"), "12");
  });

  it("a non-numeric or negative value is treated as absent", () => {
    const d = detailRunA();
    d.runStats.funnel.rejected = "470";
    d.runStats.funnel.candidates = -1;
    const html = render(d);
    assert.equal(stat(html, "rejected"), null);
    assert.equal(stat(html, "candidates"), null);
  });
});

describe("runhist-fe · older runs render a clean coarse view", () => {
  it("no runStats: the coarse fields plus a plain note, no stat sections", () => {
    const html = render(detailLegacy());
    assert.match(html, /Detailed stats weren’t recorded for this run\./);
    assert.match(html, /Trigger/);
    for (const s of ["funnel", "fit", "sources", "timeline", "searched"]) {
      assert.equal(section(html, s), false);
    }
  });

  it("Sheet-only rows render the coarse view without a worker call", () => {
    const log = loadRunsLog();
    const html = log.renderCoarseDetailHtml({ ...RUN_A, origin: "sheet", statusPath: "", runId: "" });
    assert.match(html, /Trigger/);
    assert.match(html, /Duration/);
    assert.doesNotMatch(html, /data-runs-section/);
  });
});

describe("runhist-fe · disclosure a11y", () => {
  it("each run row is a button disclosure controlling a labelled region", () => {
    const log = loadRunsLog();
    const tbody = { innerHTML: "" };
    log.__test.renderRunsTable(tbody, [RUN_A], {});
    const html = tbody.innerHTML;
    const btn = /<button[^>]*class="runs-row-toggle"[^>]*>/.exec(html)[0];
    const id = /\bid="([^"]+)"/.exec(btn)[1];
    const controls = /aria-controls="([^"]+)"/.exec(btn)[1];
    assert.match(btn, /aria-expanded="false"/);
    assert.match(html, new RegExp(`id="${controls}"[^>]*hidden`));
    assert.match(
      html,
      new RegExp(`role="region"[^>]*aria-labelledby="${id}"`),
      "the panel is a region named by its toggle",
    );
  });

  it("detail ids are stable across re-renders so auto-refresh keeps a run open", () => {
    const log = loadRunsLog();
    const a = { innerHTML: "" };
    const b = { innerHTML: "" };
    log.__test.renderRunsTable(a, [RUN_A], {});
    log.__test.renderRunsTable(b, [RUN_A], { expanded: { "run:run_a": true } });
    const idA = /aria-controls="([^"]+)"/.exec(a.innerHTML)[1];
    const idB = /aria-controls="([^"]+)"/.exec(b.innerHTML)[1];
    assert.equal(idA, idB);
    assert.match(b.innerHTML, /aria-expanded="true"/);
    assert.doesNotMatch(b.innerHTML, new RegExp(`id="${idB}"[^>]*hidden`));
  });

  it("the stat sections carry headings the panel is navigable by", () => {
    const html = render(detailRunA());
    for (const s of ["funnel", "fit", "sources", "timeline", "searched"]) {
      assert.match(
        html,
        new RegExp(`data-runs-section="${s}"[^>]*aria-labelledby="(rd-test-${s})"[\\s\\S]*?<h4[^>]*id="rd-test-${s}"`),
      );
    }
  });
});

describe("runhist-fe · CSS: scoped, tabular, reduced-motion safe", () => {
  const css = read("css/runs-log.css");
  const story = css.slice(css.indexOf("RUNHIST")).replace(/^[\s\S]*?\*\//, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Split a selector list on top-level commas only (":is(a, b)" stays whole).
  const splitSelectors = (sel) => {
    const parts = [];
    let depth = 0;
    let cur = "";
    for (const ch of sel) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    return parts.concat(cur);
  };

  it("the run-story styles exist and are scoped under the runs root", () => {
    assert.ok(css.includes("RUNHIST"), "runhist block present");
    const selectors = [...story.matchAll(/^([^@{}\n][^{}]*)\{/gm)]
      .map((m) => m[1].trim())
      .filter((s) => /runs-(story|funnel|fit|sources|timeline|searched|more)/.test(s));
    assert.ok(selectors.length > 10);
    for (const sel of selectors) {
      for (const part of splitSelectors(sel)) {
        assert.match(part.trim(), /^(#runsModal|\.runs-modal)\b/, `unscoped: ${part.trim()}`);
      }
    }
  });

  it("numbers use tabular figures", () => {
    assert.match(story, /font-variant-numeric:\s*tabular-nums/);
  });

  it("motion is off under prefers-reduced-motion", () => {
    const m = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(story);
    assert.ok(m, "reduced-motion block in the runhist section");
    assert.match(m[1], /runs-funnel__bar|runs-story/);
    assert.match(m[1], /(animation|transition):\s*none/);
  });
});
