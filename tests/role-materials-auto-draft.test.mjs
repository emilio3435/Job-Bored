/**
 * Regression tests for the kanban -> Hermes auto-request bridge.
 *
 * Moving a job from Discovered/New to Researching should enqueue one
 * combined resume + cover-letter request only after the sheet write
 * succeeds, and should not duplicate existing pending/ready packages.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "role-materials.js"), "utf8");

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
      listeners.set(type, arr.filter((h) => h !== fn));
    },
    dispatchEvent(event) {
      events.push(event);
      const arr = listeners.get(event.type) || [];
      for (const fn of arr.slice()) fn(event);
      return true;
    },
    _listeners: listeners,
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

function loadAutoDraftHarness({
  job,
  manifestResponse,
  applications,
  pipelineJobs,
  localStorageState,
  jobDescriptionExists = true,
  scrapeResponse,
} = {}) {
  const events = [];
  const fetchCalls = [];
  const documentBus = makeEventTarget(events);
  const windowBus = makeEventTarget(events);
  const storage = new Map(Object.entries(localStorageState || {}));
  const body = {
    classList: {
      contains(name) { return name === "jb-v2"; },
    },
  };
  const resolvedJob = job || {
    company: "321 The Agency",
    role: "Director of Digital Marketing",
    links: [{ href: "https://dynamitejobs.com/company/321theagency/remote-job/director-of-digital-marketing" }],
  };
  const documentEl = {
    ...documentBus,
    body,
    readyState: "complete",
    createElement() {
      return {
        innerHTML: "",
        firstElementChild: null,
        appendChild() {},
        querySelector() { return null; },
      };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const windowEl = {
    ...windowBus,
    document: documentEl,
    CustomEvent: TestCustomEvent,
    location: { hostname: "localhost", hash: "" },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    queueMicrotask: (fn) => fn(),
    getJobPostingScrapeUrl: () => "http://127.0.0.1:3847",
    JobBoredDawn: {
      data: {
        getRoleViewModel: () => ({ job: resolvedJob }),
      },
    },
    JobBored: {
      getSheetId: () => "test-sheet",
      getPipelineJobs: () => pipelineJobs || [],
    },
    getPipelineJobByIndex: (idx) => (pipelineJobs || [])[Number(idx)] || null,
    JobBoredFlowing: {},
  };

  const manifest =
    manifestResponse === undefined
      ? jsonResponse({ error: "not found" }, { ok: false, status: 404 })
      : manifestResponse;

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
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (/\/manifest$/.test(url)) return manifest;
      if (/\/job-description$/.test(url) && !options.method) {
        return jsonResponse({ exists: jobDescriptionExists });
      }
      if (/\/scrape-job-description$/.test(url) && options.method === "POST") {
        return jsonResponse(
          scrapeResponse || {
            ok: true,
            text: "Long scraped job description for this posting. ".repeat(3),
            source: "serpapi-google-jobs",
          },
        );
      }
      if (/\/request$/.test(url) && options.method === "POST") {
        return jsonResponse({
          ok: true,
          slug: "321-the-agency-director-of-digital-marketing",
          requested_at: "2026-05-28T12:00:00Z",
        });
      }
      if (/\/api\/applications$/.test(url)) {
        return jsonResponse({ applications: applications || [] });
      }
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
  vm.runInContext(source, ctx, { filename: "role-materials.js" });
  return { documentEl, events, fetchCalls, storage };
}

async function flushMicrotasks() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}

function dispatchMove(documentEl, detail = {}) {
  documentEl.dispatchEvent(
    new TestCustomEvent("jb:write:succeeded", {
      detail: {
        kind: "pipeline:move",
        jobKey: "4",
        fromStage: "new",
        toStage: "researching",
        status: "Researching",
        ...detail,
      },
    }),
  );
}

function dispatchPipelineRendered(documentEl) {
  documentEl.dispatchEvent(new TestCustomEvent("jb:pipeline:rendered"));
}

describe("role-materials kanban auto draft", () => {
  it("queues both resume and cover letter after a New -> Researching write succeeds", async () => {
    const { documentEl, events, fetchCalls } = loadAutoDraftHarness();

    dispatchMove(documentEl);
    await flushMicrotasks();

    const requestCall = fetchCalls.find((call) => /\/request$/.test(call.url));
    assert.ok(requestCall, "auto draft should POST to the materials request endpoint");
    assert.equal(requestCall.options.method, "POST");
    assert.deepEqual(JSON.parse(requestCall.options.body), {
      slug: "321-the-agency-director-of-digital-marketing",
      company: "321 The Agency",
      title: "Director of Digital Marketing",
      feature: "both",
      jobUrl: "https://dynamitejobs.com/company/321theagency/remote-job/director-of-digital-marketing",
      notes: "",
      jdSource: "already-on-disk",
    });
    assert.ok(
      events.some(
        (event) =>
          event.type === "jb:materials:auto-requested" &&
          event.detail.slug === "321-the-agency-director-of-digital-marketing" &&
          event.detail.feature === "both",
      ),
      "auto draft should emit a request event for the queue strip",
    );
  });

  it("does not queue when the move did not originate in Discovered/New", async () => {
    const { documentEl, fetchCalls } = loadAutoDraftHarness();

    dispatchMove(documentEl, { fromStage: "applied", toStage: "researching" });
    await flushMicrotasks();

    assert.equal(
      fetchCalls.filter((call) => /\/request$/.test(call.url)).length,
      0,
      "only New -> Researching moves should trigger Hermes",
    );
  });

  it("treats blank pipeline status as Discovered/New", async () => {
    const { documentEl, fetchCalls } = loadAutoDraftHarness();

    dispatchMove(documentEl, { fromStage: "", toStage: "researching" });
    await flushMicrotasks();

    assert.equal(
      fetchCalls.filter((call) => /\/request$/.test(call.url)).length,
      1,
      "blank -> Researching should trigger because blank status renders in Discovered",
    );
  });

  it("detects New -> Researching from rendered pipeline state when the write event is missed", async () => {
    const pipelineJobs = [{
      company: "321 The Agency",
      title: "Director of Digital Marketing",
      status: "",
      links: [{ href: "https://dynamitejobs.com/company/321theagency/remote-job/director-of-digital-marketing" }],
    }];
    const { documentEl, fetchCalls } = loadAutoDraftHarness({ pipelineJobs });

    dispatchPipelineRendered(documentEl);
    await flushMicrotasks();
    pipelineJobs[0].status = "Researching";
    dispatchPipelineRendered(documentEl);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.filter((call) => /\/request$/.test(call.url)).length,
      1,
      "render-state transition fallback should request materials when the event path is missed",
    );
  });

  it("falls back to Pipeline data when the Dawn role view is empty", async () => {
    const pipelineJobs = [{
      company: "Unisys",
      title: "Manager, Emerging Technologies - Digital Marketing",
      status: "Researching",
      link: "https://www.linkedin.com/jobs/view/4411748360",
    }];
    const { documentEl, fetchCalls } = loadAutoDraftHarness({
      job: { company: "", role: "", links: [] },
      pipelineJobs,
    });

    dispatchMove(documentEl, { jobKey: "0", fromStage: "new", toStage: "researching" });
    await flushMicrotasks();

    const requestCall = fetchCalls.find((call) => /\/request$/.test(call.url));
    assert.ok(requestCall, "empty Dawn view should fall back to Pipeline row data");
    assert.deepEqual(JSON.parse(requestCall.options.body), {
      slug: "unisys-manager-emerging-technologies-digital-marketing",
      company: "Unisys",
      title: "Manager, Emerging Technologies - Digital Marketing",
      feature: "both",
      jobUrl: "https://www.linkedin.com/jobs/view/4411748360",
      notes: "",
      jdSource: "already-on-disk",
    });
  });

  it("passes title and company into the scrape fallback for LinkedIn rows", async () => {
    const { documentEl, fetchCalls } = loadAutoDraftHarness({
      job: {
        company: "Entravision (Smadex)",
        role: "Sales Director US",
        link: "https://www.linkedin.com/jobs/view/4346168652",
      },
      jobDescriptionExists: false,
    });

    dispatchMove(documentEl);
    await flushMicrotasks();

    const scrapeCall = fetchCalls.find((call) =>
      /\/scrape-job-description$/.test(call.url),
    );
    assert.ok(scrapeCall, "missing JD should trigger the server scrape fallback");
    assert.deepEqual(JSON.parse(scrapeCall.options.body), {
      jobUrl: "https://www.linkedin.com/jobs/view/4346168652",
      title: "Sales Director US",
      company: "Entravision (Smadex)",
    });

    const requestCall = fetchCalls.find((call) => /\/request$/.test(call.url));
    assert.ok(requestCall, "successful scrape should still queue Dobby");
    assert.equal(
      JSON.parse(requestCall.options.body).jdSource,
      "serpapi-google-jobs",
    );
  });

  it("detects New -> Researching across refreshes from the persisted pipeline snapshot", async () => {
    const pipelineJobs = [{
      company: "321 The Agency",
      title: "Director of Digital Marketing",
      status: "Researching",
      links: [{ href: "https://dynamitejobs.com/company/321theagency/remote-job/director-of-digital-marketing" }],
    }];
    const { documentEl, fetchCalls } = loadAutoDraftHarness({
      pipelineJobs,
      localStorageState: {
        "jobBored:autoDraftStageSnapshot:v1:test-sheet": JSON.stringify({ 0: "" }),
      },
    });

    dispatchPipelineRendered(documentEl);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.filter((call) => /\/request$/.test(call.url)).length,
      1,
      "persisted snapshot should recover a missed New -> Researching transition after refresh",
    );
  });

  it("does not queue existing Researching rows without a prior snapshot", async () => {
    const pipelineJobs = [{
      company: "321 The Agency",
      title: "Director of Digital Marketing",
      status: "Researching",
      links: [{ href: "https://dynamitejobs.com/company/321theagency/remote-job/director-of-digital-marketing" }],
    }];
    const { documentEl, fetchCalls } = loadAutoDraftHarness({ pipelineJobs });

    dispatchPipelineRendered(documentEl);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.filter((call) => /\/request$/.test(call.url)).length,
      0,
      "first render should not bulk-request every existing Researching row",
    );
  });

  it("skips duplicate requests when a package is already pending", async () => {
    const { documentEl, events, fetchCalls } = loadAutoDraftHarness({
      manifestResponse: jsonResponse({
        slug: "321-the-agency-director-of-digital-marketing",
        documents: [],
        pending: { feature: "both" },
      }),
    });

    dispatchMove(documentEl);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.filter((call) => /\/request$/.test(call.url)).length,
      0,
      "pending.json should prevent duplicate Hermes requests",
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === "jb:materials:auto-request-skipped" &&
          event.detail.reason === "pending",
      ),
      "pending packages should emit a skip reason",
    );
  });

  it("uses the existing application slug before checking for duplicates", async () => {
    const { documentEl, events, fetchCalls } = loadAutoDraftHarness({
      job: {
        company: "321 The Agency",
        role: "Director of Digital Marketing",
        links: [{ href: "https://dynamitejobs.com/company/321theagency/remote-job/director-of-digital-marketing" }],
      },
      applications: [
        {
          slug: "321-the-agency-director-of-digital-marketing-remote-job",
          company: "321 The Agency",
          title: "Director of Digital Marketing, Remote Job",
        },
      ],
      manifestResponse: jsonResponse({
        slug: "321-the-agency-director-of-digital-marketing-remote-job",
        documents: [],
        pending: { feature: "cover_letter" },
      }),
    });

    dispatchMove(documentEl);
    await flushMicrotasks();

    assert.ok(
      fetchCalls.some((call) =>
        /\/api\/applications\/321-the-agency-director-of-digital-marketing-remote-job\/manifest$/.test(call.url),
      ),
      "auto draft should inspect the matched existing Hermes folder",
    );
    assert.equal(
      fetchCalls.filter((call) => /\/request$/.test(call.url)).length,
      0,
      "matched pending folders should not get a second request under a new slug",
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === "jb:materials:auto-request-skipped" &&
          event.detail.reason === "pending" &&
          event.detail.slug === "321-the-agency-director-of-digital-marketing-remote-job",
      ),
      "the skip event should report the matched slug",
    );
  });

  it("skips duplicate requests when both primary docs are already ready", async () => {
    const { documentEl, events, fetchCalls } = loadAutoDraftHarness({
      manifestResponse: jsonResponse({
        slug: "321-the-agency-director-of-digital-marketing",
        documents: [
          { type: "resume", files: [{ filename: "resume.pdf" }] },
          { type: "cover_letter", files: [{ filename: "cover-letter.pdf" }] },
        ],
      }),
    });

    dispatchMove(documentEl);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.filter((call) => /\/request$/.test(call.url)).length,
      0,
      "ready resume + cover letter should not be requested again",
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === "jb:materials:auto-request-skipped" &&
          event.detail.reason === "ready",
      ),
      "ready packages should emit a skip reason",
    );
  });
});
