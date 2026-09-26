// In-memory Google Sheets v4 values API for the Sheets integrity tests.
// Promoted from docs/programs/beaudit-20260925/probes/D/fake-sheets.mjs and
// extended with values:batchGet. No network: it answers the token endpoint,
// values GET/PUT, values:batchGet, values:batchUpdate, values:append and
// spreadsheets:batchUpdate(addSheet). Hooks let a test interleave events
// between a writer's read and its write.
import { PIPELINE_HEADER_ROW } from "../../src/contracts.ts";

export const HEADER: string[] = [...PIPELINE_HEADER_ROW];

type Hooks = {
  beforeWrite: ((kind: string, body: string) => Promise<void> | void) | null;
  onRead: ((range: string, values: string[][]) => Promise<void> | void) | null;
  failNext: Array<{ kind: string; status: number; body?: string }>;
};

export type FakeCall = { kind: string; method: string; range: string; ranges: string[]; body: string };

function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseA1(range: string) {
  const bang = range.lastIndexOf("!");
  const tab = range.slice(0, bang).replace(/^'|'$/g, "");
  const ref = range.slice(bang + 1);
  const [a, b] = ref.split(":");
  const pa = /^([A-Z]+)(\d*)$/.exec(a)!;
  const pb = b ? /^([A-Z]+)(\d*)$/.exec(b)! : pa;
  return {
    tab,
    c0: colToIndex(pa[1]),
    r0: pa[2] ? Number(pa[2]) - 1 : 0,
    c1: colToIndex(pb[1]),
    r1: pb[2] ? Number(pb[2]) - 1 : Infinity,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createFakeSheets(initialTabs: Record<string, string[][]> = {}) {
  const tabs = new Map<string, string[][]>(
    Object.entries(initialTabs).map(([k, v]) => [k, v.map((r) => [...r])]),
  );
  const calls: FakeCall[] = [];
  const hooks: Hooks = { beforeWrite: null, onRead: null, failNext: [] };

  function read(range: string): string[][] | null {
    const { tab, c0, r0, c1, r1 } = parseA1(range);
    if (!tabs.has(tab)) return null;
    const rows = tabs.get(tab)!;
    const out: string[][] = [];
    for (let r = r0; r < Math.min(rows.length, r1 + 1); r += 1) {
      const row = (rows[r] || []).slice(c0, c1 + 1).map((v) => String(v ?? ""));
      while (row.length && row[row.length - 1] === "") row.pop();
      out.push(row);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  function write(range: string, values: unknown[][]): void {
    const { tab, c0, r0 } = parseA1(range);
    if (!tabs.has(tab)) tabs.set(tab, []);
    const rows = tabs.get(tab)!;
    values.forEach((vals, i) => {
      while (rows.length <= r0 + i) rows.push([]);
      const row = rows[r0 + i];
      vals.forEach((v, j) => {
        while (row.length <= c0 + j) row.push("");
        row[c0 + j] = String(v ?? "");
      });
    });
  }

  function append(range: string, values: unknown[][]): boolean {
    const { tab } = parseA1(range);
    if (!tabs.has(tab)) return false;
    const rows = tabs.get(tab)!;
    let last = rows.length;
    while (last > 0 && (rows[last - 1] || []).every((c) => c === "")) last -= 1;
    rows.length = last;
    for (const v of values) rows.push(v.map((c) => String(c ?? "")));
    return true;
  }

  async function fetchImpl(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = String(init.method || "GET").toUpperCase();
    const body = init.body ? String(init.body) : "";
    const kind =
      url.hostname === "oauth2.googleapis.com" ? "token"
      : /values:batchGet$/.test(url.pathname) ? "values.batchGet"
      : /values:batchUpdate$/.test(url.pathname) ? "values.batchUpdate"
      : /:append$/.test(url.pathname) ? "values.append"
      : /:batchUpdate$/.test(url.pathname) ? "spreadsheets.batchUpdate"
      : /\/values\//.test(url.pathname) && method === "PUT" ? "values.update"
      : /\/values\//.test(url.pathname) ? "values.get"
      : "spreadsheets.get";
    const range = decodeURIComponent(
      (url.pathname.split("/values/")[1] || "").replace(/:append$/, ""),
    );
    const ranges = url.searchParams.getAll("ranges");
    calls.push({ kind, method, range, ranges, body });
    const forced = hooks.failNext.findIndex((f) => f.kind === kind);
    if (forced >= 0) {
      const f = hooks.failNext.splice(forced, 1)[0];
      return new Response(f.body || "forced failure", { status: f.status });
    }
    if (kind === "token") return json({ access_token: "fake-access-token", expires_in: 3599 });
    if (kind === "spreadsheets.get") return json({ spreadsheetId: "fake" });
    if (kind === "values.get") {
      const v = read(range);
      if (v === null) return new Response("Unable to parse range: " + range, { status: 400 });
      if (hooks.onRead) await hooks.onRead(range, v);
      return json({ range, values: v });
    }
    if (kind === "values.batchGet") {
      // One consistent snapshot for every range, then the hooks.
      const valueRanges = [];
      for (const r of ranges) {
        const v = read(r);
        if (v === null) return new Response("Unable to parse range: " + r, { status: 400 });
        valueRanges.push({ range: r, values: v });
      }
      if (hooks.onRead) {
        for (const vr of valueRanges) await hooks.onRead(vr.range, vr.values);
      }
      return json({ valueRanges });
    }
    if (hooks.beforeWrite) await hooks.beforeWrite(kind, body);
    if (kind === "values.batchUpdate") {
      const parsed = JSON.parse(body);
      for (const d of parsed.data) write(d.range, d.values);
      return json({});
    }
    if (kind === "values.update") {
      const parsed = JSON.parse(body);
      write(parsed.range || range, parsed.values);
      return json({});
    }
    if (kind === "values.append") {
      const parsed = JSON.parse(body);
      if (!append(range, parsed.values)) return new Response("Unable to parse range", { status: 400 });
      return json({});
    }
    if (kind === "spreadsheets.batchUpdate") {
      const parsed = JSON.parse(body);
      for (const r of parsed.requests || []) {
        const title = r.addSheet?.properties?.title;
        if (title) {
          if (tabs.has(title)) return new Response("already exists", { status: 400 });
          tabs.set(title, []);
        }
      }
      return json({});
    }
    return new Response("unhandled", { status: 404 });
  }

  return { fetchImpl: fetchImpl as typeof fetch, tabs, calls, hooks };
}

const ROW_KEYS: Record<string, number> = {
  date: 0, title: 1, company: 2, location: 3, link: 4, source: 5, salary: 6,
  fit: 7, priority: 8, tags: 9, fitAssessment: 10, contact: 11, status: 12, applied: 13,
  notes: 14, followUp: 15, talking: 16, lastContact: 17, reply: 18, logo: 19, match: 20,
  favorite: 21, dismissed: 22, approval: 23, lock: 24,
};

export function pipelineRow(o: Record<string, string>): string[] {
  const r = new Array(HEADER.length).fill("");
  for (const [k, v] of Object.entries(o)) r[ROW_KEYS[k]] = v;
  return r;
}

export function lead(o: Record<string, unknown> = {}): any {
  return {
    sourceId: "greenhouse", sourceLabel: "Greenhouse", title: "Engineer", company: "Acme",
    location: "Remote", url: "https://boards.greenhouse.io/acme/jobs/1", compensationText: "",
    fitScore: 7, priority: "high", tags: ["x"], fitAssessment: "discovery says fit",
    contact: "", status: "New", appliedDate: "", notes: "", followUpDate: "",
    talkingPoints: "tp from discovery", logoUrl: "", discoveredAt: "2026-09-25T00:00:00Z",
    metadata: { runId: "r", variationKey: "v", sourceQuery: "q" }, matchScore: 8,
    favorite: false, dismissedAt: null, approvalStatus: "", ...o,
  };
}

export const runtimeConfig: any = { googleAccessToken: "fake-access-token" };
