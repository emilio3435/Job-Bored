import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");

function extractAtsStateBusSource(src) {
  const start = src.indexOf("let atsScorecardState = {");
  const end = src.indexOf("function getResumeGenerateDraftTextForInsights", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not extract ATS state bus source from app.js");
  }
  return src.slice(start, end);
}

class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.target = null;
  }
}

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

class FakeElement {
  constructor(tagName, ownerDocument) {
    addEventTargetMethods(this);
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = {};
    this.children = [];
    this.dataset = {};
    this.hidden = false;
    this.parentNode = null;
    this.style = {};
    this._id = "";
    this._innerHTML = "";
    this._modalBody = null;
    this._modalClose = null;
  }

  get id() {
    return this._id;
  }

  set id(value) {
    this._id = String(value || "");
    if (this._id) this.ownerDocument._elements.set(this._id, this);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    if (this._innerHTML.includes("data-dossier-ats-modal-body")) {
      this._modalBody = new FakeElement("div", this.ownerDocument);
      this._modalBody.setAttribute("data-dossier-ats-modal-body", "");
    }
    if (this._innerHTML.includes('data-action="close-dossier-ats-modal"')) {
      this._modalClose = new FakeElement("button", this.ownerDocument);
      this._modalClose.setAttribute("data-action", "close-dossier-ats-modal");
    }
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (child.id) this.ownerDocument._elements.set(child.id, child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  querySelector(selector) {
    if (selector === "[data-dossier-ats-modal-body]") return this._modalBody;
    if (selector === '[data-action="close-dossier-ats-modal"]') {
      return this._modalClose;
    }
    return null;
  }
}

function createDocument() {
  const document = addEventTargetMethods({ _elements: new Map() });
  document.createElement = (tagName) => new FakeElement(tagName, document);
  document.getElementById = (id) => document._elements.get(id) || null;
  document.body = new FakeElement("body", document);
  return document;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadAtsStateBus() {
  const window = addEventTargetMethods({});
  const document = createDocument();
  const context = vm.createContext({
    CustomEvent,
    clearTimeout,
    console,
    document,
    escapeHtml,
    setTimeout,
    window,
  });
  vm.runInContext(extractAtsStateBusSource(appJs), context, {
    filename: "app.js",
  });
  return { context, document, window };
}

function setScorecardState(context, nextState) {
  context.__nextAtsState = nextState;
  vm.runInContext("setAtsScorecardState(__nextAtsState)", context);
  delete context.__nextAtsState;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildScorecard() {
  return {
    overallScore: 88,
    confidence: 0.72,
    model: "test-model",
    dimensionScores: {
      requirementsCoverage: 90,
      experienceRelevance: 84,
      impactClarity: 79,
      atsParseability: 93,
      toneFit: 87,
    },
    topStrengths: ["Growth systems", "Activation loops"],
    criticalGaps: [
      {
        gap: "No measurable marketing-site outcome",
        whyItMatters: "The role asks for quantified funnel impact.",
        severity: "high",
      },
    ],
    rewriteSuggestions: [
      {
        targetSection: "Experience",
        after: "Lifted activation by 18% through onboarding experiments.",
        rationale: "Adds quantified product impact.",
      },
    ],
    evidence: [
      {
        claim: "React systems",
        sourceSnippet: "Built reusable React surfaces.",
        sourceType: "resume",
      },
    ],
  };
}

describe("ATS state bus", () => {
  it("setAtsScorecardState emits jb:ats:state on window and document", () => {
    const { context, document, window } = loadAtsStateBus();
    const windowEvents = [];
    const documentEvents = [];
    window.addEventListener("jb:ats:state", (e) => windowEvents.push(e.detail));
    document.addEventListener("jb:ats:state", (e) =>
      documentEvents.push(e.detail),
    );

    const result = buildScorecard();
    setScorecardState(context, {
      cacheKey: "ats:cover_letter:job-1:abc",
      status: "success",
      result,
      error: "",
      payload: { docText: "draft" },
    });

    const expected = {
      jobKey: "ats:cover_letter:job-1:abc",
      status: "success",
      result,
      error: null,
    };
    assert.deepEqual(clone(windowEvents), [expected]);
    assert.deepEqual(clone(documentEvents), [expected]);
  });

  it("jb:ats:state:request re-emits only when the jobKey matches cached state", () => {
    const { context, document, window } = loadAtsStateBus();
    const windowEvents = [];
    const documentEvents = [];
    window.addEventListener("jb:ats:state", (e) => windowEvents.push(e.detail));
    document.addEventListener("jb:ats:state", (e) =>
      documentEvents.push(e.detail),
    );
    setScorecardState(context, {
      cacheKey: "ats:cover_letter:job-1:abc",
      status: "success",
      result: buildScorecard(),
      error: "",
      payload: null,
    });
    windowEvents.length = 0;
    documentEvents.length = 0;

    window.dispatchEvent(
      new CustomEvent("jb:ats:state:request", {
        detail: { jobKey: "ats:cover_letter:job-1:abc" },
      }),
    );
    assert.equal(windowEvents.length, 1);
    assert.equal(documentEvents.length, 1);
    assert.equal(windowEvents[0].status, "success");

    windowEvents.length = 0;
    documentEvents.length = 0;
    window.dispatchEvent(
      new CustomEvent("jb:ats:state:request", {
        detail: { jobKey: "ats:cover_letter:job-2:def" },
      }),
    );
    assert.equal(windowEvents.length, 0);
    assert.equal(documentEvents.length, 0);
  });

  it("jb:ats:modal:open opens the full scorecard modal and close paths hide it", () => {
    const { context, document, window } = loadAtsStateBus();
    setScorecardState(context, {
      cacheKey: "ats:cover_letter:job-1:abc",
      status: "success",
      result: buildScorecard(),
      error: "",
      payload: null,
    });

    const openModal = () => {
      window.dispatchEvent(
        new CustomEvent("jb:ats:modal:open", {
          detail: { jobKey: "ats:cover_letter:job-1:abc" },
        }),
      );
      const modal = document.getElementById("dossierAtsScorecardModal");
      assert.ok(modal);
      assert.equal(modal.style.display, "flex");
      assert.equal(modal.hidden, false);
      assert.match(modal.className, /\bdossier-ats-modal\b/);
      assert.match(
        modal.querySelector("[data-dossier-ats-modal-body]").innerHTML,
        /Full scorecard/,
      );
      return modal;
    };

    let modal = openModal();
    document.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(modal.style.display, "none");
    assert.equal(modal.hidden, true);

    modal = openModal();
    modal.dispatchEvent({ type: "click", target: modal });
    assert.equal(modal.style.display, "none");
    assert.equal(modal.hidden, true);

    modal = openModal();
    modal
      .querySelector('[data-action="close-dossier-ats-modal"]')
      .dispatchEvent({ type: "click" });
    assert.equal(modal.style.display, "none");
    assert.equal(modal.hidden, true);
  });
});
