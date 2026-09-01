import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadScribe } from "./fixtures/scribe/scribe-dom.mjs";

// ============================================================
// SCRIBE-01 — boot race + role disconnect.
//
// scribe.js is a deferred script: it runs at readyState
// "interactive", BEFORE index.html's flag script adds body.jb-v2
// (that happens in a DOMContentLoaded listener, because the flag
// script sits in <head> where document.body is still null).
// Sampling the class once at load therefore leaves the workspace
// permanently empty. dawn.js already solved this with a body-class
// MutationObserver (dawn.js observeBodyOnly); scribe must do the
// same. The settings toggle (settings-jb-v2-tab.js) adds the class
// even later at runtime — same fix covers it.
//
// The role label is the second half of the claim: a workspace that
// says "Senior role · Company" for every job is a lie about which
// document the user is editing. It must bind to the live generation
// session, and say so honestly when nothing is bound.
// ============================================================

function sessionHost(session) {
  let current = session;
  return {
    app: {
      resumeGeneration: {
        getLastResumeGenerationSession: () => current,
      },
    },
    set(next) {
      current = next;
    },
  };
}

describe("scribe boot — body.jb-v2 arrives after the deferred script runs (SCRIBE-01)", () => {
  it("renders nothing while the flag is absent but ACTIVATES when the flag script adds body.jb-v2 later (today it stays empty forever)", () => {
    const env = loadScribe({ v2: false, readyState: "interactive" });
    assert.equal(env.region.childNodes.length, 0, "must not render before the flag lands");

    env.body.classList.add("jb-v2");

    assert.ok(env.byId("scribeEditor"), "the workspace must mount once body.jb-v2 appears");
    assert.equal(env.rq("[data-scribe-status]").textContent, "idle");
  });

  it("a runtime toggle OFF then ON again does not double-render the workspace", () => {
    const env = loadScribe({ v2: false, readyState: "interactive" });
    env.body.classList.add("jb-v2");
    const firstEditor = env.byId("scribeEditor");
    env.body.classList.remove("jb-v2");
    env.body.classList.add("jb-v2");
    assert.equal(
      env.rqa(".scribe-workspace").length,
      1,
      "exactly one workspace may exist no matter how often the flag flips",
    );
    assert.equal(env.byId("scribeEditor"), firstEditor, "the mounted editor is not rebuilt");
  });

  it("an unrelated body class change never mounts the workspace (the observer must test the flag, not fire blindly)", () => {
    const env = loadScribe({ v2: false, readyState: "interactive" });
    env.body.classList.add("detail-open");
    assert.equal(env.byId("scribeEditor"), null, "only jb-v2 activates scribe");
  });

  it("the DOMContentLoaded path still works when the script loads into a half-built page", () => {
    const env = loadScribe({ readyState: "loading" });
    assert.equal(env.byId("scribeEditor"), null, "must not render before DOMContentLoaded");
    const ready = env.docListeners.find((l) => l.type === "DOMContentLoaded");
    assert.ok(ready, "must register a DOMContentLoaded listener");
    ready.fn();
    assert.ok(env.byId("scribeEditor"), "renders once the DOM is ready");
  });
});

describe("scribe boot — the role label binds to the live generation session (SCRIBE-01)", () => {
  it("names the role and company from getLastResumeGenerationSession().job instead of the hardcoded 'Senior role · Company'", () => {
    const host = sessionHost({
      feature: "cover_letter",
      job: { title: "Staff Platform Engineer", company: "Northwind" },
    });
    const env = loadScribe({
      modules: ["scribe-state.js", "scribe.js"],
      jobBoredApp: host.app,
    });
    const target = env.rq("[data-scribe-target]");
    assert.equal(target.textContent, "Staff Platform Engineer · Northwind");
    assert.equal(target.getAttribute("data-bound"), "true");
  });

  it("says so honestly when NO session is bound — an unbound workspace must never display a plausible fake role", () => {
    const env = loadScribe({ modules: ["scribe-state.js", "scribe.js"] });
    const target = env.rq("[data-scribe-target]");
    assert.equal(target.textContent, "No role bound yet");
    assert.equal(target.getAttribute("data-bound"), "false");
    assert.ok(
      !/Senior role|Company/.test(target.textContent),
      "the placeholder must not read like a real role",
    );
  });

  it("a session with only a company (or only a title) renders the half it actually has, never an invented other half", () => {
    const host = sessionHost({ feature: "cover_letter", job: { company: "Northwind" } });
    const env = loadScribe({
      modules: ["scribe-state.js", "scribe.js"],
      jobBoredApp: host.app,
    });
    assert.equal(env.rq("[data-scribe-target]").textContent, "Northwind");
    assert.equal(env.rq("[data-scribe-target]").getAttribute("data-bound"), "true");
  });

  it("rebinds when a new draft is saved for a different role (jb:draft:saved is the session-changed signal)", () => {
    const host = sessionHost({
      feature: "cover_letter",
      job: { title: "Staff Platform Engineer", company: "Northwind" },
    });
    const env = loadScribe({
      modules: ["scribe-state.js", "scribe.js"],
      jobBoredApp: host.app,
    });
    assert.equal(env.rq("[data-scribe-target]").textContent, "Staff Platform Engineer · Northwind");

    host.set({ feature: "resume_update", job: { title: "Design Engineer", company: "Ada Labs" } });
    env.emit("jb:draft:saved", { feature: "resume_update", draftId: "d2" }, env.document);

    assert.equal(
      env.rq("[data-scribe-target]").textContent,
      "Design Engineer · Ada Labs",
      "the label must follow the session, not the first render",
    );
  });

  it("the document tab reflects the bound session's feature so the header cannot claim a cover letter while a resume is bound", () => {
    const host = sessionHost({
      feature: "resume_update",
      job: { title: "Design Engineer", company: "Ada Labs" },
    });
    const env = loadScribe({
      modules: ["scribe-state.js", "scribe.js"],
      jobBoredApp: host.app,
    });
    assert.equal(env.rq('[data-scribe-tab="resume_update"]').getAttribute("aria-selected"), "true");
    assert.equal(env.rq('[data-scribe-tab="cover_letter"]').getAttribute("aria-selected"), "false");
    assert.equal(env.rq("[data-scribe-kicker]").textContent, "Resume draft");
  });

  it("degrades to the unbound label when scribe-state.js is not loaded at all (no crash, no fake role)", () => {
    const env = loadScribe();
    assert.equal(env.rq("[data-scribe-target]").textContent, "No role bound yet");
    assert.equal(env.rq("[data-scribe-target]").getAttribute("data-bound"), "false");
  });
});

// ============================================================
// SCRIBE-01b — the F2-A remount contract must actually reach scribe.
//
// jb-v2-boot-contract.js:58's default "scribe" adapter is:
//     mount: function () {
//       var api = root.JB_SCRIBE;
//       if (api && typeof api.boot === "function") api.boot();
//     }
// Nothing on either reconciled branch exported JB_SCRIBE.boot, so that
// adapter has always been a guarded no-op: the contract reports a mount
// it never performed. The F2-A suite cannot catch it because it drives
// the contract with its own fake adapters.
//
// The observer scribe installs for itself covers the ordinary flag race.
// It does NOT cover the page where the deferred script ran before
// DOMContentLoaded — there scribe is waiting on a document event, and
// the boot contract is the only thing that will act on a later flag flip.
// That is the state exercised below.
// ============================================================

const BOOT_CONTRACT_MODULES = ["scribe.js", "jb-v2-boot-contract.js"];

describe("scribe boot — the F2-A remount contract is not a silent no-op (SCRIBE-01)", () => {
  it("exports JB_SCRIBE.boot, the exact name jb-v2-boot-contract.js's default adapter calls", () => {
    const env = loadScribe({ modules: BOOT_CONTRACT_MODULES });
    assert.equal(
      typeof env.window.JB_SCRIBE.boot,
      "function",
      "without this the contract's scribe adapter guards itself into doing nothing",
    );
  });

  it("mounts the workspace when the contract remounts on a flag flip the deferred script never saw", () => {
    // readyState "loading": scribe is parked on DOMContentLoaded and has NOT
    // installed its own body observer, so the contract is the only live path.
    const env = loadScribe({ modules: BOOT_CONTRACT_MODULES, v2: false, readyState: "loading" });
    assert.equal(env.byId("scribeEditor"), null, "nothing is mounted yet");

    env.body.classList.add("jb-v2");

    assert.ok(
      env.byId("scribeEditor"),
      "the remount contract must actually mount scribe, not just report that it did",
    );
    assert.equal(env.rq("[data-scribe-status]").textContent, "idle");
  });

  it("is safe to call repeatedly — boot is guarded by the rendered flag", () => {
    const env = loadScribe({ modules: BOOT_CONTRACT_MODULES });
    const firstEditor = env.byId("scribeEditor");
    assert.ok(firstEditor, "mounted on load");
    env.window.JB_SCRIBE.boot();
    env.window.JB_SCRIBE.boot();
    assert.equal(env.qa(".scribe-workspace").length, 1, "exactly one workspace");
    assert.equal(env.byId("scribeEditor"), firstEditor, "and the editor is never rebuilt");
  });

  it("does not mount while the flag is off, however often the contract syncs", () => {
    const env = loadScribe({ modules: BOOT_CONTRACT_MODULES, v2: false, readyState: "loading" });
    env.window.JobBoredV2Boot.sync(env.document);
    env.window.JB_SCRIBE.boot();
    assert.equal(env.byId("scribeEditor"), null, "body.jb-v2 is still the gate");
  });
});
