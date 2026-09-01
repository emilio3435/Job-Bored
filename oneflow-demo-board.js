/* ============================================
   Screen S0 — the demo board (ONE-FLOW-ONBOARDING-SPEC §4).

   L0 STUB. S0 is the dashboard itself, not a modal: the real pipeline
   renderer seeded from fixtures/demo-pipeline.json, watermarked DEMO,
   with the "This is your job hunt on autopilot." invitation card over
   it. L4 (bookends) owns the fixture, the demo data source, and the
   invitation card / corner-pill behavior.

   L0 ships only the namespace + the load-order slot so L4 fills one
   file and nothing else moves. Deliberately inert: it renders nothing
   and registers nothing (S0 is not a beat).

   Classic-global IIFE under window.JobBoredOneFlowDemoBoard.
   ============================================ */
(function () {
  const root =
    window.JobBoredOneFlowDemoBoard ||
    (window.JobBoredOneFlowDemoBoard = {});

  /** Fixture path L4 seeds the board from (spec §4, locked decision 4). */
  root.FIXTURE_PATH = "fixtures/demo-pipeline.json";

  /** True once real Sheet rows replace the fixture (spec §4 "Exit"). */
  root.isActive = function isActive() {
    return false;
  };
})();
