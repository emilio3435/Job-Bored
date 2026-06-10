/* ============================================
   COMMAND CENTER v2 — Onboarding Wizard
   Extracted from app.js (onboarding-wizard cut).

   Classic-global IIFE under window.JobBoredApp.onboarding — NOT an ES module.
   Loaded AFTER resume-generation.js, BEFORE app.js. Reads app.js helpers via
   lazy core.host.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const onboarding = root.onboarding || (root.onboarding = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function getUserContent() {
    return host().getUserContent();
  }

  function getResumeIngest() {
    return host().getResumeIngest();
  }

  async function getResumeIngestReady(maxWaitMs) {
    return host().getResumeIngestReady(maxWaitMs);
  }

  function escapeHtml(...args) {
    return host().escapeHtml(...args);
  }

  function showToast(...args) {
    return host().showToast(...args);
  }

  function normalizeProfileTextInput(...args) {
    return host().normalizeProfileTextInput(...args);
  }

  // Provider-agnostic completion: routes to whatever AI provider the user
  // configured in the first-run wizard / Settings (OpenRouter, local, Gemini,
  // OpenAI, Anthropic). Onboarding's AI suggestions no longer hardcode Gemini.
  async function callConfiguredAi(system, user, opts) {
    return host().callConfiguredAi(system, user, opts);
  }

  function isResumeGenerationConfigured() {
    const gen =
      typeof window !== "undefined" && window.CommandCenterResumeGenerate;
    return !!(
      gen &&
      typeof gen.isResumeGenerationConfigured === "function" &&
      gen.isResumeGenerationConfigured()
    );
  }

  function parseJsonSafeForSuggestions(raw) {
    return host().parseJsonSafeForSuggestions(raw);
  }

  function scheduleCandidateProfileMatchRefresh(shouldRender) {
    return window.JobBoredApp.keywordMatch.scheduleCandidateProfileMatchRefresh(
      shouldRender,
    );
  }

  // Carry the user straight into the discovery wizard. Click-driven only
  // (the celebration CTA + the gate's "Set up discovery" button), so it
  // ALWAYS opens the wizard — discovery is a real step of setup, and a stale
  // or autodetect-persisted completion flag must never turn the click into a
  // silent no-op (the wizard simply shows its connected state and finishes
  // straight through to the go-live chain).
  async function advanceToDiscoveryAfterOnboarding() {
    try {
      const banner = window.JobBoredApp && window.JobBoredApp.whatsNextBanner;
      if (banner && typeof banner.refreshBanner === "function") {
        void Promise.resolve(banner.refreshBanner()).catch(() => {});
      }
    } catch (_) {
      /* banner refresh is best-effort */
    }
    const onClose = async (reason, ctx) => {
      // Happy path: a genuine finish (connected) satisfies the gate — clear it
      // and let the discovery->go-live chain proceed. Only re-assert the
      // blocking gate when the wizard closed WITHOUT connecting AND the user
      // hasn't confirmed the skip escape.
      const result = ctx && ctx.state ? ctx.state.result : null;
      if (reason === "finish" && result === "connected") {
        hideDiscoveryGate();
        return;
      }
      let skipped = false;
      try {
        const UC2 = getUserContent();
        if (UC2 && typeof UC2.isDiscoverySetupSkipped === "function") {
          skipped = !!(await UC2.isDiscoverySetupSkipped());
        }
      } catch (_) {
        skipped = false;
      }
      if (!skipped) showDiscoveryGate();
    };
    try {
      const h = host();
      if (h && typeof h.requestDiscoverySetup === "function") {
        void h.requestDiscoverySetup({
          entryPoint: "onboarding",
          allowWhileOnboarding: true,
          onClose,
        });
      }
    } catch (e) {
      console.warn("[JobBored] auto-open discovery after onboarding:", e);
    }
  }

  function showDiscoveryGate() {
    const gate = typeof document !== "undefined"
      ? document.getElementById("discoverySetupGate") : null;
    if (!gate) return;
    gate.removeAttribute("hidden");
    gate.setAttribute("aria-hidden", "false");
  }

  function hideDiscoveryGate() {
    const gate = typeof document !== "undefined"
      ? document.getElementById("discoverySetupGate") : null;
    if (!gate) return;
    gate.setAttribute("hidden", "hidden");
    gate.setAttribute("aria-hidden", "true");
  }

  // Confetti burst — a handful of mint/amber/violet pieces with randomized
  // start, drift, and spin. Pure decoration (aria-hidden); cleared when the
  // overlay hides.
  function spawnCelebrationConfetti(host) {
    if (!host || typeof host.appendChild !== "function") return;
    const colors = ["#5FCB8E", "#EF8F26", "#7C3AED", "#5BB5C9", "#FCEFA8"];
    for (let i = 0; i < 28; i += 1) {
      const piece = document.createElement("span");
      piece.className = "onboarding-celebration__confetti-piece";
      const left = Math.round((i / 28) * 100);
      const delay = (i % 7) * 60;
      const drift = ((i % 5) - 2) * 14;
      piece.style.left = `${left}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${delay}ms`;
      piece.style.setProperty("--drift", `${drift}px`);
      host.appendChild(piece);
    }
  }

  // Play the "Profile set!" celebration. PERSISTENT: the overlay stays up
  // until the user clicks the continue CTA, which fades it out and then runs
  // onDone (the discovery handoff) — one continuous setup flow, no timed
  // intermission. Degrades gracefully: missing overlay → immediate onDone;
  // overlay without the CTA (stale cached markup) → the old timed dismissal,
  // so the handoff can never strand.
  // One celebratory beat between each MAJOR setup stage (sheet → profile →
  // discovery → devices). The same overlay plays every time; the stage key
  // picks the copy + which journey-strip step is current.
  const STAGE_CELEBRATIONS = {
    profile: {
      title: "Workspace connected!",
      sub: "Your sheet and AI provider are wired up. Now let's make JobBored yours.",
      cta: "Build your profile →",
      currentIndex: 0,
    },
    discovery: {
      title: "Profile set!",
      sub: "Your resume and preferences are in. One big step to go.",
      cta: "Set up job discovery →",
      currentIndex: 1,
    },
    devices: {
      title: "Discovery is live!",
      sub: "Real jobs will start flowing into your pipeline. One optional step left.",
      cta: "Set up other devices →",
      currentIndex: 2,
    },
    bonus: {
      title: "You're fully set up!",
      sub: "Profile, discovery, devices — all live. A few optional power-ups can multiply your results.",
      cta: "Maximize your results →",
      currentIndex: 3, // every journey stage shows done
    },
  };

  function applyCelebrationStage(overlay, stageKey) {
    const stage = STAGE_CELEBRATIONS[stageKey] || STAGE_CELEBRATIONS.discovery;
    const title = document.getElementById("onboardingCelebrationTitle");
    if (title) title.textContent = stage.title;
    const sub = document.getElementById("onboardingCelebrationSub");
    if (sub) sub.textContent = stage.sub;
    const cta = document.getElementById("onboardingCelebrationContinue");
    if (cta) cta.textContent = stage.cta;
    if (overlay && typeof overlay.querySelectorAll === "function") {
      const steps = overlay.querySelectorAll(
        ".onboarding-celebration__journey-step",
      );
      Array.from(steps || []).forEach((li, idx) => {
        if (!li || !li.classList) return;
        li.classList.toggle(
          "onboarding-celebration__journey-step--done",
          idx < stage.currentIndex,
        );
        li.classList.toggle(
          "onboarding-celebration__journey-step--current",
          idx === stage.currentIndex,
        );
        if (idx === stage.currentIndex) {
          li.setAttribute("aria-current", "step");
        } else if (typeof li.removeAttribute === "function") {
          li.removeAttribute("aria-current");
        }
        const dot =
          typeof li.querySelector === "function"
            ? li.querySelector(".onboarding-celebration__journey-dot")
            : null;
        if (dot) {
          dot.textContent = idx < stage.currentIndex ? "✓" : String(idx + 1);
        }
      });
    }
  }

  function playOnboardingCelebration(onDone, stageKey) {
    const finishCb = typeof onDone === "function" ? onDone : () => {};
    const overlay = document.getElementById("onboardingCelebration");
    if (!overlay) {
      finishCb();
      return;
    }
    applyCelebrationStage(overlay, stageKey || "discovery");
    const burst = document.getElementById("onboardingCelebrationConfetti");
    if (burst) {
      if (typeof burst.replaceChildren === "function") burst.replaceChildren();
      spawnCelebrationConfetti(burst);
    }
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.remove("onboarding-celebration--out");
    overlay.classList.add("onboarding-celebration--in");
    let finished = false;
    const dismiss = () => {
      if (finished) return;
      finished = true;
      overlay.classList.add("onboarding-celebration--out");
      // Reveal-under-the-fade: open the next chapter at fade START so it
      // mounts beneath the overlay (celebration z-index sits above every
      // wizard) and is revealed as the fade clears — the user never sees
      // the dashboard blink between stages.
      try {
        finishCb();
      } catch (err) {
        console.warn("[JobBored] celebration handoff:", err);
      }
      setTimeout(() => {
        overlay.setAttribute("hidden", "");
        overlay.setAttribute("aria-hidden", "true");
        overlay.classList.remove("onboarding-celebration--in");
        overlay.classList.remove("onboarding-celebration--out");
        if (burst && typeof burst.replaceChildren === "function") {
          burst.replaceChildren();
        }
      }, 320);
    };
    const cta = document.getElementById("onboardingCelebrationContinue");
    if (!cta) {
      // Stale markup without the CTA — keep the old timed handoff.
      setTimeout(dismiss, 1500);
      return;
    }
    cta.addEventListener("click", dismiss, { once: true });
    if (typeof cta.focus === "function") {
      try {
        cta.focus();
      } catch (_) {
        /* focus is best-effort */
      }
    }
  }

/** Staged resume during onboarding (before save). */
let onboardingResumeDraft = null;
/** How user supplied resume: "upload" | "paste" (for Back navigation from tone step). */
let onboardingResumePath = null;

// 4 steps: 1=resume, 2=role chips (AI-suggested), 3=AI context, 4=tone.
const ONBOARDING_TOTAL_STEPS = 4;

function isOnboardingWizardVisible() {
  const w = document.getElementById("onboardingWizard");
  return w && w.style.display === "flex";
}

function hideOnboardingWizard() {
  const w = document.getElementById("onboardingWizard");
  if (w) w.style.display = "none";
}

function showOnboardingWizard() {
  const w = document.getElementById("onboardingWizard");
  if (!w) return;
  onboardingResumeDraft = null;
  onboardingResumePath = null;
  const paste = document.getElementById("onboardingPasteText");
  const status = document.getElementById("onboardingResumeStatus");
  const statusUp = document.getElementById("onboardingResumeStatusUpload");
  const fileIn = document.getElementById("onboardingFileInput");
  const toneHidden = document.getElementById("wizardPrefTone");
  const mw = document.getElementById("wizardPrefMaxWords");
  const voice = document.getElementById("wizardPrefVoice");
  if (paste) paste.value = "";
  if (status) {
    status.textContent = "";
    status.classList.remove("onboarding-status--error");
  }
  if (statusUp) {
    statusUp.textContent = "";
    statusUp.classList.remove("onboarding-status--error");
    statusUp.classList.remove("onboarding-status--ok");
  }
  if (fileIn) fileIn.value = "";
  // Reset the AI-suggested careers panel so re-entry starts clean.
  // (Avoids stale chips/loading state if the user reopens the wizard.)
  try {
    onboardingResetSuggestState();
    onboardingSuggestRenderChips();
    onboardingSuggestSetStatus("", null);
    const addInput = document.getElementById("onboardingSuggestAddInput");
    if (addInput) addInput.value = "";
  } catch (_) {
    /* defensive — function is defined below */
  }
  if (toneHidden) toneHidden.value = "warm";
  if (mw) mw.value = "350";
  if (voice) voice.value = "";
  const samplesIn = document.getElementById("onboardingSamplesFileInput");
  const samplesStatus = document.getElementById("onboardingSamplesStatus");
  const aiCtx = document.getElementById("onboardingAiContextText");
  if (samplesIn) samplesIn.value = "";
  if (samplesStatus) {
    samplesStatus.textContent = "";
    samplesStatus.classList.remove("onboarding-status--error");
  }
  if (aiCtx) aiCtx.value = "";
  // onboardingAiTarget was removed in the Step 3 consolidation — Step 2
  // chips own role targeting now. Only the strength + avoid fields remain.
  ["onboardingAiStrength", "onboardingAiAvoid"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    },
  );
  syncOnboardingToneCards("warm");
  setOnboardingStep(1);
  w.style.display = "flex";
  document.getElementById("onboardingFileInput")?.focus();
}

function updateOnboardingProgressUI(step) {
  const label = document.getElementById("onboardingStepLabel");
  const fill = document.getElementById("onboardingProgressBarFill");
  const bar = document.getElementById("onboardingProgressBar");
  if (label) {
    label.textContent = `Step ${step} of ${ONBOARDING_TOTAL_STEPS}`;
  }
  const pct = (step / ONBOARDING_TOTAL_STEPS) * 100;
  if (fill) fill.style.width = `${pct}%`;
  if (bar) bar.setAttribute("aria-valuenow", String(step));
}

function syncOnboardingToneCards(selectedTone) {
  document.querySelectorAll(".onboarding-tone-card").forEach((btn) => {
    const t = btn.getAttribute("data-tone");
    const on = t === selectedTone;
    btn.classList.toggle("onboarding-tone-card--selected", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const hidden = document.getElementById("wizardPrefTone");
  if (hidden) hidden.value = selectedTone;
}

function renderOnboardingSummary() {
  const ul = document.getElementById("onboardingSummary");
  if (!ul || !onboardingResumeDraft) return;
  const tone = document.getElementById("wizardPrefTone")?.value || "warm";
  const mw = document.getElementById("wizardPrefMaxWords")?.value || "350";
  const voice = (
    document.getElementById("wizardPrefVoice")?.value || ""
  ).trim();
  const label = onboardingResumeDraft.label || "My resume";
  const chars = String(onboardingResumeDraft.extractedText || "").length;
  const toneLabel =
    tone === "direct" ? "Direct" : tone === "formal" ? "Formal" : "Warm";
  let html = `<li><strong>Resume</strong>: ${escapeHtml(label)} (${chars.toLocaleString()} characters)</li>`;
  html += `<li><strong>Tone</strong>: ${escapeHtml(toneLabel)}</li>`;
  html += `<li><strong>Max words</strong>: ${escapeHtml(String(mw))}</li>`;
  if (voice) {
    html += `<li><strong>Voice notes</strong>: ${escapeHtml(voice)}</li>`;
  }
  const samplesIn = document.getElementById("onboardingSamplesFileInput");
  const sn = samplesIn && samplesIn.files ? samplesIn.files.length : 0;
  if (sn) {
    html += `<li><strong>Writing samples</strong>: ${sn} file(s) queued</li>`;
  }
  const aiEl = document.getElementById("onboardingAiContextText");
  const aiRaw = (aiEl && aiEl.value) || "";
  const aiNorm = normalizeProfileTextInput(aiRaw);
  if (aiNorm) {
    html += `<li><strong>AI context</strong>: ${aiNorm.length.toLocaleString()} characters</li>`;
  }
  ul.innerHTML = html;
}

const ONBOARDING_MASCOT_POSES = {
  1: "assets/jobbored-brand-mascot-kit/exports/04-mascot-poses/pose-02-resume-review.webp",
  2: "assets/jobbored-brand-mascot-kit/exports/04-mascot-poses/pose-01-laptop-thinking.webp",
  3: "assets/jobbored-brand-mascot-kit/exports/04-mascot-poses/pose-03-writing-notes.webp",
  4: "assets/jobbored-brand-mascot-kit/exports/04-mascot-poses/pose-07-celebrating.webp",
};

function updateOnboardingMascotPose(step) {
  const img = document.getElementById("onboardingMascotPose");
  if (!img) return;

  const nextStep = ONBOARDING_MASCOT_POSES[step] ? step : 1;
  const nextSrc = ONBOARDING_MASCOT_POSES[nextStep];
  const frame = img.closest(".onboarding-wizard__mascot-frame");
  if (frame) frame.dataset.step = String(nextStep);

  if (img.getAttribute("src") === nextSrc) return;
  img.classList.add("onboarding-wizard__logo--swapping");
  img.setAttribute("src", nextSrc);
  window.setTimeout(() => {
    img.classList.remove("onboarding-wizard__logo--swapping");
  }, 140);
}

function setOnboardingStep(step) {
  // Four-panel wizard: 1 = resume, 2 = role suggestions, 3 = AI context, 4 = tone.
  for (let i = 1; i <= ONBOARDING_TOTAL_STEPS; i++) {
    const p = document.getElementById(`onboardingPanel${i}`);
    if (p) p.style.display = i === step ? "block" : "none";
  }
  const title = document.getElementById("onboardingWizardTitle");
  const titles = {
    1: "Resume",
    2: "Roles to explore",
    3: "About your search",
    4: "Tone",
  };
  if (title) title.textContent = titles[step] || "Setup";
  updateOnboardingMascotPose(step);
  updateOnboardingProgressUI(step);
  if (step === 1) updateOnboardingContinue2Enabled();
  if (step === 2) {
    // Lazy-load suggestions the first time we land on this step. Uses the
    // AI provider configured upstream (per onboarding consultation) — if it's
    // not configured we surface a clear message and let the user free-add roles.
    void onboardingSuggestEnsureLoaded();
  }

  const focusMap = {
    1: "onboardingFileInput",
    2: "onboardingSuggestAddInput",
    3: "onboardingAiStrength",
    4: "wizardPrefVoice",
  };
  const fid = focusMap[step];
  if (fid) {
    requestAnimationFrame(() => {
      document.getElementById(fid)?.focus();
    });
  }
}

function updateOnboardingContinue2Enabled() {
  const btn = document.getElementById("onboardingContinue2");
  if (!btn) return;
  const hasDraft =
    onboardingResumeDraft &&
    String(onboardingResumeDraft.extractedText || "").trim();
  btn.disabled = !hasDraft;
}

function updateOnboardingNext3Enabled() {
  const btn = document.getElementById("onboardingNext3");
  if (!btn) return;
  const ingest = getResumeIngest();
  const pasteEl = document.getElementById("onboardingPasteText");
  const pasteRaw = (pasteEl && pasteEl.value) || "";
  const pasteText = ingest
    ? ingest.normalizeExtractedText(pasteRaw)
    : pasteRaw.trim();
  const hasDraft =
    onboardingResumeDraft &&
    String(onboardingResumeDraft.extractedText || "").trim();
  btn.disabled = !hasDraft && !pasteText;
}

async function checkOnboardingGate() {
  const UC = getUserContent();
  if (!UC) return;
  try {
    await UC.openDb();
    await UC.migrateOnboardingState();
    if (await UC.isOnboardingComplete()) return;
    showOnboardingWizard();
  } catch (e) {
    console.warn("[JobBored] Onboarding gate:", e);
  }
}

function ensureResumeDraftFromPasteStep() {
  const ingest = getResumeIngest();
  const pasteEl = document.getElementById("onboardingPasteText");
  const status = document.getElementById("onboardingResumeStatus");
  let d = onboardingResumeDraft;
  if (!d || !String(d.extractedText || "").trim()) {
    const raw = (pasteEl && pasteEl.value) || "";
    const t = ingest ? ingest.normalizeExtractedText(raw) : raw.trim();
    if (!t) {
      if (status) {
        status.textContent = "Paste your resume to continue.";
        status.classList.add("onboarding-status--error");
      }
      return false;
    }
    d = {
      source: "paste",
      rawMime: "text/plain",
      label: "My resume",
      extractedText: t,
    };
    onboardingResumeDraft = d;
  }
  if (status) {
    status.textContent = "";
    status.classList.remove("onboarding-status--error");
  }
  return true;
}

// ============================================
// Onboarding step 2: Suggested careers (AI-backed via the configured provider)
// ============================================

// Per-session state for the suggestions panel. Lives in module scope (not
// localStorage) — suggestions are cheap to regenerate and we don't want stale
// chips surviving a wizard re-entry.
let onboardingSuggestState = {
  loaded: false, // true after first successful AI call
  loading: false, // in-flight guard (prevents double Show me more clicks)
  error: null, // last error string, surfaced in status line
  generation: 0, // monotonic counter so re-rolls can dedupe vs prior batch
  // Map<lowercase label, { label, selected, source: "gemini"|"custom" }>.
  // Map preserves insertion order so chips don't reshuffle on selection toggle.
  byKey: new Map(),
};

function onboardingResetSuggestState() {
  onboardingSuggestState = {
    loaded: false,
    loading: false,
    error: null,
    generation: 0,
    byKey: new Map(),
  };
}

function onboardingGetSelectedRoles() {
  const out = [];
  for (const v of onboardingSuggestState.byKey.values()) {
    if (v.selected && v.label) out.push(v.label);
  }
  return out;
}

function onboardingSuggestNormalizeLabel(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

function onboardingSuggestKey(label) {
  return onboardingSuggestNormalizeLabel(label).toLowerCase();
}

/**
 * Render the chip row from current state. Idempotent — safe to call after any
 * state mutation. Each chip is a button so it's keyboard-accessible.
 */
function onboardingSuggestRenderChips() {
  const row = document.getElementById("onboardingSuggestChipRow");
  const foot = document.getElementById("onboardingSuggestFoot");
  if (!row) return;
  row.innerHTML = "";
  const entries = Array.from(onboardingSuggestState.byKey.values());
  if (!entries.length && onboardingSuggestState.loaded) {
    foot && (foot.textContent = "");
    return;
  }
  for (const entry of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "onboarding-suggest-chip";
    btn.setAttribute("role", "listitem");
    btn.setAttribute("aria-pressed", entry.selected ? "true" : "false");
    if (entry.selected) btn.classList.add("onboarding-suggest-chip--selected");
    if (entry.source === "custom") {
      btn.classList.add("onboarding-suggest-chip--custom");
    }
    btn.dataset.suggestKey = onboardingSuggestKey(entry.label);
    btn.textContent = entry.label;
    btn.addEventListener("click", () => {
      entry.selected = !entry.selected;
      btn.setAttribute("aria-pressed", entry.selected ? "true" : "false");
      btn.classList.toggle(
        "onboarding-suggest-chip--selected",
        entry.selected,
      );
      onboardingSuggestRenderFoot();
    });
    row.appendChild(btn);
  }
  onboardingSuggestRenderFoot();
}

function onboardingSuggestRenderFoot() {
  const foot = document.getElementById("onboardingSuggestFoot");
  if (!foot) return;
  const total = onboardingSuggestState.byKey.size;
  const picked = onboardingGetSelectedRoles().length;
  if (!total) {
    foot.textContent = "";
    return;
  }
  foot.textContent = picked
    ? `${picked} selected · ${total} options shown — pick as many as feel right.`
    : `${total} options — pick at least one or skip with Continue.`;
}

function onboardingSuggestSetStatus(message, kind) {
  const el = document.getElementById("onboardingSuggestStatus");
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove(
    "onboarding-status--error",
    "onboarding-status--ok",
    "onboarding-status--loading",
  );
  if (!message) return;
  if (kind === "error") el.classList.add("onboarding-status--error");
  else if (kind === "loading") el.classList.add("onboarding-status--loading");
  else if (kind === "ok") el.classList.add("onboarding-status--ok");
}

function onboardingSuggestSetLoading(loading) {
  onboardingSuggestState.loading = loading;
  const reroll = document.getElementById("onboardingSuggestReroll");
  if (reroll) reroll.disabled = loading;
  if (loading) {
    onboardingSuggestSetStatus(
      "Finding adjacent + lateral roles…",
      "loading",
    );
  }
}

/**
 * One-shot loader on first navigation to step 2. Skips if already loaded so
 * Back/Next doesn't burn API calls. Re-roll explicitly resets and reloads.
 */
async function onboardingSuggestEnsureLoaded() {
  if (onboardingSuggestState.loaded || onboardingSuggestState.loading) return;
  await onboardingSuggestLoad({ append: false });
}

/**
 * Re-roll: generate a fresh batch, but keep currently-selected chips so the
 * user doesn't lose their choices when they ask for more variety. New batch
 * is appended (deduped) so the chip set grows rather than churning entirely.
 */
async function onboardingSuggestLoad({ append }) {
  if (onboardingSuggestState.loading) return;
  onboardingSuggestState.error = null;

  const draft = onboardingResumeDraft;
  const resumeText = String(draft && draft.extractedText ? draft.extractedText : "")
    .trim();
  if (!resumeText) {
    onboardingSuggestSetStatus(
      "Upload or paste a resume on the previous step first.",
      "error",
    );
    return;
  }

  // The AI provider + key are configured upstream in the first-run wizard's
  // Provider step, so we no longer ask for a Gemini key here. If somehow no
  // provider is configured, fall back to manual role entry instead of blocking.
  if (!isResumeGenerationConfigured()) {
    onboardingSuggestSetStatus(
      "Configure your AI provider in Settings to see role suggestions — or type your own roles below.",
      null,
    );
    onboardingSuggestState.loaded = true; // unblock the panel; user can free-add
    onboardingSuggestRenderChips();
    return;
  }

  if (!append) {
    // Initial load: clear AI-sourced chips but preserve any custom ones.
    const customs = Array.from(onboardingSuggestState.byKey.values()).filter(
      (v) => v.source === "custom",
    );
    onboardingSuggestState.byKey = new Map(
      customs.map((v) => [onboardingSuggestKey(v.label), v]),
    );
  }

  onboardingSuggestSetLoading(true);
  onboardingSuggestState.generation += 1;
  const gen = onboardingSuggestState.generation;
  // Already-shown labels: tell the model to avoid these on re-roll.
  const alreadyShown = Array.from(onboardingSuggestState.byKey.values()).map(
    (v) => v.label,
  );

  // Truncate resume to keep the prompt cheap. 12k chars is plenty for role
  // inference and well under any sensible token budget.
  const resumeForPrompt = resumeText.slice(0, 12_000);

  const systemPrompt = [
    "You are a career exploration assistant.",
    "Given a resume, you suggest a BROAD set of role titles the candidate",
    "could realistically pursue — including adjacent specialties AND lateral",
    "pivots one step away from their obvious track.",
    "Goal: prevent the user from pigeonholing themselves before job search.",
    "Cover at least three distinct categories: (a) direct fits, (b) adjacent",
    "specialties (different stack/scope, same craft), (c) lateral pivots",
    "(different craft, transferable skills).",
    "Never repeat titles. Use canonical industry titles (no clickbait).",
    "Avoid seniority prefixes like Senior/Staff/Lead unless the resume strongly",
    "indicates that band — keep titles broad so search isn't over-filtered.",
    "Return STRICT JSON only.",
  ].join(" ");

  const userPayload = {
    instruction:
      "Suggest 15 to 20 distinct role titles the candidate could explore. Mix direct fits, adjacent specialties, and lateral pivots.",
    avoidExactTitles: alreadyShown,
    resume: resumeForPrompt,
    schema: {
      roles: [
        {
          title: "string — concise role title",
          category: "direct | adjacent | lateral",
        },
      ],
    },
  };

  const userPrompt =
    `${JSON.stringify(userPayload, null, 2)}\n\nReturn JSON: { "roles": [ { "title": "...", "category": "..." } ] }`;

  let raw;
  try {
    // json:true → for Gemini, set responseMimeType=application/json and raise
    // the output-token cap (thinking models otherwise truncate with
    // finishReason=MAX_TOKENS before any roles emit); for OpenAI-compatible
    // providers it bumps max_tokens. callConfiguredAi routes to the configured
    // provider's endpoint/key/model.
    raw = await callConfiguredAi(systemPrompt, userPrompt, { json: true });
  } catch (err) {
    if (gen !== onboardingSuggestState.generation) return; // superseded
    onboardingSuggestSetLoading(false);
    onboardingSuggestState.loaded = true;
    onboardingSuggestState.error =
      (err && err.message) || "Could not reach the AI provider.";
    onboardingSuggestSetStatus(
      `Suggestions failed: ${onboardingSuggestState.error}. Type a role below to add it manually.`,
      "error",
    );
    onboardingSuggestRenderChips();
    return;
  }

  if (gen !== onboardingSuggestState.generation) return; // user re-rolled mid-flight

  const parsed = parseJsonSafeForSuggestions(raw);
  const roles = Array.isArray(parsed && parsed.roles) ? parsed.roles : [];
  // Diagnostic — when the model returns text but no roles[] (bad shape,
  // empty array, or off-spec output) we want the failure visible in the
  // console instead of just a vague status string. This is the only path
  // that lets us debug an "AI returned no suggestions" report from a
  // user without asking them to open devtools and screenshot.
  if (!roles.length) {
    console.warn("[onboarding/suggest] AI parsed payload had no roles", {
      rawLength: String(raw || "").length,
      rawPreview: String(raw || "").slice(0, 400),
      parsedKeys: parsed && typeof parsed === "object" ? Object.keys(parsed) : null,
    });
  }
  let added = 0;
  for (const r of roles) {
    const label = onboardingSuggestNormalizeLabel(r && r.title);
    if (!label) continue;
    const key = onboardingSuggestKey(label);
    if (onboardingSuggestState.byKey.has(key)) continue;
    onboardingSuggestState.byKey.set(key, {
      label,
      selected: false,
      source: "gemini",
    });
    added += 1;
  }

  onboardingSuggestState.loaded = true;
  onboardingSuggestSetLoading(false);
  onboardingSuggestRenderChips();
  if (added === 0 && !onboardingSuggestState.byKey.size) {
    // Distinguish "we got bytes back but they were unparseable" from "the
    // model returned a clean but empty array". Both are useful signals
    // for the user — and far less infuriating than a flat "no suggestions".
    const hadRawBytes = !!String(raw || "").trim();
    const parsedHadStructure = parsed && typeof parsed === "object";
    const message = !hadRawBytes
      ? "The AI returned an empty response — try Show me more, or paste a longer resume so the model has more to work with."
      : !parsedHadStructure
        ? "The AI replied but the response wasn't valid JSON. Try Show me more — if it keeps failing, switch models in Settings."
        : "The AI returned an empty role list — try Show me more, or type a role below to add it manually.";
    onboardingSuggestSetStatus(message, "error");
  } else if (added === 0) {
    onboardingSuggestSetStatus(
      "No new roles this round — try Show me more for a different angle.",
      "ok",
    );
  } else {
    onboardingSuggestSetStatus(
      append
        ? `Added ${added} more — pick whatever fits.`
        : `Tap any chip to add it to your search.`,
      "ok",
    );
  }
}

/**
 * Step 3 "Want our take?" — read the user's resume text + chip-selected
 * roles, ask the configured AI for 2-3 distinctive edges (specific accomplishments,
 * unusual skill combos, things that aren't generic resume filler), then
 * insert the result into the superpower textarea so the user can edit on
 * top of it.
 *
 * Prompt is intentionally specific about what NOT to return: no generic
 * skill bullets ("strong communicator"), no career-summary prose, no
 * keyword stuffing. We want the 2–3 things that would survive being
 * shrunk to a single tweet.
 *
 * Uses the same provider-agnostic completion path
 * as the chip suggestions so a model swap stays one-line. Failures
 * surface inline in #onboardingEdgeTakeStatus rather than a toast — the
 * user is mid-flow and shouldn't have their attention pulled to a
 * floating popup.
 */
async function onboardingFillEdgeFromAi() {
  const btn = document.getElementById("onboardingEdgeTakeBtn");
  const status = document.getElementById("onboardingEdgeTakeStatus");
  const strengthEl = document.getElementById("onboardingAiStrength");

  const setStatus = (text, kind) => {
    if (!status) return;
    status.textContent = text || "";
    status.classList.remove(
      "onboarding-status--ok",
      "onboarding-status--error",
      "onboarding-status--loading",
    );
    if (kind) status.classList.add(`onboarding-status--${kind}`);
  };

  if (!strengthEl) return;

  // Provider + key are configured upstream (first-run wizard's Provider step).
  if (!isResumeGenerationConfigured()) {
    setStatus(
      "Configure your AI provider in Settings first — we use it to read your resume.",
      "error",
    );
    return;
  }

  const resumeText = String(
    (onboardingResumeDraft && onboardingResumeDraft.extractedText) || "",
  ).trim();
  if (!resumeText) {
    setStatus(
      "We don't have your resume text. Go back to Step 1 and upload or paste it first.",
      "error",
    );
    return;
  }

  // Chips give the model context for which direction to tailor the edges in.
  // (e.g. if the user picked Forward Deployed Engineer roles, frame edges
  // for that audience rather than a generic "what makes them special".)
  const chipRoles = onboardingGetSelectedRoles().slice(0, 12);

  if (btn) {
    btn.disabled = true;
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.textContent = "Thinking…";
  }
  setStatus("Reading your resume…", "loading");

  // Trim resume to a reasonable budget — enough for the model to find
  // distinctive details without burning tokens on long appendices.
  const resumeForPrompt =
    resumeText.length > 5000
      ? `${resumeText.slice(0, 5000)}\n\n[...truncated...]`
      : resumeText;

  const systemPrompt = [
    "You read resumes and find the 2–3 things that genuinely set this candidate apart.",
    "Output rules:",
    "- Return SHORT bullet-style phrases (one sentence each, max ~18 words).",
    "- Each must be specific, concrete, and reference real signal from the resume — accomplishments, unusual skill combos, scope, results.",
    "- Skip generic resume filler: no 'strong communicator', no 'team player', no 'detail-oriented'.",
    "- Skip career-summary prose and any sentences that start with 'I am'.",
    "- Frame for the target roles when they meaningfully change emphasis.",
    "- Plain text inside the JSON values — no markdown, no asterisks, no bullet characters.",
    'Return JSON: { "edges": ["...", "...", "..."] }',
  ].join("\n");

  const userPayload = {
    resume: resumeForPrompt,
    targetRoles: chipRoles,
  };
  const userPrompt = `${JSON.stringify(userPayload, null, 2)}\n\nReturn 2–3 edges as JSON.`;

  let raw;
  try {
    raw = await callConfiguredAi(systemPrompt, userPrompt, { json: true });
  } catch (err) {
    setStatus(
      `AI failed: ${(err && err.message) || "unknown error"}. Type your edges by hand below.`,
      "error",
    );
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || "Want our take?";
    }
    return;
  }

  const parsed = parseJsonSafeForSuggestions(raw);
  const edges = Array.isArray(parsed && parsed.edges)
    ? parsed.edges
        .map((e) => String(e || "").trim())
        .filter((e) => e.length > 0)
    : [];

  if (!edges.length) {
    console.warn("[onboarding/edge] AI returned no edges", {
      rawLength: String(raw || "").length,
      rawPreview: String(raw || "").slice(0, 400),
    });
    setStatus(
      "The AI didn't return anything usable — try again, or type your edges by hand.",
      "error",
    );
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || "Want our take?";
    }
    return;
  }

  // Insert the edges, separated by newlines, into the textarea. If the
  // user already typed something we APPEND with a blank line so we never
  // wipe their input. This is the "iteration > replacement" intent.
  const formatted = edges.map((e) => `• ${e}`).join("\n");
  const existing = String(strengthEl.value || "").trim();
  strengthEl.value = existing
    ? `${existing}\n\n${formatted}`
    : formatted;
  // Trigger any input listeners (e.g. autosave hooks if they exist later).
  strengthEl.dispatchEvent(new Event("input", { bubbles: true }));

  setStatus(
    `Added ${edges.length} edge${edges.length === 1 ? "" : "s"} — keep, edit, or delete.`,
    "ok",
  );
  if (btn) {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || "Want our take?";
  }
}

function onboardingSuggestAddCustom(rawLabel) {
  const label = onboardingSuggestNormalizeLabel(rawLabel);
  if (!label) return false;
  const key = onboardingSuggestKey(label);
  if (onboardingSuggestState.byKey.has(key)) {
    // Already present — just select it so the user gets feedback.
    const existing = onboardingSuggestState.byKey.get(key);
    existing.selected = true;
    onboardingSuggestRenderChips();
    onboardingSuggestSetStatus(`“${label}” is already in the list.`, "ok");
    return true;
  }
  onboardingSuggestState.byKey.set(key, {
    label,
    selected: true,
    source: "custom",
  });
  onboardingSuggestRenderChips();
  onboardingSuggestSetStatus(`Added “${label}”.`, "ok");
  return true;
}

function initOnboardingSuggestPanel() {
  const reroll = document.getElementById("onboardingSuggestReroll");
  const addInput = document.getElementById("onboardingSuggestAddInput");
  const addBtn = document.getElementById("onboardingSuggestAddBtn");

  if (reroll) {
    reroll.addEventListener("click", () => {
      void onboardingSuggestLoad({ append: true });
    });
  }
  if (addBtn && addInput) {
    const submit = () => {
      const ok = onboardingSuggestAddCustom(addInput.value);
      if (ok) {
        addInput.value = "";
        addInput.focus();
      }
    };
    addBtn.addEventListener("click", submit);
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
  }
}

function initOnboardingWizard() {
  const fileIn = document.getElementById("onboardingFileInput");
  const pasteEl = document.getElementById("onboardingPasteText");

  // Panel 1 -> Panel 2 (resume drop or paste fallback)
  document
    .getElementById("onboardingContinue2")
    ?.addEventListener("click", () => {
      // Allow either an uploaded resume OR pasted text from the disclosure.
      if (
        !onboardingResumeDraft ||
        !String(onboardingResumeDraft.extractedText || "").trim()
      ) {
        if (!ensureResumeDraftFromPasteStep()) return;
        onboardingResumePath = "paste";
      } else {
        onboardingResumePath = onboardingResumePath || "upload";
      }
      setOnboardingStep(2);
    });

  // Panel 2 (suggested careers) navigation
  initOnboardingSuggestPanel();
  document
    .getElementById("onboardingSuggestBack")
    ?.addEventListener("click", () => {
      setOnboardingStep(1);
    });
  document
    .getElementById("onboardingSuggestNext")
    ?.addEventListener("click", () => {
      // IMPORTANT: do NOT mirror chip selections into Step 3's target-roles
      // textarea. The chips are the source of truth for "roles to explore"
      // and feed the discovery profile via finalizeOnboarding. Mirroring
      // duplicated the choices in two places, so users saw their selected
      // chips pasted into the Step 3 free-text field — confusing and asked
      // them to act on the same data twice.
      setOnboardingStep(3);
    });

  // Panel 3 (AI context) navigation — buttons keep their legacy ids.
  document.getElementById("onboardingBack4")?.addEventListener("click", () => {
    setOnboardingStep(2);
  });
  document.getElementById("onboardingNext4")?.addEventListener("click", () => {
    setOnboardingStep(4);
  });

  // "Want our take?" — Step 3 superpower assist. Reads the user's resume
  // text + chip selections and asks the configured AI for 2-3 distinctive edges. The
  // result is INSERTED into the textarea (not replacing user-typed text)
  // so the user can iterate on top of it. See onboardingFillEdgeFromAi
  // for the prompt + response handling.
  document
    .getElementById("onboardingEdgeTakeBtn")
    ?.addEventListener("click", () => {
      void onboardingFillEdgeFromAi();
    });

  // Panel 4 (tone & finish) back arrow
  document.getElementById("onboardingBack9")?.addEventListener("click", () => {
    setOnboardingStep(3);
  });

  document.querySelectorAll(".onboarding-tone-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-tone");
      if (t) syncOnboardingToneCards(t);
    });
  });

  if (fileIn) {
    fileIn.addEventListener("change", async (e) => {
      const status = document.getElementById("onboardingResumeStatusUpload");
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      // Immediate "we received your file" feedback so the user is never left
      // staring at a blank screen during PDF/Word extraction. This must
      // happen BEFORE the await for the ingest module so it shows up even
      // when pdf.js + mammoth are still finishing their cold-cache load.
      if (status) {
        status.innerHTML = "";
        status.classList.remove(
          "onboarding-status--ok",
          "onboarding-status--error",
        );
        status.classList.add("onboarding-status--loading");
        status.textContent = `Reading “${file.name || "your file"}”…`;
      }
      // Wait for the resume-ingest module to be ready instead of bailing
      // immediately. Cold-cache loads of pdf.js + mammoth occasionally
      // finish a few hundred ms after DOMContentLoaded; the previous
      // fail-fast branch is what made users say "I have to refresh first".
      // Timing trace ("why is this PDF slow?"): the ingest-ready wait and the
      // total parse are logged here; resume-ingest.js logs the per-phase
      // breakdown (file read, worker boot + document parse, per-page text).
      const tReady = Date.now();
      const ingest = await getResumeIngestReady(3000);
      console.info(
        `[JobBored] resume parse: ingest ready in ${Date.now() - tReady}ms`,
      );
      if (!ingest) {
        if (status) {
          status.classList.remove("onboarding-status--loading");
          status.classList.add("onboarding-status--error");
          status.textContent =
            "Resume reader still loading after 3s. Check your connection and try again, or paste the text below.";
        }
        return;
      }
      try {
        const tParse = Date.now();
        const text = await ingest.extractTextFromFile(file);
        console.info(
          `[JobBored] resume parse: total ${Date.now() - tParse}ms for "${file.name || "unnamed"}" (${text.length} chars)`,
        );
        if (!text.trim()) {
          if (status) {
            status.classList.remove(
              "onboarding-status--ok",
              "onboarding-status--loading",
            );
            status.classList.add("onboarding-status--error");
            status.textContent =
              "We received the file but couldn't read any text from it. If it's a scanned PDF, paste the text below instead.";
          }
          return;
        }
        const label =
          (file.name || "Resume").replace(/\.[^/.]+$/, "") || "My resume";
        onboardingResumeDraft = {
          source: "file",
          rawMime: ingest.guessMime(file),
          label,
          extractedText: text,
        };
        onboardingResumePath = "upload";
        if (status) {
          // Visible confirmation: filename with extension, file-type label,
          // size, and extracted-character count. Replaces the old text-only
          // hint that users could miss before clicking Continue.
          const fullName = String(file.name || `${label}`);
          const extMatch = fullName.match(/\.([a-z0-9]+)$/i);
          const ext = extMatch ? extMatch[1].toUpperCase() : "FILE";
          const sizeKb = Math.max(1, Math.round((file.size || 0) / 1024));
          status.innerHTML = "";
          const ok = document.createElement("span");
          ok.className = "onboarding-status__check";
          ok.setAttribute("aria-hidden", "true");
          ok.textContent = "\u2713";
          const name = document.createElement("strong");
          name.className = "onboarding-status__filename";
          name.textContent = fullName;
          const meta = document.createElement("span");
          meta.className = "onboarding-status__meta";
          meta.textContent = ` · ${ext} · ${sizeKb.toLocaleString()} KB · ${text.length.toLocaleString()} characters extracted`;
          status.appendChild(ok);
          status.appendChild(document.createTextNode(" "));
          status.appendChild(name);
          status.appendChild(meta);
          status.classList.remove(
            "onboarding-status--error",
            "onboarding-status--loading",
          );
          status.classList.add("onboarding-status--ok");
        }
        updateOnboardingContinue2Enabled();
      } catch (err) {
        console.error(err);
        if (status) {
          status.innerHTML = "";
          status.textContent =
            (err && err.message) ||
            "Could not read that file. Try a different format, or paste the text below.";
          status.classList.remove(
            "onboarding-status--ok",
            "onboarding-status--loading",
          );
          status.classList.add("onboarding-status--error");
        }
      }
    });
  }

  if (pasteEl) {
    pasteEl.addEventListener("input", () => {
      // Step 1's button is onboardingContinue2 — both paths (file or paste)
      // must enable it. Bug fix: previously this called the Step 2 helper,
      // so paste-only users were stuck at "Step 1 of 3".
      updateOnboardingContinue2Enabled();
      const ingest = getResumeIngest();
      const raw = pasteEl.value || "";
      const text = ingest ? ingest.normalizeExtractedText(raw) : raw.trim();
      const status = document.getElementById("onboardingResumeStatus");
      if (text) {
        // Mirror the file-upload behavior: stage the draft so Continue uses it.
        onboardingResumeDraft = {
          source: "paste",
          rawMime: "text/plain",
          label: "Pasted resume",
          extractedText: text,
        };
        onboardingResumePath = "paste";
        if (status) {
          status.textContent = `Pasted resume captured (${text.length.toLocaleString()} characters).`;
          status.classList.remove("onboarding-status--error");
        }
        updateOnboardingContinue2Enabled();
      } else {
        // Empty textarea: drop any prior paste draft (but don't wipe a file
        // upload that may have been staged before the user opened the paste
        // disclosure).
        if (onboardingResumeDraft && onboardingResumeDraft.source === "paste") {
          onboardingResumeDraft = null;
          onboardingResumePath = null;
          updateOnboardingContinue2Enabled();
        }
        if (status) {
          status.textContent = "";
          status.classList.remove("onboarding-status--error");
        }
      }
    });
  }

  const onboardingSamplesIn = document.getElementById(
    "onboardingSamplesFileInput",
  );
  const onboardingSamplesStatus = document.getElementById(
    "onboardingSamplesStatus",
  );
  if (onboardingSamplesIn && onboardingSamplesStatus) {
    onboardingSamplesIn.addEventListener("change", () => {
      const n = onboardingSamplesIn.files
        ? onboardingSamplesIn.files.length
        : 0;
      onboardingSamplesStatus.textContent = n
        ? `${n} file(s) selected — will be added when you finish.`
        : "";
      onboardingSamplesStatus.classList.remove("onboarding-status--error");
    });
  }

  document
    .getElementById("onboardingFinish")
    ?.addEventListener("click", async () => {
      const UC = getUserContent();
      if (!UC || !onboardingResumeDraft) return;
      if (!String(onboardingResumeDraft.extractedText || "").trim()) {
        showToast("Resume text is missing — go back a step", "error");
        return;
      }
      const toneEl = document.getElementById("wizardPrefTone");
      const mwEl = document.getElementById("wizardPrefMaxWords");
      const voEl = document.getElementById("wizardPrefVoice");
      const maxWords = parseInt(mwEl && mwEl.value, 10);
      const finish = document.getElementById("onboardingFinish");
      if (finish) finish.disabled = true;
      try {
        await UC.setPrimaryResume(onboardingResumeDraft);
        // Merge Step 3's two remaining guided fields + optional pasted
        // career summary into a single AI context blob. Chip selections
        // from Step 2 are handled separately below (they go into the
        // discovery profile, not the AI context blob — keeps the two
        // surfaces decoupled).
        //
        // The previous "target role" textarea was consolidated out of
        // Step 3 — it duplicated the chip flow on Step 2 and forced users
        // to re-type what they had just clicked. Chips are the source of
        // truth; the discovery save below pulls from there.
        const strengthEl = document.getElementById("onboardingAiStrength");
        const avoidEl = document.getElementById("onboardingAiAvoid");
        const pastedEl = document.getElementById("onboardingAiContextText");
        const guidedParts = [];
        if (strengthEl && strengthEl.value.trim()) {
          guidedParts.push(`Superpower: ${strengthEl.value.trim()}`);
        }
        if (avoidEl && avoidEl.value.trim()) {
          guidedParts.push(`Avoid: ${avoidEl.value.trim()}`);
        }
        if (pastedEl && pastedEl.value.trim()) {
          guidedParts.push(pastedEl.value.trim());
        }
        const aiNorm = normalizeProfileTextInput(guidedParts.join("\n\n"));
        if (aiNorm && typeof UC.saveAdditionalContext === "function") {
          await UC.saveAdditionalContext({
            text: aiNorm,
            updatedAt: new Date().toISOString(),
          });
        }
        // Persist chip selections from Step 2 into the discovery profile.
        // Step 3 used to also have a free-text "target roles" textarea
        // that got merged here, but that surface was consolidated out —
        // chips are the only role-targeting input now.
        try {
          const chipRoles = onboardingGetSelectedRoles();
          const targetRoles = chipRoles
            .map((s) => String(s || "").trim())
            .filter(Boolean)
            .join(", ");
          if (targetRoles && typeof UC.saveDiscoveryProfile === "function") {
            await UC.saveDiscoveryProfile({ targetRoles });
          }
        } catch (chipErr) {
          // Non-fatal: discovery profile save failing shouldn't block
          // finishing onboarding. The user can edit it later in Settings.
          console.warn(
            "[JobBored] saveDiscoveryProfile from chips failed:",
            chipErr,
          );
        }
        await UC.savePreferences({
          tone: (toneEl && toneEl.value) || "warm",
          defaultMaxWords:
            !Number.isNaN(maxWords) && maxWords > 0 ? maxWords : 350,
          industriesToEmphasize: "",
          wordsToAvoid: "",
          voiceNotes: (voEl && voEl.value.trim()) || "",
        });
        await UC.completeOnboarding();
        hideOnboardingWizard();
        scheduleCandidateProfileMatchRefresh(true);
        onboardingResumeDraft = null;
        onboardingResumePath = null;
        // Celebrate the finish, then carry the user straight into discovery
        // setup (the next big step). advanceToDiscoveryAfterOnboarding refreshes
        // the "Finish setup" card and is idempotent — it only opens discovery
        // when it's still incomplete (and honors a queued pending setup first).
        playOnboardingCelebration(() => {
          void advanceToDiscoveryAfterOnboarding();
        });
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not save profile", "error");
      } finally {
        if (finish) finish.disabled = false;
      }
    });

  // Discovery setup gate (mandatory). Primary CTA re-opens the discovery
  // wizard; the confirm-gated escape writes discoverySetupSkipped and lets the
  // user through (the "Finish setup" card keeps nudging — skip != complete).
  document
    .getElementById("discoveryGateOpenWizard")
    ?.addEventListener("click", () => {
      hideDiscoveryGate();
      void advanceToDiscoveryAfterOnboarding();
    });
  document
    .getElementById("discoveryGateSkipEscape")
    ?.addEventListener("click", () => {
      const confirmed = typeof window.confirm === "function"
        ? window.confirm(
            "Skip discovery setup for now? You can finish it anytime from Settings. The app will work, but no jobs will be found until you connect discovery.",
          )
        : true;
      if (!confirmed) return;
      void (async () => {
        try {
          const UC = getUserContent();
          if (UC) {
            if (typeof UC.openDb === "function") await UC.openDb();
            if (typeof UC.setDiscoverySetupSkipped === "function") {
              await UC.setDiscoverySetupSkipped();
            }
          }
        } catch (e) {
          console.warn("[JobBored] discovery gate skip persist:", e);
        }
        hideDiscoveryGate();
      })();
    });
}

  Object.assign(onboarding, {
    ONBOARDING_TOTAL_STEPS,
    ONBOARDING_MASCOT_POSES,
    isOnboardingWizardVisible,
    hideOnboardingWizard,
    showOnboardingWizard,
    updateOnboardingProgressUI,
    syncOnboardingToneCards,
    renderOnboardingSummary,
    updateOnboardingMascotPose,
    setOnboardingStep,
    updateOnboardingContinue2Enabled,
    updateOnboardingNext3Enabled,
    checkOnboardingGate,
    ensureResumeDraftFromPasteStep,
    initOnboardingWizard,
    advanceToDiscoveryAfterOnboarding,
    playOnboardingCelebration,
  });
})();
