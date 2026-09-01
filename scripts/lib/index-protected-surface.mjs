/**
 * Protected dashboard surface that static assembly and local expansion
 * must both expose. F4-D owns this inventory; F0-A owns HTTP path
 * containment around the expander.
 */
export const PROTECTED_SURFACE_IDS = [
  "runsModal",
  "expiredReviewModal",
  "settingsModal",
  "scraperSetupModal",
  "materialsModal",
  "linkedInCaptureModal",
  "resumeGenerateModal",
  "draftNotesModal",
  "discoveryDrawer",
  "ingestManualModal",
  "sheetAccessGateScreen",
  "dashboard",
];

export function missingProtectedIds(html) {
  const source = String(html || "");
  return PROTECTED_SURFACE_IDS.filter((id) => !source.includes(`id="${id}"`));
}
