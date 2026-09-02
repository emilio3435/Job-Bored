/**
 * role-materials owns the materials manifest for the dossier: it resolves
 * its own mount ([data-mount="materials"], falling back to the legacy
 * [data-mount="brief"]), announces every manifest it renders on
 * jb:materials:manifest, and exposes the last one through
 * getCurrentManifest() so the Case model can read it without re-fetching.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "role-materials.js"), "utf8");
/* Trap 2: jb-text.js before role-case-model.js. The Case's mount renders
   compact rows built from the model's CASE_DOC_TYPES, so the real model has
   to be present or the rows silently degrade to the legacy panel. */
const caseSources = ["jb-text.js", "role-case-model.js"].map((f) => ({
  filename: f,
  code: readFileSync(join(repoRoot, f), "utf8"),
}));

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options ? options.detail : undefined;
    this.bubbles = !!(options && options.bubbles);
  }
}

function makeEventTarget(events) {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      listeners.set(
        type,
        arr.filter((h) => h !== fn),
      );
    },
    dispatchEvent(event) {
      events.push(event);
      for (const fn of (listeners.get(event.type) || []).slice()) fn(event);
      return true;
    },
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Concatenated innerHTML of a node's appended children — appendSection
 *  mounts the panel as a child node, so the host's own innerHTML stays "". */
function renderedHtml(node) {
  return (node.childNodes || []).map((c) => c.innerHTML || "").join("");
}

function makeNode(tagName, attributes) {
  let html = "";
  const attrs = { ...(attributes || {}) };
  const childNodes = [];
  const node = {
    tagName,
    childNodes,
    parentNode: null,
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle() {},
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) {
      child.parentNode = node;
      childNodes.push(child);
      return child;
    },
    removeChild(child) {
      const i = childNodes.indexOf(child);
      if (i >= 0) childNodes.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    querySelector(sel) {
      if (sel === "." + "brief-materials") {
        return /class="brief-materials/.test(html) ? makeNode("section") : null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v == null ? "" : v); },
    get firstElementChild() {
      if (!html) return null;
      const child = makeNode("section");
      child.innerHTML = html;
      child.parentNode = node;
      return child;
    },
    scrollIntoView() {},
    focus() {},
  };
  return node;
}

const MANIFEST = {
  slug: "meridian-labs-product-manager",
  company: "Meridian Labs",
  title: "Product Manager",
  documents: [
    {
      type: "resume",
      label: "Tailored Resume",
      status: "ready",
      primary: "resume.pdf",
      lastModifiedAt: "2026-08-31T15:00:00.000Z",
      files: [
        { filename: "resume.pdf", format: "pdf", size: 354257, modifiedAt: "2026-08-31T15:00:00.000Z" },
        { filename: "resume.html", format: "html", size: 28890, modifiedAt: "2026-08-31T15:00:00.000Z" },
      ],
    },
    {
      type: "cover_letter",
      label: "Cover Letter",
      status: "ready",
      primary: "cover-letter.pdf",
      lastModifiedAt: "2026-08-31T15:00:00.000Z",
      files: [
        { filename: "cover-letter.pdf", format: "pdf", size: 293275, modifiedAt: "2026-08-31T15:00:00.000Z" },
      ],
    },
  ],
  pending: null,
};

/**
 * @param {{ mounts?: string[], manifest?: object }} opts
 *   `mounts` names the [data-mount="…"] hosts the dossier rendered, in
 *   DOM order — ["brief"] is the legacy dossier, ["materials", "brief"]
 *   is the Case rendering its own mount alongside the old one.
 */
function bootMaterials({ mounts = ["brief"], manifest = MANIFEST } = {}) {
  const events = [];
  const documentBus = makeEventTarget(events);
  const windowBus = makeEventTarget(events);
  const mountEls = new Map(mounts.map((name) => [name, makeNode("div", { "data-mount": name })]));
  const region = makeNode("section");
  region.querySelector = (sel) => {
    const m = /^\[data-mount="([^"]+)"\]$/.exec(sel);
    if (m) return mountEls.get(m[1]) || null;
    return null;
  };
  const documentEl = {
    ...documentBus,
    body: { classList: { contains: (n) => n === "jb-v2" } },
    readyState: "complete",
    createElement: () => makeNode("div"),
    querySelector(sel) {
      if (sel === '[data-region="role"]') return region;
      return null;
    },
    querySelectorAll: () => [],
  };
  const job = {
    company: "Meridian Labs",
    role: "Product Manager",
    links: [{ href: "https://jobs.meridian.test/pm" }],
  };
  const windowEl = {
    ...windowBus,
    document: documentEl,
    CustomEvent: TestCustomEvent,
    location: { hostname: "localhost", hash: "" },
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    queueMicrotask: (fn) => fn(),
    getJobPostingScrapeUrl: () => "http://127.0.0.1:3847",
    JobBoredDawn: { data: { getRoleViewModel: () => ({ job }) } },
    JobBored: { getSheetId: () => "test-sheet", getPipelineJobs: () => [] },
    JobBoredFlowing: { openRole: { get: () => null } },
  };
  const ctx = vm.createContext({
    window: windowEl,
    document: documentEl,
    CustomEvent: TestCustomEvent,
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    encodeURIComponent,
    fetch: async (url) => {
      if (/\/api\/applications$/.test(url)) {
        return jsonResponse({ applications: [{ slug: manifest.slug }] });
      }
      if (/\/manifest$/.test(url)) return jsonResponse(manifest);
      return jsonResponse({ ok: true });
    },
    Promise,
    Date,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
  });
  for (const { filename, code } of caseSources) vm.runInContext(code, ctx, { filename });
  vm.runInContext(source, ctx, { filename: "role-materials.js" });

  async function openRole(jobKey) {
    windowEl.JobBoredFlowing.openRole.get = () => jobKey;
    windowEl.dispatchEvent(
      new TestCustomEvent("jb:role:opened", { detail: { jobKey } }),
    );
    for (let i = 0; i < 80; i++) await Promise.resolve();
  }
  async function closeRole() {
    windowEl.JobBoredFlowing.openRole.get = () => null;
    windowEl.dispatchEvent(new TestCustomEvent("jb:role:closed", { detail: {} }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  return {
    api: windowEl.JobBoredRoleMaterials,
    win: windowEl,
    region,
    mountEls,
    events,
    openRole,
    closeRole,
  };
}

describe("materials manifest ownership", () => {
  it("dispatches jb:materials:manifest and exposes getCurrentManifest after a render", async () => {
    const { api, events, openRole } = bootMaterials();
    await openRole("job-1");
    const announced = events.filter((e) => e.type === "jb:materials:manifest");
    assert.ok(announced.length, "expected a jb:materials:manifest dispatch");
    assert.equal(announced[0].detail.jobKey, "job-1");
    assert.equal(announced[0].detail.manifest.slug, MANIFEST.slug);
    const cur = api.getCurrentManifest();
    assert.equal(cur.manifest.slug, MANIFEST.slug);
    assert.equal(cur.jobKey, "job-1");
    assert.equal(cur.base, "http://127.0.0.1:3847");
  });

  it("prefers [data-mount=materials] when the case renders one", async () => {
    const { mountEls, openRole } = bootMaterials({ mounts: ["materials", "brief"] });
    await openRole("job-1");
    /* The Case mount gets compact rows (plan Task 9), not the panel's cards. */
    assert.match(
      renderedHtml(mountEls.get("materials")),
      /class="case__doc" data-doc="resume"/,
      "the rendered document rows must land in the materials mount",
    );
    assert.equal(
      renderedHtml(mountEls.get("brief")),
      "",
      "the legacy brief mount must stay empty once a materials mount exists",
    );
  });

  it("rehydrateOpenRole repaints the last manifest into a fresh mount without dispatching", async () => {
    const { api, events, mountEls, openRole } = bootMaterials({ mounts: ["materials", "brief"] });
    await openRole("job-1");
    const announced = () => events.filter((e) => e.type === "jb:materials:manifest").length;
    const before = announced();
    /* Simulate the Case rebuilding its region: the mount comes back empty. */
    const mount = mountEls.get("materials");
    mount.childNodes.length = 0;
    assert.equal(renderedHtml(mount), "");
    api.rehydrateOpenRole();
    assert.match(renderedHtml(mount), /class="case__doc" data-doc="resume"/, "rows must be repainted");
    assert.equal(announced(), before, "rehydrate must not re-dispatch jb:materials:manifest");
  });

  /* P0-0b: switching straight from role A to role B never fires
     jb:role:closed, so the module-global lastPaint stayed role A's. The Case
     rebuilt its region for B, role.js asked for a repaint, and B's Materials
     lane filled with A's files and download links. */
  it("never repaints the previous role's rows after a direct role switch", async () => {
    const { api, win, mountEls, openRole } = bootMaterials({ mounts: ["materials", "brief"] });
    await openRole("job-1");
    const mount = mountEls.get("materials");
    assert.match(renderedHtml(mount), /class="case__doc" data-doc="resume"/, "role A painted its rows");

    /* Role B opens directly: no jb:role:closed, and its own load has not
       landed yet when the Case rebuilds the mount. */
    win.JobBoredFlowing.openRole.get = () => "job-2";
    mount.childNodes.length = 0;
    api.rehydrateOpenRole();
    assert.equal(renderedHtml(mount), "", "role A's rows must not paint under role B");

    /* And the guard is not a blanket refusal: A's own repaint still works. */
    win.JobBoredFlowing.openRole.get = () => "job-1";
    api.rehydrateOpenRole();
    assert.match(renderedHtml(mount), /class="case__doc" data-doc="resume"/);
  });

  it("still renders into the legacy brief mount when no materials mount exists", async () => {
    const { mountEls, openRole } = bootMaterials({ mounts: ["brief"] });
    await openRole("job-1");
    assert.match(renderedHtml(mountEls.get("brief")), /data-doc-type="resume"/);
  });

  it("clears the current manifest when the role closes", async () => {
    const { api, openRole, closeRole } = bootMaterials();
    await openRole("job-1");
    assert.ok(api.getCurrentManifest());
    await closeRole();
    assert.equal(api.getCurrentManifest(), null);
  });
});
