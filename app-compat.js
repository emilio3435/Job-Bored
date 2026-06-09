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


// --- First-run infra wizard (extracted to first-run-wizard.js) ---
function isFirstRunWizardVisible(...args) {
  return window.JobBoredApp.firstRunWizard.isFirstRunWizardVisible(...args);
}
function showFirstRunWizard(...args) {
  return window.JobBoredApp.firstRunWizard.showFirstRunWizard(...args);
}
async function checkInfraSetupGate(...args) {
  return window.JobBoredApp.firstRunWizard.checkInfraSetupGate(...args);
}


// --- Settings modal (extracted to settings-modal.js) ---
function isSettingsModalOpen(...args) {
  return window.JobBoredApp.settings.isSettingsModalOpen(...args);
}
function fillDocumentTemplateSelect(...args) {
  return window.JobBoredApp.settings.fillDocumentTemplateSelect(...args);
}
function fillVisualThemeSelect(...args) {
  return window.JobBoredApp.settings.fillVisualThemeSelect(...args);
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

// --- Final shell compatibility forwarders moved from app.js ---
function dispatchDiscoveryRunTrackerEvent(state) {
  return window.JobBoredDiscovery.runTracker.dispatchDiscoveryRunTrackerEvent(
    state,
  );
}
// --- Apps Script / relay helpers (extracted to apps-script-relay-helpers.js) ---
const relayHelpers = window.JobBoredDiscovery.relayHelpers;
function getAppsScriptEditorUrl(...args) {
  return relayHelpers.getAppsScriptEditorUrl(...args);
}
function formatAppsScriptWebAppAccessLabel(...args) {
  return relayHelpers.formatAppsScriptWebAppAccessLabel(...args);
}
function formatAppsScriptExecuteAsLabel(...args) {
  return relayHelpers.formatAppsScriptExecuteAsLabel(...args);
}
function buildAppsScriptPublicAccessRemediationStatus(...args) {
  return relayHelpers.buildAppsScriptPublicAccessRemediationStatus(...args);
}
function isLikelyAppsScriptWebAppUrl(...args) {
  return relayHelpers.isLikelyAppsScriptWebAppUrl(...args);
}
function isLikelyCloudflareWorkerUrl(...args) {
  return relayHelpers.isLikelyCloudflareWorkerUrl(...args);
}
function buildCloudflareRelayCorsSnippet(...args) {
  return relayHelpers.buildCloudflareRelayCorsSnippet(...args);
}
function sanitizeCloudflareWorkerName(...args) {
  return relayHelpers.sanitizeCloudflareWorkerName(...args);
}
function inferCloudflareRelaySuffixFromTarget(...args) {
  return relayHelpers.inferCloudflareRelaySuffixFromTarget(...args);
}
function getSuggestedCloudflareRelayWorkerName(...args) {
  return relayHelpers.getSuggestedCloudflareRelayWorkerName(...args);
}
function inferCloudflareWorkerNameFromOpenWorkerUrl(...args) {
  return relayHelpers.inferCloudflareWorkerNameFromOpenWorkerUrl(...args);
}
function quoteShellArg(...args) {
  return relayHelpers.quoteShellArg(...args);
}
function buildCloudflareRelayDeployCommand(...args) {
  return relayHelpers.buildCloudflareRelayDeployCommand(...args);
}
function getDiscoveryRelaySuggestedOrigin(...args) {
  return relayHelpers.getDiscoveryRelaySuggestedOrigin(...args);
}
function getDiscoveryRelayWorkerName(...args) {
  return relayHelpers.getDiscoveryRelayWorkerName(...args);
}
function buildDiscoveryRelayDeployCommandForTarget(...args) {
  return relayHelpers.buildDiscoveryRelayDeployCommandForTarget(...args);
}
function createDiscoveryRelayCopyCommandToastAction(...args) {
  return relayHelpers.createDiscoveryRelayCopyCommandToastAction(...args);
}
function buildCloudflareRelayAgentPrompt(...args) {
  return relayHelpers.buildCloudflareRelayAgentPrompt(...args);
}
function describeCloudflareAccessProtectedWebhook(...args) {
  return relayHelpers.describeCloudflareAccessProtectedWebhook(...args);
}
function describeAppsScriptHtmlAccessIssue(...args) {
  return relayHelpers.describeAppsScriptHtmlAccessIssue(...args);
}
function isAppsScriptWebhookStubResponse(...args) {
  return relayHelpers.isAppsScriptWebhookStubResponse(...args);
}
function isAsyncDiscoveryAcceptedResponse(...args) {
  return relayHelpers.isAsyncDiscoveryAcceptedResponse(...args);
}
function buildDiscoverySuccessToast(...args) {
  return relayHelpers.buildDiscoverySuccessToast(...args);
}
// --- Discovery status handoff (extracted to discovery-status-handoff.js) ---
function statusApi(name, ...args) {
  return window.JobBoredDiscovery.status[name](...args);
}
const PENDING_DISCOVERY_SETUP_KEY =
  window.JobBoredDiscovery.status.PENDING_DISCOVERY_SETUP_KEY;
function isManagedAppsScriptDeployState(...args) {
  return statusApi("isManagedAppsScriptDeployState", ...args);
}
function isAppsScriptPublicAccessReady(...args) {
  return statusApi("isAppsScriptPublicAccessReady", ...args);
}
function openAppsScriptRemediationFlowInSettings(...args) {
  return statusApi("openAppsScriptRemediationFlowInSettings", ...args);
}
function showAppsScriptPublicAccessRemediationFromState(...args) {
  return statusApi("showAppsScriptPublicAccessRemediationFromState", ...args);
}
async function diagnoseDownstreamChain(...args) {
  return statusApi("diagnoseDownstreamChain", ...args);
}
function setAppsScriptDeployStatus(...args) {
  return statusApi("setAppsScriptDeployStatus", ...args);
}
function clearAppsScriptDeployStatus(...args) {
  return statusApi("clearAppsScriptDeployStatus", ...args);
}
function hasPendingDiscoverySetup(...args) {
  return statusApi("hasPendingDiscoverySetup", ...args);
}
function queuePendingDiscoverySetup(...args) {
  return statusApi("queuePendingDiscoverySetup", ...args);
}
async function resumePendingDiscoverySetupIfNeeded(...args) {
  return statusApi("resumePendingDiscoverySetupIfNeeded", ...args);
}
function stripSetupDiscoveryParam(...args) {
  return statusApi("stripSetupDiscoveryParam", ...args);
}
function focusDiscoveryWebhookFieldInSettings(...args) {
  return statusApi("focusDiscoveryWebhookFieldInSettings", ...args);
}
async function openSettingsForDiscoveryWebhook(...args) {
  return statusApi("openSettingsForDiscoveryWebhook", ...args);
}
async function requestDiscoverySetup(...args) {
  return statusApi("requestDiscoverySetup", ...args);
}
function buildRunStatusUrl(...args) {
  return statusApi("buildRunStatusUrl", ...args);
}
function canSynthesizeRunStatusPath(...args) {
  return statusApi("canSynthesizeRunStatusPath", ...args);
}
function resolveAcceptedRunStatusPath(...args) {
  return statusApi("resolveAcceptedRunStatusPath", ...args);
}
function isLikelyNgrokUrl(...args) {
  return statusApi("isLikelyNgrokUrl", ...args);
}
function getDiscoveryStatusPollingWebhookUrl(...args) {
  return statusApi("getDiscoveryStatusPollingWebhookUrl", ...args);
}
function buildDiscoveryStatusPollHeaders(...args) {
  return statusApi("buildDiscoveryStatusPollHeaders", ...args);
}
async function pollRunStatus(...args) {
  return statusApi("pollRunStatus", ...args);
}
function retryDiscoveryStatusConnection(...args) {
  return statusApi("retryDiscoveryStatusConnection", ...args);
}
function shouldRefreshPipelineAfterDiscoveryRun(...args) {
  return statusApi("shouldRefreshPipelineAfterDiscoveryRun", ...args);
}
async function refreshPipelineAfterDiscoveryRun(...args) {
  return statusApi("refreshPipelineAfterDiscoveryRun", ...args);
}
async function startDiscoveryStatusPolling(...args) {
  return statusApi("startDiscoveryStatusPolling", ...args);
}
function stopDiscoveryStatusPolling(...args) {
  return statusApi("stopDiscoveryStatusPolling", ...args);
}
function resumeDiscoveryStatusPollingIfNeeded(...args) {
  return statusApi("resumeDiscoveryStatusPollingIfNeeded", ...args);
}
function renderDiscoveryRunStatus(...args) {
  return statusApi("renderDiscoveryRunStatus", ...args);
}
async function handleDiscoverySetupDeepLink(...args) {
  return statusApi("handleDiscoverySetupDeepLink", ...args);
}
function runPostAccessBootstrapOnce(...args) {
  return statusApi("runPostAccessBootstrapOnce", ...args);
}

const COMMAND_CENTER_OVERRIDE_KEYS =
  window.JobBoredApp.configOverrides.COMMAND_CENTER_OVERRIDE_KEYS;

function readStoredConfigOverrides() {
  // localStorage.getItem(COMMAND_CENTER_CONFIG_OVERRIDE_KEY)
  return window.JobBoredApp.configOverrides.readStoredConfigOverrides();
}

function applyConfigOverridesToWindowConfig(overrides) {
  return window.JobBoredApp.configOverrides.applyConfigOverridesToWindowConfig(
    overrides,
  );
}

function writeStoredConfigOverrides(overrides) {
  return window.JobBoredApp.configOverrides.writeStoredConfigOverrides(
    overrides,
  );
}

function mergeStoredConfigOverridePatch(patch) {
  return window.JobBoredApp.configOverrides.mergeStoredConfigOverridePatch(
    patch,
  );
}

function buildGreenfieldOverrideMask() {
  return window.JobBoredApp.configOverrides.buildGreenfieldOverrideMask();
}

/** Merge values saved in this browser (localStorage) onto config from config.js. */
function applyStoredConfigOverrides() {
  return window.JobBoredApp.configOverrides.applyStoredConfigOverrides();
}

function readDiscoveryTransportSetupState() {
  return window.JobBoredApp.configOverrides.readDiscoveryTransportSetupState();
}

function normalizeDiscoveryLocalWebhookUrl(raw) {
  return window.JobBoredApp.configOverrides.normalizeDiscoveryLocalWebhookUrl(
    raw,
  );
}

function normalizeDiscoveryTunnelPublicUrl(raw) {
  return window.JobBoredApp.configOverrides.normalizeDiscoveryTunnelPublicUrl(
    raw,
  );
}

function getDiscoveryTransportSetupState() {
  return window.JobBoredApp.configOverrides.getDiscoveryTransportSetupState();
}

function writeDiscoveryTransportSetupState(patch) {
  return window.JobBoredApp.configOverrides.writeDiscoveryTransportSetupState(
    patch,
  );
}

function isLocalDashboardOrigin() {
  return window.JobBoredApp.configOverrides.isLocalDashboardOrigin();
}

function getBootstrapDiscoveryWebhookSecret(data) {
  return window.JobBoredApp.configOverrides.getBootstrapDiscoveryWebhookSecret(
    data,
  );
}

function isLikelyNgrokWebhookUrl(raw) {
  return window.JobBoredApp.configOverrides.isLikelyNgrokWebhookUrl(raw);
}

function discoveryUrlOrigin(raw) {
  return window.JobBoredApp.configOverrides.discoveryUrlOrigin(raw);
}

function sameDiscoveryUrlOrigin(a, b) {
  return window.JobBoredApp.configOverrides.sameDiscoveryUrlOrigin(a, b);
}

function isBootstrapManagedDiscoveryEndpoint(data, endpointUrl) {
  return window.JobBoredApp.configOverrides.isBootstrapManagedDiscoveryEndpoint(
    data,
    endpointUrl,
  );
}

function writeDiscoveryWebhookSecretOverride(secret) {
  return window.JobBoredApp.configOverrides.writeDiscoveryWebhookSecretOverride(
    secret,
  );
}

function autofillDiscoveryWebhookSecretFromBootstrap(data, options = {}) {
  return window.JobBoredApp.configOverrides.autofillDiscoveryWebhookSecretFromBootstrap(
    data,
    options,
  );
}

async function refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(
  endpointUrl,
) {
  return window.JobBoredApp.configOverrides.refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(
    endpointUrl,
  );
}

// ====== [discovery-autodetect lane: relay URL auto-fill] ======
function autofillDiscoveryWebhookUrlFromBootstrap(data) {
  // Reads data.relay.workerUrl; checks getDiscoveryWebhookUrl(); if (existing) return false; /^https?:\/\//i
  return window.JobBoredApp.configOverrides.autofillDiscoveryWebhookUrlFromBootstrap(
    data,
  );
}
// ====== [/discovery-autodetect lane] ======

async function hydrateDiscoveryTransportSetupFromLocalBootstrap() {
  // autofillDiscoveryWebhookSecretFromBootstrap(data); autofillDiscoveryWebhookUrlFromBootstrap(data)
  return window.JobBoredApp.configOverrides.hydrateDiscoveryTransportSetupFromLocalBootstrap();
}

function isPlausibleGoogleSheetId(...args) {
  return window.JobBoredApp.configCore.isPlausibleGoogleSheetId(...args);
}

function parseGoogleSheetId(...args) {
  return window.JobBoredApp.configCore.parseGoogleSheetId(...args);
}

/** Default dashboard label; legacy templates used "Command Center". */
function normalizeDashboardTitle(...args) {
  return window.JobBoredApp.configCore.normalizeDashboardTitle(...args);
}

function getConfig() {
  return window.JobBoredApp.configCore.getConfig();
}

function getSheetId(...args) {
  return window.JobBoredApp.configCore.getSheetId(...args);
}

// Live read of the resolved SHEET_ID module var (distinct from getSheetId,
// which derives from URL/config). Exposed via the UI host bridge so wizard
// orchestration that moved to discovery-wizard-ui.js can read the current value.
function getActiveSheetId(...args) {
  return window.JobBoredApp.configCore.getActiveSheetId(...args);
}

function getOAuthClientId(...args) {
  return window.JobBoredApp.configCore.getOAuthClientId(...args);
}

/** Optional POST target for &ldquo;Run discovery&rdquo; (browser-use worker / Hermes / n8n / Apps Script). */
function getDiscoveryWebhookUrl(...args) {
  return window.JobBoredApp.configCore.getDiscoveryWebhookUrl(...args);
}

/**
 * Optional shared secret for the discovery webhook. When set, the dashboard
 * forwards it as the `x-discovery-secret` header so receivers that fail-closed
 * on empty secrets (e.g. the browser-use worker) accept the request.
 */
function getDiscoveryWebhookSecret(...args) {
  return window.JobBoredApp.configCore.getDiscoveryWebhookSecret(...args);
}

function getSettingsFieldValue(id) {
  return window.JobBoredDiscovery.engineState.getSettingsFieldValue(id);
}

function getSettingsSheetIdValue() {
  return window.JobBoredDiscovery.engineState.getSettingsSheetIdValue();
}

function getSettingsOAuthClientIdValue() {
  return window.JobBoredDiscovery.engineState.getSettingsOAuthClientIdValue();
}

function hasUnsavedOAuthClientIdChange(candidateId) {
  return window.JobBoredDiscovery.engineState.hasUnsavedOAuthClientIdChange(
    candidateId,
  );
}

function getDiscoveryEngineStateStore() {
  return window.JobBoredDiscovery.engineState.getDiscoveryEngineStateStore();
}

function normalizeDiscoveryWebhookIdentity(raw) {
  return window.JobBoredDiscovery.engineState.normalizeDiscoveryWebhookIdentity(
    raw,
  );
}

function getDiscoveryWebhookUrlForSettingsPreview() {
  return window.JobBoredDiscovery.engineState.getDiscoveryWebhookUrlForSettingsPreview();
}

function getManagedAppsScriptWebhookIdentity() {
  return window.JobBoredDiscovery.engineState.getManagedAppsScriptWebhookIdentity();
}

function getSavedDiscoveryEngineStateForUrl(rawUrl) {
  return window.JobBoredDiscovery.engineState.getSavedDiscoveryEngineStateForUrl(
    rawUrl,
  );
}

function getEffectiveDiscoveryEngineStatus(rawUrl) {
  return window.JobBoredDiscovery.engineState.getEffectiveDiscoveryEngineStatus(
    rawUrl,
  );
}

function buildDiscoveryStatusActions(status) {
  return window.JobBoredDiscovery.engineState.buildDiscoveryStatusActions(status);
}

async function saveDiscoveryEngineStatePatch(patch) {
  return window.JobBoredDiscovery.engineState.saveDiscoveryEngineStatePatch(
    patch,
  );
}

async function recordDiscoveryEngineState(rawUrl, state, source) {
  return window.JobBoredDiscovery.engineState.recordDiscoveryEngineState(
    rawUrl,
    state,
    source,
  );
}

// --- Discovery readiness (extracted to discovery-readiness.js) ---

function refreshDiscoveryUiState(...args) {
  return window.JobBoredDiscovery.readiness.refreshDiscoveryUiState(...args);
}

function inferLocalWebhookPort(...args) {
  return window.JobBoredDiscovery.readiness.inferLocalWebhookPort(...args);
}
function buildDiscoveryTunnelTargetUrl(...args) {
  return window.JobBoredDiscovery.readiness.buildDiscoveryTunnelTargetUrl(...args);
}
function getDiscoveryLocalWebhookHealthUrl(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryLocalWebhookHealthUrl(...args);
}
function getCloudflareRelayTargetInfo(...args) {
  return window.JobBoredDiscovery.readiness.getCloudflareRelayTargetInfo(...args);
}
function getDiscoveryWizardRoot(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardRoot(...args);
}
function getDiscoveryWizardShellApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardShellApi(...args);
}
function getDiscoveryWizardProbesApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardProbesApi(...args);
}
function getDiscoveryWizardLocalApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardLocalApi(...args);
}
function getDiscoveryWizardRelayApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardRelayApi(...args);
}
function getDiscoveryWizardVerifyApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardVerifyApi(...args);
}
function mapDiscoveryWizardFlow(...args) {
  return window.JobBoredDiscovery.readiness.mapDiscoveryWizardFlow(...args);
}
function getDiscoveryLocalEngineKind(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryLocalEngineKind(...args);
}
function getDiscoveryLocalEngineLabel(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryLocalEngineLabel(...args);
}
function getDiscoveryLocalEngineSummary(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryLocalEngineSummary(...args);
}
function getDiscoveryRecoveryCopy(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryRecoveryCopy(...args);
}
function getDiscoveryReadinessSnapshot(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryReadinessSnapshot(...args);
}
function getDiscoverySettingsView(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoverySettingsView(...args);
}
function getDiscoveryEmptyStateView(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryEmptyStateView(...args);
}
async function refreshDiscoveryReadinessSnapshot(...args) {
  return window.JobBoredDiscovery.readiness.refreshDiscoveryReadinessSnapshot(...args);
}
async function buildDiscoveryWebhookPayload(...args) {
  return window.JobBoredDiscovery.readiness.buildDiscoveryWebhookPayload(...args);
}
function getDiscoveryRequestGoogleAccessToken(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryRequestGoogleAccessToken(...args);
}
async function getFreshDiscoveryRequestGoogleAccessToken(...args) {
  return window.JobBoredDiscovery.readiness.getFreshDiscoveryRequestGoogleAccessToken(...args);
}
function showDiscoveryVerificationToast(...args) {
  return window.JobBoredDiscovery.readiness.showDiscoveryVerificationToast(...args);
}
async function verifyDiscoveryWebhookWithSharedModel(...args) {
  return window.JobBoredDiscovery.readiness.verifyDiscoveryWebhookWithSharedModel(...args);
}
function getDiscoveryWizardDefaultDrafts(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardDefaultDrafts(...args);
}
function createDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.createDiscoveryWizardRuntime(...args);
}
function getDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardRuntime(...args);
}
function updateDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.updateDiscoveryWizardRuntime(...args);
}
function clearDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.clearDiscoveryWizardRuntime(...args);
}
function setDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.setDiscoveryWizardRuntime(...args);
}
function getDiscoveryWizardStepIds(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardStepIds(...args);
}
function getDiscoveryWizardStepsBefore(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardStepsBefore(...args);
}
async function persistDiscoveryWizardState(...args) {
  return window.JobBoredDiscovery.readiness.persistDiscoveryWizardState(...args);
}

function getDiscoveryEngineStateFromVerificationResult(result) {
  return window.JobBoredDiscovery.engineState.getDiscoveryEngineStateFromVerificationResult(
    result,
  );
}

// Scraper / ATS config — extracted to scraper-ats-config.js (JobBoredApp.scraperAts)
function getJobPostingScrapeUrl() {
  return window.JobBoredApp.scraperAts.getJobPostingScrapeUrl();
}
function getAtsScoringConfig() {
  return window.JobBoredApp.scraperAts.getAtsScoringConfig();
}
function getAtsScorecardApiUrl() {
  return window.JobBoredApp.scraperAts.getAtsScorecardApiUrl();
}
function isScraperUrlBlockedOnThisPage(...args) {
  return window.JobBoredApp.scraperAts.isScraperUrlBlockedOnThisPage(...args);
}
function openScraperSetupModal() {
  return window.JobBoredApp.scraperAts.openScraperSetupModal();
}
function closeScraperSetupModal() {
  return window.JobBoredApp.scraperAts.closeScraperSetupModal();
}
function copyTextToClipboard(...args) {
  return window.JobBoredApp.scraperAts.copyTextToClipboard(...args);
}
async function runScraperConnectionTest() {
  return window.JobBoredApp.scraperAts.runScraperConnectionTest();
}
function isFetchNetworkError(...args) {
  return window.JobBoredApp.scraperAts.isFetchNetworkError(...args);
}

function getAppsScriptDeployStateStore(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.getAppsScriptDeployStateStore(...args);
}
async function populateAppsScriptDeployStateIntoSettingsForm(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.populateAppsScriptDeployStateIntoSettingsForm(...args);
}
function refreshSerpApiCalloutStatus(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.refreshSerpApiCalloutStatus(...args);
}
function renderAppsScriptDeployUi(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.renderAppsScriptDeployUi(...args);
}
async function deployAppsScriptStubFromSettings(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.deployAppsScriptStubFromSettings(...args);
}
async function recheckAppsScriptPublicAccessFromSettings(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.recheckAppsScriptPublicAccessFromSettings(...args);
}

function initScraperSetupGuide() {
  return window.JobBoredApp.scraperAts.initScraperSetupGuide();
}

// Pipeline controller — extracted to pipeline-controller.js
function pipelineController() {
  return window.JobBoredApp.pipelineController;
}
function getPipelineData() {
  return pipelineController().getPipelineData();
}
function setPipelineData(data) {
  return pipelineController().setPipelineData(data);
}
function getPipelineRawRows() {
  return pipelineController().getPipelineRawRows();
}
function setPipelineRawRows(rows) {
  return pipelineController().setPipelineRawRows(rows);
}
function getCurrentSort() {
  return pipelineController().getCurrentSort();
}
function setCurrentSort(value) {
  return pipelineController().setCurrentSort(value);
}
function getCurrentSearch() {
  return pipelineController().getCurrentSearch();
}
function setCurrentSearch(value) {
  return pipelineController().setCurrentSearch(value);
}
function getFavoritesOnly() {
  return pipelineController().getFavoritesOnly();
}
function setFavoritesOnly(value) {
  return pipelineController().setFavoritesOnly(value);
}
function getShowDismissed() {
  return pipelineController().getShowDismissed();
}
function setShowDismissed(value) {
  return pipelineController().setShowDismissed(value);
}
function getActiveDetailKey() {
  return pipelineController().getActiveDetailKey();
}
function setActiveDetailKey(value) {
  return pipelineController().setActiveDetailKey(value);
}
function getViewedJobKeys() {
  return pipelineController().getViewedJobKeys();
}
function getExpandedJobKeys() {
  return pipelineController().getExpandedJobKeys();
}
function getExpandedStages() {
  return pipelineController().getExpandedStages();
}
function getStageOrder() {
  return pipelineController().getStageOrder();
}
function getStageArchive() {
  return pipelineController().getStageArchive();
}
function markJobViewed(stableKey) {
  return pipelineController().markJobViewed(stableKey);
}
function getPipelineViewFilters() {
  return pipelineController().getPipelineViewFilters();
}
function syncPipelineFilterControls() {
  return pipelineController().syncPipelineFilterControls();
}
function notifyPipelineFiltersChanged() {
  return pipelineController().notifyPipelineFiltersChanged();
}
function notifyPipelineRendered() {
  return pipelineController().notifyPipelineRendered();
}
function setPipelineViewFilters(nextFilters = {}) {
  return pipelineController().setPipelineViewFilters(nextFilters);
}
function applyPipelineStageWrite(jobKey, statusLabel) {
  return pipelineController().applyPipelineStageWrite(jobKey, statusLabel);
}
function applyPipelineNotesWrite(jobKey, body) {
  return pipelineController().applyPipelineNotesWrite(jobKey, body);
}

// Auth session — extracted to auth-session.js (JobBoredApp.auth)
function getAccessToken() {
  return window.JobBoredApp.auth.getAccessToken();
}
function getUserEmailFromAuth() {
  return window.JobBoredApp.auth.getUserEmail();
}
function getTokenExpiresAt() {
  return window.JobBoredApp.auth.getTokenExpiresAt();
}
function getGisLoaded() {
  return window.JobBoredApp.auth.getGisLoaded();
}
function getTokenClient() {
  return window.JobBoredApp.auth.getTokenClient();
}
function showToast(...args) {
  return window.JobBoredApp.auth.showToast(...args);
}
function canUseLocalStorage(...args) {
  return window.JobBoredApp.auth.canUseLocalStorage(...args);
}
function canUseSessionStorage(...args) {
  return window.JobBoredApp.auth.canUseSessionStorage(...args);
}
function applyOAuthClientChange(...args) {
  return window.JobBoredApp.auth.applyOAuthClientChange(...args);
}
function initAuth(...args) {
  return window.JobBoredApp.auth.initAuth(...args);
}
function handleTokenResponse(...args) {
  return window.JobBoredApp.auth.handleTokenResponse(...args);
}
function fetchUserEmail(...args) {
  return window.JobBoredApp.auth.fetchUserEmail(...args);
}
function signIn(...args) {
  return window.JobBoredApp.auth.signIn(...args);
}
function signOut(...args) {
  return window.JobBoredApp.auth.signOut(...args);
}
function setupAuthUI(...args) {
  return window.JobBoredApp.auth.setupAuthUI(...args);
}
function closeAuthUserMenu(...args) {
  return window.JobBoredApp.auth.closeAuthUserMenu(...args);
}
function isAuthUserMenuOpen(...args) {
  return window.JobBoredApp.auth.isAuthUserMenuOpen(...args);
}
function toggleAuthUserMenu(...args) {
  return window.JobBoredApp.auth.toggleAuthUserMenu(...args);
}
function initAuthUserMenu(...args) {
  return window.JobBoredApp.auth.initAuthUserMenu(...args);
}
async function installDoctor(...args) {
  return window.JobBoredApp.auth.installDoctor(...args);
}
async function installKeepAliveOnce(...args) {
  return window.JobBoredApp.auth.installKeepAliveOnce(...args);
}
async function refreshKeepAlivePill(...args) {
  return window.JobBoredApp.auth.refreshKeepAlivePill(...args);
}
async function refreshWorkerAutostartPill(...args) {
  return window.JobBoredApp.auth.refreshWorkerAutostartPill(...args);
}
async function toggleWorkerAutostart(...args) {
  return window.JobBoredApp.auth.toggleWorkerAutostart(...args);
}
function setAuthAvatarDisplay(...args) {
  return window.JobBoredApp.auth.setAuthAvatarDisplay(...args);
}
function updateAuthUI(...args) {
  return window.JobBoredApp.auth.updateAuthUI(...args);
}
function isSignedIn(...args) {
  return window.JobBoredApp.auth.isSignedIn(...args);
}
function persistOAuthSession(...args) {
  return window.JobBoredApp.auth.persistOAuthSession(...args);
}
function clearPersistedOAuthSession(...args) {
  return window.JobBoredApp.auth.clearPersistedOAuthSession(...args);
}
function clearPersistedRuntimeOAuthSession(...args) {
  return window.JobBoredApp.auth.clearPersistedRuntimeOAuthSession(...args);
}
function clearSessionAuthState(...args) {
  return window.JobBoredApp.auth.clearSessionAuthState(...args);
}
function loadPersistedOAuthSession(...args) {
  return window.JobBoredApp.auth.loadPersistedOAuthSession(...args);
}
function loadPersistedRuntimeOAuthSession(...args) {
  return window.JobBoredApp.auth.loadPersistedRuntimeOAuthSession(...args);
}
function refreshAccessTokenSilently(...args) {
  return window.JobBoredApp.auth.refreshAccessTokenSilently(...args);
}
function restoreOAuthSession(...args) {
  return window.JobBoredApp.auth.restoreOAuthSession(...args);
}
function normalizeOauthScopes(...args) {
  return window.JobBoredApp.auth.normalizeOauthScopes(...args);
}
function hasGrantedOauthScope(...args) {
  return window.JobBoredApp.auth.hasGrantedOauthScope(...args);
}

// ============================================
// SHEET ACCESS / SETUP — delegated to sheet-access-setup.js
// ============================================

function showSheetAccessGate(...args) {
  return window.JobBoredApp.setup.showSheetAccessGate(...args);
}

function recordSheetAccessError(...args) {
  return window.JobBoredApp.setup.recordSheetAccessError(...args);
}

function hideSheetAccessGate(...args) {
  return window.JobBoredApp.setup.hideSheetAccessGate(...args);
}

function revealPipelineSetupStepsScreen(...args) {
  return window.JobBoredApp.setup.revealPipelineSetupStepsScreen(...args);
}

function revealSetupScreenAfterAuth(...args) {
  return window.JobBoredApp.setup.revealSetupScreenAfterAuth(...args);
}

function revealDashboardShell(...args) {
  return window.JobBoredApp.setup.revealDashboardShell(...args);
}

function renderSetupStarterSheetUi(...args) {
  return window.JobBoredApp.setup.renderSetupStarterSheetUi(...args);
}

async function createBlankStarterSheet(...args) {
  return window.JobBoredApp.setup.createBlankStarterSheet(...args);
}

async function handleSetupCreateStarterSheet(...args) {
  return window.JobBoredApp.setup.handleSetupCreateStarterSheet(...args);
}

function setDashboardSheetLinks(...args) {
  return window.JobBoredApp.setup.setDashboardSheetLinks(...args);
}

// ============================================
// WRITE-BACK — delegated to sheets-writeback.js
// ============================================

function normalizeLeadUrlClient(...args) {
  return window.JobBoredApp.sheetsWrite.normalizeLeadUrlClient(...args);
}

async function updateSheetCell(...args) {
  return window.JobBoredApp.sheetsWrite.updateSheetCell(...args);
}

async function updateMultipleCells(...args) {
  return window.JobBoredApp.sheetsWrite.updateMultipleCells(...args);
}

async function sheetsBatchUpdate(...args) {
  return window.JobBoredApp.sheetsWrite.sheetsBatchUpdate(...args);
}

async function sheetsValuesAppend(...args) {
  return window.JobBoredApp.sheetsWrite.sheetsValuesAppend(...args);
}

async function sheetsValuesGet(...args) {
  return window.JobBoredApp.sheetsWrite.sheetsValuesGet(...args);
}

async function sheetsValuesUpdate(...args) {
  return window.JobBoredApp.sheetsWrite.sheetsValuesUpdate(...args);
}

async function ensureBlacklistTab(...args) {
  return window.JobBoredApp.sheetsWrite.ensureBlacklistTab(...args);
}

async function appendBlacklistRow(...args) {
  return window.JobBoredApp.sheetsWrite.appendBlacklistRow(...args);
}

async function deleteBlacklistRowByUrl(...args) {
  return window.JobBoredApp.sheetsWrite.deleteBlacklistRowByUrl(...args);
}

async function toggleFavorite(...args) {
  return window.JobBoredApp.sheetsWrite.toggleFavorite(...args);
}

async function dismissJob(...args) {
  return window.JobBoredApp.sheetsWrite.dismissJob(...args);
}

async function restoreJob(...args) {
  return window.JobBoredApp.sheetsWrite.restoreJob(...args);
}

async function markStatusExpired(...args) {
  return window.JobBoredApp.sheetsWrite.markStatusExpired(...args);
}

async function editJobField(...args) {
  return window.JobBoredApp.sheetsWrite.editJobField(...args);
}

function getSheetRow(...args) {
  return window.JobBoredApp.sheetsWrite.getSheetRow(...args);
}

function todayStr(...args) {
  return window.JobBoredApp.sheetsWrite.todayStr(...args);
}

function futureDateStr(...args) {
  return window.JobBoredApp.sheetsWrite.futureDateStr(...args);
}

function getStatusSideEffects(...args) {
  return window.JobBoredApp.sheetsWrite.getStatusSideEffects(...args);
}

function emitPipelineMoveSucceeded(...args) {
  return window.JobBoredApp.sheetsWrite.emitPipelineMoveSucceeded(...args);
}

async function updateJobStatus(...args) {
  return window.JobBoredApp.sheetsWrite.updateJobStatus(...args);
}

async function updateJobNotes(...args) {
  return window.JobBoredApp.sheetsWrite.updateJobNotes(...args);
}

async function updateFollowUpDate(...args) {
  return window.JobBoredApp.sheetsWrite.updateFollowUpDate(...args);
}

async function updateLastHeardFrom(...args) {
  return window.JobBoredApp.sheetsWrite.updateLastHeardFrom(...args);
}

async function updateJobResponseFlag(...args) {
  return window.JobBoredApp.sheetsWrite.updateJobResponseFlag(...args);
}



function generateDiscoveryVariationKey(...args) {
  return window.JobBoredDiscovery.runOrchestration.generateDiscoveryVariationKey(...args);
}

function getDiscoveryRunWebhookUrlCandidates(...args) {
  return window.JobBoredDiscovery.runOrchestration.getDiscoveryRunWebhookUrlCandidates(...args);
}

function isLocalWebhookCandidateUrl(...args) {
  return window.JobBoredDiscovery.runOrchestration.isLocalWebhookCandidateUrl(...args);
}

function getDiscoveryRunWebhookCandidateProbe(...args) {
  return window.JobBoredDiscovery.runOrchestration.getDiscoveryRunWebhookCandidateProbe(...args);
}

async function scoreDiscoveryRunWebhookCandidates(...args) {
  return window.JobBoredDiscovery.runOrchestration.scoreDiscoveryRunWebhookCandidates(...args);
}

async function resolveDiscoveryRunWebhookUrl(...args) {
  return window.JobBoredDiscovery.runOrchestration.resolveDiscoveryRunWebhookUrl(...args);
}

async function ensureLocalDiscoveryAutoSetupForRun(...args) {
  return window.JobBoredDiscovery.runOrchestration.ensureLocalDiscoveryAutoSetupForRun(...args);
}

/** Notify automation (Hermes, n8n, etc.) to run another discovery pass (varied query). */
async function triggerDiscoveryRun(...args) {
  return window.JobBoredDiscovery.runOrchestration.triggerDiscoveryRun(...args);
}

// Thin delegating wrappers for wizard functions that now live in
// discovery-wizard-ui.js but are still called by bare name from app.js code
// that stays here. Each preserves one external call site without rewiring it:
//   getDiscoveryWizardRecommendedFlow -> openSettingsForDiscoveryWebhook
//   renderDiscoverySetupWizard        -> refreshDiscoveryUiState
//   openDiscoverySetupWizard          -> requestDiscoverySetup (+ keeps the
//                                        async(options) entry-point symbol)
//   setDiscoveryWizardMessage         -> ensureLocalDiscoveryAutoSetupForRun
function getDiscoveryWizardRecommendedFlow(...args) {
  return window.JobBoredDiscoveryWizard.ui.getDiscoveryWizardRecommendedFlow(
    ...args,
  );
}
function renderDiscoverySetupWizard(...args) {
  return window.JobBoredDiscoveryWizard.ui.renderDiscoverySetupWizard(...args);
}
async function openDiscoverySetupWizard(options = {}) {
  return window.JobBoredDiscoveryWizard.ui.openSetupWizard(options);
}
function setDiscoveryWizardMessage(...args) {
  return window.JobBoredDiscoveryWizard.ui.setDiscoveryWizardMessage(...args);
}

// --- Go-live wizard (extracted to go-live-wizard-ui.js) -------------------
// Bare-name forwarders so app.js can register these on the bridge host
// without importing the IIFE-published namespace directly.
async function openGoLiveSetupWizard(options = {}) {
  return window.JobBoredGoLive.openGoLiveSetupWizard(options);
}
async function requestGoLiveSetup(options = {}) {
  return window.JobBoredGoLive.requestGoLiveSetup(options);
}

// --- Optional enhancements wizard (extracted to enhancements-wizard-ui.js) ---
// Bare-name forwarders so app.js can register these on the bridge host
// without importing the IIFE-published namespace directly.
function requestEnhancementsSetup(options) {
  const mod = typeof window !== "undefined" && window.JobBoredEnhancements;
  if (mod && typeof mod.requestEnhancementsSetup === "function") {
    return mod.requestEnhancementsSetup(options);
  }
  return Promise.resolve({ deferred: true });
}
function openDrawerToSubtab(subtab, focusFieldId) {
  const adapters =
    typeof window !== "undefined" && window.JobBoredSettingsDiscoveryAdapters;
  if (adapters && typeof adapters.openDrawerToSubtab === "function") {
    return adapters.openDrawerToSubtab(subtab, focusFieldId);
  }
  const fn = typeof window !== "undefined" && window.openDiscoveryDrawer;
  if (typeof fn === "function") fn();
}
function setActiveSettingsTab(tabId, opts) {
  const tabs = typeof window !== "undefined" && window.JobBoredSettingsTabs;
  if (tabs && typeof tabs.setActiveSettingsTab === "function") {
    return tabs.setActiveSettingsTab(tabId, opts);
  }
}

// --- Discovery setup modals (extracted to discovery-setup-modals.js) ---
async function testDiscoveryWebhookFromSettings(...args) {
  return window.JobBoredDiscovery.setupModals.testDiscoveryWebhookFromSettings(
    ...args,
  );
}
function openDiscoveryPathsModal(...args) {
  return window.JobBoredDiscovery.setupModals.openDiscoveryPathsModal(...args);
}
function closeDiscoveryPathsModal(...args) {
  return window.JobBoredDiscovery.setupModals.closeDiscoveryPathsModal(...args);
}
function openDiscoverySetupGuideModal(...args) {
  return window.JobBoredDiscovery.setupModals.openDiscoverySetupGuideModal(
    ...args,
  );
}
function closeDiscoverySetupGuideModal(...args) {
  return window.JobBoredDiscovery.setupModals.closeDiscoverySetupGuideModal(
    ...args,
  );
}
function renderDiscoveryLocalTunnelSetupUi(...args) {
  return window.JobBoredDiscovery.setupModals.renderDiscoveryLocalTunnelSetupUi(
    ...args,
  );
}
function populateDiscoveryLocalTunnelModal(...args) {
  return window.JobBoredDiscovery.setupModals.populateDiscoveryLocalTunnelModal(
    ...args,
  );
}
async function openDiscoveryLocalTunnelModal(...args) {
  return window.JobBoredDiscovery.setupModals.openDiscoveryLocalTunnelModal(
    ...args,
  );
}
async function probeNgrokFromLocalApi(...args) {
  return window.JobBoredDiscovery.setupModals.probeNgrokFromLocalApi(...args);
}
async function probeAndShowTunnelStaleBanner(...args) {
  return window.JobBoredDiscovery.setupModals.probeAndShowTunnelStaleBanner(
    ...args,
  );
}
function closeDiscoveryLocalTunnelModal(...args) {
  return window.JobBoredDiscovery.setupModals.closeDiscoveryLocalTunnelModal(
    ...args,
  );
}
async function probeTunnelStaleBadge(...args) {
  return window.JobBoredDiscovery.setupModals.probeTunnelStaleBadge(...args);
}
function saveDiscoveryLocalTunnelSetup(...args) {
  return window.JobBoredDiscovery.setupModals.saveDiscoveryLocalTunnelSetup(
    ...args,
  );
}
function populateCloudflareRelaySetupModal(...args) {
  return window.JobBoredDiscovery.setupModals.populateCloudflareRelaySetupModal(
    ...args,
  );
}
async function openCloudflareRelaySetupModal(...args) {
  return window.JobBoredDiscovery.setupModals.openCloudflareRelaySetupModal(
    ...args,
  );
}
function closeCloudflareRelaySetupModal(...args) {
  return window.JobBoredDiscovery.setupModals.closeCloudflareRelaySetupModal(
    ...args,
  );
}
async function openCloudflareRelaySetupFromAppsScriptFailure(...args) {
  return window.JobBoredDiscovery.setupModals.openCloudflareRelaySetupFromAppsScriptFailure(
    ...args,
  );
}
async function applyCloudflareRelayWorkerUrl(...args) {
  return window.JobBoredDiscovery.setupModals.applyCloudflareRelayWorkerUrl(
    ...args,
  );
}
async function handleAppsScriptBrowserCorsFailure(...args) {
  return window.JobBoredDiscovery.setupModals.handleAppsScriptBrowserCorsFailure(
    ...args,
  );
}
function initDiscoverySetupGuide(...args) {
  return window.JobBoredDiscovery.setupModals.initDiscoverySetupGuide(...args);
}

function init(...args) {
  return window.JobBoredApp.bootstrap.init(...args);
}

// Discovery drawer — thin wrappers (implementation in discovery-drawer.js)
function normalizeSourcePreset(raw) {
  return window.JobBoredDiscovery.drawer.normalizeSourcePreset(raw);
}

function syncSourcePresetUi(preset) {
  return window.JobBoredDiscovery.drawer.syncSourcePresetUi(preset);
}

function getEffectiveFitProfileFields() {
  return window.JobBoredDiscovery.drawer.getEffectiveFitProfileFields();
}

function openDiscoveryDrawer(options) {
  return window.JobBoredDiscovery.drawer.openDiscoveryDrawer(options);
}

function closeDiscoveryDrawer() {
  return window.JobBoredDiscovery.drawer.closeDiscoveryDrawer();
}

function isDiscoveryDrawerOpen() {
  return window.JobBoredDiscovery.drawer.isDiscoveryDrawerOpen();
}

function initDiscoveryDrawer() {
  return window.JobBoredDiscovery.drawer.initDiscoveryDrawer();
}

function initDiscoverySubtabs() {
  return window.JobBoredDiscovery.drawer.initDiscoverySubtabs();
}

function initDiscoveryButton() {
  return window.JobBoredDiscovery.drawer.initDiscoveryButton();
}

async function warnDiscoverySourceReadinessBeforeRun() {
  return window.JobBoredDiscovery.drawer.warnDiscoverySourceReadinessBeforeRun();
}

async function refreshDiscoveryDrawerSourceReadiness() {
  return window.JobBoredDiscovery.drawer.refreshDiscoveryDrawerSourceReadiness();
}

async function generateDiscoverySuggestions(scrapedJob) {
  return window.JobBoredDiscovery.drawer.generateDiscoverySuggestions(scrapedJob);
}

function normalizeStratum(raw) {
  return window.JobBoredDiscovery.drawer.normalizeStratum(raw);
}

function applyStratumToDrawer(stratum) {
  return window.JobBoredDiscovery.drawer.applyStratumToDrawer(stratum);
}

function sanitizeCompanyEntries(arr) {
  return window.JobBoredDiscovery.drawer.sanitizeCompanyEntries(arr);
}



// ============================================
// INGEST URL — delegated to ingest-url-flow.js
// ============================================

function isParseableUrl(...args) {
  return window.JobBoredDiscovery.ingestUrlFlow.isParseableUrl(...args);
}
async function ingestJobUrl(...args) {
  return window.JobBoredDiscovery.ingestUrlFlow.ingestJobUrl(...args);
}
function initIngestUrlFlow(...args) {
  return window.JobBoredDiscovery.ingestUrlFlow.initIngestUrlFlow(...args);
}
