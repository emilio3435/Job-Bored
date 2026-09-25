/* ============================================================
   dossier-structured-output.test.mjs
   ------------------------------------------------------------
   Named claim F3A-DOSSIER02-STRUCT (audit DOSSIER-02):

   Malformed model delimiters are rendered as authoritative
   requirements. Fence markers, XML wrappers, chat tokens,
   leftover field names, and JSON-as-string list items can
   leak into must-haves.

   Why this matters: a hunter using polluted bullets as
   "must-haves" will tailor the wrong resume and reject
   roles for fake requirements.
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(
    join(repoRoot, "tests/fixtures/dossier-evidence/malformed-delimiters.json"),
    "utf8",
  ),
);
const jbTextJs = readFileSync(join(repoRoot, "jb-text.js"), "utf8");
const insightsJs = readFileSync(join(repoRoot, "job-posting-insights.js"), "utf8");
const validatorPath = join(repoRoot, "structured-output-validator.js");





function loadValidator() {
  const src = readFileSync(validatorPath, "utf8");
  const ctx = vm.createContext({
    console: { error() {}, warn() {}, log() {} },
    JSON,
    Array,
    Object,
    String,
    Number,
    Math,
    RegExp,
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.runInContext(src, ctx, { filename: "structured-output-validator.js" });
  const api = ctx.JobBoredStructuredOutput || ctx.window.JobBoredStructuredOutput;
  assert.ok(api, "structured-output-validator.js must expose JobBoredStructuredOutput");
  return api;
}

function loadInsightsWithValidator() {
  const validatorSrc = readFileSync(validatorPath, "utf8");
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(fixture.parsedPolluted) }],
          },
        },
      ],
    }),
  });
  const ctx = {
    window: {
      CommandCenterResumeGenerate: {
        getResumeGenerationConfig: () => ({
          provider: "gemini",
          resumeGeminiApiKey: "test-key",
          resumeGeminiModel: "gemini-test",
        }),
      },
    },
    fetch: fetchImpl,
    URL,
    console: { log() {}, warn() {}, error() {} },
    JSON,
    Array,
    Object,
    String,
    Number,
    Math,
    RegExp,
  };
  vm.createContext(ctx);
  ctx.globalThis = ctx;
  vm.runInContext(validatorSrc, ctx, { filename: "structured-output-validator.js" });
  vm.runInContext(jbTextJs, ctx, { filename: "jb-text.js" });
  vm.runInContext(insightsJs, ctx, { filename: "job-posting-insights.js" });
  return ctx.window.CommandCenterJobPostingInsights;
}

/* The Case's render path, end to end: the region owner hands the view-model to
   the model and the renderer paints it. The validator is loaded the way
   index.html loads it, so the "fail closed" case exercises the real defense. */
function renderCase(enrichment, { withValidator = true } = {}) {
  const CASE_STAGES = ["new", "researching", "applied", "rejected"];
  const stages = {
    pairs: () => CASE_STAGES.map((k) => ({ key: k, label: k })),
    toKey: (v) => (CASE_STAGES.includes(v) ? v : ""),
    toLabel: (v) => String(v),
    isClosed: (v) => v === "rejected",
  };
  const sandbox = { window: {} };
  if (withValidator) {
    try {
      vm.runInNewContext(readFileSync(validatorPath, "utf8"), sandbox, {
        filename: "structured-output-validator.js",
      });
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err;
    }
  }
  /* Trap 2: jb-text.js before the model and the renderer. */
  for (const file of ["jb-text.js", "role-case-model.js", "role-case.js"]) {
    vm.runInNewContext(readFileSync(join(repoRoot, file), "utf8"), sandbox, { filename: file });
  }
  const Case = sandbox.window.JobBoredCase;
  const job = { jobKey: "L1", role: "Backend Engineer", company: "Acme", stage: "new", enrichment };
  /* Mirrors role.js renderDossier's reviewedVm guard. */
  const api = sandbox.window.JobBoredStructuredOutput;
  const reviewed = api && typeof api.validateEnrichment === "function"
    ? { job: { ...job, enrichment: api.validateEnrichment(enrichment) } }
    : { job };
  const model = Case.model.buildCaseModel("L1", {
    vm: reviewed, stages, nowMs: Date.now(),
    parseDate: (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; },
  });
  const mount = { innerHTML: "" };
  Case.render(mount, model);
  return mount.innerHTML;
}

describe("F3A-DOSSIER02-STRUCT — validator strips delimiter pollution", () => {
  it("does not treat fence, XML, chat, and field-name tokens as requirements", () => {
    const api = loadValidator();
    const cleaned = api.validateEnrichment(fixture.parsedPolluted);
    assert.deepEqual(
      Array.from(cleaned.mustHaves),
      fixture.expectedClean.mustHaves,
      fixture.why,
    );
    assert.deepEqual(
      Array.from(cleaned.responsibilities),
      fixture.expectedClean.responsibilities,
    );
    assert.deepEqual(Array.from(cleaned.niceToHaves), fixture.expectedClean.niceToHaves);
    assert.deepEqual(
      Array.from(cleaned.toolsAndStack),
      fixture.expectedClean.toolsAndStack,
      "a JSON-array-as-string tools field should be recovered, not shown as one fake tool",
    );
    assert.deepEqual(
      Array.from(cleaned.talkingPoints),
      fixture.expectedClean.talkingPoints,
    );
    assert.deepEqual(
      Array.from(cleaned.extraKeywords),
      fixture.expectedClean.extraKeywords,
    );
  });

  it("marks the payload needs_review instead of silently dropping the pollution", () => {
    const api = loadValidator();
    const cleaned = api.validateEnrichment(fixture.parsedPolluted);
    assert.equal(cleaned.reviewState.status, "needs_review");
    assert.ok(
      Array.isArray(cleaned.reviewState.pollutedFields) &&
        cleaned.reviewState.pollutedFields.includes("mustHaves"),
      "mustHaves carried delimiter tokens and must be listed for review",
    );
    assert.match(
      String(cleaned.reviewState.reason || ""),
      /delimiter|malformed|pollut/i,
      "review reason must say the structured output was malformed",
    );
  });

  it("leaves a clean payload authoritative and not in review", () => {
    const api = loadValidator();
    const clean = {
      inferredTitle: "Growth Designer",
      inferredCompany: "Linear",
      inferredLocation: "Remote",
      postingSummary: "Lead growth design.",
      roleInOneLine: "Own activation.",
      mustHaves: ["5+ years growth design"],
      responsibilities: ["Own onboarding"],
      niceToHaves: ["Statsig"],
      toolsAndStack: ["Figma"],
      atsFitScore: 84,
      atsFitRationale: "Strong evidence.",
      fitAngle: "Activation maps.",
      talkingPoints: ["Show the lift."],
      extraKeywords: ["growth"],
    };
    const out = api.validateEnrichment(clean);
    assert.equal(out.reviewState.status, "ok");
    assert.deepEqual(Array.from(out.mustHaves), ["5+ years growth design"]);
  });
});

describe("F3A-DOSSIER02-STRUCT — insights pipeline applies the validator", () => {
  it("enrichFromScrape does not return delimiter tokens as must-haves", async () => {
    const api = loadInsightsWithValidator();
    const out = await api.enrichFromScrape(
      {
        url: "https://jobs.example/roles/9",
        description: "We need a backend engineer with 5+ years of Python.",
        requirements: ["5+ years Python"],
        skills: ["Python"],
      },
      { title: "Backend Engineer", company: "Acme" },
      "",
    );
    assert.ok(!out.mustHaves.includes("```json"), fixture.why);
    assert.ok(!out.mustHaves.includes("<must_haves>"));
    assert.ok(!out.mustHaves.includes("<|im_start|>user"));
    assert.ok(out.mustHaves.includes("5+ years Python"));
    assert.equal(out.reviewState.status, "needs_review");
  });
});

describe("F3A-DOSSIER02-STRUCT — The Case never renders polluted claims", () => {
  it("does not render fence or chat tokens as requirement bullets", () => {
    const api = loadValidator();
    const cleaned = api.validateEnrichment(fixture.parsedPolluted);
    const html = renderCase({ ...cleaned, status: "ready" });
    assert.doesNotMatch(html, /```json/);
    assert.doesNotMatch(html, /must_haves/);
    assert.doesNotMatch(html, /im_start/);
    assert.doesNotMatch(html, /mustHaves:/);
    assert.match(html, /5\+ years Python/, "the real requirement still reads");
  });

  it("raw polluted enrichment that skipped the validator still does not render delimiter tokens", () => {
    const html = renderCase({ ...fixture.parsedPolluted, status: "ready" });
    assert.doesNotMatch(
      html,
      /```json/,
      "the dossier must fail closed even if insights forgot to validate",
    );
    assert.doesNotMatch(html, /im_start/);
    assert.doesNotMatch(html, /must_haves/);
    assert.match(html, /5\+ years Python/);
  });

  it("renders the pollution verbatim ONLY when the validator is absent — the guard is what saves us", () => {
    /* Negative control: with structured-output-validator.js unloaded there is
       nothing to fail closed with. This is what makes the case above a real
       test of the guard rather than a test of the fixture. */
    const html = renderCase({ ...fixture.parsedPolluted, status: "ready" }, { withValidator: false });
    assert.match(html, /```json/);
  });
});

/* The Brief's `.brief__review` banner retired with role-brief.js: The Case has
   no AI-prose block to caveat (spec §3 cuts postingSummary / fitAngle), so the
   review STATE is no longer rendered. The behavior that mattered — polluted
   lists never reach a bullet — is pinned above, and role.js's reviewedVm guard
   is what enforces it. */
