/**
 * The manual-apply checklist (server/materials-checklist.mjs): generated
 * deterministically from the application package, stored as checklist.json,
 * ticks kept across regeneration.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChecklistItems, loadChecklist, setChecklistItem } from "../server/materials-checklist.mjs";

const FACTS = {
  company: "NorthwindMedia",
  title: "Director, Digital Sales",
  jobUrl: "https://jobs.example.com/northwind/director",
  docs: { resume: true, coverLetter: true },
  verdicts: { resume: { disposition: "READY" }, letter: { disposition: "REVIEW" } },
  outreachText: "",
  bars: [],
  contact: "",
  details: { email: true, phone: true, links: ["linkedin.com/in/jordan"] },
  salaryLine: "",
};

const ids = (items) => items.map((i) => i.id);

describe("buildChecklistItems · from package states", () => {
  it("should list the steps of a ready package in order, none done", () => {
    const items = buildChecklistItems(FACTS);
    assert.deepEqual(ids(items), ["resume", "letter", "links", "salary", "submit", "confirmation", "outreach", "follow-up", "status"]);
    assert.ok(items.every((i) => i.done === false && i.doneAt === null));
    const resume = items[0];
    assert.equal(resume.label, "Download your tailored resume (PDF)");
    assert.equal(resume.detail, "Passed its quality check.");
    assert.deepEqual(resume.action, { kind: "download", doc: "resume", filename: "resume.pdf", gate: false, label: "Download" });
    assert.equal(items.find((i) => i.id === "submit").action.href, FACTS.jobUrl);
    assert.match(items.find((i) => i.id === "submit").label, /NorthwindMedia's site/);
  });

  it("should warn and gate the download when the resume failed QA", () => {
    const items = buildChecklistItems({ ...FACTS, verdicts: { resume: { disposition: "FAIL" } } });
    const resume = items.find((i) => i.id === "resume");
    assert.equal(resume.tone, "warn");
    assert.equal(resume.action.gate, true);
    assert.equal(resume.detail, "It failed its quality check. Repair it or read it closely first.");
  });

  it("should offer Draft when nothing is drafted yet", () => {
    const items = buildChecklistItems({ ...FACTS, docs: { resume: false, coverLetter: false }, verdicts: {} });
    assert.equal(items[0].label, "Draft your tailored resume");
    assert.equal(items[0].action.kind, "draft");
    assert.equal(items[1].action.doc, "cover_letter");
  });

  it("should ask for missing details, name the contact, copy the outreach note and list must-haves", () => {
    const items = buildChecklistItems({
      ...FACTS,
      details: { email: false, phone: true, links: [] },
      contact: "Dana Reyes",
      outreachText: "Hi Dana — I just applied for the Director, Digital Sales role.",
      bars: ["Must be based in the East Region", "5+ years managing AEs"],
      salaryLine: "Your voice guide: \"Hold comp for the recruiter call.\"",
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    assert.match(byId.details.detail, /no email/);
    assert.equal(byId.details.action.kind, "profile");
    assert.equal(byId.outreach.label, "Send a short note to Dana Reyes");
    assert.equal(byId.outreach.action.kind, "copy");
    assert.match(byId.outreach.action.text, /Hi Dana/);
    assert.match(byId["must-haves"].detail, /East Region · 5\+ years managing AEs/);
    assert.match(byId.salary.detail, /Hold comp for the recruiter call/);
    assert.match(byId.links.detail, /LinkedIn/);
  });

  it("should date the follow-up once the application is submitted", () => {
    const items = buildChecklistItems(FACTS, { submit: { done: true, doneAt: "2026-09-27T15:00:00.000Z" } });
    assert.equal(items.find((i) => i.id === "submit").done, true);
    assert.match(items.find((i) => i.id === "follow-up").detail, /Follow up on Oct 4/);
  });

  it("should leave the submit action off when no posting link is saved", () => {
    const submit = buildChecklistItems({ ...FACTS, jobUrl: "" }).find((i) => i.id === "submit");
    assert.equal(submit.action, undefined);
  });
});

describe("loadChecklist / setChecklistItem · stored in the application folder", () => {
  let root;
  let prior;
  const SLUG = "northwindmedia-director-digital-sales";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jb-checklist-"));
    prior = { home: process.env.HOME, profile: process.env.JOBBORED_PROFILE_PATH, jb: process.env.JOBBORED_HOME };
    process.env.HOME = root;
    process.env.JOBBORED_HOME = join(root, ".jobbored");
    process.env.JOBBORED_PROFILE_PATH = join(root, ".jobbored", "profile.json");
    const dir = join(root, "apps", SLUG);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ company: "NorthwindMedia", title: "Director", job_url: "https://jobs.example.com/x" }));
    await writeFile(join(dir, "resume.pdf"), "%PDF-1.4");
    await writeFile(join(dir, "qa.resume.json"), JSON.stringify({ contract: "materials.qa.v1", disposition: "FAIL", rubric: { score: 6, max: 12 } }));
  });
  afterEach(async () => {
    process.env.HOME = prior.home;
    for (const [key, value] of [["JOBBORED_PROFILE_PATH", prior.profile], ["JOBBORED_HOME", prior.jb]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("should build from disk, store checklist.json and keep ticks across a regenerate", async () => {
    const opts = { root: join(root, "apps"), now: () => new Date("2026-09-27T12:00:00.000Z") };
    const first = await loadChecklist(SLUG, opts);
    assert.equal(first.contract, "materials.checklist.v1");
    assert.equal(first.progress.done, 0);
    assert.equal(first.items[0].action.gate, true, "the FAIL verdict gates the resume download");
    const stored = JSON.parse(await readFile(join(root, "apps", SLUG, "checklist.json"), "utf8"));
    assert.deepEqual(stored.items.map((i) => i.id), first.items.map((i) => i.id));

    const ticked = await setChecklistItem(SLUG, "links", true, opts);
    assert.equal(ticked.progress.done, 1);
    assert.equal(ticked.items.find((i) => i.id === "links").doneAt, "2026-09-27T12:00:00.000Z");

    /* A new draft lands: the resume now passes. The tick survives. */
    await writeFile(join(root, "apps", SLUG, "qa.resume.json"), JSON.stringify({ contract: "materials.qa.v1", disposition: "READY", rubric: { score: 11, max: 12 } }));
    const again = await loadChecklist(SLUG, opts);
    assert.equal(again.items.find((i) => i.id === "links").done, true);
    assert.equal(again.items[0].action.gate, false);

    await writeFile(join(root, "apps", SLUG, "qa.resume.json"), JSON.stringify({ contract: "materials.qa.v2", disposition: "READY", quality: { score: 87 } }));
    const v2 = await loadChecklist(SLUG, opts);
    assert.doesNotMatch(v2.items[0].detail, /87 \/ 100/);

    const unticked = await setChecklistItem(SLUG, "links", false, opts);
    assert.equal(unticked.items.find((i) => i.id === "links").doneAt, null);
  });

  it("should refuse an unknown item or a non-boolean done", async () => {
    const opts = { root: join(root, "apps") };
    await assert.rejects(setChecklistItem(SLUG, "../../etc", true, opts), (e) => e.statusCode === 400);
    await assert.rejects(setChecklistItem(SLUG, "no-such-item", true, opts), (e) => e.code === "unknown_item");
    await assert.rejects(setChecklistItem(SLUG, "links", "yes", opts), (e) => e.code === "invalid_done");
  });
});
