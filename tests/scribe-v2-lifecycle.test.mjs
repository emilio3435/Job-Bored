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

import { makeEnv } from "./fixtures/jb-dom.mjs";

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
