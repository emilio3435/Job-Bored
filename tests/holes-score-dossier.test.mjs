/* holes-score-dossier.test.mjs — HOLES lane SCORE in the dossier's
   Materials rows (role-materials.js), spec §0.3 and §2 SCORE.

   The resume and cover-letter rows show one grade button where the inline
   scorecard was; the score modal holds the rest and hands Fix this, Apply
   and Repair back to the row's Repair form. Plus the row-level U items:
     U9   the drafting card never puts its ticking clock in a live region
     U12  a grade the draft moved on from is marked stale until it is fresh
     U14  Change template ignores a second click while the first is running
     U15  Edit says so when the editor didn't load
     U16  every QA flag is listed (in the modal), never one plus "+N more"
     U17  a document without a PDF still downloads

   Harness: the parsing DOM (tests/fixtures/holes-score-dom.mjs) with the
   shipped jb-a11y.js, materials-insights.js, materials-score.js and
   role-materials.js; fetch, the ATS scorer and the toast are stubs. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { V2_LETTER_FAIL, V2_RESUME_READY_SAME_MODEL } from "./fixtures/materials-qa-v2.mjs";
import { click, load, makeScoreEnv, text } from "./fixtures/holes-score-dom.mjs";

const BASE = "http://127.0.0.1:3847";
const SLUG = "meridian-labs-senior-pm";
const FILE = (name, t = "2026-09-28T09:00:00.000Z") => ({ filename: name, format: name.split(".").pop(), size: 1000, modifiedAt: t });

/* The letter's deterministic audit flags sit beside the judge's own issues
   (server: materials-quality.mjs keeps them apart). */
const LETTER_FLAGS = [
  { code: "letter_underfill", message: "The letter runs 180 words; 250 reads as finished.", severity: "review" },
  { code: "company_specificity", message: "The letter never names something specific to Meridian.", severity: "review" },
  { code: "metric_in_letter", message: "No traced metric in the letter.", severity: "review" },
];

function manifest(over = {}) {
  return {
    slug: SLUG,
    company: "Meridian Labs",
    title: "Senior PM",
    runId: "mr_r3",
    template: { family: "signal", source: "draft" },
    documents: [
      { type: "resume", label: "Tailored Resume", status: "ready", primary: "resume.pdf", lastModifiedAt: "2026-09-28T09:00:00.000Z",
        files: [FILE("resume.pdf"), FILE("resume.html")], text: FILE("resume.txt"), exports: { docx: true, linkedin: true } },
      { type: "cover_letter", label: "Cover Letter", status: "ready", primary: "cover-letter.pdf", lastModifiedAt: "2026-09-28T09:00:00.000Z",
        files: [FILE("cover-letter.pdf"), FILE("cover-letter.html")], text: FILE("cover-letter.txt"), exports: { docx: true } },
    ],
    quality: { documents: { resume: V2_RESUME_READY_SAME_MODEL, cover_letter: { ...V2_LETTER_FAIL, issues: LETTER_FLAGS } } },
    ...over,
  };
}

const ATS_LETTER = {
  result: {
    schemaVersion: 1, overallScore: 71,
    dimensionScores: { requirementsCoverage: 70, experienceRelevance: 75, impactClarity: 60, atsParseability: 90, toneFit: 70 },
    topStrengths: [], criticalGaps: [], evidence: [],
    rewriteSuggestions: [{ targetSection: "Closing", before: "Worth a quick call this week?", after: "I'd like to hear how Meridian plans its next pricing tier.", rationale: "Ends on them." }],
    confidence: 0.7, model: "ats-model-1",
  },
  feature: "cover_letter",
  storedAt: "2026-09-28T10:00:00.000Z",
};

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const settle = async (n = 60) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function boot(opts = {}) {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  const doc = win.document;
  const region = doc.createElement("section");
  region.setAttribute("data-region", "role");
  const mount = doc.createElement("div");
  mount.setAttribute("data-mount", opts.mount || "materials");
  region.appendChild(mount);
  doc.body.appendChild(region);

  const state = { manifest: opts.manifest || manifest(), ats: opts.ats === undefined ? null : opts.ats, texts: { "cover-letter.txt": "Dear Meridian Labs team,\nSix years turning pricing data into roadmaps.", "resume.txt": "Jordan Rivera. Product manager." } };
  const calls = [];
  const toasts = [];
  const analyses = [];
  const rawJob = { title: "Senior PM", company: "Meridian Labs", link: "https://jobs.meridian.test/pm" };

  win.location = { hostname: "localhost", hash: "", search: "" };
  win.getJobPostingScrapeUrl = () => BASE;
  win.queueMicrotask = (fn) => fn();
  win.setInterval = () => 1;
  win.clearInterval = () => {};
  win.encodeURIComponent = encodeURIComponent;
  win.showToast = (message, tone) => toasts.push([message, tone]);
  win.JobBoredDawn = { data: { getRoleViewModel: () => ({ job: { company: "Meridian Labs", role: "Senior PM", link: rawJob.link } }) } };
  win.JobBored = { getSheetId: () => "sheet-1", getPipelineJobs: () => [] };
  win.JobBoredFlowing = { openRole: { get: () => null } };
  win.JobBoredApp = {
    core: { getJobByStableKey: () => rawJob },
    materialsState: {
      getScorecardForJob: () => state.ats,
      getAtsScorecardState: () => ({ status: "idle", cacheKey: "" }),
    },
    ats: {
      computeAtsScorecardCacheKey: (t, job, feature) => `${feature}|job-1|${t.length}`,
      buildAtsScorecardRequestPayload: (t, job, session) => ({ docText: t, feature: session && session.feature, job: { title: job.title, company: job.company } }),
      startAtsScorecardAnalysis: (cacheKey, payload, job) => analyses.push({ cacheKey, payload, job }),
    },
  };
  win.fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    calls.push([method, String(url)]);
    if (/\/api\/applications$/.test(url)) return json({ applications: [{ slug: SLUG }] });
    if (/\/manifest$/.test(url)) return json(state.manifest);
    if (/\/regenerate$/.test(url)) return new Promise(() => {});
    const file = /\/files\/([^?]+)/.exec(url);
    if (file && state.texts[decodeURIComponent(file[1])] != null) {
      const body = state.texts[decodeURIComponent(file[1])];
      return { ok: true, status: 200, text: async () => body, json: async () => ({}) };
    }
    return json({ ok: true });
  };

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
  return { win, doc, mount, state, calls, toasts, analyses, said, rawJob, openRole, rowOf, modal };
}

describe("Dossier rows · the grade button is the only score (§0.3)", () => {
  it("should show one grade button where the scorecard was, and nothing else of the score", async () => {
    const env = await (async () => { const e = boot(); await e.openRole(); return e; })();
    const letter = env.rowOf("cover_letter");
    const resume = env.rowOf("resume");
    const lbtn = letter.querySelector("[data-score-open]");
    const rbtn = resume.querySelector("[data-score-open]");
    assert.ok(lbtn && rbtn, "each row has a grade button");
    assert.equal(lbtn.getAttribute("aria-label"), "Grade D, 64 of 100 — open score details");
    assert.equal(rbtn.getAttribute("aria-label"), "Grade B, 86 of 100 — open score details");
    for (const row of [letter, resume]) {
      for (const sel of [".mat-score", ".mat-rubric", ".mat-dims", ".mat-issues", ".mat-gaps", ".mat-verdict", ".mat-kw", ".mat-pill"]) {
        assert.ok(row.querySelector(sel) === null, `no ${sel} inline`);
      }
      assert.doesNotMatch(text(row), /\/ 100|\d+ \/ \d+|\+\d+ more|Factual blockers|Writing quality/);
    }
    assert.equal(text(letter.querySelector(".case__docst")), "fail", "the pill keeps the verdict word, not the score");
    assert.equal(text(resume.querySelector(".case__docst")), "ready");
  });

  it("should put the legacy panel's quality line behind the same button", () => {
    const env = boot({ mount: "brief" });
    const host = env.mount;
    env.win.JobBoredRoleMaterials.renderManifest(host, manifest(), BASE);
    const card = host.querySelector('[data-doc-type="cover_letter"]');
    assert.ok(card.querySelector("[data-score-open]"), "the card carries the grade button");
    assert.ok(card.querySelector(".brief-materials__quality") === null, "no critique line on the card");
  });

  it("should open the score modal for that document", async () => {
    const env = boot();
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const m = env.modal();
    assert.ok(m, "the modal opened");
    assert.match(text(m.querySelector(".jb-score__title")), /Cover letter grade 64 \/ 100/);
    assert.equal(m.getAttribute("role"), "dialog");
  });

  it("should list every QA flag in the modal, never the first one and a count (U16)", async () => {
    const env = boot();
    await env.openRole();
    assert.doesNotMatch(text(env.rowOf("cover_letter")), /more/);
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const blockers = text(env.modal().querySelector('[data-step="blockers"]'));
    for (const f of LETTER_FLAGS) assert.ok(blockers.includes(f.message), `"${f.message}" is listed`);
  });
});

describe("Dossier · the modal's actions land on the row (U6)", () => {
  it("should pre-fill Repair under the row from a blocker's Fix this", async () => {
    const env = boot();
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const fix = env.modal().querySelector('[data-score-fix="0"]');
    fix.dispatchEvent(click(fix));
    assert.ok(env.modal() === null, "the modal closed");
    const form = env.rowOf("cover_letter").querySelector(".mat-repair");
    assert.ok(form, "the Repair form opened under the row");
    const box = form.querySelector("[data-repair-instruction]");
    assert.match(text(box), /40% churn cut/);
    assert.ok(env.doc.activeElement === box, "focus is in the instruction");
    const ticked = form.querySelectorAll("[data-repair-issue]").filter((b) => b.hasAttribute("checked")).map((b) => b.getAttribute("value"));
    assert.deepEqual(ticked, ["i1"], "only the blocker it came from is ticked");
  });

  it("should put a rewrite suggestion into Repair from Apply", async () => {
    const env = boot({ ats: ATS_LETTER });
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const apply = env.modal().querySelector('[data-score-apply="0"]');
    assert.ok(apply, "the role-match rewrite suggestion has an Apply");
    apply.dispatchEvent(click(apply));
    const box = env.rowOf("cover_letter").querySelector(".mat-repair [data-repair-instruction]");
    assert.match(text(box), /In Closing, replace “Worth a quick call this week\?” with “I'd like to hear how Meridian plans its next pricing tier\.”/);
  });

  it("should open the Repair form from the footer's Repair", async () => {
    const env = boot();
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const repair = env.modal().querySelector("[data-score-repair]");
    repair.dispatchEvent(click(repair));
    assert.ok(env.rowOf("cover_letter").querySelector(".mat-repair"), "Repair opened");
  });

  it("should give focus back to the row's grade button when Repair is cancelled", async () => {
    const env = boot();
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const repair = env.modal().querySelector("[data-score-repair]");
    repair.dispatchEvent(click(repair));
    const cancel = env.rowOf("cover_letter").querySelector('.mat-repair [data-action="materials-repair-cancel"]');
    cancel.dispatchEvent(click(cancel));
    assert.equal(env.rowOf("cover_letter").querySelector(".mat-repair"), null, "Repair closed");
    assert.equal(env.doc.activeElement, env.rowOf("cover_letter").querySelector("[data-score-open]"), "focus is back on the grade button");
  });

  it("should score the package's own text for this role on Rescore, once", async () => {
    const env = boot();
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const rescore = () => env.modal().querySelector("[data-score-rescore]");
    rescore().dispatchEvent(click(rescore()));
    await settle(10);
    rescore().dispatchEvent(click(rescore()));
    await settle(10);
    assert.ok(env.calls.some(([m, u]) => m === "GET" && /\/files\/cover-letter\.txt/.test(u)), "it read the letter's text from the package");
    assert.equal(env.analyses.length, 1, "one analysis, however many clicks");
    const a = env.analyses[0];
    assert.equal(a.payload.feature, "cover_letter");
    assert.equal(a.job, env.rawJob, "the score is stored for this role, not the last generated one");
    env.state.ats = ATS_LETTER;
    env.win.dispatchEvent(new env.win.CustomEvent("jb:ats:state", { detail: { jobKey: a.cacheKey, status: "success" } }));
    await settle(10);
    assert.equal(rescore().getAttribute("aria-busy"), "false");
    assert.ok(env.modal().querySelector('[data-score-apply="0"]'), "the new suggestions are in the modal");
    assert.ok(env.said.includes("Rescored: grade D, 64 of 100."), "the score that landed was announced");
  });
});

describe("U3 · the ATS modal's entry points open the score modal", () => {
  it("should open an ATS-only modal for \"\": the role-match score, whichever document it rated", async () => {
    const env = boot({ ats: ATS_LETTER });
    await env.openRole();
    const handle = env.win.JobBoredRoleMaterials.openScore("", null);
    assert.ok(handle, "it opened");
    const m = env.modal();
    assert.match(text(m.querySelector(".jb-score__head")), /71 \/ 100/);
    assert.match(text(m.querySelector('[data-step="rewrites"]')), /pricing tier/);
    assert.equal(m.querySelector("[data-score-rescore]"), null, "nothing to rescore without a document");
  });
});

describe("U12 · a grade the draft moved on from is stale until it is fresh", () => {
  it("should mark the row stale on a Scribe save, refetch, and clear it when the fresh manifest lands", async () => {
    const env = boot();
    await env.openRole();
    const before = env.calls.filter(([, u]) => /\/manifest$/.test(u)).length;
    env.state.manifest = manifest({ runId: "mr_r4" });
    env.win.dispatchEvent(new env.win.CustomEvent("jb:scribe:saved", { detail: { slug: SLUG, doc: "cover_letter", runId: "mr_r4" } }));
    const stale = env.rowOf("cover_letter").querySelector("[data-score-open]");
    assert.equal(stale.getAttribute("data-stale"), "true", "stale the moment the save lands");
    assert.match(stale.getAttribute("aria-label"), /out of date/);
    await settle();
    assert.ok(env.calls.filter(([, u]) => /\/manifest$/.test(u)).length > before, "the manifest was fetched again");
    const fresh = env.rowOf("cover_letter").querySelector("[data-score-open]");
    assert.equal(fresh.getAttribute("data-stale"), null, "fresh once the manifest caught up");
  });

  it("should mark a role-match grade stale when the text changed after it was scored", async () => {
    const m = manifest();
    m.quality.documents.cover_letter = { status: "pass", issues: [] };
    m.documents[1].text = FILE("cover-letter.txt", "2026-09-28T11:00:00.000Z");
    const env = boot({ manifest: m, ats: ATS_LETTER });
    await env.openRole();
    const btn = env.rowOf("cover_letter").querySelector("[data-score-open]");
    assert.equal(btn.getAttribute("data-grade"), "C-", "the role-match score grades it");
    assert.equal(btn.getAttribute("data-stale"), "true", "scored 10:00, text changed 11:00");
  });
});

describe("U9 · the drafting card keeps its clock out of the live region", () => {
  const drafting = (startedAt) => manifest({
    documents: [], quality: undefined,
    pending: { feature: "resume", company: "Meridian Labs", title: "Senior PM", requestedAt: startedAt,
      progress: { phase: "drafting", message: "Picking the facts that fit this job…", startedAt, attempt: 1, stages: [{ stage: "prepare", status: "ok" }] } },
  });

  it("should put no live region around the elapsed time, in the rows or the panel", () => {
    for (const mountName of ["materials", "brief"]) {
      const env = boot({ mount: mountName });
      env.win.JobBoredRoleMaterials.renderManifest(env.mount, drafting("2026-09-28T09:00:00.000Z"), BASE);
      const clocks = env.mount.querySelectorAll(".case__doc-eyebrow, .brief-materials__progress-elapsed");
      assert.ok(clocks.length, `${mountName}: the clock renders`);
      for (const clock of clocks) {
        assert.ok(clock.closest("[aria-live]") === null, `${mountName}: the ticking clock is not announced`);
        assert.ok(clock.closest('[role="status"]') === null);
      }
    }
  });

  it("should announce a phase once, not on every poll", async () => {
    const env = boot({ manifest: drafting("2026-09-28T09:00:00.000Z") });
    await env.openRole();
    env.win.JobBoredRoleMaterials.renderManifest(env.mount, drafting("2026-09-28T09:00:00.000Z"), BASE);
    env.win.JobBoredRoleMaterials.renderManifest(env.mount, drafting("2026-09-28T09:00:00.000Z"), BASE);
    const phase = env.said.filter((s) => /drafting in progress/i.test(s));
    assert.equal(phase.length, 1, "one announcement for the phase");
    assert.doesNotMatch(phase[0], /\d+m|\d+s\b/, "and no clock in it");
  });
});

describe("U14 · Change template is one request, however many clicks", () => {
  it("should ignore a second click while the first is running", async () => {
    const env = boot();
    await env.openRole();
    const link = () => env.doc.querySelector('[data-action="materials-regenerate"]');
    assert.ok(link(), "a template link renders");
    link().dispatchEvent(click(link()));
    link().dispatchEvent(click(link()));
    await settle(10);
    assert.equal(env.calls.filter(([m, u]) => m === "POST" && /\/regenerate$/.test(u)).length, 1);
    assert.equal(link().getAttribute("aria-disabled"), "true", "the links say they are busy");
  });
});

describe("U15 · Edit says so when the editor didn't load", () => {
  it("should tell the user instead of doing nothing", async () => {
    const env = boot();
    await env.openRole();
    const edit = env.rowOf("resume").querySelector('[data-action="materials-edit"]');
    assert.ok(edit, "Edit renders for a drafted resume");
    edit.dispatchEvent(click(edit));
    assert.equal(env.toasts.length, 1, "one message");
    assert.match(env.toasts[0][0], /editor/i);
    assert.equal(env.toasts[0][1], "error");
  });
});

describe("U17 · a document without a PDF still downloads", () => {
  const noPdf = () => manifest({
    documents: [{ type: "resume", label: "Tailored Resume", status: "ready", primary: "resume.html", lastModifiedAt: "2026-09-28T09:00:00.000Z", files: [FILE("resume.html")] }],
    quality: undefined,
  });

  it("should offer the HTML in the rows' Download menu", () => {
    const env = boot();
    env.win.JobBoredRoleMaterials.renderManifest(env.mount, noPdf(), BASE);
    const item = env.rowOf("resume").querySelector('[data-action="materials-download"]');
    assert.ok(item, "a download is offered");
    assert.match(item.getAttribute("href"), /\/files\/resume\.html\?download=1/);
  });

  it("should offer the HTML on the legacy panel's card", () => {
    const env = boot({ mount: "brief" });
    env.win.JobBoredRoleMaterials.renderManifest(env.mount, noPdf(), BASE);
    const item = env.mount.querySelector('[data-doc-type="resume"] [data-action="materials-download"]');
    assert.ok(item, "a download is offered");
    assert.match(item.getAttribute("href"), /\/files\/resume\.html\?download=1/);
    assert.match(text(item), /Download/);
  });
});
