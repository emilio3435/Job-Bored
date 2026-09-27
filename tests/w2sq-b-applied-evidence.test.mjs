/**
 * W2SQ lane B, claim D11 (APPLY-01 persistence): the Applied flow collects
 * applied date, source, receipt note and follow-up date, and the Sheet must
 * receive them — including on the legacy-writer fallback path, where
 * updateJobStatus used to write today's date and nothing else.
 *
 * Promotes `.lane-evidence/ref/probes-D/p13-browser-writer-divergence.mjs`
 * (VM-loaded sheets-writeback.js with a stubbed fetch) into committed tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRoot = (name) => readFileSync(join(repoRoot, name), "utf8");

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function loadSheetsWrite() {
  const writes = [];
  const job = () => ({
    _rawIndex: 0,
    status: "Researching",
    title: "Eng",
    company: "Acme",
    link: "https://acme.example/jobs/1",
    appliedDate: "",
    followUpDate: "",
    notes: "",
  });
  let data = [job()];
  const host = {
    getSheetId: () => "probe",
    getSHEET_ID: () => "probe",
    getActiveSheetId: () => "probe",
    getAccessToken: () => "probe-token",
    getPipelineData: () => data,
    renderPipeline() {},
    renderStats() {},
    renderBrief() {},
    showToast() {},
    renderExpiredReviewButton() {},
    refreshAccessTokenSilently: async () => false,
    showSheetAccessGate() {},
  };
  const windowTarget = {
    JobBoredApp: { core: { host }, config: {} },
    dispatchEvent() {},
    CustomEvent: TestCustomEvent,
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body || "{}");
    for (const d of body.data || [body]) {
      writes.push(`${d.range}=${JSON.stringify(d.values?.[0]?.[0] ?? "")}`);
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const context = vm.createContext({
    window: windowTarget,
    fetch: fetchImpl,
    URL,
    URLSearchParams,
    console,
    setTimeout,
    CustomEvent: TestCustomEvent,
    document: { dispatchEvent() {} },
  });
  windowTarget.JobBoredApp.core.host = host;
  context.window.getSHEET_ID = () => "probe";
  vm.runInContext(readRoot("sheets-writeback.js"), context, {
    filename: "sheets-writeback.js",
  });
  const reset = () => {
    writes.length = 0;
    data = [job()];
  };
  return { sw: windowTarget.JobBoredApp.sheetsWrite, writes, reset, data: () => data };
}

function loadSubmission({ dialogResult }) {
  const writeCalls = [];
  const windowTarget = {
    JobBoredA11y: {
      dialog: {
        async confirm() {
          return dialogResult;
        },
      },
      toast: () => () => {},
    },
    JobBoredApp: {
      sheetsWrite: {
        todayStr: () => "2026-08-10",
        futureDateStr: () => "2026-08-17",
        async updateJobStatus(...args) {
          writeCalls.push(args);
          return true;
        },
      },
    },
    // No JobBoredPipelineTransitionAdapter host: this drives the
    // legacy-writer fallback, the path D11 is about.
  };
  const context = {
    CustomEvent: TestCustomEvent,
    Date,
    Object,
    Promise,
    String,
    console,
    document: { dispatchEvent() {} },
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    window: windowTarget,
  };
  vm.runInNewContext(readRoot("submission-flow.js"), context, {
    filename: "submission-flow.js",
  });
  return { api: windowTarget.JobBoredSubmission, writeCalls };
}

const EVIDENCE = {
  appliedDate: "2026-08-31",
  source: "Company portal",
  receiptNote: "Receipt R-17",
  followUpDate: "2026-09-07",
};

describe("D11 the fallback Applied write keeps the confirmed evidence", () => {
  it("submission-flow passes the evidence to the legacy writer", async () => {
    const runtime = loadSubmission({
      dialogResult: { confirmed: true, values: { ...EVIDENCE } },
    });
    const result = await runtime.api.confirmApplied("4", { fromStage: "researching" });
    assert.equal(result.confirmed, true);
    assert.equal(runtime.writeCalls.length, 1);
    assert.deepEqual(runtime.writeCalls[0].slice(0, 3), ["4", "Applied", "researching"]);
    assert.deepEqual({ ...runtime.writeCalls[0][3] }, EVIDENCE);
  });

  it("updateJobStatus writes the confirmed date, follow-up and source note", async () => {
    const { sw, writes, reset } = loadSheetsWrite();
    reset();
    const ok = await sw.updateJobStatus(0, "Applied", "Researching", { ...EVIDENCE });
    assert.equal(ok, true);
    const byRange = Object.fromEntries(
      writes.map((w) => {
        const [range, value] = w.split("=");
        return [range, JSON.parse(value)];
      }),
    );
    assert.equal(byRange["Pipeline!M2"], "Applied");
    assert.equal(byRange["Pipeline!N2"], "2026-08-31");
    assert.equal(byRange["Pipeline!P2"], "2026-09-07");
    assert.match(byRange["Pipeline!O2"], /Applied via Company portal/);
    assert.match(byRange["Pipeline!O2"], /Receipt R-17/);
  });

  it("updateJobStatus without evidence keeps today's behavior (no note, default dates)", async () => {
    const { sw, writes, reset, data } = loadSheetsWrite();
    reset();
    const today = new Date().toISOString().split("T")[0];
    const ok = await sw.updateJobStatus(0, "Applied", "Researching");
    assert.equal(ok, true);
    assert.ok(writes.some((w) => w === `Pipeline!N2=${JSON.stringify(today)}`));
    assert.ok(!writes.some((w) => w.startsWith("Pipeline!O2=")));
    assert.equal(data()[0].notes, "");
  });

  it("updateJobStatus ignores malformed evidence dates", async () => {
    const { sw, writes, reset } = loadSheetsWrite();
    reset();
    const today = new Date().toISOString().split("T")[0];
    await sw.updateJobStatus(0, "Applied", "Researching", {
      appliedDate: "31/08/2026",
      source: "Company portal",
      receiptNote: "",
      followUpDate: "next Friday",
    });
    assert.ok(writes.some((w) => w === `Pipeline!N2=${JSON.stringify(today)}`));
    assert.ok(writes.some((w) => w.startsWith("Pipeline!O2=")));
    assert.ok(!writes.some((w) => w.includes("31/08/2026") || w.includes("next Friday")));
  });
});
