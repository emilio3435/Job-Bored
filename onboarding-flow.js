/* ============================================
   One-flow onboarding controller — the flow's state machine.

   ONE-FLOW-ONBOARDING-SPEC §3 replaces six chained wizards with one
   flow: screen S0 (the demo board) plus six beats rendered inside the
   single shell. This module owns the parts every beat shares —

     · the beat registry (order, time labels, render + action hooks),
     · the persisted state machine (§3.2, one IndexedDB key),
     · entry / resume / escape (§3.4),
     · the migration guard that keeps existing users out (§3.3),
     · the funnel emissions (§9),
     · the completion side-effects every legacy reader still depends on.

   Beats live in oneflow-beat-*.js and register themselves at load. This
   file renders NOTHING on its own and is wired into boot by nobody yet:
   the substrate lands dark (SUBSTRATE locked decision 1), and
   app-bootstrap.js starts calling maybeStart() only at the L6 cutover.

   Classic-global IIFE under window.JobBoredOneFlow, like every sibling.
   ============================================ */
(function () {
  const root = window.JobBoredOneFlow || (window.JobBoredOneFlow = {});

  const MOUNT_ID = "oneFlowMount";
  const FLOW_STATE_VERSION = 3;

  /** The six beats, in the order spec §3.1 locks. */
  const BEAT_IDS = Object.freeze([
    "google",
    "ai",
    "resume",
    "fit",
    "discovery",
    "payoff",
  ]);

  /** Spine segment labels — spec §3.5.1 ("Google · AI · Resume · Your fit · Discovery · Done"). */
  const BEAT_LABELS = Object.freeze({
    google: "Google",
    ai: "AI",
    resume: "Resume",
    fit: "Your fit",
    discovery: "Discovery",
    payoff: "Done",
  });

  const DEFAULT_STATE = Object.freeze({
    version: FLOW_STATE_VERSION,
    beat: "",
    completedBeats: [],
    skipped: {},
    startedAt: "",
    completed: false,
  });

  /** id -> normalized beat descriptor. */
  const beats = new Map();

  /**
   * Cross-beat scratch: B3's resume draft is what B4 confirms, B2's
   * verified provider is what B3 drafts with. In-memory only — anything
   * that must survive a refresh belongs in the flow state or its own store.
   */
  const runtime = {};

  let state = cloneState(DEFAULT_STATE);
  let hydrated = false;
  let flowOpenEmitted = false;
  let openBeatId = "";

  function cloneState(raw) {
    return {
      version: raw.version,
      beat: raw.beat,
      completedBeats: [...raw.completedBeats],
      skipped: { ...raw.skipped },
      startedAt: raw.startedAt,
      completed: !!raw.completed,
    };
  }

  function asString(raw, fallback = "") {
    const s = raw == null ? "" : String(raw).trim();
    return s || fallback;
  }

  function store() {
    return window.CommandCenterUserContent || null;
  }

  function shell() {
    const ns = window.JobBoredDiscoveryWizard;
    return (ns && ns.shell) || null;
  }

  function emit(step, detail) {
    const telemetry = window.JobBoredOnboardingTelemetry;
    if (!telemetry || !telemetry.emit || !step) return;
    telemetry.emit(step, detail);
  }

  function steps() {
    const telemetry = window.JobBoredOnboardingTelemetry;
    return (telemetry && telemetry.STEPS) || {};
  }

  // ---------------------------------------------------------------
  // Registry
  // ---------------------------------------------------------------

  /**
   * Register one beat. Called at load by each oneflow-beat-*.js.
   * Throws on a bad descriptor: a beat that fails to register would
   * otherwise show up as an empty shell at run time, which is exactly
   * the silent failure mode this flow exists to end.
   */
  function registerBeat(descriptor) {
    const raw = descriptor && typeof descriptor === "object" ? descriptor : {};
    const id = asString(raw.id);
    if (!BEAT_IDS.includes(id)) {
      throw new Error(
        `[JobBored] one-flow: "${id}" is not a beat id (${BEAT_IDS.join(", ")}).`,
      );
    }
    if (typeof raw.render !== "function") {
      throw new Error(`[JobBored] one-flow: beat "${id}" needs a render(container, ctx).`);
    }
    const order = Number.isInteger(raw.order) ? raw.order : BEAT_IDS.indexOf(id) + 1;
    const beat = {
      id,
      order,
      label: asString(raw.label, BEAT_LABELS[id] || id),
      timeLabel: asString(raw.timeLabel),
      // A beat may register a RESOLVER instead of a literal: spec §5 B6 is
      // "You're live, {firstName}." — a template only the beat can fill, and
      // a frozen string put the raw braces on screen (routed L6 → L7 #9).
      headline:
        typeof raw.headline === "function" ? raw.headline : asString(raw.headline),
      sub: asString(raw.sub),
      render: raw.render,
      onAction: typeof raw.onAction === "function" ? raw.onAction : null,
      actions: Array.isArray(raw.actions) ? raw.actions : [],
    };
    beats.set(id, beat);
    return beat;
  }

  /** Registered beats in spec order — never in script-tag order. */
  function getRegisteredBeats() {
    return [...beats.values()].sort((a, b) => a.order - b.order);
  }

  function getBeat(id) {
    return beats.get(asString(id)) || null;
  }

  function nextBeatAfter(id) {
    const ordered = getRegisteredBeats();
    const index = ordered.findIndex((beat) => beat.id === id);
    if (index < 0) return null;
    return ordered[index + 1] || null;
  }

  // ---------------------------------------------------------------
  // State (spec §3.2)
  // ---------------------------------------------------------------

  function getState() {
    return cloneState(state);
  }

  /**
   * Seed the cross-beat scratch before the flow opens.
   *
   * The §3.3 migration is the only caller: a legacy profile routed
   * straight to B4 never ran B3, so there is no drafted profile on the
   * runtime for B4 to confirm — boot hands it the draft it derived from
   * the legacy discovery profile instead. Runtime scratch is in-memory
   * by contract, so this deliberately does NOT touch the persisted flow
   * state (which normalizes unknown keys away anyway).
   */
  function seedRuntime(partial) {
    if (partial && typeof partial === "object") Object.assign(runtime, partial);
    return runtime;
  }

  async function hydrate() {
    if (hydrated) return state;
    const s = store();
    if (s && typeof s.getOnboardingFlowState === "function") {
      try {
        state = cloneState(await s.getOnboardingFlowState());
      } catch (e) {
        console.warn("[JobBored] one-flow: could not read flow state:", e);
      }
    }
    hydrated = true;
    return state;
  }

  async function patchState(partial) {
    const s = store();
    if (s && typeof s.saveOnboardingFlowState === "function") {
      try {
        state = cloneState(await s.saveOnboardingFlowState(partial));
        hydrated = true;
        return state;
      } catch (e) {
        console.warn("[JobBored] one-flow: could not save flow state:", e);
      }
    }
    // No store (or a failed write): keep the in-memory machine moving so a
    // storage fault degrades to "this session only", never to a dead flow.
    state = cloneState({ ...state, ...partial, skipped: { ...state.skipped, ...(partial.skipped || {}) } });
    return state;
  }

  // ---------------------------------------------------------------
  // Entry decision (spec §3.3 / §3.4) — L6 wires this into boot.
  // ---------------------------------------------------------------

  /**
   * Should the one-flow run for this profile? Resolves false for anyone
   * who already finished setup under the legacy chain (or under this
   * flow), recording the completion so the question is only asked once.
   * Renders nothing either way.
   */
  async function maybeStart() {
    await hydrate();
    if (state.completed) return false;
    const s = store();
    if (s && typeof s.isInfraSetupComplete === "function") {
      const [infra, onboarding] = await Promise.all([
        s.isInfraSetupComplete(),
        s.isOnboardingComplete(),
      ]);
      if (infra && onboarding) {
        await patchState({ completed: true });
        return false;
      }
    }
    if (!state.startedAt) {
      await patchState({ startedAt: new Date().toISOString() });
    }
    return true;
  }

  // ---------------------------------------------------------------
  // Rendering — one chassis, spec §3.5
  // ---------------------------------------------------------------

  function buildSpine(currentId) {
    const ordered = getRegisteredBeats();
    const completed = new Set(state.completedBeats);
    const current = ordered.find((beat) => beat.id === currentId);
    return {
      beats: ordered.map((beat) => ({
        id: beat.id,
        label: beat.label,
        done: completed.has(beat.id),
      })),
      current: currentId,
      timeLabel: current ? current.timeLabel : "",
    };
  }

  function buildContext(beat) {
    return {
      state: getState(),
      runtime,
      setMessage(text, tone) {
        const sh = shell();
        if (sh && sh.setMessage) sh.setMessage(text, tone);
      },
      setBusy(actionId, stages) {
        const sh = shell();
        if (sh && sh.setBusy) sh.setBusy(actionId, stages);
      },
      clearBusy() {
        const sh = shell();
        if (sh && sh.clearBusy) sh.clearBusy();
      },
      completeBeat(detail) {
        return completeBeat(beat.id, detail);
      },
      skipBeat(detail) {
        return skipBeat(beat.id, detail);
      },
      goToBeat(id) {
        return goToBeat(id);
      },
    };
  }

  /** A literal headline, or what the beat's resolver makes of this context. */
  function resolveHeadline(beat, ctx) {
    if (typeof beat.headline !== "function") return beat.headline;
    try {
      return asString(beat.headline(ctx));
    } catch (e) {
      console.warn("[JobBored] one-flow: headline resolver failed", beat.id, e);
      return "";
    }
  }

  function renderBeat(beat) {
    const sh = shell();
    if (!sh || typeof sh.renderWizardShell !== "function") return null;
    const ctx = buildContext(beat);
    const headline = resolveHeadline(beat, ctx);
    try {
      return sh.renderWizardShell({
        mountId: MOUNT_ID,
        variant: "generic",
        headerTitle: "Set up JobBored",
        title: headline,
        lede: beat.sub,
        spine: buildSpine(beat.id),
        steps: [
          {
            id: beat.id,
            label: beat.label,
            title: headline,
            description: beat.sub,
            actions: beat.actions,
            render(shellContext) {
              const container = document.createElement("div");
              container.className = "oneflow-beat";
              container.dataset.beatId = beat.id;
              beat.render(container, { ...ctx, shellContext });
              return container;
            },
          },
        ],
        state: { currentStep: beat.id, completedSteps: state.completedBeats },
        onAction(actionId, detail) {
          if (typeof beat.onAction === "function") {
            beat.onAction(actionId, { ...buildContext(beat), detail });
          }
        },
        onClose(reason) {
          handleShellClose(reason);
        },
      });
    } catch (e) {
      // A missing #oneFlowMount must not take the dashboard down with it.
      console.warn("[JobBored] one-flow: could not render beat", beat.id, e);
      return null;
    }
  }

  // ---------------------------------------------------------------
  // Navigation (spec §3.4)
  // ---------------------------------------------------------------

  function resolveEntryBeatId(requested) {
    const wanted = asString(requested);
    if (wanted && beats.has(wanted)) return wanted;
    if (!wanted && state.beat && beats.has(state.beat)) return state.beat;
    const first = getRegisteredBeats()[0];
    return first ? first.id : "";
  }

  /**
   * Open the flow. With no argument this RESUMES: the saved beat wins, so
   * a refresh or a re-entry from the S0 card never restarts the deal.
   */
  async function open(beatId) {
    await hydrate();
    const target = resolveEntryBeatId(beatId);
    if (!target) return null;
    if (!flowOpenEmitted) {
      emit(steps().FLOW_OPENED, { beat: target });
      flowOpenEmitted = true;
    }
    if (!state.startedAt) {
      await patchState({ startedAt: new Date().toISOString() });
    }
    return goToBeat(target);
  }

  async function goToBeat(id) {
    await hydrate();
    const beat = getBeat(id);
    if (!beat) return null;
    await patchState({ beat: beat.id });
    openBeatId = beat.id;
    const rendered = renderBeat(beat);
    emit(steps().BEAT_OPENED, { beat: beat.id });
    return rendered;
  }

  async function completeBeat(id, detail = {}) {
    await hydrate();
    const beat = getBeat(id);
    if (!beat) return null;
    const completedBeats = state.completedBeats.includes(beat.id)
      ? state.completedBeats
      : [...state.completedBeats, beat.id];
    await patchState({ completedBeats });
    emit(steps().BEAT_COMPLETED, { ...detail, beat: beat.id });
    const next = nextBeatAfter(beat.id);
    if (next) return goToBeat(next.id);
    return finishFlow();
  }

  async function skipBeat(id, detail = {}) {
    await hydrate();
    const beat = getBeat(id);
    if (!beat) return null;
    // `key` lets a beat skip one PART of itself: B5's connect panel is
    // skippable while its fuel panel is not (spec §5 B5).
    const key = asString(detail.key, beat.id);
    await patchState({ skipped: { [key]: true } });
    emit(steps().BEAT_SKIPPED, { ...detail, beat: asString(detail.beat, key) });
    const next = nextBeatAfter(beat.id);
    if (next) return goToBeat(next.id);
    return finishFlow();
  }

  /**
   * The end of the deal (spec §3.2): write the completion flags every
   * legacy reader still checks, so nothing downstream has to learn about
   * onboardingFlowState to keep working.
   */
  async function finishFlow() {
    const startedAt = Date.parse(state.startedAt);
    const durationMs = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
    const skips = Object.keys(state.skipped);
    const s = store();
    if (s) {
      try {
        await s.completeOnboarding();
        await s.completeInfraSetup();
        if (!state.skipped.discoveryConnect) {
          await s.completeDiscoverySetup();
        }
      } catch (e) {
        console.warn("[JobBored] one-flow: could not write completion flags:", e);
      }
    }
    await patchState({ completed: true });
    emit(steps().FLOW_COMPLETED, { skips, durationMs });
    closeShell();
    openBeatId = "";
    return getState();
  }

  function closeShell() {
    const sh = shell();
    if (sh && typeof sh.closeWizardShell === "function") {
      // Suppress the abandon emission: a finished flow is not a drop-off.
      const wasOpen = openBeatId;
      openBeatId = "";
      sh.closeWizardShell("flow-complete");
      if (!wasOpen) return;
    }
  }

  /**
   * The shell's own × / Esc path lands here (spec §3.4): closing is
   * pausing. The saved beat is untouched; only the drop-off is recorded.
   */
  function handleShellClose(reason) {
    if (!openBeatId) return;
    const beat = openBeatId;
    openBeatId = "";
    flowOpenEmitted = false;
    emit(steps().BEAT_ABANDONED, { beat, reason: asString(reason, "close") });
  }

  function close(reason) {
    if (!openBeatId) return;
    const sh = shell();
    if (sh && typeof sh.closeWizardShell === "function") {
      // closeWizardShell calls back into handleShellClose via onClose.
      sh.closeWizardShell(asString(reason, "close"));
      return;
    }
    handleShellClose(reason);
  }

  function isOpen() {
    return !!openBeatId;
  }

  Object.assign(root, {
    MOUNT_ID,
    BEAT_IDS,
    BEAT_LABELS,
    registerBeat,
    getRegisteredBeats,
    getBeat,
    getState,
    seedRuntime,
    maybeStart,
    open,
    goToBeat,
    completeBeat,
    skipBeat,
    close,
    isOpen,
  });
})();
