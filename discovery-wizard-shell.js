(() => {
  const root =
    window.JobBoredDiscoveryWizard || (window.JobBoredDiscoveryWizard = {});
  const shell = root.shell || (root.shell = {});

  const DEFAULT_STEP_IDS = Object.freeze([
    "detect",
    "path_select",
    "no_webhook",
    "existing_endpoint",
    "bootstrap",
    "local_health",
    "tunnel",
    "relay_deploy",
    "verify",
    "ready",
    "stub_only",
  ]);

  const DEFAULT_STEP_BLUEPRINTS = Object.freeze([
    {
      id: "detect",
      label: "Status",
      title: "Current setup status.",
      description: "Shows what's already connected and what still needs work.",
      tone: "info",
    },
    {
      id: "path_select",
      label: "Path",
      title: "Choose a connection method.",
      description: "Pick the option that matches your setup.",
      tone: "info",
    },
    {
      id: "no_webhook",
      label: "Manual",
      title: "Keep discovery manual.",
      description: "Add jobs via automation or manually — no webhook needed.",
      tone: "muted",
    },
    {
      id: "existing_endpoint",
      label: "Endpoint",
      title: "Connect a stable URL (Tailscale).",
      description:
        "Set up Tailscale below and paste its stable URL — or any public HTTPS endpoint you already control.",
      tone: "info",
    },
    {
      id: "bootstrap",
      label: "Config",
      title: "Load local config.",
      description:
        "Auto-fills ports, URLs, and tunnel info from your config file.",
      tone: "info",
    },
    {
      id: "local_health",
      label: "Server",
      title: "Check local server.",
      description:
        "Confirms your local discovery server is running and healthy.",
      tone: "warning",
    },
    {
      id: "tunnel",
      label: "Tunnel",
      title: "Connect ngrok tunnel.",
      description: "Makes your local server reachable from the internet.",
      tone: "warning",
    },
    {
      id: "relay_deploy",
      label: "Relay",
      title: "Deploy the Cloudflare relay.",
      description: "Creates a permanent URL that forwards to your tunnel.",
      tone: "info",
    },
    {
      id: "verify",
      label: "Test",
      title: "Test the connection.",
      description: "Sends a test request through the full chain.",
      tone: "success",
    },
    {
      id: "ready",
      label: "Done",
      title: "You're all set.",
      description: "Discovery is connected and ready to use.",
      tone: "success",
    },
    {
      id: "stub_only",
      label: "Stub",
      title: "Test-only mode.",
      description: "Confirms wiring works but won't produce real results.",
      tone: "warning",
    },
  ]);

  const DEFAULT_TITLE = "Discovery setup wizard";
  const DEFAULT_LEDE = "Connect your job discovery pipeline in a few steps.";
  const FOCUSABLE_SELECTOR = [
    'button:not([disabled]):not([tabindex="-1"])',
    '[href]:not([tabindex="-1"])',
    'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])',
    'textarea:not([disabled]):not([tabindex="-1"])',
    '[role="button"]:not([tabindex="-1"])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  if (!root.mount) {
    root.mount = Object.freeze({
      id: "discoverySetupWizardMount",
      shellClassName: "discovery-setup-wizard-root",
    });
  }

  if (!root.contract) {
    root.contract = Object.freeze({
      readinessSnapshot: Object.freeze({
        sheetConfigured: false,
        savedWebhookUrl: "",
        savedWebhookKind: "none",
        localBootstrapAvailable: false,
        localWebhookUrl: "",
        localWebhookReady: false,
        tunnelPublicUrl: "",
        storedTunnelUrl: "",
        tunnelLive: false,
        tunnelReady: false,
        tunnelStale: false,
        relayTargetUrl: "",
        relayReady: false,
        engineState: "none",
        appsScriptState: "none",
        recommendedFlow: "local_agent",
        recommendedReason: "",
        blockingIssue: "",
        localRecoveryState: "ok",
      }),
      discoverySetupWizardState: Object.freeze({
        version: 1,
        flow: "local_agent",
        currentStep: "detect",
        completedSteps: [],
        transportMode: "",
        lastProbeAt: "",
        lastVerifiedAt: "",
        result: "none",
        dismissedStubWarning: false,
      }),
      verificationResult: Object.freeze({
        ok: false,
        kind: "invalid_endpoint",
        engineState: "none",
        httpStatus: 0,
        message: "",
        detail: "",
        layer: "browser",
      }),
      actionDispatch: "runDiscoveryWizardAction",
    });
  }

  shell.defaultStepIds = DEFAULT_STEP_IDS;
  shell.defaultStepBlueprints = DEFAULT_STEP_BLUEPRINTS;
  shell.defaultTitle = DEFAULT_TITLE;
  shell.defaultLede = DEFAULT_LEDE;
  shell.lastRender = null;
  shell.lastFocus = null;
  shell.open = false;

  function asString(raw, fallback = "") {
    const s = raw == null ? "" : String(raw).trim();
    return s || fallback;
  }

  function asBoolean(raw) {
    return raw === true || raw === "true" || raw === 1;
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    for (const value of values || []) {
      const s = asString(value);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function normalizeEnum(raw, allowed, fallback) {
    const value = asString(raw);
    return allowed.includes(value) ? value : fallback;
  }

  function toArray(raw) {
    return Array.isArray(raw) ? raw : [];
  }

  function clampIndex(index, length) {
    if (!Number.isFinite(index)) return 0;
    if (index < 0) return 0;
    if (index >= length) return Math.max(0, length - 1);
    return index;
  }

  function defaultStepFromBlueprint(blueprint, index) {
    return {
      id: asString(
        blueprint.id,
        DEFAULT_STEP_IDS[index] || `step_${index + 1}`,
      ),
      label: asString(blueprint.label, `Step ${index + 1}`),
      title: asString(blueprint.title, ""),
      description: asString(blueprint.description, ""),
      tone: normalizeEnum(
        blueprint.tone,
        ["info", "muted", "warning", "success"],
        "info",
      ),
      locked: asBoolean(blueprint.locked),
      completedLabel: asString(blueprint.completedLabel, ""),
      footerNote: asString(blueprint.footerNote, ""),
      body: blueprint.body,
      render: typeof blueprint.render === "function" ? blueprint.render : null,
      actions: toArray(blueprint.actions),
      secondaryActions: toArray(blueprint.secondaryActions),
    };
  }

  function buildDefaultSteps() {
    return DEFAULT_STEP_BLUEPRINTS.map((blueprint, index) =>
      defaultStepFromBlueprint(blueprint, index),
    );
  }

  function normalizeStep(step, index) {
    const blueprint = step && typeof step === "object" ? step : {};
    return {
      id: asString(
        blueprint.id,
        DEFAULT_STEP_IDS[index] || `step_${index + 1}`,
      ),
      label: asString(blueprint.label, `Step ${index + 1}`),
      title: asString(blueprint.title, ""),
      description: asString(blueprint.description, ""),
      tone: normalizeEnum(
        blueprint.tone,
        ["info", "muted", "warning", "success"],
        "info",
      ),
      locked: asBoolean(blueprint.locked),
      completedLabel: asString(blueprint.completedLabel, ""),
      footerNote: asString(blueprint.footerNote, ""),
      body: blueprint.body,
      render: typeof blueprint.render === "function" ? blueprint.render : null,
      actions: toArray(blueprint.actions),
      secondaryActions: toArray(blueprint.secondaryActions),
    };
  }

  function normalizeSnapshot(snapshot, variant) {
    const raw = snapshot && typeof snapshot === "object" ? snapshot : {};
    if (variant === "generic") {
      // Generic wizards (e.g. go-live) do not share discovery's readiness
      // schema; pass the snapshot through unchanged so each wizard can
      // define its own shape without colliding with discovery's enums.
      return { ...raw };
    }
    return {
      ...root.contract.readinessSnapshot,
      ...raw,
      sheetConfigured: asBoolean(raw.sheetConfigured),
      savedWebhookUrl: asString(raw.savedWebhookUrl),
      savedWebhookKind: asString(raw.savedWebhookKind, "none"),
      localBootstrapAvailable: asBoolean(raw.localBootstrapAvailable),
      localWebhookUrl: asString(raw.localWebhookUrl),
      localWebhookReady: asBoolean(raw.localWebhookReady),
      tunnelPublicUrl: asString(raw.tunnelPublicUrl),
      storedTunnelUrl: asString(raw.storedTunnelUrl),
      tunnelLive: asBoolean(raw.tunnelLive),
      tunnelReady: asBoolean(raw.tunnelReady),
      tunnelStale: asBoolean(raw.tunnelStale),
      relayTargetUrl: asString(raw.relayTargetUrl),
      relayReady: asBoolean(raw.relayReady),
      engineState: normalizeEnum(
        raw.engineState,
        ["none", "stub_only", "unverified", "connected"],
        "none",
      ),
      appsScriptState: normalizeEnum(
        raw.appsScriptState,
        ["none", "stub_only", "unverified", "connected"],
        "none",
      ),
      recommendedFlow: normalizeEnum(
        raw.recommendedFlow,
        ["local_agent", "external_endpoint", "no_webhook", "stub_only"],
        "local_agent",
      ),
      recommendedReason: asString(raw.recommendedReason),
      blockingIssue: asString(raw.blockingIssue),
      localRecoveryState: normalizeEnum(
        raw.localRecoveryState,
        [
          "ok",
          "needs_full_restart",
          "worker_down",
          "tunnel_down",
          "tunnel_rotated",
        ],
        "ok",
      ),
    };
  }

  function normalizeWizardState(state, variant) {
    const raw = state && typeof state === "object" ? state : {};
    const completedSteps = uniqueStrings(raw.completedSteps);
    if (variant === "generic") {
      // Generic mode preserves caller-provided state shape; only the
      // version stamp and completedSteps de-dupe are enforced. No
      // discovery-flow enum coercion and no "detect" default.
      return {
        ...raw,
        version: 1,
        currentStep: asString(raw.currentStep),
        completedSteps,
      };
    }
    return {
      ...root.contract.discoverySetupWizardState,
      ...raw,
      version: 1,
      flow: normalizeEnum(
        raw.flow,
        ["local_agent", "external_endpoint", "no_webhook", "stub_only"],
        "local_agent",
      ),
      currentStep: asString(raw.currentStep, "detect"),
      completedSteps,
      transportMode: asString(raw.transportMode),
      lastProbeAt: asString(raw.lastProbeAt),
      lastVerifiedAt: asString(raw.lastVerifiedAt),
      result: normalizeEnum(
        raw.result,
        ["none", "unverified", "connected", "stub_only", "blocked", "error"],
        "none",
      ),
      dismissedStubWarning: asBoolean(raw.dismissedStubWarning),
    };
  }

  function translateEngineTone(state) {
    if (state === "connected") return "success";
    if (state === "stub_only") return "warning";
    if (state === "unverified") return "warning";
    return "muted";
  }

  function summarizeSnapshot(snapshot) {
    const engineLabel =
      {
        none: "No engine",
        stub_only: "Stub only",
        unverified: "Unverified",
        connected: "Connected",
      }[snapshot.engineState] || snapshot.engineState;
    const appsScriptLabel =
      {
        none: "None",
        stub_only: "Stub only",
        unverified: "Unverified",
        connected: "Connected",
      }[snapshot.appsScriptState] || snapshot.appsScriptState;
    const flowLabel =
      {
        local_agent: "Local worker",
        external_endpoint: "Webhook",
        no_webhook: "Manual",
        stub_only: "Stub",
      }[snapshot.recommendedFlow] || snapshot.recommendedFlow;
    return [
      { label: "Path", value: flowLabel, tone: "info" },
      {
        label: "Engine",
        value: engineLabel,
        tone: translateEngineTone(snapshot.engineState),
      },
      {
        label: "Apps Script",
        value: appsScriptLabel,
        tone: translateEngineTone(snapshot.appsScriptState),
      },
      {
        label: "Config",
        value: snapshot.localBootstrapAvailable ? "Found" : "Missing",
        tone: snapshot.localBootstrapAvailable ? "success" : "muted",
      },
      {
        label: "Tunnel",
        value: snapshot.tunnelReady ? "OK" : "Not ready",
        tone: snapshot.tunnelReady ? "success" : "warning",
      },
      {
        label: "Relay",
        value: snapshot.relayReady ? "OK" : "Not ready",
        tone: snapshot.relayReady ? "success" : "warning",
      },
    ];
  }







  function buildStepModel(rawSteps, state, activeStepIdOverride) {
    const normalized = rawSteps.length ? rawSteps : buildDefaultSteps();
    const currentIndexByState = normalized.findIndex(
      (step) => step.id === asString(activeStepIdOverride, state.currentStep),
    );
    const activeIndex = clampIndex(
      currentIndexByState >= 0 ? currentIndexByState : 0,
      normalized.length,
    );
    const activeStepId = normalized[activeIndex]?.id || DEFAULT_STEP_IDS[0];
    const completed = new Set(state.completedSteps);

    const steps = normalized.map((step, index) => {
      const explicitlyCompleted = completed.has(step.id);
      const implicitlyCompleted = index < activeIndex;
      const completedHere = explicitlyCompleted || implicitlyCompleted;
      const active = step.id === activeStepId;
      const locked =
        !!step.locked || (!completedHere && index > activeIndex + 1);
      return {
        ...step,
        index,
        active,
        completed: completedHere,
        locked,
        stateLabel: active
          ? "Current step"
          : completedHere
            ? "Completed"
            : locked
              ? "Locked"
              : "Available",
      };
    });

    const completionCount = steps.filter((step) => step.completed).length;
    const progress = steps.length
      ? Math.round((completionCount / steps.length) * 100)
      : 0;
    const previousStep = activeIndex > 0 ? steps[activeIndex - 1] : null;
    const nextStep =
      activeIndex < steps.length - 1 ? steps[activeIndex + 1] : null;

    return {
      steps,
      activeStepId,
      activeIndex,
      previousStep,
      nextStep,
      completionCount,
      progress,
      canGoBack: !!previousStep,
      canGoNext: !!nextStep,
    };
  }

  /* ---------- One-flow shell additions (ONE-FLOW spec §3.5) ----------
     Three opt-in regions. A host that passes none of `spine`, `message`,
     or `busy` renders exactly what it rendered before they existed —
     tests/oneflow-l0-shell.test.mjs locks that byte for byte. */

  const MESSAGE_TONES = ["info", "success", "error"];
  const BUSY_STAGE_STATES = ["done", "active", "todo"];
  const BUSY_STAGE_GLYPHS = Object.freeze({
    done: "✓",
    active: "◌",
    todo: "·",
  });

  /**
   * `spine: { beats: [{id,label,done?}…], current, timeLabel }` — the flow's
   * ONE progress system (spec §2). Returns null when the host didn't opt in.
   */
  function normalizeSpine(raw) {
    if (!raw || typeof raw !== "object") return null;
    const beats = toArray(raw.beats)
      .map((beat, index) => {
        const o = beat && typeof beat === "object" ? beat : { id: beat };
        const id = asString(o.id, `beat_${index + 1}`);
        return {
          id,
          label: asString(o.label, id),
          done: asBoolean(o.done),
        };
      })
      .filter((beat) => !!beat.id);
    if (!beats.length) return null;
    const current = asString(raw.current, beats[0].id);
    const currentIndex = beats.findIndex((beat) => beat.id === current);
    return {
      beats,
      current,
      currentIndex,
      timeLabel: asString(raw.timeLabel),
    };
  }

  /**
   * `busy: { actionId, stages }` — a live stage list plus the id of the
   * trigger that must stay disabled until it clears. Stages accept a bare
   * string (not started) or `{ label, state }`.
   */
  function normalizeBusy(raw) {
    if (!raw || typeof raw !== "object") return null;
    const actionId = asString(raw.actionId);
    if (!actionId) return null;
    const stages = toArray(raw.stages)
      .map((stage) => {
        const o = stage && typeof stage === "object" ? stage : { label: stage };
        return {
          label: asString(o.label),
          state: normalizeEnum(
            o.state != null ? o.state : o.done ? "done" : "todo",
            BUSY_STAGE_STATES,
            "todo",
          ),
        };
      })
      .filter((stage) => !!stage.label);
    return { actionId, stages };
  }

  function isBusyAction(context, actionId) {
    return !!(context.busy && actionId && context.busy.actionId === actionId);
  }

  function getWizardContext(input = {}) {
    const variant = normalizeEnum(
      input.variant,
      ["discovery", "generic"],
      "discovery",
    );
    const snapshot = normalizeSnapshot(input.snapshot, variant);
    const state = normalizeWizardState(input.state, variant);
    const steps = buildStepModel(
      toArray(input.steps).map((step, index) => normalizeStep(step, index)),
      state,
      input.activeStepId,
    );
    const activeStep = steps.steps[steps.activeIndex];
    return {
      title: asString(input.title, DEFAULT_TITLE),
      lede: asString(input.lede, DEFAULT_LEDE),
      headerTitle: asString(input.headerTitle, "Discovery setup"),
      variant,
      mountId: asString(input.mountId, root.mount.id),
      snapshot,
      state,
      steps: steps.steps,
      activeStep,
      activeIndex: steps.activeIndex,
      previousStep: steps.previousStep,
      nextStep: steps.nextStep,
      progress: steps.progress,
      completionCount: steps.completionCount,
      canGoBack: steps.canGoBack,
      canGoNext: steps.canGoNext,
      onAction: typeof input.onAction === "function" ? input.onAction : null,
      onNavigate:
        typeof input.onNavigate === "function" ? input.onNavigate : null,
      onClose: typeof input.onClose === "function" ? input.onClose : null,
      onStateChange:
        typeof input.onStateChange === "function" ? input.onStateChange : null,
      onRender: typeof input.onRender === "function" ? input.onRender : null,
      open: input.open !== false,
      // Continuity chrome (setup tracks only): a persistent journey strip
      // (Profile ✓ → Job discovery → Other devices) + a mascot thumb so the
      // shell wizards read as chapters of ONE setup flow. Both render only
      // when the consumer opts in.
      journeyStage: ["discovery", "devices", "bonus"].includes(
        input.journeyStage,
      )
        ? input.journeyStage
        : "",
      mascotSrc: asString(input.mascotSrc, ""),
      // One-flow opt-ins (spec §3.5). All three are null/"" for every
      // existing host, which is what keeps their markup unchanged.
      spine: normalizeSpine(input.spine),
      message: asString(input.message, ""),
      messageTone: normalizeEnum(input.messageTone, MESSAGE_TONES, "info"),
      busy: normalizeBusy(input.busy),
    };
  }

  function ensureMount(mountId, shellClassName) {
    const id = asString(mountId, root.mount.id);
    const className = asString(shellClassName, root.mount.shellClassName);
    const mount = document.getElementById(id);
    if (!mount) {
      throw new Error(`Wizard mount #${id} is missing from the page.`);
    }
    if (mount.classList) {
      mount.classList.add(className);
    }
    return mount;
  }

  function createEl(tag, className, attrs = {}, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "dataset" && value && typeof value === "object") {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          if (dataValue == null || dataValue === false) continue;
          el.dataset[dataKey] = String(dataValue);
        }
        continue;
      }
      if (key === "style" && value && typeof value === "object") {
        Object.assign(el.style, value);
        continue;
      }
      if (key === "htmlFor") {
        el.htmlFor = String(value);
        continue;
      }
      if (key in el) {
        try {
          el[key] = value;
          continue;
        } catch (_) {
          /* fall through to attribute */
        }
      }
      el.setAttribute(key, String(value));
    }
    if (text != null) el.textContent = String(text);
    return el;
  }

  function appendText(parent, text, className = "") {
    const p = createEl("p", className, {}, text);
    parent.appendChild(p);
    return p;
  }


  function renderContentSlot(slot, content, context) {
    if (!content) return;
    if (typeof content === "function") {
      const result = content(context);
      renderContentSlot(slot, result, context);
      return;
    }
    if (Array.isArray(content)) {
      for (const item of content) renderContentSlot(slot, item, context);
      return;
    }
    if (content instanceof Node) {
      slot.appendChild(content);
      return;
    }
    if (typeof content === "string" || typeof content === "number") {
      appendText(slot, String(content), "discovery-setup-wizard__copy");
      return;
    }
    if (content && typeof content === "object") {
      if (content.type === "list" && Array.isArray(content.items)) {
        const list = createEl("ul", "discovery-setup-wizard__list");
        for (const item of content.items) {
          const li = createEl("li");
          renderContentSlot(li, item, context);
          list.appendChild(li);
        }
        slot.appendChild(list);
        return;
      }
      if (content.type === "card") {
        const card = createEl("div", "discovery-setup-wizard__summary-card");
        if (content.kicker) {
          appendText(
            card,
            String(content.kicker),
            "discovery-setup-wizard__card-kicker",
          );
        }
        if (content.title) {
          const h = createEl(
            "h4",
            "discovery-setup-wizard__card-title",
            {},
            String(content.title),
          );
          card.appendChild(h);
        }
        if (content.body) {
          renderContentSlot(card, content.body, context);
        }
        slot.appendChild(card);
        return;
      }
      if (content.type === "option-grid" && Array.isArray(content.items)) {
        const grid = createEl("div", "discovery-setup-wizard__option-grid");
        const currentFlow = context.state && context.state.flow;
        for (const item of content.items) {
          const isSelected = item.flow && item.flow === currentFlow;
          const col = createEl("button", "discovery-setup-wizard__option-col", {
            type: "button",
          });
          if (isSelected) {
            col.classList.add("discovery-setup-wizard__option-col--selected");
          }
          if (item.kicker) {
            appendText(
              col,
              String(item.kicker),
              "discovery-setup-wizard__card-kicker",
            );
          }
          if (item.title) {
            const h = createEl(
              "h4",
              "discovery-setup-wizard__card-title",
              {},
              String(item.title),
            );
            col.appendChild(h);
          }
          if (item.body) {
            renderContentSlot(col, item.body, context);
          }
          const arrow = createEl(
            "span",
            "discovery-setup-wizard__option-arrow",
            {},
            "→",
          );
          col.appendChild(arrow);
          if (item.flow) {
            const flowMap = {
              local_agent: "wizard_choose_flow_local",
              external_endpoint: "wizard_choose_flow_existing",
              no_webhook: "wizard_choose_flow_no_webhook",
            };
            const actionId =
              context.variant === "generic"
                ? `wizard_choose_flow_${item.flow}`
                : flowMap[item.flow] || `wizard_choose_flow_${item.flow}`;
            col.addEventListener("click", () => {
              grid
                .querySelectorAll(".discovery-setup-wizard__option-col")
                .forEach((c) =>
                  c.classList.remove(
                    "discovery-setup-wizard__option-col--selected",
                  ),
                );
              col.classList.add("discovery-setup-wizard__option-col--selected");
              setTimeout(() => dispatchAction(actionId, context), 280);
            });
          }
          grid.appendChild(col);
        }
        slot.appendChild(grid);
        return;
      }
      if (content.type === "carousel" && Array.isArray(content.items)) {
        const wrap = createEl("div", "discovery-setup-wizard__carousel-wrap");
        const prevBtn = createEl(
          "button",
          "discovery-setup-wizard__carousel-arrow discovery-setup-wizard__carousel-arrow--prev",
          { type: "button", "aria-label": "Previous option" },
          "‹",
        );
        const nextBtn = createEl(
          "button",
          "discovery-setup-wizard__carousel-arrow discovery-setup-wizard__carousel-arrow--next",
          { type: "button", "aria-label": "Next option" },
          "›",
        );
        const track = createEl("div", "discovery-setup-wizard__carousel");
        const cols = [];
        for (const item of content.items) {
          const col = createEl("div", "discovery-setup-wizard__carousel-col");
          renderContentSlot(col, item, context);
          track.appendChild(col);
          cols.push(col);
        }
        const dots = createEl("div", "discovery-setup-wizard__carousel-dots");
        cols.forEach((_, i) => {
          const dot = createEl(
            "button",
            "discovery-setup-wizard__carousel-dot",
            {
              type: "button",
              "aria-label": `Option ${i + 1}`,
            },
          );
          if (i === 0)
            dot.classList.add("discovery-setup-wizard__carousel-dot--active");
          dot.addEventListener("click", () => {
            cols[i].scrollIntoView({
              behavior: "smooth",
              block: "nearest",
              inline: "start",
            });
          });
          dots.appendChild(dot);
        });
        const updateDots = () => {
          const scrollLeft = track.scrollLeft;
          const colWidth = cols[0] ? cols[0].offsetWidth : 1;
          const idx = Math.round(scrollLeft / (colWidth + 8));
          dots
            .querySelectorAll(".discovery-setup-wizard__carousel-dot")
            .forEach((d, i) => {
              d.classList.toggle(
                "discovery-setup-wizard__carousel-dot--active",
                i === idx,
              );
            });
          prevBtn.disabled = idx === 0;
          nextBtn.disabled = idx >= cols.length - 1;
        };
        track.addEventListener("scroll", updateDots, { passive: true });
        prevBtn.addEventListener("click", () => {
          track.scrollBy({
            left: -(cols[0] ? cols[0].offsetWidth + 8 : 200),
            behavior: "smooth",
          });
        });
        nextBtn.addEventListener("click", () => {
          track.scrollBy({
            left: cols[0] ? cols[0].offsetWidth + 8 : 200,
            behavior: "smooth",
          });
        });
        wrap.append(prevBtn, track, nextBtn);
        slot.appendChild(wrap);
        slot.appendChild(dots);
        requestAnimationFrame(updateDots);
        return;
      }
      if (content.type === "fragment" && content.children) {
        renderContentSlot(slot, content.children, context);
      }
    }
  }

  function buildDefaultBody(context) {
    const slot = createEl("div", "discovery-setup-wizard__default-body");
    const step = context.activeStep;
    if (step.description) {
      appendText(
        slot,
        step.description,
        "discovery-setup-wizard__copy discovery-setup-wizard__copy--lead",
      );
    }
    return slot;
  }

  function buildStepBody(step, context) {
    const slot = createEl("div", "discovery-setup-wizard__step-body");
    if (typeof step.render === "function" || step.body) {
      renderContentSlot(slot, step.render || step.body, context);
      return slot;
    }
    return buildDefaultBody(context);
  }

  function normalizeActionDescriptor(action, context, step, slotType) {
    const raw = action && typeof action === "object" ? action : {};
    const kind = asString(raw.kind, "action");
    const id = asString(
      raw.id,
      kind === "back"
        ? "wizard_back"
        : kind === "next"
          ? "wizard_next"
          : kind === "close"
            ? "wizard_close"
            : `${step.id}_${slotType || "action"}`,
    );
    return {
      id,
      label: asString(
        raw.label,
        kind === "back" ? "Back" : kind === "next" ? "Continue" : "Action",
      ),
      variant: normalizeEnum(
        raw.variant,
        ["primary", "secondary", "ghost"],
        "secondary",
      ),
      kind,
      // A trigger running an async stage list stays disabled until the host
      // calls clearBusy() — a double-submit mid-check is the bug §3.5.3 names.
      disabled: asBoolean(raw.disabled) || isBusyAction(context, id),
      href: asString(raw.href),
      target: asString(raw.target),
      rel: asString(raw.rel),
      title: asString(raw.title),
      destructive: asBoolean(raw.destructive),
      stepId: asString(raw.stepId, step.id),
      payload: raw.payload,
      action,
      context,
    };
  }

  function buildFooterActions(context) {
    const step = context.activeStep;
    const customActions = toArray(step.actions).map((action) =>
      normalizeActionDescriptor(action, context, step, "primary"),
    );
    const secondaryActions = toArray(step.secondaryActions).map((action) =>
      normalizeActionDescriptor(action, context, step, "secondary"),
    );
    const actions = [];

    if (customActions.length) {
      actions.push(...customActions);
    } else if (context.canGoNext) {
      actions.push(
        normalizeActionDescriptor(
          {
            id: "wizard_next",
            label: "Continue",
            variant: "primary",
            kind: "next",
          },
          context,
          step,
          "next",
        ),
      );
    } else {
      actions.push(
        normalizeActionDescriptor(
          {
            id: "wizard_finish",
            label: "Finish setup",
            variant: "primary",
            kind: "next",
          },
          context,
          step,
          "finish",
        ),
      );
    }

    if (secondaryActions.length) {
      actions.push(...secondaryActions);
    }

    return actions;
  }

  function renderActionButton(action, context, step) {
    const isLink = !!action.href;
    const className = [
      "discovery-setup-wizard__btn",
      `discovery-setup-wizard__btn--${action.variant}`,
      action.destructive ? "discovery-setup-wizard__btn--destructive" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const attrs = {
      type: isLink ? undefined : "button",
      disabled: action.disabled ? true : undefined,
      title: action.title || undefined,
      dataset: {
        wizardAction: isLink ? "link" : "action",
        actionId: action.id,
        stepId: step.id,
        actionKind: action.kind,
      },
    };
    if (isLink) {
      attrs.href = action.href;
      attrs.target = action.target || "_blank";
      attrs.rel = action.rel || "noopener";
    }
    const el = createEl(
      isLink ? "a" : "button",
      className,
      attrs,
      action.label,
    );
    if (!isLink) {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        dispatchAction(asString(action.id), context, {
          stepId: asString(step.id),
          kind: asString(action.kind),
        });
      });
    }
    return el;
  }

  function renderStepNavigation(context) {
    const nav = createEl("nav", "discovery-setup-wizard__stepper", {
      "aria-label": "Discovery setup steps",
    });
    const total = context.steps.length;
    context.steps.forEach((step, i) => {
      const seg = createEl("button", "discovery-setup-wizard__seg", {
        type: "button",
        disabled: step.locked ? true : undefined,
        "aria-current": step.active ? "step" : undefined,
        "aria-label": `${step.label}. ${step.stateLabel}.`,
        dataset: {
          wizardAction: "step",
          stepId: step.id,
        },
      });
      if (step.completed)
        seg.classList.add("discovery-setup-wizard__seg--done");
      if (step.active) seg.classList.add("discovery-setup-wizard__seg--active");
      if (step.locked) seg.classList.add("discovery-setup-wizard__seg--locked");
      if (i === 0) seg.classList.add("discovery-setup-wizard__seg--first");
      if (i === total - 1)
        seg.classList.add("discovery-setup-wizard__seg--last");
      const label = createEl(
        "span",
        "discovery-setup-wizard__seg-label",
        {},
        step.label,
      );
      seg.appendChild(label);
      nav.appendChild(seg);
    });
    return nav;
  }




  function renderStepFrame(context) {
    const frame = createEl("section", "discovery-setup-wizard__frame", {
      "aria-live": "polite",
    });
    const step = context.activeStep;

    // Spec §2 "ONE spine": with the spine on screen, a per-beat "Step 1 of
    // 1" is a second progress system inside the card. Going back is
    // navigation, not progress, so the arrow stays either way — and the
    // kicker row only survives when it still has something in it.
    const kicker = createEl("div", "discovery-setup-wizard__step-kicker");
    if (context.canGoBack) {
      const backBtn = createEl(
        "button",
        "discovery-setup-wizard__back-arrow",
        { type: "button", "aria-label": "Go back" },
        "←",
      );
      backBtn.addEventListener("click", () =>
        dispatchAction("wizard_back", context),
      );
      kicker.appendChild(backBtn);
    }
    if (!context.spine) {
      appendText(
        kicker,
        `Step ${context.activeIndex + 1} of ${context.steps.length}`,
        "discovery-setup-wizard__step-kicker-text",
      );
    }
    if (kicker.children.length) frame.appendChild(kicker);
    const title = createEl(
      "h3",
      "discovery-setup-wizard__step-title",
      { id: "discoverySetupWizardStepTitle" },
      step.title || context.title,
    );
    frame.appendChild(title);
    appendText(
      frame,
      step.description || context.lede,
      "discovery-setup-wizard__step-lede",
    );

    const content = buildStepBody(step, context);
    content.classList.add("discovery-setup-wizard__step-content");
    frame.appendChild(content);

    if (step.footerNote) {
      appendText(frame, step.footerNote, "discovery-setup-wizard__step-note");
    }

    return frame;
  }

  /**
   * The flow's 6-beat spine (spec §3.5.1). Replaces the 3-stage journey
   * strip when a host passes `spine`; returns null otherwise so no
   * existing host gains a node.
   */
  function renderSpine(context) {
    if (!context.spine) return null;
    const wrap = createEl("div", "discovery-setup-wizard__spine-wrap");
    const list = createEl("ol", "discovery-setup-wizard__spine", {
      "aria-label": "Setup progress",
    });
    context.spine.beats.forEach((beat, index) => {
      const done =
        beat.done ||
        (context.spine.currentIndex >= 0 && index < context.spine.currentIndex);
      const current = beat.id === context.spine.current;
      const item = createEl(
        "li",
        [
          "discovery-setup-wizard__spine-step",
          done ? "discovery-setup-wizard__spine-step--done" : "",
          current ? "discovery-setup-wizard__spine-step--current" : "",
        ]
          .filter(Boolean)
          .join(" "),
        {
          dataset: { beatId: beat.id },
          ...(current ? { "aria-current": "step" } : {}),
        },
      );
      item.append(
        createEl(
          "span",
          "discovery-setup-wizard__spine-dot",
          { "aria-hidden": "true" },
          done ? "✓" : String(index + 1),
        ),
        createEl("span", "discovery-setup-wizard__spine-label", {}, beat.label),
      );
      list.appendChild(item);
    });
    wrap.appendChild(list);
    if (context.spine.timeLabel) {
      // "Name the deal, keep the deal" (spec §2.4): the time left is part
      // of the promise, so it lives beside the spine, always.
      wrap.appendChild(
        createEl(
          "p",
          "discovery-setup-wizard__spine-time",
          {},
          context.spine.timeLabel,
        ),
      );
    }
    return wrap;
  }

  /**
   * The message slot (spec §3.5.2). Every key check, every verification
   * result lands here — a rendered outcome instead of the silent
   * updateRuntime write that made B2/B5 feel broken.
   */
  function renderMessage(context) {
    if (!context.message) return null;
    const isError = context.messageTone === "error";
    return createEl(
      "p",
      `discovery-setup-wizard__message discovery-setup-wizard__message--${context.messageTone}`,
      {
        role: isError ? "alert" : "status",
        "aria-live": isError ? "assertive" : "polite",
      },
      context.message,
    );
  }

  /** The live ✓/◌/· stage list of a running action (spec §3.5.3). */
  function renderBusy(context) {
    if (!context.busy || !context.busy.stages.length) return null;
    const list = createEl("ol", "discovery-setup-wizard__busy", {
      "aria-live": "polite",
      dataset: { busyActionId: context.busy.actionId },
    });
    for (const stage of context.busy.stages) {
      const row = createEl(
        "li",
        `discovery-setup-wizard__busy-stage discovery-setup-wizard__busy-stage--${stage.state}`,
      );
      row.append(
        createEl(
          "span",
          "discovery-setup-wizard__busy-glyph",
          { "aria-hidden": "true" },
          BUSY_STAGE_GLYPHS[stage.state],
        ),
        createEl("span", "discovery-setup-wizard__busy-label", {}, ` ${stage.label}`),
      );
      list.appendChild(row);
    }
    return list;
  }

  function renderFooter(context) {
    const footer = createEl(
      "footer",
      context.spine
        ? // Claim C7: on a phone these actions have to reach the thumb, so
          // the one-flow footer becomes a dock the CORE sheet can stick to
          // the bottom of the viewport.
          "discovery-setup-wizard__footer discovery-setup-wizard__footer--dock"
        : "discovery-setup-wizard__footer",
    );
    const note = createEl("div", "discovery-setup-wizard__footer-note");
    const defaultNote =
      !context.spine && context.state.currentStep === context.activeStep.id
        ? "Use the step rail above to jump between steps."
        : "";
    appendText(
      note,
      context.activeStep.footerNote || defaultNote,
      "discovery-setup-wizard__copy",
    );

    const actions = createEl("div", "discovery-setup-wizard__actions");
    for (const action of buildFooterActions(context)) {
      actions.appendChild(
        renderActionButton(action, context, context.activeStep),
      );
    }
    footer.append(note, actions);
    // Under the actions: progress first, then the result that replaces it.
    const busy = renderBusy(context);
    if (busy) footer.appendChild(busy);
    const message = renderMessage(context);
    if (message) footer.appendChild(message);
    return footer;
  }

  /**
   * Continuity chrome: the three-stage setup journey (Profile → Job
   * discovery → Other devices) rendered as a small strip under the header,
   * with everything before the current stage marked done. Returns null when
   * the consumer didn't opt in (non-setup uses of the shell are unchanged).
   */
  function renderJourneyStrip(context) {
    if (!context.journeyStage) return null;
    const stages = [
      { key: "profile", label: "Profile" },
      { key: "discovery", label: "Job discovery" },
      { key: "devices", label: "Other devices" },
    ];
    // "bonus" = the optional post-setup track: every stage reads done.
    const currentIdx =
      context.journeyStage === "bonus"
        ? stages.length
        : stages.findIndex((s) => s.key === context.journeyStage);
    const strip = createEl("ol", "discovery-setup-wizard__journey", {
      "aria-label": "Setup progress",
    });
    stages.forEach((stage, idx) => {
      const state =
        idx < currentIdx ? "done" : idx === currentIdx ? "current" : "next";
      const item = createEl(
        "li",
        `discovery-setup-wizard__journey-step${
          state === "done"
            ? " discovery-setup-wizard__journey-step--done"
            : state === "current"
              ? " discovery-setup-wizard__journey-step--current"
              : ""
        }`,
        state === "current" ? { "aria-current": "step" } : {},
      );
      item.append(
        createEl(
          "span",
          "discovery-setup-wizard__journey-dot",
          { "aria-hidden": "true" },
          state === "done" ? "✓" : String(idx + 1),
        ),
        createEl("span", "", {}, ` ${stage.label}`),
      );
      strip.appendChild(item);
    });
    return strip;
  }

  function renderRoot(context) {
    const shellEl = createEl(
      "div",
      // The one-flow hook. Every rule this lane adds to css/oneflow.css
      // hangs off it, so a host that passes no spine keeps the markup AND
      // the paint it had (SUBSTRATE locked decision 1).
      context.spine
        ? "discovery-setup-wizard discovery-setup-wizard--spine"
        : "discovery-setup-wizard",
      {
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "discoverySetupWizardTitle",
        "aria-describedby": "discoverySetupWizardIntro",
      },
    );

    const scrim = createEl("div", "discovery-setup-wizard__scrim", {
      "aria-hidden": "true",
      dataset: {
        wizardAction: "close",
      },
    });
    shellEl.appendChild(scrim);

    const panel = createEl("section", "discovery-setup-wizard__panel", {
      tabindex: "-1",
      "data-wizard-panel": "true",
    });

    const header = createEl("header", "discovery-setup-wizard__header");
    const titleBlock = createEl("div", "discovery-setup-wizard__title-block");
    if (context.mascotSrc) {
      titleBlock.appendChild(
        createEl("img", "discovery-setup-wizard__mascot-thumb", {
          src: context.mascotSrc,
          alt: "",
          "aria-hidden": "true",
          decoding: "async",
        }),
      );
    }
    const title = createEl(
      "h2",
      "discovery-setup-wizard__title",
      { id: "discoverySetupWizardTitle" },
      context.headerTitle || "Discovery setup",
    );
    titleBlock.appendChild(title);

    const headerMeta = createEl("div", "discovery-setup-wizard__header-meta");
    const closeBtn = createEl("button", "discovery-setup-wizard__close", {
      type: "button",
      title: "Close wizard",
      "aria-label": "Close wizard",
      dataset: {
        wizardAction: "close",
      },
    });
    closeBtn.append(
      createEl("span", "discovery-setup-wizard__close-icon", {}, "×"),
      createEl("span", "discovery-setup-wizard__close-label", {}, "Close"),
    );
    headerMeta.appendChild(closeBtn);
    header.append(titleBlock, headerMeta);

    const body = createEl("div", "discovery-setup-wizard__body");
    body.append(renderStepFrame(context));

    // Spec §3.5.1: the spine REPLACES the journey strip — never both, or
    // the flow ships two progress systems, which is the defect §2 names.
    const spine = renderSpine(context);
    const journeyStrip = spine ? null : renderJourneyStrip(context);
    // Claim U2: the step rail rendered UNDER the spine, so beat 1 shipped a
    // lone "GOOGLE" pill below a six-segment spine — two rails for one
    // position. The spine owns the position; the rail belongs to the
    // multi-step legacy hosts that have nowhere else to navigate from.
    const stepNav = spine ? null : renderStepNavigation(context);
    panel.append(
      header,
      ...(spine ? [spine] : []),
      ...(journeyStrip ? [journeyStrip] : []),
      ...(stepNav ? [stepNav] : []),
      body,
      renderFooter(context),
    );

    shellEl.appendChild(panel);
    return shellEl;
  }

  function getFocusables(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (node) => !node.hasAttribute("disabled") && node.offsetParent !== null,
    );
  }

  function focusFirstInteractive(container) {
    const focusables = getFocusables(container);
    if (focusables.length) {
      focusables[0].focus();
      return focusables[0];
    }
    const panel = container.querySelector("[data-wizard-panel]");
    if (panel) {
      panel.focus();
      return panel;
    }
    return null;
  }

  function restoreFocus() {
    const last = shell.lastFocus;
    shell.lastFocus = null;
    if (last && typeof last.focus === "function" && document.contains(last)) {
      try {
        last.focus();
      } catch (_) {
        /* ignore */
      }
    }
  }

  function trapTabKey(event, container) {
    if (event.key !== "Tab") return false;
    const focusables = getFocusables(container);
    if (!focusables.length) return false;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
        return true;
      }
      return false;
    }
    if (active === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function dispatchAction(actionId, context, detail = {}) {
    if (typeof context.onAction === "function") {
      context.onAction(actionId, {
        ...detail,
        activeStepId: context.activeStep.id,
        step: context.activeStep,
        snapshot: context.snapshot,
        state: context.state,
      });
    } else if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[Discovery wizard] No onAction handler; action ignored:",
        actionId,
      );
    }
  }

  function navigateToStep(stepId, context, options = {}) {
    const nextSteps = context.steps;
    const exists = nextSteps.some((step) => step.id === stepId);
    if (!exists) return context;
    const nextState = normalizeWizardState({
      ...context.state,
      currentStep: stepId,
      completedSteps: uniqueStrings(
        options.completedSteps || context.state.completedSteps,
      ),
    });
    if (typeof context.onNavigate === "function") {
      context.onNavigate(stepId, {
        stepId,
        state: nextState,
        snapshot: context.snapshot,
        steps: nextSteps,
      });
    }
    if (typeof context.onStateChange === "function") {
      context.onStateChange(nextState, {
        reason: "navigate",
        stepId,
        snapshot: context.snapshot,
      });
    }
    return renderWizardShell({
      ...shell.lastRender?.input,
      ...options.inputPatch,
      state: nextState,
      activeStepId: stepId,
      focus: options.focus !== false,
      open: true,
    });
  }

  function bindDelegatesOnce(mount) {
    // Per-mount registry: a second wizard rendered into a different mount
    // (e.g. #goLiveSetupWizardMount) must also receive click + key delegates.
    // A boolean flag here would skip-bind everything after the first mount.
    if (!shell._boundMounts) shell._boundMounts = new Set();
    if (shell._boundMounts.has(mount)) return;
    shell._boundMounts.add(mount);
    shell._delegatesBound = true;

    mount.addEventListener("click", (event) => {
      const target = event.target.closest("[data-wizard-action]");
      if (!target || !mount.contains(target)) return;
      const context = shell.lastRender && shell.lastRender.context;
      if (!context) return;
      const action = target.dataset.wizardAction;
      if (action === "close") {
        event.preventDefault();
        closeWizardShell("close-button");
        return;
      }
      if (action === "step") {
        event.preventDefault();
        const stepId = asString(target.dataset.stepId);
        if (stepId) navigateToStep(stepId, context, { focus: true });
        return;
      }
      if (action === "action") {
        event.preventDefault();
        dispatchAction(asString(target.dataset.actionId), context, {
          stepId: asString(target.dataset.stepId),
          kind: asString(target.dataset.actionKind),
        });
        return;
      }
    });

    mount.addEventListener("keydown", (event) => {
      const context = shell.lastRender && shell.lastRender.context;
      if (!context || !shell.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeWizardShell("escape");
        return;
      }
      if (trapTabKey(event, mount)) return;
      if (event.key === "ArrowRight" && !event.metaKey && !event.altKey) {
        const next = context.nextStep;
        if (next) {
          event.preventDefault();
          navigateToStep(next.id, context, { focus: true });
        }
        return;
      }
      if (event.key === "ArrowLeft" && !event.metaKey && !event.altKey) {
        const previous = context.previousStep;
        if (previous) {
          event.preventDefault();
          navigateToStep(previous.id, context, { focus: true });
        }
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        navigateToStep(context.steps[0].id, context, { focus: true });
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        const last = context.steps[context.steps.length - 1];
        if (last) navigateToStep(last.id, context, { focus: true });
      }
    });
  }

  function closeWizardShell(reason = "close") {
    const mount = shell._mount;
    const context = shell.lastRender && shell.lastRender.context;
    if (!mount) return;
    shell.open = false;
    mount.setAttribute("hidden", "");
    mount.setAttribute("aria-hidden", "true");
    mount.replaceChildren();
    if (context && typeof context.onClose === "function") {
      context.onClose(reason, {
        state: context.state,
        snapshot: context.snapshot,
        stepId: context.activeStep.id,
      });
    }
    restoreFocus();
    shell.lastRender = null;
  }

  function destroyWizardShell() {
    closeWizardShell("destroy");
    shell._mount = null;
    shell._delegatesBound = false;
    if (shell._boundMounts) shell._boundMounts.clear();
  }

  function renderWizardShell(input = {}) {
    const context = getWizardContext(input);
    const mount = ensureMount(context.mountId);
    shell._mount = mount;
    shell.open = context.open;
    shell.lastFocus = document.activeElement;

    if (context.open) {
      mount.removeAttribute("hidden");
      mount.setAttribute("aria-hidden", "false");
      mount.replaceChildren(renderRoot(context));
    } else {
      mount.replaceChildren();
    }

    bindDelegatesOnce(mount);

    const rootElement = mount.firstElementChild;
    shell.lastRender = {
      input: {
        ...input,
        snapshot: context.snapshot,
        state: context.state,
        activeStepId: context.activeStep.id,
        open: context.open,
      },
      context,
      element: rootElement,
    };

    if (context.open) {
      const shouldFocus = input.focus !== false;
      requestAnimationFrame(() => {
        if (!shell.open) return;
        const panel = mount.querySelector("[data-wizard-panel]");
        if (shouldFocus && panel) {
          focusFirstInteractive(panel.parentElement || mount);
        } else if (shouldFocus) {
          focusFirstInteractive(mount);
        }
      });
    }

    if (typeof context.onRender === "function") {
      context.onRender({
        ...context,
        element: rootElement,
      });
    }

    return shell.lastRender;
  }

  function updateWizardShell(patch = {}) {
    const previous = shell.lastRender ? shell.lastRender.input : {};
    return renderWizardShell({
      ...previous,
      ...patch,
      open: patch.open !== undefined ? patch.open : shell.open,
    });
  }

  function selectWizardStep(stepId, options = {}) {
    const previous = shell.lastRender ? shell.lastRender.input : {};
    const currentContext = shell.lastRender && shell.lastRender.context;
    const context = currentContext
      ? {
          ...currentContext,
          state: normalizeWizardState({
            ...currentContext.state,
            currentStep: stepId,
            completedSteps:
              options.completedSteps != null
                ? uniqueStrings(options.completedSteps)
                : currentContext.state.completedSteps,
          }),
        }
      : null;
    if (!context) {
      return renderWizardShell({
        ...previous,
        activeStepId: stepId,
      });
    }
    return renderWizardShell({
      ...previous,
      state: context.state,
      activeStepId: stepId,
      open: options.open !== false,
      focus: options.focus !== false,
    });
  }

  function setWizardState(nextState, options = {}) {
    const previous = shell.lastRender ? shell.lastRender.input : {};
    const state = normalizeWizardState(nextState);
    if (
      shell.lastRender &&
      shell.lastRender.context &&
      typeof shell.lastRender.context.onStateChange === "function"
    ) {
      shell.lastRender.context.onStateChange(state, {
        reason: options.reason || "external",
        snapshot: shell.lastRender.context.snapshot,
      });
    }
    return renderWizardShell({
      ...previous,
      state,
      activeStepId: asString(options.activeStepId, state.currentStep),
      open: options.open !== false,
      focus: options.focus !== false,
    });
  }

  /**
   * Render a message under the actions (spec §3.5.2). No-op before the
   * first render — the host owns the shell's lifecycle.
   */
  function setMessage(text, tone) {
    if (!shell.lastRender) return null;
    return updateWizardShell({
      message: asString(text),
      messageTone: normalizeEnum(tone, MESSAGE_TONES, "info"),
      focus: false,
    });
  }

  function clearMessage() {
    if (!shell.lastRender) return null;
    return updateWizardShell({ message: "", messageTone: "info", focus: false });
  }

  /**
   * Put one action into its busy state (spec §3.5.3): disable its trigger
   * and render `stages` as a live ✓/◌/· list. Call again with
   * advanced stages to move the list; clearBusy() when the work lands.
   */
  function setBusy(actionId, stages) {
    if (!shell.lastRender) return null;
    return updateWizardShell({
      busy: { actionId, stages },
      focus: false,
    });
  }

  function clearBusy() {
    if (!shell.lastRender) return null;
    return updateWizardShell({ busy: null, focus: false });
  }

  function getWizardContextSnapshot() {
    return shell.lastRender ? shell.lastRender.context : null;
  }

  function getMountElement() {
    return document.getElementById(root.mount.id);
  }

  function describeStepState(stepId, context = getWizardContextSnapshot()) {
    if (!context) return null;
    return context.steps.find((step) => step.id === stepId) || null;
  }

  Object.assign(shell, {
    getMountElement,
    normalizeSnapshot,
    normalizeWizardState,
    buildStepModel,
    buildWizardContext: getWizardContext,
    summarizeSnapshot,
    renderWizardShell,
    updateWizardShell,
    selectWizardStep,
    setActiveStep: selectWizardStep,
    goToStep: selectWizardStep,
    setWizardState,
    closeWizardShell,
    hideWizardShell: closeWizardShell,
    destroyWizardShell,
    openWizardShell: renderWizardShell,
    focusFirstInteractive,
    restoreFocus,
    getWizardContext: getWizardContextSnapshot,
    describeStepState,
    setMessage,
    clearMessage,
    setBusy,
    clearBusy,
  });
})();
