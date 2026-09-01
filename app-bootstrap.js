/* ============================================
   COMMAND CENTER v2 — App Bootstrap
   Extracted from app.js (app-bootstrap cut).

   Classic-global IIFE under window.JobBoredApp.bootstrap — NOT an ES module.
   Loaded BEFORE app.js (after discovery-run-orchestration.js).
   init(), initPipelineEmptyAndBriefActions(), DOMContentLoaded startup, and refresh poll.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const bootstrap = root.bootstrap || (root.bootstrap = {});

  function host() {
    return bootstrap.host || {};
  }

  function startupLog(label, detail, level = "info") {
    const logger = window.JobBoredStartupLog;
    if (logger && typeof logger.mark === "function") {
      logger.mark(label, detail, level);
      return;
    }
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "info";
    if (window.console && typeof console[method] === "function") {
      console[method]("[JobBored startup]", label, detail || "");
    }
  }

  function releaseAuthPrepaintGuard(reason) {
    const rootEl = document.documentElement;
    if (!rootEl.classList.contains("auth-prepaint-dashboard")) return;
    rootEl.classList.remove("auth-prepaint-dashboard");
    startupLog("bootstrap:auth-prepaint-released", { reason });
  }

  /**
   * A genuinely broken stored config keeps the login gate
   * (ONE-FLOW-ONBOARDING-SPEC §4: "keep the gate's error mode for
   * genuinely broken configs"). The demo board is the opening for a
   * config that is merely EMPTY — painting it over a real error would
   * hide the error behind sample data.
   */
  function sheetAccessGateIsInErrorMode() {
    const screen = document.getElementById("sheetAccessGateScreen");
    return !!(screen && screen.dataset && screen.dataset.gateMode === "error");
  }

  /**
   * Screen S0 (spec §4): a zero-config visitor sees the PRODUCT, seeded
   * with the bundled demo pipeline, before any credential ask. This is
   * what replaces the credential-first `no-oauth` opening — but if the
   * board module failed to load, a stranger must still be able to sign
   * in, so the login gate remains the honest fallback.
   */
  function mountOneFlowDemoBoard() {
    const board = window.JobBoredOneFlowDemoBoard;
    if (!board || typeof board.mount !== "function") {
      startupLog("bootstrap:init:demo-board-missing", {}, "warn");
      h("showSheetAccessGate", h("getOAuthClientId") ? "loading" : "no-oauth");
      return Promise.resolve(null);
    }
    return Promise.resolve(board.mount()).catch((e) => {
      startupLog(
        "bootstrap:init:demo-board-failed",
        { message: String((e && e.message) || e) },
        "warn",
      );
      return null;
    });
  }

  const missingHostWarnings = new Set();

  function h(name, ...args) {
    const currentHost = host();
    const fn = currentHost[name];
    if (typeof fn !== "function") {
      if (!missingHostWarnings.has(name)) {
        missingHostWarnings.add(name);
        startupLog(
          "bootstrap missing host function",
          {
            name,
            hasHost: !!bootstrap.host,
            hostKeys: Object.keys(currentHost).slice(0, 40),
          },
          "warn",
        );
      }
      return undefined;
    }
    return fn(...args);
  }

  const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

  function initPipelineEmptyAndBriefActions() {
    document
      .getElementById("emptyStateActions")
      ?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-empty-action]");
        if (!b) return;
        const a = b.getAttribute("data-empty-action");
        if (a === "settings" || a === "open_setup") {
          void h("requestDiscoverySetup", {
            entryPoint: "empty_state",
            allowWhileOnboarding: true,
          });
        }
        if (a === "run_discovery") {
          void h("triggerDiscoveryRun");
        }
      });
    document
      .querySelector(".daily-brief-panel")
      ?.addEventListener("click", (e) => {
        const rangeBtn = e.target.closest("[data-range]");
        if (rangeBtn) {
          window.JobBoredApp.brief.setBriefActivityRange(rangeBtn.dataset.range);
          const el = document.getElementById("briefInsights");
          const data = h("getPipelineData");
          if (el && data.length)
            el.innerHTML = h(
              "renderAreaWidget",
              data,
              window.JobBoredApp.brief.getBriefActivityRange(),
            );
          return;
        }
        const feedItem = e.target.closest(
          '[data-action="open-detail"][data-stable-key]',
        );
        if (feedItem) {
          const key = parseInt(feedItem.dataset.stableKey, 10);
          if (!Number.isNaN(key)) h("openJobDetail", key);
          return;
        }
        const b = e.target.closest("[data-brief-action]");
        if (!b) return;
        const a = b.getAttribute("data-brief-action");
        if (a === "settings" || a === "open_setup") {
          void h("requestDiscoverySetup", {
            entryPoint: "brief",
            allowWhileOnboarding: true,
          });
        }
        if (a === "run_discovery") {
          void h("triggerDiscoveryRun");
        }
        // "agent" / "paths" used to open the "ways to avoid webhooks" modal,
        // deleted with the other four (§7). The discovery wizard answers the
        // same question, so both land there too.
        if (a === "agent" || a === "paths") {
          void h("requestDiscoverySetup", {
            entryPoint: "brief",
            allowWhileOnboarding: true,
          });
        }
      });
  }

  function init() {
    startupLog("bootstrap:init:start", {
      readyState: document.readyState,
      hasHost: !!bootstrap.host,
    });
    releaseAuthPrepaintGuard("init-start");

    // Check config
    const configuredSheetId = h("getSheetId");
    h("setSHEET_ID", configuredSheetId);
    h("setInitialSheetAccessResolved", false);
    h("resetPostAccessBootstrap");
    h("initAuthUserMenu");

    // Wire the onboarding wizard + resume materials handlers UNCONDITIONALLY,
    // BEFORE the no-SHEET_ID early return below.
    //
    // Why: greenfield first-time users land here with no SHEET_ID, see the
    // onboarding modal, drop a resume — but until this call ran, the
    // file-input change listener wasn't bound, so the upload silently did
    // nothing. The user experienced this as "I have to refresh the page in
    // order for the file selector to put the file visibly into the UX" —
    // because by the time they refreshed, sign-in had set SHEET_ID and the
    // listener finally got bound on the second pass.
    //
    // initResumeMaterialsFeature is internally idempotent and has no sheet
    // dependency: it opens IndexedDB and wires modal/file listeners. Safe
    // to run pre-SHEET_ID.
    h("initResumeMaterialsFeature");
    h("initDiscoveryDrawer");
    h("initDiscoverySubtabs");
    h("initDiscoveryButton");

    if (!h("getSHEET_ID")) {
      startupLog("bootstrap:init:no-sheet-id", {
        configuredSheetIdState: configuredSheetId ? "present" : "missing",
        hasOAuthClientId: !!h("getOAuthClientId"),
      });
      // Give before you ask (spec §2.1 / §4): the cold-start surface is
      // the demo board, not a credential ask. The one-flow's Beat 1 owns
      // the Google sign-in and the sheet from there.
      document.getElementById("dashboard").style.display = "none";
      if (!sheetAccessGateIsInErrorMode()) {
        void mountOneFlowDemoBoard();
      }
      // Auth still wires up unconditionally: B1's `Continue with Google`
      // drives the same initAuth the login gate used to.
      h("initAuth");
      startupLog("bootstrap:init:early-return", {
        reason: "missing-sheet-id",
      });
      return;
    }

    /* Refresh flicker fix:
       - If we have a valid runtime token cached in localStorage, the
         dashboard is going to render in milliseconds. Show it RIGHT NOW
         (not after silent-restore + data load) so the page doesn't go
         blank between paint and revealDashboardShell(). The dashboard
         briefly shows whatever was last rendered/empty until loadAllData
         repaints — far less jarring than a flash of the login gate or
         a flash of nothing at all.
       - If we only have METADATA persisted (no valid runtime token),
         silent-restore is about to fire; still skip the gate "loading"
         splash so we don't flicker the login illustration on refresh.
       - If we have nothing persisted, show the gate "loading" splash
         so the user has something to look at on a true cold start.
       If silent-restore fails downstream, the error paths in
       initAuth/handleTokenResponse open the gate with the right mode. */
    const hasRuntimeToken = !!h("loadPersistedRuntimeOAuthSession");
    const hasPersistedSession = !!h("loadPersistedOAuthSession");
    startupLog("bootstrap:init:session-state", {
      hasRuntimeToken,
      hasPersistedSession,
    });
    if (hasRuntimeToken) {
      /* Eager reveal — silent-restore will finish in <500ms, then
         loadAllData repaints. Until then the dashboard shell is visible
         with last-known DOM state (or its first-paint defaults). */
      document.getElementById("dashboard").style.display = "block";
    } else {
      document.getElementById("dashboard").style.display = "none";
      if (!hasPersistedSession) {
        h("showSheetAccessGate", "loading");
      }
    }

    // Dashboard wordmark vs custom title
    const cfg = h("getConfig");
    if (cfg) {
      const effectiveTitle = cfg.title;
      document.title = effectiveTitle + " — Job Search Dashboard";
      const logoEl = document.getElementById("logoHorizontal");
      const titleEl = document.getElementById("dashboardTitle");
      const defaultTitle = "JobBored";
      if (effectiveTitle === defaultTitle) {
        logoEl?.removeAttribute("hidden");
        titleEl?.setAttribute("hidden", "");
      } else {
        logoEl?.setAttribute("hidden", "");
        titleEl?.removeAttribute("hidden");
        if (titleEl) titleEl.textContent = effectiveTitle;
      }
    }

    // Set sheet links
    h("setDashboardSheetLinks");

    void h("preloadDiscoveryUiState");
    h("resumeDiscoveryStatusPollingIfNeeded");

    // Sort
    document.getElementById("sortSelect").addEventListener("change", (e) => {
      h("setCurrentSort", e.target.value);
      h("renderPipeline");
    });

    // Search
    let searchTimeout;
    document.getElementById("searchInput").addEventListener("input", (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        h("setCurrentSearch", e.target.value.trim());
        h("renderPipeline");
      }, 200);
    });

    // Pipeline filter chips — favorites-only + show-dismissed
    const favChip = document.getElementById("favoritesOnlyChip");
    if (favChip) {
      favChip.addEventListener("click", () => {
        h("setPipelineViewFilters", { favoritesOnly: !h("getFavoritesOnly") });
      });
    }
    const dismissedChip = document.getElementById("showDismissedChip");
    if (dismissedChip) {
      dismissedChip.addEventListener("click", () => {
        h("setPipelineViewFilters", { showDismissed: !h("getShowDismissed") });
      });
    }
    h("syncPipelineFilterControls");
    h("initExpiredReviewUi");

    // Refresh
    document.getElementById("refreshBtn")?.addEventListener("click", () => {
      h("loadAllData");
    });

    // Init auth
    startupLog("bootstrap:init:auth-and-data-load");
    h("initAuth");

    // initResumeMaterialsFeature was hoisted above the no-SHEET_ID early
    // return so greenfield users can actually use the materials modal's file
    // upload. Calling it again here would double-bind every listener
    // (addEventListener doesn't dedupe), so don't.

    const shouldDeferDataLoadToAuth =
      (hasRuntimeToken || hasPersistedSession) && !h("getAccessToken");
    if (shouldDeferDataLoadToAuth) {
      startupLog("bootstrap:init:data-load-deferred-to-auth", {
        hasRuntimeToken,
        hasPersistedSession,
      });
    } else {
      h("loadAllData");
    }

    setInterval(() => h("loadAllData"), REFRESH_INTERVAL);
    startupLog("bootstrap:init:complete");
  }

  document.addEventListener("DOMContentLoaded", () => {
    startupLog("bootstrap:domcontentloaded", {
      readyState: document.readyState,
      hasHost: !!bootstrap.host,
    });
    h("initCommandCenterSettings");
    h("initSetupAndSheetAccessActions");
    h("initScraperSetupGuide");
    h("initDiscoverySetupGuide");
    initPipelineEmptyAndBriefActions();
    h("initIngestUrlFlow");
    init();
    startupLog("bootstrap:domcontentloaded:complete", {
      hasHost: !!bootstrap.host,
    });
  });

  // Integrator closure shim (sole claimant of jb:closure:change).
  // preventDefault() MUST run before the writer: a claimed-and-then-fallen-back
  // intent performs every closure twice. dismiss/restore/expire go through the
  // F1-A planner + applyCells; unexpire stays on updateJobStatus("Researching")
  // until the planner grows that action (SPEC §7).
  document.addEventListener("jb:closure:change", (e) => {
    const d = e.detail || {};
    const action = String(d.action || "").trim().toLowerCase();
    const jobKey = d.jobKey;
    const sheetsWrite = window.JobBoredApp && window.JobBoredApp.sheetsWrite;
    const planner = window.JobBoredPipelineTransitions;
    if (!sheetsWrite || !planner) return; // unclaimed: the surface falls back

    e.preventDefault();

    const fail = (reason) => {
      const event = new CustomEvent("jb:write:failed", {
        detail: {
          jobKey,
          kind: "pipeline:move",
          reason: String(reason || "closure-failed"),
        },
      });
      document.dispatchEvent(event);
      if (typeof window.dispatchEvent === "function") window.dispatchEvent(event);
    };

    if (action === "unexpire") {
      Promise.resolve(
        typeof window.updateJobStatus === "function"
          ? window.updateJobStatus(jobKey, "Researching")
          : sheetsWrite.updateJobStatus(jobKey, "Researching"),
      ).catch((err) => fail((err && err.message) || err));
      return;
    }

    const jobs = window.JobBored && typeof window.JobBored.getPipelineJobs === "function"
      ? window.JobBored.getPipelineJobs()
      : null;
    const job = jobs && jobs[Number(jobKey)];
    const sheetRow = sheetsWrite.getSheetRow(Number(jobKey));
    if (!job || !sheetRow) {
      fail("missing_row");
      return;
    }

    let planned;
    try {
      planned = planner.planTransition({
        action,
        row: {
          sheetRow,
          status: job.status || "",
          notes: job.notes || "",
          appliedDate: job.appliedDate || "",
          followUpDate: job.followUpDate || "",
          lastContact: job.lastHeardFrom || "",
          dismissedAt: job.dismissedAt || "",
        },
      });
    } catch (err) {
      fail((err && err.message) || err);
      return;
    }

    if (!planned || planned.ok === false) {
      fail((planned && (planned.code || planned.message)) || "plan_failed");
      return;
    }

    Promise.resolve(sheetsWrite.applyCells(planned.patches)).then((ok) => {
      if (ok === false) fail("applyCells_failed");
    }).catch((err) => fail((err && err.message) || err));
  });

  Object.assign(bootstrap, {
    initPipelineEmptyAndBriefActions,
    init,
    REFRESH_INTERVAL,
  });
})();
