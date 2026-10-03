/* ============================================================
   scribe-v2-api.js — Scribe v2 transport (EDITOR lane F1)
   ------------------------------------------------------------
   Every network call the desk makes goes through this module, so
   lane B2's routes drop in without touching scribe-v2.js.

   Contract: docs/programs/editor-20260927/SPEC.md §3.2 (endpoints)
   and §3.3 (SSE events). All routes live under
   `<base>/api/applications/:slug/`.

   Modes:
     "live"  (default) calls the §3.2 routes on the materials server.
     "stub"  answers from the C0 fixtures (fixtures/model.json and
             fixtures/sse-transcript.json, copied below). Opt-in only,
             for tests and demos: it shows invented versions and a
             canned proposal. The preview is still the package's REAL
             rendered document (GET …/files/<doc>.html).

   The stub runs only for `?scribe-api=stub` or
   `COMMAND_CENTER_CONFIG.scribeV2Api: "stub"` (`?scribe-api=live`
   overrides the config). Anything else is live.

   Publishes: window.JBScribeApi = { create, createSseParser,
   ScribeApiError, resolveMode, DEFAULT_MODE, STUB_FIXTURES }.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var DEFAULT_MODE = "live";
  var MAX_INSTRUCTION = 2000;
  var DOCS = { resume: "resume.html", cover_letter: "cover-letter.html" };

  function ScribeApiError(status, code, message, fix) {
    this.name = "ScribeApiError";
    this.status = status || 0;
    this.code = code || "request_failed";
    this.message = safeText(message) || "Scribe can’t reach your JobBored server.";
    this.fix = fix || null;
  }
  ScribeApiError.prototype = Object.create(Error.prototype);
  ScribeApiError.prototype.constructor = ScribeApiError;

  function safeText(value) {
    return typeof value === "string" ? value.trim().slice(0, 300) : "";
  }

  function errorCopy(code) {
    if (code === "http_429") code = "rate_limited";
    if (code === "invalid_json" || code === "schema_invalid") code = "unreadable_reply";
    if (code === "writer_truncated") code = "reply_cut_off";
    if (code === "writer_blocked") code = "provider_refused";
    if (code === "no_pin" || /^http_(401|403|404)$/.test(code || "")) code = "llm_unconfigured";
    if (code === "network" || code === "timeout" || /^http_5\d\d$/.test(code || "")) code = "provider_failed";
    var copy = {
      provider_failed: "The AI provider didn’t respond. Your document is unchanged.",
      unreadable_reply: "Scribe’s reply couldn’t be read. Your document is unchanged.",
      invalid_model: "Blocked: that change doesn’t fit this template’s layout.",
      shape: "Blocked: that change doesn’t fit this template’s layout.",
      rate_limited: "Too many requests right now. Try again in a minute. Your request is kept.",
      too_many_in_flight: "Too many requests right now. Try again in a minute. Your request is kept.",
      reply_cut_off: "Scribe’s reply was cut off. Your document is unchanged.",
      provider_refused: "The AI provider declined this request. Your document is unchanged. Try rewording it.",
      llm_unconfigured: "The AI model isn’t set up correctly. Check it in Settings, then try again.",
      materials_pending: "JobBored is still working on this role. Try again in a moment.",
      stale_base: "Not saved — a newer version exists.",
      server_unreachable: "Scribe can’t reach your JobBored server. Start it, then Retry.",
    };
    return copy[code] || "That didn’t work. Try again.";
  }

  function errorText(err, fallback) {
    var mapped = errorCopy(err && err.code);
    var message = mapped !== "That didn’t work. Try again." ? mapped : (err instanceof ScribeApiError ? safeText(err.message) : "") || fallback || mapped;
    var fix = safeText(err && err.fix);
    return message + (fix ? " " + fix : "");
  }

  function clientDoc(value) { return value === "coverLetter" ? "cover_letter" : value; }

  function openReply(body) {
    if (body && body.proposal) body.proposal.doc = clientDoc(body.proposal.doc);
    return body;
  }

  function resolveMode(win) {
    win = win || root;
    try {
      var search = win.location && win.location.search ? String(win.location.search) : "";
      var m = /[?&]scribe-api=(live|stub)\b/.exec(search);
      if (m) return m[1];
    } catch (e) { /* fall through */ }
    var cfg = win.COMMAND_CENTER_CONFIG;
    if (cfg && (cfg.scribeV2Api === "live" || cfg.scribeV2Api === "stub")) return cfg.scribeV2Api;
    return DEFAULT_MODE;
  }

  /* The hosted-auth transport when it is loaded, plain fetch otherwise
     (same rule as role-materials.js apiFetch). */
  function apiFetch(url, init) {
    var auth = root.JobBoredHostedApiAuth;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    return root.fetch(url, init);
  }

  function wordsOf(text) {
    var m = String(text || "").match(/\S+/g);
    return m ? m.length : 0;
  }

  /* Text words of a rendered HTML document, without parsing it as live DOM. */
  function htmlWords(html) {
    return wordsOf(String(html || "")
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " "));
  }

  /* ------------------------------------------------------------
     SSE over fetch (SPEC §0-3a): EventSource cannot send the
     hosted-auth headers, so the body is read as a stream and split
     into `event:`/`data:` frames here. `: ping` comments are dropped.
     ------------------------------------------------------------ */
  function createSseParser(onEvent) {
    var buffer = "";
    function dispatch(block) {
      var name = "message";
      var data = [];
      var lines = block.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\r$/, "");
        if (!line || line.charAt(0) === ":") continue;
        var colon = line.indexOf(":");
        var field = colon < 0 ? line : line.slice(0, colon);
        var value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") name = value;
        else if (field === "data") data.push(value);
      }
      if (!data.length) return;
      var payload = data.join("\n");
      var parsed;
      try { parsed = JSON.parse(payload); } catch (e) { parsed = { raw: payload }; }
      onEvent({ event: name, data: parsed });
    }
    return {
      push: function (chunk) {
        buffer += String(chunk).replace(/\r\n/g, "\n");
        var at;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
          var block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          dispatch(block);
        }
      },
      end: function () {
        if (buffer.trim()) dispatch(buffer);
        buffer = "";
      },
    };
  }

  /* ------------------------------------------------------------
     C0 fixtures, copied verbatim so the browser never reads docs/.
     tests/scribe-v2-api.test.mjs pins them to the files on disk.
     ------------------------------------------------------------ */
  var STUB_MODEL = {
    contract: "materials.render-model.v1",
    template: { family: "signal", version: "1.0", pageBudget: 1 },
    identity: {
      name: "Alex Example",
      target: "Operations Analyst",
      contact: [{ kind: "email", text: "user@example.com" }],
    },
    documents: {
      resume: {
        templateId: "signal.resume",
        statement: {
          runs: [
            { t: "Operations analyst who reduced fulfillment delays " },
            { n: "38%" },
            { t: " through careful measurement and practical process changes. Builds clear dashboards, tests assumptions, and helps teams turn reliable evidence into daily decisions." },
          ],
          words: 28,
        },
        intro: { runs: [{ t: "Connects operations data to decisions." }], claimIds: ["c14"] },
        sections: [
          {
            kind: "experience", label: "Experience",
            entries: [{
              employerId: "acme", meta: ["2021–2024"], org: "Acme Logistics", seat: "Operations Analyst",
              bullets: [
                { claimId: "c14", runs: [{ t: "Measured carrier delays and built a weekly dashboard for the operations team." }] },
                { claimId: "c19", runs: [{ t: "Documented the handoff process and trained new coordinators." }] },
              ],
            }],
          },
          {
            kind: "earlier", label: "Earlier",
            entries: [{ employerId: "beta", meta: ["2019–2021"], org: "Beta Supply", seat: "Coordinator", line: "Tracked daily shipments and resolved exceptions." }],
          },
          { kind: "credentials", label: "Credentials", lines: [{ claimId: "education", runs: [{ t: "B.A. Economics, Example College." }] }] },
          { kind: "toolkit", label: "Toolkit", groups: [{ label: "Analytics", items: ["SQL", "Spreadsheets"] }] },
        ],
      },
      coverLetter: {
        templateId: "signal.letter",
        salutation: "Dear hiring team,",
        paragraphs: [
          { id: "p1", beat: "thesis", text: "I connect operations data to decisions that teams can act on." },
          { id: "p2", beat: "analytics-proof", claimId: "c14", text: "At Acme Logistics, I helped reduce fulfillment delays 38% through weekly measurement." },
          { id: "p3", beat: "next-step", text: "I would welcome a conversation about improving your daily operations." },
        ],
      },
    },
  };

  /* deriveNodes(STUB_MODEL) from server/materials-nodes.mjs. The client
     never derives node ids itself (SPEC §3.5). */
  var STUB_NODES = [
    { id: "stmt", kind: "statement", text: "Operations analyst who reduced fulfillment delays 38% through careful measurement and practical process changes. Builds clear dashboards, tests assumptions, and helps teams turn reliable evidence into daily decisions.", locked: { whole: false, spans: [[50, 53]] } },
    { id: "intro", kind: "intro", text: "Connects operations data to decisions.", locked: { whole: false, spans: [] } },
    { id: "seat:acme", kind: "seat", text: "Operations Analyst", locked: { whole: true, spans: [] } },
    { id: "b:acme:c14", kind: "bullet", text: "Measured carrier delays and built a weekly dashboard for the operations team.", locked: { whole: false, spans: [] } },
    { id: "b:acme:c19", kind: "bullet", text: "Documented the handoff process and trained new coordinators.", locked: { whole: false, spans: [] } },
    { id: "seat:beta", kind: "seat", text: "Coordinator", locked: { whole: true, spans: [] } },
    { id: "line:beta", kind: "line", text: "Tracked daily shipments and resolved exceptions.", locked: { whole: false, spans: [] } },
    { id: "cred:education", kind: "credential", text: "B.A. Economics, Example College.", locked: { whole: true, spans: [] } },
    { id: "tool:Analytics", kind: "toolkit", text: "SQL, Spreadsheets", locked: { whole: false, spans: [] } },
    { id: "sal", kind: "salutation", text: "Dear hiring team,", locked: { whole: false, spans: [] } },
    { id: "p:p1", kind: "paragraph", text: "I connect operations data to decisions that teams can act on.", locked: { whole: false, spans: [] } },
    { id: "p:p2", kind: "paragraph", text: "At Acme Logistics, I helped reduce fulfillment delays 38% through weekly measurement.", locked: { whole: false, spans: [[54, 57]] } },
    { id: "p:p3", kind: "paragraph", text: "I would welcome a conversation about improving your daily operations.", locked: { whole: false, spans: [] } },
  ];

  var STUB_TRANSCRIPT = [
    { event: "stage", data: { stage: "reading" } },
    { event: "stage", data: { stage: "drafting" } },
    { event: "stage", data: { stage: "checking", done: 1, total: 3 } },
    { event: "op", data: { op: { opId: "o1", op: "replace", node: "b:acme:c14", text: "Measured carrier delays and reduced delays through a weekly operations dashboard." } } },
    { event: "blocked", data: { op: { opId: "o4" }, reason: "locked", detail: "That would change a locked fact." } },
    { event: "stage", data: { stage: "measuring" } },
    { event: "proposal", data: { summary: { changes: 1, removals: 0, wordsDelta: 0, lossPct: 0, pages: 1, unverified: 0 } } },
    { event: "done", data: { status: "ready" } },
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* Version rows in the §3.2 shape, minted relative to `now` so the
     relative times read naturally. `n` is derived from order, as the
     server derives it from sorted run timestamps (R13). */
  function stubVersionRows(doc, now, family) {
    var hour = 3600 * 1000;
    var rows = doc === "cover_letter"
      ? [
        { runId: "stub-letter-r0", createdAt: now - 26 * hour, source: "draft", label: "Drafted", words: 212 },
        { runId: "stub-letter-r1", createdAt: now - 3 * hour, source: "edit", label: "Warmer opening", prompt: "Make the opening warmer", parentRunId: "stub-letter-r0", words: 208 },
      ]
      : [
        { runId: "stub-r0", createdAt: now - 50 * hour, source: "draft", label: "Drafted", words: 402 },
        { runId: "stub-r1", createdAt: now - 26 * hour, source: "edit", label: "Match JD keywords", prompt: "Match JD keywords", parentRunId: "stub-r0", words: 414 },
        { runId: "stub-r2", createdAt: now - 25 * hour, source: "manual", label: "Manual edit", parentRunId: "stub-r1", words: 417 },
        { runId: "stub-r3", createdAt: now - 2 * hour, source: "edit", label: "Shorter summary", prompt: "Shorter summary", parentRunId: "stub-r2", words: 386 },
      ];
    return rows.map(function (row, i) {
      return {
        runId: row.runId,
        n: i,
        createdAt: new Date(row.createdAt).toISOString(),
        source: row.source,
        label: row.label,
        prompt: row.prompt,
        parentRunId: row.parentRunId,
        pinned: i === 0,
        starred: row.runId === "stub-r1",
        pages: 1,
        words: row.words,
        family: family || "signal",
      };
    });
  }

  function createStub(opts) {
    var fetchImpl = opts.fetchImpl;
    var schedule = opts.schedule || function (fn, ms) { return root.setTimeout(fn, ms); };
    var stepMs = typeof opts.stepMs === "number" ? opts.stepMs : 140;
    var now = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
    var fileBase = opts.base + "/api/applications/" + encodeURIComponent(opts.slug);
    var state = { versions: {}, proposals: {}, seq: 0 };

    function versionsFor(doc) {
      if (!state.versions[doc]) state.versions[doc] = stubVersionRows(doc, now(), opts.family);
      return state.versions[doc];
    }

    function listing(doc) {
      var rows = versionsFor(doc);
      var sorted = rows.slice().sort(function (a, b) { return b.n - a.n; });
      return { versions: clone(sorted), currentRunId: rows[rows.length - 1].runId };
    }

    function findRun(runId) {
      var docs = Object.keys(state.versions);
      for (var i = 0; i < docs.length; i++) {
        var rows = state.versions[docs[i]];
        for (var j = 0; j < rows.length; j++) if (rows[j].runId === runId) return { doc: docs[i], row: rows[j] };
      }
      return null;
    }

    function appendRun(doc, fields) {
      var rows = versionsFor(doc);
      var prev = rows[rows.length - 1];
      state.seq += 1;
      var row = {
        runId: "stub-new-" + state.seq,
        n: prev.n + 1,
        createdAt: new Date(now()).toISOString(),
        source: fields.source,
        label: fields.label,
        prompt: fields.prompt,
        parentRunId: prev.runId,
        pinned: false,
        starred: false,
        pages: prev.pages,
        words: prev.words,
        family: prev.family,
      };
      if (fields.restoredFrom) row.restoredFrom = fields.restoredFrom;
      rows.push(row);
      return row;
    }

    return {
      mode: "stub",
      getOpenEdit: function () {
        var ids = Object.keys(state.proposals);
        var p = ids.length ? state.proposals[ids[0]] : null;
        return Promise.resolve({ proposal: p ? { proposalId: ids[0], doc: p.doc, baseRunId: p.baseRunId,
          instruction: p.instruction, status: p.status || "pending", ops: clone(p.ops), blocked: [], summary: p.summary } : null });
      },
      listVersions: function (doc) {
        return Promise.resolve(listing(doc || "resume"));
      },
      getModel: function (runId) {
        if (!findRun(runId)) {
          return Promise.reject(new ScribeApiError(404, "run_not_found", "That version is not in this package."));
        }
        return Promise.resolve({ model: clone(STUB_MODEL), nodes: clone(STUB_NODES) });
      },
      /* The one real read in stub mode: the package's published render. */
      preview: function (body) {
        var doc = body && body.doc === "cover_letter" ? "cover_letter" : "resume";
        var url = fileBase + "/files/" + DOCS[doc];
        return fetchImpl(url, { credentials: "omit", cache: "no-store" }).then(function (res) {
          if (!res.ok) {
            throw new ScribeApiError(res.status, "preview_unavailable",
              "The " + (doc === "resume" ? "resume" : "cover letter") + " didn’t load.");
          }
          return res.text();
        }).then(function (html) {
          return { html: html, words: htmlWords(html), pageBudget: STUB_MODEL.template.pageBudget };
        });
      },
      startEdit: function (body) {
        var doc = (body && body.doc) || "resume";
        var instruction = String((body && body.instruction) || "");
        if (!instruction.trim()) return Promise.reject(new ScribeApiError(400, "instruction_required", "Say what to change first."));
        if (instruction.length > MAX_INSTRUCTION) {
          return Promise.reject(new ScribeApiError(400, "instruction_too_long", "Keep the request under " + MAX_INSTRUCTION + " characters."));
        }
        var current = listing(doc).currentRunId;
        if (body.baseRunId && body.baseRunId !== current) {
          return Promise.reject(new ScribeApiError(409, "stale_base", "A newer version exists.", "reload"));
        }
        state.seq += 1;
        var id = "stub-p" + state.seq;
        state.proposals[id] = { doc: doc, baseRunId: body.baseRunId || current, instruction: instruction, ops: [], stopped: false, status: "pending" };
        return Promise.resolve({ proposalId: id, streamUrl: fileBase + "/edits/" + id + "/stream" });
      },
      stream: function (proposalId, handlers) {
        var proposal = state.proposals[proposalId];
        var onEvent = (handlers && handlers.onEvent) || function () {};
        var signal = handlers && handlers.signal;
        if (!proposal) return Promise.reject(new ScribeApiError(404, "proposal_not_found", "That request is no longer open."));
        return new Promise(function (resolve) {
          var i = 0;
          function step() {
            if (proposal.stopped || (signal && signal.aborted)) {
              onEvent({ event: "done", data: { status: "partial" } });
              resolve("partial");
              return;
            }
            var frame = STUB_TRANSCRIPT[i++];
            if (!frame) { resolve("ready"); return; }
            if (frame.event === "op") proposal.ops.push(frame.data.op);
            if (frame.event === "proposal") proposal.summary = frame.data.summary;
            if (frame.event === "done") proposal.status = frame.data.status;
            onEvent(clone(frame));
            if (frame.event === "done") { resolve(frame.data.status); return; }
            schedule(step, stepMs);
          }
          schedule(step, stepMs);
        });
      },
      stopEdit: function (proposalId) {
        var proposal = state.proposals[proposalId];
        if (!proposal) return Promise.reject(new ScribeApiError(404, "proposal_not_found", "That request is no longer open."));
        proposal.stopped = true;
        proposal.status = "partial";
        return Promise.resolve({ status: "partial", ops: clone(proposal.ops) });
      },
      acceptEdit: function (proposalId, body) {
        var proposal = state.proposals[proposalId];
        if (!proposal) return Promise.reject(new ScribeApiError(404, "proposal_not_found", "That request is no longer open."));
        var accepted = (body && body.accept) || [];
        var row = appendRun(proposal.doc, { source: "edit", label: proposal.instruction, prompt: proposal.instruction });
        delete state.proposals[proposalId];
        return Promise.resolve({
          run: { runId: row.runId, n: row.n, pages: row.pages, pdf: "stale", accepted: accepted.slice() },
          versions: listing(proposal.doc).versions,
        });
      },
      rejectEdit: function (proposalId) {
        delete state.proposals[proposalId];
        return Promise.resolve(null);
      },
      manualEdit: function (body) {
        var doc = (body && body.doc) || "resume";
        var row = appendRun(doc, { source: "manual", label: "Manual edit" });
        return Promise.resolve({ run: { runId: row.runId, n: row.n, pages: row.pages, pdf: "stale" }, versions: listing(doc).versions });
      },
      restore: function (runId) {
        var hit = findRun(runId);
        if (!hit) return Promise.reject(new ScribeApiError(404, "run_not_found", "That version is not in this package."));
        var row = appendRun(hit.doc, { source: "restore", label: "Restored from v" + hit.row.n, restoredFrom: runId });
        return Promise.resolve({ run: clone(row) });
      },
      star: function (runId, starred) {
        var hit = findRun(runId);
        if (!hit) return Promise.reject(new ScribeApiError(404, "run_not_found", "That version is not in this package."));
        hit.row.starred = !!starred;
        return Promise.resolve({ ok: true });
      },
    };
  }

  function createLive(opts) {
    var fetchImpl = opts.fetchImpl;
    var prefix = opts.base + "/api/applications/" + encodeURIComponent(opts.slug);

    function errorFrom(res, body) {
      var code = safeText(body && body.code) || "status_" + res.status;
      var message = safeText(body && body.message) || safeText(body && body.error) || errorCopy(code);
      var err = new ScribeApiError(res.status, code, message, safeText(body && (body.fix || body.nextStep)) || null);
      err.detail = safeText(body && body.detail) || null;
      err.retryable = body && body.retryable;
      if (body && Array.isArray(body.proposals)) {
        err.proposals = body.proposals.map(function (p) {
          return { proposalId: p.proposalId, doc: clientDoc(p.doc), status: p.status };
        });
      }
      return err;
    }

    function failedResponse(res, allowSaved) {
      return res.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (e) { /* not JSON */ }
        var run = body && body.run;
        if (allowSaved && res.status === 503 && body && body.code === "browser_unavailable" &&
            run && typeof run.runId === "string" && run.runId && run.pdf === "stale") {
          body.textSaved = true;
          body.httpStatus = 503;
          return body;
        }
        throw errorFrom(res, body);
      }, function () { throw errorFrom(res, null); });
    }

    function call(method, path, body, allowSaved) {
      var init = { method: method, credentials: "omit", cache: "no-store", headers: {} };
      if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      return fetchImpl(prefix + path, init).then(function (res) {
        if (!res.ok) return failedResponse(res, allowSaved);
        if (res.status === 204) return null;
        return res.json();
      }, function () {
        throw new ScribeApiError(0, "server_unreachable", errorCopy("server_unreachable"), "Retry");
      });
    }

    return {
      mode: "live",
      getOpenEdit: function () { return call("GET", "/edits/open").then(openReply); },
      listVersions: function (doc) { return call("GET", "/versions?doc=" + encodeURIComponent(doc || "resume")); },
      getModel: function (runId) { return call("GET", "/versions/" + encodeURIComponent(runId) + "/model"); },
      preview: function (body) { return call("POST", "/preview", body); },
      startEdit: function (body) { return call("POST", "/edits", body); },
      stream: function (proposalId, handlers) {
        var onEvent = (handlers && handlers.onEvent) || function () {};
        var init = { method: "GET", credentials: "omit", cache: "no-store", headers: { Accept: "text/event-stream" } };
        if (handlers && handlers.signal) init.signal = handlers.signal;
        var last = "ready";
        var parser = createSseParser(function (frame) {
          if (frame.event === "done" && frame.data && frame.data.status) last = frame.data.status;
          onEvent(frame);
        });
        return fetchImpl(prefix + "/edits/" + encodeURIComponent(proposalId) + "/stream", init).then(function (res) {
          if (!res.ok) return failedResponse(res, false);
          if (!res.body || typeof res.body.getReader !== "function") {
            return res.text().then(function (text) { parser.push(text); parser.end(); return last; });
          }
          var reader = res.body.getReader();
          var decoder = new root.TextDecoder();
          function pump() {
            return reader.read().then(function (chunk) {
              if (chunk.done) { parser.push(decoder.decode()); parser.end(); return last; }
              parser.push(decoder.decode(chunk.value, { stream: true }));
              return pump();
            });
          }
          return pump();
        }).catch(function (err) {
          if (err && err.name === "AbortError") return "partial";
          throw err;
        });
      },
      stopEdit: function (id) { return call("POST", "/edits/" + encodeURIComponent(id) + "/stop", {}); },
      acceptEdit: function (id, body) { return call("POST", "/edits/" + encodeURIComponent(id) + "/accept", body, true); },
      rejectEdit: function (id) { return call("DELETE", "/edits/" + encodeURIComponent(id)); },
      manualEdit: function (body) { return call("POST", "/edits/manual", body, true); },
      restore: function (runId, body) { return call("POST", "/versions/" + encodeURIComponent(runId) + "/restore", body || {}, true); },
      star: function (runId, starred) { return call("PUT", "/versions/" + encodeURIComponent(runId) + "/star", { starred: !!starred }); },
    };
  }

  /* Open a proposal; on `409 stale_base` re-read the current run and try
     once more, so a version saved in another tab never wedges the desk. */
  function withStaleBaseRetry(client) {
    var startEdit = client.startEdit;
    client.propose = function (body) {
      return startEdit(body).catch(function (err) {
        if (!err || err.status !== 409 || err.code !== "stale_base") throw err;
        if (Array.isArray(body.scope)) throw new ScribeApiError(409, "selection_stale", "Your selection changed. Select the text again.");
        return client.listVersions(body.doc).then(function (listing) {
          var retry = {};
          Object.keys(body).forEach(function (k) { retry[k] = body[k]; });
          retry.baseRunId = listing.currentRunId;
          return startEdit(retry).then(function (res) {
            res.rebasedTo = listing.currentRunId;
            return res;
          });
        });
      });
    };
    return client;
  }

  function create(opts) {
    opts = opts || {};
    var base = String(opts.base || "").replace(/\/+$/, "");
    var slug = String(opts.slug || "");
    if (!slug) throw new ScribeApiError(0, "slug_required", "Scribe needs a materials package to open.");
    var mode = opts.mode === "live" || opts.mode === "stub" ? opts.mode : resolveMode();
    var args = {
      base: base,
      slug: slug,
      fetchImpl: opts.fetchImpl || apiFetch,
      schedule: opts.schedule,
      stepMs: opts.stepMs,
      now: opts.now,
      family: opts.family,
    };
    return withStaleBaseRetry(mode === "live" ? createLive(args) : createStub(args));
  }

  root.JBScribeApi = {
    DEFAULT_MODE: DEFAULT_MODE,
    MAX_INSTRUCTION: MAX_INSTRUCTION,
    create: create,
    createSseParser: createSseParser,
    resolveMode: resolveMode,
    ScribeApiError: ScribeApiError,
    errorCopy: errorCopy,
    errorText: errorText,
    STUB_FIXTURES: { model: STUB_MODEL, nodes: STUB_NODES, transcript: STUB_TRANSCRIPT },
  };
})(typeof window !== "undefined" ? window : globalThis);
