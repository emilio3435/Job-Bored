import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sessionPath = join(repoRoot, "scribe-session.js");

function addEventTargetMethods(target) {
  const listeners = new Map();
  target.addEventListener = (type, handler) => {
    const bucket = listeners.get(type) || [];
    bucket.push(handler);
    listeners.set(type, bucket);
  };
  target.removeEventListener = (type, handler) => {
    const bucket = listeners.get(type) || [];
    listeners.set(
      type,
      bucket.filter((entry) => entry !== handler),
    );
  };
  target.dispatchEvent = (event) => {
    if (!event.target) event.target = target;
    for (const handler of listeners.get(event.type) || []) {
      handler.call(target, event);
    }
    return true;
  };
  return target;
}

class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail || null;
    this.target = null;
  }
}

function loadFactory() {
  assert.equal(
    existsSync(sessionPath),
    true,
    "scribe-session.js must exist as the isolated Scribe state machine",
  );
  const window = addEventTargetMethods({});
  const document = addEventTargetMethods({});
  const context = vm.createContext({
    window,
    document,
    CustomEvent,
    console,
  });
  vm.runInContext(readFileSync(sessionPath, "utf8"), context, {
    filename: "scribe-session.js",
  });
  const factory = context.window.JobBoredScribeSession;
  assert.ok(factory, "window.JobBoredScribeSession must be exported");
  assert.equal(typeof factory.create, "function");
  return { factory, window, document };
}

function fixtureScorecard(overrides = {}) {
  return {
    overallScore: 88,
    confidence: 0.72,
    model: "fixture-scorecard-v1",
    dimensionScores: {
      requirementsCoverage: 90,
      experienceRelevance: 84,
      impactClarity: 79,
      atsParseability: 93,
      toneFit: 87,
    },
    criticalGaps: [
      {
        gap: "No measurable marketing-site outcome",
        whyItMatters: "The role asks for quantified funnel impact.",
        severity: "high",
      },
    ],
    ...overrides,
  };
}

describe("F3B-SCRIBE01-ROLE — selected-role and document version state machine", () => {
  it("a fresh session has no selected role and no document version — not a demo surface", () => {
    const session = loadFactory().factory.create();
    const snap = session.snapshot();
    assert.equal(snap.role, null);
    assert.equal(snap.document, null);
    assert.notEqual(session.roleLabel(), "Senior role · Company");
    assert.match(session.roleLabel(), /no role|unselected|select a role/i);
  });

  it("bindRole records explicit jobKey/title/company used by roleLabel", () => {
    const session = loadFactory().factory.create();
    session.bindRole({
      jobKey: "acme::staff-engineer",
      title: "Staff Engineer",
      company: "Acme",
      url: "https://acme.example/jobs/staff",
    });
    const role = session.snapshot().role;
    assert.equal(role.jobKey, "acme::staff-engineer");
    assert.equal(role.title, "Staff Engineer");
    assert.equal(role.company, "Acme");
    assert.match(session.roleLabel(), /Staff Engineer/);
    assert.match(session.roleLabel(), /Acme/);
  });

  it("setDocument records feature, versionNumber, and draftId for the bound role", () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({
      feature: "cover_letter",
      versionNumber: 4,
      draftId: "draft-4",
      text: "Persisted body",
    });
    const doc = session.snapshot().document;
    assert.equal(doc.feature, "cover_letter");
    assert.equal(doc.versionNumber, 4);
    assert.equal(doc.draftId, "draft-4");
    assert.equal(doc.text, "Persisted body");
    assert.equal(doc.dirty, false);
  });

  it("clearRole drops both the selected role and the bound document", () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({ feature: "cover_letter", versionNumber: 1, text: "x" });
    session.clearRole();
    assert.equal(session.snapshot().role, null);
    assert.equal(session.snapshot().document, null);
  });
});

describe("F3B-SCRIBE02-SCORE — visible score is real ATS evidence or clearly labeled", () => {
  it("empty document must not show a misleading nonzero demo score", () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({ feature: "cover_letter", versionNumber: 1, text: "" });
    const visible = session.visibleScorecard();
    assert.equal(visible.overall, 0);
    assert.equal(visible.source, "empty");
    assert.equal(visible.labeled, true);
    assert.equal(visible.emptyDocument, true);
    for (const key of ["req", "exp", "impact", "parse", "tone", "conf"]) {
      assert.equal(visible.axes[key], 0, `${key} must be 0 on an empty document`);
    }
    assert.doesNotMatch(String(visible.model || ""), /demo-scorecard-v1/);
  });

  it("consumes fixture ATS evidence for the matching jobKey instead of demo-scorecard-v1", () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "ats:cover_letter:job-1:abc", title: "PM", company: "Co" });
    session.setDocument({
      feature: "cover_letter",
      versionNumber: 1,
      text: "A real draft with enough body to score.",
    });
    session.bindAtsEvidence({
      jobKey: "ats:cover_letter:job-1:abc",
      status: "success",
      result: fixtureScorecard(),
    });
    const visible = session.visibleScorecard();
    assert.equal(visible.source, "ats");
    assert.equal(visible.labeled, false);
    assert.equal(visible.overall, 88);
    assert.equal(visible.axes.req, 90);
    assert.equal(visible.axes.exp, 84);
    assert.equal(visible.axes.impact, 79);
    assert.equal(visible.axes.parse, 93);
    assert.equal(visible.axes.tone, 87);
    assert.equal(visible.axes.conf, 72);
    assert.equal(visible.model, "fixture-scorecard-v1");
  });

  it("ignores ATS evidence bound to a different jobKey", () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({
      feature: "cover_letter",
      versionNumber: 1,
      text: "A real draft with enough body to score.",
    });
    session.bindAtsEvidence({
      jobKey: "job-OTHER",
      status: "success",
      result: fixtureScorecard({ overallScore: 99 }),
    });
    const visible = session.visibleScorecard();
    assert.notEqual(visible.source, "ats");
    assert.notEqual(visible.overall, 99);
    assert.equal(visible.labeled, true);
  });

  it("unavailable ATS evidence is labeled and does not invent a demo score", () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({
      feature: "cover_letter",
      versionNumber: 1,
      text: "A real draft with enough body to score.",
    });
    const visible = session.visibleScorecard();
    assert.equal(visible.overall, 0);
    assert.equal(visible.source, "unavailable");
    assert.equal(visible.labeled, true);
    assert.match(String(visible.model || visible.label || ""), /unavailable|unscored|no ats/i);
    for (const key of ["req", "exp", "impact", "parse", "tone", "conf"]) {
      assert.equal(visible.axes[key], 0);
    }
  });
});

describe("F3B-SCRIBE03-FLUSH — refine completion and persisted flush", () => {
  it("beginRefine does not mark success; completeRefine is required", () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({
      feature: "cover_letter",
      versionNumber: 1,
      draftId: "draft-1",
      text: "First draft.",
    });
    session.beginRefine({ feedback: "make it shorter" });
    const mid = session.snapshot();
    assert.equal(mid.refine.status, "refining");
    assert.equal(mid.refine.completed, false);
    assert.equal(mid.refine.ok, null);
    session.completeRefine({
      ok: true,
      text: "Shorter draft.",
      draftId: "draft-2",
      versionNumber: 2,
    });
    const done = session.snapshot();
    assert.equal(done.refine.status, "refined");
    assert.equal(done.refine.completed, true);
    assert.equal(done.refine.ok, true);
    assert.equal(done.document.text, "Shorter draft.");
    assert.equal(done.document.versionNumber, 2);
    assert.equal(done.document.draftId, "draft-2");
    assert.equal(done.document.dirty, false);
  });

  it("completeRefine failure is truthful and does not keep a fake success status", () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({ feature: "cover_letter", versionNumber: 1, text: "First draft." });
    session.beginRefine({ feedback: "tighten" });
    session.completeRefine({ ok: false, error: "provider timeout" });
    const snap = session.snapshot();
    assert.equal(snap.refine.ok, false);
    assert.equal(snap.refine.completed, true);
    assert.match(snap.refine.status, /fail/i);
    assert.match(snap.refine.error, /provider timeout/);
    assert.equal(snap.document.text, "First draft.", "failed refine must not clobber the draft");
  });

  it("Done/Print export is blocked while editor edits are dirty and unflushed", async () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({
      feature: "cover_letter",
      versionNumber: 1,
      draftId: "draft-1",
      text: "Original",
    });
    session.noteUnsavedText("Unsaved edit before done");
    assert.equal(session.canExport(), false);
    assert.equal(session.snapshot().document.dirty, true);
    const persisted = [];
    const result = await session.flush({
      persist: async (payload) => {
        persisted.push(payload);
        return { draftId: "draft-2", versionNumber: 2 };
      },
    });
    assert.equal(result.flushed, true);
    assert.equal(result.persisted, true);
    assert.equal(persisted[0].text, "Unsaved edit before done");
    assert.equal(session.canExport(), true);
    assert.equal(session.snapshot().document.versionNumber, 2);
    assert.equal(session.snapshot().document.dirty, false);
  });

  it("export stays blocked while a refine is in flight", () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({ feature: "cover_letter", versionNumber: 1, text: "First draft." });
    session.beginRefine({ feedback: "cut" });
    assert.equal(session.canExport(), false);
  });

  it("a persist failure is truthful and does not claim a saved version", async () => {
    const session = loadFactory().factory.create();
    session.bindRole({ jobKey: "job-1", title: "PM", company: "Co" });
    session.setDocument({
      feature: "cover_letter",
      versionNumber: 1,
      text: "Original",
    });
    session.noteUnsavedText("Edited body");
    const result = await session.flush({
      persist: async () => {
        throw new Error("indexeddb closed");
      },
    });
    assert.equal(result.flushed, true, "text is still flushed locally");
    assert.equal(result.persisted, false);
    assert.match(String(result.error || ""), /indexeddb closed/);
    assert.equal(session.snapshot().document.versionNumber, 1);
    assert.equal(session.canExport(), true, "flushed text is still exportable");
  });
});
