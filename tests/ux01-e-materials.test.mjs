/* ============================================================
   ux01-e-materials.test.mjs — UX01 lane E, role-materials.js.
   C11  the draft carries the user's resume, stops at a gate without
        one, and honours the server's 422 resume_required.
   C12  a down server never shows "queued"; one click drafts;
        auto-draft is opt-in and announces itself; 3-minute stall.
   C13  review rows show the flag; the QA report opens inline.
   C16  back from View posting asks "Did you apply to <company>?".
   The DOM is a minimal vm shim (no jsdom in this repo): nodes keep
   innerHTML verbatim and the tests read what was painted.
   ============================================================ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options ? options.detail : undefined;
  }
}

function makeBus() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((h) => h !== fn)); },
    dispatchEvent(ev) { for (const fn of (listeners.get(ev.type) || []).slice()) fn(ev); return true; },
  };
}

function makeNode(tag, attrs = {}) {
  let html = "";
  const childNodes = [];
  const attributes = { ...attrs };
  const bus = makeBus();
  const node = {
    tagName: String(tag).toUpperCase(),
    childNodes,
    parentNode: null,
    className: "",
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    style: {},
    setAttribute(k, v) { attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attributes, k) ? attributes[k] : null; },
    removeAttribute(k) { delete attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attributes, k); },
    ...bus,
    appendChild(c) { c.parentNode = node; childNodes.push(c); return c; },
    insertBefore(c) { c.parentNode = node; childNodes.push(c); return c; },
    removeChild(c) { const i = childNodes.indexOf(c); if (i >= 0) childNodes.splice(i, 1); c.parentNode = null; return c; },
    remove() { if (node.parentNode) node.parentNode.removeChild(node); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v == null ? "" : v); },
    get textContent() { return html.replace(/<[^>]+>/g, ""); },
    set textContent(v) { html = String(v); },
    get firstElementChild() {
      if (!html) return null;
      const child = makeNode("section");
      child.innerHTML = html;
      return child;
    },
    scrollIntoView() {},
    focus() {},
  };
  return node;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  /* A real response parses a fresh object every time; sharing one would let a
     caller's mutation leak into the next "fetch". */
  return { ok, status, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) };
}

const JOB = { company: "Kestrel", role: "Staff Frontend Engineer", links: [{ href: "https://jobs.test/kestrel" }], source: "Greenhouse" };
const SLUG = "kestrel-staff-frontend-engineer";
const RESUME = { id: "primary", source: "file", label: "alex-rivera-resume.pdf", extractedText: "Alex Rivera — Staff engineer. Led the design system migration.", createdAt: "2026-09-25T10:00:00.000Z" };

function load({
  resume = RESUME,
  userContent = true,
  serverDown = false,
  requestResponse,
  manifest = { slug: SLUG, documents: [], pending: null },
  storage = {},
  submission,
} = {}) {
  const docBus = makeBus();
  const winBus = makeBus();
  const fetchCalls = [];
  const toasts = [];
  let mount = makeNode("div", { "data-mount": "materials" });
  const region = makeNode("section");
  region.querySelector = (sel) => (sel === '[data-mount="materials"]' ? mount : null);
  const body = makeNode("body");
  body.classList = { contains: (c) => c === "jb-v2", add() {}, remove() {} };
  const store = new Map(Object.entries(storage));
  const documentEl = {
    ...docBus,
    body,
    readyState: "complete",
    visibilityState: "visible",
    createElement: (t) => makeNode(t),
    querySelector: (sel) => (sel === '[data-region="role"]' ? region : null),
    querySelectorAll: () => [],
  };
  const windowEl = {
    ...winBus,
    document: documentEl,
    CustomEvent: TestCustomEvent,
    location: { hostname: "localhost", hash: "" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    queueMicrotask: (fn) => fn(),
    getJobPostingScrapeUrl: () => "http://127.0.0.1:3847",
    JobBoredDawn: { data: { getRoleViewModel: () => ({ job: JOB }) } },
    JobBored: { getSheetId: () => "s", getPipelineJobs: () => [{ ...JOB, status: "Researching" }] },
    getPipelineJobByIndex: () => JOB,
    JobBoredFlowing: { openRole: { get: () => "7" } },
    showToast: (msg, type) => toasts.push({ msg, type }),
  };
  if (userContent) {
    windowEl.CommandCenterUserContent = { getActiveResume: async () => resume };
  }
  if (submission) windowEl.JobBoredSubmission = submission;
  const ctx = vm.createContext({
    window: windowEl,
    document: documentEl,
    CustomEvent: TestCustomEvent,
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {},
    encodeURIComponent,
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (serverDown) throw new TypeError("Failed to fetch");
      if (/\/request$/.test(url) && options.method === "POST") {
        if (requestResponse) return requestResponse;
        return jsonResponse({ ok: true, slug: SLUG });
      }
      if (/\/manifest$/.test(url)) return jsonResponse(manifest);
      if (/\/job-description$/.test(url) && !options.method) return jsonResponse({ exists: true });
      if (/\/api\/applications$/.test(url)) return jsonResponse({ applications: [{ slug: SLUG, company: "Kestrel", title: "Staff Frontend Engineer" }] });
      if (/\.md(\?|$)/.test(url)) return { ok: true, status: 200, text: async () => "# QA report\n\n- Runs to 2 pages" };
      return jsonResponse({ ok: true });
    },
    Promise, Date, Number, Math, Array, Object, String, JSON, Map, Set, Error, TypeError,
  });
  for (const f of ["jb-text.js", "role-case-model.js", "role-materials.js"]) vm.runInContext(read(f), ctx, { filename: f });
  const html = () => mount.childNodes.map((c) => c.innerHTML).join("\n");
  const lastHtml = () => (mount.childNodes.length ? mount.childNodes[mount.childNodes.length - 1].innerHTML : "");
  const requestPosts = () => fetchCalls.filter((c) => /\/request$/.test(c.url) && c.options.method === "POST");
  return {
    get mount() { return mount; },
    /* What role.js does on jb:materials:manifest: a Case render replaces the
       materials mount with a fresh element. */
    replaceMountOnStateEvents() {
      winBus.addEventListener("jb:materials:manifest", (e) => {
        if (e.detail && e.detail.reason === "state") mount = makeNode("div", { "data-mount": "materials" });
      });
    },
    api: windowEl.JobBoredRoleMaterials, windowEl, documentEl, body, html, lastHtml, fetchCalls, requestPosts, toasts, store,
    draft(action = "resume-cover") {
      documentEl.dispatchEvent(new TestCustomEvent("jb:role:action", { detail: { action, jobKey: "7" } }));
    },
    open() { windowEl.dispatchEvent(new TestCustomEvent("jb:role:opened", { detail: { jobKey: "7" } })); },
  };
}

async function settle() {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("C11 · drafts come from the user's resume", () => {
  it("should send the active resume with the request", async () => {
    const h = load();
    h.open();
    await settle();
    h.draft();
    await settle();
    const posts = h.requestPosts();
    assert.equal(posts.length, 1, "one click drafts: no notes form in between");
    const body = JSON.parse(posts[0].options.body);
    assert.deepEqual(body.resume, {
      source: "file",
      filename: "alex-rivera-resume.pdf",
      addedAt: "2026-09-25T10:00:00.000Z",
      text: RESUME.extractedText,
    });
  });

  it("should stop at 'Add your resume first' when none is on file", async () => {
    const h = load({ resume: null });
    h.open();
    await settle();
    h.draft();
    await settle();
    assert.equal(h.requestPosts().length, 0);
    assert.match(h.lastHtml(), /Add your resume first/);
    assert.match(h.lastHtml(), /data-action="open-resume"/);
    assert.doesNotMatch(h.lastHtml(), /queued/i);
  });

  it("should show the gate when the server answers 422 resume_required", async () => {
    const h = load({
      requestResponse: jsonResponse({ code: "resume_required", message: "Add your resume before drafting." }, { ok: false, status: 422 }),
    });
    h.open();
    await settle();
    h.draft();
    await settle();
    assert.match(h.lastHtml(), /Add your resume first/);
  });

  it("should still draft when the page has no resume store to ask (today's server decides)", async () => {
    const h = load({ userContent: false });
    h.open();
    await settle();
    h.draft();
    await settle();
    assert.equal(h.requestPosts().length, 1);
    assert.equal(JSON.parse(h.requestPosts()[0].options.body).resume, undefined);
  });

  it("should say which resume the drafts came from", async () => {
    const h = load();
    const manifest = {
      slug: SLUG,
      resume: { filename: "alex-rivera-resume.pdf", addedAt: "2026-09-25T10:00:00.000Z" },
      documents: [{ type: "resume", status: "ready", lastModifiedAt: "2026-09-25T11:00:00Z", files: [{ filename: "resume.pdf", format: "pdf" }] }],
      pending: null,
    };
    h.api.renderManifest(h.mount, manifest, "http://127.0.0.1:3847");
    assert.match(h.lastHtml(), /Drafted from <b>alex-rivera-resume\.pdf<\/b>, added 2026-09-25/);
  });
});

describe("C11 · a render during the load never loses the rows", () => {
  it("should paint into the mount that exists when the fetch lands, not the one it started with", async () => {
    const h = load({ resume: null });
    h.replaceMountOnStateEvents();
    const first = h.mount;
    h.open();
    await settle();
    assert.notEqual(h.mount, first, "the resume read re-rendered the Case");
    assert.ok(h.mount.childNodes.length > 0, "the fresh mount must carry the materials state");
  });
});

describe("C12 · drafting states match reality", () => {
  it("should say the server isn't running, with the command and a Retry, and never 'queued'", async () => {
    const h = load({ serverDown: true });
    h.open();
    await settle();
    assert.equal(h.api.getServerState(), "down");
    assert.match(h.lastHtml(), /Drafting server not running/);
    assert.match(h.lastHtml(), /npm start/);
    assert.match(h.lastHtml(), /data-action="materials-server-retry"/);
    h.draft();
    await settle();
    assert.equal(h.requestPosts().length, 0);
    assert.doesNotMatch(h.html(), /queued/i);
  });

  it("should not auto-draft on a move to Researching unless the user opted in", async () => {
    const h = load();
    h.documentEl.dispatchEvent(new TestCustomEvent("jb:write:succeeded", {
      detail: { kind: "pipeline:move", jobKey: "7", fromStage: "new", toStage: "researching" },
    }));
    await settle();
    assert.equal(h.requestPosts().length, 0);
  });

  it("should announce an opted-in auto-draft", async () => {
    const h = load({ storage: { "jobBored:autoDraft:v1": "on" } });
    h.documentEl.dispatchEvent(new TestCustomEvent("jb:write:succeeded", {
      detail: { kind: "pipeline:move", jobKey: "7", fromStage: "new", toStage: "researching" },
    }));
    await settle();
    assert.equal(h.requestPosts().length, 1);
    assert.ok(h.toasts.some((t) => /Drafting resume \+ letter for Staff Frontend Engineer/.test(t.msg)), JSON.stringify(h.toasts));
  });

  it("should say a draft is taking longer than usual after 3 minutes", () => {
    const h = load();
    const started = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    h.api.renderManifest(h.mount, {
      slug: SLUG, documents: [],
      pending: { feature: "cover_letter", progress: { phase: "drafting", startedAt: started, attempt: 1 } },
    }, "http://127.0.0.1:3847");
    assert.match(h.lastHtml(), /Taking longer than usual/);
  });

  it("should not raise the stall notice inside the first 3 minutes", () => {
    const h = load();
    const started = new Date(Date.now() - 60 * 1000).toISOString();
    h.api.renderManifest(h.mount, {
      slug: SLUG, documents: [],
      pending: { feature: "cover_letter", progress: { phase: "drafting", startedAt: started, attempt: 1 } },
    }, "http://127.0.0.1:3847");
    assert.doesNotMatch(h.lastHtml(), /Taking longer than usual/);
  });
});

describe("C13 · review rows and the QA report", () => {
  const MANIFEST = {
    slug: SLUG,
    documents: [
      { type: "resume", status: "ready", lastModifiedAt: "2026-09-25T11:00:00Z", files: [{ filename: "resume.pdf", format: "pdf" }, { filename: "resume.html", format: "html" }] },
      { type: "qa_report", status: "ready", lastModifiedAt: "2026-09-25T11:00:00Z", files: [{ filename: "qa-report.md", format: "md" }] },
    ],
    quality: { documents: { resume: { issues: [{ message: "Runs to 2 pages. Trim to 1." }, { message: "Second flag." }] } } },
    pending: null,
  };

  it("should show a flagged document as review with its first flag", () => {
    const h = load();
    h.api.renderManifest(h.mount, MANIFEST, "http://127.0.0.1:3847");
    const out = h.lastHtml();
    assert.match(out, /case__docst--review" data-status="review">review · 2 flags</);
    assert.match(out, /Runs to 2 pages\. Trim to 1\. \+1 more/);
  });

  it("should offer Open on the QA report so it reads inline", () => {
    const h = load();
    h.api.renderManifest(h.mount, MANIFEST, "http://127.0.0.1:3847");
    assert.match(h.lastHtml(), /data-action="materials-open-md"[^>]*data-filename="qa-report\.md"[^>]*>Open</);
  });
});

describe("C16 · back from the posting, ask whether they applied", () => {
  it("should ask 'Did you apply to Kestrel?' when the tab comes back, and prefill the source", async () => {
    const calls = [];
    const h = load({ submission: { confirmApplied: async (jobKey, ctx) => { calls.push({ jobKey, ctx }); return { confirmed: true }; } } });
    h.api.noteViewPosting("7");
    h.documentEl.visibilityState = "hidden";
    h.documentEl.dispatchEvent(new TestCustomEvent("visibilitychange"));
    h.documentEl.visibilityState = "visible";
    h.documentEl.dispatchEvent(new TestCustomEvent("visibilitychange"));
    const prompt = h.body.childNodes.find((n) => /Did you apply to Kestrel\?/.test(n.innerHTML));
    assert.ok(prompt, "the return prompt must render");
    await h.api.answerReturnPrompt(true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].jobKey, "7");
    assert.equal(calls[0].ctx.source, "Greenhouse");
    assert.equal(calls[0].ctx.prefill.source, "Greenhouse");
  });

  it("should not ask when the user never left through View posting", () => {
    const h = load({ submission: { confirmApplied: async () => ({}) } });
    h.documentEl.visibilityState = "visible";
    h.documentEl.dispatchEvent(new TestCustomEvent("visibilitychange"));
    assert.equal(h.body.childNodes.length, 0);
  });
});
