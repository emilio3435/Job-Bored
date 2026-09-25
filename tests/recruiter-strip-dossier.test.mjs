/**
 * UX-01 dossier half, retired. The recruiter strip's dossier panel duplicated
 * the Case's own People rows over a second write path, so the panel is gone
 * and this probe now pins what is left of the module:
 *
 *   1. `nextAction` is exported — it is the ONE place the next move is
 *      decided, read by both the kanban compact strip and the Case's People
 *      block (role-case-model.js). Un-exporting it, or changing a branch,
 *      silently splits the two surfaces apart.
 *   2. `renderCompact` is byte-identical to what pipeline.js shipped before
 *      the retirement — the snapshot below was captured from the pre-change
 *      module, so any drift in the card markup fails here.
 *   3. The dossier renderer and its controls are actually gone, not merely
 *      unreferenced.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "recruiter-strip.js");
const source = readFileSync(sourcePath, "utf8");

function load() {
  const windowTarget = {};
  vm.runInNewContext(source, { Object, String, window: windowTarget }, { filename: "recruiter-strip.js" });
  assert.ok(windowTarget.JobBoredRecruiterStrip, "recruiter-strip.js must install its API");
  return windowTarget.JobBoredRecruiterStrip;
}

describe("recruiter-strip after the dossier panel is retired", () => {
  it("exports nextAction, and it still returns the four sentences", () => {
    const { nextAction } = load();
    assert.equal(typeof nextAction, "function", "the Case's People block reads this");
    assert.equal(nextAction({ contact: "Unknown", reply: "Yes", followUp: "2026-09-04" }), "Find a recruiter contact");
    assert.equal(nextAction({ contact: "Dana", reply: "No", followUp: "2026-09-04" }), "Follow up on 2026-09-04");
    assert.equal(nextAction({ contact: "Dana", reply: "Yes", followUp: "Unknown" }), "Schedule the next conversation");
    assert.equal(nextAction({ contact: "Dana", reply: "No", followUp: "Unknown" }), "Set a follow-up date");
  });

  /* Snapshot captured from recruiter-strip.js BEFORE the retirement (see
     LANE-REPORT-A.md §3). pipeline.js paints this on every kanban card, so
     the retirement must not have moved a single byte of it. */
  const CARD_CASES = [
    {
      job: { jobKey: "11", contact: "", lastHeardFrom: null, replied: "", followUpDate: undefined },
      html: '<div class="jb-recruiter-strip jb-recruiter-strip--compact jb-sticker pipe-sticker__recruiter-strip" data-job-key="11"><span class="jb-recruiter-strip__heading"><jb-stage-dot stage="applied" aria-hidden="true"></jb-stage-dot><span>Recruiter CRM</span></span><span class="jb-recruiter-strip__compact-facts"><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-contact"><span class="jb-recruiter-strip__label">Contact</span><span class="jb-recruiter-strip__value">Unknown</span></span><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-last-contact"><span class="jb-recruiter-strip__label">Last</span><span class="jb-recruiter-strip__value">Unknown</span></span><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-reply"><span class="jb-recruiter-strip__label">Reply</span><span class="jb-recruiter-strip__value">Unknown</span></span><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-follow-up"><span class="jb-recruiter-strip__label">Follow-up</span><span class="jb-recruiter-strip__value">Unknown</span></span></span><span class="jb-recruiter-strip__next"><span class="jb-recruiter-strip__label">Next action</span><span class="jb-recruiter-strip__value">Find a recruiter contact</span></span></div>',
    },
    {
      job: { jobKey: "7", contact: "<Ana & Co>", lastHeardFrom: "2026-08-29", replied: "No", followUpDate: "2026-09-04" },
      html: '<div class="jb-recruiter-strip jb-recruiter-strip--compact jb-sticker pipe-sticker__recruiter-strip" data-job-key="7"><span class="jb-recruiter-strip__heading"><jb-stage-dot stage="applied" aria-hidden="true"></jb-stage-dot><span>Recruiter CRM</span></span><span class="jb-recruiter-strip__compact-facts"><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-contact"><span class="jb-recruiter-strip__label">Contact</span><span class="jb-recruiter-strip__value">&lt;Ana &amp; Co&gt;</span></span><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-last-contact"><span class="jb-recruiter-strip__label">Last</span><span class="jb-recruiter-strip__value">2026-08-29</span></span><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-reply"><span class="jb-recruiter-strip__label">Reply</span><span class="jb-recruiter-strip__value">No</span></span><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-follow-up"><span class="jb-recruiter-strip__label">Follow-up</span><span class="jb-recruiter-strip__value">2026-09-04</span></span></span><span class="jb-recruiter-strip__next"><span class="jb-recruiter-strip__label">Next action</span><span class="jb-recruiter-strip__value">Follow up on 2026-09-04</span></span></div>',
    },
    {
      job: { jobKey: "9", contact: "Dana", lastHeardFrom: "2026-08-30", replied: "Yes", followUpDate: "" },
      html: '<div class="jb-recruiter-strip jb-recruiter-strip--compact jb-sticker pipe-sticker__recruiter-strip" data-job-key="9"><span class="jb-recruiter-strip__heading"><jb-stage-dot stage="applied" aria-hidden="true"></jb-stage-dot><span>Recruiter CRM</span></span><span class="jb-recruiter-strip__compact-facts"><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-contact"><span class="jb-recruiter-strip__label">Contact</span><span class="jb-recruiter-strip__value">Dana</span></span><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-last-contact"><span class="jb-recruiter-strip__label">Last</span><span class="jb-recruiter-strip__value">2026-08-30</span></span><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-reply"><span class="jb-recruiter-strip__label">Reply</span><span class="jb-recruiter-strip__value">Yes</span></span><span class="jb-recruiter-strip__fact pipe-sticker__recruiter-follow-up"><span class="jb-recruiter-strip__label">Follow-up</span><span class="jb-recruiter-strip__value">Unknown</span></span></span><span class="jb-recruiter-strip__next"><span class="jb-recruiter-strip__label">Next action</span><span class="jb-recruiter-strip__value">Schedule the next conversation</span></span></div>',
    },
  ];

  it("leaves renderCompact byte-identical — pipeline.js still paints it", () => {
    const api = load();
    for (const { job, html } of CARD_CASES) {
      const mount = { innerHTML: "", addEventListener() {}, querySelector() { return null; } };
      api.renderCompact(mount, job);
      assert.equal(mount.innerHTML, html, "card markup drifted for jobKey " + job.jobKey);
    }
  });

  it("has no dossier renderer, boxed card or second write path left", () => {
    const api = load();
    assert.equal(api.render, undefined, "the dossier renderer is retired");
    assert.doesNotMatch(source, /brief__recruiter-strip/, "the dossier card class is gone");
    assert.doesNotMatch(source, /Save follow-up/, "the panel's save button is gone");
    assert.doesNotMatch(source, /data-action="recruiter-/, "its data-action values are gone");
    assert.doesNotMatch(source, /updateJobResponseFlag|updateFollowUpDate/, "the second sheetsWrite path is gone");
    assert.match(source, /function renderCompact/, "precondition: the card renderer survives");
  });

  it("the dossier panel's styles went with it, and the compact ones stayed", () => {
    const css = readFileSync(join(repoRoot, "recruiter-strip.css"), "utf8");
    assert.doesNotMatch(css, /\.brief__recruiter-strip/);
    assert.doesNotMatch(css, /__reply|__save|__date|__controls|__head\b|__follow-up|__facts\b/);
    assert.match(css, /\.pipe-sticker__recruiter-strip/, "the card placement rule stays");
    assert.match(css, /\.jb-recruiter-strip--compact/, "every --compact rule stays");
    assert.match(css, /\.jb-recruiter-strip__compact-facts/);
  });
});
