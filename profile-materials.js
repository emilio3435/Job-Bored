/* ============================================
   COMMAND CENTER v2 — Profile Materials
   Extracted from app.js (profile-materials cut).

   Classic-global IIFE under window.JobBoredApp.profileMaterials — NOT an ES module.
   Loaded BEFORE app.js (after keyword-profile-match.js). Reads app.js helpers
   via lazy core.host.

   Owns the Materials modal, resume/sample ingest, LinkedIn capture flow, and
   personal-preferences panel rendering. Onboarding, posting enrichment, and the
   document-template / visual-theme select fillers stay in app.js.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const profileMaterials = root.profileMaterials || (root.profileMaterials = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function getResumeIngest() {
    return host().getResumeIngest();
  }

  function getUserContent() {
    return host().getUserContent();
  }

  function showToast(...args) {
    return host().showToast(...args);
  }

  function escapeHtml(...args) {
    return host().escapeHtml(...args);
  }

  function closeAuthUserMenu(...args) {
    return host().closeAuthUserMenu(...args);
  }

  function fillDocumentTemplateSelect(...args) {
    return host().fillDocumentTemplateSelect(...args);
  }

  function fillVisualThemeSelect(...args) {
    return host().fillVisualThemeSelect(...args);
  }

  function scheduleCandidateProfileMatchRefresh(shouldRender) {
    return window.JobBoredApp.keywordMatch.scheduleCandidateProfileMatchRefresh(
      shouldRender,
    );
  }

  /**
   * @param {File} file
   * @param {NonNullable<ReturnType<typeof getUserContent>>} UC
   */
  async function profileApplyResumeFile(file, UC) {
    const ingest = getResumeIngest();
    if (!ingest) {
      showToast("Resume processing unavailable", "error");
      return;
    }
    try {
      const text = await ingest.extractTextFromFile(file);
      if (!String(text).trim()) {
        showToast("No text could be extracted from that file", "error");
        return;
      }
      const label =
        (file.name || "Resume").replace(/\.[^/.]+$/, "") || "My resume";
      await UC.setPrimaryResume({
        source: "file",
        rawMime: ingest.guessMime(file),
        label,
        extractedText: text,
      });
      await refreshMaterialsUI();
      showToast("Resume updated", "success");
    } catch (err) {
      console.error(err);
      showToast(err.message || "Could not read file", "error");
    }
  }

  /**
   * @param {FileList|File[]} fileList
   * @param {NonNullable<ReturnType<typeof getUserContent>>} UC
   */
  async function profileApplySampleFiles(fileList, UC) {
    const ingest = getResumeIngest();
    if (!ingest) {
      showToast("File processing unavailable", "error");
      return;
    }
    const arr = Array.from(fileList || []).filter(Boolean);
    if (!arr.length) return;
    let added = 0;
    let failed = 0;
    for (const file of arr) {
      try {
        const text = await ingest.extractTextFromFile(file);
        if (!String(text).trim()) {
          failed++;
          continue;
        }
        const title =
          (file.name || "Sample").replace(/\.[^/.]+$/, "") || "Writing sample";
        await UC.addWritingSample({
          title,
          tags: [],
          extractedText: text,
        });
        added++;
      } catch (err) {
        console.warn(err);
        failed++;
      }
    }
    await refreshMaterialsUI();
    if (added === 1) showToast("Writing sample added", "success");
    else if (added > 1) showToast(`${added} samples added`, "success");
    if (!added && failed)
      showToast("Could not read those files — try PDF, Word, or .txt", "error");
    else if (failed && added) showToast("Some files could not be added", "info");
  }

  /**
   * @param {HTMLElement | null} zoneEl
   * @param {(files: FileList) => void} onFiles
   */
  function bindProfileDropzone(zoneEl, onFiles) {
    if (!zoneEl) return;
    zoneEl.addEventListener("dragenter", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.add("profile-dropzone--drag");
    });
    zoneEl.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rel = e.relatedTarget;
      if (rel && zoneEl.contains(/** @type {Node} */ (rel))) return;
      zoneEl.classList.remove("profile-dropzone--drag");
    });
    zoneEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    zoneEl.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.remove("profile-dropzone--drag");
      const files = e.dataTransfer.files;
      if (files && files.length) onFiles(files);
    });
  }

  function renderLinkedInProfileMeta(text, updatedAt) {
    const chars = String(text || "").length;
    if (!chars) return "No LinkedIn profile text saved.";
    const updated = updatedAt ? new Date(updatedAt).toLocaleDateString() : "";
    return updated
      ? `${chars.toLocaleString()} chars saved · Updated ${updated}`
      : `${chars.toLocaleString()} chars saved`;
  }

  function renderAdditionalContextMeta(text, updatedAt) {
    const chars = String(text || "").length;
    if (!chars) return "No AI context dump saved.";
    const updated = updatedAt ? new Date(updatedAt).toLocaleDateString() : "";
    return updated
      ? `${chars.toLocaleString()} chars saved · Updated ${updated}`
      : `${chars.toLocaleString()} chars saved`;
  }

  const LINKEDIN_CAPTURE_FIELDS = [
    { id: "linkedInCaptureHeadline", label: "HEADLINE" },
    { id: "linkedInCaptureAbout", label: "ABOUT" },
    { id: "linkedInCaptureExperience", label: "EXPERIENCE" },
    { id: "linkedInCaptureSkills", label: "SKILLS" },
    { id: "linkedInCaptureEducation", label: "EDUCATION_AND_CERTIFICATIONS" },
    { id: "linkedInCaptureExtras", label: "EXTRA_HIGHLIGHTS" },
  ];

  function normalizeProfileTextInput(raw) {
    const ingest = getResumeIngest();
    const text = raw != null ? String(raw) : "";
    return ingest && typeof ingest.normalizeExtractedText === "function"
      ? ingest.normalizeExtractedText(text)
      : text.trim();
  }

  function collectLinkedInCaptureSections() {
    return LINKEDIN_CAPTURE_FIELDS.map((f) => {
      const el = document.getElementById(f.id);
      return {
        label: f.label,
        text: normalizeProfileTextInput(el && el.value ? el.value : ""),
      };
    });
  }

  function buildLinkedInCaptureProfileText() {
    const sections = collectLinkedInCaptureSections().filter((s) => s.text);
    if (!sections.length) return "";
    const lines = [
      "LinkedIn profile capture (assisted)",
      `Captured at: ${new Date().toISOString()}`,
    ];
    sections.forEach((s) => {
      lines.push("");
      lines.push(s.label);
      lines.push(s.text);
    });
    return lines.join("\n");
  }

  function getLinkedInCaptureCompleteness() {
    const byId = {};
    collectLinkedInCaptureSections().forEach((s, i) => {
      byId[LINKEDIN_CAPTURE_FIELDS[i].id] = s.text;
    });
    const hasExperience = !!String(byId.linkedInCaptureExperience || "").trim();
    const hasSkills = !!String(byId.linkedInCaptureSkills || "").trim();
    return {
      hasExperience,
      hasSkills,
      canSave: hasExperience && hasSkills,
    };
  }

  function updateLinkedInCapturePreview() {
    const preview = document.getElementById("linkedInCapturePreview");
    const quality = document.getElementById("linkedInCaptureQuality");
    const saveBtn = document.getElementById("linkedInCaptureSaveBtn");
    const built = buildLinkedInCaptureProfileText();
    if (preview) preview.value = built;
    const c = getLinkedInCaptureCompleteness();
    if (saveBtn) saveBtn.disabled = !c.canSave;
    if (quality) {
      quality.classList.remove(
        "linkedincap-quality--ok",
        "linkedincap-quality--warn",
      );
      if (c.canSave) {
        quality.classList.add("linkedincap-quality--ok");
        quality.textContent =
          "Complete enough to save. Experience and Skills captured.";
      } else {
        quality.classList.add("linkedincap-quality--warn");
        quality.textContent =
          "Add both Experience and Skills before saving. These are required for high-quality tailoring.";
      }
    }
  }

  function openLinkedInCaptureModal() {
    const modal = document.getElementById("linkedInCaptureModal");
    if (!modal) return;
    const existing = document.getElementById("materialsLinkedInText");
    const extras = document.getElementById("linkedInCaptureExtras");
    if (
      existing &&
      extras &&
      extras.tagName === "TEXTAREA" &&
      !String(extras.value || "").trim() &&
      String(existing.value || "").trim()
    ) {
      extras.value = String(existing.value || "");
    }
    modal.style.display = "flex";
    updateLinkedInCapturePreview();
    document.getElementById("linkedInCaptureHeadline")?.focus();
  }

  function closeLinkedInCaptureModal() {
    const modal = document.getElementById("linkedInCaptureModal");
    if (modal) modal.style.display = "none";
  }

  /** Populate tone / templates / visual theme fields from stored preferences. */
  function applyPreferencesFromData(prefs) {
    if (!prefs || typeof prefs !== "object") return;
    const toneEl = document.getElementById("prefTone");
    const mwEl = document.getElementById("prefMaxWords");
    const indEl = document.getElementById("prefIndustries");
    const avEl = document.getElementById("prefAvoid");
    const voEl = document.getElementById("prefVoice");
    const mergeEl = document.getElementById("prefMergePreference");
    if (toneEl) toneEl.value = prefs.tone || "warm";
    if (mwEl) mwEl.value = String(prefs.defaultMaxWords || 350);
    if (indEl) indEl.value = prefs.industriesToEmphasize || "";
    if (avEl) avEl.value = prefs.wordsToAvoid || "";
    if (voEl) voEl.value = prefs.voiceNotes || "";
    if (mergeEl) mergeEl.value = prefs.profileMergePreference || "merge";

    fillDocumentTemplateSelect(
      "prefCoverLetterTemplate",
      "cover_letter",
      prefs.coverLetterTemplateId,
    );
    fillDocumentTemplateSelect(
      "prefResumeTemplate",
      "resume_update",
      prefs.resumeTemplateId,
    );
    fillVisualThemeSelect("prefVisualTheme", prefs.visualThemeId);
  }

  async function refreshPersonalPreferencesPanel() {
    const UC = getUserContent();
    if (!UC) return;
    await UC.openDb();
    const prefs = await UC.getPreferences();
    applyPreferencesFromData(prefs);
  }

  async function refreshMaterialsUI() {
    const UC = getUserContent();
    const resumeMeta = document.getElementById("materialsResumeMeta");
    const resumeHero = document.getElementById("profileResumeDropHero");
    const resumeStatusWrap = document.getElementById("profileResumeStatusWrap");
    const resumeDropzone = document.getElementById("profileResumeDropzone");
    const listSamples = document.getElementById("materialsSamplesList");
    const linkedInTextEl = document.getElementById("materialsLinkedInText");
    const linkedInMetaEl = document.getElementById("materialsLinkedInMeta");
    const aiDumpTextEl = document.getElementById("materialsAiDumpText");
    const aiDumpMetaEl = document.getElementById("materialsAiDumpMeta");
    if (!UC || !listSamples) return;

    await UC.openDb();
    const primary = await UC.getActiveResume();
    const linkedInProfile =
      typeof UC.getLinkedInProfile === "function"
        ? await UC.getLinkedInProfile()
        : { text: "", updatedAt: "" };
    const additionalContext =
      typeof UC.getAdditionalContext === "function"
        ? await UC.getAdditionalContext()
        : { text: "", updatedAt: "" };
    const samples = await UC.listWritingSamples();
    const prefs = await UC.getPreferences();

    if (resumeMeta) {
      if (!primary || !String(primary.extractedText || "").trim()) {
        resumeMeta.innerHTML = "";
        if (resumeHero) resumeHero.hidden = false;
        if (resumeStatusWrap) resumeStatusWrap.hidden = true;
        if (resumeDropzone)
          resumeDropzone.classList.remove("profile-dropzone--has-file");
      } else {
        const created = primary.createdAt
          ? new Date(primary.createdAt).toLocaleDateString()
          : "";
        resumeMeta.innerHTML = `<strong>${escapeHtml(primary.label || "My resume")}</strong><span class="profile-meta-sep">·</span>${String(primary.extractedText || "").length.toLocaleString()} chars${created ? `<span class="profile-meta-sep">·</span>${escapeHtml(created)}` : ""}`;
        if (resumeHero) resumeHero.hidden = true;
        if (resumeStatusWrap) resumeStatusWrap.hidden = false;
        if (resumeDropzone)
          resumeDropzone.classList.add("profile-dropzone--has-file");
      }
    }

    listSamples.innerHTML =
      samples.length === 0
        ? ""
        : samples
            .map((s) => {
              const tags = (s.tags || []).join(", ");
              return `<div class="profile-sample-row" data-sample-id="${escapeHtml(s.id)}">
            <div class="profile-sample-row__main"><span class="profile-sample-title">${escapeHtml(s.title)}</span>${tags ? ` <span class="profile-sample-tags">${escapeHtml(tags)}</span>` : ""}</div>
            <button type="button" class="profile-sample-remove" data-delete-sample="${escapeHtml(s.id)}">Remove</button>
          </div>`;
            })
            .join("");

    applyPreferencesFromData(prefs);

    if (linkedInTextEl) {
      linkedInTextEl.value = linkedInProfile.text || "";
    }
    if (linkedInMetaEl) {
      linkedInMetaEl.textContent = renderLinkedInProfileMeta(
        linkedInProfile.text || "",
        linkedInProfile.updatedAt || "",
      );
    }
    if (aiDumpTextEl) {
      aiDumpTextEl.value = additionalContext.text || "";
    }
    if (aiDumpMetaEl) {
      aiDumpMetaEl.textContent = renderAdditionalContextMeta(
        additionalContext.text || "",
        additionalContext.updatedAt || "",
      );
    }

    listSamples.querySelectorAll("[data-delete-sample]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await UC.deleteWritingSample(btn.dataset.deleteSample);
        await refreshMaterialsUI();
        showToast("Sample removed", "info");
      });
    });
    scheduleCandidateProfileMatchRefresh(true);
  }

  function openMaterialsModal() {
    closeAuthUserMenu();
    const modal = document.getElementById("materialsModal");
    if (modal) {
      modal.style.display = "flex";
      refreshMaterialsUI();
      const closeBtn = document.getElementById("materialsModalClose");
      if (closeBtn) closeBtn.focus();
    }
  }

  function closeMaterialsModal() {
    const modal = document.getElementById("materialsModal");
    if (modal) {
      modal.style.display = "none";
      document.getElementById("materialsBtn")?.focus();
    }
  }

  Object.assign(profileMaterials, {
    LINKEDIN_CAPTURE_FIELDS,
    profileApplyResumeFile,
    profileApplySampleFiles,
    bindProfileDropzone,
    renderLinkedInProfileMeta,
    renderAdditionalContextMeta,
    normalizeProfileTextInput,
    collectLinkedInCaptureSections,
    buildLinkedInCaptureProfileText,
    getLinkedInCaptureCompleteness,
    updateLinkedInCapturePreview,
    openLinkedInCaptureModal,
    closeLinkedInCaptureModal,
    applyPreferencesFromData,
    refreshPersonalPreferencesPanel,
    refreshMaterialsUI,
    openMaterialsModal,
    closeMaterialsModal,
  });
})();
