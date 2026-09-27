import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { validateRunRecord } from "../server/materials-package.mjs";
import { runPipeline } from "../server/materials-pipeline.mjs";

const RESUME_TEXT = [
  "Jordan Rivera",
  "Austin, TX · jordan.rivera@example.com · 555-010-2030",
  "Northwind — Digital Sales Manager, 2021–2026",
  "- Grew Austin to a top-3 national ranking on a $10M+ book with Google Ads.",
  "- Drove 130% YoY paid-search conversion growth on a flagship account.",
  "- Led the market to a 60% digital revenue mix with clear weekly readouts.",
  "Example App — Founder, 2024–present",
  "- Shipped an SEM forecast tool on Gemini that ran 21+ forecasts against $2.4M of pipeline.",
  "- Built streaming ingestion for analytics events with Kafka and Postgres.",
].join("\n");

const PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative: "Staff engineer who builds durable distributed systems for people.",
  },
  strengths: [
    {
      name: "Backend systems",
      rank: 1,
      evidence: "Shipped services handling 10k RPS with Postgres and Kafka.",
      keywords: ["Postgres", "Kafka"],
    },
  ],
  experiences: [{ slug: "northwind", company: "Northwind", title: "Digital Sales Manager" }],
  hardConstraints: { workMode: "any" },
};

const JD_TEXT = [
  "Data Platform Engineer at Acme Analytics in Austin, TX. This role builds warehouse",
  "pipelines and streaming ingestion for analytics events, owns observability dashboards,",
  "and partners with analysts on pipeline math and spend reporting.",
  "Requirements: five years with warehouse modeling, streaming ingestion, Python, SQL,",
  "orchestration with Airflow, observability, and cloud platforms. You have shipped",
  "production data systems with clear reliability practices and documentation.",
].join("\n");

const PIN = { provider: "local", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
const GATE = { verdict: "usable", confidence: 0.9, signals: {} };

function payload() {
  return {
    slug: "acme-role",
    company: "Acme Analytics",
    title: "Data Platform Engineer",
    feature: "both",
    jobUrl: "https://example.com/job",
    notes: "",
    resume: { source: "upload", filename: "resume.txt", addedAt: "2026-09-26T00:00:00.000Z", text: RESUME_TEXT },
  };
}

function scriptedFetch(scripts) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ system: body.messages[0].content, user: body.messages[1].content });
    const script = scripts[Math.min(calls.length - 1, scripts.length - 1)];
    if (script instanceof Error) throw script;
    const content = typeof script === "function" ? script(calls.length - 1, body) : script;
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  return { fetchImpl, calls };
}

function stageScripts() {
  return [
    /* jd.extract fill */
    JSON.stringify({
      outcomes: [
        { id: "pipe-math", text: "Own pipeline math with analysts", weight: 0.9 },
        { id: "streaming", text: "Ship streaming ingestion for analytics events", weight: 0.9 },
      ],
      differentiators: [{ id: "d1", text: "Production data systems with reliability practices" }],
      bars: [],
      constraints: [{ type: "location", text: "Austin, TX" }],
      echoBans: ["leverage synergies"],
      nounWeights: { streaming: 1.0, pipeline: 0.9 },
    }),
    /* claims.select — answered dynamically from the shortlist */
    (index, body) => {
      const ids = [...body.messages[1].content.matchAll(/^(\d+)\. (\S+)/gm)].map((m) => m[2]);
      const kept = ids.slice(0, 5);
      return JSON.stringify({
        kept: kept.map((claimId, i) => ({ claimId, slot: `resume.featured.pick.b${i + 1}`, reason: "maps to pipeline nouns" })),
        dropped: ids.slice(5).map((claimId) => ({ claimId, code: "budget", reason: "outside the kept set" })),
        transfers: [],
        letter: { analyticsProof: kept[0], aiOpsProof: kept[1] || kept[0] },
      });
    },
    /* draft — answered dynamically from the featured claims */
    (index, body) => {
      const user = body.messages[1].content;
      const featured = [...user.matchAll(/^- (\S+): /gm)].map((m) => m[1]);
      const spelled = ["one", "two", "three", "four", "five", "six", "seven"];
      return JSON.stringify({
        statement: "Platform engineer with analytics depth and production data systems experience.",
        bullets: featured.map((claimId, i) => ({ claimId, text: `Drafted work item ${spelled[i] || "next"} with concrete outcomes.` })),
        earlier: [],
        letter: {
          thesis: "You are hiring someone to keep pipelines honest, and that is the work I have done for years with clear weekly readouts.",
          analyticsProof: "I owned pipeline math with analysts and shipped reporting the business trusted every single week of the year.",
          aiOpsProof: "I built streaming ingestion for analytics events with Kafka and Postgres in production for real customers.",
          nextStep: "I would start by tracing one pipeline from source to readout, and I would be glad to walk through it.",
        },
      });
    },
  ];
}

describe("materials pipeline", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-pipeline-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function base(slugDir = dir) {
    return {
      dir: slugDir,
      payload: payload(),
      pin: PIN,
      jdText: JD_TEXT,
      jdSource: "paste",
      gate: GATE,
      ledger: buildLedger({ profile: PROFILE, resumeText: RESUME_TEXT }),
      resumeText: RESUME_TEXT,
      voice: ["Short sentences."],
      now: new Date("2026-09-26T05:00:00.000Z"),
      runId: "run-pipeline-1",
      openSession: async () => null,
      readMarks: async () => [],
      onStage: () => {},
    };
  }

  it("runs extract/select/draft and publishes a validated package + run.json", async () => {
    const { fetchImpl, calls } = scriptedFetch(stageScripts());
    const out = await runPipeline({ ...base(), fetchImpl });
    assert.equal(out.outcome, "published");
    assert.equal(calls.length, 3, `three narrow calls, saw ${calls.length}`);
    for (const name of ["manifest.json", "resume.html", "cover-letter.html", "resume.txt", "cover-letter.txt", "render-model.json", "run.json", "qa.json", "qa-report.md", "jd-extract.json", "selection.json", "outline.json", "draft.json"]) {
      const content = await readFile(join(dir, name), "utf8").catch(() => null);
      assert.ok(content && content.length > 0, `${name} written`);
    }
    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.equal(validateRunRecord(run).ok, true, JSON.stringify(validateRunRecord(run).errors));
    assert.ok(run.stages.some((s) => s.stage === "jd.extract" && s.llm === true));
    assert.ok(run.stages.some((s) => s.stage === "claims.select" && s.llm === true));
    assert.ok(run.stages.some((s) => s.stage === "draft" && s.llm === true));
    assert.match(run.cacheKey, /\|both$/);
    assert.equal(out.qa.status === "pass" || out.qa.status === "review", true);
  });

  it("returns the cached package with zero LLM calls on a repeat key", async () => {
    const first = scriptedFetch(stageScripts());
    const one = await runPipeline({ ...base(), fetchImpl: first.fetchImpl });
    assert.equal(one.outcome, "published");
    let calls = 0;
    const cached = await runPipeline({
      ...base(),
      runId: "run-pipeline-2",
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not call");
      },
    });
    assert.equal(cached.outcome, "cached");
    assert.equal(calls, 0);
  });

  it("publishes a degraded REVIEW package with no pin and no calls", async () => {
    let calls = 0;
    const out = await runPipeline({
      ...base(),
      pin: null,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not call");
      },
    });
    assert.equal(out.outcome, "published");
    assert.equal(calls, 0);
    assert.equal(out.qa.status, "review");
    assert.ok(out.qa.issues.some((i) => i.code === "llm_unconfigured"), JSON.stringify(out.qa.issues));
    const html = await readFile(join(dir, "resume.html"), "utf8");
    assert.match(html, /Jordan|Northwind|Example App/);
  });

  it("fails ledger_empty when the ledger carries no facts", async () => {
    const { fetchImpl } = scriptedFetch(stageScripts());
    await assert.rejects(
      runPipeline({ ...base(), ledger: { claims: [], employers: [], toolInventory: [] }, fetchImpl }),
      (e) => e.code === "ledger_empty",
    );
  });

  it("F8: repair re-enters the draft with the current draft + instructions", async () => {
    const first = scriptedFetch(stageScripts());
    await runPipeline({ ...base(), fetchImpl: first.fetchImpl });
    const current = JSON.parse(await readFile(join(dir, "draft.json"), "utf8"));
    const second = scriptedFetch(stageScripts());
    const out = await runPipeline({
      ...base(),
      runId: "run-pipeline-repair",
      fetchImpl: second.fetchImpl,
      current,
      repairInstructions: "Lead with the forecast tool, not the book.",
    });
    assert.equal(out.outcome, "published");
    const draftCall = second.calls[second.calls.length - 1];
    assert.match(draftCall.user, /REPAIR/);
    assert.match(draftCall.user, /Lead with the forecast tool/);
    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.ok(run.repairs && run.repairs.length === 1, "repair recorded");
  });
});
