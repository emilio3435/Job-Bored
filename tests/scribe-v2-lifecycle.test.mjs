/* scribe-v2-lifecycle.test.mjs — EDITOR lane F1.

   Scribe v2 is ABSENT until a role's Edit button binds it to a package
   (SPEC §1): open() appends one <jb-scribe> to <body>, close() removes it
   and hands focus back to the Edit button. The old Scribe kept an empty,
   100vh region in the page for every signed-in user (recon R1, R2); these
   tests pin that the new one leaves nothing behind, and that each way out
   (Close, Esc, the role closing, a second open) cleans up after itself.

   Harness: tests/fixtures/jb-dom.mjs under node:vm, with a scripted API
   object in place of scribe-v2-api.js so each promise settles on demand. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { FakeDocument, makeEnv } from "./fixtures/jb-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const VERSIONS = {
  resume: {
    currentRunId: "r2",
    versions: [
      { runId: "r2", n: 2, createdAt: "2026-09-27T16:00:00.000Z", source: "edit", label: "Shorter summary", prompt: "Shorter summary", parentRunId: "r1", pinned: false, starred: false, pages: 1, words: 380, family: "signal" },
      { runId: "r1", n: 1, createdAt: "2026-09-26T16:00:00.000Z", source: "manual", label: "Manual edit", parentRunId: "r0", pinned: false, starred: true, pages: 1, words: 410, family: "signal" },
      { runId: "r0", n: 0, createdAt: "2026-09-25T16:00:00.000Z", source: "draft", label: "Drafted", pinned: true, starred: false, pages: 1, words: 402, family: "signal" },
    ],
  },
  cover_letter: {
    currentRunId: "l0",
    versions: [{ runId: "l0", n: 0, createdAt: "2026-09-25T16:00:00.000Z", source: "draft", label: "Drafted", pinned: true, starred: false, pages: 1, words: 210, family: "signal" }],
  },
};

function scriptedApi() {
  const calls = [];
  const api = {
    mode: "stub",
    listVersions: (doc) => { calls.push(["listVersions", doc]); return Promise.resolve(JSON.parse(JSON.stringify(VERSIONS[doc]))); },
    preview: (body) => { calls.push(["preview", body.doc, body.baseRunId]); return Promise.resolve({ html: `<html><body><main data-page="1">${body.doc} render</main></body></html>`, words: 2, pageBudget: 1 }); },
    propose: (body) => { calls.push(["propose", body.instruction]); return new Promise(() => {}); },
    stream: () => new Promise(() => {}),
    stopEdit: (id) => { calls.push(["stopEdit", id]); return Promise.resolve({ status: "partial", ops: [] }); },
    rejectEdit: () => Promise.resolve(null),
    star: (runId, starred) => { calls.push(["star", runId, starred]); return Promise.resolve({ ok: true }); },
  };
  return { api, calls };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function boot() {
  const win = makeEnv({ bodyClass: "jb-v2" });
  win.Date = Date;
  win.JBScribeApi = { MAX_INSTRUCTION: 2000, create: () => { throw new Error("tests pass their own api"); } };
  vm.runInNewContext(read("scribe-v2.js"), win);
  const doc = win.document;
  const section = doc.createElement("section");
  section.className = "brief-materials";
  section.setAttribute("data-slug", "acme-platform-engineer");
  const edit = doc.createElement("button");
  edit.setAttribute("data-action", "materials-edit");
  edit.setAttribute("data-feature", "resume");
  section.appendChild(edit);
  doc.body.appendChild(section);
  const events = [];
  win.addEventListener("jb:scribe:opened", (e) => events.push(["opened", JSON.parse(JSON.stringify(e.detail))]));
  win.addEventListener("jb:scribe:closed", (e) => events.push(["closed", JSON.parse(JSON.stringify(e.detail))]));
  return { win, doc, edit, section, events };
}

function openDesk(env, extra = {}) {
  const { api, calls } = scriptedApi();
  const ctl = env.win.JB_SCRIBE_V2.open({ slug: "acme-platform-engineer", doc: "resume", opener: env.edit, api, title: "Platform Engineer", company: "Acme", ...extra });
  return { ctl, api, calls };
}

const desks = (doc) => doc.body.querySelectorAll("jb-scribe");

function key(target, k, extra = {}) {
  return { type: "keydown", key: k, target, bubbles: true, ...extra };
}

describe("Scribe v2 is absent until a package binds it (R1)", () => {
  it("should put no Scribe node in the page on boot", () => {
    const env = boot();
    assert.equal(env.win.JB_SCRIBE_V2.boot(), true);
    assert.equal(desks(env.doc).length, 0);
    assert.equal(env.win.JB_SCRIBE_V2.isOpen(), false);
  });

  it("should mount nothing without a package slug", () => {
    const env = boot();
    const { api } = scriptedApi();
    assert.equal(env.win.JB_SCRIBE_V2.open({ doc: "resume", api, opener: env.edit }), null);
    assert.equal(desks(env.doc).length, 0);
  });
});

describe("Scribe v2 open", () => {
  it("should mount one modal dialog bound to the role's package", async () => {
    const env = boot();
    const { calls } = openDesk(env);
    const nodes = desks(env.doc);
    assert.equal(nodes.length, 1);
    const host = nodes[0];
    assert.equal(host.getAttribute("data-slug"), "acme-platform-engineer");
    const dialog = host.querySelector('[role="dialog"]');
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    const title = env.doc.getElementById(dialog.getAttribute("aria-labelledby"));
    assert.equal(title.textContent, "Scribe");
    assert.equal(host.querySelector(".scribe__role").textContent, "Platform Engineer · Acme");
    assert.ok(env.doc.documentElement.classList.contains("jb-scribe-open"), "the page behind stops scrolling");
    assert.equal(env.doc.activeElement, host.querySelector("textarea"), "focus lands in the composer");
    assert.deepEqual(env.events[0], ["opened", { slug: "acme-platform-engineer", doc: "resume" }]);

    await settle();
    assert.deepEqual(calls.slice(0, 2), [["listVersions", "resume"], ["preview", "resume", "r2"]]);
  });

  it("should render the real document in a script-less sandboxed srcdoc iframe", async () => {
    const env = boot();
    openDesk(env);
    await settle();
    const frame = desks(env.doc)[0].querySelector("iframe");
    assert.equal(frame.getAttribute("sandbox"), "allow-same-origin", "no allow-scripts, ever");
    assert.match(frame.srcdoc, /resume render/);
    assert.equal(frame.getAttribute("src"), null, "never a URL the CSP frame-src would block");
    assert.equal(frame.getAttribute("title"), "Resume preview, version 2");
  });

  it("should list every version newest first, marking the current one", async () => {
    const env = boot();
    openDesk(env);
    await settle();
    const host = desks(env.doc)[0];
    const rows = host.querySelectorAll(".scribe__ver");
    assert.deepEqual(rows.map((r) => r.querySelector(".scribe__ver-n").textContent), ["v2", "v1", "v0"]);
    assert.equal(rows[0].getAttribute("aria-current"), "true");
    assert.equal(rows[1].getAttribute("aria-current"), null);
    assert.equal(rows[0].querySelector(".scribe__ver-what").textContent, "Shorter summary");
    assert.ok(rows[0].querySelector("q"), "a prompt reads as a quotation");
    assert.match(rows[0].querySelector(".scribe__ver-meta").textContent, /−30 words · 1 page · Signal · Current/);
    assert.equal(rows[2].querySelector(".scribe__ver-pin").textContent, "Pinned", "v0 is pinned, not starrable");
    assert.equal(rows[1].querySelector("[data-star]").getAttribute("aria-pressed"), "true");
  });

  it("should fill the composer from a chip without sending", async () => {
    const env = boot();
    const { calls } = openDesk(env);
    await settle();
    const host = desks(env.doc)[0];
    const chip = host.querySelector('[data-chip="Punchier"]');
    chip.dispatchEvent({ type: "click", target: chip });
    assert.equal(host.querySelector("textarea").value, "Punchier");
    assert.ok(!calls.some((c) => c[0] === "propose"), "a chip never sends");
  });

  it("should switch documents through a real tablist", async () => {
    const env = boot();
    const { calls } = openDesk(env);
    await settle();
    const host = desks(env.doc)[0];
    const tabs = host.querySelectorAll('[data-scribe="doc-tabs"] [role="tab"]');
    assert.equal(tabs[0].getAttribute("aria-selected"), "true");
    tabs[0].dispatchEvent(key(tabs[0], "ArrowRight"));
    await settle();
    assert.equal(tabs[1].getAttribute("aria-selected"), "true");
    assert.equal(tabs[1].getAttribute("tabindex"), "0");
    assert.equal(tabs[0].getAttribute("tabindex"), "-1");
    assert.equal(env.doc.activeElement, tabs[1]);
    assert.ok(calls.some((c) => c[0] === "listVersions" && c[1] === "cover_letter"));
    assert.match(desks(env.doc)[0].querySelector("iframe").srcdoc, /cover_letter render/);
  });
});

describe("Scribe v2 close", () => {
  it("should remove the node and return focus to the Edit button", async () => {
    const env = boot();
    const { ctl } = openDesk(env);
    await settle();
    const focusBefore = env.edit.focusCount;
    const close = desks(env.doc)[0].querySelector('[data-scribe="close"]');
    close.dispatchEvent({ type: "click", target: close });
    assert.equal(desks(env.doc).length, 0);
    assert.equal(env.win.JB_SCRIBE_V2.isOpen(), false);
    assert.equal(env.edit.focusCount, focusBefore + 1);
    assert.equal(env.doc.activeElement, env.edit);
    assert.ok(!env.doc.documentElement.classList.contains("jb-scribe-open"));
    assert.deepEqual(env.events.at(-1), ["closed", { slug: "acme-platform-engineer", doc: "resume", reason: "button" }]);
    assert.equal(ctl.closed, true);
  });

  it("should close on Esc", () => {
    const env = boot();
    openDesk(env);
    const host = desks(env.doc)[0];
    host.dispatchEvent(key(host.querySelector("textarea"), "Escape"));
    assert.equal(desks(env.doc).length, 0);
    assert.equal(env.doc.activeElement, env.edit);
  });

  it("should stop a request in flight on the first Esc, not close", async () => {
    const env = boot();
    const { calls } = openDesk(env);
    await settle();
    const host = desks(env.doc)[0];
    const ta = host.querySelector("textarea");
    ta.value = "Make the summary punchier";
    ta.dispatchEvent(key(ta, "Enter"));
    assert.ok(calls.some((c) => c[0] === "propose" && c[1] === "Make the summary punchier"));
    assert.equal(host.querySelector(".scribe__msg--you").textContent, "Make the summary punchier");
    assert.ok(host.querySelector('[data-scribe="stop"]'), "the stage line offers Stop while busy");
    host.dispatchEvent(key(ta, "Escape"));
    assert.equal(desks(env.doc).length, 1, "Esc stops first");
  });

  it("should close when the role closes, and ignore it afterwards", () => {
    const env = boot();
    openDesk(env);
    env.win.dispatchEvent({ type: "jb:role:closed" });
    assert.equal(desks(env.doc).length, 0);
    assert.equal(env.events.filter((e) => e[0] === "closed").length, 1);
    env.win.dispatchEvent({ type: "jb:role:closed" });
    assert.equal(env.events.filter((e) => e[0] === "closed").length, 1, "listeners were removed");
  });

  it("should find the live Edit button when the rows were repainted", () => {
    const env = boot();
    const replacement = env.doc.createElement("button");
    openDesk(env, { findOpener: () => replacement });
    env.section.removeChild(env.edit);
    env.section.appendChild(replacement);
    env.win.JB_SCRIBE_V2.close();
    assert.equal(env.doc.activeElement, replacement);
  });

  it("should keep exactly one desk when a second Edit opens", () => {
    const env = boot();
    openDesk(env);
    openDesk(env, { doc: "cover_letter" });
    assert.equal(desks(env.doc).length, 1);
    assert.equal(desks(env.doc)[0].getAttribute("data-doc"), "cover_letter");
    assert.equal(env.events.filter((e) => e[0] === "closed")[0][1].reason, "replaced");
  });

  it("should close when the boot contract unmounts the v2 surfaces", () => {
    const env = boot();
    vm.runInNewContext(read("jb-v2-boot-contract.js"), env.win);
    openDesk(env);
    env.doc.body.className = "";
    assert.equal(desks(env.doc).length, 0);
  });
});

/* ---------------------------------------------------------------------
   Grok F1-trap (P1): the desk is modal for the whole time it is open.
   Keys were bound to <jb-scribe>, so once focus fell to <body> (a click in
   the preview, or the Stop button re-rendered away) Esc did nothing and
   Tab walked the page under the dialog.
   --------------------------------------------------------------------- */

function drivableApi() {
  const { api, calls } = scriptedApi();
  const run = {};
  api.propose = (body) => { calls.push(["propose", body.instruction]); return Promise.resolve({ proposalId: "p1", streamUrl: "/s" }); };
  api.stream = (_id, handlers) => new Promise((resolve) => { run.emit = handlers.onEvent; run.finish = resolve; });
  return { api, calls, run };
}

async function startRequest(env, api) {
  env.win.JB_SCRIBE_V2.open({ slug: "acme-platform-engineer", doc: "resume", opener: env.edit, api });
  await settle();
  const host = desks(env.doc)[0];
  const ta = host.querySelector("textarea");
  ta.value = "Make the summary punchier";
  ta.dispatchEvent(key(ta, "Enter"));
  await settle();
  return host;
}

describe("Scribe v2 keeps the keyboard while it is open (F1-trap)", () => {
  it("should close on Esc even when focus has fallen to the page body", () => {
    const env = boot();
    openDesk(env);
    env.doc.body.focus();
    env.doc.body.dispatchEvent(key(env.doc.body, "Escape"));
    assert.equal(desks(env.doc).length, 0);
    assert.ok(env.doc.activeElement === env.edit, "focus returns to Edit");
  });

  it("should pull Tab from the page body back into the dialog", () => {
    const env = boot();
    openDesk(env);
    env.doc.body.focus();
    const ev = key(env.doc.body, "Tab");
    env.doc.body.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true, "Tab must not walk the page under the dialog");
    const sheet = desks(env.doc)[0].querySelector('[role="dialog"]');
    let inside = false;
    for (let n = env.doc.activeElement; n; n = n.parentNode) if (n === sheet) inside = true;
    assert.ok(inside, "focus lands inside the dialog");
  });

  it("should stop listening on the document once closed", () => {
    const env = boot();
    openDesk(env);
    env.win.JB_SCRIBE_V2.close();
    const closes = env.events.filter((e) => e[0] === "closed").length;
    const ev = key(env.doc.body, "Escape");
    env.doc.body.dispatchEvent(ev);
    assert.ok(!ev.defaultPrevented, "a closed desk claims no keys");
    assert.equal(env.events.filter((e) => e[0] === "closed").length, closes);
  });

  it("should keep focus on Stop when a stage tick re-renders it", async () => {
    const env = boot();
    const { api, run } = drivableApi();
    const host = await startRequest(env, api);
    const stop = host.querySelector('[data-scribe="stop"]');
    stop.focus();
    run.emit({ event: "stage", data: { stage: "drafting" } });
    const next = host.querySelector('[data-scribe="stop"]');
    assert.ok(next && next !== stop, "the stage line was rebuilt");
    assert.ok(env.doc.activeElement === next, "focus follows to the new Stop button");
  });

  it("B1M-STAGE shows checking facts as the current step", async () => {
    const env = boot();
    const { api, run } = drivableApi();
    const host = await startRequest(env, api);
    run.emit({ event: "stage", data: { stage: "checking facts" } });
    assert.equal(host.querySelector(".scribe__stage-short").textContent, "Checking facts");
    const now = host.querySelector('.scribe__stages [data-s="now"]');
    assert.match(now.textContent, /Checking facts/);
  });

  it("should hand focus to the composer when the run ends under a focused Stop", async () => {
    const env = boot();
    const { api, run } = drivableApi();
    const host = await startRequest(env, api);
    host.querySelector('[data-scribe="stop"]').focus();
    run.emit({ event: "done", data: { status: "partial" } });
    run.finish("partial");
    await settle();
    assert.ok(host.querySelector('[data-scribe="stop"]') === null, "Stop is gone once the run ends");
    assert.ok(env.doc.activeElement === host.querySelector("textarea"), "focus lands in the composer, not on body");
  });

  it("should take Esc and Tab from inside the preview iframe", async () => {
    const env = boot();
    openDesk(env);
    await settle();
    const host = desks(env.doc)[0];
    const frame = host.querySelector("iframe");
    const inner = { listeners: {}, addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }, removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); } };
    frame.contentDocument = inner;
    frame.onload();
    assert.equal((inner.listeners.keydown || []).length, 1, "the preview forwards keys");
    frame.focus();
    const tab = { key: "Tab", target: inner, preventDefault() { this.defaultPrevented = true; } };
    inner.listeners.keydown[0](tab);
    assert.equal(tab.defaultPrevented, true);
    assert.ok(env.doc.activeElement !== frame, "Tab leaves the preview into the dialog's controls");
    inner.listeners.keydown[0]({ key: "Escape", target: inner, preventDefault() {} });
    assert.equal(desks(env.doc).length, 0);
    assert.equal((inner.listeners.keydown || []).length, 0, "the forwarder is removed on close");
  });
});

/* Grok F1-keyboard (P2): SPEC §1 pins the phone composer to visualViewport.
   100dvh does not shrink for the software keyboard, which covered it. */
describe("Scribe v2 sizes to the visual viewport on a phone (F1-keyboard)", () => {
  function phoneEnv(width) {
    const env = boot();
    const vv = { height: 844, offsetTop: 0, listeners: {} };
    vv.addEventListener = (t, fn) => { (vv.listeners[t] ||= []).push(fn); };
    vv.removeEventListener = (t, fn) => { vv.listeners[t] = (vv.listeners[t] || []).filter((f) => f !== fn); };
    env.win.visualViewport = vv;
    env.win.innerHeight = 844;
    env.win.matchMedia = (q) => ({ matches: /max-width:\s*599px/.test(q) ? width < 600 : false });
    return { env, vv };
  }

  it("should shrink the sheet above the keyboard and follow it", () => {
    const { env, vv } = phoneEnv(390);
    openDesk(env);
    const sheet = desks(env.doc)[0].querySelector('[role="dialog"]');
    assert.equal(sheet.style.height, "844px");
    vv.height = 500;
    vv.offsetTop = 40;
    for (const fn of [...(vv.listeners.resize || []), ...(vv.listeners.scroll || [])]) fn();
    assert.equal(sheet.style.height, "500px", "the sheet ends where the keyboard begins");
    assert.equal(sheet.style.bottom, "304px", "844 − 500 − 40: pinned to the visible area");
  });

  it("should drop its visualViewport listeners on close", () => {
    const { env, vv } = phoneEnv(390);
    openDesk(env);
    assert.ok((vv.listeners.resize || []).length >= 1);
    env.win.JB_SCRIBE_V2.close();
    assert.equal((vv.listeners.resize || []).length, 0);
    assert.equal((vv.listeners.scroll || []).length, 0);
  });

  it("should leave the CSS sizing alone on a wide screen", () => {
    const { env } = phoneEnv(1440);
    openDesk(env);
    const sheet = desks(env.doc)[0].querySelector('[role="dialog"]');
    assert.ok(!sheet.style.height, "92dvh from the stylesheet");
  });
});

/* Grok F1-announce (P2): SPEC §4 has one polite status region. A live
   transcript spoke every result twice alongside announce(). */
describe("Scribe v2 speaks each result once (F1-announce)", () => {
  it("should keep the transcript a log but not a second live region", () => {
    const env = boot();
    openDesk(env);
    const log = desks(env.doc)[0].querySelector('[role="log"]');
    assert.ok(log, "the transcript is still role=log");
    assert.equal(log.getAttribute("aria-live"), null);
    const live = desks(env.doc)[0].querySelectorAll("[aria-live]");
    assert.equal(live.length, 1, "announce's region is the only live region");
  });
});

it('SCRP-F1 skeleton supplies stable hidden recovery and outcome mounts', () => {
  const env = boot();
  const { ctl } = openDesk(env);
  const host = ctl.refs.host;
  const recover = host.querySelector('.scribe__recover');
  assert.ok(recover, 'recovery mount exists');
  assert.equal(recover.parentNode, ctl.refs.composer);
  assert.equal(ctl.refs.composer.firstChild, recover);
  assert.equal(recover.getAttribute('role'), 'group');
  assert.ok(recover.hasAttribute('hidden'));
  const status = host.querySelector('.scribe__status');
  assert.equal(status.parentNode, ctl.refs.composer);
  assert.equal(status.getAttribute('role'), 'status');
  assert.ok(status.hasAttribute('hidden'));
  assert.ok(status.querySelector('button.scribe__status-action'));
  assert.equal(host.querySelector('.scribe__unsaved').getAttribute('role'), 'alertdialog');
  assert.ok(host.querySelector('.scribe__unsaved').hasAttribute('hidden'));
  assert.ok(ctl.refs.scope.querySelector('[data-action="clear-scope"]'));
});


const flush = async () => { for (let i = 0; i < 8; i++) await settle(); };
const tap = (el) => { assert.ok(el, 'control exists'); el.dispatchEvent({ type: 'click', target: el, bubbles: true }); };
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const ROP = { opId: 'o1', op: 'replace', node: 'b:acme:c14', text: 'Measured delays through a weekly dashboard.', flags: [], facts: [] };
function reliabilityApi(docName = 'resume') {
  let open = null;
  let seq = 0;
  const calls = [];
  const api = {
    calls,
    get open() { return open; }, set open(p) { open = p; },
    listVersions: async () => ({ currentRunId: 'r2', versions: [{ runId: 'r2', n: 2, words: 20, pages: 1 }, { runId: 'r1', n: 1, words: 15, pages: 1 }] }),
    getModel: async (id) => { calls.push(['model', id]); return { model: {}, nodes: [{ id: 'b:acme:c14', kind: 'bullet', text: id + ' original block' }] }; },
    preview: async (body) => { calls.push(['preview', body.doc, body.baseRunId]); return { html: '<p data-node="b:acme:c14">' + body.baseRunId + ' original block</p>', words: 20 }; },
    getOpenEdit: async () => { calls.push(['open']); return { proposal: open }; },
    propose: async (body) => { calls.push(['post', body]); open = { proposalId: 'p' + (++seq), doc: body.doc, baseRunId: body.baseRunId, instruction: body.instruction, status: 'pending', ops: [], blocked: [] }; return { proposalId: open.proposalId }; },
    stream: async (id, handlers) => { calls.push(['stream', id]); if (open) { open.ops = [ROP]; open.status = 'ready'; } handlers.onEvent({ event: 'op', data: { op: ROP } }); handlers.onEvent({ event: 'done', data: { status: 'ready' } }); return 'ready'; },
    stopEdit: async (id) => { calls.push(['stop', id]); if (open) open.status = 'partial'; return { status: 'partial', ops: open?.ops || [] }; },
    rejectEdit: async (id) => { calls.push(['delete', id]); open = null; },
    star: async () => ({}),
  };
  const env = boot();
  vm.runInNewContext(read('scribe-v2-api.js'), env.win);
  vm.runInNewContext(read('scribe-v2-diff.js'), env.win);
  function mount(which = docName) {
    const ctl = env.win.JB_SCRIBE_V2.open({ slug: 'acme-platform-engineer', doc: which, api, opener: env.edit });
    const frame = ctl.refs.frame;
    let html = '';
    Object.defineProperty(frame, 'srcdoc', { configurable: true, get: () => html, set(value) {
      html = value;
      setImmediate(() => {
        const inner = new FakeDocument();
        const p = inner.createElement('p'); p.setAttribute('data-node', 'b:acme:c14');
        p.textContent = value.replace(/<[^>]+>/g, ''); inner.body.appendChild(p);
        frame.contentDocument = inner; frame.onload?.();
      });
    } });
    return ctl;
  }
  async function submit(ctl, text = 'Make it punchier') {
    ctl.refs.prompt.value = text;
    ctl.refs.composer.dispatchEvent({ type: 'submit', target: ctl.refs.composer });
    await flush();
  }
  return { api, calls, env, mount, submit };
}

describe('SCRP-F6 ASTRA-01 persisted recovery for both documents', () => {
  for (const which of ['resume', 'cover_letter']) {
    for (const action of ['close', 'switch', 'resubmit']) {
      it(`SCRP-F6 ${which} ${action} preserves one open request and its exact base`, async () => {
        const t = reliabilityApi(which); let ctl = t.mount(); await flush(); await t.submit(ctl);
        const id = ctl.state.proposal.id;
        if (action === 'close') { ctl.close(); ctl = t.mount(); await flush(); }
        if (action === 'switch') {
          ctl.setDoc(which === 'resume' ? 'cover_letter' : 'resume'); await flush();
          assert.equal(ctl.refs.recover.getAttribute('data-recover-doc'), which);
          tap(ctl.refs.recover.querySelector('[data-action="review-request"]')); await flush();
        }
        if (action === 'resubmit') { await t.submit(ctl, 'A second typed request'); assert.equal(ctl.refs.prompt.value, 'A second typed request'); }
        assert.equal(ctl.state.proposal.id, id);
        assert.equal(ctl.state.proposal.changes.length, 1);
        assert.equal(ctl.state.proposal.changes[0].before, 'r2 original block');
        assert.equal(t.calls.filter(c => c[0] === 'post').length, 1);
        assert.equal(t.calls.filter(c => c[0] === 'delete').length, 0);
        ctl.close();
      });
    }
    for (const action of ['stop', 'close', 'switch', 'new editor']) {
      it(`SCRP-F7 ${which} deferred start then ${action} stops the late ID without mutating another editor`, async () => {
        const t = reliabilityApi(which); const pending = defer(); t.api.propose = () => pending.promise;
        const ctl = t.mount(); await flush(); await t.submit(ctl);
        if (action === 'stop') { tap(ctl.refs.stage.querySelector('[data-scribe="stop"]')); assert.match(ctl.refs.stage.textContent, /Stopping…/); assert.equal(ctl.state.busy, true); }
        if (action === 'close') ctl.close();
        if (action === 'switch') ctl.setDoc(which === 'resume' ? 'cover_letter' : 'resume');
        let next = null; if (action === 'new editor') { next = t.mount(which === 'resume' ? 'cover_letter' : 'resume'); }
        await flush(); pending.resolve({ proposalId: 'late-p' }); await flush();
        assert.equal(t.calls.filter(c => c[0] === 'stop' && c[1] === 'late-p').length, 1);
        assert.equal(t.calls.filter(c => c[0] === 'stream').length, 0);
        if (next) { assert.equal(next.state.proposal, null); next.close(); }
        if (action === 'switch') assert.equal(ctl.state.proposal, null);
        ctl.close();
      });
    }
    it(`SCRP-F8 ${which} failed DELETE keeps changes and a 404 rechecks open once`, async () => {
      const t = reliabilityApi(which); const ctl = t.mount(); await flush(); await t.submit(ctl);
      const p = ctl.state.proposal;
      t.api.rejectEdit = async () => { throw Object.assign(new Error('failed'), { status: 503 }); };
      tap(ctl.refs.reviewbar.querySelector('[data-review="discard"]')); await flush();
      assert.equal(ctl.state.proposal, p); assert.match(ctl.refs.status.textContent, /still open/);
      assert.ok(ctl.refs.reviewbar.querySelector('[data-review="discard"]'));
      const before = t.calls.filter(c => c[0] === 'open').length;
      t.api.rejectEdit = async () => { t.api.open = null; throw Object.assign(new Error('gone'), { status: 404 }); };
      tap(ctl.refs.reviewbar.querySelector('[data-review="discard"]')); await flush();
      assert.equal(t.calls.filter(c => c[0] === 'open').length, before + 1);
      assert.equal(ctl.state.proposal, null); ctl.close();
    });
  }
  it('SCRP-F9 missing GET open, 404 and network failure leave the desk usable', async () => {
    for (const failure of ['missing', 404, 0]) {
      const t = reliabilityApi(); if (failure === 'missing') delete t.api.getOpenEdit;
      else t.api.getOpenEdit = async () => { throw Object.assign(new Error('unavailable'), { status: failure }); };
      const ctl = t.mount(); await flush(); assert.equal(ctl.state.currentRunId, 'r2');
      assert.equal(ctl.state.loading, false); assert.equal(ctl.state.proposal, null); ctl.close();
    }
  });
  for (const result of ['null', '409', 'proposal']) {
    it(`SCRP-F10 materials_pending performs one open read: ${result}`, async () => {
      const t = reliabilityApi(); const ctl = t.mount(); await flush();
      const old = t.calls.filter(c => c[0] === 'open').length;
      t.api.propose = async () => { throw Object.assign(new Error('pending'), { status: 409, code: 'materials_pending' }); };
      if (result === 'proposal') t.api.open = { proposalId: 'other', doc: 'resume', baseRunId: 'r2', status: 'ready', ops: [ROP], blocked: [] };
      if (result === '409') t.api.getOpenEdit = async () => { t.calls.push(['open']); throw { status: 409, code: 'materials_pending' }; };
      await t.submit(ctl);
      assert.equal(t.calls.filter(c => c[0] === 'open').length, old + 1);
      if (result === 'proposal') assert.equal(ctl.state.proposal.id, 'other');
      else assert.match(ctl.refs.status.textContent, /still working on this role/);
      assert.equal(ctl.refs.prompt.value, 'Make it punchier'); ctl.close();
    });
  }
  it('SCRP-F11 accepting and multiple-open proposals have explicit discard controls', async () => {
    const t = reliabilityApi(); t.api.open = { proposalId: 'accepting', doc: 'resume', baseRunId: 'r2', status: 'accepting', ops: [] };
    let ctl = t.mount(); await flush(); assert.match(ctl.refs.recover.textContent, /A save didn’t finish/);
    assert.ok(ctl.refs.recover.querySelector('[data-action="discard-request"]')); ctl.close();
    t.api.getOpenEdit = async () => { throw { code: 'multiple_open_proposals', proposals: [{ proposalId: 'a', doc: 'resume', status: 'ready' }, { proposalId: 'b', doc: 'cover_letter', status: 'ready' }] }; };
    ctl = t.mount(); await flush(); assert.equal(ctl.refs.recover.querySelectorAll('[data-action="discard-request"]').length, 2);
    await t.submit(ctl); assert.equal(t.calls.filter(c => c[0] === 'post').length, 0); ctl.close();
  });
});

for (const which of ['resume', 'cover_letter']) {
  it(`SCRP-F15 ${which} base-load failure keeps the created ID recoverable`, async () => {
    const t = reliabilityApi(which); const ctl = t.mount(); await flush();
    t.api.propose = async () => ({ proposalId: 'created-p', rebasedTo: 'r1' });
    t.api.getModel = async () => { throw new Error('unavailable'); };
    await t.submit(ctl);
    assert.equal(ctl.state.proposal.id, 'created-p');
    assert.equal(ctl.state.busy, false);
    assert.ok(ctl.refs.recover.querySelector('[data-action="continue-request"]'));
    assert.ok(ctl.refs.recover.querySelector('[data-action="discard-request"]'));
    assert.equal(t.calls.filter(c => c[0] === 'stream').length, 0); ctl.close();
  });
  it(`SCRP-F16 ${which} stale recovery keeps Save CAS and reviews current without discarding`, async () => {
    const t = reliabilityApi(which);
    t.api.open = { proposalId: 'stale-p', doc: which, baseRunId: 'r1', status: 'ready', ops: [ROP] };
    vm.runInNewContext(read('scribe-v2-versions.js'), t.env.win);
    const ctl = t.mount(); await flush();
    assert.equal(ctl.state.currentRunId, 'r1');
    assert.match(ctl.refs.recover.textContent, /v1; v2 is now current/);
    tap(ctl.refs.recover.querySelector('[data-action="review-current"]')); await flush();
    assert.equal(ctl.versionsUi.state().mode, 'view');
    assert.equal(ctl.versionsUi.state().a, 'r2');
    assert.equal(ctl.state.proposal.id, 'stale-p');
    await t.submit(ctl, 'Retained request');
    assert.equal(t.calls.filter(c => c[0] === 'post').length, 0);
    assert.equal(t.calls.filter(c => c[0] === 'delete').length, 0); ctl.close();
  });
}

for (const which of ['resume', 'cover_letter']) {
  it(`SCRP-F17 ${which} detached SSE callbacks cannot mutate the sibling`, async () => {
    const t = reliabilityApi(which); let emit;
    const streamed = defer();
    t.api.stream = (_id, h) => { emit = h.onEvent; return streamed.promise; };
    const ctl = t.mount(); await flush(); await t.submit(ctl);
    ctl.setDoc(which === 'resume' ? 'cover_letter' : 'resume'); await flush();
    const before = ctl.refs.log.textContent;
    emit({ event: 'op', data: { op: ROP } }); emit({ event: 'error', data: { code: 'provider_failed' } }); streamed.resolve('ready'); await flush();
    assert.equal(ctl.state.proposal, null); assert.equal(ctl.state.busy, false);
    assert.equal(ctl.refs.log.textContent, before); ctl.close();
  });
  it(`SCRP-F18 ${which} Continue retries an exact-base load and resets replayed ops`, async () => {
    const t = reliabilityApi(which); const ctl = t.mount(); await flush();
    t.api.propose = async () => ({ proposalId: 'created-p', rebasedTo: 'r1' });
    const get = t.api.getModel; t.api.getModel = async () => { throw new Error('unavailable'); };
    await t.submit(ctl); t.api.getModel = get;
    tap(ctl.refs.recover.querySelector('[data-action="continue-request"]')); await flush();
    assert.equal(ctl.state.currentRunId, 'r1');
    assert.equal(ctl.state.proposal.changes[0].before, 'r1 original block');
    assert.equal(ctl.state.proposal.ops.length, 1); ctl.close();
  });
  it(`SCRP-F19 ${which} failed Stop never reports Stopped and stays recoverable`, async () => {
    const t = reliabilityApi(which); t.api.stream = () => new Promise(() => {});
    t.api.stopEdit = async () => { throw new Error('offline'); };
    const ctl = t.mount(); await flush(); await t.submit(ctl);
    tap(ctl.refs.stage.querySelector('[data-scribe="stop"]')); await flush();
    assert.doesNotMatch(ctl.refs.log.textContent, /Stopped/);
    assert.ok(ctl.refs.recover.querySelector('[data-action="stop-request"]'));
    assert.equal(ctl.openProposal.proposalId, 'p1'); ctl.close();
  });
}

it('SCRP-R1-9 Continue then Discard aborts the request and permits Send', async () => {
  const t = reliabilityApi(); t.env.win.AbortController = AbortController; const pending = defer(); let signal;
  t.api.open = { proposalId: 'earlier', doc: 'resume', baseRunId: 'r2', status: 'pending', ops: [] };
  t.api.stream = async (_id, handlers) => { signal = handlers.signal; return pending.promise; };
  const ctl = t.mount(); await flush();
  const discard = ctl.refs.recover.querySelector('[data-action="discard-request"]');
  tap(ctl.refs.recover.querySelector('[data-action="continue-request"]')); await flush();
  assert.equal(ctl.refs.recover.hasAttribute('hidden'), true, 'running request has no recovery controls');
  tap(discard); await flush();
  assert.equal(signal.aborted, true); assert.equal(ctl.state.busy, false); assert.equal(ctl.state.stage, null);
  await t.submit(ctl, 'Next request'); assert.equal(t.calls.filter(c => c[0] === 'post').length, 1);
  pending.resolve(); ctl.close();
});

it('SCRP-R1-10 locked blocks use fixed copy rather than echoing detail', async () => {
  const t = reliabilityApi();
  t.api.stream = async (_id, h) => { h.onEvent({ event: 'blocked', data: { op: { opId: 'locked' }, reason: 'locked', detail: 'That would change a locked fact.' } }); h.onEvent({ event: 'done', data: { status: 'ready' } }); };
  const ctl = t.mount(); await flush(); await t.submit(ctl);
  assert.equal(ctl.refs.log.querySelector('.scribe__msg--blocked').textContent, 'Blocked: that would change a locked fact.'); ctl.close();
});

for (const rejected of [false, true]) it(`SCRP-R1-11 stop ${rejected ? 'rejection hydrates terminal state' : 'keeps late stream frames'}`, async () => {
  const t = reliabilityApi(); const reply = defer(); const stream = defer(); let handlers;
  t.api.stream = async (_id, h) => { handlers = h; return stream.promise; };
  t.api.stopEdit = () => reply.promise;
  const ctl = t.mount(); await flush(); await t.submit(ctl);
  tap(ctl.refs.stage.querySelector('[data-scribe="stop"]'));
  handlers.onEvent({ event: 'op', data: { op: ROP } });
  handlers.onEvent({ event: 'proposal', data: { summary: { changes: 1, wordsDelta: -2 } } });
  handlers.onEvent({ event: 'done', data: { status: 'ready' } });
  assert.equal(ctl.state.proposal.ops.length, 1, 'validated frames survive a pending stop');
  assert.equal(ctl.state.proposal.summary.wordsDelta, -2);
  if (rejected) {
    t.api.open = { proposalId: ctl.state.proposal.id, doc: 'resume', baseRunId: 'r2', status: 'ready', ops: [ROP] };
    reply.reject({ code: 'proposal_not_running' });
  } else reply.resolve({ status: 'partial', ops: [ROP] });
  await flush();
  assert.equal(ctl.state.busy, false); assert.equal(ctl.request, null);
  assert.equal(ctl.state.proposal.status, rejected ? 'ready' : 'partial');
  assert.notEqual(ctl.refs.status.getAttribute('data-state'), 'error');
  assert.ok(ctl.refs.reviewbar.querySelector('[data-review="accept-all"]'));
  stream.resolve(); ctl.close();
});

it('SCRP-R1-13 known server errors use copy plus nextStep', async () => {
  const t = reliabilityApi(); const ctl = t.mount(); await flush();
  const rec = t.env.win.JBScribeApi.create({ slug: 'acme-example', base: 'http://127.0.0.1:1', fetchImpl: async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: 'Too many AI and rendering requests this minute.', code: 'rate_limited', retryable: true, nextStep: 'Try again in 30 s.' }) }) });
  t.api.propose = body => rec.propose(body);
  await t.submit(ctl);
  assert.equal(ctl.refs.statusText.textContent, 'Too many requests right now. Try again in a minute. Your request is kept. Try again in 30 s.'); ctl.close();
});

for (const state of ['pending', 'ready', 'partial']) it(`SCRP-R1-14 recovered ${state} controls respect terminal readiness`, async () => {
  const t = reliabilityApi(); t.api.open = { proposalId: 'earlier', doc: 'resume', baseRunId: 'r2', status: state, ops: [ROP] };
  const ctl = t.mount(); await flush();
  assert.equal(!!ctl.refs.rail.querySelector('[data-review="accept"]'), state !== 'pending');
  assert.equal(!!ctl.refs.reviewbar.querySelector('[data-review="save"]'), state !== 'pending'); ctl.close();
});

it('SCRP-R1-15 late save clears the matching unfinished-save gate', async () => {
  const t = reliabilityApi(); const saved = defer(); t.api.acceptEdit = () => saved.promise;
  const ctl = t.mount(); await flush(); await t.submit(ctl);
  const id = ctl.state.proposal.id;
  tap(ctl.refs.reviewbar.querySelector('[data-review="accept-all"]')); tap(ctl.refs.reviewbar.querySelector('[data-review="save"]'));
  t.api.open.status = 'accepting'; ctl.setDoc('cover_letter'); await flush();
  assert.equal(ctl.openProposal.proposalId, id);
  t.api.open = null; saved.resolve({ run: { runId: 'r3', n: 3 } }); await flush();
  assert.equal(ctl.openProposal, null); await t.submit(ctl, 'Next request');
  assert.equal(t.calls.filter(c => c[0] === 'post').length, 2); ctl.close();
});

it('SCRP-R1-16 per-op validation blocks stay in the log', async () => {
  const t = reliabilityApi();
  t.api.stream = async (_id, h) => { h.onEvent({ event: 'blocked', data: { op: { opId: 'bad-layout' }, reason: 'invalid_model' } }); h.onEvent({ event: 'op', data: { op: ROP } }); h.onEvent({ event: 'done', data: { status: 'ready' } }); };
  const ctl = t.mount(); await flush(); await t.submit(ctl);
  assert.notEqual(ctl.refs.status.getAttribute('data-state'), 'error'); assert.equal(ctl.state.proposal.failure, undefined);
  assert.match(ctl.refs.log.textContent, /Blocked: that change doesn’t fit/); ctl.close();
});

it('SCRP-R1-17 Continue recreates a missing local proposal', async () => {
  const t = reliabilityApi(); t.api.open = { proposalId: 'earlier', doc: 'resume', baseRunId: 'r2', instruction: 'Earlier request', status: 'pending', ops: [] };
  const ctl = t.mount(); await flush(); ctl.state.proposal = null;
  tap(ctl.refs.recover.querySelector('[data-action="continue-request"]')); await flush();
  assert.equal(ctl.state.proposal?.id, 'earlier'); assert.equal(ctl.state.proposal?.ops.length, 1); ctl.close();
});
it('SCRP-R1-17 programmer exceptions never appear as user-facing server copy', async () => {
  const t = reliabilityApi(); const ctl = t.mount(); await flush();
  t.api.propose = async () => { throw new Error('TypeError: internal controller detail'); };
  await t.submit(ctl); assert.equal(ctl.refs.statusText.textContent, 'That didn’t work. Try again.'); ctl.close();
});

it('SCRP-R1-18 active proposals have no recovery banner or lost-choice warning', async () => {
  const t = reliabilityApi(); const ctl = t.mount(); await flush(); await t.submit(ctl);
  assert.equal(ctl.refs.recover.hasAttribute('hidden'), true);
  assert.doesNotMatch(ctl.refs.statusText.textContent, /choices weren’t kept/); ctl.close();
});
it('SCRP-R1-18 only ready recovered proposals warn about lost choices', async () => {
  const t = reliabilityApi(); t.api.open = { proposalId: 'earlier', doc: 'resume', baseRunId: 'r2', status: 'pending', ops: [ROP] };
  const ctl = t.mount(); await flush(); assert.doesNotMatch(ctl.refs.statusText.textContent, /choices weren’t kept/); ctl.close();
});

it('SCRP-R1-19 starting and successfully finishing clears obsolete status', async () => {
  const t = reliabilityApi(); const ctl = t.mount(); await flush();
  t.api.propose = async () => { throw { code: 'rate_limited' }; }; await t.submit(ctl);
  assert.equal(ctl.refs.status.hasAttribute('hidden'), false);
  let statusAtPost; t.api.propose = async body => { statusAtPost = ctl.refs.status.hasAttribute('hidden'); return { proposalId: 'next' }; };
  await t.submit(ctl); assert.equal(statusAtPost, true); assert.equal(ctl.refs.status.hasAttribute('hidden'), true);
  await t.submit(ctl, 'Blocked second request'); assert.equal(ctl.refs.status.hasAttribute('hidden'), false);
  ctl.setDoc('cover_letter'); await flush(); assert.equal(ctl.refs.status.hasAttribute('hidden'), true); ctl.close();
});

it('SCRP-R1-20 an older initial load cannot overwrite the exact recovered base', async () => {
  const t = reliabilityApi(); const first = defer(); let reads = 0;
  t.api.listVersions = async () => { if (++reads === 1) return first.promise; return { currentRunId: 'r2', versions: [{ runId: 'r2', n: 2 }, { runId: 'r1', n: 1 }] }; };
  const ctl = t.mount(); await flush();
  t.api.open = { proposalId: 'earlier', doc: 'resume', baseRunId: 'r1', status: 'ready', ops: [ROP] };
  // A materials-pending reply reads the open proposal while the initial list is pending.
  ctl.state.loading = false;
  t.api.propose = async () => { throw { code: 'materials_pending' }; }; await t.submit(ctl); await flush();
  assert.equal(ctl.state.currentRunId, 'r1');
  first.resolve({ currentRunId: 'r2', versions: [{ runId: 'r2', n: 2 }] }); await flush();
  assert.equal(ctl.state.currentRunId, 'r1'); assert.equal(ctl.refs.frame.srcdoc, '<p data-node="b:acme:c14">r1 original block</p>'); ctl.close();
});

it('SCRP-R1-21 a saved response without n never invents a version number', async () => {
  const t = reliabilityApi(); t.api.acceptEdit = async () => { t.api.open = null; return { textSaved: true, run: { runId: 'r3', pdf: 'stale' } }; };
  const ctl = t.mount(); await flush(); await t.submit(ctl);
  tap(ctl.refs.reviewbar.querySelector('[data-review="accept-all"]')); tap(ctl.refs.reviewbar.querySelector('[data-review="save"]')); await flush();
  assert.equal(ctl.refs.statusText.textContent, 'Text saved as a new version. PDF unavailable — it’s rebuilt on your next save.'); ctl.close();
});

for (const which of ['resume', 'cover_letter']) it(`SCRP-F58 ${which} recovery Review opens the Doc segment on phones`, async () => {
  const t = reliabilityApi(which); t.env.win.matchMedia = () => ({ matches: true });
  t.api.open = { proposalId: 'earlier', doc: which, baseRunId: 'r1', status: 'ready', ops: [ROP] };
  const ctl = t.mount(); await flush(); ctl.setSeg('chat');
  tap(ctl.refs.recover.querySelector('[data-action="review-request"]')); await flush();
  assert.equal(ctl.state.seg, 'doc'); assert.equal(ctl.refs.segs[0].getAttribute('aria-selected'), 'true'); ctl.close();
});
