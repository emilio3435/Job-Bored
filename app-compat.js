// Compatibility forwarders for extracted app modules.
// Loaded before app.js so host registration can still reference legacy globals.

// --- Pipeline render (extracted to pipeline-render.js) ---
function renderAll(...args) {
  return window.JobBoredApp.pipelineRender.renderAll(...args);
}
function renderStats(...args) {
  return window.JobBoredApp.pipelineRender.renderStats(...args);
}
function animateNumber(...args) {
  return window.JobBoredApp.pipelineRender.animateNumber(...args);
}
function normalizeStatusStr(...args) {
  return window.JobBoredApp.pipelineRender.normalizeStatusStr(...args);
}
function isInboxJob(...args) {
  return window.JobBoredApp.pipelineRender.isInboxJob(...args);
}
function stageToCssKey(...args) {
  return window.JobBoredApp.pipelineRender.stageToCssKey(...args);
}
function renderRoleFactsHtml(...args) {
  return window.JobBoredApp.pipelineRender.renderRoleFactsHtml(...args);
}
function groupByStage(...args) {
  return window.JobBoredApp.pipelineRender.groupByStage(...args);
}
function renderKanbanCard(...args) {
  return window.JobBoredApp.pipelineRender.renderKanbanCard(...args);
}
function applyLegacyKanbanCap(...args) {
  return window.JobBoredApp.pipelineRender.applyLegacyKanbanCap(...args);
}
function renderLegacyKanbanHiddenAffordance(...args) {
  return window.JobBoredApp.pipelineRender.renderLegacyKanbanHiddenAffordance(...args);
}
function renderStageLane(...args) {
  return window.JobBoredApp.pipelineRender.renderStageLane(...args);
}
function renderPipelineBoard(...args) {
  return window.JobBoredApp.pipelineRender.renderPipelineBoard(...args);
}
function handleDetailEscape(...args) {
  return window.JobBoredApp.pipelineRender.handleDetailEscape(...args);
}
function renderStageStepper(...args) {
  return window.JobBoredApp.pipelineRender.renderStageStepper(...args);
}
function renderDrawerContent(...args) {
  return window.JobBoredApp.pipelineRender.renderDrawerContent(...args);
}
function openJobDetail(...args) {
  return window.JobBoredApp.pipelineRender.openJobDetail(...args);
}
function closeJobDetail(...args) {
  return window.JobBoredApp.pipelineRender.closeJobDetail(...args);
}
function refreshDrawerIfOpen(...args) {
  return window.JobBoredApp.pipelineRender.refreshDrawerIfOpen(...args);
}
function updateTrackIndicator(...args) {
  return window.JobBoredApp.pipelineRender.updateTrackIndicator(...args);
}
function updateNavVisibility(...args) {
  return window.JobBoredApp.pipelineRender.updateNavVisibility(...args);
}
function attachBoardListeners(...args) {
  return window.JobBoredApp.pipelineRender.attachBoardListeners(...args);
}
function filterAndSortJobs(...args) {
  return window.JobBoredApp.pipelineRender.filterAndSortJobs(...args);
}
function renderPipeline(...args) {
  return window.JobBoredApp.pipelineRender.renderPipeline(...args);
}
function renderCardActions(...args) {
  return window.JobBoredApp.pipelineRender.renderCardActions(...args);
}
function attachCardListeners(...args) {
  return window.JobBoredApp.pipelineRender.attachCardListeners(...args);
}



// --- Daily Brief (delegates to daily-brief.js) ---
function renderBrief(...args) {
  return window.JobBoredApp.brief.renderBrief(...args);
}

function renderAreaWidget(...args) {
  return window.JobBoredApp.brief.renderAreaWidget(...args);
}

function renderPipelineDailyBrief(...args) {
  return window.JobBoredApp.brief.renderPipelineDailyBrief(...args);
}

function normalizeResponseFlag(val) {
  if (!val || !String(val).trim()) return "";
  const v = String(val).trim().toLowerCase();
  if (v === "yes" || v === "y") return "yes";
  if (v === "no" || v === "n") return "no";
  if (v === "unknown" || v === "?") return "unknown";
  return "";
}

/** Short label for chips and the brief (user-facing). */
function responseLabelForDisplay(flag) {
  const n = normalizeResponseFlag(flag);
  if (n === "yes") return "Yes";
  if (n === "no") return "No";
  if (n === "unknown") return "Not sure";
  if (flag && String(flag).trim()) return String(flag).trim();
  return "";
}

function selectedResponseSheetValue(job) {
  const n = normalizeResponseFlag(job.responseFlag);
  if (n === "yes") return "Yes";
  if (n === "no") return "No";
  if (n === "unknown") return "Unknown";
  return "";
}


// ============================================
// UTILITY
// ============================================

function escapeHtml(...args) {
  return window.JobBoredApp.utils.escapeHtml(...args);
}

function safeHref(...args) {
  return window.JobBoredApp.utils.safeHref(...args);
}

// --- Expired review UI (extracted to expired-review-ui.js) ---
function getExpiredReviewItems(...args) {
  return window.JobBoredApp.expiredReview.getExpiredReviewItems(...args);
}
function renderExpiredReviewButton(...args) {
  return window.JobBoredApp.expiredReview.renderExpiredReviewButton(...args);
}
function renderExpiredReviewModal(...args) {
  return window.JobBoredApp.expiredReview.renderExpiredReviewModal(...args);
}
function openExpiredReviewModal(...args) {
  return window.JobBoredApp.expiredReview.openExpiredReviewModal(...args);
}
function closeExpiredReviewModal(...args) {
  return window.JobBoredApp.expiredReview.closeExpiredReviewModal(...args);
}
function maybeAutoOpenExpiredReviewModal(...args) {
  return window.JobBoredApp.expiredReview.maybeAutoOpenExpiredReviewModal(...args);
}
function initExpiredReviewUi(...args) {
  return window.JobBoredApp.expiredReview.initExpiredReviewUi(...args);
}

function updateLastRefresh() {
  const el = document.getElementById("lastRefresh");
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  if (el) el.textContent = `Updated ${time}`;
}

// ============================================
// RESUME MATERIALS & GENERATION (IndexedDB + BYOK / webhook)
// ============================================

function getAtsScorecardState() {
  return window.JobBoredApp.materialsState.getAtsScorecardState();
}

function getGeneratedDraftLibraryCache() {
  return window.JobBoredApp.materialsState.getGeneratedDraftLibraryCache();
}

function setAtsScorecardState(next) {
  return window.JobBoredApp.materialsState.setAtsScorecardState(next);
}

function getUserContent() {
  return window.JobBoredApp.materialsState.getUserContent();
}

function getResumeBundle() {
  return window.JobBoredApp.materialsState.getResumeBundle();
}

function getResumeGenerate() {
  return window.JobBoredApp.materialsState.getResumeGenerate();
}

function getResumeIngest() {
  return window.JobBoredApp.materialsState.getResumeIngest();
}

async function getResumeIngestReady(maxWaitMs) {
  return window.JobBoredApp.materialsState.getResumeIngestReady(maxWaitMs);
}

function getJobOpportunityKey(job) {
  return window.JobBoredApp.materialsState.getJobOpportunityKey(job);
}

function getDraftFeatureLabel(feature) {
  return window.JobBoredApp.materialsState.getDraftFeatureLabel(feature);
}

function getDraftModeLabel(mode) {
  return window.JobBoredApp.materialsState.getDraftModeLabel(mode);
}

function formatDraftSavedAt(iso) {
  return window.JobBoredApp.materialsState.formatDraftSavedAt(iso);
}

function rebuildGeneratedDraftLibraryCache(rows) {
  return window.JobBoredApp.materialsState.rebuildGeneratedDraftLibraryCache(
    rows,
  );
}

async function refreshGeneratedDraftLibraryCache() {
  return window.JobBoredApp.materialsState.refreshGeneratedDraftLibraryCache();
}

function scheduleGeneratedDraftLibraryRefresh(shouldRender) {
  return window.JobBoredApp.materialsState.scheduleGeneratedDraftLibraryRefresh(
    shouldRender,
  );
}

function getDraftsForJob(job, feature) {
  return window.JobBoredApp.materialsState.getDraftsForJob(job, feature);
}

function getDraftByIdFromCache(id) {
  return window.JobBoredApp.materialsState.getDraftByIdFromCache(id);
}

function renderDraftDeckPanel(...args) {
  return window.JobBoredApp.resumeGeneration.renderDraftDeckPanel(...args);
}

function renderDraftLibraryCardHtml(...args) {
  return window.JobBoredApp.resumeGeneration.renderDraftLibraryCardHtml(...args);
}

function getResumeGenerateDraftTextForInsights(...args) {
  return window.JobBoredApp.resumeGeneration.getResumeGenerateDraftTextForInsights(...args);
}

function scheduleResumeGenerateAtsRefresh(...args) {
  return window.JobBoredApp.resumeGeneration.scheduleResumeGenerateAtsRefresh(...args);
}

function renderDraftHistoryItemHtml(...args) {
  return window.JobBoredApp.resumeGeneration.renderDraftHistoryItemHtml(...args);
}

function renderResumeGenerateInsights(...args) {
  return window.JobBoredApp.resumeGeneration.renderResumeGenerateInsights(...args);
}

function openDraftNotesModal(...args) {
  return window.JobBoredApp.resumeGeneration.openDraftNotesModal(...args);
}

async function reviseLetterDraftForJob(...args) {
  return window.JobBoredApp.resumeGeneration.reviseLetterDraftForJob(...args);
}

function closeDraftNotesModal(...args) {
  return window.JobBoredApp.resumeGeneration.closeDraftNotesModal(...args);
}

async function openResumeGenerateModal(...args) {
  return window.JobBoredApp.resumeGeneration.openResumeGenerateModal(...args);
}

function closeResumeGenerateModal(...args) {
  return window.JobBoredApp.resumeGeneration.closeResumeGenerateModal(...args);
}

async function runResumeGeneration(...args) {
  return window.JobBoredApp.resumeGeneration.runResumeGeneration(...args);
}

async function refineLastResumeGeneration(...args) {
  return window.JobBoredApp.resumeGeneration.refineLastResumeGeneration(...args);
}

async function openSavedDraftVersion(...args) {
  return window.JobBoredApp.resumeGeneration.openSavedDraftVersion(...args);
}

async function openLatestSavedDraftForJob(...args) {
  return window.JobBoredApp.resumeGeneration.openLatestSavedDraftForJob(...args);
}

function buildDraftNotesPrefill(...args) {
  return window.JobBoredApp.resumeGeneration.buildDraftNotesPrefill(...args);
}


async function buildCandidateProfileExcerpt(UC, maxChars) {
  return window.JobBoredApp.materialsState.buildCandidateProfileExcerpt(
    UC,
    maxChars,
  );
}

if (typeof window !== "undefined") {
  window.openDraftNotesModal = openDraftNotesModal;
  window.reviseLetterDraftForJob = reviseLetterDraftForJob;
  window.getDraftsForJob = getDraftsForJob;
  window.openSavedDraftVersion = openSavedDraftVersion;
  window.getPipelineJobByIndex = function (idx) {
    var n = Number(idx);
    if (!Number.isFinite(n)) return null;
    return getPipelineData()[n] || null;
  };
  window.runResumeGeneration = runResumeGeneration;
  window.buildDraftNotesPrefill = buildDraftNotesPrefill;
  window.getWorkshopProfileSummary = async function () {
    return window.JobBoredApp.resumeGeneration.getWorkshopProfileSummary();
  };
}


// --- Keyword / profile-match (extracted to keyword-profile-match.js) ---
// Thin delegating wrappers keep bare-name call sites in app.js working.
// Module owns the candidateProfileMatchCache + all analysis logic under
// window.JobBoredApp.keywordMatch.
function renderProfileMatchBadgeHtml(job, dataIndex) {
  return window.JobBoredApp.keywordMatch.renderProfileMatchBadgeHtml(
    job,
    dataIndex,
  );
}

function openProfileMatchModal(job, dataIndex) {
  return window.JobBoredApp.keywordMatch.openProfileMatchModal(job, dataIndex);
}

function renderMatchItemsHtml(terms, itemClassName) {
  return window.JobBoredApp.keywordMatch.renderMatchItemsHtml(
    terms,
    itemClassName,
  );
}

function refreshCandidateProfileMatchCache() {
  return window.JobBoredApp.keywordMatch.refreshCandidateProfileMatchCache();
}

function scheduleCandidateProfileMatchRefresh(shouldRender) {
  return window.JobBoredApp.keywordMatch.scheduleCandidateProfileMatchRefresh(
    shouldRender,
  );
}

// --- ATS scorecard (extracted to ats-scorecard.js) ---
function computeAtsScorecardCacheKey(...args) {
  return window.JobBoredApp.ats.computeAtsScorecardCacheKey(...args);
}

function buildAtsScorecardRequestPayload(...args) {
  return window.JobBoredApp.ats.buildAtsScorecardRequestPayload(...args);
}

function startAtsScorecardAnalysis(...args) {
  return window.JobBoredApp.ats.startAtsScorecardAnalysis(...args);
}

function sanitizeAtsText(...args) {
  return window.JobBoredApp.ats.sanitizeAtsText(...args);
}

function formatAtsDimensionSummary(...args) {
  return window.JobBoredApp.ats.formatAtsDimensionSummary(...args);
}

function renderAtsScorecardGroupsHtml(...args) {
  return window.JobBoredApp.ats.renderAtsScorecardGroupsHtml(...args);
}


// --- Sheets read/load (extracted to sheets-read-load.js) ---
function loadAllData(...args) {
  return window.JobBoredApp.sheetsRead.loadAllData(...args);
}
function applyFavoriteCache(...args) {
  return window.JobBoredApp.sheetsRead.applyFavoriteCache(...args);
}
function favoriteCacheKeyForJob(...args) {
  return window.JobBoredApp.sheetsRead.favoriteCacheKeyForJob(...args);
}
function setPendingFavorite(...args) {
  return window.JobBoredApp.sheetsRead.setPendingFavorite(...args);
}
function clearPendingFavorite(...args) {
  return window.JobBoredApp.sheetsRead.clearPendingFavorite(...args);
}

// --- Posting enrichment (extracted to posting-enrichment.js) ---
function cacheEnrichment(...args) {
  return window.JobBoredApp.postingEnrichment.cacheEnrichment(...args);
}
function getCachedEnrichmentForJob(...args) {
  return window.JobBoredApp.postingEnrichment.getCachedEnrichmentForJob(...args);
}
function applyEnrichmentCache(...args) {
  return window.JobBoredApp.postingEnrichment.applyEnrichmentCache(...args);
}
async function fetchJobPostingEnrichment(...args) {
  return window.JobBoredApp.postingEnrichment.fetchJobPostingEnrichment(...args);
}
async function fallbackEnrichmentFromSheetOnly(...args) {
  return window.JobBoredApp.postingEnrichment.fallbackEnrichmentFromSheetOnly(...args);
}
function isUsableCachedEnrichment(...args) {
  return window.JobBoredApp.postingEnrichment.isUsableCachedEnrichment(...args);
}

// --- Company logo (extracted to company-logo.js) ---
function renderLogoHtml(...args) {
  return window.JobBoredApp.companyLogo.renderLogoHtml(...args);
}
function isPlaceholderLogoUrl(...args) {
  return window.JobBoredApp.companyLogo.isPlaceholderLogoUrl(...args);
}
async function resolveCompanyLogoUrl(...args) {
  return window.JobBoredApp.companyLogo.resolveCompanyLogoUrl(...args);
}

// --- Profile materials (extracted to profile-materials.js) ---
function profileApplyResumeFile(...args) {
  return window.JobBoredApp.profileMaterials.profileApplyResumeFile(...args);
}
async function profileApplySampleFiles(...args) {
  return window.JobBoredApp.profileMaterials.profileApplySampleFiles(...args);
}
function bindProfileDropzone(...args) {
  return window.JobBoredApp.profileMaterials.bindProfileDropzone(...args);
}
function renderLinkedInProfileMeta(...args) {
  return window.JobBoredApp.profileMaterials.renderLinkedInProfileMeta(...args);
}
function renderAdditionalContextMeta(...args) {
  return window.JobBoredApp.profileMaterials.renderAdditionalContextMeta(...args);
}
function normalizeProfileTextInput(...args) {
  return window.JobBoredApp.profileMaterials.normalizeProfileTextInput(...args);
}
function collectLinkedInCaptureSections(...args) {
  return window.JobBoredApp.profileMaterials.collectLinkedInCaptureSections(...args);
}
function buildLinkedInCaptureProfileText(...args) {
  return window.JobBoredApp.profileMaterials.buildLinkedInCaptureProfileText(...args);
}
function getLinkedInCaptureCompleteness(...args) {
  return window.JobBoredApp.profileMaterials.getLinkedInCaptureCompleteness(...args);
}
function updateLinkedInCapturePreview(...args) {
  return window.JobBoredApp.profileMaterials.updateLinkedInCapturePreview(...args);
}
function openLinkedInCaptureModal(...args) {
  return window.JobBoredApp.profileMaterials.openLinkedInCaptureModal(...args);
}
function closeLinkedInCaptureModal(...args) {
  return window.JobBoredApp.profileMaterials.closeLinkedInCaptureModal(...args);
}
function applyPreferencesFromData(...args) {
  return window.JobBoredApp.profileMaterials.applyPreferencesFromData(...args);
}
async function refreshPersonalPreferencesPanel(...args) {
  return window.JobBoredApp.profileMaterials.refreshPersonalPreferencesPanel(...args);
}
async function refreshMaterialsUI(...args) {
  return window.JobBoredApp.profileMaterials.refreshMaterialsUI(...args);
}
function openMaterialsModal(...args) {
  return window.JobBoredApp.profileMaterials.openMaterialsModal(...args);
}
function closeMaterialsModal(...args) {
  return window.JobBoredApp.profileMaterials.closeMaterialsModal(...args);
}


// --- Onboarding wizard (extracted to onboarding-wizard.js) ---
function isOnboardingWizardVisible(...args) {
  return window.JobBoredApp.onboarding.isOnboardingWizardVisible(...args);
}
function hideOnboardingWizard(...args) {
  return window.JobBoredApp.onboarding.hideOnboardingWizard(...args);
}
function showOnboardingWizard(...args) {
  return window.JobBoredApp.onboarding.showOnboardingWizard(...args);
}
function updateOnboardingProgressUI(...args) {
  return window.JobBoredApp.onboarding.updateOnboardingProgressUI(...args);
}
function syncOnboardingToneCards(...args) {
  return window.JobBoredApp.onboarding.syncOnboardingToneCards(...args);
}
function renderOnboardingSummary(...args) {
  return window.JobBoredApp.onboarding.renderOnboardingSummary(...args);
}
function updateOnboardingMascotPose(...args) {
  return window.JobBoredApp.onboarding.updateOnboardingMascotPose(...args);
}
function setOnboardingStep(...args) {
  return window.JobBoredApp.onboarding.setOnboardingStep(...args);
}
function updateOnboardingContinue2Enabled(...args) {
  return window.JobBoredApp.onboarding.updateOnboardingContinue2Enabled(...args);
}
function updateOnboardingNext3Enabled(...args) {
  return window.JobBoredApp.onboarding.updateOnboardingNext3Enabled(...args);
}
async function checkOnboardingGate(...args) {
  return window.JobBoredApp.onboarding.checkOnboardingGate(...args);
}
function ensureResumeDraftFromPasteStep(...args) {
  return window.JobBoredApp.onboarding.ensureResumeDraftFromPasteStep(...args);
}
function initOnboardingWizard(...args) {
  return window.JobBoredApp.onboarding.initOnboardingWizard(...args);
}


// --- Settings modal (extracted to settings-modal.js) ---
function isSettingsModalOpen(...args) {
  return window.JobBoredApp.settings.isSettingsModalOpen(...args);
}
function fillOneResumeModelSelect(...args) {
  return window.JobBoredApp.settings.fillOneResumeModelSelect(...args);
}
function fillResumeModelSelectsFromConfig(...args) {
  return window.JobBoredApp.settings.fillResumeModelSelectsFromConfig(...args);
}
async function populateDiscoveryProfileIntoSettingsForm(...args) {
  return window.JobBoredApp.settings.populateDiscoveryProfileIntoSettingsForm(...args);
}
function populateCommandCenterSettingsForm(...args) {
  return window.JobBoredApp.settings.populateCommandCenterSettingsForm(...args);
}
function updateSettingsProviderPanels(...args) {
  return window.JobBoredApp.settings.updateSettingsProviderPanels(...args);
}
function isSettingsFullExperienceUnlocked(...args) {
  return window.JobBoredApp.settings.isSettingsFullExperienceUnlocked(...args);
}
function maybeSyncSettingsModalModeAfterAuth(...args) {
  return window.JobBoredApp.settings.maybeSyncSettingsModalModeAfterAuth(...args);
}
function syncSettingsModalMode(...args) {
  return window.JobBoredApp.settings.syncSettingsModalMode(...args);
}
function maybeApplyPhasedSettingsDefaultOAuthClientId(...args) {
  return window.JobBoredApp.settings.maybeApplyPhasedSettingsDefaultOAuthClientId(...args);
}
async function openCommandCenterSettingsModal(...args) {
  return window.JobBoredApp.settings.openCommandCenterSettingsModal(...args);
}
function hideSettingsClearConfirmBar(...args) {
  return window.JobBoredApp.settings.hideSettingsClearConfirmBar(...args);
}
function showSettingsClearConfirmBar(...args) {
  return window.JobBoredApp.settings.showSettingsClearConfirmBar(...args);
}
function closeCommandCenterSettingsModal(...args) {
  return window.JobBoredApp.settings.closeCommandCenterSettingsModal(...args);
}
async function saveCommandCenterSettingsFromForm(...args) {
  return window.JobBoredApp.settings.saveCommandCenterSettingsFromForm(...args);
}
async function performSettingsClearOverrides(...args) {
  return window.JobBoredApp.settings.performSettingsClearOverrides(...args);
}
function initCommandCenterSettings(...args) {
  return window.JobBoredApp.settings.initCommandCenterSettings(...args);
}


function initSetupAndSheetAccessActions(...args) {
  return window.JobBoredApp.setup.initSetupAndSheetAccessActions(...args);
}

// --- App bootstrap (extracted to app-bootstrap.js) ---
function initPipelineEmptyAndBriefActions(...args) {
  return window.JobBoredApp.bootstrap.initPipelineEmptyAndBriefActions(...args);
}


function initResumeMaterialsFeature(...args) {
  return window.JobBoredApp.materials.initResumeMaterialsFeature(...args);
}
