/* ============================================
   COMMAND CENTER v2 — Discovery Run Tracker
   Extracted from app.js (discovery-run-tracker cut).

   Classic-global IIFE under window.JobBoredDiscovery.runTracker — NOT an ES module.
   Loaded BEFORE app.js. Async discovery run lifecycle state machine.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const runTracker = root.runTracker || (root.runTracker = {});

  const DISCOVERY_RUN_TRACKER_KEY = "command_center_discovery_run_state";
  const MAX_POLL_ERRORS = 3;

  function dispatchDiscoveryRunTrackerEvent(state) {
    try {
      if (typeof document === "undefined") return;
      if (typeof CustomEvent !== "function") return;
      document.dispatchEvent(
        new CustomEvent("jobbored:job-discovery-run-updated", {
          detail: { state: { ...(state || {}) } },
        }),
      );
    } catch (_) {
      // Best-effort UI bridge for runs-tab.js.
    }
  }

  /**
   * Browser-side state machine for async discovery run lifecycle.
   * Persists run handle so refresh/reopen can recover tracking.
   *
   * Valid states and transitions:
   *   idle -> pending   (triggerDiscoveryRun succeeds with accepted_async)
   *   idle -> failed    (triggerDiscoveryRun fails at network level)
   *   pending -> running (first poll returns non-terminal status)
   *   pending -> failed  (polling fails with non-retryable error)
   *   running -> completed (poll returns terminal:completed/empty)
   *   running -> partial   (poll returns terminal:partial)
   *   running -> failed    (poll returns terminal:failed)
   *   running -> polling_error (retryable network error)
   *   polling_error -> running (retry succeeds)
   *   polling_error -> failed   (retries exhausted)
   *
   * A runId that has reached terminal state (completed/empty/partial/failed)
   * is preserved in storage so refresh/reopen can still show the outcome.
   */
  class DiscoveryRunTracker {
    constructor(storageKey = DISCOVERY_RUN_TRACKER_KEY) {
      this._key = storageKey;
      this._state = this._load();
    }

    _load() {
      try {
        const raw = localStorage.getItem(this._key);
        if (!raw) return this._idle();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return this._idle();
        // Re-hydrate with defaults for missing fields
        return {
          status: parsed.status || "idle",
          runId: parsed.runId || "",
          statusPath: parsed.statusPath || "",
          pollAfterMs: parsed.pollAfterMs || 2000,
          webhookUrl: parsed.webhookUrl || "",
          initiatedAt: parsed.initiatedAt || "",
          terminalAt: parsed.terminalAt || "",
          terminalKind: parsed.terminalKind || "", // completed|empty|partial|failed
          errorMessage: parsed.errorMessage || "",
          pollErrorCount: parsed.pollErrorCount || 0,
          lastPollAt: parsed.lastPollAt || "",
          trigger: parsed.trigger || "manual",
          variationKey: parsed.variationKey || "",
          requestedAt: parsed.requestedAt || "",
          message: parsed.message || "",
          startedAt: parsed.startedAt || "",
          completedAt: parsed.completedAt || "",
          companiesSeen: Number.isFinite(parsed.companiesSeen)
            ? parsed.companiesSeen
            : 0,
          leadsWritten: Number.isFinite(parsed.leadsWritten)
            ? parsed.leadsWritten
            : 0,
          leadsUpdated: Number.isFinite(parsed.leadsUpdated)
            ? parsed.leadsUpdated
            : 0,
          statusUnavailable: !!parsed.statusUnavailable,
          terminalAcknowledged: !!parsed.terminalAcknowledged,
        };
      } catch (_) {
        return this._idle();
      }
    }

    _persist(state) {
      try {
        localStorage.setItem(this._key, JSON.stringify(state));
      } catch (_) {
        /* storage full or unavailable — run state is best-effort */
      }
      dispatchDiscoveryRunTrackerEvent(state);
    }

    _idle() {
      return {
        status: "idle",
        runId: "",
        statusPath: "",
        pollAfterMs: 2000,
        webhookUrl: "",
        initiatedAt: "",
        terminalAt: "",
        terminalKind: "",
        errorMessage: "",
        pollErrorCount: 0,
        lastPollAt: "",
        trigger: "manual",
        variationKey: "",
        requestedAt: "",
        message: "",
        startedAt: "",
        completedAt: "",
        companiesSeen: 0,
        leadsWritten: 0,
        leadsUpdated: 0,
        statusUnavailable: false,
        terminalAcknowledged: false,
      };
    }

    /** Current immutable snapshot for UI reads */
    getState() {
      return { ...this._state };
    }

    /**
     * Begin tracking an async run that was accepted by the discovery worker.
     * @param {object} options
     * @param {string} options.runId
     * @param {string} [options.statusPath]  e.g. "/runs/run_abc123"
     * @param {number} [options.pollAfterMs] polling interval in ms (default 2000)
     * @param {string} [options.webhookUrl]  the webhook URL for status polling
     */
    beginTracking({
      runId,
      statusPath = "",
      pollAfterMs = 2000,
      webhookUrl = "",
      trigger = "manual",
      variationKey = "",
      requestedAt = "",
      statusUnavailable = false,
    }) {
      this._state = {
        status: "pending",
        runId: String(runId || "").trim(),
        statusPath: String(statusPath || "").trim(),
        pollAfterMs: Number.isFinite(pollAfterMs) ? pollAfterMs : 2000,
        webhookUrl: String(webhookUrl || "").trim(),
        initiatedAt: new Date().toISOString(),
        terminalAt: "",
        terminalKind: "",
        errorMessage: "",
        pollErrorCount: 0,
        lastPollAt: "",
        trigger: String(trigger || "manual"),
        variationKey: String(variationKey || "").trim(),
        requestedAt: String(requestedAt || "").trim(),
        message: "",
        startedAt: "",
        completedAt: "",
        companiesSeen: 0,
        leadsWritten: 0,
        leadsUpdated: 0,
        statusUnavailable: !!statusUnavailable,
        terminalAcknowledged: false,
      };
      this._persist(this._state);
      return this;
    }

    /** Transition from pending → running on first poll confirmation */
    markRunning() {
      if (this._state.status !== "pending") return this;
      this._state.status = "running";
      this._persist(this._state);
      return this;
    }

    /**
     * Called on each poll response.
     * @param {object} statusData  parsed /runs/{runId} JSON body
     */
    updateFromStatusResponse(statusData) {
      if (!statusData || typeof statusData !== "object") return this;
      this._state.lastPollAt = new Date().toISOString();
      this._state.statusUnavailable = false;
      const isTerminal = !!statusData.terminal;
      const runStatus = String(statusData.status || "").toLowerCase();
      const request = statusData.request && typeof statusData.request === "object"
        ? statusData.request
        : {};
      const lifecycle =
        statusData.lifecycle && typeof statusData.lifecycle === "object"
          ? statusData.lifecycle
          : {};
      const writeResult =
        statusData.writeResult && typeof statusData.writeResult === "object"
          ? statusData.writeResult
          : {};
      this._state.trigger = String(statusData.trigger || this._state.trigger || "manual");
      this._state.variationKey = String(
        request.variationKey || this._state.variationKey || "",
      );
      this._state.requestedAt = String(
        request.requestedAt || this._state.requestedAt || "",
      );
      this._state.message = String(statusData.message || this._state.message || "");
      this._state.startedAt = String(statusData.startedAt || this._state.startedAt || "");
      this._state.completedAt = String(statusData.completedAt || "");
      if (Number.isFinite(lifecycle.companyCount)) {
        this._state.companiesSeen = lifecycle.companyCount;
      }
      if (Number.isFinite(writeResult.appended)) {
        this._state.leadsWritten = writeResult.appended;
      }
      if (Number.isFinite(writeResult.updated)) {
        this._state.leadsUpdated = writeResult.updated;
      }
      if (isTerminal) {
        this._state.status = runStatus; // completed | empty | partial | failed
        this._state.terminalAt = new Date().toISOString();
        this._state.terminalKind = runStatus;
        this._state.errorMessage = String(statusData.error || statusData.message || "");
        this._persist(this._state);
        return this;
      }
      // Non-terminal: ensure we're in running, not stuck in pending
      if (this._state.status === "pending") {
        this._state.status = "running";
      }
      this._state.pollErrorCount = 0; // reset on successful poll
      this._persist(this._state);
      return this;
    }

    /** Called when polling itself fails (network error, timeout, non-2xx). */
    markPollError(errorMessage = "") {
      this._state.pollErrorCount = (this._state.pollErrorCount || 0) + 1;
      this._state.lastPollAt = new Date().toISOString();
      this._state.errorMessage = String(errorMessage || "Polling failed");
      this._state.statusUnavailable = true;
      // Transition to polling_error state if we've been in running/pending
      if (this._state.status === "running" || this._state.status === "pending") {
        this._state.status = "polling_error";
      }
      this._persist(this._state);
      return this;
    }

    /** Stop retrying status fetches without marking the worker run failed. */
    markStatusConnectionLost(errorMessage = "") {
      this._state.pollErrorCount = Math.max(
        this._state.pollErrorCount || 0,
        MAX_POLL_ERRORS,
      );
      this._state.lastPollAt = new Date().toISOString();
      this._state.errorMessage = String(
        errorMessage || "Status connection unavailable",
      );
      if (this._state.runId) this._state.status = "polling_error";
      this._state.statusUnavailable = true;
      this._persist(this._state);
      return this;
    }

    /** Retry after polling error — back to running if we have a runId */
    resumeFromPollError() {
      if (this._state.status !== "polling_error") return this;
      this._state.status = this._state.runId ? "running" : "idle";
      this._state.pollErrorCount = 0;
      this._state.statusUnavailable = false;
      this._persist(this._state);
      return this;
    }

    /** Retry a terminal failure that was caused by status polling, not the run. */
    resumeFromStatusPollingFailure() {
      if (this._state.status !== "failed") return this;
      if (!/status polling failed/i.test(String(this._state.errorMessage || ""))) {
        return this;
      }
      this._state.status = this._state.runId ? "running" : "idle";
      this._state.terminalAt = "";
      this._state.terminalKind = "";
      this._state.errorMessage = "";
      this._state.pollErrorCount = 0;
      this._state.statusUnavailable = false;
      this._persist(this._state);
      return this;
    }

    /** Mark the run as failed with an explicit error message (non-poll-error path). */
    markFailed(errorMessage = "") {
      this._state.status = "failed";
      this._state.terminalAt = new Date().toISOString();
      this._state.terminalKind = "failed";
      this._state.errorMessage = String(errorMessage || "Run failed");
      this._state.statusUnavailable = false;
      this._persist(this._state);
      return this;
    }

    /**
     * Mark the persisted terminal outcome as shown to the user, so a later
     * reload doesn't re-toast it. The state itself is preserved (the Runs
     * modal still reads it); only the one-time surfacing is suppressed.
     */
    acknowledgeTerminalOutcome() {
      if (!this.isTerminal()) return this;
      if (this._state.terminalAcknowledged) return this;
      this._state.terminalAcknowledged = true;
      this._persist(this._state);
      return this;
    }

    /** Clear any active run — used after user explicitly dismisses or run is stale. */
    clear() {
      this._state = this._idle();
      try {
        localStorage.removeItem(this._key);
      } catch (_) {}
      dispatchDiscoveryRunTrackerEvent(this._state);
      return this;
    }

    /** True when there is an in-progress run that should show UI feedback. */
    isActive() {
      return ["pending", "running", "polling_error"].includes(this._state.status);
    }

    /** True when the run has reached a terminal state (completed/empty/partial/failed). */
    isTerminal() {
      return ["completed", "empty", "partial", "failed"].includes(this._state.status);
    }

    /** True when status polling is in an error state that might recover. */
    isPollingError() {
      return this._state.status === "polling_error";
    }
  }

  /** Shared singleton — initialized once at module load */
  const discoveryRunTracker = new DiscoveryRunTracker();

  Object.assign(runTracker, {
    DISCOVERY_RUN_TRACKER_KEY,
    MAX_POLL_ERRORS,
    DiscoveryRunTracker,
    discoveryRunTracker,
    dispatchDiscoveryRunTrackerEvent,
  });
})();
