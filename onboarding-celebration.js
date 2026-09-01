/* ============================================
   The one celebration (ONE-FLOW-ONBOARDING-SPEC §5 B6, §7).

   L0 STUB. Today the celebration player lives inside
   onboarding-wizard.js and fires at four different "done" moments. The
   spec collapses that to exactly ONE burst, at B6, and the acceptance
   check is literal: `grep playOnboardingCelebration` must return a
   single call site.

   L4 (bookends) moves the existing, well-tested player into this file
   and points B6 at it. L0 ships the empty module + its load-order slot
   so that move touches one file and no script tags.

   Classic-global IIFE under window.JobBoredOnboardingCelebration.
   ============================================ */
(function () {
  window.JobBoredOnboardingCelebration ||
    (window.JobBoredOnboardingCelebration = {});
})();
