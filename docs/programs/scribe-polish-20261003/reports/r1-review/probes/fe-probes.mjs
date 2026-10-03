/* R1 reviewer probes for scribe-v2.js request identity, recovery and copy.
   Same harness as tests/scribe-v2-lifecycle.test.mjs (jb-dom under node:vm). */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const tree = resolve(process.argv[2] || ".");
const { FakeDocument, makeEnv } = await import(pathToFileURL(join(tree, "tests/fixtures/jb-dom.mjs")).href);
const read = (rel) => readFileSync(join(tree, rel), "utf8");
const settle = () => new Promise((done) => setImmediate(done));
const flush = async () => { for (let i = 0; i < 10; i++) await settle(); };
const tap = (el) => { if (!el) throw new Error("control missing"); el.dispatchEvent({ type: "click", target: el, bubbles: true }); };
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const ROP = { opId: "o1", op: "replace", node: "b:acme:c14", text: "Measured delays through a weekly dashboard.", flags: [], facts: [] };
const ROP2 = { opId: "o2", op: "replace", node: "b:acme:c14", text: "Second change.", flags: [], facts: [] };

function rig(docName = "resume") {
  let open = null; let seq = 0; const calls = [];
  const api = {
    calls, get open() { return open; }, set open(p) { open = p; },
    listVersions: async () => ({ currentRunId: "r2", versions: [{ runId: "r2", n: 2, words: 20, pages: 1 }, { runId: "r1", n: 1, words: 15, pages: 1 }] }),
    getModel: async () => ({ model: {}, nodes: [{ id: "b:acme:c14", kind: "bullet", text: "original block" }] }),
    preview: async (body) => ({ html: '<p data-node="b:acme:c14">' + body.baseRunId + " original block</p>", words: 20 }),
    getOpenEdit: async () => { calls.push(["open"]); return { proposal: open ? JSON.parse(JSON.stringify(open)) : null }; },
    propose: async (body) => { calls.push(["post", body.instruction]); open = { proposalId: "p" + (++seq), doc: body.doc, baseRunId: body.baseRunId, instruction: body.instruction, status: "pending", ops: [], blocked: [] }; return { proposalId: open.proposalId }; },
    stream: async (id, handlers) => { calls.push(["stream", id]); if (open) { open.ops = [ROP]; open.status = "ready"; } handlers.onEvent({ event: "op", data: { op: ROP } }); handlers.onEvent({ event: "done", data: { status: "ready" } }); return "ready"; },
    stopEdit: async (id) => { calls.push(["stop", id]); if (open) open.status = "partial"; return { status: "partial", ops: open?.ops || [] }; },
    rejectEdit: async (id) => { calls.push(["delete", id]); open = null; },
    acceptEdit: async (id) => { calls.push(["accept", id]); open = null; return { run: { runId: "r3", n: 3, pdf: "ready" } }; },
    star: async () => ({}),
  };
  const win = makeEnv({ bodyClass: "jb-v2" });
  win.Date = Date;
  vm.runInNewContext(read("scribe-v2-api.js"), win);
  vm.runInNewContext(read("scribe-v2-diff.js"), win);
  vm.runInNewContext(read("scribe-v2.js"), win);
  const edit = win.document.createElement("button");
  win.document.body.appendChild(edit);
  function mount(which = docName) {
    const ctl = win.JB_SCRIBE_V2.open({ slug: "acme-platform-engineer", doc: which, api, opener: edit });
    const frame = ctl.refs.frame; let html = "";
    Object.defineProperty(frame, "srcdoc", { configurable: true, get: () => html, set(value) {
      html = value;
      setImmediate(() => {
        const inner = new FakeDocument();
        const p = inner.createElement("p"); p.setAttribute("data-node", "b:acme:c14");
        p.textContent = value.replace(/<[^>]+>/g, ""); inner.body.appendChild(p);
        frame.contentDocument = inner; frame.onload?.();
      });
    } });
    return ctl;
  }
  async function submit(ctl, text = "Make it punchier") {
    ctl.refs.prompt.value = text;
    ctl.refs.composer.dispatchEvent({ type: "submit", target: ctl.refs.composer });
    await flush();
  }
  return { api, calls, win, mount, submit };
}
const snap = (ctl) => ({
  busy: ctl.state.busy, loading: ctl.state.loading, request: ctl.request ? "set" : null,
  proposal: ctl.state.proposal ? { id: ctl.state.proposal.id, status: ctl.state.proposal.status, ops: ctl.state.proposal.ops.length } : null,
  status: ctl.refs.status.hasAttribute("hidden") ? null : `[${ctl.refs.status.getAttribute("data-state")}] ${ctl.refs.statusText.textContent}` + (ctl.refs.statusAction.hasAttribute("hidden") ? "" : ` <${ctl.refs.statusAction.textContent}>`),
  recover: ctl.refs.recover.hasAttribute("hidden") ? null : ctl.refs.recover.textContent,
  sendDisabled: ctl.refs.send.getAttribute("aria-disabled"),
});
const lastLog = (ctl, n = 2) => Array.from(ctl.refs.log.children).slice(-n).map((el) => el.textContent);
const out = (label, value) => console.log(label, JSON.stringify(value));

{ /* P1: a locked-fact block as the candidate server now emits it. */
  const t = rig();
  t.api.stream = async (id, h) => { h.onEvent({ event: "blocked", data: { op: { opId: "x1" }, reason: "locked", detail: "This edit would change a protected fact." } }); h.onEvent({ event: "op", data: { op: ROP } }); h.onEvent({ event: "done", data: { status: "ready" } }); return "ready"; };
  const ctl = t.mount(); await flush(); await t.submit(ctl);
  out("P1 locked row transcript:", Array.from(ctl.refs.log.children).map((el) => el.textContent).filter((text) => /Blocked/.test(text)));
  ctl.close();
}
{ /* P2: recover banner right after this session's own request finishes. */
  const t = rig(); const ctl = t.mount(); await flush(); await t.submit(ctl);
  out("P2 after a normal run:", snap(ctl));
  ctl.close();
}
{ /* P3: Stop lands just after the server finished (stop → 409 proposal_not_running). */
  const t = rig(); const gate = defer(); let handlers;
  t.api.stream = (id, h) => { handlers = h; h.onEvent({ event: "op", data: { op: ROP } }); return gate.promise; };
  t.api.stopEdit = async () => { throw Object.assign(new Error("Proposal is not running"), { status: 409, code: "proposal_not_running" }); };
  const ctl = t.mount(); await flush(); await t.submit(ctl);
  tap(ctl.refs.stage.querySelector('[data-scribe="stop"]')); await flush();
  handlers.onEvent({ event: "op", data: { op: ROP2 } }); handlers.onEvent({ event: "proposal", data: { summary: { changes: 2 } } }); handlers.onEvent({ event: "done", data: { status: "ready" } });
  t.api.open = { ...t.api.open, status: "ready", ops: [ROP, ROP2] };
  gate.resolve("ready"); await flush();
  out("P3 stop after the server finished:", snap(ctl));
  tap(ctl.refs.statusAction); await flush();
  out("P3 after Try again:", snap(ctl));
  ctl.close();
}
{ /* P4: Discard from the recover banner while a continued request is streaming. */
  const t = rig(); const gate = defer();
  t.api.open = { proposalId: "p9", doc: "resume", baseRunId: "r2", instruction: "earlier", status: "pending", ops: [], blocked: [] };
  t.api.stream = () => gate.promise;
  const ctl = t.mount(); await flush();
  tap(ctl.refs.recover.querySelector('[data-action="continue-request"]')); await flush();
  out("P4 while continuing:", snap(ctl));
  tap(ctl.refs.recover.querySelector('[data-action="discard-request"]')); await flush();
  gate.resolve("failed"); await flush();
  out("P4 after Discard + stream end:", snap(ctl));
  await t.submit(ctl, "A new request after discarding");
  out("P4 new request posted:", { posts: t.calls.filter((c) => c[0] === "post").length, prompt: ctl.refs.prompt.value, stageText: ctl.refs.stage.textContent.slice(0, 60) });
  ctl.close();
}
{ /* P5: one shape-blocked op beside a valid op. */
  const t = rig();
  t.api.stream = async (id, h) => { t.api.open.ops = [ROP]; t.api.open.status = "ready"; h.onEvent({ event: "op", data: { op: ROP } }); h.onEvent({ event: "blocked", data: { op: { opId: "x2" }, reason: "shape", detail: "This edit exceeds the document's template limits." } }); h.onEvent({ event: "done", data: { status: "ready" } }); return "ready"; };
  const ctl = t.mount(); await flush(); await t.submit(ctl);
  out("P5 one valid op + one shape block:", snap(ctl));
  tap(ctl.refs.statusAction); await flush();
  out("P5 after its Try again:", { status: snap(ctl).status, prompt: ctl.refs.prompt.value });
  ctl.close();
}
{ /* P6: accept and Save on a recovered proposal that is still pending. */
  const t = rig();
  t.api.open = { proposalId: "p9", doc: "resume", baseRunId: "r2", instruction: "earlier", status: "pending", ops: [ROP], blocked: [] };
  t.api.acceptEdit = async () => { t.calls.push(["accept"]); throw Object.assign(new Error("Proposal is not ready"), { status: 409, code: "proposal_not_ready" }); };
  const ctl = t.mount(); await flush();
  const accept = ctl.refs.host.querySelector('[data-review="accept"]');
  out("P6 pending recovery offers Accept:", { acceptButton: !!accept, recover: snap(ctl).recover });
  if (accept) { tap(accept); await flush(); const save = ctl.refs.host.querySelector('[data-review="save"]'); if (save) { tap(save); await flush(); } out("P6 after Save:", { accepts: t.calls.filter((c) => c[0] === "accept").length, status: snap(ctl).status }); }
  ctl.close();
}
{ /* P7: switch documents while a save is in flight. */
  const t = rig(); const gate = defer();
  const ctl = t.mount(); await flush(); await t.submit(ctl);
  t.api.acceptEdit = () => { t.api.open = { ...t.api.open, status: "accepting" }; return gate.promise; };
  tap(ctl.refs.host.querySelector('[data-review="accept"]')); await flush();
  tap(ctl.refs.host.querySelector('[data-review="save"]')); await flush();
  ctl.setDoc("cover_letter"); await flush();
  t.api.open = null; gate.resolve({ run: { runId: "r3", n: 3, pdf: "ready" } }); await flush();
  out("P7 after the save finished:", snap(ctl));
  await t.submit(ctl, "Tighten the opening");
  out("P7 Send:", { posts: t.calls.filter((c) => c[0] === "post").length, status: snap(ctl).status });
  ctl.close();
}
{ /* P8: Continue on a sibling-document request when the second GET open fails. */
  const t = rig("cover_letter"); let reads = 0;
  const stored = { proposalId: "p9", doc: "resume", baseRunId: "r2", instruction: "earlier", status: "pending", ops: [], blocked: [] };
  t.api.getOpenEdit = async () => { if (++reads === 1) return { proposal: { ...stored } }; throw Object.assign(new Error("unavailable"), { status: 0 }); };
  const ctl = t.mount(); await flush();
  tap(ctl.refs.recover.querySelector('[data-action="continue-request"]')); await flush();
  out("P8 Continue with no hydrated proposal:", snap(ctl));
  ctl.close();
}
{ /* P9: what the live client shows for the route limiter's 429 and for a stale save. */
  const t = rig();
  const reply = (status, body) => async () => ({ ok: false, status, text: async () => JSON.stringify(body), json: async () => body });
  const live = (fetchImpl) => t.win.JBScribeApi.create({ mode: "live", slug: "acme", base: "http://example.invalid", fetchImpl });
  const limited = await live(reply(429, { error: "Too many AI and rendering requests this minute.", code: "rate_limited", nextStep: "Try again in 12 s.", retryable: true })).propose({ doc: "resume" }).catch((e) => e);
  const pending = await live(reply(409, { error: "An edit is already in progress", code: "materials_pending", retryable: false })).acceptEdit("p1", {}).catch((e) => e);
  out("P9 429 rate_limited:", { message: limited.message, fix: limited.fix, briefCopy: t.win.JBScribeApi.errorCopy("rate_limited") });
  out("P9 409 materials_pending on accept:", { message: pending.message, briefCopy: t.win.JBScribeApi.errorCopy("materials_pending") });
}
