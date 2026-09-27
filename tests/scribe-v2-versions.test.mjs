/* scribe-v2-versions.test.mjs — EDITOR lane F3.

   The versions rail is where a user gets back to something they liked:
   View shows an older version without touching it, Compare marks what
   changed from A to B without offering to accept anything, and Bring back
   asks first, then APPENDS a version. Nothing in this rail ever deletes a
   run (SPEC §2 "Nothing is ever deleted"; recon R10/R16), so the tests pin
   the append, the ask-first step and the read-only surfaces.

   Harness: tests/fixtures/jb-dom.mjs under node:vm, both scripts loaded
   the way index.html loads them, with a scripted API in place of
   scribe-v2-api.js. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { makeEnv } from "./fixtures/jb-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

function loadPure() {
  const win = { console };
  vm.runInNewContext(read("scribe-v2-versions.js"), win);
  return win.JBScribeVersions;
}

const V = loadPure();
const plain = (value) => JSON.parse(JSON.stringify(value));
const show = (parts) => parts.map((p) => (p.kind === "same" ? p.text : p.kind === "del" ? `[-${p.text}-]` : `{+${p.text}+}`)).join("");

describe("diffWords: word-level A → B", () => {
  it("should return one unchanged run for identical text", () => {
    assert.deepEqual(plain(V.diffWords("Cut latency 38%.", "Cut latency 38%.")), [{ kind: "same", text: "Cut latency 38%." }]);
  });

  it("should mark only the words that changed", () => {
    assert.equal(show(V.diffWords("Built a weekly dashboard for ops.", "Built a daily dashboard for ops.")), "Built a [-weekly-]{+daily+} dashboard for ops.");
  });

  it("should fold an unchanged gap of two words or fewer into one change", () => {
    /* "the old" sits between two changes: one reworded phrase, not three marks. */
    assert.equal(
      show(V.diffWords("Led the old move to services.", "Ran the old rebuild to services.")),
      "[-Led the old move-]{+Ran the old rebuild+} to services.",
    );
  });

  it("should keep a gap of three words as unchanged text", () => {
    assert.equal(
      show(V.diffWords("Led a big checkout move today.", "Ran a big checkout rebuild today.")),
      "[-Led-]{+Ran+} a big checkout [-move-]{+rebuild+} today.",
    );
  });

  it("should treat punctuation as its own token and keep figures whole", () => {
    assert.equal(show(V.diffWords("Cut delays 38%.", "Cut delays 38%!")), "Cut delays 38%[-.-]{+!+}");
    assert.deepEqual(plain(V.tokenize("Saved $4.1M, 2.3M runs")), ["Saved", " ", "$4.1M", ",", " ", "2.3M", " ", "runs"]);
  });

  it("should show an added or emptied block as one insertion or deletion", () => {
    assert.equal(show(V.diffWords("", "New line.")), "{+New line.+}");
    assert.equal(show(V.diffWords("Old line.", "")), "[-Old line.-]");
  });
});

describe("diffNodes: which blocks differ", () => {
  const A = [
    { id: "stmt", kind: "statement", text: "Analyst who reduced delays." },
    { id: "b:acme:c14", kind: "bullet", text: "Measured carrier delays." },
    { id: "b:acme:c19", kind: "bullet", text: "Documented the handoff." },
  ];
  const B = [
    { id: "stmt", kind: "statement", text: "Analyst who cut delays." },
    { id: "b:acme:c14", kind: "bullet", text: "Measured carrier delays." },
    { id: "b:acme:c22", kind: "bullet", text: "Trained six coordinators." },
  ];

  it("should list changed, added and removed blocks in reading order and skip the same ones", () => {
    const out = V.diffNodes(A, B);
    assert.deepEqual(plain(out.map((b) => [b.id, b.change])), [
      ["stmt", "changed"],
      ["b:acme:c19", "removed"],
      ["b:acme:c22", "added"],
    ]);
    assert.equal(out[0].label, "Summary");
    assert.equal(out[1].label, "Bullet, acme");
    assert.deepEqual([out[0].added, out[0].removed], [1, 1]);
    assert.deepEqual([out[2].added, out[2].removed], [3, 0]);
  });

  it("should report nothing when the wording is the same", () => {
    assert.deepEqual(plain(V.diffNodes(A, plain(A))), []);
  });

  it("should keep the letter's blocks apart from the resume's", () => {
    const nodes = [{ id: "stmt", kind: "statement" }, { id: "sal", kind: "salutation" }, { id: "p:p1", kind: "paragraph" }];
    assert.deepEqual(V.nodesForDoc(nodes, "cover_letter").map((n) => n.id), ["sal", "p:p1"]);
    assert.deepEqual(V.nodesForDoc(nodes, "resume").map((n) => n.id), ["stmt"]);
  });
});

describe("sourceLabel", () => {
  it("should name every run source the server writes", () => {
    assert.deepEqual(
      ["draft", "edit", "manual", "regenerate", "restore"].map((source) => V.sourceLabel({ source })),
      ["Draft", "Scribe edit", "Manual", "Regenerated", "Brought back"],
    );
  });
});

/* ---------------- The desk ---------------- */

const MODELS = {
  r0: [{ id: "stmt", kind: "statement", text: "Operations analyst who reduced fulfillment delays." }, { id: "sal", kind: "salutation", text: "Dear team," }],
  r1: [{ id: "stmt", kind: "statement", text: "Operations analyst who reduced fulfillment delays." }, { id: "sal", kind: "salutation", text: "Dear team," }],
  r2: [{ id: "stmt", kind: "statement", text: "Operations analyst who cut fulfillment delays 38%." }, { id: "sal", kind: "salutation", text: "Hello team," }],
};

function versionRows() {
  return [
    { runId: "r2", n: 2, createdAt: "2026-09-27T16:00:00.000Z", source: "edit", label: "Shorter summary", prompt: "Shorter summary", parentRunId: "r1", pinned: false, starred: false, pages: 1, words: 380, family: "signal" },
    { runId: "r1", n: 1, createdAt: "2026-09-26T16:00:00.000Z", source: "manual", label: "Manual edit", parentRunId: "r0", pinned: false, starred: true, pages: 1, words: 410, family: "signal" },
    { runId: "r0", n: 0, createdAt: "2026-09-25T16:00:00.000Z", source: "draft", label: "Drafted", pinned: true, starred: false, pages: 1, words: 402, family: "signal" },
  ];
}

function scriptedApi({ restoreFails = false } = {}) {
  const calls = [];
  const store = { resume: versionRows(), cover_letter: [{ runId: "l0", n: 0, createdAt: "2026-09-25T16:00:00.000Z", source: "draft", label: "Drafted", pinned: true, pages: 1, words: 210, family: "signal" }] };
  const api = {
    mode: "stub",
    listVersions: (doc) => {
      calls.push(["listVersions", doc]);
      return Promise.resolve(plain({ versions: store[doc], currentRunId: store[doc][0].runId }));
    },
    preview: (body) => {
      calls.push(["preview", body.doc, body.baseRunId]);
      return Promise.resolve({ html: `<html><body><main data-page="1">${body.baseRunId} render</main></body></html>`, words: 2, pageBudget: 1 });
    },
    getModel: (runId) => { calls.push(["getModel", runId]); return Promise.resolve({ model: {}, nodes: plain(MODELS[runId] || []) }); },
    propose: () => new Promise(() => {}),
    stream: () => new Promise(() => {}),
    stopEdit: () => Promise.resolve({ status: "partial", ops: [] }),
    rejectEdit: () => Promise.resolve(null),
    star: () => Promise.resolve({ ok: true }),
    restore: (runId) => {
      calls.push(["restore", runId]);
      if (restoreFails) return Promise.reject(Object.assign(new Error("The materials server is not answering."), { status: 0 }));
      const rows = store.resume;
      const from = rows.find((r) => r.runId === runId);
      const row = { ...from, runId: "r" + (rows[0].n + 1), n: rows[0].n + 1, source: "restore", label: `Restored from v${from.n}`, prompt: undefined, parentRunId: rows[0].runId, restoredFrom: runId, pinned: false, starred: false };
      rows.unshift(row);
      return Promise.resolve({ run: plain(row) });
    },
  };
  return { api, calls, store };
}

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve)); };

async function openDesk(opts) {
  const win = makeEnv({ bodyClass: "jb-v2" });
  win.Date = Date;
  win.JBScribeApi = { MAX_INSTRUCTION: 2000, create: () => { throw new Error("tests pass their own api"); } };
  const logged = [];
  win.JobBoredA11y = { live: { announce: (msg, o) => logged.push([msg, o ? o.politeness : "polite"]) } };
  vm.runInNewContext(read("scribe-v2-versions.js"), win);
  vm.runInNewContext(read("scribe-v2.js"), win);
  const edit = win.document.createElement("button");
  win.document.body.appendChild(edit);
  const { api, calls, store } = scriptedApi(opts);
  const ctl = win.JB_SCRIBE_V2.open({ slug: "acme-platform-engineer", doc: "resume", opener: edit, api, title: "Platform Engineer", company: "Acme" });
  await settle();
  const host = win.document.body.querySelector("jb-scribe");
  return { win, doc: win.document, host, ctl, calls, store, spoken: logged };
}

const click = (el) => el.dispatchEvent({ type: "click", target: el });
const key = (target, k, extra = {}) => target.dispatchEvent({ type: "keydown", key: k, target, bubbles: true, ...extra });
const row = (host, runId) => host.querySelector(`.scribe__ver[data-run="${runId}"]`);
const act = (host, name, runId) => host.querySelector(`[data-ver-act="${name}"][data-run="${runId}"]`);
const pane = (host) => host.querySelector(".scribe__compare");

describe("Versions rail rows", () => {
  it("should show each version's source, and View, Compare and Bring back on older ones", async () => {
    const { host } = await openDesk();
    assert.deepEqual(
      host.querySelectorAll(".scribe__ver").map((r) => r.querySelector(".scribe__compare-src").textContent),
      ["Scribe edit", "Manual", "Draft"],
    );
    assert.match(row(host, "r1").querySelector(".scribe__ver-meta").textContent, /^Manual.*\+8 words · 1 page · Signal/);
    assert.equal(act(host, "view", "r1").getAttribute("aria-label"), "View v1, read-only");
    assert.equal(act(host, "compare", "r1").getAttribute("aria-label"), "Compare v1 with current");
    assert.equal(act(host, "bring", "r1").getAttribute("aria-label"), "Bring back v1 as a new version");
    assert.equal(act(host, "view", "r2"), null, "the current version is already on screen");
    assert.equal(act(host, "bring", "r2"), null, "the current version cannot be brought back");
    assert.equal(act(host, "compare", "r2").getAttribute("aria-label"), "Compare v2 with the version before it");
    assert.ok(row(host, "r0").querySelector(".scribe__ver-pin"), "v0 stays pinned");
    assert.ok(row(host, "r1").querySelector("[data-star]"), "any other row can be starred");
  });
});

describe("View", () => {
  it("should show an older version read-only and go back to the live preview", async () => {
    const { host, calls, doc } = await openDesk();
    const view = act(host, "view", "r0");
    click(view);
    await settle();
    assert.ok(calls.some((c) => c[0] === "preview" && c[2] === "r0"), "the preview is of the chosen run");
    assert.equal(pane(host).hasAttribute("hidden"), false);
    assert.equal(host.querySelector(".scribe__docscroll").hasAttribute("hidden"), true, "the live preview steps aside");
    assert.equal(pane(host).getAttribute("aria-label"), "Resume, version 0, read-only");
    assert.match(pane(host).querySelector(".scribe__compare-frame").srcdoc, /r0 render/);
    assert.equal(pane(host).querySelector(".scribe__compare-frame").getAttribute("sandbox"), "allow-same-origin");
    assert.equal(pane(host).querySelectorAll("textarea").length, 0);
    const back = pane(host).querySelector('[data-cmp-act="exit"]');
    assert.equal(back.textContent, "Back to current");
    click(back);
    assert.equal(pane(host).hasAttribute("hidden"), true);
    assert.equal(host.querySelector(".scribe__docscroll").hasAttribute("hidden"), false);
    assert.equal(doc.activeElement, view, "focus returns to the row's View button");
  });
});

describe("Compare", () => {
  it("should mark the A → B wording and offer no accept controls", async () => {
    const { host, calls, spoken } = await openDesk();
    click(act(host, "compare", "r0"));
    await settle();
    assert.ok(calls.some((c) => c[0] === "getModel" && c[1] === "r0"));
    assert.ok(calls.some((c) => c[0] === "getModel" && c[1] === "r2"));
    assert.equal(pane(host).getAttribute("data-mode"), "compare");
    assert.equal(host.querySelector("[data-ver-compare]").getAttribute("aria-pressed"), "true");
    const items = pane(host).querySelectorAll(".scribe__compare-item");
    assert.deepEqual(items.map((i) => i.getAttribute("data-block")), ["stmt"], "only this document's blocks, only the changed ones");
    const text = items[0].querySelector(".scribe__compare-text");
    assert.equal(text.textContent.replace(/(inserted|deleted): | end (inserted|deleted)/g, ""), "Operations analyst who reduced fulfillment delayscut fulfillment delays 38%.");
    assert.equal(text.querySelector("del").textContent, "deleted: reduced fulfillment delays end deleted");
    assert.equal(text.querySelector("ins").textContent, "inserted: cut fulfillment delays 38% end inserted");
    assert.equal(pane(host).querySelector(".scribe__compare-head").textContent, "What changed from v0 to v2");
    const buttons = pane(host).querySelectorAll("button").map((b) => b.textContent);
    assert.ok(!buttons.some((t) => /accept|reject/i.test(t)), `no accept controls in compare: ${buttons}`);
    const frames = pane(host).querySelectorAll(".scribe__compare-frame");
    assert.deepEqual(frames.map((f) => f.getAttribute("title")), ["Version A, v0", "Version B, v2, marked against A"]);
    assert.ok(spoken.some(([m]) => m === "Comparing v0 with v2. 1 block differ, +4 −3 words."), JSON.stringify(spoken));
    /* The A/B toggle (shown below 1024px by CSS) swaps which page shows. */
    const tabA = pane(host).querySelector('[data-ab="A"]');
    click(tabA);
    assert.equal(pane(host).getAttribute("data-ab"), "A");
    assert.equal(pane(host).querySelector('[data-ab="A"]').getAttribute("aria-selected"), "true");
  });

  it("should toggle with the c key, but not while typing", async () => {
    const { host } = await openDesk();
    const composer = host.querySelector("textarea");
    key(composer, "c");
    assert.equal(pane(host).hasAttribute("hidden"), true, "c in the composer is just a letter");
    const btn = host.querySelector("[data-ver-compare]");
    key(btn, "c");
    await settle();
    assert.equal(pane(host).getAttribute("data-mode"), "compare");
    const sel = pane(host).querySelectorAll("select");
    assert.deepEqual(sel.map((s) => s.value), ["r1", "r2"], "the header compares current with the version before it");
    key(btn, "c");
    assert.equal(pane(host).hasAttribute("hidden"), true);
    assert.equal(btn.getAttribute("aria-pressed"), "false");
  });

  it("should re-pick A from the select and say when nothing differs", async () => {
    const { host } = await openDesk();
    click(host.querySelector("[data-ver-compare]"));
    await settle();
    assert.match(pane(host).querySelector(".scribe__compare-changes").textContent, /cut fulfillment/);
    const selA = pane(host).querySelector('[data-cmp-pick="A"]');
    selA.value = "r2";
    pane(host).dispatchEvent({ type: "change", target: selA });
    await settle();
    assert.equal(pane(host).querySelector(".scribe__compare-note").textContent, "A and B are the same version.");
  });

  it("should leave compare when the document tab changes", async () => {
    const { host } = await openDesk();
    click(host.querySelector("[data-ver-compare]"));
    await settle();
    click(host.querySelector('[role="tab"][data-doc="cover_letter"]'));
    await settle();
    assert.equal(pane(host).hasAttribute("hidden"), true);
    assert.equal(host.querySelector("[data-ver-compare]").getAttribute("aria-disabled"), "true", "one letter version: nothing to compare");
  });
});

describe("Bring back as new", () => {
  it("should ask first, then append a version and delete none", async () => {
    const { host, calls, doc, store } = await openDesk();
    const before = store.resume.map((r) => r.runId);
    click(act(host, "bring", "r0"));
    assert.ok(!calls.some((c) => c[0] === "restore"), "nothing is saved before the user confirms");
    const confirm = row(host, "r0").querySelector(".scribe__compare-confirm");
    assert.match(confirm.textContent, /Bring back v0 as v3\? v2 and every other version stay in the list\./);
    assert.equal(doc.activeElement, act(host, "confirm", "r0"), "focus moves to the confirm button");
    click(act(host, "cancel", "r0"));
    assert.equal(row(host, "r0").querySelector(".scribe__compare-confirm"), null);
    assert.equal(doc.activeElement, act(host, "bring", "r0"));
    assert.ok(!calls.some((c) => c[0] === "restore"), "Cancel saves nothing");

    click(act(host, "bring", "r0"));
    click(act(host, "confirm", "r0"));
    await settle();
    assert.deepEqual(calls.filter((c) => c[0] === "restore"), [["restore", "r0"]]);
    const runs = host.querySelectorAll(".scribe__ver").map((r) => r.getAttribute("data-run"));
    assert.deepEqual(runs, ["r3", ...before], "one version added on top, every earlier one still listed");
    assert.equal(row(host, "r3").getAttribute("aria-current"), "true");
    assert.equal(row(host, "r3").querySelector(".scribe__compare-src").textContent, "Brought back");
    assert.equal(row(host, "r3").querySelector(".scribe__ver-what").textContent, "Restored from v0");
    assert.match(host.querySelector('[role="log"]').textContent, /Brought back v0 as v3\. Nothing was deleted\./);
    assert.ok(calls.some((c) => c[0] === "preview" && c[2] === "r3"), "the live preview reloads on the new version");
  });

  it("should keep every version and say so when the server refuses", async () => {
    const { host, spoken } = await openDesk({ restoreFails: true });
    click(act(host, "bring", "r1"));
    click(act(host, "confirm", "r1"));
    await settle();
    assert.deepEqual(host.querySelectorAll(".scribe__ver").map((r) => r.getAttribute("data-run")), ["r2", "r1", "r0"]);
    assert.ok(spoken.some(([m, p]) => m === "The materials server is not answering." && p === "assertive"));
    assert.ok(row(host, "r1").querySelector(".scribe__compare-confirm"), "the question stays open to try again");
  });
});
