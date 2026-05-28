/**
 * tests/dossier-card-attrs.test.mjs
 *
 * Contract test for the v2 .kanban-card[data-stable-key] data-* attributes
 * emitted by app.js renderKanbanCard, consumed by dawn-data.js view-models
 * (getRoleViewModel, getPipelineViewModel).
 *
 * Failure messages name the specific attribute / VM field so the swarm
 * conductor can route blame to Lane A (app.js emitter) vs Lane B (dawn-data
 * VM reader) vs Lane C (this test / docs).
 *
 * No jsdom / linkedom: we hand-roll a minimal DOM sufficient for dawn-data.js.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dawnDataSrc = readFileSync(join(repoRoot, "dawn-data.js"), "utf8");

/* ============================================================
   Minimal DOM mock — enough for dawn-data.js read paths.
   Supports CSS selectors of the forms:
     tag, .class, #id, [attr], [attr=value], [attr="value"]
     and any space-separated chain (descendant), and comma-separated
     OR groups. Also supports compound selectors like
     ".kanban-card[data-stable-key]" or
     "article.kanban-card.kanban-card--stage-applied".
   ============================================================ */

function makeElement(tagName) {
  const el = {
    tagName: String(tagName || "DIV").toUpperCase(),
    parentNode: null,
    children: [],
    _attrs: Object.create(null),
    _classList: [],
    textContent: "",
    value: "", // for textarea
    get className() { return this._classList.join(" "); },
    set className(v) {
      this._classList = String(v || "").trim().split(/\s+/).filter(Boolean);
    },
    setAttribute(name, value) {
      this._attrs[name] = String(value);
      if (name === "class") this.className = String(value);
      if (name === "id") this._attrs.id = String(value);
    },
    getAttribute(name) {
      if (!(name in this._attrs)) return null;
      return this._attrs[name];
    },
    hasAttribute(name) {
      return name in this._attrs;
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    querySelector(sel) {
      const r = querySelectorAll(this, sel, true);
      return r.length ? r[0] : null;
    },
    querySelectorAll(sel) {
      const list = querySelectorAll(this, sel, false);
      list.forEach = Array.prototype.forEach.bind(list);
      return list;
    },
  };
  // Mirror id for getElementById quick path
  Object.defineProperty(el, "id", {
    get() { return this._attrs.id || ""; },
    set(v) { this._attrs.id = String(v); },
  });
  return el;
}

function matchesSimple(el, simpleSel) {
  // simpleSel might be like: article.kanban-card.kanban-card--stage-applied[data-stable-key="A1"]
  const tokens = tokenizeSimple(simpleSel);
  for (const t of tokens) {
    if (t.kind === "tag") {
      if (el.tagName !== t.value.toUpperCase()) return false;
    } else if (t.kind === "class") {
      if (!el._classList.includes(t.value)) return false;
    } else if (t.kind === "id") {
      if (el._attrs.id !== t.value) return false;
    } else if (t.kind === "attr") {
      if (!(t.name in el._attrs)) return false;
      if (t.value !== undefined && el._attrs[t.name] !== t.value) return false;
    }
  }
  return true;
}

function tokenizeSimple(sel) {
  const tokens = [];
  let i = 0;
  const s = sel;
  // leading tag (optional)
  let m = /^([a-zA-Z][a-zA-Z0-9_-]*)/.exec(s.slice(i));
  if (m) { tokens.push({ kind: "tag", value: m[1] }); i += m[0].length; }
  while (i < s.length) {
    const ch = s[i];
    if (ch === ".") {
      m = /^\.([a-zA-Z_][\w-]*)/.exec(s.slice(i));
      if (!m) throw new Error("bad class selector: " + s);
      tokens.push({ kind: "class", value: m[1] });
      i += m[0].length;
    } else if (ch === "#") {
      m = /^#([a-zA-Z_][\w-]*)/.exec(s.slice(i));
      if (!m) throw new Error("bad id selector: " + s);
      tokens.push({ kind: "id", value: m[1] });
      i += m[0].length;
    } else if (ch === "[") {
      // [name] or [name=val] or [name="val"]
      const end = s.indexOf("]", i);
      if (end === -1) throw new Error("bad attr selector: " + s);
      const body = s.slice(i + 1, end);
      const eq = body.indexOf("=");
      if (eq === -1) {
        tokens.push({ kind: "attr", name: body.trim(), value: undefined });
      } else {
        const name = body.slice(0, eq).trim();
        let val = body.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        tokens.push({ kind: "attr", name, value: val });
      }
      i = end + 1;
    } else {
      throw new Error("unexpected char in selector: " + s + " at " + i);
    }
  }
  return tokens;
}

function querySelectorAll(root, selector, singleOnly) {
  // Split on commas at top level (no parens here so simple split works).
  const groups = selector.split(",").map((g) => g.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const group of groups) {
    // Split into descendant chain on whitespace
    const parts = group.split(/\s+/).filter(Boolean);
    const matches = matchChain(root, parts);
    for (const m of matches) {
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
        if (singleOnly) return out;
      }
    }
  }
  return out;
}

function matchChain(root, parts) {
  // Walk descendants. For each candidate, check it matches the last part,
  // then walk up ancestors to verify the preceding parts match in order.
  const lastSel = parts[parts.length - 1];
  const matches = [];
  walk(root, (el) => {
    if (el === root) return; // root itself not included
    if (!matchesSimple(el, lastSel)) return;
    if (parts.length === 1) { matches.push(el); return; }
    // Verify ancestor chain (in reverse, allowing skips)
    let ancestor = el.parentNode;
    let pi = parts.length - 2;
    while (ancestor && pi >= 0) {
      if (matchesSimple(ancestor, parts[pi])) pi--;
      ancestor = ancestor.parentNode;
    }
    if (pi < 0) matches.push(el);
  });
  return matches;
}

function walk(node, fn) {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

function makeDocument() {
  const doc = makeElement("DOCUMENT");
  const body = makeElement("BODY");
  doc.body = body;
  doc.appendChild(body);
  doc.getElementById = function (id) {
    let found = null;
    walk(doc, (el) => { if (el !== doc && el._attrs.id === id && !found) found = el; });
    return found;
  };
  // Convenient creator that auto-parses tag.class[attr=val] style
  doc.implementation = null; // dawn-data.js self-tests gate on .implementation
  return doc;
}

/** Convenience: append a kanban card element with arbitrary attrs + nested
 *  title/company spans. attrs.classes is a list of extra classes beyond
 *  "kanban-card".  */
function appendCard(doc, parent, attrs) {
  const card = makeElement("ARTICLE");
  card._classList = ["kanban-card"].concat(attrs.classes || []);
  for (const [k, v] of Object.entries(attrs.data || {})) {
    if (v == null) continue;
    card.setAttribute(k, String(v));
  }
  if (attrs.title) {
    const t = makeElement("SPAN");
    t._classList = ["kanban-card__title"];
    t.textContent = attrs.title;
    card.appendChild(t);
  }
  if (attrs.company) {
    const c = makeElement("SPAN");
    c._classList = ["kanban-card__company"];
    c.textContent = attrs.company;
    card.appendChild(c);
  }
  parent.appendChild(card);
  return card;
}

/* ============================================================
   Load dawn-data.js inside a vm sandbox with our fake DOM.
   ============================================================ */

function loadDawnData(doc) {
  const win = {};
  const context = {
    window: win,
    document: doc,
    console,
    // dawn-data.js never calls these but harmless to provide
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(dawnDataSrc, context, { filename: "dawn-data.js" });
  if (!win.JobBoredDawn || !win.JobBoredDawn.data) {
    throw new Error(
      "dawn-data.js did not expose JobBoredDawn.data on window — Lane B " +
      "(dawn-data view-model) may have broken the export contract",
    );
  }
  return win.JobBoredDawn.data;
}

/* ============================================================
   Tests
   ============================================================ */

describe("v2 kanban-card data-* attributes → dossier view-model", () => {
  it("round-trip: every documented attribute lands in getRoleViewModel", () => {
    const doc = makeDocument();
    appendCard(doc, doc.body, {
      classes: ["kanban-card--stage-applied"],
      title: "Senior Backend",
      company: "Cyberdyne",
      data: {
        "data-stable-key": "K",
        "data-index": "0",
        "data-jd-snippet":
          "We need a senior backend engineer.\n\nRequirements:\n- Go\n- Postgres\n- Kubernetes",
        "data-notes": "Recruiter said headcount is open.",
        "data-location": "Remote (US)",
        "data-salary": "$180k–$220k",
        "data-job-url": "https://example.com/jobs/42",
        "data-source": "Greenhouse",
        "data-applied-at": "2026-04-21T12:00:00Z",
        "data-follow-up": "2026-05-15",
        "data-tags": "go,postgres,kubernetes",
        "data-fit": "8",
        "data-replied": "yes",
        "data-talking-points": "bullet a;bullet b;bullet c",
        "data-contacts": JSON.stringify([{ name: "Dana Ng" }]),
        "data-company-tagline": "We build cybernetic systems.",
        "data-employment": "Full-time",
        "data-ats-fit-score": "84",
        "data-ats-fit-rationale": "Strong backend platform match; leadership evidence is thin.",
      },
    });

    const api = loadDawnData(doc);
    const vm = api.getRoleViewModel("K", {
      doc,
      nowMs: Date.parse("2026-05-01T12:00:00Z"),
    });
    const job = vm && vm.job;
    assert.ok(job, "getRoleViewModel returned no job (Lane B: VM shape)");

    assert.equal(
      job.jobKey, "K",
      "VM.job.jobKey mismatch — Lane B getRoleViewModel did not propagate data-stable-key",
    );
    assert.equal(
      job.role, "Senior Backend",
      "VM.job.role mismatch — Lane B did not read .kanban-card__title",
    );
    assert.equal(
      job.company, "Cyberdyne",
      "VM.job.company mismatch — Lane B did not read .kanban-card__company",
    );
    assert.ok(
      typeof job.jdSnippet === "string" && job.jdSnippet.length > 0,
      "VM.job.jdSnippet empty — Lane A may have omitted data-jd-snippet, or Lane B is not reading it",
    );
    assert.ok(
      job.notes && typeof job.notes.body === "string" && job.notes.body.includes("headcount"),
      "VM.job.notes.body missing — data-notes attr → notes.body wiring broken",
    );
    assert.equal(
      job.location, "Remote (US)",
      "VM.job.location mismatch — data-location not propagated",
    );
    assert.equal(
      job.salary, "$180k–$220k",
      "VM.job.salary mismatch — data-salary not propagated",
    );
    assert.ok(Array.isArray(job.links), "VM.job.links must be an array");
    assert.ok(
      job.links.length >= 1 && job.links[0].href === "https://example.com/jobs/42",
      "VM.job.links[0].href mismatch — data-job-url not surfaced as primary link",
    );
    assert.equal(
      job.source, "Greenhouse",
      "VM.job.source mismatch — data-source not propagated",
    );
    assert.equal(
      job.appliedAt, "2026-04-21T12:00:00Z",
      "VM.job.appliedAt mismatch — data-applied-at not propagated",
    );
    assert.ok(
      job.deadline && job.deadline.dueDate === "2026-05-15",
      "VM.job.deadline.dueDate mismatch — data-follow-up not parsed into deadline",
    );
    assert.ok(
      Array.isArray(job.tags) && job.tags.length === 3,
      "VM.job.tags should have 3 entries — data-tags CSV not split correctly (got " +
        JSON.stringify(job.tags) + ")",
    );
    assert.ok(
      typeof job.fitScore === "number" && job.fitScore >= 1 && job.fitScore <= 10,
      "VM.job.fitScore must be clamped 1–10 number — data-fit not normalized (got " +
        job.fitScore + ")",
    );
    assert.ok(
      Array.isArray(job.contacts) && job.contacts.length === 1 &&
        job.contacts[0].name === "Dana Ng",
      "VM.job.contacts[0].name mismatch — data-contacts JSON not parsed (got " +
        JSON.stringify(job.contacts) + ")",
    );
    assert.equal(
      job.companyTagline, "We build cybernetic systems.",
      "VM.job.companyTagline mismatch — data-company-tagline not propagated",
    );
    assert.equal(
      job.employment, "Full-time",
      "VM.job.employment mismatch — data-employment not propagated",
    );
    assert.equal(
      job.enrichment.atsFitScore,
      84,
      "VM.job.enrichment.atsFitScore mismatch — data-ats-fit-score not propagated",
    );
    assert.equal(
      job.enrichment.atsFitRationale,
      "Strong backend platform match; leadership evidence is thin.",
      "VM.job.enrichment.atsFitRationale mismatch — data-ats-fit-rationale not propagated",
    );
  });

  it("empty omission: card with only data-stable-key + title + company yields sane defaults", () => {
    const doc = makeDocument();
    appendCard(doc, doc.body, {
      classes: ["kanban-card--stage-new"],
      title: "Junior Eng",
      company: "Stark",
      data: { "data-stable-key": "BARE", "data-index": "0" },
    });

    const api = loadDawnData(doc);
    const vm = api.getRoleViewModel("BARE", { doc });
    const job = vm.job;

    assert.equal(
      job.notes, null,
      "VM.job.notes should be null when data-notes is omitted (Lane B should not fabricate a notes object)",
    );
    assert.equal(
      job.location, "",
      "VM.job.location should be '' when data-location omitted (got " +
        JSON.stringify(job.location) + ")",
    );
    assert.equal(
      job.salary, null,
      "VM.job.salary should be null when data-salary omitted (got " +
        JSON.stringify(job.salary) + ")",
    );
    assert.ok(
      Array.isArray(job.tags) || (job.tags && typeof job.tags.length === "number"),
      "VM.job.tags must be array-like",
    );
    assert.equal(
      job.tags.length, 0,
      "VM.job.tags should be empty when data-tags omitted (got " +
        JSON.stringify(job.tags) + ")",
    );
    assert.equal(
      job.contacts.length, 0,
      "VM.job.contacts should be empty when data-contacts omitted (got " +
        JSON.stringify(job.contacts) + ")",
    );
    assert.equal(
      job.deadline, null,
      "VM.job.deadline should be null when data-follow-up/data-deadline omitted (got " +
        JSON.stringify(job.deadline) + ")",
    );
    // links: only the synthesized data-job-url path adds entries; with no
    // data-job-url and no anchors in the card, expect 0 entries
    assert.equal(
      job.links.length, 0,
      "VM.job.links should be empty when data-job-url omitted and no <a> in card (got " +
        JSON.stringify(job.links) + ")",
    );
  });

  it("data-replied=\"yes\" drives the pipeline `reply` flag; absence does not", () => {
    const doc = makeDocument();
    appendCard(doc, doc.body, {
      classes: ["kanban-card--stage-applied"],
      title: "Lead",
      company: "Vandelay",
      data: {
        "data-stable-key": "WITH_REPLY",
        "data-index": "0",
        "data-replied": "yes",
        "data-applied-at": "2026-04-25T00:00:00Z",
      },
    });
    appendCard(doc, doc.body, {
      classes: ["kanban-card--stage-applied"],
      title: "Lead",
      company: "Initech",
      data: {
        "data-stable-key": "NO_REPLY",
        "data-index": "1",
        "data-applied-at": "2026-04-25T00:00:00Z",
      },
    });

    const api = loadDawnData(doc);
    const pipe = api.getPipelineViewModel({
      doc,
      nowMs: Date.parse("2026-05-01T00:00:00Z"),
    });
    const applied = pipe.stages.find((s) => s.key === "applied");
    assert.ok(applied, "pipeline VM missing `applied` stage — Lane B PIPELINE_STAGES drift");

    const withReply = applied.cards.find((c) => c.jobKey === "WITH_REPLY");
    const noReply = applied.cards.find((c) => c.jobKey === "NO_REPLY");
    assert.ok(withReply, "WITH_REPLY card not found in applied stage");
    assert.ok(noReply, "NO_REPLY card not found in applied stage");
    assert.equal(
      withReply.flag, "reply",
      "data-replied=\"yes\" must produce flag === \"reply\" (got " +
        JSON.stringify(withReply.flag) +
        ") — Lane A may not be emitting data-replied, or Lane B computeFlag is wrong",
    );
    assert.notEqual(
      noReply.flag, "reply",
      "card without data-replied must NOT have flag === \"reply\" (got " +
        JSON.stringify(noReply.flag) + ")",
    );
  });

  it("Date Found freshness reaches every pipeline card for Newest sorting", () => {
    const doc = makeDocument();
    appendCard(doc, doc.body, {
      classes: ["kanban-card--stage-new"],
      title: "Fresh Discovery",
      company: "Initrode",
      data: {
        "data-stable-key": "DISCOVERED",
        "data-index": "7",
        "data-found-at": "2026-05-28",
      },
    });
    appendCard(doc, doc.body, {
      classes: ["kanban-card--stage-applied"],
      title: "Fresh Applied",
      company: "Initech",
      data: {
        "data-stable-key": "APPLIED",
        "data-index": "8",
        "data-found-at": "2026-05-27",
      },
    });

    const api = loadDawnData(doc);
    const pipe = api.getPipelineViewModel({ doc });
    const discovered = pipe.untriaged.find((c) => c.jobKey === "DISCOVERED");
    const appliedStage = pipe.stages.find((s) => s.key === "applied");
    const applied = appliedStage && appliedStage.cards.find((c) => c.jobKey === "APPLIED");

    assert.ok(discovered, "DISCOVERED card not found in untriaged pipeline cards");
    assert.ok(applied, "APPLIED card not found in applied pipeline cards");
    assert.equal(
      discovered.foundAt,
      "2026-05-28",
      "untriaged pipeline cards must retain Date Found for freshness sorting",
    );
    assert.equal(
      discovered.index,
      7,
      "untriaged pipeline cards must retain row index as the freshness fallback",
    );
    assert.equal(
      applied.foundAt,
      "2026-05-27",
      "stage pipeline cards must retain Date Found for freshness sorting",
    );
    assert.equal(
      applied.index,
      8,
      "stage pipeline cards must retain row index as the freshness fallback",
    );
  });

  it("talking-points fallback: data-talking-points becomes a jdSections bullet block when no JD snippet", () => {
    const doc = makeDocument();
    appendCard(doc, doc.body, {
      classes: ["kanban-card--stage-applied"],
      title: "PM",
      company: "Pied Piper",
      data: {
        "data-stable-key": "TP",
        "data-index": "0",
        "data-talking-points": "bullet a;bullet b;bullet c",
      },
    });

    const api = loadDawnData(doc);
    const vm = api.getRoleViewModel("TP", { doc });
    const job = vm.job;

    assert.ok(
      Array.isArray(job.jdSections),
      "VM.job.jdSections must be an array",
    );
    const haveTriBullet = job.jdSections.some(
      (s) => Array.isArray(s.bullets) && s.bullets.length === 3,
    );
    assert.ok(
      haveTriBullet,
      "Expected at least one jdSection with bullets.length === 3 when " +
        "data-talking-points carries 3 ';'-separated points and data-jd-snippet " +
        "is omitted. Lane B getRoleViewModel may not be honoring the " +
        "data-talking-points fallback. Sections seen: " +
        JSON.stringify(job.jdSections),
    );
  });
});
