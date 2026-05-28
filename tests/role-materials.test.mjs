/**
 * Tests for role-materials.js — the browser-side Application Materials
 * renderer that appends Hermes-generated artifact cards to the open
 * role's brief.
 *
 * The module ships as a vanilla IIFE that runs against the real DOM,
 * so this test mounts it in a vm.Context with a minimal DOM + fetch
 * shim and asserts the public helpers (slug/match/render) directly.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "role-materials.js"), "utf8");

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options ? options.detail : undefined;
    this.bubbles = !!(options && options.bubbles);
    this.target = null;
  }
}

function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    contains(c) { return set.has(c); },
  };
}

function makeListeners() {
  return new Map();
}

function parseFirstTopLevelElement(html) {
  if (!html || typeof html !== "string") return null;
  const tagMatch = html.match(/^\s*<([a-zA-Z][\w-]*)\s*([^>]*)>([\s\S]*)<\/\1>\s*$/);
  if (!tagMatch) return null;
  const attrRe = /([a-zA-Z-][a-zA-Z0-9-]*)\s*=\s*"([^"]*)"/g;
  const attrs = {};
  let m;
  while ((m = attrRe.exec(tagMatch[2])) !== null) {
    attrs[m[1]] = m[2]
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  const inner = tagMatch[3];
  const el = makeElement(tagMatch[1], attrs);
  el.innerHTML = inner;
  return el;
}

function makeElement(tag, attrs) {
  const listeners = makeListeners();
  const children = [];
  const attributes = { ...(attrs || {}) };
  let _innerHTML = "";
  const el = {
    tagName: String(tag || "").toUpperCase(),
    children,
    attributes,
    get innerHTML() { return _innerHTML; },
    set innerHTML(html) {
      _innerHTML = String(html == null ? "" : html);
      /* When a fresh element gets a single top-level child via
         innerHTML (the pattern role-materials uses for appendSection),
         materialise it so firstElementChild works. */
      const childEl = parseFirstTopLevelElement(_innerHTML);
      children.length = 0;
      if (childEl) children.push(childEl);
    },
    addEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      listeners.set(type, arr.filter((h) => h !== fn));
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? attributes[name]
        : null;
    },
    get firstElementChild() { return children[0] || null; },
    appendChild(node) { children.push(node); node.parentNode = el; return node; },
    removeChild(node) {
      const idx = children.indexOf(node);
      if (idx >= 0) children.splice(idx, 1);
      if (node) node.parentNode = null;
      return node;
    },
    querySelector(sel) {
      /* Minimal selector support: ".class" or "[attr="val"]" */
      const dotMatch = sel.match(/^\.(\S+)$/);
      const attrMatch = sel.match(/^\[([^=\]]+)="([^"]+)"\]$/);
      const walk = (node) => {
        for (const child of node.children) {
          if (dotMatch) {
            const cls = child.attributes && child.attributes.class;
            if (cls && cls.split(/\s+/).includes(dotMatch[1])) return child;
          }
          if (attrMatch) {
            const v = child.attributes && child.attributes[attrMatch[1]];
            if (v === attrMatch[2]) return child;
          }
          const inner = walk(child);
          if (inner) return inner;
        }
        return null;
      };
      return walk(el);
    },
    _listeners: listeners,
  };
  return el;
}

/**
 * Parse a fragment of HTML returned by role-materials into a synthetic
 * element tree we can run querySelector against. Only the pieces of
 * the structure the tests assert against are populated.
 */
function parseSection(html) {
  /* role-materials only ever emits one top-level <section>. Pull out the
     classes, slug attr, and inner card markers we care about. */
  const sectionMatch = html.match(/^<section\s+([^>]*)>([\s\S]*)<\/section>$/);
  if (!sectionMatch) return null;
  const attrs = {};
  const attrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(sectionMatch[1])) !== null) {
    attrs[m[1]] = m[2];
  }
  const section = makeElement("section", attrs);
  section.innerHTML = sectionMatch[2];
  /* Pull out each card. */
  const cardRe = /<article\s+([^>]*)>([\s\S]*?)<\/article>/g;
  let card;
  while ((card = cardRe.exec(sectionMatch[2])) !== null) {
    const cAttrs = {};
    let am;
    const cAttrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
    while ((am = cAttrRe.exec(card[1])) !== null) {
      cAttrs[am[1]] = am[2];
    }
    const cardEl = makeElement("article", cAttrs);
    cardEl.innerHTML = card[2];
    /* Pull out anchors (preview / download). */
    const anchorRe = /<a\s+([^>]*)>([\s\S]*?)<\/a>/g;
    let an;
    while ((an = anchorRe.exec(card[2])) !== null) {
      const aAttrs = {};
      let aam;
      const aAttrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
      while ((aam = aAttrRe.exec(an[1])) !== null) {
        aAttrs[aam[1]] = aam[2];
      }
      const a = makeElement("a", aAttrs);
      a.text = an[2];
      cardEl.appendChild(a);
    }
    section.appendChild(cardEl);
  }
  return section;
}

function makeDocument() {
  const body = makeElement("body");
  body.classList = makeClassList(["jb-v2"]);
  const doc = {
    body,
    readyState: "complete",
    addEventListener() {},
    createElement(tag) { return makeElement(tag); },
    dispatchEvent() { return true; },
    /* We only ever query for the role region; return null so the
       module's listeners load but no auto-render happens. */
    querySelector() { return null; },
  };
  return doc;
}

let api;

before(() => {
  const documentEl = makeDocument();
  const windowEl = {
    document: documentEl,
    CustomEvent: TestCustomEvent,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    matchMedia: () => ({ matches: false }),
    location: { hostname: "localhost", hash: "" },
    JobBoredFlowing: {},
    queueMicrotask: (fn) => fn(),
  };
  const ctx = vm.createContext({
    window: windowEl,
    document: documentEl,
    CustomEvent: TestCustomEvent,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    fetch: () => Promise.reject(new Error("fetch not stubbed in unit test")),
    Date,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
  });
  vm.runInContext(source, ctx, { filename: "role-materials.js" });
  api = windowEl.JobBoredRoleMaterials;
  if (!api) throw new Error("role-materials.js did not expose JobBoredRoleMaterials");
});

describe("slugify + buildCandidateSlug", () => {
  it("matches Hermes folder slugs for known applications", () => {
    assert.equal(
      api.buildCandidateSlug({ company: "Chartis.io", role: "Senior Digital Marketing Consultant" }),
      "chartis-senior-digital-marketing-consultant",
    );
    assert.equal(
      api.buildCandidateSlug({ company: "TEGNA", role: "Digital Sales Manager" }),
      "tegna-digital-sales-manager",
    );
    assert.equal(
      api.buildCandidateSlug({ company: "CrowdStrike", role: "Director, Sales Enablement Specialists" }),
      "crowdstrike-director-sales-enablement-specialists",
    );
  });

  it("drops corporate TLD suffixes and collapses punctuation", () => {
    assert.equal(
      api.slugify("Anthropic, Inc."),
      "anthropic-inc",
    );
    assert.equal(api.slugify("Foo & Bar"), "foo-and-bar");
  });

  it("returns empty string when both fields are blank", () => {
    assert.equal(api.buildCandidateSlug({ company: "", role: "" }), "");
  });
});

describe("pickApplication", () => {
  const apps = [
    { slug: "chartis-senior-digital-marketing-consultant" },
    { slug: "tegna-digital-sales-manager" },
    { slug: "crowdstrike-director-sales-enablement-specialists" },
    { slug: "anthropic-solutions-architect-applied-ai-sl-gov-west" },
  ];

  it("prefers exact slug match", () => {
    const picked = api.pickApplication(
      { company: "TEGNA", role: "Digital Sales Manager" },
      apps,
    );
    assert.equal(picked.slug, "tegna-digital-sales-manager");
  });

  it("falls back to title-word overlap when title doesn't match exactly", () => {
    const picked = api.pickApplication(
      /* The sheet title might say "Solutions Architect, Applied AI"
         while the folder has a longer suffix. We should still find it. */
      { company: "Anthropic", role: "Solutions Architect, Applied AI" },
      apps,
    );
    assert.equal(picked.slug, "anthropic-solutions-architect-applied-ai-sl-gov-west");
  });

  it("returns null when no application matches the company", () => {
    const picked = api.pickApplication(
      { company: "Stripe", role: "Designer" },
      apps,
    );
    assert.equal(picked, null);
  });

  it("ignores corporate suffixes like Inc., Media, Holdings", () => {
    /* Real-world: pipeline row says "TEGNA Inc." or "TEGNA Media";
       the Hermes folder is just tegna-digital-sales-manager. */
    const variants = [
      { company: "TEGNA Inc.", role: "Digital Sales Manager" },
      { company: "TEGNA Media", role: "Digital Sales Manager" },
      { company: "TEGNA Inc", role: "Digital Sales Manager" },
      { company: "TEGNA Holdings", role: "Digital Sales Manager" },
    ];
    for (const job of variants) {
      const picked = api.pickApplication(job, apps);
      assert.ok(picked, `expected a match for ${job.company}`);
      assert.equal(picked.slug, "tegna-digital-sales-manager", job.company);
    }
  });

  it("matches when the pipeline title is shorter than the folder title", () => {
    const picked = api.pickApplication(
      { company: "CrowdStrike", role: "Director, Sales Enablement" },
      apps,
    );
    assert.equal(picked.slug, "crowdstrike-director-sales-enablement-specialists");
  });
});

describe("renderManifest", () => {
  function makeBrief() {
    return makeElement("div", { "data-mount": "brief" });
  }

  it("renders one card per document with status + actions", () => {
    const brief = makeBrief();
    api.renderManifest(brief, {
      slug: "chartis-senior-digital-marketing-consultant",
      company: "Chartis",
      title: "Senior Digital Marketing Consultant",
      derived: true,
      updatedAt: new Date().toISOString(),
      documents: [
        {
          type: "resume",
          label: "Tailored Resume",
          status: "ready",
          primary: "resume.pdf",
          lastModifiedAt: new Date().toISOString(),
          files: [
            { filename: "resume.pdf", format: "pdf", size: 354257, modifiedAt: new Date().toISOString() },
            { filename: "resume.html", format: "html", size: 28890, modifiedAt: new Date().toISOString() },
          ],
        },
        {
          type: "cover_letter",
          label: "Cover Letter",
          status: "ready",
          primary: "cover-letter.pdf",
          lastModifiedAt: new Date().toISOString(),
          files: [
            { filename: "cover-letter.pdf", format: "pdf", size: 293275, modifiedAt: new Date().toISOString() },
            { filename: "cover-letter.html", format: "html", size: 13478, modifiedAt: new Date().toISOString() },
          ],
        },
        {
          type: "qa_report",
          label: "QA Report",
          status: "ready",
          primary: "qa-report.md",
          lastModifiedAt: new Date().toISOString(),
          files: [{ filename: "qa-report.md", format: "md", size: 7244, modifiedAt: new Date().toISOString() }],
        },
      ],
    }, "http://127.0.0.1:3847");

    /* The renderer appends a single <section> at the end of brief.children. */
    assert.equal(brief.children.length, 1);
    const sectionWrapper = brief.children[0];
    const sectionHtml = sectionWrapper.innerHTML || "";
    /* The append path uses appendSection() which wraps in a div; pull
       the embedded section out for assertions. */
    const fullHtml = sectionWrapper.tagName === "SECTION"
      ? "<section " + Object.entries(sectionWrapper.attributes)
          .map(([k, v]) => `${k}="${v}"`).join(" ") + ">"
          + sectionHtml
        + "</section>"
      : sectionHtml;
    assert.match(fullHtml, /brief-materials/);
    assert.match(fullHtml, /Tailored Resume/);
    assert.match(fullHtml, /Cover Letter/);
    assert.match(fullHtml, /QA Report/);
    assert.match(fullHtml, /data-action="materials-preview"/);
    assert.match(fullHtml, /data-action="materials-download"/);
    assert.match(fullHtml, /\/api\/applications\/chartis-senior-digital-marketing-consultant\/files\/resume.pdf/);
    assert.match(fullHtml, /DERIVED/);
  });

  it("renderEmpty renders a single placeholder message", () => {
    const brief = makeBrief();
    api.renderEmpty(brief, { note: "Custom note" });
    assert.equal(brief.children.length, 1);
    const html = brief.children[0].innerHTML || "";
    assert.match(html, /Custom note/);
    assert.match(html, /brief-materials__empty/);
  });

  it("renderError marks the section as an error", () => {
    const brief = makeBrief();
    api.renderError(brief, "Server is down.");
    assert.equal(brief.children.length, 1);
    const cls = brief.children[0].attributes && brief.children[0].attributes.class;
    assert.ok(cls && cls.includes("brief-materials--error"));
  });

  it("re-rendering replaces the previous section instead of stacking", () => {
    const brief = makeBrief();
    api.renderEmpty(brief);
    api.renderEmpty(brief, { note: "Second pass" });
    /* After the second render the prior empty section should have been
       removed so we end up with exactly one materials section. */
    assert.equal(brief.children.length, 1);
    const html = brief.children[0].innerHTML || "";
    assert.match(html, /Second pass/);
  });
});
