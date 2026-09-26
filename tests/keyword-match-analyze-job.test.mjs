import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function boot() {
  const events = [];
  const host = {
    escapeHtml: (value) => String(value == null ? "" : value),
    // refreshCandidateProfileMatchCache reads the profile through these two.
    getUserContent: () => null,
    getResumeBundle: () => null,
    renderPipeline() {},
    refreshDrawerIfOpen() {},
  };
  const win = {
    JobBoredApp: { core: { host, getActiveDetailKey: () => -1 } },
    addEventListener() {},
    dispatchEvent(e) {
      events.push(e.type);
      return true;
    },
    CustomEvent: class {
      constructor(type, o) {
        this.type = type;
        this.detail = o && o.detail;
      }
    },
  };
  const doc = {
    addEventListener() {},
    dispatchEvent(e) {
      events.push("doc:" + e.type);
      return true;
    },
  };
  const sandbox = { window: win, document: doc, console };
  vm.runInNewContext(
    readFileSync(join(repoRoot, "jb-text.js"), "utf8"),
    sandbox,
  );
  assert.equal(typeof win.JobBoredText.clip, "function", "jb-text must load before keyword-profile-match");
  vm.runInNewContext(
    readFileSync(join(repoRoot, "keyword-profile-match.js"), "utf8"),
    sandbox,
  );
  return { km: win.JobBoredApp.keywordMatch, events };
}

describe("keywordMatch.analyzeJob", () => {
  it("returns null before the profile cache is loaded", () => {
    const { km } = boot();
    assert.equal(
      km.analyzeJob({ _postingEnrichment: { mustHaves: ["React"] } }),
      null,
    );
  });

  it("returns null when the job carries no keyword groups", () => {
    const { km } = boot();
    km.setCandidateProfileMatchCache({
      loaded: true,
      rawText: "Senior engineer.",
      normalizedText: "",
      tokenSet: new Set(),
    });
    assert.equal(km.analyzeJob({ _postingEnrichment: {} }), null);
    assert.equal(km.analyzeJob(null), null);
  });

  it("marks terms found / missing against the cached resume text", () => {
    const { km } = boot();
    km.setCandidateProfileMatchCache({
      loaded: true,
      rawText: "Senior engineer. Built React apps with TypeScript.",
      normalizedText: "",
      tokenSet: new Set(),
    });
    const a = km.analyzeJob({
      _postingEnrichment: {
        mustHaves: ["React", "Kubernetes"],
        toolsAndStack: ["TypeScript"],
      },
    });
    assert.equal(a.byLabel.get("react"), "found");
    assert.equal(a.byLabel.get("kubernetes"), "missing");
    assert.equal(a.byLabel.get("typescript"), "found");
    assert.deepEqual(plain(a.mustHaves[0].evidence), {
      snippet: "Built React apps with TypeScript.",
      source: "profile",
    });
    assert.equal(a.mustHaves[1].evidence, null);
    assert.ok(a.percentage > 0 && a.percentage <= 100);
  });

  it("findProfileEvidence returns the first labelled resume sentence and clips it at 140 characters", () => {
    const { km } = boot();
    const longSentence = "Built multi-model AI integrations across production workflows, improving delivery speed while coordinating product, engineering, analytics, marketing, operations, and executive partners.";
    const index = km.buildKeywordSearchIndex(`SUMMARY\nGrowth leader.\n\nEXPERIENCE\n${longSentence} Another AI integrations sentence.`);
    const evidence = km.findProfileEvidence({
      variants: ["ai integrations"],
      tokens: ["ai", "integrations"],
    }, index);
    assert.equal(evidence.source, "Experience");
    assert.ok(evidence.snippet.length <= 140, evidence.snippet);
    assert.ok(evidence.snippet.endsWith("…"), evidence.snippet);
    assert.ok(longSentence.startsWith(evidence.snippet.slice(0, -1)), "the first matching sentence must supply the snippet");
  });

  it("findProfileEvidence accepts a sentence containing at least half the significant tokens", () => {
    const { km } = boot();
    const index = km.buildKeywordSearchIndex("Led lifecycle automation for a national retailer.");
    assert.deepEqual(plain(km.findProfileEvidence({
      variants: ["customer intelligence lifecycle automation"],
      tokens: ["customer", "intelligence", "lifecycle", "automation"],
    }, index)), {
      snippet: "Led lifecycle automation for a national retailer.",
      source: "profile",
    });
  });

  it("exports the known-tools aliases used to preserve AI, API, CRM, CDP, and SMS", () => {
    const { km } = boot();
    for (const alias of ["ai", "api", "crm", "cdp", "sms"]) {
      assert.ok(km.KNOWN_TOOL_ALIASES.includes(alias), alias);
    }
  });

  it("exposes the four term groups plus the tallies the dossier reads", () => {
    const { km } = boot();
    km.setCandidateProfileMatchCache({
      loaded: true,
      rawText: "Built React apps.",
      normalizedText: "",
      tokenSet: new Set(),
    });
    const a = km.analyzeJob({
      _postingEnrichment: {
        mustHaves: ["React"],
        skills: ["Kubernetes"],
        toolsAndStack: [],
        requirements: ["5+ years of React"],
      },
    });
    assert.ok(Array.isArray(a.requirements));
    assert.ok(Array.isArray(a.mustHaves));
    assert.ok(Array.isArray(a.skills));
    assert.ok(Array.isArray(a.toolsAndStack));
    assert.equal(a.mustHaves[0].label, "React");
    assert.equal(a.mustHaves[0].status, "found");
    assert.equal(a.foundCount + a.partialCount + a.missingTerms.length, a.totalTerms);
  });

  it("dispatches jb:profile-match:ready after a refresh resolves", async () => {
    const { km, events } = boot();
    km.setCandidateProfileMatchCache({
      loaded: true,
      rawText: "x",
      normalizedText: "",
      tokenSet: new Set(),
    });
    await km.refreshCandidateProfileMatchCache();
    assert.ok(events.includes("jb:profile-match:ready"), events.join(","));
    assert.ok(events.includes("doc:jb:profile-match:ready"), events.join(","));
  });
});
