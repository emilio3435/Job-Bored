import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
  "utf8",
);

// ============================================================
// Tests: Clear Settings Boundary (code verification)
// ============================================================

describe("Clear settings boundary", () => {
  it("performSettingsClearOverrides clears localStorage and IndexedDB user content", () => {
    // "Clear settings" is documented as a full greenfield reset: it wipes
    // localStorage breadcrumbs AND the IndexedDB user-content DB so a
    // returning user starts from a clean slate. Tests previously asserted
    // the opposite; the boundary moved deliberately when greenfield reset
    // semantics were locked in.
    const clearStart = appJs.indexOf("function performSettingsClearOverrides");
    const clearEnd = appJs.indexOf("function initCommandCenterSettings", clearStart);
    const clearBody = appJs.slice(clearStart, clearEnd);

    assert.ok(
      clearBody.includes("localStorage.removeItem"),
      "performSettingsClearOverrides should use localStorage.removeItem",
    );
    assert.ok(
      clearBody.includes("deleteDatabase"),
      "performSettingsClearOverrides should drop the IndexedDB user-content DB on greenfield reset",
    );
  });

  it("config overrides use localStorage, not IndexedDB", () => {
    const configStart = appJs.indexOf("function readStoredConfigOverrides");
    const configEnd = appJs.indexOf("function applyStoredConfigOverrides");
    const configBody = appJs.slice(configStart, configEnd);

    assert.ok(
      configBody.includes("localStorage.getItem"),
      "readStoredConfigOverrides should use localStorage",
    );
    assert.ok(
      !configBody.includes("indexedDB"),
      "readStoredConfigOverrides should NOT use IndexedDB",
    );
  });
});

// ============================================================
// Tests: Onboarding Reset Preserves Data
// ============================================================

describe("Onboarding reset preserves data", () => {
  it("resetOnboardingCompletion does NOT clear resume data", () => {
    const resetFnStart = userContentStoreJs.indexOf(
      "async function resetOnboardingCompletion",
    );
    assert.ok(
      resetFnStart !== -1,
      "resetOnboardingCompletion function should exist",
    );

    // Find the function body by counting braces
    let braceCount = 0;
    let fnStart = userContentStoreJs.indexOf("{", resetFnStart);
    let fnEnd = fnStart;
    for (let i = fnStart; i < userContentStoreJs.length; i++) {
      if (userContentStoreJs[i] === "{") braceCount++;
      if (userContentStoreJs[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          fnEnd = i;
          break;
        }
      }
    }
    const resetFnBody = userContentStoreJs.slice(resetFnStart, fnEnd + 1);

    // Should NOT contain deleteResume, clearAllResumes, etc.
    assert.ok(
      !resetFnBody.includes("deleteResume") &&
        !resetFnBody.includes("clearAllResumes") &&
        !resetFnBody.includes("deleteWritingSample") &&
        !resetFnBody.includes("clearAdditionalContext") &&
        !resetFnBody.includes("clearLinkedInProfile") &&
        !resetFnBody.includes("deleteGeneratedDraft"),
      "resetOnboardingCompletion should not delete any profile data",
    );

    // Should contain setSetting
    assert.ok(
      resetFnBody.includes("setSetting"),
      "resetOnboardingCompletion should call setSetting to set flag to false",
    );
  });

  it("setPrimaryResume replaces existing primary resume, not append", () => {
    const setFnStart = userContentStoreJs.indexOf(
      "async function setPrimaryResume",
    );
    assert.ok(setFnStart !== -1, "setPrimaryResume function should exist");

    // Find the function body
    let braceCount = 0;
    let fnStart = userContentStoreJs.indexOf("{", setFnStart);
    let fnEnd = fnStart;
    for (let i = fnStart; i < userContentStoreJs.length; i++) {
      if (userContentStoreJs[i] === "{") braceCount++;
      if (userContentStoreJs[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          fnEnd = i;
          break;
        }
      }
    }
    const fnBody = userContentStoreJs.slice(setFnStart, fnEnd + 1);

    // Should call clearAllResumes before putResume
    assert.ok(
      fnBody.includes("clearAllResumes"),
      "setPrimaryResume should call clearAllResumes to ensure single primary",
    );
    assert.ok(
      fnBody.includes("putResume"),
      "setPrimaryResume should call putResume to save the new primary",
    );
  });

  it("profileResetWizardBtn handler preserves data before showing wizard", () => {
    const resetHandlerStart = appJs.indexOf(
      'profileResetWizardBtn.addEventListener("click"',
    );
    assert.ok(
      resetHandlerStart !== -1,
      "profileResetWizardBtn click handler should exist",
    );

    // Find the handler body
    const handlerEnd = appJs.indexOf(
      "});",
      resetHandlerStart,
    );
    const handlerBody = appJs.slice(resetHandlerStart, handlerEnd + 3);

    // Should call resetOnboardingCompletion
    assert.ok(
      handlerBody.includes("resetOnboardingCompletion"),
      "Handler should call resetOnboardingCompletion",
    );

    // Should NOT call any delete/clear functions
    assert.ok(
      !handlerBody.includes("deleteResume") &&
        !handlerBody.includes("clearAllResumes") &&
        !handlerBody.includes("deleteWritingSample") &&
        !handlerBody.includes("clearLinkedInProfile") &&
        !handlerBody.includes("clearAdditionalContext"),
      "Handler should NOT delete any profile data",
    );
  });

  it("confirm dialog text mentions data is preserved", () => {
    const resetHandlerStart = appJs.indexOf(
      'profileResetWizardBtn.addEventListener("click"',
    );
    const handlerEnd = appJs.indexOf("});", resetHandlerStart);
    const handlerBody = appJs.slice(resetHandlerStart, handlerEnd + 3);

    assert.ok(
      handlerBody.includes("Your resume and profile stay saved"),
      "Confirm dialog should mention that data is preserved",
    );
  });
});

// ============================================================
// Tests: Profile Source Minimums
// ============================================================

describe("Profile source minimums for generation", () => {
  it("resume generation requires at least one profile source", () => {
    const genStart = appJs.indexOf("async function runResumeGeneration");
    const genEnd = appJs.indexOf(
      "async function openResumeGenerateModal",
      genStart,
    );
    const genBody = appJs.slice(genStart, genEnd);

    // Should check hasResume, hasLinkedIn, hasAdditional
    assert.ok(
      genBody.includes("hasResume") &&
        genBody.includes("hasLinkedIn") &&
        genBody.includes("hasAdditional"),
      "runResumeGeneration should check all three profile sources",
    );

    // Should check if ALL are false before showing error
    const gatingStart = genBody.indexOf("hasAdditional");
    const gatingEnd = genBody.indexOf("showToast", gatingStart);
    const gatingBlock = genBody.slice(gatingStart, gatingEnd);

    assert.ok(
      gatingBlock.includes("!hasResume && !hasLinkedIn && !hasAdditional"),
      "Should require at least one profile source (hasResume || hasLinkedIn || hasAdditional)",
    );

    // Should open materials modal for recovery
    assert.ok(
      genBody.includes("openMaterialsModal"),
      "Should offer recovery path by opening materials modal",
    );
  });

  it("LinkedIn and AI context have independent save/clear functions", () => {
    // Verify LinkedIn functions exist
    assert.ok(
      userContentStoreJs.includes("async function saveLinkedInProfile"),
      "saveLinkedInProfile should exist",
    );
    assert.ok(
      userContentStoreJs.includes("async function clearLinkedInProfile"),
      "clearLinkedInProfile should exist",
    );
    assert.ok(
      userContentStoreJs.includes("async function getLinkedInProfile"),
      "getLinkedInProfile should exist",
    );

    // Verify AI context functions exist
    assert.ok(
      userContentStoreJs.includes("async function saveAdditionalContext"),
      "saveAdditionalContext should exist",
    );
    assert.ok(
      userContentStoreJs.includes("async function clearAdditionalContext"),
      "clearAdditionalContext should exist",
    );
    assert.ok(
      userContentStoreJs.includes("async function getAdditionalContext"),
      "getAdditionalContext should exist",
    );
  });

  it("clearLinkedInProfile only clears LinkedIn, not resume or samples", () => {
    const clearFnStart = userContentStoreJs.indexOf(
      "async function clearLinkedInProfile",
    );
    const clearFnEnd = userContentStoreJs.indexOf(
      "}",
      userContentStoreJs.indexOf("}", clearFnStart) + 1,
    );
    const clearFnBody = userContentStoreJs.slice(
      clearFnStart,
      clearFnEnd + 1,
    );

    assert.ok(
      clearFnBody.includes("setSetting"),
      "clearLinkedInProfile should call setSetting",
    );
    assert.ok(
      !clearFnBody.includes("deleteResume") &&
        !clearFnBody.includes("clearAllResumes") &&
        !clearFnBody.includes("deleteWritingSample"),
      "clearLinkedInProfile should NOT clear other profile data",
    );
  });

  it("clearAdditionalContext only clears AI context, not resume or samples", () => {
    const clearFnStart = userContentStoreJs.indexOf(
      "async function clearAdditionalContext",
    );
    const clearFnEnd = userContentStoreJs.indexOf(
      "}",
      userContentStoreJs.indexOf("}", clearFnStart) + 1,
    );
    const clearFnBody = userContentStoreJs.slice(
      clearFnStart,
      clearFnEnd + 1,
    );

    assert.ok(
      clearFnBody.includes("setSetting"),
      "clearAdditionalContext should call setSetting",
    );
    assert.ok(
      !clearFnBody.includes("deleteResume") &&
        !clearFnBody.includes("clearAllResumes") &&
        !clearFnBody.includes("deleteWritingSample"),
      "clearAdditionalContext should NOT clear other profile data",
    );
  });
});

// ============================================================
// Tests: Resume Capture Validation
// ============================================================

describe("Resume capture validation", () => {
  it("onboarding step 2 requires resume before advancing", () => {
    const fnStart = appJs.indexOf("function updateOnboardingContinue2Enabled");
    const fnEnd = appJs.indexOf("}", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd + 1);

    assert.ok(
      fnBody.includes("btn.disabled = !hasDraft"),
      "Button should be disabled when no resume draft",
    );
    assert.ok(
      fnBody.includes("onboardingResumeDraft") &&
        fnBody.includes("extractedText"),
      "Should check onboardingResumeDraft and its extractedText",
    );
  });

  it("onboarding step 3 requires paste or draft before advancing", () => {
    const fnStart = appJs.indexOf("function updateOnboardingNext3Enabled");
    const fnEnd = appJs.indexOf("}", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd + 1);

    assert.ok(
      fnBody.includes("onboardingResumeDraft") &&
        fnBody.includes("pasteText"),
      "Should check both draft and paste text",
    );

    assert.ok(
      fnBody.includes("!hasDraft && !pasteText"),
      "Button should be disabled when both draft and paste are empty",
    );
  });

  it("ensureResumeDraftFromPasteStep shows error for empty paste", () => {
    const fnStart = appJs.indexOf("function ensureResumeDraftFromPasteStep");
    const fnEnd = appJs.indexOf("function initOnboardingWizard", fnStart);
    const fnBody = appJs.slice(fnStart, fnEnd);

    assert.ok(
      fnBody.includes('status.textContent = "Paste your resume to continue."'),
      "Should show error message for empty paste",
    );
    assert.ok(
      fnBody.includes('onboarding-status--error'),
      "Should apply error styling",
    );
  });

  it("onboarding NEXT buttons are gated by valid input", () => {
    // Verify step navigation requires valid input
    // The Continue2 button handler validates resume before advancing
    // We need to search within initOnboardingWizard function to find the correct handler
    const initStart = appJs.indexOf("function initOnboardingWizard");
    const initEnd = appJs.indexOf("function initResumeMaterialsFeature");
    const initBody = appJs.slice(initStart, initEnd);

    const continue2Start = initBody.indexOf('getElementById("onboardingContinue2")');
    const clickHandlerStart = initBody.indexOf("?.addEventListener", continue2Start);
    const continue2End = initBody.indexOf("});", clickHandlerStart);
    const continue2Body = initBody.slice(clickHandlerStart, continue2End + 3);

    // Should validate that onboardingResumeDraft and extractedText exist
    assert.ok(
      continue2Body.includes("onboardingResumeDraft") &&
        continue2Body.includes("extractedText"),
      "Continue2 should validate resume draft exists and has text",
    );
  });
});

// ============================================================
// Tests: Onboarding Gate
// ============================================================

describe("Onboarding gate behavior", () => {
  it("checkOnboardingGate shows wizard only when onboarding is incomplete", () => {
    const fnStart = appJs.indexOf("async function checkOnboardingGate");
    const fnEnd = appJs.indexOf("function ensureResumeDraftFromPasteStep");
    const fnBody = appJs.slice(fnStart, fnEnd);

    assert.ok(
      fnBody.includes("migrateOnboardingState"),
      "Should migrate onboarding state first",
    );
    assert.ok(
      fnBody.includes("isOnboardingComplete()"),
      "Should check if onboarding is complete",
    );
    assert.ok(
      fnBody.includes("showOnboardingWizard"),
      "Should show wizard if not complete",
    );

    // Verify the flow: if isOnboardingComplete then return, else showOnboardingWizard
    // This means showOnboardingWizard comes AFTER the return statement
    const returnIdx = fnBody.indexOf("return");
    const showIdx = fnBody.indexOf("showOnboardingWizard");
    assert.ok(
      returnIdx !== -1 && showIdx !== -1 && returnIdx < showIdx,
      "showOnboardingWizard should come after the early return (meaning it only shows when NOT complete)",
    );
  });

  it("onboarding is checked after access is resolved", () => {
    const bootstrapStart = appJs.indexOf(
      "function runPostAccessBootstrapOnce",
    );
    const bootstrapEnd = appJs.indexOf("}", appJs.indexOf("{", bootstrapStart) + 1);
    const bootstrapBody = appJs.slice(bootstrapStart, bootstrapEnd + 1);

    assert.ok(
      bootstrapBody.includes("checkOnboardingGate"),
      "runPostAccessBootstrapOnce should call checkOnboardingGate",
    );
  });
});

// ============================================================
// Tests: UserContent Store API Existence
// ============================================================

describe("UserContent Store API surface", () => {
  it("exposes all required functions for profile persistence", () => {
    // These are verified by checking the source code exists
    const requiredFunctions = [
      "setPrimaryResume",
      "isOnboardingComplete",
      "completeOnboarding",
      "resetOnboardingCompletion",
      "getActiveResume",
      "listResumes",
      "addWritingSample",
      "listWritingSamples",
      "deleteWritingSample",
      "saveLinkedInProfile",
      "getLinkedInProfile",
      "clearLinkedInProfile",
      "saveAdditionalContext",
      "getAdditionalContext",
      "clearAdditionalContext",
      "getPreferences",
      "savePreferences",
      "saveGeneratedDraft",
      "listGeneratedDrafts",
    ];

    for (const fn of requiredFunctions) {
      assert.ok(
        userContentStoreJs.includes(`async function ${fn}`) ||
          userContentStoreJs.includes(`function ${fn}`),
        `${fn} should exist in user-content-store.js`,
      );
    }
  });

  it("has correct DEFAULT_PREFERENCES structure", () => {
    const prefsStart = userContentStoreJs.indexOf("DEFAULT_PREFERENCES");
    const prefsEnd = userContentStoreJs.indexOf(";", prefsStart);
    const prefsBlock = userContentStoreJs.slice(prefsStart, prefsEnd);

    assert.ok(prefsBlock.includes('tone: "warm"'));
    assert.ok(prefsBlock.includes("defaultMaxWords: 350"));
    assert.ok(prefsBlock.includes("profileMergePreference"));
  });

  it("PRIMARY_RESUME_ID is defined", () => {
    assert.ok(
      userContentStoreJs.includes('const PRIMARY_RESUME_ID = "__primary__"'),
      "PRIMARY_RESUME_ID should be defined",
    );
  });
});
