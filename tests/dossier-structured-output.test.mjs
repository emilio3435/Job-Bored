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
const briefSource = readFileSync(join(repoRoot, "role-brief.js"), "utf8");
const insightsJs = readFileSync(join(repoRoot, "job-posting-insights.js"), "utf8");
const validatorPath = join(repoRoot, "structured-output-validator.js");

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options ? options.detail : undefined;
  }
}

function makeBus() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      const list = listeners.get(event.type) || [];
      for (const fn of list) fn.call(this, event);
      return true;
    },
  };
}

function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add(c) { set.add(c); },
    contains(c) { return set.has(c); },
  };
}

function makeMount() {
  return {
    classList: makeClassList(),
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    _innerHTML: "",
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v == null ? "" : v); },
    querySelector() { return null; },
  };
}

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
  vm.runInContext(insightsJs, ctx, { filename: "job-posting-insights.js" });
  return ctx.window.CommandCenterJobPostingInsights;
}

function renderBrief(enrichment) {
  const documentEl = Object.assign(makeBus(), {
    body: { classList: makeClassList(["jb-v2"]) },
    readyState: "complete",
    querySelector() { return null; },
  });
  const windowEl = makeBus();
  windowEl.document = documentEl;
  windowEl.matchMedia = () => ({ matches: false });
  windowEl.CustomEvent = TestCustomEvent;
  windowEl.JobBoredFlowing = {};
  const context = vm.createContext({
    CustomEvent: TestCustomEvent,
    document: documentEl,
    window: windowEl,
    console: { error() {}, warn() {}, log() {} },
    Date,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
  });
  context.globalThis = context;
  try {
    vm.runInContext(
      readFileSync(validatorPath, "utf8"),
      context,
      { filename: "structured-output-validator.js" },
    );
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
  vm.runInContext(briefSource, context, { filename: "role-brief.js" });
  const mount = makeMount();
  context.window.JobBoredDossierBrief.renderBrief(mount, {
    job: {
      jobKey: "L1",
      role: "Backend Engineer",
      company: "Acme",
      enrichment,
    },
  });
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

describe("F3A-DOSSIER02-STRUCT — Brief shows review state, not polluted claims", () => {
  it("does not render fence or chat tokens as must-have bullets", () => {
    const api = loadValidator();
    const cleaned = api.validateEnrichment(fixture.parsedPolluted);
    const html = renderBrief({ ...cleaned, status: "ready" });
    assert.doesNotMatch(html, /```json/);
    assert.doesNotMatch(html, /&lt;must_haves&gt;|<must_haves>/);
    assert.doesNotMatch(html, /im_start/);
    assert.doesNotMatch(html, /mustHaves:/);
    assert.match(html, /5\+ years Python/);
  });

  it("surfaces a review state instead of treating polluted lists as facts", () => {
    const api = loadValidator();
    const cleaned = api.validateEnrichment(fixture.parsedPolluted);
    const html = renderBrief({ ...cleaned, status: "ready" });
    assert.match(
      html,
      /brief__review/,
      "DOSSIER-02: show a review state, not only silently cleaned bullets",
    );
    assert.match(html, /review/i);
  });

  it("raw polluted enrichment that skipped the validator still does not render delimiter tokens", () => {
    const html = renderBrief({
      ...fixture.parsedPolluted,
      status: "ready",
    });
    assert.doesNotMatch(
      html,
      /```json/,
      "Brief must fail closed even if insights forgot to validate",
    );
    assert.doesNotMatch(html, /im_start/);
    assert.match(
      html,
      /brief__review/,
      "unvalidated polluted lists must still enter review state in the Brief",
    );
  });
});
