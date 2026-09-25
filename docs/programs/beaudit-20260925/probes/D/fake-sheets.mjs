// In-memory Google Sheets v4 values API for BEAUDIT lane D probes.
// No network. Supports values GET, values:batchUpdate, values/{range}:append,
// values PUT, spreadsheets:batchUpdate(addSheet), spreadsheets GET, token POST.
// Hooks let a probe interleave events between a writer's read and its write.
export const HEADER = [
  "Date Found", "Title", "Company", "Location", "Link", "Source", "Salary",
  "Fit Score", "Priority", "Tags", "Fit Assessment", "Contact", "Status",
  "Applied Date", "Notes", "Follow-up Date", "Talking Points", "Last contact",
  "Did they reply?", "Logo URL", "Match Score", "Favorite", "Dismissed At",
  "Approval Status", "Edit Lock",
];

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseA1(range) {
  const bang = range.lastIndexOf("!");
  const tab = range.slice(0, bang).replace(/^'|'$/g, "");
  const ref = range.slice(bang + 1);
  const [a, b] = ref.split(":");
  const pa = /^([A-Z]+)(\d*)$/.exec(a);
  const pb = b ? /^([A-Z]+)(\d*)$/.exec(b) : pa;
  return {
    tab,
    c0: colToIndex(pa[1]),
    r0: pa[2] ? Number(pa[2]) - 1 : 0,
    c1: colToIndex(pb[1]),
    r1: pb[2] ? Number(pb[2]) - 1 : Infinity,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createFakeSheets(initialTabs = {}) {
  const tabs = new Map(
    Object.entries(initialTabs).map(([k, v]) => [k, v.map((r) => [...r])]),
  );
  const calls = [];
  const hooks = { beforeWrite: null, onRead: null, failNext: [] };

  function read(range) {
    const { tab, c0, r0, c1, r1 } = parseA1(range);
    if (!tabs.has(tab)) return null;
    const rows = tabs.get(tab);
    const out = [];
    for (let r = r0; r < Math.min(rows.length, r1 + 1); r += 1) {
      const row = (rows[r] || []).slice(c0, c1 + 1).map((v) => String(v ?? ""));
      while (row.length && row[row.length - 1] === "") row.pop();
      out.push(row);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  function write(range, values) {
    const { tab, c0, r0 } = parseA1(range);
    if (!tabs.has(tab)) tabs.set(tab, []);
    const rows = tabs.get(tab);
    values.forEach((vals, i) => {
      while (rows.length <= r0 + i) rows.push([]);
      const row = rows[r0 + i];
      vals.forEach((v, j) => {
        while (row.length <= c0 + j) row.push("");
        row[c0 + j] = String(v ?? "");
      });
    });
  }

  function append(range, values) {
    const { tab } = parseA1(range);
    if (!tabs.has(tab)) return false;
    const rows = tabs.get(tab);
    let last = rows.length;
    while (last > 0 && (rows[last - 1] || []).every((c) => c === "")) last -= 1;
    rows.length = last;
    for (const v of values) rows.push(v.map((c) => String(c ?? "")));
    return true;
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = String(init.method || "GET").toUpperCase();
    const body = init.body ? String(init.body) : "";
    const kind =
      url.hostname === "oauth2.googleapis.com" ? "token"
      : /values:batchUpdate$/.test(url.pathname) ? "values.batchUpdate"
      : /:append$/.test(url.pathname) ? "values.append"
      : /:batchUpdate$/.test(url.pathname) ? "spreadsheets.batchUpdate"
      : /\/values\//.test(url.pathname) && method === "PUT" ? "values.update"
      : /\/values\//.test(url.pathname) ? "values.get"
      : "spreadsheets.get";
    const range = decodeURIComponent(
      (url.pathname.split("/values/")[1] || "").replace(/:append$/, ""),
    );
    calls.push({ kind, method, range, body });
    const forced = hooks.failNext.findIndex((f) => f.kind === kind);
    if (forced >= 0) {
      const f = hooks.failNext.splice(forced, 1)[0];
      return new Response(f.body || "forced failure", { status: f.status });
    }
    if (kind === "token") return json({ access_token: "probe-access-token" });
    if (kind === "spreadsheets.get") return json({ spreadsheetId: "probe" });
    if (kind === "values.get") {
      const v = read(range);
      if (v === null) return new Response("Unable to parse range: " + range, { status: 400 });
      if (hooks.onRead) await hooks.onRead(range, v);
      return json({ range, values: v });
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

  return { fetchImpl, tabs, calls, hooks };
}

export function pipelineRow(o) {
  const r = new Array(HEADER.length).fill("");
  const map = { date: 0, title: 1, company: 2, location: 3, link: 4, source: 5, salary: 6,
    fit: 7, priority: 8, tags: 9, fitAssessment: 10, contact: 11, status: 12, applied: 13,
    notes: 14, followUp: 15, talking: 16, lastContact: 17, reply: 18, logo: 19, match: 20,
    favorite: 21, dismissed: 22, approval: 23, lock: 24 };
  for (const [k, v] of Object.entries(o)) r[map[k]] = v;
  return r;
}

export function lead(o) {
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

export const runtimeConfig = { googleAccessToken: "probe-access-token" };
