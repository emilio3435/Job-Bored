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
