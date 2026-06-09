/* ============================================
   COMMAND CENTER v2 — "What's next" dashboard banner

   Classic-global IIFE under window.JobBoredApp.whatsNextBanner — NOT an
   ES module. Loaded AFTER first-run-wizard.js, BEFORE app.js. Owns the
   dismissible progressive-disclosure banner that surfaces the two
   OPTIONAL "what's next" steps after the first-run infra wizard is
   finished (VAL-SIGN-001 / VAL-SIGN-002).

   Visibility rule (VAL-SIGN-002): the banner renders ONLY when
   infraSetupComplete is true AND whatsNextDismissed is false AND
   UC.isOnboardingComplete() is true. The third gate ensures the banner
   never competes with the separate profile wizard
   (onboarding-wizard.js), which takes the full-viewport surface after
   the infra wizard finishes.

   Completion-awareness (FE-3): the banner reads two more flags —
   discoverySetupComplete and goLiveSetupComplete — and hides the
   matching CTA once its track is done, marking the remaining one as
   the recommended next step. When BOTH tracks are complete the banner
   hides entirely, so finishing either order surfaces the other path.

   The two CTA buttons share their handlers with the in-wizard terminal
   #firstRunPanelDone so the destinations stay consistent across
   surfaces. Dismiss writes the persisted flag and hides the section
   permanently; the flag survives reloads via user-content-store.js's
   settings store.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const banner = root.whatsNextBanner || (root.whatsNextBanner = {});

  const REGION_SELECTOR = '[data-region="whats-next"]';

  // Session-scoped "Later" snooze. While either setup track is pending the
  // bar is non-dismissible EXCEPT this snooze, which hides it for the
  // current session only (sessionStorage, cleared on next load) — NOT the
  // permanent whatsNextDismissed flag.
  const SESSION_SNOOZE_KEY = "jobbored.whatsNext.snoozed";
  function isSessionSnoozed() {
    try {
      return window.sessionStorage.getItem(SESSION_SNOOZE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }
  function setSessionSnoozed() {
    try {
      window.sessionStorage.setItem(SESSION_SNOOZE_KEY, "1");
    } catch (_) {
      /* sessionStorage unavailable → snooze is best-effort */
    }
  }

  function getEl(id) {
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  }

  // Onboarding funnel telemetry — best-effort, looked up lazily so a missing
  // module never breaks the bar. See onboarding-telemetry.js.
  function emitOnboardingEvent(step, detail) {
    try {
      const t = window.JobBoredOnboardingTelemetry;
      if (t && typeof t.emit === "function") t.emit(step, detail);
    } catch (_) {
      /* telemetry is non-critical */
    }
  }

  function getRegion() {
    if (typeof document === "undefined") return null;
    if (typeof document.querySelector !== "function") return null;
    return document.querySelector(REGION_SELECTOR);
  }

  function hideBanner() {
    const region = getRegion();
    if (!region) return;
    region.setAttribute("hidden", "hidden");
    region.setAttribute("aria-hidden", "true");
  }

  function showBanner() {
    const region = getRegion();
    if (!region) return;
    region.removeAttribute("hidden");
    region.setAttribute("aria-hidden", "false");
  }

  function isBannerVisible() {
    const region = getRegion();
    if (!region) return false;
    return !region.hasAttribute("hidden");
  }

  /**
   * Read the gating state from the user content store. Returns null when
   * the store is unavailable (treat as "do not render" — the banner is
   * an opt-in signpost, never a hard requirement).
   */
  async function readGateState() {
    const host =
      (window.JobBoredApp && window.JobBoredApp.core && window.JobBoredApp.core.host) ||
      null;
    const UC = host && typeof host.getUserContent === "function"
      ? host.getUserContent()
      : null;
    if (!UC) return null;
    try {
      if (typeof UC.openDb === "function") await UC.openDb();
    } catch (_) {
      // openDb's 5s watchdog will reject on a wedged DB; we treat that as
      // "unknown" and stay hidden — the banner is non-critical.
      return null;
    }
    const out = {
      infraComplete: false,
      dismissed: false,
      onboardingComplete: false,
      discoveryComplete: false,
      goLiveComplete: false,
    };
    try {
      out.infraComplete = !!(typeof UC.isInfraSetupComplete === "function"
        ? await UC.isInfraSetupComplete()
        : false);
    } catch (_) {
      out.infraComplete = false;
    }
    try {
      out.dismissed = !!(typeof UC.getWhatsNextDismissed === "function"
        ? await UC.getWhatsNextDismissed()
        : false);
    } catch (_) {
      out.dismissed = false;
    }
    try {
      out.onboardingComplete = !!(typeof UC.isOnboardingComplete === "function"
        ? await UC.isOnboardingComplete()
        : false);
    } catch (_) {
      out.onboardingComplete = false;
    }
    try {
      out.discoveryComplete = !!(typeof UC.isDiscoverySetupComplete === "function"
        ? await UC.isDiscoverySetupComplete()
        : false);
    } catch (_) {
      out.discoveryComplete = false;
    }
    try {
      out.goLiveComplete = !!(typeof UC.isGoLiveSetupComplete === "function"
        ? await UC.isGoLiveSetupComplete()
        : false);
    } catch (_) {
      out.goLiveComplete = false;
    }
    return out;
  }

  function shouldRenderBanner(state) {
    if (!state) return false;
    // A session "Later" snooze hides the bar regardless of progress, until
    // the next load (or until both tracks complete and the bar self-hides).
    if (isSessionSnoozed()) return false;
    if (
      state.infraComplete !== true ||
      state.dismissed !== false ||
      state.onboardingComplete !== true
    ) {
      return false;
    }
    // Hide entirely when both tracks are complete — finishing either order
    // leaves the other still surfaced until it's done too.
    if (state.discoveryComplete === true && state.goLiveComplete === true) {
      return false;
    }
    return true;
  }

  const RECOMMENDED_CTA_CLASS = "whats-next-banner__cta--recommended";

  /**
   * Toggle per-track CTA visibility + the "recommended next" marker.
   * Done in-place on the existing buttons (FE-1 owns index.html; we
   * never inject markup here) so absent IDs stay no-ops.
   */
  function applyCompletionPresentation(state) {
    const discoveryBtn = getEl("whatsNextOpenDiscovery");
    const selfHostingBtn = getEl("whatsNextOpenSelfHosting");
    const discoveryDone = !!(state && state.discoveryComplete);
    const goLiveDone = !!(state && state.goLiveComplete);

    if (discoveryBtn) {
      if (discoveryDone) {
        discoveryBtn.setAttribute("hidden", "hidden");
        discoveryBtn.setAttribute("aria-hidden", "true");
      } else {
        discoveryBtn.removeAttribute("hidden");
        discoveryBtn.removeAttribute("aria-hidden");
      }
    }
    if (selfHostingBtn) {
      if (goLiveDone) {
        selfHostingBtn.setAttribute("hidden", "hidden");
        selfHostingBtn.setAttribute("aria-hidden", "true");
      } else {
        selfHostingBtn.removeAttribute("hidden");
        selfHostingBtn.removeAttribute("aria-hidden");
      }
    }

    // Only one track left → mark it as the recommended next step. When
    // both are still pending or both are done the marker comes off (the
    // region is hidden in the both-done case anyway).
    const onlyDiscoveryLeft = !discoveryDone && goLiveDone;
    const onlySelfHostingLeft = discoveryDone && !goLiveDone;
    const toggleRecommended = (el, on) => {
      if (!el || !el.classList) return;
      if (on) el.classList.add(RECOMMENDED_CTA_CLASS);
      else el.classList.remove(RECOMMENDED_CTA_CLASS);
    };
    toggleRecommended(discoveryBtn, onlyDiscoveryLeft);
    toggleRecommended(selfHostingBtn, onlySelfHostingLeft);

    // Mandatory two-track onboarding: surface the "Finish setup — N of 2
    // complete" progress text and the session-only "Later" escape. Both
    // are no-ops when their elements are absent (FE-1 owns index.html).
    const done = (discoveryDone ? 1 : 0) + (goLiveDone ? 1 : 0);
    const progressEl = getEl("whatsNextSetupProgress");
    if (progressEl) {
      progressEl.textContent = `Finish setup — ${done} of 2 complete`;
      progressEl.removeAttribute("hidden");
    }
    const laterEl = getEl("whatsNextLater");
    if (laterEl) laterEl.removeAttribute("hidden");
  }

  /**
   * Re-evaluate the gating and apply visibility. Safe to call multiple
   * times; cheap when the state hasn't changed. Used by init to set the
   * initial visibility and by re-render hooks (e.g. after the profile
   * wizard finishes — the onboardingComplete gate flips then).
   */
  async function refreshBanner() {
    const state = await readGateState();
    if (shouldRenderBanner(state)) {
      applyCompletionPresentation(state);
      showBanner();
    } else {
      hideBanner();
    }
    return state;
  }

  /**
   * Dismiss handler — writes the persisted flag (so reloads stay clean)
   * and hides the banner immediately. The IndexedDB write is fire-and-
   * forget: the banner is already hidden in the DOM, so a slow write
   * never blocks the user's UI.
   */
  async function handleDismiss() {
    hideBanner();
    try {
      const host =
        (window.JobBoredApp && window.JobBoredApp.core && window.JobBoredApp.core.host) ||
        null;
      const UC = host && typeof host.getUserContent === "function"
        ? host.getUserContent()
        : null;
      if (
        UC &&
        typeof UC.openDb === "function" &&
        typeof UC.setWhatsNextDismissed === "function"
      ) {
        await UC.openDb();
        await UC.setWhatsNextDismissed(true);
      }
    } catch (e) {
      console.warn("[JobBored] whats-next dismiss:", e);
    }
  }

  /**
   * Session "Later" handler — snoozes the setup-progress bar for the
   * current session only (sessionStorage) and hides it immediately. Unlike
   * handleDismiss it writes NO persisted flag, so the bar returns on the
   * next load until both tracks are complete.
   */
  function handleLater() {
    emitOnboardingEvent("later_pressed");
    setSessionSnoozed();
    hideBanner();
  }

  /**
   * "Turn on job discovery" CTA — opens the guided discovery setup
   * wizard via the shared host.requestDiscoverySetup. Both wizards are
   * already closed on the dashboard path (no deferral race), so a plain
   * call is correct here.
   */
  function handleOpenDiscovery() {
    const host =
      (window.JobBoredApp && window.JobBoredApp.core && window.JobBoredApp.core.host) ||
      null;
    if (host && typeof host.requestDiscoverySetup === "function") {
      try {
        void host.requestDiscoverySetup({ entryPoint: "whats_next" });
        return;
      } catch (e) {
        console.warn("[JobBored] whats-next discovery:", e);
      }
    }
    if (typeof window.requestDiscoverySetup === "function") {
      try {
        void window.requestDiscoverySetup({ entryPoint: "whats_next" });
      } catch (e) {
        console.warn("[JobBored] whats-next discovery (global):", e);
      }
    }
  }

  /**
   * "Use JobBored on other devices" CTA — launches the go-live wizard
   * (the two-path Tailscale/cloud flow). The dashboard is already
   * revealed when the banner is visible (its gate requires onboarding
   * to be complete), so no surface-handoff is needed before the call.
   * The banner stays on screen so the user can still dismiss it or
   * pick the other CTA after the wizard finishes.
   */
  function handleOpenSelfHosting() {
    const host =
      (window.JobBoredApp && window.JobBoredApp.core && window.JobBoredApp.core.host) ||
      null;
    if (host && typeof host.requestGoLiveSetup === "function") {
      try {
        void host.requestGoLiveSetup({ entryPoint: "whats_next" });
        return;
      } catch (e) {
        console.warn("[JobBored] whats-next go-live:", e);
      }
    }
    if (typeof window.requestGoLiveSetup === "function") {
      try {
        void window.requestGoLiveSetup({ entryPoint: "whats_next" });
      } catch (e) {
        console.warn("[JobBored] whats-next go-live (global):", e);
      }
    }
  }

  /**
   * Wire the three buttons (discovery / self-hosting / dismiss). One-shot
   * guard mirrors the first-run wizard's pattern: re-init never doubles up.
   */
  let listenersWired = false;
  function wireListeners() {
    if (listenersWired || typeof document === "undefined") return;
    const region = getRegion();
    if (!region) return;
    listenersWired = true;
    getEl("whatsNextOpenDiscovery")?.addEventListener("click", () => {
      handleOpenDiscovery();
    });
    getEl("whatsNextOpenSelfHosting")?.addEventListener("click", () => {
      handleOpenSelfHosting();
    });
    getEl("whatsNextDismiss")?.addEventListener("click", () => {
      void handleDismiss();
    });
    getEl("whatsNextLater")?.addEventListener("click", () => {
      handleLater();
    });
  }

  function init() {
    wireListeners();
    // Always re-evaluate on init; the gating is read fresh each time
    // (infraComplete / dismissed / onboardingComplete all come from the
    // IndexedDB-backed user content store). The async work is bounded by
    // openDb's 5s watchdog.
    void refreshBanner();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  Object.assign(banner, {
    init,
    refreshBanner,
    showBanner,
    hideBanner,
    isBannerVisible,
    handleDismiss,
    handleLater,
    handleOpenDiscovery,
    handleOpenSelfHosting,
  });
})();
