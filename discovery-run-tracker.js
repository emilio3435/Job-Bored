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
  const DEFAULT_PER_POLL_TIMEOUT_MS = 8000;
  // §0.4/§0.11: the scrape is massive, so the browser watches a run for as
  // long as the worker may run it — the worker's default maxRunDurationMs —
  // plus a grace that covers the worker's own safety timer (at most 30 s past
  // the budget) and a few polls to read the terminal status it writes.
  const DEFAULT_MAX_RUN_DURATION_MS = 3 * 60 * 60 * 1000;
  const RUN_DEADLINE_GRACE_MS = 5 * 60 * 1000;
  const DEFAULT_OVERALL_POLL_DEADLINE_MS =
    DEFAULT_MAX_RUN_DURATION_MS + RUN_DEADLINE_GRACE_MS;
  // D13 (§1b.9): the one channel tabs use to share a discovery run.
  const DISCOVERY_RUN_CHANNEL = "jb-discovery-run";
  const DISCOVERY_RUN_TAB_ID =
    typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function"
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("")
      : Math.random().toString(16).slice(2);

  function createAbortablePollSession() {
    let generation = 0;
    let overallController = null;
    let overallTimer = null;
    const pollControllers = new Set();

    function abortInFlight() {
      for (const controller of pollControllers) {
        try {
          controller.abort();
        } catch (_) {}
      }
      pollControllers.clear();
    }

    function abortAll() {
      abortInFlight();
      if (overallTimer) {
        clearTimeout(overallTimer);
        overallTimer = null;
      }
      if (overallController) {
        try {
          overallController.abort();
        } catch (_) {}
      }
    }

    return {
      bumpGeneration() {
        generation += 1;
        abortInFlight();
        return generation;
      },
      getGeneration() {
        return generation;
      },
      createPollSignal(timeoutMs) {
        const controller = new AbortController();
        pollControllers.add(controller);
        const ms = Number(timeoutMs);
        let timer = null;
        if (Number.isFinite(ms) && ms > 0) {
          timer = setTimeout(() => {
            try {
              controller.abort();
            } catch (_) {}
          }, ms);
        }
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          pollControllers.delete(controller);
        };
        if (controller.signal && typeof controller.signal.addEventListener === "function") {
          controller.signal.addEventListener("abort", cleanup, { once: true });
        }
        if (overallController && overallController.signal.aborted) {
          controller.abort();
        } else if (
          overallController &&
          overallController.signal &&
          typeof overallController.signal.addEventListener === "function"
        ) {
          overallController.signal.addEventListener(
            "abort",
            () => {
              try {
                controller.abort();
              } catch (_) {}
            },
            { once: true },
          );
        }
        // done(): the poll answered — drop its timer so it cannot fire late.
        return { signal: controller.signal, generation, done: cleanup };
      },
      startOverallDeadline(timeoutMs) {
        if (overallController) {
          try {
            overallController.abort();
          } catch (_) {}
        }
        overallController = new AbortController();
        const ms = Number(timeoutMs);
        if (Number.isFinite(ms) && ms > 0) {
          overallTimer = setTimeout(() => {
            try {
              overallController.abort();
            } catch (_) {}
          }, ms);
        }
        return { signal: overallController.signal, generation };
      },
      abortAll,
      abortInFlight,
      isCurrent(generationSnapshot) {
        return (
          generationSnapshot === generation &&
          !(overallController && overallController.signal && overallController.signal.aborted)
        );
      },
    };
  }

  /* ------------------------------------------------------------------
     Live run progress — the reader side of the AGREED CONTRACT between
     UXD-FE and UXD-BE (2026-09-26). GET /runs/:id carries `progress`
     { phase, sequence, checkpointedAt, heartbeatAt?, counters?, current?,
     sources? }. Absent fields mean "no data", never zero, so every surface
     renders only what the worker sent. One view-model, three homes: the
     Runs live row, the discovery drawer card and #discoveryBtn's label.
     ------------------------------------------------------------------ */

  const RUN_PROGRESS_COUNTER_KEYS = [
    "companiesTotal",
    "companiesDone",
    "boardsDetected",
    "listingsSeen",
    "listingsProcessed",
    "leadsQualified",
    "matcherCalls",
    "queriesTotal",
    "queriesDone",
  ];
  const RUN_PROGRESS_CURRENT_KINDS = ["company", "source", "query"];
  const RUN_PROGRESS_SOURCE_STATES = ["pending", "running", "done", "skipped"];
  const RUN_PROGRESS_MAX_SOURCES = 8;
  const RUN_PROGRESS_MAX_LABEL = 80;
  // Reader-clock bands from the contract: <=30s working, 30–120s quiet,
  // >120s "may have stopped" (only for heartbeat-bearing workers).
  const RUN_PROGRESS_FRESH_MS = 30 * 1000;
  const RUN_PROGRESS_STALL_MS = 120 * 1000;

  const RUN_PROGRESS_STEPS = [
    { key: "scout", label: "Search" },
    { key: "score", label: "Score" },
    { key: "exploit", label: "Refine" },
    { key: "write", label: "Save" },
    { key: "learn", label: "Learn" },
  ];
  const RUN_PROGRESS_PHASE_HEADLINES = {
    initializing: "Getting started",
    scout: "Looking for jobs",
    score: "Scoring what turned up",
    exploit: "Picking the strongest matches",
    write: "Saving to your Pipeline",
    learn: "Tuning the next search",
  };
  const RUN_PROGRESS_SOURCE_LABELS = {
    ats: "Company job boards",
    serpapi_google_jobs: "Google Jobs",
    greenhouse: "Greenhouse",
    lever: "Lever",
    ashby: "Ashby",
    workday: "Workday",
    smartrecruiters: "SmartRecruiters",
    grounded_web: "Web search",
    grounded_search: "Web search",
  };
  const RUN_PROGRESS_COUNTER_LABELS = [
    ["listingsSeen", "Listings found"],
    ["listingsProcessed", "Listings checked"],
    ["leadsQualified", "Leads kept"],
    ["boardsDetected", "Job boards"],
    ["matcherCalls", "AI checks"],
  ];

  function cleanRunProgressLabel(value) {
    if (typeof value !== "string") return "";
    const text = value.replace(/\s+/g, " ").trim();
    if (!text || text.length > RUN_PROGRESS_MAX_LABEL) return "";
    // The contract promises no URLs; refuse one rather than print it.
    if (/:\/\/|^www\./i.test(text)) return "";
    return text;
  }

  function cleanRunProgressCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function positiveMs(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  const FILTER_STATS_MAX_KEYWORDS = 20;

  /**
   * DISCAT D9: lifecycle.filterStats from GET /runs/:id, typed and bounded.
   * Null when absent (runs from before DISCAT) or unusable.
   */
  function sanitizeFilterStats(raw) {
    if (!raw || typeof raw !== "object") return null;
    const listingsSeen = cleanRunProgressCount(raw.listingsSeen);
    if (listingsSeen === null) return null;
    const byReason = {};
    if (raw.byReason && typeof raw.byReason === "object") {
      for (const [reason, count] of Object.entries(raw.byReason)) {
        const n = cleanRunProgressCount(count);
        if (n !== null) byReason[String(reason).slice(0, 40)] = n;
      }
    }
    const byExcludeKeyword = [];
    if (Array.isArray(raw.byExcludeKeyword)) {
      for (const entry of raw.byExcludeKeyword) {
        if (byExcludeKeyword.length >= FILTER_STATS_MAX_KEYWORDS) break;
        if (!entry || typeof entry !== "object") continue;
        const keyword = typeof entry.keyword === "string" ? entry.keyword.trim().slice(0, 80) : "";
        const count = cleanRunProgressCount(entry.count);
        if (keyword && count !== null) byExcludeKeyword.push({ keyword, count });
      }
    }
    return {
      listingsSeen,
      listingsRejected: cleanRunProgressCount(raw.listingsRejected) ?? 0,
      byReason,
      byExcludeKeyword,
    };
  }

  /** Keep only contract fields, typed and bounded. Null when unusable. */
  function sanitizeRunProgress(raw) {
    if (!raw || typeof raw !== "object") return null;
    const sequence = Number(raw.sequence);
    if (!Number.isInteger(sequence) || sequence < 1) return null;
    const out = {
      phase: typeof raw.phase === "string" ? raw.phase.slice(0, 40) : "",
      sequence,
      checkpointedAt: typeof raw.checkpointedAt === "string" ? raw.checkpointedAt : "",
      heartbeatAt: typeof raw.heartbeatAt === "string" ? raw.heartbeatAt : "",
      counters: {},
      current: null,
      sources: [],
    };
    const counters = raw.counters && typeof raw.counters === "object" ? raw.counters : {};
    for (const key of RUN_PROGRESS_COUNTER_KEYS) {
      const n = cleanRunProgressCount(counters[key]);
      if (n !== null) out.counters[key] = n;
    }
    const current = raw.current && typeof raw.current === "object" ? raw.current : null;
    if (current && RUN_PROGRESS_CURRENT_KINDS.includes(current.kind)) {
      const label = cleanRunProgressLabel(current.label);
      if (label) out.current = { kind: current.kind, label };
    }
    if (Array.isArray(raw.sources)) {
      for (const entry of raw.sources) {
        if (out.sources.length >= RUN_PROGRESS_MAX_SOURCES) break;
        if (!entry || typeof entry !== "object") continue;
        const id = cleanRunProgressLabel(entry.id);
        if (!id || !RUN_PROGRESS_SOURCE_STATES.includes(entry.state)) continue;
        const source = { id, state: entry.state };
        const done = cleanRunProgressCount(entry.done);
        const total = cleanRunProgressCount(entry.total);
        if (done !== null) source.done = done;
        if (total !== null) source.total = total;
        out.sources.push(source);
      }
    }
    return out;
  }

  function formatRunDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function runSourceLabel(id) {
    if (RUN_PROGRESS_SOURCE_LABELS[id]) return RUN_PROGRESS_SOURCE_LABELS[id];
    const words = String(id).replace(/[_-]+/g, " ").trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
  }

  function runLaneText(done, total, state) {
    if (total !== undefined && total !== null) {
      return `${done !== undefined && done !== null ? done : 0} of ${total}`;
    }
    if (state === "pending") return "Waiting";
    if (state === "skipped") return "Skipped";
    if (state === "done") return "Done";
    if (done !== undefined && done !== null) return `${done} so far`;
    return "Running";
  }

  function buildRunLanes(progress) {
    if (progress.sources.length > 0) {
      return progress.sources.map((source) => ({
        label: runSourceLabel(source.id),
        state: source.state,
        done: source.done,
        total: source.total,
        text: runLaneText(source.done, source.total, source.state),
      }));
    }
    const c = progress.counters;
    const lanes = [];
    if (c.companiesTotal !== undefined) {
      lanes.push({
        label: "Companies",
        state: "running",
        done: c.companiesDone,
        total: c.companiesTotal,
        text:
          c.companiesDone !== undefined
            ? `${c.companiesDone} of ${c.companiesTotal}`
            : `${c.companiesTotal} to check`,
      });
    }
    if (c.queriesTotal !== undefined) {
      lanes.push({
        label: "Google Jobs searches",
        state: "running",
        done: c.queriesDone,
        total: c.queriesTotal,
        text:
          c.queriesDone !== undefined
            ? `${c.queriesDone} of ${c.queriesTotal}`
            : `${c.queriesTotal} planned`,
      });
    }
    return lanes;
  }

  function runHeadline(progress) {
    const current = progress.current;
    if (current) {
      // UXD-BE sends ordinals ("Company 2 of 3", "Query 1 of 5") rather than
      // names; lower-case those so the headline reads as one sentence.
      const label = /^(Company|Query) \d+ of \d+$/.test(current.label)
        ? current.label.charAt(0).toLowerCase() + current.label.slice(1)
        : current.label;
      if (current.kind === "company") return `Checking ${label}`;
      if (current.kind === "source") return `Reading ${runSourceLabel(label)}`;
      if (current.kind === "query") return `Running search ${label}`;
    }
    return RUN_PROGRESS_PHASE_HEADLINES[progress.phase] || "Working";
  }

  /**
   * Pure: tracker state + reader time → what every live surface shows.
   * mode "hidden" (idle/terminal), "legacy" (no progress object — relay,
   * Apps Script, older worker) or "live".
   */
  function deriveLiveRunView(state, nowMs) {
    const s = state || {};
    const status = String(s.status || "idle");
    const hidden = {
      mode: "hidden",
      steps: [],
      lanes: [],
      counters: [],
      headline: "",
      health: { key: "none", text: "" },
      elapsedText: "",
      summary: "",
    };
    if (!["pending", "running", "polling_error"].includes(status)) return hidden;
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const startMs = Date.parse(s.startedAt || s.initiatedAt || "");
    const elapsedText = Number.isFinite(startMs) ? formatRunDuration(now - startMs) : "";
    // Re-sanitize: state may come from storage written by another build.
    const progress = sanitizeRunProgress(s.progress);

    let health;
    if (status === "polling_error") {
      health = s.statusEndpointTerminal
        ? { key: "lost", text: "Discovery can't report this run." }
        : s.deadlineExceeded
          ? { key: "lost", text: "This run went past its time limit. Check Runs for the outcome." }
          : Number(s.pollErrorCount) >= MAX_POLL_ERRORS
          ? {
              key: "lost",
              text: "We stopped getting updates. The search may still be running.",
            }
          : { key: "reconnecting", text: "Reconnecting to the search…" };
    }

    if (!progress) {
      if (!health) {
        health =
          status === "pending" && s.dispatchUnconfirmed
            ? { key: "unknown", text: "The worker didn't confirm this run. Check Runs." }
            : status === "pending"
            ? { key: "starting", text: "Starting the search…" }
            : s.statusUnavailable
              ? { key: "unknown", text: "This setup can't send live updates." }
              : {
                  key: "unknown",
                  text: "This discovery setup doesn't send step-by-step progress.",
                };
      }
      return {
        ...hidden,
        mode: "legacy",
        headline: "Searching for new roles",
        health,
        elapsedText,
        summary: `Discovery running${elapsedText ? ` for ${elapsedText}` : ""}. ${health.text}`,
      };
    }

    if (!health) {
      const observedMs = Date.parse(s.progressObservedAt || "");
      const ageMs = Number.isFinite(observedMs) ? Math.max(0, now - observedMs) : 0;
      const age = formatRunDuration(ageMs);
      if (ageMs <= RUN_PROGRESS_FRESH_MS) {
        health = {
          key: "working",
          text: ageMs < 1000 ? "Updated just now" : `Updated ${age} ago`,
        };
      } else if (!s.progressHeartbeatSeen) {
        health = { key: "quiet", text: `No new step for ${age}` };
      } else if (ageMs <= RUN_PROGRESS_STALL_MS) {
        health = { key: "quiet", text: `Still working — nothing new for ${age}` };
      } else {
        health = {
          key: "stalled",
          text: `No word from the worker for ${age}. It may have stopped.`,
        };
      }
    }

    const phaseIndex = RUN_PROGRESS_STEPS.findIndex((step) => step.key === progress.phase);
    const steps = RUN_PROGRESS_STEPS.map((step, i) => ({
      key: step.key,
      label: step.label,
      state: phaseIndex < 0 ? "todo" : i < phaseIndex ? "done" : i === phaseIndex ? "current" : "todo",
    }));
    const counters = [];
    for (const [key, label] of RUN_PROGRESS_COUNTER_LABELS) {
      if (progress.counters[key] !== undefined) {
        counters.push({ key, label, value: progress.counters[key] });
      }
    }
    const headline = runHeadline(progress);
    const found = progress.counters.listingsSeen;
    const summary =
      `Discovery running: ${headline.charAt(0).toLowerCase()}${headline.slice(1)}.` +
      (found !== undefined
        ? ` ${found} ${found === 1 ? "listing" : "listings"} found so far.`
        : "") +
      ` ${health.text}.`.replace(/\.\.$/, ".");
    return {
      mode: "live",
      phaseKey: progress.phase,
      phaseHeadline: RUN_PROGRESS_PHASE_HEADLINES[progress.phase] || "",
      steps,
      lanes: buildRunLanes(progress),
      counters,
      headline,
      health,
      elapsedText,
      summary,
    };
  }

  function escapeRunProgressHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * One markup for every home. Deliberately NOT a live region: it re-renders
   * every second. Phase changes and stalls are announced separately.
   */
  function renderLiveRunProgressHtml(view, options) {
    if (!view || view.mode === "hidden") return "";
    const esc = escapeRunProgressHtml;
    const variant = options && options.variant === "row" ? "row" : "card";
    const parts = [
      `<div class="jb-live-run jb-live-run--${variant}" data-mode="${esc(view.mode)}" data-health="${esc(view.health.key)}">`,
      '<div class="jb-live-run__head">',
      '<span class="jb-live-run__dot" aria-hidden="true"></span>',
      `<p class="jb-live-run__headline">${esc(view.headline)}</p>`,
      '<p class="jb-live-run__meta">',
      view.elapsedText
        ? `<span class="jb-live-run__elapsed">Running ${esc(view.elapsedText)}</span>`
        : "",
      `<span class="jb-live-run__health">${esc(view.health.text)}</span>`,
      "</p>",
      "</div>",
    ];
    if (view.steps.length) {
      parts.push('<ol class="jb-live-run__steps" aria-label="Discovery steps">');
      for (const step of view.steps) {
        const stateText =
          step.state === "done" ? " (done)" : step.state === "current" ? " (now)" : "";
        parts.push(
          `<li class="jb-live-run__step" data-state="${esc(step.state)}"` +
            (step.state === "current" ? ' aria-current="step"' : "") +
            `>${esc(step.label)}<span class="jb-a11y-visually-hidden">${stateText}</span></li>`,
        );
      }
      parts.push("</ol>");
    }
    if (view.lanes.length) {
      parts.push('<ul class="jb-live-run__lanes">');
      for (const lane of view.lanes) {
        const bar =
          lane.total !== undefined && lane.total !== null && lane.total > 0
            ? `<progress class="jb-live-run__bar" max="${lane.total}" value="${Math.min(lane.done || 0, lane.total)}" aria-hidden="true"></progress>`
            : '<span class="jb-live-run__bar jb-live-run__bar--open" aria-hidden="true"></span>';
        parts.push(
          `<li class="jb-live-run__lane" data-state="${esc(lane.state)}">` +
            `<span class="jb-live-run__lane-label">${esc(lane.label)}</span>` +
            bar +
            `<span class="jb-live-run__lane-value">${esc(lane.text)}</span></li>`,
        );
      }
      parts.push("</ul>");
    }
    if (view.counters.length) {
      parts.push('<dl class="jb-live-run__counters">');
      for (const counter of view.counters) {
        parts.push(
          `<div class="jb-live-run__counter"><dt>${esc(counter.label)}</dt><dd>${esc(counter.value)}</dd></div>`,
        );
      }
      parts.push("</dl>");
    }
    parts.push("</div>");
    return parts.join("");
  }

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
      this._pollSession = createAbortablePollSession();
      this._state = this._load();
      if (Number.isFinite(this._state.pollGeneration) && this._state.pollGeneration > 0) {
        while (this._pollSession.getGeneration() < this._state.pollGeneration) {
          this._pollSession.bumpGeneration();
        }
      }
    }

    _load() {
      try {
        const raw = localStorage.getItem(this._key);
        if (!raw) return this._idle();
        return this._hydrate(JSON.parse(raw));
      } catch (_) {
        return this._idle();
      }
    }

    /** Re-hydrate a stored (or another tab's) snapshot with defaults. */
    _hydrate(parsed) {
      try {
        if (!parsed || typeof parsed !== "object") return this._idle();
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
          statusEndpointTerminal: !!parsed.statusEndpointTerminal,
          terminalAcknowledged: !!parsed.terminalAcknowledged,
          pollGeneration: Number.isFinite(parsed.pollGeneration)
            ? parsed.pollGeneration
            : 0,
          progress: sanitizeRunProgress(parsed.progress),
          progressObservedAt: parsed.progressObservedAt || "",
          progressHeartbeatSeen: !!parsed.progressHeartbeatSeen,
          filterStats: sanitizeFilterStats(parsed.filterStats),
          maxRunDurationMs: positiveMs(parsed.maxRunDurationMs, DEFAULT_MAX_RUN_DURATION_MS),
          deadlineExceeded: !!parsed.deadlineExceeded,
          dispatchUnconfirmed: !!parsed.dispatchUnconfirmed,
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
      this.postChannelMessage({ type: "state", state });
    }

    /**
     * D13: tabs share one run over the jb-discovery-run BroadcastChannel.
     * Every state change goes out; another tab's change is adopted here
     * (its sender already persisted it), and listeners (the status handoff's
     * poll election) see every message.
     */
    connectChannel() {
      if (this._channel !== undefined) return this._channel;
      this._channel = null;
      this._channelListeners = [];
      if (typeof BroadcastChannel !== "function") return null;
      try {
        this._channel = new BroadcastChannel(DISCOVERY_RUN_CHANNEL);
        this._channel.onmessage = (event) => this._onChannelMessage(event && event.data);
      } catch (_) {
        this._channel = null;
      }
      return this._channel;
    }

    onChannelMessage(listener) {
      if (this.connectChannel() && typeof listener === "function") {
        this._channelListeners.push(listener);
      }
    }

    postChannelMessage(message) {
      if (!this._channel) return;
      try {
        this._channel.postMessage({ ...message, tabId: DISCOVERY_RUN_TAB_ID });
      } catch (_) {
        /* best-effort, like storage */
      }
    }

    _onChannelMessage(message) {
      if (!message || typeof message !== "object") return;
      if (message.tabId === DISCOVERY_RUN_TAB_ID) return;
      if (message.type === "state" && message.state && typeof message.state === "object") {
        const next = this._hydrate(message.state);
        if (next.runId !== this._state.runId) this._pollSession.abortAll();
        this._state = next;
        dispatchDiscoveryRunTrackerEvent(this._state);
      }
      for (const listener of this._channelListeners) {
        try {
          listener(message);
        } catch (_) {
          /* one listener never breaks another */
        }
      }
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
        statusEndpointTerminal: false,
        terminalAcknowledged: false,
        pollGeneration: 0,
        progress: null,
        progressObservedAt: "",
        progressHeartbeatSeen: false,
        filterStats: null,
        maxRunDurationMs: DEFAULT_MAX_RUN_DURATION_MS,
        deadlineExceeded: false,
        dispatchUnconfirmed: false,
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
      maxRunDurationMs = DEFAULT_MAX_RUN_DURATION_MS,
    }) {
      if (this._pollSession) this._pollSession.abortAll();
      const pollGeneration = this._pollSession
        ? this._pollSession.bumpGeneration()
        : 1;
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
        statusEndpointTerminal: false,
        terminalAcknowledged: false,
        pollGeneration,
        progress: null,
        progressObservedAt: "",
        progressHeartbeatSeen: false,
        filterStats: null,
        maxRunDurationMs: positiveMs(maxRunDurationMs, DEFAULT_MAX_RUN_DURATION_MS),
        deadlineExceeded: false,
        dispatchUnconfirmed: false,
      };
      this._persist(this._state);
      return this;
    }

    /**
     * D16: the dispatch POST timed out, so the worker may or may not have
     * the run. Only its identity is kept (never the payload, which can carry
     * a Google token) so the next attempt re-sends it and the worker answers
     * with the original run instead of starting a second one.
     */
    markDispatchUnconfirmed({ webhookUrl = "", trigger = "manual", variationKey = "", requestedAt = "" }) {
      this.beginTracking({ runId: "", webhookUrl, trigger, variationKey, requestedAt, statusUnavailable: true });
      const requestedMs = Date.parse(this._state.requestedAt);
      if (Number.isFinite(requestedMs)) {
        this._state.initiatedAt = new Date(requestedMs).toISOString();
      }
      this._state.dispatchUnconfirmed = true;
      this._persist(this._state);
      return this;
    }

    _now() {
      return Date.now();
    }

    /**
     * D4: an AbortSignal for one status poll. It fires after `timeoutMs`, and
     * at once when beginTracking starts another run (D2).
     */
    createPollSignal(timeoutMs) {
      if (typeof AbortController !== "function" || typeof setTimeout !== "function") {
        return null;
      }
      return this._pollSession.createPollSignal(timeoutMs);
    }

    /**
     * Keep the worker's progress object (AGREED CONTRACT, UXD-FE/UXD-BE
     * 2026-09-26). Freshness is measured on OUR clock: progressObservedAt
     * moves only when a poll sees a new `sequence` (heartbeats bump it too),
     * so worker/browser clock skew can never fake a stall or hide one.
     */
    _absorbProgress(rawProgress) {
      const next = sanitizeRunProgress(rawProgress);
      if (!next) return;
      const prev = this._state.progress;
      if (!prev || prev.sequence !== next.sequence || !this._state.progressObservedAt) {
        this._state.progressObservedAt = new Date(this._now()).toISOString();
      }
      if (next.heartbeatAt) this._state.progressHeartbeatSeen = true;
      this._state.progress = next;
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
    updateFromStatusResponse(statusData, options) {
      if (!statusData || typeof statusData !== "object") return this;
      const incomingRunId = String(statusData.runId || "").trim();
      if (incomingRunId && this._state.runId && incomingRunId !== this._state.runId) {
        return this;
      }
      const incomingGeneration =
        options && Number.isFinite(Number(options.generation))
          ? Number(options.generation)
          : null;
      if (
        incomingGeneration != null &&
        Number(this._state.pollGeneration || 0) !== incomingGeneration
      ) {
        return this;
      }
      this._state.lastPollAt = new Date().toISOString();
      this._state.statusUnavailable = false;
      this._state.statusEndpointTerminal = false;
      this._state.deadlineExceeded = false;
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
      this._absorbProgress(statusData.progress);
      if (isTerminal) {
        this._state.filterStats = sanitizeFilterStats(lifecycle.filterStats);
        this._state.status = runStatus; // completed | empty | partial | failed
        this._state.terminalAt = new Date().toISOString();
        this._state.terminalKind = runStatus;
        if (runStatus === "completed" || runStatus === "empty") {
          this._state.errorMessage = "";
        } else {
          this._state.errorMessage = String(statusData.error || "");
          if (!this._state.errorMessage) {
            this._state.errorMessage = String(lifecycle.reasonMessage || "");
          }
          if (!this._state.errorMessage && runStatus === "failed") {
            this._state.errorMessage = String(statusData.message || "Run failed");
          }
        }
        this._persist(this._state);
        return this;
      }
      // Non-terminal: ensure we're in running, not stuck in pending — or in
      // polling_error after the status endpoint answered again (D1).
      if (this._state.status === "pending" || this._state.status === "polling_error") {
        this._state.status = "running";
      }
      this._state.pollErrorCount = 0; // reset on successful poll
      this._persist(this._state);
      return this;
    }

    /**
     * Called when polling itself fails (network error, timeout, non-2xx).
     * §0.4: a status GET that only timed out is a slow worker, not a lost
     * one — pass { timedOut: true } and it never counts toward
     * MAX_POLL_ERRORS; the run deadline decides when watching stops.
     */
    markPollError(errorMessage = "", options) {
      if (!(options && options.timedOut)) {
        this._state.pollErrorCount = (this._state.pollErrorCount || 0) + 1;
      }
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

    /**
     * Stop polling because the status endpoint gave an answer that will not
     * change on retry (404 no such run, 401/403 rejected status token).
     * Distinct from markStatusConnectionLost: that one means "we lost the
     * connection, the run may still be going", which would be a lie here —
     * so the terminal marker travels with the state and the UI reads it.
     */
    markStatusEndpointTerminal(errorMessage = "") {
      this._state.pollErrorCount = Math.max(
        this._state.pollErrorCount || 0,
        MAX_POLL_ERRORS,
      );
      this._state.lastPollAt = new Date().toISOString();
      this._state.errorMessage = String(
        errorMessage || "The status endpoint is no longer reporting this run.",
      );
      if (this._state.runId) this._state.status = "polling_error";
      this._state.statusUnavailable = true;
      this._state.statusEndpointTerminal = true;
      this._persist(this._state);
      return this;
    }

    /** Retry after polling error — back to running if we have a runId */
    resumeFromPollError() {
      if (this._state.status !== "polling_error") return this;
      this._state.status = this._state.runId ? "running" : "idle";
      this._state.pollErrorCount = 0;
      this._state.statusUnavailable = false;
      this._state.statusEndpointTerminal = false;
      this._state.deadlineExceeded = false;
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
      this._state.statusEndpointTerminal = false;
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
      this.postChannelMessage({ type: "state", state: this._state });
      return this;
    }

    /**
     * D4: the browser stops watching a run once it is past
     * maxRunDurationMs + grace from its start — unless the worker is still
     * reporting progress, which is never cut short (§0.4).
     */
    isPastDeadline(nowMs) {
      const s = this._state;
      const startMs = Date.parse(s.startedAt || s.initiatedAt || "");
      if (!Number.isFinite(startMs)) return false;
      const budget = positiveMs(s.maxRunDurationMs, DEFAULT_MAX_RUN_DURATION_MS);
      return nowMs > startMs + budget + RUN_DEADLINE_GRACE_MS;
    }

    hasFreshProgress(nowMs) {
      const observedMs = Date.parse(this._state.progressObservedAt || "");
      return Number.isFinite(observedMs) && nowMs - observedMs <= RUN_PROGRESS_STALL_MS;
    }

    /** D4: the run outlived its budget without reporting an end. */
    markDeadlineExceeded() {
      this._state.status = "polling_error";
      this._state.deadlineExceeded = true;
      this._state.pollErrorCount = Math.max(this._state.pollErrorCount || 0, MAX_POLL_ERRORS);
      this._state.lastPollAt = new Date().toISOString();
      this._state.errorMessage =
        "This run went past its time limit without reporting an end. Check Runs for the outcome.";
      this._state.statusUnavailable = true;
      this._persist(this._state);
      return this;
    }

    /**
     * D5/D6: the browser has stopped watching this run, or never could — no
     * status path, polling gave up, the endpoint disowned it, or it outlived
     * its deadline. Its outcome is unknown, it blocks nothing, and the user
     * may dismiss it.
     */
    isSettled() {
      const s = this._state;
      if (s.status === "pending") return !!s.statusUnavailable && !s.statusPath;
      if (s.status === "polling_error") {
        return !!(
          s.statusEndpointTerminal ||
          s.deadlineExceeded ||
          Number(s.pollErrorCount) >= MAX_POLL_ERRORS
        );
      }
      return false;
    }

    /** True when there is an in-progress run the browser is still watching. */
    isActive() {
      return (
        ["pending", "running", "polling_error"].includes(this._state.status) &&
        !this.isSettled()
      );
    }

    /** True when the run has reached a terminal state. */
    isTerminal() {
      return ["completed", "empty", "partial", "failed", "write_failed"].includes(this._state.status);
    }

    /** True when status polling is in an error state that might recover. */
    isPollingError() {
      return this._state.status === "polling_error";
    }

    /**
     * Versioned DiscoveryRuns row contract for the local terminal outcome.
     * F4-C consumes this so a local completion is not dropped while the sheet
     * catch-up is still empty or misparsed.
     */
    toHistoryRow() {
      const status = String(this._state.status || "").toLowerCase();
      let logStatus = "failure";
      if (status === "completed" || status === "empty") logStatus = "success";
      else if (status === "partial") logStatus = "partial";
      else if (status === "failed" || status === "write_failed") logStatus = "failure";
      else logStatus = "partial";
      // D18: the run's real duration, worker clock first, then ours.
      const endMs = Date.parse(this._state.completedAt || this._state.terminalAt || "");
      const startMs = Date.parse(this._state.startedAt || this._state.initiatedAt || "");
      const durationS =
        Number.isFinite(endMs) && Number.isFinite(startMs) && endMs >= startMs
          ? Math.round((endMs - startMs) / 1000)
          : 0;
      return {
        runAt:
          this._state.completedAt ||
          this._state.terminalAt ||
          this._state.initiatedAt ||
          "",
        trigger: this._state.trigger || "manual",
        status: logStatus,
        durationS,
        companiesSeen: this._state.companiesSeen || 0,
        leadsWritten: this._state.leadsWritten || 0,
        leadsUpdated: this._state.leadsUpdated || 0,
        source: "local-tracker",
        variationKey: this._state.variationKey || "",
        error: logStatus === "success" ? "" : String(this._state.errorMessage || ""),
        runId: this._state.runId || "",
      };
    }
  }

  /** Shared singleton — initialized once at module load */
  const discoveryRunTracker = new DiscoveryRunTracker();
  discoveryRunTracker.connectChannel();

  Object.assign(runTracker, {
    DISCOVERY_RUN_TRACKER_KEY,
    MAX_POLL_ERRORS,
    DEFAULT_PER_POLL_TIMEOUT_MS,
    DEFAULT_OVERALL_POLL_DEADLINE_MS,
    DEFAULT_MAX_RUN_DURATION_MS,
    RUN_DEADLINE_GRACE_MS,
    DISCOVERY_RUN_CHANNEL,
    DISCOVERY_RUN_TAB_ID,
    DiscoveryRunTracker,
    discoveryRunTracker,
    dispatchDiscoveryRunTrackerEvent,
    createAbortablePollSession,
    sanitizeRunProgress,
    deriveLiveRunView,
    renderLiveRunProgressHtml,
    formatRunDuration,
  });
})();
