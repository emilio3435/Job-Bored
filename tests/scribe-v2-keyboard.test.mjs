/* scribe-v2-keyboard.test.mjs — EDITOR lane F2.

   Reviewing a proposal (SPEC §2, §4): its ops land as marks on the real
   render, and every review control works from the keys and the mouse.
     j / k      next / previous change, in reading order
     a / r      accept / reject the focused change
     Shift+A    accept every verified change (Unverified ones are skipped:
                each needs its own ✓)
     D          show or hide the marks
   None of them fire while focus is in a text field. Nothing reaches disk
   until Save; once every change is decided and one is accepted, the
   desk saves by itself after 3 s idle. Stop keeps the ops already
   validated and marks the proposal partial.

   Harness: tests/fixtures/jb-dom.mjs under node:vm. The preview frame is
   a fake document holding the blocks a template renders with data-node;
   the API is scripted so the stream and the save settle on demand. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { FakeDocument, makeEnv } from "./fixtures/jb-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
const plain = (v) => JSON.parse(JSON.stringify(v));

const LISTING = {
  currentRunId: "r4",
  versions: [
    { runId: "r4", n: 4, createdAt: "2026-09-27T16:00:00.000Z", source: "edit", prompt: "Shorter summary", parentRunId: "r0", pinned: false, starred: false, pages: 1, words: 40, family: "signal" },
    { runId: "r0", n: 0, createdAt: "2026-09-25T16:00:00.000Z", source: "draft", pinned: true, starred: false, pages: 1, words: 44, family: "signal" },
  ],
};

/* Reading order in the render: summary, then the Acme bullets. `intro`
   is one of the ops but, as in Signal and Dossier, has no block. */
const BLOCKS = [
  ["stmt", "Operations analyst who reduced fulfillment delays 38% through careful measurement."],
  ["seat:acme", "Operations Analyst"],
  ["b:acme:c14", "Measured carrier delays and built a weekly dashboard for the operations team."],
  ["b:acme:c19", "Documented the handoff process and trained new coordinators."],
];

const OPS = [
  { opId: "o1", op: "replace", node: "b:acme:c14", text: "Measured carrier delays and reduced delays through a weekly operations dashboard.", rationale: "outcome first" },
  { opId: "o2", op: "replace", node: "stmt", text: "Operations analyst who cut fulfillment delays 38% by measuring carriers weekly.", rationale: "leads with the result" },
  { opId: "o3", op: "insert", after: "b:acme:c14", claimId: "c22", text: "Mentored 4 coordinators.", flags: ["unverified"], facts: ["“4 coordinators” isn’t in your profile."] },
  { opId: "o4", op: "remove", node: "b:acme:c19" },
];

function frames(ops, extra = []) {
  return [
    { event: "stage", data: { stage: "reading" } },
    { event: "stage", data: { stage: "drafting" } },
    ...ops.map((op) => ({ event: "op", data: { op } })),
    ...extra,
    { event: "stage", data: { stage: "measuring" } },
    { event: "proposal", data: { summary: { changes: ops.length, removals: 1, wordsDelta: -6, lossPct: 12, pages: 1, unverified: 1 } } },
    { event: "done", data: { status: "ready" } },
  ];
}

function scriptedApi({ ops = OPS, extra = [], holdStream = false, stopOps = [] } = {}) {
  const calls = [];
  let release = null;
  const api = {
    mode: "stub",
    listVersions: () => Promise.resolve(plain(LISTING)),
    preview: () => Promise.resolve({ html: "<main data-page='1'></main>", words: 40, pageBudget: 1 }),
    propose: (body) => { calls.push(["propose", body.instruction]); return Promise.resolve({ proposalId: "p1" }); },
    stream: (id, handlers) => {
      const list = frames(ops, extra);
      if (!holdStream) { list.forEach((f) => handlers.onEvent(plain(f))); return Promise.resolve("ready"); }
      /* Deliver up to the ops, then wait for Stop. */
      list.slice(0, 2 + ops.length).forEach((f) => handlers.onEvent(plain(f)));
      return new Promise((resolve) => { release = () => resolve("partial"); });
    },
    /* The server answers Stop a beat after the stream closes, with every
       op it validated, including ones the stream never delivered. */
    stopEdit: (id) => {
      calls.push(["stopEdit", id]);
      if (release) release();
      return new Promise((resolve) => setImmediate(() => resolve({ status: "partial", ops: plain(stopOps) })));
    },
    acceptEdit: (id, body) => { calls.push(["acceptEdit", id, plain(body)]); return Promise.resolve({ run: { runId: "r5", n: 5, pages: 1, pdf: "ready" } }); },
    rejectEdit: (id) => { calls.push(["rejectEdit", id]); return Promise.resolve(null); },
    star: () => Promise.resolve({ ok: true }),
  };
  return { api, calls };
}

function renderDoc(blocks) {
  const inner = new FakeDocument();
  const page = inner.createElement("main");
  page.setAttribute("data-page", "1");
  for (const [id, text] of blocks) {
    const el = inner.createElement(id.startsWith("b:") ? "li" : "p");
    el.setAttribute("data-node", id);
    el.appendChild(inner.createTextNode(text));
    page.appendChild(el);
  }
  inner.body.appendChild(page);
  return inner;
}

async function openWithProposal(opts = {}) {
  const win = makeEnv({ bodyClass: "jb-v2" });
  win.Date = Date;
  win.JBScribeApi = { MAX_INSTRUCTION: 2000, create: () => { throw new Error("tests pass their own api"); } };
  vm.runInNewContext(read("scribe-v2-diff.js"), win);
  vm.runInNewContext(read("scribe-v2.js"), win);
  const doc = win.document;
  const opener = doc.createElement("button");
  doc.body.appendChild(opener);
  const { api, calls } = scriptedApi(opts);
  const ctl = win.JB_SCRIBE_V2.open({ slug: "northwind-ops", doc: "resume", opener, api, title: "Operations Analyst", company: "Northwind Traders" });
  await settle();
  const host = doc.body.querySelector("jb-scribe");
  const frame = host.querySelector(".scribe__frame");
  const inner = renderDoc(opts.blocks || BLOCKS);
  frame.contentDocument = inner;
  frame.onload();
  const ta = host.querySelector("textarea");
  ta.value = "Make it punchier";
  ta.dispatchEvent({ type: "keydown", key: "Enter", target: ta, bubbles: true });
  await settle();
  return { win, doc, host, inner, ctl, calls, ta };
}

const press = (env, k, extra = {}) => {
  const target = extra.target || env.doc.body;
  const ev = { type: "keydown", key: k, target, bubbles: true, shiftKey: false, ...extra };
  target.dispatchEvent(ev);
  return ev;
};
const click = (el) => el.dispatchEvent({ type: "click", target: el, bubbles: true });
const block = (env, opId) => env.inner.querySelector(`[data-scribe-id="${opId}"]`);
const state = (env, opId) => env.ctl.state.proposal.decisions[opId];
const focusedBlock = (env) => env.inner.querySelector("[data-scribe-focus]");
const rail = (env) => env.host.querySelectorAll(".scribe__mm");
const bar = (env) => env.host.querySelector(".scribe__reviewbar");

describe("A proposal lands as marks on the render", () => {
  it("should mark each op in its block and list it in the rail in reading order", async () => {
    const env = await openWithProposal();
    assert.equal(block(env, "o2").getAttribute("data-node"), "stmt");
    assert.ok(block(env, "o2").querySelectorAll("ins").length > 0 && block(env, "o2").querySelectorAll("del").length > 0);
    assert.equal(block(env, "o3").getAttribute("data-scribe-op"), "insert", "the new bullet is a block of its own");
    assert.equal(block(env, "o4").getAttribute("data-scribe-op"), "remove");
    assert.deepEqual(plain(rail(env).map((m) => m.getAttribute("data-op"))), ["o2", "o1", "o3", "o4"], "summary, bullet, new bullet, removal");
    assert.deepEqual(plain(rail(env).map((m) => m.querySelector(".scribe__mm-glyph").textContent)), ["~", "~", "+", "−"]);
  });

  it("should say the summary line and name each control for a screen reader", async () => {
    const env = await openWithProposal();
    assert.equal(bar(env).querySelector(".scribe__reviewbar-sum").textContent, "4 changes · 1 removal · 1 to check · −9 words (23%) · +4 words added · still 1 page");
    /* 9 of the page's 40 words go: over 20%, so the banner asks for care. */
    assert.equal(bar(env).querySelector(".scribe__loss-banner").textContent, "This removes 23% of your resume. Review each removal.");
    const accept = rail(env)[0].querySelector('[data-review="accept"]');
    assert.equal(accept.getAttribute("aria-label"), "Accept change 1 of 4: summary");
    const confirm = rail(env)[2].querySelector('[data-review="accept"]');
    assert.equal(confirm.getAttribute("aria-label"), "Confirm and accept change 3 of 4: new bullet, Operations Analyst");
    assert.equal(confirm.textContent, "Confirm");
    assert.match(rail(env)[2].textContent, /Not in your saved facts — confirm before accepting\. “4 coordinators” isn’t in your profile\./);
  });

  it("should keep the loss banner away while 20% or less is removed", async () => {
    const env = await openWithProposal({ ops: OPS.slice(0, 2) });
    assert.match(bar(env).querySelector(".scribe__loss").textContent, /^−\d+ words \((\d|1\d|20)%\)$/);
    assert.equal(bar(env).querySelector(".scribe__loss-banner"), null);
  });

  it("should list a change the template doesn't render, first, without crashing", async () => {
    const env = await openWithProposal({ ops: [{ opId: "o9", op: "replace", node: "intro", text: "Turns data into decisions." }, ...OPS] });
    assert.equal(block(env, "o9"), null, "there is no intro block to mark");
    assert.equal(rail(env)[0].getAttribute("data-op"), "o9");
    assert.match(rail(env)[0].textContent, /Intro isn’t shown in this template\./);
    press(env, "j");
    press(env, "a");
    assert.equal(state(env, "o9"), "accepted", "and it can still be decided");
  });

  it("should word the blocked-op chat line by its reason", async () => {
    const env = await openWithProposal({ extra: [
      { event: "blocked", data: { op: { opId: "o7", op: "replace", node: "seat:acme" }, reason: "locked", detail: "2019–2023" } },
      { event: "blocked", data: { op: { opId: "o8", op: "replace", node: "p:p1" }, reason: "out_of_scope" } },
    ] });
    const lines = env.host.querySelectorAll(".scribe__msg--blocked").map((m) => m.textContent);
    assert.deepEqual(plain(lines), [
      "Blocked: “2019–2023” is a locked fact.",
      "Blocked: that change was outside what you asked Scribe to edit.",
    ]);
  });
});

describe("Review keys (SPEC §4)", () => {
  it("should walk the changes with j and k and focus each one's note", async () => {
    const env = await openWithProposal();
    press(env, "j");
    assert.equal(focusedBlock(env), block(env, "o2"));
    assert.equal(env.doc.activeElement, rail(env)[0], "focus moves to the change's note");
    assert.equal(env.doc.activeElement.getAttribute("aria-label"), "Change 1 of 4: summary, pending");
    press(env, "j");
    assert.equal(focusedBlock(env), block(env, "o1"));
    press(env, "k");
    press(env, "k");
    assert.equal(focusedBlock(env), block(env, "o4"), "k from the first change wraps to the last");
  });

  it("should accept with a and reject with r, on the focused change only", async () => {
    const env = await openWithProposal();
    press(env, "j");
    press(env, "a");
    press(env, "j");
    press(env, "r");
    assert.deepEqual([state(env, "o2"), state(env, "o1"), state(env, "o3"), state(env, "o4")], ["accepted", "rejected", "pending", "pending"]);
    assert.equal(block(env, "o2").getAttribute("data-scribe-state"), "accepted", "the block's rule turns mint");
    assert.equal(block(env, "o1").getAttribute("data-scribe-state"), "rejected");
  });

  it("should not decide anything on a or r before a change is picked", async () => {
    const env = await openWithProposal();
    press(env, "a");
    press(env, "r");
    assert.deepEqual(plain(Object.values(env.ctl.state.proposal.decisions)), ["pending", "pending", "pending", "pending"]);
  });

  it("should accept every verified change on Shift+A and leave the unverified one", async () => {
    const env = await openWithProposal();
    press(env, "A", { shiftKey: true });
    assert.deepEqual([state(env, "o1"), state(env, "o2"), state(env, "o3"), state(env, "o4")], ["accepted", "accepted", "pending", "accepted"]);
    press(env, "j");
    press(env, "j");
    press(env, "j");
    assert.equal(focusedBlock(env), block(env, "o3"));
    press(env, "a");
    assert.equal(state(env, "o3"), "accepted", "its own a is its confirmation");
  });

  it("should hide the marks on D and bring them back", async () => {
    const env = await openWithProposal();
    const showBtn = env.host.querySelector('[data-scribe="show-changes"]');
    assert.equal(showBtn.getAttribute("aria-pressed"), "true");
    press(env, "D");
    assert.ok(env.inner.documentElement.classList.contains("scribe-clean"));
    assert.equal(showBtn.getAttribute("aria-pressed"), "false");
    press(env, "d");
    assert.ok(!env.inner.documentElement.classList.contains("scribe-clean"));
  });

  it("should ignore every review key while typing in the composer", async () => {
    const env = await openWithProposal();
    for (const k of ["j", "a", "r", "D"]) {
      const ev = press(env, k, { target: env.ta });
      assert.notEqual(ev.defaultPrevented, true, `${k} types into the composer`);
    }
    press(env, "A", { target: env.ta, shiftKey: true });
    assert.equal(focusedBlock(env), null);
    assert.ok(!env.inner.documentElement.classList.contains("scribe-clean"));
    assert.deepEqual(plain(Object.values(env.ctl.state.proposal.decisions)), ["pending", "pending", "pending", "pending"]);
  });
});

describe("The same controls by mouse", () => {
  it("should decide from the rail's ✓ and ✗, and undo", async () => {
    const env = await openWithProposal();
    click(rail(env)[0].querySelector('[data-review="accept"]'));
    click(rail(env)[1].querySelector('[data-review="reject"]'));
    assert.deepEqual([state(env, "o2"), state(env, "o1")], ["accepted", "rejected"]);
    assert.match(rail(env)[1].textContent, /Rejected/);
    click(rail(env)[1].querySelector('[data-review="undo"]'));
    assert.equal(state(env, "o1"), "pending");
  });

  it("should accept all but the unverified, then count it in Save as v5", async () => {
    const env = await openWithProposal();
    const acceptAll = bar(env).querySelector('[data-review="accept-all"]');
    assert.equal(acceptAll.textContent, "Accept all verified");
    click(acceptAll);
    assert.equal(state(env, "o3"), "pending");
    assert.equal(bar(env).querySelector('[data-review="save"]').textContent, "Save as v5 (3 accepted)");
  });

  it("should toggle Show changes from the header button", async () => {
    const env = await openWithProposal();
    click(env.host.querySelector('[data-scribe="show-changes"]'));
    assert.ok(env.inner.documentElement.classList.contains("scribe-clean"));
  });

  it("should reject all, then offer to close without saving", async () => {
    const env = await openWithProposal();
    click(bar(env).querySelector('[data-review="reject-all"]'));
    assert.deepEqual(plain(Object.values(env.ctl.state.proposal.decisions)), ["rejected", "rejected", "rejected", "rejected"]);
    const close = bar(env).querySelector('[data-review="discard"]');
    assert.equal(close.textContent, "Discard");
    click(close);
    await settle();
    assert.equal(env.ctl.state.proposal, null);
    assert.deepEqual(plain(env.calls.filter((c) => c[0] === "rejectEdit")), [["rejectEdit", "p1"]]);
    assert.equal(env.inner.querySelectorAll(".scribe-mark").length, 0, "the page is back to its saved text");
    assert.equal(env.inner.querySelectorAll("[data-scribe-op]").length, 0);
  });

  it("should not save with nothing accepted", async () => {
    const env = await openWithProposal();
    const save = bar(env).querySelector('[data-review="save"]');
    assert.equal(save.getAttribute("aria-disabled"), "true");
    click(save);
    assert.equal(env.calls.filter((c) => c[0] === "acceptEdit").length, 0);
  });
});

describe("Saving", () => {
  it("should save the accepted ops, confirming the unverified one, from the Save button", async () => {
    const env = await openWithProposal();
    click(bar(env).querySelector('[data-review="accept-all"]'));
    click(rail(env)[1].querySelector('[data-review="undo"]'));
    click(rail(env)[1].querySelector('[data-review="reject"]'));
    click(bar(env).querySelector('[data-review="save"]'));
    await settle();
    const [call] = env.calls.filter((c) => c[0] === "acceptEdit");
    assert.deepEqual(call, ["acceptEdit", "p1", { accept: ["o2", "o4"], confirmUnverified: [] }]);
    assert.match(env.host.querySelector(".scribe__log").textContent, /Saved as v5/);
  });

  it("should save by itself once every change is decided and the desk sits idle", async () => {
    const env = await openWithProposal();
    press(env, "A", { shiftKey: true });
    assert.equal(bar(env).querySelector(".scribe__autosave"), null, "one change is still open");
    press(env, "k");
    press(env, "k");
    press(env, "a");
    assert.match(bar(env).querySelector(".scribe__autosave").textContent, /Saving as v5…/);
    assert.equal(env.calls.filter((c) => c[0] === "acceptEdit").length, 0, "not before the 3 s pass");
    env.win.flushTimers();
    await settle();
    const [call] = env.calls.filter((c) => c[0] === "acceptEdit");
    assert.deepEqual(call[2], { accept: ["o2", "o1", "o3", "o4"], confirmUnverified: ["o3"] });
  });
});

describe("Stop", () => {
  it("should keep the validated ops and mark the proposal partial", async () => {
    const env = await openWithProposal({ holdStream: true, ops: OPS.slice(0, 2) });
    assert.equal(env.ctl.state.busy, true);
    assert.equal(rail(env).length, 2, "notes arrive with the ops");
    assert.equal(rail(env)[0].querySelector("button"), null, "no decisions while Scribe is still working");
    click(env.host.querySelector('[data-scribe="stop"]'));
    await settle();
    const p = env.ctl.state.proposal;
    assert.equal(p.status, "partial");
    assert.deepEqual(plain(p.changes.map((c) => c.opId)), ["o2", "o1"]);
    assert.match(env.host.querySelector(".scribe__log").textContent, /Stopped./);
    assert.match(bar(env).textContent, /Save as v5/);
    press(env, "j");
    press(env, "a");
    assert.equal(state(env, "o2"), "accepted", "the partial proposal is reviewable");
  });

  it("should keep the ops the server validated when Stop lands before any op arrived (Grok F2-STOP)", async () => {
    const env = await openWithProposal({ holdStream: true, ops: [], stopOps: OPS.slice(0, 2) });
    assert.equal(rail(env).length, 0, "nothing streamed yet: Scribe is still checking facts");
    click(env.host.querySelector('[data-scribe="stop"]'));
    await settle();
    const p = env.ctl.state.proposal;
    assert.ok(p, "the proposal is kept");
    assert.equal(p.status, "partial");
    assert.deepEqual(plain(p.changes.map((c) => c.opId)), ["o2", "o1"]);
    assert.match(env.host.querySelector(".scribe__log").textContent, /Stopped./);
    assert.doesNotMatch(env.host.querySelector(".scribe__log").textContent, /No changes suggested/);
    assert.match(bar(env).textContent, /Save as v5/);
  });

  it("should still say so when Stop comes back with nothing", async () => {
    const env = await openWithProposal({ holdStream: true, ops: [], stopOps: [] });
    click(env.host.querySelector('[data-scribe="stop"]'));
    await settle();
    assert.equal(env.ctl.state.proposal, null);
    assert.match(env.host.querySelector(".scribe__log").textContent, /Stopped\. No changes suggested\./);
  });
});

describe("Review keys from inside the preview (Grok F2-KEYS)", () => {
  /* A click in the page puts focus in the srcdoc frame's own document. */
  it("should take j, a, r, Shift+A and D pressed inside the page", async () => {
    const env = await openWithProposal();
    const body = env.inner.body;
    press(env, "j", { target: body });
    assert.equal(focusedBlock(env), block(env, "o2"));
    press(env, "a", { target: body });
    press(env, "j", { target: body });
    press(env, "r", { target: body });
    press(env, "k", { target: body });
    assert.deepEqual([state(env, "o2"), state(env, "o1")], ["accepted", "rejected"]);
    assert.equal(focusedBlock(env), block(env, "o2"), "k from the page walks back");
    press(env, "A", { target: body, shiftKey: true });
    assert.equal(state(env, "o4"), "accepted");
    press(env, "D", { target: body });
    assert.ok(env.inner.documentElement.classList.contains("scribe-clean"));
  });

  it("should leave Cmd/Ctrl combinations and other keys in the page alone", async () => {
    const env = await openWithProposal();
    const ev = press(env, "a", { target: env.inner.body, metaKey: true });
    assert.notEqual(ev.defaultPrevented, true);
    press(env, "x", { target: env.inner.body });
    assert.deepEqual(plain(Object.values(env.ctl.state.proposal.decisions)), ["pending", "pending", "pending", "pending"]);
  });
});

describe("Targets (SPEC §4, Grok F2-HIT)", () => {
  it("should give every rail and card control at least 32px on desktop", () => {
    const css = read("scribe-v2.css");
    const block = css.slice(css.indexOf("Proposal marks and review (lane F2)"));
    const desktop = block.slice(0, block.indexOf("@media"));
    const small = [...desktop.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1])).filter((n) => n < 32);
    assert.deepEqual(small, [], "no desktop control under 32px");
  });
});
