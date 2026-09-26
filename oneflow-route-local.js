/* ============================================
   The route-to-local screen (GFX D2 / R11).

   JobBored runs on the user's computer. A page served from anywhere else
   (the hosted site, a file:// copy) cannot sign anyone in to a Sheet the
   local app will ever see, because localStorage and IndexedDB are per
   origin. So before any setup starts, onboarding-flow.js hands a hosted
   page to this screen instead of Beat 1, and nothing here writes
   onboarding state.

   The screen is a ladder with one primary action per state (D1):
     · Open JobBored — `jobbored://open`, never with a beat or returnTo (R4);
     · Download JobBored for Mac — the desktop feed's latest release;
     · Copy setup command — Windows, Linux and developers.

   Detection (R21): only AFTER the Open click (Chrome's Local Network
   Access prompt must follow a gesture), ping http://localhost:8080 for up
   to about 8 s and watch blur/visibility for the protocol hand-off. A
   denied or failed ping is "unknown", never "not installed". Polling stops
   on success, on leaving the screen, and at the timeout.

   Classic-global IIFE; reads JobBoredLocalServer, fetch and timers at
   call time so harnesses can swap them. TIMINGS is injectable.
   ============================================ */
(function () {
  const ACTION_OPEN = "route_local_open";
  const ACTION_CHECK_AGAIN = "route_local_check_again";
  const ACTION_COPY = "route_local_copy";

  /** The desktop feed repo (D11). One constant; the feed exists before release. */
  const DOWNLOAD_URL =
    "https://github.com/emilio3435/jobbored-desktop/releases/latest";

  /** Option A, kept as the tertiary path (D8). */
  const SETUP_COMMAND =
    "git clone https://github.com/emilio3435/Job-Bored.git && cd Job-Bored && ./start.sh";

  /** Where JobBored on this computer answers. Absolute on purpose (R21). */
  const LOCAL_BASE = "http://localhost:8080";
  const LOCAL_URL = `${LOCAL_BASE}/`;

  /** This page's build, compared against the ping's `version` (R3). */
  const PAGE_VERSION = "0.1.0"; // x-release-please-version

  const TIMINGS = {
    /** Gap between pings while the window is open. */
    pollMs: 1000,
    /** The whole detection window after one Open click. */
    windowMs: 8000,
    /** One ping's own timeout. */
    pingTimeoutMs: 2500,
  };

  const HEADER_TITLE = "Get JobBored";
  const TITLE = "JobBored runs on your computer.";
  const LEDE =
    "This website can't hold your setup: your Google sign-in, your Sheet " +
    "link and your keys stay with JobBored on your computer. Open it there " +
    "to start.";

  const COPY = Object.freeze({
    checking: "Looking for JobBored on this computer…",
    opening: "Asking your computer to open JobBored…",
    running: "JobBored is running on this computer.",
    unknown:
      "This page couldn't reach JobBored on this computer. It may not be " +
      "installed yet, or your browser kept this page from checking.",
    unknownAfterHandoff:
      "Your browser handed off to another app, but this page couldn't see " +
      "JobBored answer. If JobBored opened, carry on there.",
    stale:
      "Something on this computer answers at localhost:8080, but it isn't " +
      "a current JobBored. If it's an older JobBored, update it and start " +
      "it again. If it's another app, quit that app first.",
    updateDesktop: "This copy of JobBored is older than this page. Update JobBored.",
    updateSource:
      "This copy of JobBored is older than this page. Run git pull in the " +
      "JobBored folder, then start it again.",
    copied: "Copied. Paste it into a terminal.",
    copyFailed: "Your browser blocked the copy. Select the command above and copy it.",
  });

  // ---------------------------------------------------------------
  // State. The shell rebuilds the tree on every setMessage/setBusy, so
  // everything that must survive a repaint lives here.
  // ---------------------------------------------------------------

  const state = {
    /** "idle" | "checking" | "running" | "stale" | "unknown" */
    phase: "idle",
    handoffSeen: false,
    version: "",
    runtime: "",
    outdated: false,
    open: false,
  };

  /** Mutated in place: the shell reads step.actions before render runs. */
  const ACTIONS = [];

  /** The live detection, or null. */
  let run = null;

  function shell() {
    const ns = window.JobBoredDiscoveryWizard;
    return (ns && ns.shell) || null;
  }

  function localServer() {
    return window.JobBoredLocalServer || null;
  }

  function isMac() {
    try {
      const nav =
        window.navigator ||
        (typeof navigator !== "undefined" ? navigator : null);
      if (!nav) return false;
      const name = String(
        (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "",
      );
      return /mac/i.test(name);
    } catch (_) {
      return false;
    }
  }

  function el(tag, className, attrs = {}, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key in node) {
        node[key] = value;
        continue;
      }
      node.setAttribute(key, String(value));
    }
    if (text != null) node.textContent = String(text);
    return node;
  }

  /** -1, 0 or 1 for dotted numeric versions; unparseable parts read as 0. */
  function compareVersions(a, b) {
    const pa = String(a || "").split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
    const pb = String(b || "").split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i += 1) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  function downloadAction(variant) {
    return {
      id: "route_local_download",
      label: "Download JobBored for Mac",
      variant,
      href: DOWNLOAD_URL,
      target: "_blank",
      rel: "noopener",
    };
  }

  function syncActions() {
    ACTIONS.length = 0;
    switch (state.phase) {
      case "running":
        ACTIONS.push({
          id: "route_local_go",
          label: "Go to JobBored",
          variant: "primary",
          href: LOCAL_URL,
          target: "_self",
          rel: "noopener",
        });
        return;
      case "stale":
        ACTIONS.push({ id: ACTION_CHECK_AGAIN, label: "Check again", variant: "primary" });
        return;
      case "unknown":
        // No signal: the next rung becomes the one primary (D1).
        if (isMac()) {
          ACTIONS.push(downloadAction("primary"));
        } else {
          ACTIONS.push({ id: ACTION_COPY, label: "Copy setup command", variant: "primary" });
        }
        ACTIONS.push({ id: ACTION_OPEN, label: "Try Open JobBored again", variant: "ghost" });
        return;
      case "idle":
      case "checking":
        ACTIONS.push({ id: ACTION_OPEN, label: "Open JobBored", variant: "primary" });
        return;
      default: {
        const never = state.phase;
        throw new Error(`route-local: unknown phase ${never}`);
      }
    }
  }

  syncActions();

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  function renderCommand() {
    const wrap = el("div", "oneflow-route-local__command");
    const field = el("input", "oneflow-route-local__command-field", {
      type: "text",
      readOnly: true,
      value: SETUP_COMMAND,
      spellcheck: false,
      "aria-label": "Setup command",
    });
    // The visible fallback: a click selects it all for a manual copy.
    field.addEventListener("focus", () => {
      if (typeof field.select === "function") field.select();
    });
    const copy = el(
      "button",
      "oneflow-route-local__copy",
      { type: "button" },
      "Copy",
    );
    copy.addEventListener("click", () => {
      void copyCommand();
    });
    wrap.append(field, copy);
    return wrap;
  }

  function renderRung(kind, title, body, extra) {
    const rung = el("li", `oneflow-route-local__rung oneflow-route-local__rung--${kind}`);
    rung.appendChild(el("p", "oneflow-route-local__rung-title", {}, title));
    if (body) rung.appendChild(el("p", "oneflow-route-local__rung-body", {}, body));
    if (extra) rung.appendChild(extra);
    return rung;
  }

  function renderStatusNote() {
    if (state.phase !== "running" || !state.outdated) return null;
    return el(
      "p",
      "oneflow-route-local__note",
      { role: "note" },
      state.runtime === "desktop" ? COPY.updateDesktop : COPY.updateSource,
    );
  }

  function render(container) {
    const prominent = state.phase === "unknown" || state.phase === "stale";
    const body = el(
      "div",
      prominent
        ? "oneflow-route-local oneflow-route-local--fallback"
        : "oneflow-route-local",
    );
    body.dataset.phase = state.phase;

    const note = renderStatusNote();
    if (note) body.appendChild(note);

    const ladder = el("ol", "oneflow-route-local__ladder", {
      "aria-label": "Ways to get JobBored on this computer",
    });
    ladder.appendChild(
      renderRung(
        "open",
        "Already have it?",
        "Open JobBored opens the app, or the copy you started from the " +
          "JobBored folder. This page then checks that it answered.",
      ),
    );
    const download = el(
      "a",
      "oneflow-route-local__download",
      { href: DOWNLOAD_URL, target: "_blank", rel: "noopener" },
      "Download JobBored for Mac ↗",
    );
    ladder.appendChild(
      renderRung(
        "download",
        "On a Mac",
        "Download the app, open it, then come back and press Open JobBored.",
        download,
      ),
    );
    ladder.appendChild(
      renderRung(
        "command",
        "On Windows or Linux, or running it from source",
        "Needs git and Node.js. Run this in a terminal; it opens JobBored " +
          "at localhost:8080 when it's ready.",
        renderCommand(),
      ),
    );
    body.appendChild(ladder);
    container.appendChild(body);
  }

  function paint(options = {}) {
    const sh = shell();
    if (!sh || typeof sh.renderWizardShell !== "function") return null;
    syncActions();
    const flow = window.JobBoredOneFlow;
    const mountId = options.mountId || (flow && flow.MOUNT_ID) || "oneFlowMount";
    try {
      return sh.renderWizardShell({
        mountId,
        variant: "generic",
        headerTitle: HEADER_TITLE,
        title: TITLE,
        lede: LEDE,
        // The one-flow chassis keys its look off a spine; this screen comes
        // BEFORE the six beats, so its single segment is hidden by CSS.
        spine: { beats: [{ id: "local", label: HEADER_TITLE }], current: "local" },
        steps: [
          {
            id: "local",
            label: HEADER_TITLE,
            title: TITLE,
            description: LEDE,
            actions: ACTIONS,
            render() {
              const container = document.createElement("div");
              container.className = "oneflow-beat";
              container.dataset.beatId = "route-local";
              render(container);
              return container;
            },
          },
        ],
        state: { currentStep: "local", completedSteps: [] },
        onAction(actionId) {
          handleAction(actionId);
        },
        onClose() {
          state.open = false;
          stop();
        },
        focus: options.focus,
      });
    } catch (e) {
      console.warn("[JobBored] route-local: could not render", e);
      return null;
    }
  }

  function setMessage(text, tone) {
    const sh = shell();
    if (sh && typeof sh.setMessage === "function") sh.setMessage(text, tone || "info");
  }

  function setBusy(stages) {
    const sh = shell();
    if (sh && typeof sh.setBusy === "function") sh.setBusy(ACTION_OPEN, stages);
  }

  function clearBusy() {
    const sh = shell();
    if (sh && typeof sh.clearBusy === "function") sh.clearBusy();
  }

  function setPhase(phase) {
    state.phase = phase;
    syncActions();
  }

  // ---------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------

  function addListener(target, type, fn) {
    if (target && typeof target.addEventListener === "function") {
      target.addEventListener(type, fn);
      return () => {
        if (typeof target.removeEventListener === "function") {
          target.removeEventListener(type, fn);
        }
      };
    }
    return () => {};
  }

  function documentHidden() {
    try {
      return document.visibilityState === "hidden";
    } catch (_) {
      return false;
    }
  }

  /** Stop polling and drop every listener. Safe to call at any time. */
  function stop() {
    const current = run;
    run = null;
    if (!current) return;
    current.stopped = true;
    for (const off of current.offs) off();
    if (current.timer != null) clearTimeout(current.timer);
    if (current.deadline != null) clearTimeout(current.deadline);
    if (current.ctrl) {
      try {
        current.ctrl.abort();
      } catch (_) {
        /* nothing in flight */
      }
    }
    if (typeof current.wake === "function") current.wake();
  }

  function finish(phase, message, tone) {
    stop();
    setPhase(phase);
    if (!state.open) return;
    clearBusy();
    setMessage(message, tone);
  }

  function readPing(ping) {
    if (ping.up) {
      state.version = ping.version || "";
      state.runtime = ping.runtime || "";
      state.outdated =
        !!state.version && compareVersions(state.version, PAGE_VERSION) < 0;
      finish("running", COPY.running, "success");
      return true;
    }
    if (ping.outcome === "stale_server") {
      finish("stale", COPY.stale, "info");
      return true;
    }
    // no_local_server / static_host / a denied LNA prompt: unknown, keep
    // polling until the window closes.
    return false;
  }

  async function pingOnce(current) {
    const ls = localServer();
    if (!ls || typeof ls.pingLocalServer !== "function") return false;
    let ping;
    try {
      ping = await ls.pingLocalServer({
        base: LOCAL_BASE,
        timeoutMs: TIMINGS.pingTimeoutMs,
        signal: current.ctrl ? current.ctrl.signal : undefined,
      });
    } catch (_) {
      return false;
    }
    if (current.stopped) return true;
    return readPing(ping);
  }

  function sleep(current, ms) {
    if (current.kicked) {
      current.kicked = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      current.wake = () => {
        current.wake = null;
        if (current.timer != null) clearTimeout(current.timer);
        current.timer = null;
        resolve();
      };
      current.timer = setTimeout(() => current.wake && current.wake(), ms);
    });
  }

  async function detect() {
    stop();
    const current = {
      stopped: false,
      offs: [],
      timer: null,
      deadline: null,
      wake: null,
      kicked: false,
      ctrl: typeof AbortController !== "undefined" ? new AbortController() : null,
    };
    run = current;
    state.handoffSeen = false;

    // The protocol hand-off steals focus: that is a signal, and coming back
    // is the moment to look again.
    const onAway = () => {
      state.handoffSeen = true;
    };
    const onBack = () => {
      if (documentHidden()) {
        state.handoffSeen = true;
        return;
      }
      // A wake that lands mid-ping must not be lost to the next sleep.
      current.kicked = true;
      if (typeof current.wake === "function") current.wake();
    };
    current.offs.push(addListener(window, "blur", onAway));
    current.offs.push(addListener(window, "focus", onBack));
    current.offs.push(addListener(document, "visibilitychange", onBack));

    let timedOut = false;
    current.deadline = setTimeout(() => {
      timedOut = true;
      if (current.ctrl) {
        try {
          current.ctrl.abort();
        } catch (_) {
          /* the ping reads the abort as no answer */
        }
      }
      if (typeof current.wake === "function") current.wake();
    }, TIMINGS.windowMs);

    while (!current.stopped && !timedOut) {
      if (await pingOnce(current)) return;
      if (current.stopped || timedOut) break;
      await sleep(current, TIMINGS.pollMs);
    }
    if (current.stopped) return;
    finish(
      "unknown",
      state.handoffSeen ? COPY.unknownAfterHandoff : COPY.unknown,
      "info",
    );
  }

  function openApp() {
    const ls = localServer();
    const url =
      ls && typeof ls.jobBoredOpenUrl === "function"
        ? ls.jobBoredOpenUrl()
        : "jobbored://open";
    // Synchronous, inside the click: the protocol launch needs the gesture.
    try {
      window.location.href = url;
    } catch (_) {
      /* a browser without the handler stays put; detection says so */
    }
    setPhase("checking");
    setBusy([
      { label: COPY.opening, state: "done" },
      { label: COPY.checking, state: "active" },
    ]);
    return detect();
  }

  async function copyCommand() {
    let ok = false;
    try {
      const clip = window.navigator && window.navigator.clipboard;
      if (clip && typeof clip.writeText === "function") {
        await clip.writeText(SETUP_COMMAND);
        ok = true;
      }
    } catch (_) {
      ok = false;
    }
    setMessage(ok ? COPY.copied : COPY.copyFailed, ok ? "success" : "info");
    return ok;
  }

  function handleAction(actionId) {
    switch (actionId) {
      case ACTION_OPEN:
        return openApp();
      case ACTION_CHECK_AGAIN:
        setPhase("checking");
        setBusy([{ label: COPY.checking, state: "active" }]);
        return detect();
      case ACTION_COPY:
        return copyCommand();
      default:
        return undefined;
    }
  }

  /** Paint the screen. Writes no onboarding state. */
  function show(options = {}) {
    stop();
    state.phase = "idle";
    state.handoffSeen = false;
    state.outdated = false;
    state.version = "";
    state.runtime = "";
    state.open = true;
    return paint(options);
  }

  window.JobBoredOneFlowRouteLocal = {
    ACTION_OPEN,
    ACTION_CHECK_AGAIN,
    ACTION_COPY,
    DOWNLOAD_URL,
    SETUP_COMMAND,
    LOCAL_URL,
    PAGE_VERSION,
    TIMINGS,
    COPY,
    TITLE,
    LEDE,
    show,
    stop,
    handleAction,
    compareVersions,
    isDetecting() {
      return !!run;
    },
    getState() {
      return { ...state, actions: ACTIONS.map((a) => ({ ...a })) };
    },
  };
})();
