import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function boot() {
  const storage = memStorage();
  const win = {
    JobBoredApp: { core: { host: {} } },
    localStorage: storage,
    addEventListener() {},
    dispatchEvent() {
      return true;
    },
    CustomEvent: class {
      constructor(t, o) {
        this.type = t;
        this.detail = o && o.detail;
      }
    },
  };
  const sandbox = {
    window: win,
    document: { addEventListener() {}, dispatchEvent() { return true; } },
    console,
    CustomEvent: win.CustomEvent,
  };
  vm.runInNewContext(
    readFileSync(join(repoRoot, "materials-state.js"), "utf8"),
    sandbox,
  );
  return Object.assign(win.JobBoredApp.materialsState, { _storage: storage });
}

const job = { link: "https://jobs.test/1", company: "Meridian", title: "PM" };

describe("scorecard persistence", () => {
  it("round-trips a scorecard by job opportunity key", () => {
    const ms = boot();
    assert.equal(ms.getScorecardForJob(job), null);
    ms.setScorecardForJob(
      job,
      { overallScore: 82, topStrengths: ["a"] },
      "resume_update",
    );
    const hit = ms.getScorecardForJob(job);
    assert.equal(hit.result.overallScore, 82);
    assert.equal(hit.feature, "resume_update");
    assert.ok(Number.isFinite(Date.parse(hit.storedAt)));
  });

  it("persists under the shared jb_ats_scorecard_v1 storage key", () => {
    const ms = boot();
    ms.setScorecardForJob(job, { overallScore: 5 }, "cover_letter");
    const raw = ms._storage.getItem("jb_ats_scorecard_v1");
    assert.ok(raw, "scorecards must live under jb_ats_scorecard_v1");
    const store = JSON.parse(raw);
    const key = ms.getJobOpportunityKey(job);
    assert.equal(store[key].result.overallScore, 5);
    assert.equal(store[key].feature, "cover_letter");
  });

  it("ignores jobs with no opportunity key and missing results", () => {
    const ms = boot();
    ms.setScorecardForJob(null, { overallScore: 1 }, "resume_update");
    ms.setScorecardForJob(job, null, "resume_update");
    assert.equal(ms.getScorecardForJob(job), null);
  });

  it("caps at 100 entries, evicting the oldest", () => {
    const ms = boot();
    for (let i = 0; i < 101; i++) {
      ms.setScorecardForJob(
        { link: `https://jobs.test/${i}` },
        { overallScore: i },
        "resume_update",
      );
    }
    assert.equal(ms.getScorecardForJob({ link: "https://jobs.test/0" }), null);
    assert.equal(
      ms.getScorecardForJob({ link: "https://jobs.test/100" }).result
        .overallScore,
      100,
    );
  });
});

function bootScorecardFlow(result) {
  const storage = memStorage();
  const win = {
    JobBoredApp: { core: { host: {} } },
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    CustomEvent: class {
      constructor(t, o) {
        this.type = t;
        this.detail = o && o.detail;
      }
    },
  };
  const sandbox = {
    window: win,
    document: {
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
      getElementById: () => null,
      querySelector: () => null,
    },
    console,
    CustomEvent: win.CustomEvent,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(result),
    }),
  };
  vm.runInNewContext(
    readFileSync(join(repoRoot, "materials-state.js"), "utf8"),
    sandbox,
  );
  const session = { job, feature: "resume_update" };
  win.JobBoredApp.core.getLastResumeGenerationSession = () => session;
  win.JobBoredApp.core.host = {
    escapeHtml: (v) => String(v == null ? "" : v),
    getAtsScoringConfig: () => ({ mode: "server" }),
    getAtsScorecardApiUrl: () => "https://ats.test/score",
    renderResumeGenerateInsights() {},
  };
  vm.runInNewContext(
    readFileSync(join(repoRoot, "ats-scorecard.js"), "utf8"),
    sandbox,
  );
  return { win, ms: win.JobBoredApp.materialsState, ats: win.JobBoredApp.ats };
}

describe("ats-scorecard stores its result for the dossier", () => {
  it("persists the scored job's card on a successful analysis", async () => {
    const { ms, ats } = bootScorecardFlow({
      overallScore: 77,
      summary: "Solid",
    });
    ats.startAtsScorecardAnalysis("key-1", {
      feature: "resume_update",
      docText: "resume text",
      job: { url: job.link },
    });
    await new Promise((r) => setTimeout(r, 20));
    const hit = ms.getScorecardForJob(job);
    assert.ok(hit, "expected a persisted scorecard for the scored job");
    assert.equal(hit.result.overallScore, 77);
    assert.equal(hit.feature, "resume_update");
  });

  it("does not persist when the analysis fails", async () => {
    const { ms, ats, win } = bootScorecardFlow({});
    win.JobBoredApp.core.host.getAtsScorecardApiUrl = () => "";
    ats.startAtsScorecardAnalysis("key-2", {
      feature: "resume_update",
      docText: "resume text",
      job: { url: job.link },
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ms.getScorecardForJob(job), null);
  });
});

/* P0-A: query-string boards. Indeed's `viewjob?jk=…` and LinkedIn's
   `jobs/search?currentJobId=…` differ ONLY in the query string, so a key that
   throws it away serves one role's analysis under every other role on the same
   board. These use the real pasted shapes, not synthetic ones. */
describe("scorecard identity (P0-A)", () => {
  const indeedA = { link: "https://www.indeed.com/viewjob?jk=aaa111", company: "Meridian", title: "PM" };
  const indeedB = { link: "https://www.indeed.com/viewjob?jk=bbb222", company: "Northwind", title: "Designer" };

  it("does not serve one Indeed role's scorecard under another", () => {
    const ms = boot();
    ms.setScorecardForJob(indeedA, { overallScore: 82 }, "resume_update");
    assert.equal(ms.getScorecardForJob(indeedB), null, "jk=bbb222 must not read jk=aaa111's card");
    assert.equal(ms.getScorecardForJob(indeedA).result.overallScore, 82);
  });

  it("does not serve one LinkedIn role's scorecard under another", () => {
    const ms = boot();
    const a = { link: "https://www.linkedin.com/jobs/search?currentJobId=4001&keywords=pm", company: "Meridian", title: "PM" };
    const b = { link: "https://www.linkedin.com/jobs/search?currentJobId=4002&keywords=pm", company: "Northwind", title: "Designer" };
    ms.setScorecardForJob(a, { overallScore: 70 }, "resume_update");
    assert.equal(ms.getScorecardForJob(b), null);
  });

  it("ignores tracking params so the same posting still hits its own card", () => {
    const ms = boot();
    ms.setScorecardForJob({ link: "https://www.indeed.com/viewjob?jk=aaa111", company: "Meridian", title: "PM" }, { overallScore: 61 }, "resume_update");
    const hit = ms.getScorecardForJob({ link: "https://www.indeed.com/viewjob?jk=aaa111&utm_source=email&from=serp", company: "Meridian", title: "PM" });
    assert.ok(hit, "utm_* must not fork the key");
    assert.equal(hit.result.overallScore, 61);
  });

  it("rejects a stored card whose title and company are a different role", () => {
    const ms = boot();
    ms.setScorecardForJob({ link: "https://jobs.test/shared", company: "Meridian", title: "PM" }, { overallScore: 90 }, "resume_update");
    assert.equal(
      ms.getScorecardForJob({ link: "https://jobs.test/shared", company: "Northwind", title: "Staff Designer" }),
      null,
      "a key collision must be caught by the stored title+company",
    );
  });
});

/* P0-D: one corrupt byte must not destroy 99 other scorecards, and a null
   entry must not throw out of the success path of a finished analysis. */
describe("scorecard store durability (P0-D)", () => {
  it("drops a corrupt store instead of silently overwriting it", () => {
    const ms = boot();
    ms._storage.setItem("jb_ats_scorecard_v1", "{not json");
    assert.equal(ms.getScorecardForJob(job), null);
    assert.equal(ms._storage.getItem("jb_ats_scorecard_v1"), null, "the unreadable key must be dropped, not carried into the next write");
  });

  it("survives a null entry in the store when evicting", () => {
    const ms = boot();
    const store = {};
    for (let i = 0; i < 101; i++) store[`url:https://jobs.test/${i}`] = { result: { overallScore: i }, storedAt: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z` };
    store["url:https://jobs.test/broken"] = null;
    ms._storage.setItem("jb_ats_scorecard_v1", JSON.stringify(store));
    assert.doesNotThrow(() => ms.setScorecardForJob(job, { overallScore: 42 }, "resume_update"));
    assert.equal(ms.getScorecardForJob(job).result.overallScore, 42);
  });

  it("warns rather than silently swallowing a quota failure", () => {
    const ms = boot();
    ms._storage.setItem = () => { throw new Error("QuotaExceededError"); };
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...a) => warnings.push(a.join(" "));
    try {
      assert.doesNotThrow(() => ms.setScorecardForJob(job, { overallScore: 9 }, "resume_update"));
    } finally {
      console.warn = realWarn;
    }
    assert.equal(warnings.length, 1, "a dropped scorecard must leave a trace");
  });
});
