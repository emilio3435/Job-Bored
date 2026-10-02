/* grade-fe-dossier.test.mjs — GRADE lane W-FE in the dossier's Materials
   rows (role-materials.js).

   G1  the row's button is the verdict: "<word> · <first reason>"
   G7  a held root's Download goes through the in-page confirm, with the
       held copy, never window.confirm
   G6  Versions lists both passes of a repaired draft, each downloadable
       from the run-scoped file route
   G8  the modal's Rescore re-runs the quality check on that run
       (POST /runs/:runId/rescore), never the ATS scorer

   Harness: the parsing DOM (tests/fixtures/holes-score-dom.mjs) with the
   shipped jb-a11y.js, materials-insights.js, materials-score.js and
   role-materials.js; fetch is a stub serving W-BE's frozen fixtures. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as V3 from "./fixtures/materials-qa-v3.mjs";
import { click, keydown, load, makeScoreEnv, read, text } from "./fixtures/holes-score-dom.mjs";

const BASE = "http://127.0.0.1:3847";
const SLUG = "acme-robotics-dispatch-analyst";
const RUN = V3.V3_READY.runId;
const FILE = (name) => ({ filename: name, format: name.split(".").pop(), size: 1000, modifiedAt: "2026-10-02T09:00:00.000Z" });
const qd = (qa) => ({ status: qa.disposition === "FAIL" ? "fail" : "pass", issues: [], qa });

function manifest(over = {}) {
  return {
    slug: SLUG, company: "Acme Robotics", title: "Dispatch analyst", runId: RUN,
    template: { family: "signal", source: "draft" },
    documents: [
      { type: "resume", label: "Tailored Resume", status: "ready", primary: "resume.pdf", lastModifiedAt: "2026-10-02T09:00:00.000Z",
        files: [FILE("resume.pdf"), FILE("resume.html")], text: FILE("resume.txt"), exports: { docx: true } },
      { type: "cover_letter", label: "Cover Letter", status: "ready", primary: "cover-letter.pdf", lastModifiedAt: "2026-10-02T09:00:00.000Z",
        files: [FILE("cover-letter.pdf"), FILE("cover-letter.html")], text: FILE("cover-letter.txt"), exports: { docx: true } },
    ],
    quality: { documents: { resume: qd({ ...V3.V3_READY, document: "resume" }), cover_letter: qd(V3.V3_GATE_FAIL_PERFECT) } },
    ...over,
  };
}

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const settle = async (n = 60) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function boot(opts = {}) {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  const doc = win.document;
  const region = doc.createElement("section");
  region.setAttribute("data-region", "role");
  const mount = doc.createElement("div");
  mount.setAttribute("data-mount", "materials");
  region.appendChild(mount);
  doc.body.appendChild(region);
  const state = { manifest: opts.manifest || manifest(), runs: opts.runs || V3.RUNS_REPAIR_PASSED };
  const calls = [];
  const analyses = [];
  const downloads = [];
  win.location = { hostname: "localhost", hash: "", search: "" };
  win.getJobPostingScrapeUrl = () => BASE;
  win.queueMicrotask = (fn) => fn();
  win.setInterval = () => 1;
  win.clearInterval = () => {};
  win.encodeURIComponent = encodeURIComponent;
  win.showToast = () => {};
  win.confirm = () => { throw new Error("window.confirm must never be used"); };
  win.JobBoredDawn = { data: { getRoleViewModel: () => ({ job: { company: "Acme Robotics", role: "Dispatch analyst" } }) } };
  win.JobBored = { getSheetId: () => "sheet-1", getPipelineJobs: () => [] };
  win.JobBoredFlowing = { openRole: { get: () => null } };
  win.JobBoredApp = {
    core: { getJobByStableKey: () => ({ title: "Dispatch analyst", company: "Acme Robotics" }) },
    materialsState: { getScorecardForJob: () => null, getAtsScorecardState: () => ({ status: "idle", cacheKey: "" }) },
    ats: {
      computeAtsScorecardCacheKey: () => "k",
      buildAtsScorecardRequestPayload: () => ({}),
      startAtsScorecardAnalysis: (...a) => analyses.push(a),
    },
  };
  win.fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    calls.push([method, String(url), init && init.body]);
    if (/\/api\/applications$/.test(url)) return json({ applications: [{ slug: SLUG }] });
    if (/\/manifest$/.test(url)) return json(state.manifest);
    if (/\/runs$/.test(url)) return json({ runs: state.runs });
    if (/\/rescore$/.test(url)) return opts.rescoreReply ? opts.rescoreReply() : json({ ok: true });
    return json({ ok: true });
  };
  win.addEventListener("jb:role:materials:downloaded", (e) => downloads.push(e.detail));
  load(win, ["jb-text.js", "role-case-model.js", "jb-a11y.js", "materials-insights.js", "materials-score.js", "role-materials.js"]);
  const said = [];
  const live = win.JobBoredA11y.live.announce;
  win.JobBoredA11y.live.announce = (msg, o) => { said.push(msg); return live(msg, o); };
  async function openRole() {
    win.JobBoredFlowing.openRole.get = () => "job-1";
    win.dispatchEvent(new win.CustomEvent("jb:role:opened", { detail: { jobKey: "job-1" } }));
    await settle();
  }
  const rowOf = (type) => doc.querySelector(`[data-doc="${type}"]`);
  const modal = () => doc.querySelector(".jb-score");
  return { win, doc, state, calls, analyses, downloads, said, openRole, rowOf, modal };
}

describe("GRADE-F G1 · the row's button is the verdict", () => {
  it("GRADE-F G1: a failed gate reads 'Fails · Tool support'; a passing document reads 'Ready'", async () => {
    const env = boot();
    await env.openRole();
    const letter = env.rowOf("cover_letter").querySelector("[data-score-open]");
    assert.equal(text(letter), "Fails · Tool support");
    assert.equal(letter.getAttribute("data-tone"), "err");
    assert.doesNotMatch(letter.getAttribute("aria-label"), /Grade|of 100/);
    assert.equal(text(env.rowOf("resume").querySelector("[data-score-open]")), "Ready");
  });

  it("GRADE-F G1: a document is not stale just because the other document's run is newer", async () => {
    const env = boot({ manifest: manifest({ runId: "mr_20261002100000_acme_b2" }) });
    await env.openRole();
    assert.equal(env.rowOf("resume").querySelector("[data-score-open]").getAttribute("data-stale"), null);
  });
});

describe("GRADE-F G7 · a held root downloads only after the in-page confirm", () => {
  it("GRADE-F G7: every Download entry of a failing root is gated 'held' and asks with the held copy", async () => {
    const env = boot();
    await env.openRole();
    const row = env.rowOf("cover_letter");
    const gated = row.querySelectorAll('[data-gate="held"]');
    assert.ok(gated.length >= 3, "PDF, text and Word");
    assert.equal(row.querySelectorAll('[data-gate="fail"]').length, 0);
    const pdf = [...gated].find((a) => /cover-letter\.pdf/.test(a.getAttribute("href") || ""));
    pdf.dispatchEvent(click(pdf));
    const box = row.querySelector(".mat-confirm");
    assert.ok(box, "the in-page confirm opened");
    assert.equal(box.getAttribute("data-gate"), "held");
    assert.equal(text(box.querySelector(".mat-confirm__q")), "This version is held — Tool support. Download anyway?");
  });
});

/* FIX1-F4 (Astra F11): one Held rule. A run with any FAIL document is held,
   so the Ready resume of that same run asks first too — as its row in
   Versions does — while a resume from another run downloads freely. */
describe("GRADE-F FIX1-F4 · root downloads follow the run-level Held rule", () => {
  it("GRADE-F FIX1-F4: a Ready resume of a run whose letter fails is held; one from another run is not", async () => {
    const env = boot();
    await env.openRole();
    const resume = env.rowOf("resume");
    assert.equal(text(resume.querySelector("[data-score-open]")), "Ready", "its own verdict is still Ready");
    const gated = resume.querySelectorAll('[data-gate="held"]');
    assert.ok(gated.length >= 2, "PDF, text and Word ask first");
    assert.equal(gated[0].getAttribute("data-held"), "Cover letter: Tool support");
    const pdf = [...gated].find((a) => /resume\.pdf/.test(a.getAttribute("href") || ""));
    pdf.dispatchEvent(click(pdf));
    assert.equal(text(resume.querySelector(".mat-confirm__q")), "This version is held — Cover letter: Tool support. Download anyway?");

    const other = manifest();
    other.quality.documents.resume = qd({ ...V3.V3_READY, document: "resume", runId: "mr_20261001090000_acme_r0" });
    const env2 = boot({ manifest: other });
    await env2.openRole();
    assert.equal(env2.rowOf("resume").querySelectorAll("[data-gate]").length, 0, "a Ready document from another run downloads freely");
  });
});

describe("GRADE-F G6 · Versions lists both passes, each downloadable", () => {
  it("GRADE-F G6: the inline list shows 'Original draft' and 'Repaired' with run-scoped Preview and Download", async () => {
    const env = boot();
    await env.openRole();
    const toggle = env.rowOf("cover_letter").querySelector('[data-action="materials-history"]');
    toggle.dispatchEvent(click(toggle));
    await settle();
    const list = env.rowOf("cover_letter").querySelector(".mat-hist");
    const runs = list.querySelectorAll("li[data-run]");
    assert.deepEqual([...runs].map((r) => r.getAttribute("data-run")), ["passing-repair-pass-1", "passing-repair"]);
    assert.match(text(runs[0]), /Original draft[\s\S]*Fails/);
    assert.match(text(runs[1]), /Repaired[\s\S]*Default[\s\S]*Ready/);
    const dl = runs[1].querySelector('[data-action="materials-download"]');
    assert.equal(dl.getAttribute("href"), `${BASE}/api/applications/acme/runs/passing-repair/files/cover-letter.pdf?download=1`);
    const held = runs[0].querySelector('[data-action="materials-download"]');
    held.dispatchEvent(click(held));
    const box = env.rowOf("cover_letter").querySelector(".mat-confirm");
    assert.match(text(box), /This version is held — 1 claim needs a source\. Download anyway\?/);
    const anyway = box.querySelector('[data-action="materials-download-anyway"]');
    assert.equal(anyway.getAttribute("data-href"), `${BASE}/api/applications/acme/runs/passing-repair-pass-1/files/cover-letter.pdf?download=1`);
    anyway.dispatchEvent(click(anyway));
    assert.equal(env.downloads.at(-1).afterFailConfirm, true);
  });

  it("GRADE-F G6: the modal's Versions step lists the same rows and gates the held one in the page", async () => {
    const env = boot();
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const step = env.modal().querySelector('[data-score-step="versions"]');
    step.dispatchEvent(click(step));
    await settle();
    const rows = env.modal().querySelectorAll("li[data-run]");
    assert.deepEqual([...rows].map((r) => r.getAttribute("data-run")), ["passing-repair-pass-1", "passing-repair"]);
    const held = rows[0].querySelector('[data-action="materials-download"]');
    held.dispatchEvent(click(held));
    const box = env.modal().querySelector(".mat-confirm");
    assert.ok(box, "the confirm opened inside the modal");
    assert.match(text(box), /This version is held — 1 claim needs a source\. Download anyway\?/);
  });
});

describe("GRADE-F G8 · Rescore re-runs the quality check on that run", () => {
  it("GRADE-F G8: the footer's Rescore posts to /runs/:runId/rescore, never the ATS scorer, and announces no number", async () => {
    const env = boot();
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const rescore = env.modal().querySelector("footer [data-score-rescore]");
    assert.ok(rescore, "Rescore is offered");
    rescore.dispatchEvent(click(rescore));
    await settle();
    const post = env.calls.find(([m, u]) => m === "POST" && /\/rescore$/.test(u));
    assert.ok(post, "it called the rescore route");
    assert.equal(post[1], `${BASE}/api/applications/${SLUG}/runs/${encodeURIComponent(V3.V3_GATE_FAIL_PERFECT.runId)}/rescore`);
    assert.deepEqual(JSON.parse(post[2]), { feature: "cover_letter" });
    assert.equal(env.analyses.length, 0, "the ATS scorer never ran");
    assert.ok(env.said.some((s) => /^Rescored/.test(s)), "the result was announced");
    assert.ok(env.said.every((s) => !/of 100|\/ 100|grade [A-F]/i.test(s)));
  });
});

/* FIX2-N4 (Fable N4): the Apply checklist's resume download carries
   gate "held" (run-level Held) with no reason of its own; the confirm it
   opens must be the same held copy the rows use. */
describe("GRADE-F FIX2-N4 · the checklist's held download asks with the held copy", () => {
  it("GRADE-F FIX2-N4: a held checklist download names the run's held reason, never the FAIL copy", async () => {
    const env = boot();
    await env.openRole();
    const mount = env.doc.querySelector('[data-mount="materials"]');
    const step = env.doc.createElement("div");
    step.setAttribute("data-item", "resume");
    step.setAttribute("data-doc-type", "resume");
    step.innerHTML = '<a href="http://127.0.0.1:3847/api/applications/x/files/resume.pdf?download=1" download data-action="materials-download" data-filename="resume.pdf" data-gate="held">Download</a>';
    mount.querySelector(".brief-materials, section, div").appendChild(step);
    const link = step.querySelector("a");
    link.dispatchEvent(click(link));
    const box = step.querySelector(".mat-confirm");
    assert.ok(box, "the in-page confirm opened");
    assert.equal(box.getAttribute("data-gate"), "held");
    assert.equal(text(box.querySelector(".mat-confirm__q")), "This version is held — Cover letter: Tool support. Download anyway?");
  });
});

/* FIX2-N1 (W-BE): a refused Rescore answers a non-2xx api-error envelope;
   the modal says so in the envelope's own words and the verdict stays. */
describe("GRADE-F FIX2-N1 · a refused Rescore leaves the verdict on screen", () => {
  it("GRADE-F FIX2-N1: the modal shows the envelope's message once, and the verdict is unchanged", async () => {
    const envelope = { error: "Rescore didn\u2019t finish \u2014 no review ran, so the verdict stands.", code: "rescore_no_review", retryable: true };
    const env = boot({ rescoreReply: () => json(envelope, 409) });
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const manifests = () => env.calls.filter(([m, u]) => m === "GET" && /\/manifest$/.test(u)).length;
    const before = manifests();
    const rescore = env.modal().querySelector("footer [data-score-rescore]");
    rescore.dispatchEvent(click(rescore));
    await settle();
    const alert = env.modal().querySelector('footer [role="alert"]');
    assert.ok(alert, "the failure is shown");
    assert.equal(text(alert), "Rescore didn\u2019t finish \u2014 no review ran, so the verdict stands.");
    assert.equal(text(env.modal().querySelector(".jb-score__word")), "Fails", "the verdict on screen is unchanged");
    assert.equal(text(env.modal().querySelector(".jb-score__verdict")), "Tool support: Unknown tool");
    assert.equal(text(env.rowOf("cover_letter").querySelector("[data-score-open]")), "Fails · Tool support");
    assert.equal(manifests(), before, "nothing was refetched as if it had worked");
    assert.equal(env.modal().querySelector("footer [data-score-rescore]").getAttribute("aria-busy"), "false");
  });
});

/* FIX3-W1 (real-Chrome walkthrough): Escape on the held / FAIL confirm
   closed it but left focus on BODY. Escape and Cancel give focus back to
   the Download control that opened it (JB-A11Y: focus returns to the
   opener); a Download inside the closed menu hands it to the menu's
   toggle. The confirm's first action takes focus with a visible ring. */
describe("GRADE-F FIX3-W1 · the held and FAIL confirms give focus back", () => {
  async function openHeld(env, inMenu) {
    const row = env.rowOf("cover_letter");
    if (inMenu) {
      const toggle = row.querySelector('[data-action="materials-download-menu"]');
      toggle.dispatchEvent(click(toggle));
      const pdf = row.querySelector('.mat-dl__menu [data-gate="held"]');
      pdf.dispatchEvent(click(pdf));
      return { row, opener: toggle };
    }
    const versions = row.querySelector('[data-action="materials-history"]');
    versions.dispatchEvent(click(versions));
    await settle();
    const dl = row.querySelector('.mat-hist li[data-run="passing-repair-pass-1"] [data-action="materials-download"]');
    dl.dispatchEvent(click(dl));
    return { row, opener: dl };
  }

  it("GRADE-F FIX3-W1: Escape on a held confirm opened from the Download menu returns focus to the menu's toggle", async () => {
    const env = boot();
    await env.openRole();
    const { row, opener } = await openHeld(env, true);
    const box = row.querySelector(".mat-confirm");
    assert.ok(box, "the confirm opened");
    assert.ok(env.doc.activeElement === box.querySelector("button"), "its first action has focus");
    env.doc.activeElement.dispatchEvent(keydown(env.doc.activeElement, "Escape"));
    assert.ok(row.querySelector(".mat-confirm") === null, "Escape closed it");
    assert.ok(env.doc.activeElement === opener, "focus is back on the Download toggle, not BODY");
  });

  it("GRADE-F FIX3-W1: Escape and Cancel on a version's held confirm return focus to that Download", async () => {
    const env = boot();
    await env.openRole();
    let { row, opener } = await openHeld(env, false);
    env.doc.activeElement.dispatchEvent(keydown(env.doc.activeElement, "Escape"));
    assert.ok(row.querySelector(".mat-confirm") === null);
    assert.ok(env.doc.activeElement === opener, "Escape: focus is back on the version's Download");
    opener.dispatchEvent(click(opener));
    const cancel = row.querySelector('.mat-confirm [data-action="materials-confirm-cancel"]');
    cancel.dispatchEvent(click(cancel));
    assert.ok(row.querySelector(".mat-confirm") === null);
    assert.ok(env.doc.activeElement === opener, "Cancel: focus is back on the version's Download");
  });

  it("GRADE-F FIX3-W1: in the modal, Escape on a held confirm closes only the confirm and returns focus to its Download", async () => {
    const env = boot();
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const step = env.modal().querySelector('[data-score-step="versions"]');
    step.dispatchEvent(click(step));
    await settle();
    const dl = () => env.modal().querySelector('li[data-run="passing-repair-pass-1"] [data-action="materials-download"]');
    dl().dispatchEvent(click(dl()));
    assert.ok(env.modal().querySelector(".mat-confirm"));
    env.doc.activeElement.dispatchEvent(keydown(env.doc.activeElement, "Escape"));
    assert.ok(env.modal(), "the modal stays open");
    assert.ok(env.modal().querySelector(".mat-confirm") === null, "the confirm closed");
    assert.ok(env.doc.activeElement === dl(), "focus is on the version's Download");
    dl().dispatchEvent(click(dl()));
    const cancel = env.modal().querySelector('.mat-confirm [data-action="materials-confirm-cancel"]');
    cancel.dispatchEvent(click(cancel));
    assert.ok(env.doc.activeElement === dl(), "Cancel returns focus to the same Download");
  });

  it("GRADE-F FIX3-W1: the confirm's actions show a focus ring however focus arrived", () => {
    const css = read("materials-insights.css");
    assert.match(css, /\.mat-confirm[^{]*\.case__doc-btn:focus\b[^{]*\{[^}]*box-shadow: var\(--jb-shadow-focus\)/);
  });
});

/* FIX3-W2 (walkthrough): a green "READY" file pill sat beside "Fails · …".
   A drafted document's pill says "Drafted", neutral; the verdict lives on
   the verdict button only. */
describe("GRADE-F FIX3-W2 · no green Ready beside an adverse verdict", () => {
  it("GRADE-F FIX3-W2: a drafted resume or letter's pill reads Drafted, neutral, beside its verdict", async () => {
    const env = boot();
    await env.openRole();
    for (const type of ["cover_letter", "resume"]) {
      const pill = env.rowOf(type).querySelector(".case__docst");
      assert.equal(text(pill), "drafted");
      assert.match(pill.getAttribute("class"), /case__docst--drafted/);
      assert.doesNotMatch(pill.getAttribute("class"), /case__docst--ready/);
    }
    assert.equal(text(env.rowOf("cover_letter").querySelector("[data-score-open]")), "Fails · Tool support");
    assert.match(read("materials-insights.css"), /\.case__docst--drafted \{[^}]*color: var\(--jb-ink-2\)/);
  });

  it("GRADE-F FIX3-W2: the legacy panel card with a verdict says Drafted, not Ready", () => {
    const env = boot();
    const host = env.doc.createElement("div");
    env.doc.body.appendChild(host);
    env.win.JobBoredRoleMaterials.renderManifest(host, manifest(), "http://127.0.0.1:3847");
    const card = host.querySelector('[data-doc-type="cover_letter"]');
    assert.ok(card.querySelector("[data-score-open]"), "the card carries the verdict button");
    assert.equal(text(card.querySelector(".brief-materials__card-status")), "Drafted");
  });

  /* FIX4-R4-3 (Fable R4): role.css painted every card status green except
     needs_review and pending, so the word was right but the tone was not. */
  it("GRADE-F FIX4-R4-3: the legacy card's Drafted status is painted neutral, not green", () => {
    const env = boot();
    const host = env.doc.createElement("div");
    env.doc.body.appendChild(host);
    env.win.JobBoredRoleMaterials.renderManifest(host, manifest(), "http://127.0.0.1:3847");
    const status = host.querySelector('[data-doc-type="cover_letter"] .brief-materials__card-status');
    assert.equal(status.getAttribute("data-status"), "drafted");
    const css = read("role.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.brief-materials__card-status\[data-status="drafted"\]\s*\{([^}]*)\}/.exec(css);
    assert.ok(rule, "role.css has a rule for the drafted status");
    assert.match(rule[1], /color:\s*var\(--jb-ink-2\)/, "neutral ink");
    assert.match(rule[1], /background:\s*var\(--jb-paper-2\)/, "neutral fill");
    assert.match(rule[1], /border-color:\s*var\(--jb-line\)/, "neutral edge");
    assert.doesNotMatch(rule[1], /mint|rgba?\(|#[0-9a-f]{3,8}\b/i, "no green, no colour literal");
  });
});
