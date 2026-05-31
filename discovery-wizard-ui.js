/* ============================================
   COMMAND CENTER v2 — Discovery Setup-Wizard UI
   Pure-presentation builders extracted from app.js (Phase 1a).

   Classic-global IIFE under window.JobBoredDiscoveryWizard.ui — NOT an ES
   module (matches every sibling discovery-wizard-*.js). Loaded BEFORE app.js,
   so the app.js helper bridge is read LAZILY inside each function via
   window.JobBoredDiscoveryWizard.ui.host, never captured at IIFE top.
   ============================================ */
(() => {
  const root =
    window.JobBoredDiscoveryWizard || (window.JobBoredDiscoveryWizard = {});
  root.ui = root.ui || {};

  // Pure-presentation wizard builders are attached to root.ui here in the
  // Phase 1a move steps (D4–D5). app.js publishes root.ui.host separately.
})();
