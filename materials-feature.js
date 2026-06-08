/* ============================================
   COMMAND CENTER v2 — Materials Feature Wiring
   Extracted from app.js (materials-feature cut).

   Classic-global IIFE under window.JobBoredApp.materials — NOT an ES module.
   Loaded AFTER onboarding-wizard.js, BEFORE app.js. Reads app.js helpers via
   lazy core.host; profileMaterials, resumeGeneration, and materialsState via
   module accessors.

   Owns initResumeMaterialsFeature: materials modal/file listeners, LinkedIn and
   AI context save handlers, preferences save, Escape-key modal stack, and
   onboarding wizard init kickoff.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const materials = root.materials || (root.materials = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function profileMaterialsMod() {
    return window.JobBoredApp.profileMaterials;
  }

  function resumeGenerationMod() {
    return window.JobBoredApp.resumeGeneration;
  }

  function materialsStateMod() {
    return window.JobBoredApp.materialsState;
  }

  function onboardingMod() {
    return window.JobBoredApp.onboarding;
  }

  function firstRunWizardMod() {
    return window.JobBoredApp.firstRunWizard;
  }

  function getUserContent() {
    return materialsStateMod().getUserContent();
  }

  function getResumeIngest() {
    return materialsStateMod().getResumeIngest();
  }

  function scheduleGeneratedDraftLibraryRefresh(...args) {
    return materialsStateMod().scheduleGeneratedDraftLibraryRefresh(...args);
  }

  function scheduleCandidateProfileMatchRefresh(shouldRender) {
    return window.JobBoredApp.keywordMatch.scheduleCandidateProfileMatchRefresh(
      shouldRender,
    );
  }

  function showToast(...args) {
    return host().showToast(...args);
  }

  function closeAuthUserMenu(...args) {
    return host().closeAuthUserMenu(...args);
  }

  function closeCommandCenterSettingsModal(...args) {
    return host().closeCommandCenterSettingsModal(...args);
  }

  function isAuthUserMenuOpen(...args) {
    return host().isAuthUserMenuOpen(...args);
  }

  function closeScraperSetupModal(...args) {
    return host().closeScraperSetupModal(...args);
  }

  function hideSettingsClearConfirmBar(...args) {
    return host().hideSettingsClearConfirmBar(...args);
  }

  function openMaterialsModal(...args) {
    return profileMaterialsMod().openMaterialsModal(...args);
  }

  function closeMaterialsModal(...args) {
    return profileMaterialsMod().closeMaterialsModal(...args);
  }

  function profileApplyResumeFile(...args) {
    return profileMaterialsMod().profileApplyResumeFile(...args);
  }

  function profileApplySampleFiles(...args) {
    return profileMaterialsMod().profileApplySampleFiles(...args);
  }

  function bindProfileDropzone(...args) {
    return profileMaterialsMod().bindProfileDropzone(...args);
  }

  function renderLinkedInProfileMeta(...args) {
    return profileMaterialsMod().renderLinkedInProfileMeta(...args);
  }

  function renderAdditionalContextMeta(...args) {
    return profileMaterialsMod().renderAdditionalContextMeta(...args);
  }

  function normalizeProfileTextInput(...args) {
    return profileMaterialsMod().normalizeProfileTextInput(...args);
  }

  function openLinkedInCaptureModal(...args) {
    return profileMaterialsMod().openLinkedInCaptureModal(...args);
  }

  function closeLinkedInCaptureModal(...args) {
    return profileMaterialsMod().closeLinkedInCaptureModal(...args);
  }

  function updateLinkedInCapturePreview(...args) {
    return profileMaterialsMod().updateLinkedInCapturePreview(...args);
  }

  function getLinkedInCaptureCompleteness(...args) {
    return profileMaterialsMod().getLinkedInCaptureCompleteness(...args);
  }

  function buildLinkedInCaptureProfileText(...args) {
    return profileMaterialsMod().buildLinkedInCaptureProfileText(...args);
  }

  function refreshMaterialsUI(...args) {
    return profileMaterialsMod().refreshMaterialsUI(...args);
  }

  function closeDraftNotesModal(...args) {
    return resumeGenerationMod().closeDraftNotesModal(...args);
  }

  function closeResumeGenerateModal(...args) {
    return resumeGenerationMod().closeResumeGenerateModal(...args);
  }

  function isOnboardingWizardVisible(...args) {
    return onboardingMod().isOnboardingWizardVisible(...args);
  }

  function showOnboardingWizard(...args) {
    return onboardingMod().showOnboardingWizard(...args);
  }

  function initOnboardingWizard(...args) {
    return onboardingMod().initOnboardingWizard(...args);
  }

  function initResumeMaterialsFeature() {
  const UC = getUserContent();
  if (!UC) return;

  UC.openDb().catch((e) => console.warn("[JobBored] User content DB:", e));
  scheduleCandidateProfileMatchRefresh(true);
  scheduleGeneratedDraftLibraryRefresh(true);

  const materialsBtn = document.getElementById("materialsBtn");
  const materialsModal = document.getElementById("materialsModal");
  const materialsClose = document.getElementById("materialsModalClose");
  const materialsCloseX = document.getElementById("materialsModalCloseX");
  const profileResetWizardBtn = document.getElementById(
    "profileResetWizardBtn",
  );
  const fileInput = document.getElementById("materialsFileInput");
  const samplesFileInput = document.getElementById("materialsSamplesFileInput");
  const profileResumeBrowseBtn = document.getElementById(
    "profileResumeBrowseBtn",
  );
  const profileSamplesBrowseBtn = document.getElementById(
    "profileSamplesBrowseBtn",
  );
  const profileResumeDropzone = document.getElementById(
    "profileResumeDropzone",
  );
  const profileSamplesDropzone = document.getElementById(
    "profileSamplesDropzone",
  );
  const pasteBtn = document.getElementById("materialsPasteBtn");
  const linkedInAssistBtn = document.getElementById(
    "materialsLinkedInAssistBtn",
  );
  const linkedInSaveBtn = document.getElementById("materialsLinkedInSaveBtn");
  const linkedInClearBtn = document.getElementById("materialsLinkedInClearBtn");
  const linkedInTextEl = document.getElementById("materialsLinkedInText");
  const linkedInMetaEl = document.getElementById("materialsLinkedInMeta");
  const aiDumpTextEl = document.getElementById("materialsAiDumpText");
  const aiDumpMetaEl = document.getElementById("materialsAiDumpMeta");
  const aiDumpFileEl = document.getElementById("materialsAiDumpFile");
  const aiDumpSaveBtn = document.getElementById("materialsAiDumpSaveBtn");
  const aiDumpClearBtn = document.getElementById("materialsAiDumpClearBtn");
  const aiDumpCopyPromptBtn = document.getElementById(
    "materialsAiDumpCopyPromptBtn",
  );
  const aiDumpPromptEl = document.getElementById("materialsAiDumpPrompt");
  const linkedInCaptureModal = document.getElementById("linkedInCaptureModal");
  const linkedInCaptureClose = document.getElementById("linkedInCaptureClose");
  const linkedInCaptureCloseX = document.getElementById(
    "linkedInCaptureCloseX",
  );
  const linkedInCaptureSaveBtn = document.getElementById(
    "linkedInCaptureSaveBtn",
  );
  const sampleAddBtn = document.getElementById("sampleAddBtn");
  const savePrefsBtn = document.getElementById("materialsSavePrefsBtn");

  if (materialsBtn) {
    materialsBtn.addEventListener("click", () => openMaterialsModal());
  }
  if (materialsModal) {
    materialsModal.addEventListener("click", (e) => {
      if (e.target === materialsModal) closeMaterialsModal();
    });
  }
  if (materialsClose)
    materialsClose.addEventListener("click", closeMaterialsModal);
  if (materialsCloseX)
    materialsCloseX.addEventListener("click", closeMaterialsModal);

  if (profileResetWizardBtn) {
    profileResetWizardBtn.addEventListener("click", async () => {
      const ok = window.confirm(
        "Start the setup wizard again? Your resume and profile stay saved until you finish the new flow.",
      );
      if (!ok) return;
      if (!UC) return;
      try {
        await UC.openDb();
        await UC.resetOnboardingCompletion();
        closeMaterialsModal();
        closeCommandCenterSettingsModal();
        closeAuthUserMenu();
        // The first-run wizard sits at a higher z-index (100001 vs 100000);
        // left open it buries the onboarding wizard and the click looks dead.
        const frw = firstRunWizardMod();
        if (frw && typeof frw.hideFirstRunWizard === "function") {
          frw.hideFirstRunWizard();
        }
        showOnboardingWizard();
        showToast("Continue the steps below to finish setup.", "info");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not reset wizard", "error");
      }
    });
  }

  const infraResetWizardBtn = document.getElementById("infraResetWizardBtn");
  if (infraResetWizardBtn) {
    infraResetWizardBtn.addEventListener("click", async () => {
      const ok = window.confirm(
        "Run the setup wizard again? Your connected Sheet, keys, and provider choice stay saved.",
      );
      if (!ok) return;
      if (!UC) return;
      try {
        await UC.openDb();
        await UC.resetInfraSetupCompletion();
        closeMaterialsModal();
        closeCommandCenterSettingsModal();
        closeAuthUserMenu();
        // Mirror of the profile-reset path: never stack the two wizards.
        const ob = onboardingMod();
        if (ob && typeof ob.hideOnboardingWizard === "function") {
          ob.hideOnboardingWizard();
        }
        const frw = firstRunWizardMod();
        if (frw && typeof frw.reopenFirstRunWizard === "function") {
          frw.reopenFirstRunWizard();
        }
        showToast("Setup wizard reopened. Your saved config is preserved.", "info");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not reopen setup wizard", "error");
      }
    });
  }

  const settingsDiscoverySetupBtn = document.getElementById(
    "settingsDiscoverySetupBtn",
  );
  if (settingsDiscoverySetupBtn) {
    settingsDiscoverySetupBtn.addEventListener("click", () => {
      closeCommandCenterSettingsModal();
      if (typeof window.requestDiscoverySetup === "function") {
        void window.requestDiscoverySetup({
          entryPoint: "settings",
          allowWhileOnboarding: true,
        });
      }
    });
  }

  if (profileResumeBrowseBtn && fileInput) {
    profileResumeBrowseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });
  }
  if (profileSamplesBrowseBtn && samplesFileInput) {
    profileSamplesBrowseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      samplesFileInput.click();
    });
  }

  bindProfileDropzone(profileResumeDropzone, (files) => {
    const file = files[0];
    if (file) profileApplyResumeFile(file, UC);
  });
  bindProfileDropzone(profileSamplesDropzone, (files) => {
    profileApplySampleFiles(files, UC);
  });

  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      await profileApplyResumeFile(f, UC);
    });
  }

  if (samplesFileInput) {
    samplesFileInput.addEventListener("change", async (e) => {
      const files = e.target.files;
      e.target.value = "";
      if (!files || !files.length) return;
      await profileApplySampleFiles(files, UC);
    });
  }

  if (pasteBtn) {
    pasteBtn.addEventListener("click", async () => {
      const ingest = getResumeIngest();
      const textEl = document.getElementById("materialsPasteText");
      const raw = (textEl && textEl.value) || "";
      const text = ingest ? ingest.normalizeExtractedText(raw) : raw.trim();
      if (!text) {
        showToast("Paste some resume text first", "error");
        return;
      }
      const label = "My resume";
      await UC.setPrimaryResume({
        source: "paste",
        rawMime: "text/plain",
        label,
        extractedText: text,
      });
      if (textEl) textEl.value = "";
      await refreshMaterialsUI();
      showToast("Resume updated from paste", "success");
    });
  }

  if (linkedInTextEl && linkedInMetaEl) {
    linkedInTextEl.addEventListener("input", () => {
      linkedInMetaEl.textContent = renderLinkedInProfileMeta(
        linkedInTextEl.value,
        "",
      );
    });
  }

  if (aiDumpTextEl && aiDumpMetaEl) {
    aiDumpTextEl.addEventListener("input", () => {
      aiDumpMetaEl.textContent = renderAdditionalContextMeta(
        aiDumpTextEl.value,
        "",
      );
    });
  }

  if (aiDumpCopyPromptBtn && aiDumpPromptEl) {
    aiDumpCopyPromptBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(aiDumpPromptEl.value || "");
        const orig = aiDumpCopyPromptBtn.textContent;
        aiDumpCopyPromptBtn.textContent = "Copied!";
        setTimeout(() => {
          aiDumpCopyPromptBtn.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy prompt to clipboard';
        }, 1500);
        showToast("Prompt copied — paste it into your chatbot", "success");
      } catch (err) {
        console.warn(err);
        showToast("Could not copy prompt", "info");
      }
    });
  }

  if (aiDumpFileEl) {
    aiDumpFileEl.addEventListener("change", async (e) => {
      const ingest = getResumeIngest();
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (!ingest) {
        showToast("File processing unavailable", "error");
        return;
      }
      try {
        const text = await ingest.extractTextFromFile(file);
        const normalized = normalizeProfileTextInput(text);
        if (!normalized) {
          showToast("No text could be extracted from that file", "error");
          return;
        }
        if (aiDumpTextEl) aiDumpTextEl.value = normalized;
        if (aiDumpMetaEl) {
          aiDumpMetaEl.textContent = renderAdditionalContextMeta(
            normalized,
            "",
          );
        }
        showToast("AI context loaded from file", "success");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not read file", "error");
      }
    });
  }

  if (aiDumpSaveBtn) {
    aiDumpSaveBtn.addEventListener("click", async () => {
      if (!UC || typeof UC.saveAdditionalContext !== "function") {
        showToast("AI context storage unavailable", "error");
        return;
      }
      const normalized = normalizeProfileTextInput(
        (aiDumpTextEl && aiDumpTextEl.value) || "",
      );
      if (!normalized) {
        showToast("Paste or upload AI context before saving", "error");
        return;
      }
      await UC.saveAdditionalContext({
        text: normalized,
        updatedAt: new Date().toISOString(),
      });
      await refreshMaterialsUI();
      showToast("AI context saved", "success");
    });
  }

  if (aiDumpClearBtn) {
    aiDumpClearBtn.addEventListener("click", async () => {
      if (!UC || typeof UC.clearAdditionalContext !== "function") {
        showToast("AI context storage unavailable", "error");
        return;
      }
      await UC.clearAdditionalContext();
      await refreshMaterialsUI();
      showToast("AI context cleared", "info");
    });
  }

  if (linkedInAssistBtn) {
    linkedInAssistBtn.addEventListener("click", () => {
      openLinkedInCaptureModal();
    });
  }

  profileMaterialsMod().LINKEDIN_CAPTURE_FIELDS.forEach((f) => {
    const el = document.getElementById(f.id);
    if (el) {
      el.addEventListener("input", updateLinkedInCapturePreview);
    }
  });

  if (linkedInCaptureModal) {
    linkedInCaptureModal.addEventListener("click", (e) => {
      if (e.target === linkedInCaptureModal) closeLinkedInCaptureModal();
    });
  }
  if (linkedInCaptureClose) {
    linkedInCaptureClose.addEventListener("click", closeLinkedInCaptureModal);
  }
  if (linkedInCaptureCloseX) {
    linkedInCaptureCloseX.addEventListener("click", closeLinkedInCaptureModal);
  }

  document.querySelectorAll("[data-li-clipboard-target]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = btn.getAttribute("data-li-clipboard-target");
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target || target.tagName !== "TEXTAREA") return;
      try {
        const clip = await navigator.clipboard.readText();
        target.value = clip || "";
        updateLinkedInCapturePreview();
        showToast("Pasted from clipboard", "success");
      } catch (err) {
        console.warn(err);
        showToast(
          "Clipboard access blocked — paste manually (Cmd/Ctrl+V).",
          "info",
        );
      }
    });
  });

  if (linkedInCaptureSaveBtn) {
    linkedInCaptureSaveBtn.addEventListener("click", async () => {
      if (!UC || typeof UC.saveLinkedInProfile !== "function") {
        showToast("LinkedIn profile storage unavailable", "error");
        return;
      }
      const completeness = getLinkedInCaptureCompleteness();
      if (!completeness.canSave) {
        showToast("Capture Experience and Skills before saving", "error");
        updateLinkedInCapturePreview();
        return;
      }
      const text = buildLinkedInCaptureProfileText();
      if (!text) {
        showToast("Paste at least one LinkedIn section first", "error");
        return;
      }
      await UC.saveLinkedInProfile({
        text,
        updatedAt: new Date().toISOString(),
      });
      if (linkedInTextEl) linkedInTextEl.value = text;
      await refreshMaterialsUI();
      closeLinkedInCaptureModal();
      showToast("LinkedIn profile captured and saved", "success");
    });
  }

  if (linkedInSaveBtn) {
    linkedInSaveBtn.addEventListener("click", async () => {
      if (
        !UC ||
        typeof UC.saveLinkedInProfile !== "function" ||
        typeof UC.normalizeLinkedInProfile !== "function"
      ) {
        showToast("LinkedIn profile storage unavailable", "error");
        return;
      }
      const raw = (linkedInTextEl && linkedInTextEl.value) || "";
      const normalized = UC.normalizeLinkedInProfile({ text: raw });
      await UC.saveLinkedInProfile({
        text: normalized.text,
        updatedAt: new Date().toISOString(),
      });
      await refreshMaterialsUI();
      showToast("LinkedIn profile text saved", "success");
    });
  }

  if (linkedInClearBtn) {
    linkedInClearBtn.addEventListener("click", async () => {
      if (!UC || typeof UC.clearLinkedInProfile !== "function") {
        showToast("LinkedIn profile storage unavailable", "error");
        return;
      }
      await UC.clearLinkedInProfile();
      await refreshMaterialsUI();
      showToast("LinkedIn profile text cleared", "info");
    });
  }

  if (sampleAddBtn) {
    sampleAddBtn.addEventListener("click", async () => {
      const titleEl = document.getElementById("sampleTitle");
      const tagsEl = document.getElementById("sampleTags");
      const textEl = document.getElementById("sampleText");
      const title = (titleEl && titleEl.value.trim()) || "Writing sample";
      const tagsStr = (tagsEl && tagsEl.value) || "";
      const tags = tagsStr
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const raw = (textEl && textEl.value) || "";
      const ingest = getResumeIngest();
      const text = ingest ? ingest.normalizeExtractedText(raw) : raw.trim();
      if (!text) {
        showToast("Add sample text", "error");
        return;
      }
      await UC.addWritingSample({ title, tags, extractedText: text });
      if (textEl) textEl.value = "";
      if (tagsEl) tagsEl.value = "";
      if (titleEl) titleEl.value = "";
      await refreshMaterialsUI();
      showToast("Writing sample added", "success");
    });
  }

  if (savePrefsBtn) {
    savePrefsBtn.addEventListener("click", async () => {
      const toneEl = document.getElementById("prefTone");
      const mwEl = document.getElementById("prefMaxWords");
      const indEl = document.getElementById("prefIndustries");
      const avEl = document.getElementById("prefAvoid");
      const voEl = document.getElementById("prefVoice");
      const mergeEl = document.getElementById("prefMergePreference");
      const coverTplEl = document.getElementById("prefCoverLetterTemplate");
      const resumeTplEl = document.getElementById("prefResumeTemplate");
      const visualThemeEl = document.getElementById("prefVisualTheme");
      const DT = window.CommandCenterDocumentTemplates;
      const VT = window.CommandCenterVisualThemes;
      const maxWords = parseInt(mwEl && mwEl.value, 10);
      await UC.savePreferences({
        tone: (toneEl && toneEl.value) || "warm",
        defaultMaxWords:
          !Number.isNaN(maxWords) && maxWords > 0 ? maxWords : 350,
        industriesToEmphasize: (indEl && indEl.value) || "",
        wordsToAvoid: (avEl && avEl.value) || "",
        voiceNotes: (voEl && voEl.value) || "",
        profileMergePreference: (mergeEl && mergeEl.value) || "merge",
        coverLetterTemplateId:
          (coverTplEl && coverTplEl.value) ||
          (DT && typeof DT.getDefaultTemplateId === "function"
            ? DT.getDefaultTemplateId("cover_letter")
            : "cover_classic_paragraphs"),
        resumeTemplateId:
          (resumeTplEl && resumeTplEl.value) ||
          (DT && typeof DT.getDefaultTemplateId === "function"
            ? DT.getDefaultTemplateId("resume_update")
            : "resume_traditional_sections"),
        visualThemeId:
          (visualThemeEl && visualThemeEl.value) ||
          (VT && typeof VT.getDefaultVisualThemeId === "function"
            ? VT.getDefaultVisualThemeId()
            : "classic"),
      });
      closeAuthUserMenu();
      showToast("Preferences saved", "success");
    });
  }


  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isOnboardingWizardVisible()) return;
    if (isAuthUserMenuOpen()) {
      closeAuthUserMenu();
      document.getElementById("authMenuToggle")?.focus();
      return;
    }
    if (linkedInCaptureModal && linkedInCaptureModal.style.display === "flex") {
      closeLinkedInCaptureModal();
      return;
    }
    const scraperModal = document.getElementById("scraperSetupModal");
    if (scraperModal && scraperModal.style.display === "flex") {
      closeScraperSetupModal();
      return;
    }
    const settingsModal = document.getElementById("settingsModal");
    if (settingsModal && settingsModal.style.display === "flex") {
      const clearBar = document.getElementById("settingsClearConfirmBar");
      if (clearBar && !clearBar.hidden) {
        hideSettingsClearConfirmBar();
        return;
      }
      closeCommandCenterSettingsModal();
      return;
    }
    const draftNotesModalEl = document.getElementById("draftNotesModal");
    if (draftNotesModalEl && draftNotesModalEl.style.display === "flex") {
      closeDraftNotesModal();
      return;
    }
    if (materialsModal && materialsModal.style.display === "flex") {
      closeMaterialsModal();
    }
    const genModalEl = document.getElementById("resumeGenerateModal");
    if (genModalEl && genModalEl.style.display === "flex") {
      closeResumeGenerateModal();
    }
  });

  initOnboardingWizard();
  }

  Object.assign(materials, {
    initResumeMaterialsFeature,
  });
})();
