/* ============================================================
   mock-shell.js — page scaffolding for the mock pages.
   Fake app chrome, the page nav, the annotation toggle, and a
   "docket is stuck" class so the sticky shadow can be seen in a
   screenshot. Mock-only.
   ============================================================ */
(function (root) {
  "use strict";

  var PAGES = [
    ["index.html", "Index"],
    ["01-default.html", "01 · Default"],
    ["02-scrolled.html", "02 · Scrolled"],
    ["03-materials-request.html", "03 · Materials"],
    ["04-narrow.html", "04 · Narrow"],
    ["05-states.html", "05 · States"],
  ];

  function chrome() {
    return '<div class="mock-chrome">'
      + '<span class="mock-chrome__mark">Job <em>Bored</em></span>'
      + '<span class="mock-chrome__tabs">'
        + '<span class="mock-chrome__tab">01 Brief</span>'
        + '<span class="mock-chrome__tab">02 Pipeline</span>'
        + '<span class="mock-chrome__tab mock-chrome__tab--on">03 Dossier</span>'
      + "</span>"
      + '<span class="mock-chrome__spacer"></span>'
      + '<span class="mock-chrome__pill">Run discovery</span>'
    + "</div>";
  }

  function nav(current) {
    return '<ul class="mock-links">' + PAGES.map(function (p) {
      var on = p[0] === current;
      return "<li><a href=\"" + p[0] + "\"" + (on ? ' aria-current="page"' : "") + ">" + p[1] + "</a></li>";
    }).join("") + "</ul>";
  }

  /* Legend entries are shared by every page that annotates the full
     dossier, so the numbering stays stable across screenshots. */
  var LEGEND = [
    ["Masthead", "Identity only: who, what, where, and the posting's own facts as a wrapping definition list. The title is text that wraps — not an input that silently truncates at 81px."],
    ["Editable in place", "Title, company, location, salary, contact and dates keep the frozen data-action=\"edit-field\" contract. Display is text; clicking enters edit."],
    ["Flags", "A bounded column, so pills can never take width from the title. Deadline, posting health, and the link to the posting — which belongs with the posting facts, not with the controls that change this role."],
    ["Verdict line", "The lede the shipped dossier has no equivalent of. One derived sentence: standing, gap, next. No new data sources."],
    ["Stage stepper", "A scroller with an edge fade and scroll-snap, inside the sticky docket. Roving tabindex, aria-current on the live step."],
    ["Docket", "Sticky under the app chrome. Stage on the left, the actions that change this role on the right, and the in-flight drafting run between them — so the reader can act from anywhere in the page. Keeping the posting link out of it is what makes all six stage labels fit."],
    ["They want", "Prose lives in the canvas at a 34–46rem measure. Requirement rows have a 12rem floor on the text track, so the status word can never crush the line."],
    ["You have", "Strengths, evidence, gaps and the scorecard bars, in the same column as the requirements they answer — the comparison the three-column board split across a 44px gutter."],
    ["Materials", "First in the ledger, at the top right. Two rows of two areas: name and state, then meta, then actions. The buttons never share a line with the label, which is what shredded \"Cover letter\" into nine lines."],
    ["People", "Label above value at ledger width, so a 31-character contact name is not truncated to fit a nowrap label plus a 60%-wide input."],
    ["The record", "A vertical timeline: one row per event. The shipped record divides a fixed width by however many events there are, so every new event narrows all of them."],
  ];

  function legend() {
    return '<div class="mock-legend">'
      + "<h2>What changed, and why</h2>"
      + "<p>Numbered against the badges above. The full argument is in TEARDOWN.md; the rules are in SPEC.md.</p>"
      + "<ol>" + LEGEND.map(function (l) {
        return "<li><span><b>" + l[0] + "</b>" + l[1] + "</span></li>";
      }).join("") + "</ol></div>";
  }

  function boot(opts) {
    var o = opts || {};
    document.body.insertAdjacentHTML("afterbegin", chrome());

    var navMount = document.querySelector("[data-mock-nav]");
    if (navMount) navMount.innerHTML = nav(o.current || "");

    var legendMount = document.querySelector("[data-mock-legend]");
    if (legendMount && o.legend !== false) legendMount.innerHTML = legend();

    /* Annotation toggle. Deep-linkable with ?annotate=1 so a screenshot
       run can request the annotated view. */
    var toggle = document.querySelector("[data-mock-toggle]");
    var wanted = /[?&]annotate=1/.test(root.location.search);
    function paint(on) {
      document.body.classList.toggle("is-annotated", on);
      if (toggle) {
        toggle.setAttribute("aria-pressed", on ? "true" : "false");
        toggle.lastElementChild.textContent = on ? "Annotations on" : "Annotations off";
      }
    }
    paint(wanted);
    if (toggle) {
      toggle.addEventListener("click", function () {
        paint(document.body.getAttribute("class").indexOf("is-annotated") === -1);
      });
    }

    /* Mark the docket once it has left its resting place, so the sticky
       state is visible in a still. */
    var dockets = [].slice.call(document.querySelectorAll(".dossier__docket"));
    if (dockets.length && typeof root.IntersectionObserver === "function") {
      dockets.forEach(function (d) {
        var probe = document.createElement("div");
        probe.style.cssText = "position:absolute;height:1px;width:1px;";
        d.parentNode.insertBefore(probe, d);
        new root.IntersectionObserver(function (entries) {
          d.classList.toggle("dossier__docket--stuck", !entries[0].isIntersecting);
        }, { rootMargin: "-" + (parseInt(getComputedStyle(d).top, 10) + 2) + "px 0px 0px 0px" }).observe(probe);
      });
    }
  }

  root.JobBoredMockShell = { boot: boot, LEGEND: LEGEND };
})(typeof window !== "undefined" ? window : globalThis);
