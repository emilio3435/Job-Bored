/**
 * The apply checklist as a horizontal progress strip (MREV lane CHECKLIST).
 *
 * apply-checklist.js is a browser script; this loads it in a vm with a stub
 * root (repo convention: no jsdom) and checks the pure strip model and the
 * markup it paints. Behaviour in a real browser (ticks, chevrons, keys,
 * copy, 375px) lives in tests/e2e-visual/apply-checklist-strip.spec.mjs.
 *
 *   K2  the strip: current + one peek, chevrons, the trailing summary with
 *       singular and plural, the slim track, completed collapsed
 *   K4  the progress is a progressbar with values; the summary is live
 *   K5  empty, all done, and error states
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "apply-checklist.js"), "utf8");

function loadChecklist() {
  const defined = new Map();
  const root = {
    HTMLElement: class {},
    CustomEvent: class {},
    customElements: {
      get: (tag) => defined.get(tag),
      define: (tag, ctor) => defined.set(tag, ctor),
    },
  };
  vm.runInNewContext(source, { window: root });
  return root.JobBoredApplyChecklist;
}

const CL = loadChecklist();

function items(n, doneIds = []) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    label: `Step ${i + 1}`,
    detail: `Detail ${i + 1}`,
    done: doneIds.includes(`s${i + 1}`),
    doneAt: doneIds.includes(`s${i + 1}`) ? "2026-09-27T12:00:00.000Z" : null,
  }));
}

const OPTS = { base: "http://127.0.0.1:3847", slug: "acme-pm", headingId: "jb-cl-1" };

function count(html, re) {
  return (html.match(re) || []).length;
}

describe("K2 · the strip model", () => {
  it("should focus the first undone step and peek at the one after it", () => {
    const m = CL.stripModel({ items: items(5, ["s1", "s2"]) });
    assert.equal(m.current.id, "s3");
    assert.equal(m.peek.id, "s4");
    assert.equal(m.done, 2);
    assert.equal(m.total, 5);
    assert.deepEqual(Array.from(m.completed, (i) => i.id), ["s1", "s2"]);
  });

  it("should keep a peeked step in focus and never peek past the last one", () => {
    const m = CL.stripModel({ items: items(4) }, "s4");
    assert.equal(m.current.id, "s4");
    assert.equal(m.peek, null);
    assert.equal(m.hasPrev, true);
    assert.equal(m.hasNext, false);
  });

  it("should move focus to the next undone step when the focused one was ticked", () => {
    const m = CL.stripModel({ items: items(5, ["s2"]) }, "s2");
    assert.equal(m.current.id, "s3");
  });

  it("should fall back to the first undone step when the ticked one was last", () => {
    const m = CL.stripModel({ items: items(4, ["s4"]) }, "s4");
    assert.equal(m.current.id, "s1");
  });
});

describe("K2 · the trailing summary", () => {
  it("should read plural steps and completed", () => {
    assert.equal(CL.summaryText({ done: 2, total: 9 }), "7 steps remaining · 2 completed");
  });
  it("should read a singular step", () => {
    assert.equal(CL.summaryText({ done: 8, total: 9 }), "1 step remaining · 8 completed");
  });
  it("should read none completed at the start", () => {
    assert.equal(CL.summaryText({ done: 0, total: 3 }), "3 steps remaining · 0 completed");
  });
  it("should say all steps are done when nothing remains", () => {
    assert.equal(CL.summaryText({ done: 9, total: 9 }), "All 9 steps done");
    assert.equal(CL.summaryText({ done: 1, total: 1 }), "The 1 step is done");
  });
});

describe("K2 · K4 · the strip markup", () => {
  const html = CL.stripHtml({ items: items(9, ["s1", "s2"]) }, OPTS);

  it("should render one focused step and at most one peek, not the whole list", () => {
    assert.equal(count(html, /class="jb-cl__now[" ]/g), 1);
    assert.equal(count(html, /class="jb-cl__peek[" ]/g), 1);
    assert.match(html, /data-item="s3"/);
    assert.doesNotMatch(html, /data-item="s5"/);
    assert.doesNotMatch(html, /jb-cl__list/);
  });

  it("should draw one track tick per step, marked done, now or ahead", () => {
    assert.equal(count(html, /class="jb-cl__tick[" ]/g), 9);
    assert.equal(count(html, /jb-cl__tick--done/g), 2);
    assert.equal(count(html, /jb-cl__tick--now/g), 1);
  });

  it("should hide the ticks from assistive tech, so the progressbar's values speak alone", () => {
    assert.equal(count(html, /<i class="jb-cl__tick[^"]*" aria-hidden="true"><\/i>/g), 9);
  });

  it("should announce the progress as a progressbar with values", () => {
    assert.match(html, /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="9"[^>]*aria-valuenow="2"/);
    assert.match(html, /aria-valuetext="2 of 9 steps done"/);
    assert.match(html, /class="jb-cl__count" aria-live="polite">7 steps remaining · 2 completed</);
  });

  it("should offer back and forward chevrons with names", () => {
    assert.match(html, /<button[^>]*data-cl-nav="prev"[^>]*aria-label="Previous step"/);
    assert.match(html, /<button[^>]*data-cl-nav="next"[^>]*aria-label="Next step"/);
  });

  it("should collapse completed steps into a disclosure that can be reviewed", () => {
    assert.match(html, /<details class="jb-cl__done"/);
    assert.match(html, /<summary[^>]*>Review 2 completed steps<\/summary>/);
    assert.match(html, /data-item="s1"/);
    assert.match(html, /data-cl-id="s1" checked/);
  });

  it("should name one completed step in the singular", () => {
    const one = CL.stripHtml({ items: items(3, ["s1"]) }, OPTS);
    assert.match(one, /<summary[^>]*>Review 1 completed step<\/summary>/);
  });

  it("should keep a checkbox and label on the focused step, so Space ticks it", () => {
    assert.match(html, /<input class="jb-cl__input" type="checkbox" id="jb-cl-1-s3" data-cl-id="s3">/);
    assert.match(html, /<label class="jb-cl__label" for="jb-cl-1-s3">Step 3<\/label>/);
  });

  it("should carry the doc type on a download step so the FAIL gate finds its host", () => {
    const withDownload = CL.stripHtml({
      items: [{ id: "resume", label: "Download", detail: "", done: false, tone: "warn", action: { kind: "download", doc: "resume", filename: "resume.pdf", gate: true, label: "Download" } }],
    }, OPTS);
    assert.match(withDownload, /data-item="resume" data-doc-type="resume"/);
    assert.match(withDownload, /data-action="materials-download"[^>]*data-gate="fail"/);
    assert.match(withDownload, /jb-cl__now--warn/);
  });

  it("should escape step text", () => {
    const out = CL.stripHtml({ items: [{ id: "x", label: "<b>hi</b>", detail: "", done: false }] }, OPTS);
    assert.match(out, /&lt;b&gt;hi&lt;\/b&gt;/);
  });
});

describe("K5 · states", () => {
  it("should say what to do when there are no steps", () => {
    const html = CL.stripHtml({ items: [] }, OPTS);
    assert.match(html, /data-cl-state="empty"/);
    assert.match(html, /No steps yet/);
    assert.doesNotMatch(html, /role="progressbar"/);
  });

  it("should show a quiet success when every step is done, with the steps still reviewable", () => {
    const html = CL.stripHtml({ items: items(4, ["s1", "s2", "s3", "s4"]) }, OPTS);
    assert.match(html, /data-cl-state="done"/);
    assert.match(html, /All 4 steps done/);
    assert.doesNotMatch(html, /class="jb-cl__now[" ]/);
    assert.match(html, /aria-valuenow="4"/);
    assert.match(html, /<details class="jb-cl__done"/);
  });

  it("should explain an error and offer a retry", () => {
    const html = CL.errorHtml("The materials server answered 500");
    assert.match(html, /data-cl-state="error"/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Couldn’t load the checklist: The materials server answered 500/);
    assert.match(html, /<button[^>]*data-cl-retry[^>]*>Try again<\/button>/);
  });
});
