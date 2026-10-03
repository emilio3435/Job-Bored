/* scribe-v2-api.test.mjs — EDITOR lane F1.

   scribe-v2-api.js is the one door every Scribe v2 network call goes
   through (SPEC §3.5), so lane B2's routes can replace the stub without
   touching the desk. These tests pin:
     - the stub answers with the C0 fixtures, byte for byte, and its node
       ids are exactly what the server derives (the client never derives
       node ids itself);
     - the stub's preview is the package's REAL rendered file, so the desk
       shows the role's own template render before B2 lands;
     - live mode calls every SPEC §3.2 route with the right method, path
       and body, maps errors to one shape, and reads SSE over fetch;
     - a stale base is retried once onto the current run. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { deriveNodes } from "../server/materials-nodes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const fixture = (name) => JSON.parse(read(`docs/programs/editor-20260927/fixtures/${name}`));

const BASE = "http://127.0.0.1:3847";
const SLUG = "acme-platform-engineer";

function loadApi(extra = {}) {
  const win = {
    setTimeout: (fn) => { fn(); return 1; },
    TextDecoder,
    Date,
    JSON,
    location: { search: "" },
    ...extra,
  };
  win.window = win;
  vm.runInNewContext(read("scribe-v2-api.js"), win);
  return win;
}

/* Plain data out of the vm realm, so deepEqual compares values, not
   prototypes from another context. */
const plain = (value) => JSON.parse(JSON.stringify(value));

function response(status, body, { text } = {}) {
  const raw = text != null ? text : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(raw),
    text: async () => raw,
  };
}

function recordingFetch(answer) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
    return answer(url, init, calls.length - 1);
  };
  return { calls, fetchImpl };
}

describe("scribe-v2-api stub: the C0 fixtures, not invented data", () => {
  it("should carry fixtures/model.json and sse-transcript.json verbatim", () => {
    const { JBScribeApi } = loadApi();
    assert.deepEqual(plain(JBScribeApi.STUB_FIXTURES.model), fixture("model.json"));
    assert.deepEqual(plain(JBScribeApi.STUB_FIXTURES.transcript), fixture("sse-transcript.json"));
  });

  it("should serve exactly the node ids the server derives from the model", () => {
    const { JBScribeApi } = loadApi();
    assert.deepEqual(plain(JBScribeApi.STUB_FIXTURES.nodes), deriveNodes(fixture("model.json")));
  });
});

describe("scribe-v2-api mode flag", () => {
  /* Grok F1-stub (P1): a stub default showed invented versions and a canned
     proposal on the user's real resume for every Edit click. The real
     server is the default; fixtures are opt-in only. */
  it("should talk to the real server unless the stub is asked for", () => {
    const { JBScribeApi } = loadApi();
    assert.equal(JBScribeApi.DEFAULT_MODE, "live");
    assert.equal(JBScribeApi.resolveMode(), "live");
    assert.equal(JBScribeApi.create({ base: BASE, slug: SLUG, fetchImpl: async () => response(200, {}) }).mode, "live");
    const unknown = loadApi({ COMMAND_CENTER_CONFIG: { scribeV2Api: "fixtures" }, location: { search: "?scribe-api=demo" } });
    assert.equal(unknown.JBScribeApi.resolveMode(), "live", "only the exact word stub opts in");
  });

  it("should use the stub only for ?scribe-api=stub or scribeV2Api: 'stub'", () => {
    const withConfig = loadApi({ COMMAND_CENTER_CONFIG: { scribeV2Api: "stub" } });
    assert.equal(withConfig.JBScribeApi.resolveMode(), "stub");
    const withUrl = loadApi({ location: { search: "?jb-v2=1&scribe-api=stub" } });
    assert.equal(withUrl.JBScribeApi.resolveMode(), "stub");
    const urlWins = loadApi({ COMMAND_CENTER_CONFIG: { scribeV2Api: "stub" }, location: { search: "?scribe-api=live" } });
    assert.equal(urlWins.JBScribeApi.resolveMode(), "live");
  });

  it("should refuse to open without a package slug", () => {
    const { JBScribeApi } = loadApi();
    assert.throws(() => JBScribeApi.create({ base: BASE, slug: "" }), /materials package/);
  });
});

describe("scribe-v2-api stub behaviour", () => {
  const NOW = Date.parse("2026-09-27T18:00:00.000Z");

  function stubClient(fetchAnswer) {
    const { JBScribeApi } = loadApi();
    const rec = recordingFetch(fetchAnswer || (() => response(200, null, { text: "<html><body><p data-page>Alex Example resume</p></body></html>" })));
    const client = JBScribeApi.create({ base: `${BASE}/`, slug: SLUG, mode: "stub", fetchImpl: rec.fetchImpl, stepMs: 0, now: () => NOW, family: "dossier" });
    return { client, calls: rec.calls, JBScribeApi };
  }

  it("should list versions newest first in the §3.2 shape, with v0 pinned", async () => {
    const { client } = stubClient();
    const listing = plain(await client.listVersions("resume"));
    const ns = listing.versions.map((v) => v.n);
    assert.deepEqual(ns, [...ns].sort((a, b) => b - a), "newest first");
    assert.equal(listing.currentRunId, listing.versions[0].runId, "the newest run is current");
    const v0 = listing.versions.find((v) => v.n === 0);
    assert.equal(v0.pinned, true);
    assert.equal(v0.source, "draft");
    for (const v of listing.versions) {
      for (const key of ["runId", "n", "createdAt", "source", "label", "pinned", "starred", "words", "family"]) {
        assert.ok(key in v, `version row carries ${key}`);
      }
      assert.equal(v.family, "dossier", "the stub follows the role's template family");
    }
  });

  it("should keep a separate history per document", async () => {
    const { client } = stubClient();
    const resume = await client.listVersions("resume");
    const letter = await client.listVersions("cover_letter");
    assert.notEqual(resume.currentRunId, letter.currentRunId);
  });

  it("should preview the package's real rendered file for each document", async () => {
    const { client, calls } = stubClient();
    const res = await client.preview({ doc: "resume", baseRunId: "stub-r3" });
    assert.match(res.html, /Alex Example resume/);
    assert.equal(res.words, 3);
    await client.preview({ doc: "cover_letter", baseRunId: "stub-letter-r1" });
    assert.deepEqual(calls.map((c) => c.url), [
      `${BASE}/api/applications/${SLUG}/files/resume.html`,
      `${BASE}/api/applications/${SLUG}/files/cover-letter.html`,
    ]);
  });

  it("should say which document failed when the preview file is missing", async () => {
    const { client } = stubClient(() => response(404, { error: "not found" }));
    await assert.rejects(client.preview({ doc: "cover_letter" }), (err) => {
      assert.equal(err.code, "preview_unavailable");
      assert.equal(err.status, 404);
      assert.match(err.message, /cover letter/);
      return true;
    });
  });

  it("should replay the SSE transcript in order and finish ready", async () => {
    const { client } = stubClient();
    const { currentRunId } = await client.listVersions("resume");
    const { proposalId } = await client.propose({ doc: "resume", baseRunId: currentRunId, instruction: "Punchier", scope: "all", lockFacts: true });
    const seen = [];
    const status = await client.stream(proposalId, { onEvent: (f) => seen.push(plain(f)) });
    assert.equal(status, "ready");
    assert.deepEqual(seen, fixture("sse-transcript.json"));
  });

  it("should refuse an empty or over-long instruction", async () => {
    const { client, JBScribeApi } = stubClient();
    await assert.rejects(client.propose({ doc: "resume", instruction: "  " }), { code: "instruction_required", status: 400 });
    await assert.rejects(
      client.propose({ doc: "resume", instruction: "x".repeat(JBScribeApi.MAX_INSTRUCTION + 1) }),
      { code: "instruction_too_long", status: 400 },
    );
  });

  it("should rebase a stale request onto the current run instead of failing", async () => {
    const { client } = stubClient();
    const { currentRunId } = await client.listVersions("resume");
    const res = await client.propose({ doc: "resume", baseRunId: "stub-r0", instruction: "Shorter" });
    assert.equal(res.rebasedTo, currentRunId);
  });

  it("should end a stopped stream as partial", async () => {
    const { client } = stubClient();
    const { currentRunId } = await client.listVersions("resume");
    const { proposalId } = await client.propose({ doc: "resume", baseRunId: currentRunId, instruction: "Shorter" });
    const events = [];
    const status = await client.stream(proposalId, {
      onEvent: (f) => {
        events.push(f.event);
        if (f.event === "stage" && f.data.stage === "drafting") client.stopEdit(proposalId);
      },
    });
    assert.equal(status, "partial");
    assert.equal(events.at(-1), "done");
    assert.ok(!events.includes("proposal"), "no proposal after Stop");
  });

  it("should append, never replace, on accept and restore, and remember stars", async () => {
    const { client } = stubClient();
    const before = await client.listVersions("resume");
    const { proposalId } = await client.propose({ doc: "resume", baseRunId: before.currentRunId, instruction: "Quantify" });
    const accepted = await client.acceptEdit(proposalId, { accept: ["o1"], confirmUnverified: [] });
    assert.equal(accepted.run.n, before.versions[0].n + 1);
    assert.equal(accepted.versions[0].source, "edit");
    assert.equal(accepted.versions[0].prompt, "Quantify");
    assert.equal(accepted.versions.length, before.versions.length + 1);

    const restored = await client.restore("stub-r0");
    assert.equal(restored.run.source, "restore");
    assert.equal(restored.run.restoredFrom, "stub-r0");
    const after = await client.listVersions("resume");
    assert.equal(after.versions.length, before.versions.length + 2, "nothing is deleted");

    await client.star("stub-r2", true);
    const starred = await client.listVersions("resume");
    assert.equal(starred.versions.find((v) => v.runId === "stub-r2").starred, true);
  });
});

describe("scribe-v2-api live mode: the SPEC §3.2 routes", () => {
  const prefix = `${BASE}/api/applications/${SLUG}`;

  it("should call each route with its method, path and body", async () => {
    const { JBScribeApi } = loadApi();
    const rec = recordingFetch((url, init) => (init.method === "DELETE" ? response(204, null, { text: "" }) : response(200, { ok: true })));
    const api = JBScribeApi.create({ base: BASE, slug: SLUG, mode: "live", fetchImpl: rec.fetchImpl });
    assert.equal(api.mode, "live");
    await api.listVersions("cover_letter");
    await api.getModel("r7");
    await api.preview({ doc: "resume", baseRunId: "r7", ops: [] });
    await api.startEdit({ doc: "resume", baseRunId: "r7", instruction: "Punchier", scope: "all", lockFacts: true });
    await api.stopEdit("p1");
    await api.acceptEdit("p1", { accept: ["o1"], confirmUnverified: [] });
    assert.equal(await api.rejectEdit("p1"), null);
    await api.manualEdit({ doc: "resume", baseRunId: "r7", manualOps: [] });
    await api.restore("r2");
    await api.star("r2", true);
    assert.deepEqual(rec.calls.map((c) => `${c.method} ${c.url.slice(prefix.length)}`), [
      "GET /versions?doc=cover_letter",
      "GET /versions/r7/model",
      "POST /preview",
      "POST /edits",
      "POST /edits/p1/stop",
      "POST /edits/p1/accept",
      "DELETE /edits/p1",
      "POST /edits/manual",
      "POST /versions/r2/restore",
      "PUT /versions/r2/star",
    ]);
    assert.deepEqual(rec.calls[3].body, { doc: "resume", baseRunId: "r7", instruction: "Punchier", scope: "all", lockFacts: true });
    assert.deepEqual(rec.calls[5].body, { accept: ["o1"], confirmUnverified: [] });
    assert.deepEqual(rec.calls[9].body, { starred: true });
    assert.equal(rec.calls[2].headers["Content-Type"], "application/json");
  });

  it("should go through the hosted-auth transport when it is loaded", async () => {
    const seen = [];
    const { JBScribeApi } = loadApi({
      JobBoredHostedApiAuth: { apiFetch: async (url) => { seen.push(url); return response(200, { versions: [], currentRunId: null }); } },
    });
    await JBScribeApi.create({ base: BASE, slug: SLUG, mode: "live" }).listVersions("resume");
    assert.deepEqual(seen, [`${prefix}/versions?doc=resume`]);
  });

  it("should map a server refusal to one error shape", async () => {
    const { JBScribeApi } = loadApi();
    const api = JBScribeApi.create({
      base: BASE, slug: SLUG, mode: "live",
      fetchImpl: async () => response(409, { error: "materials_pending", message: "A draft is still running." }),
    });
    await assert.rejects(api.startEdit({ doc: "resume", instruction: "x" }), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, "materials_pending");
      assert.equal(err.message, "A draft is still running.");
      return true;
    });
  });

  it("should tell the user how to start a server that is not answering", async () => {
    const { JBScribeApi } = loadApi();
    const api = JBScribeApi.create({ base: BASE, slug: SLUG, mode: "live", fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    await assert.rejects(api.listVersions("resume"), (err) => {
      assert.equal(err.code, "server_unreachable");
      assert.match(err.message, /npm start/);
      return true;
    });
  });

  it("should retry a stale base once onto the current run", async () => {
    const { JBScribeApi } = loadApi();
    const rec = recordingFetch((url, init, i) => {
      if (url.endsWith("/edits") && i === 0) return response(409, { code: "stale_base" });
      if (url.includes("/versions?")) return response(200, { versions: [], currentRunId: "r9" });
      return response(202, { proposalId: "p2", streamUrl: "/x" });
    });
    const api = JBScribeApi.create({ base: BASE, slug: SLUG, mode: "live", fetchImpl: rec.fetchImpl });
    const res = await api.propose({ doc: "resume", baseRunId: "r8", instruction: "Shorter" });
    assert.equal(res.proposalId, "p2");
    assert.equal(res.rebasedTo, "r9");
    assert.equal(rec.calls[2].body.baseRunId, "r9");
    assert.equal(rec.calls.length, 3, "one retry, not a loop");
  });

  it("should read SSE frames split across chunks and skip heartbeats", async () => {
    const { JBScribeApi } = loadApi();
    const wire = [
      ": ping\n\nevent: stage\ndata: {\"stage\":\"rea",
      "ding\"}\n\nevent: op\ndata: {\"op\":{\"opId\":\"o1\"}}\r\n\r\n",
      "event: done\ndata: {\"status\":\"partial\"}\n\n",
    ];
    const encoder = new TextEncoder();
    let i = 0;
    const body = { getReader: () => ({ read: async () => (i < wire.length ? { done: false, value: encoder.encode(wire[i++]) } : { done: true }) }) };
    const rec = recordingFetch(() => ({ ok: true, status: 200, body }));
    const api = JBScribeApi.create({ base: BASE, slug: SLUG, mode: "live", fetchImpl: rec.fetchImpl });
    const frames = [];
    const status = await api.stream("p1", { onEvent: (f) => frames.push(plain(f)) });
    assert.equal(status, "partial");
    assert.deepEqual(frames, [
      { event: "stage", data: { stage: "reading" } },
      { event: "op", data: { op: { opId: "o1" } } },
      { event: "done", data: { status: "partial" } },
    ]);
    assert.equal(rec.calls[0].url, `${prefix}/edits/p1/stream`);
    assert.equal(rec.calls[0].headers.Accept, "text/event-stream");
  });
});

describe('SCRP-F2 R1 open route and R2 truthful transport', () => {
  it('SCRP-F2 GET open is slug-bound and maps the server coverLetter name', async () => {
    const { JBScribeApi } = loadApi();
    const rec = recordingFetch(() => response(200, { proposal: { proposalId: 'p1', doc: 'coverLetter', status: 'ready' } }));
    const api = JBScribeApi.create({ base: BASE, slug: SLUG, mode: 'live', fetchImpl: rec.fetchImpl });
    assert.equal(typeof api.getOpenEdit, 'function');
    assert.equal((await api.getOpenEdit()).proposal.doc, 'cover_letter');
    assert.equal(rec.calls[0].url, `${BASE}/api/applications/${SLUG}/edits/open`);
    assert.equal(rec.calls[0].method, 'GET');
  });
  for (const doc of ['resume', 'cover_letter']) {
    for (const method of ['acceptEdit', 'manualEdit', 'restore']) {
      it(`SCRP-F3 ${doc} ${method} resolves only the committed 503`, async () => {
        const { JBScribeApi } = loadApi();
        const body = { code: 'browser_unavailable', error: 'PDF unavailable.', run: { runId: 'saved-1', n: 1, pdf: 'stale' }, versions: [], retryable: false };
        const rec = recordingFetch(() => response(503, body));
        const api = JBScribeApi.create({ base: BASE, slug: SLUG, mode: 'live', fetchImpl: rec.fetchImpl });
        const res = await api[method](method === 'manualEdit' ? { doc, baseRunId: 'r0', manualOps: [] } : 'p1', { accept: ['o1'] });
        assert.equal(res.textSaved, true);
        assert.equal(res.httpStatus, 503);
        assert.equal(res.run.n, 1);
        assert.equal(rec.calls.length, 1, 'saved text is never retried');
      });
    }
  }
  it('SCRP-F4 ordinary 503 and incomplete committed bodies still fail', async () => {
    const { JBScribeApi } = loadApi();
    for (const body of [
      { code: 'provider_failed' },
      { code: 'browser_unavailable', run: { runId: '', pdf: 'stale' } },
      { code: 'browser_unavailable', run: { runId: 'r1', pdf: 'ready' } },
    ]) {
      const api = JBScribeApi.create({ base: BASE, slug: SLUG, mode: 'live', fetchImpl: async () => response(503, body) });
      await assert.rejects(api.acceptEdit('p1', {}), (e) => e.status === 503 && !e.textSaved);
    }
  });
  it('SCRP-F5 api-error.v1 preserves safe copy, detail, nextStep and retryable', async () => {
    const { JBScribeApi } = loadApi();
    for (const [body, expected] of [
      [{ error: 'Safe explanation', code: 'stale_base', detail: 'New version', nextStep: 'Review current', retryable: false }, 'Safe explanation'],
      [{ message: 'Preferred message', error: 'Other', code: 'provider_failed', fix: 'Try again' }, 'Preferred message'],
      [{ code: 'unreadable_reply' }, 'Scribe’s reply couldn’t be read. Your document is unchanged.'],
      [{ code: 'unknown' }, 'That didn’t work. Try again.'],
      [{ message: 'x'.repeat(500) }, 'x'.repeat(300)],
    ]) {
      const api = JBScribeApi.create({ base: BASE, slug: SLUG, mode: 'live', fetchImpl: async () => response(409, body) });
      await assert.rejects(api.acceptEdit('p1', {}), (e) => {
        assert.equal(e.message, expected);
        assert.equal(e.fix, body.fix || body.nextStep || null);
        assert.equal(e.detail, body.detail || null);
        assert.equal(e.retryable, body.retryable);
        return true;
      });
    }
  });
});
