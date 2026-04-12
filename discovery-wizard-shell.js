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
      title: "Enter your webhook URL.",
      description: "Paste a public HTTPS endpoint you already control.",
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

  function normalizeSnapshot(snapshot) {
    const raw = snapshot && typeof snapshot === "object" ? snapshot : {};
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

  function normalizeWizardState(state) {
    const raw = state && typeof state === "object" ? state : {};
    const completedSteps = uniqueStrings(raw.completedSteps);
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

  function getFlowLabel(flow) {
    if (flow === "external_endpoint") return "My own webhook";
    if (flow === "no_webhook") return "Manual / no webhook";
    if (flow === "stub_only") return "Stub only (testing)";
    return "Local (this computer)";
  }

  function getSavedEndpointLabel(kind) {
    if (kind === "worker") return "Cloudflare Worker";
    if (kind === "generic_https") return "HTTPS webhook";
    if (kind === "apps_script_stub") return "Apps Script stub";
    if (kind === "local_http") return "localhost (needs relay)";
    return "none";
  }

  function getBlockingIssueLabel(issue) {
    if (issue === "missing_sheet") return "Pipeline sheet not configured.";
    if (issue === "stub_only") return "Only the Apps Script stub is saved.";
    if (issue === "local_health_unavailable") {
      return "Local server found but not responding.";
    }
    if (issue === "ngrok_missing") {
      return "Server is up but no tunnel is running.";
    }
    if (issue === "relay_missing") {
      return "Relay not deployed yet.";
    }
    if (issue === "needs_recovery") {
      return "Local setup needs recovery after restart.";
    }
    return "";
  }

  function getRecommendationReason(snapshot) {
    if (snapshot.recommendedReason) return snapshot.recommendedReason;
    if (snapshot.savedWebhookKind === "worker") {
      return "A Cloudflare Worker URL is already saved.";
    }
    if (snapshot.savedWebhookKind === "generic_https") {
      return "A webhook URL is already saved.";
    }
    if (snapshot.savedWebhookKind === "apps_script_stub") {
      return "Only the Apps Script stub is saved — upgrade to a real endpoint.";
    }
    if (
      snapshot.savedWebhookKind === "local_http" ||
      snapshot.localWebhookUrl ||
      snapshot.tunnelPublicUrl ||
      snapshot.localBootstrapAvailable
    ) {
      return "Local setup detected on this machine.";
    }
    return "No webhook saved yet — pick a path to get started.";
  }

  function buildSnapshotChecklist(snapshot) {
    const browserFacingReady =
      !!snapshot.savedWebhookUrl && snapshot.savedWebhookKind !== "local_http";
    const browserFacingTone =
      snapshot.savedWebhookKind === "apps_script_stub"
        ? "warning"
        : browserFacingReady
          ? "success"
          : "warning";
    const relayReady =
      snapshot.savedWebhookKind === "worker" || snapshot.relayReady;
    return [
      {
        label: "Pipeline sheet",
        tone: snapshot.sheetConfigured ? "success" : "warning",
        detail: snapshot.sheetConfigured ? "Connected" : "Not configured",
      },
      {
        label: "Webhook URL",
        tone: browserFacingTone,
        detail:
          snapshot.savedWebhookKind === "apps_script_stub"
            ? "Stub only"
            : browserFacingReady
              ? getSavedEndpointLabel(snapshot.savedWebhookKind)
              : "Not saved",
      },
      {
        label: "Local server",
        tone: snapshot.localWebhookReady
          ? "success"
          : snapshot.localWebhookUrl
            ? "warning"
            : "muted",
        detail: snapshot.localWebhookReady
          ? "Healthy"
          : snapshot.localWebhookUrl
            ? "Not responding"
            : "Not needed",
      },
      {
        label: "Tunnel",
        tone: snapshot.tunnelLive
          ? snapshot.tunnelStale
            ? "warning"
            : "success"
          : snapshot.localWebhookUrl
            ? "warning"
            : "muted",
        detail: snapshot.tunnelLive
          ? snapshot.tunnelStale
            ? "Rotated — relay needs update"
            : "Active"
          : snapshot.localWebhookUrl
            ? "Not running"
            : "Not needed",
      },
      {
        label: "Relay",
        tone: relayReady
          ? "success"
          : snapshot.localWebhookUrl || snapshot.savedWebhookKind === "worker"
            ? "warning"
            : "muted",
        detail: relayReady
          ? "Deployed"
          : snapshot.localWebhookUrl || snapshot.savedWebhookKind === "worker"
            ? "Not deployed"
            : "Not needed",
      },
    ];
  }

  function renderSnapshotChecklist(items) {
    const list = createEl("ul", "discovery-setup-wizard__checklist");
    items.forEach((item) => {
      const row = createEl(
        "li",
        `discovery-setup-wizard__checklist-item discovery-setup-wizard__checklist-item--${item.tone || "muted"}`,
      );
      const icon = createEl(
        "span",
        "discovery-setup-wizard__checklist-icon",
        { "aria-hidden": "true" },
        item.tone === "success" ? "✓" : item.tone === "warning" ? "!" : "•",
      );
      const copy = createEl("div", "discovery-setup-wizard__checklist-copy");
      appendText(copy, item.label, "discovery-setup-wizard__checklist-title");
      appendText(copy, item.detail, "discovery-setup-wizard__checklist-detail");
      row.append(icon, copy);
      list.appendChild(row);
    });
    return list;
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

  function getWizardContext(input = {}) {
    const snapshot = normalizeSnapshot(input.snapshot);
    const state = normalizeWizardState(input.state);
    const steps = buildStepModel(
      toArray(input.steps).map((step, index) => normalizeStep(step, index)),
      state,
      input.activeStepId,
    );
    const activeStep = steps.steps[steps.activeIndex];
    return {
      title: asString(input.title, DEFAULT_TITLE),
      lede: asString(input.lede, DEFAULT_LEDE),
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
    };
  }

  function ensureMount() {
    const mount = document.getElementById(root.mount.id);
    if (!mount) {
      throw new Error(
        `Discovery wizard mount #${root.mount.id} is missing from the page.`,
      );
    }
    if (mount.classList) {
      mount.classList.add(root.mount.shellClassName);
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

  function appendChips(parent, items) {
    const wrap = createEl("div", "discovery-setup-wizard__chips");
    for (const item of items) {
      const chip = createEl(
        "span",
        `discovery-setup-wizard__chip discovery-setup-wizard__chip--${item.tone || "info"}`,
        {},
        `${item.label}: ${item.value}`,
      );
      wrap.appendChild(chip);
    }
    parent.appendChild(wrap);
    return wrap;
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
              flowMap[item.flow] || `wizard_choose_flow_${item.flow}`;
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
      disabled: asBoolean(raw.disabled),
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

  const RECOVERY_SENTENCES = {
    needs_full_restart:
      "Your computer restarted, so the local worker and tunnel need to be brought back up.",
    worker_down:
      "The local discovery worker is not responding. It may need to be restarted.",
    tunnel_down:
      "The public ngrok tunnel is not running, so the saved Worker URL cannot reach your local worker right now.",
    tunnel_rotated:
      "ngrok gave your local setup a new public URL, so the relay behind your saved Worker URL needs to be redeployed.",
  };

  function getRecoveryCopy(snapshot) {
    const probes = root.probes || {};
    if (typeof probes.buildRecoveryCopy === "function") {
      return probes.buildRecoveryCopy(snapshot);
    }
    const recovery = asString(snapshot && snapshot.localRecoveryState, "ok");
    return {
      title:
        recovery === "tunnel_rotated"
          ? "Public tunnel changed"
          : "Local setup needs recovery",
      detail:
        RECOVERY_SENTENCES[recovery] ||
        "Part of the local discovery chain is down after a restart.",
      actionHint:
        "Click Fix setup to restart what is down and redeploy the relay if needed.",
      detectBody: [
        RECOVERY_SENTENCES[recovery] ||
          "Part of the local discovery chain is down after a restart.",
      ],
    };
  }

  function renderSnapshotPanel(context) {
    const aside = createEl("aside", "discovery-setup-wizard__snapshot", {
      "aria-label": "Discovery readiness summary",
    });
    const recovery = context.snapshot.localRecoveryState || "ok";

    if (recovery !== "ok") {
      const recoveryCopy = getRecoveryCopy(context.snapshot);
      const banner = createEl(
        "div",
        "discovery-setup-wizard__summary-card discovery-setup-wizard__summary-card--recovery",
      );
      appendText(
        banner,
        "Recovery needed",
        "discovery-setup-wizard__card-kicker",
      );
      const bannerTitle = createEl(
        "h3",
        "discovery-setup-wizard__card-title",
        {},
        recoveryCopy.title,
      );
      banner.appendChild(bannerTitle);
      for (const line of recoveryCopy.detectBody || [recoveryCopy.detail]) {
        appendText(
          banner,
          line,
          "discovery-setup-wizard__copy discovery-setup-wizard__copy--lead",
        );
      }
      appendText(
        banner,
        recoveryCopy.actionHint,
        "discovery-setup-wizard__copy",
      );
      aside.appendChild(banner);
    }

    const card = createEl(
      "div",
      "discovery-setup-wizard__summary-card discovery-setup-wizard__summary-card--hero",
    );
    appendText(card, "Recommended", "discovery-setup-wizard__card-kicker");
    const title = createEl(
      "h3",
      "discovery-setup-wizard__card-title",
      {},
      getFlowLabel(context.snapshot.recommendedFlow),
    );
    card.appendChild(title);
    appendText(
      card,
      getRecommendationReason(context.snapshot),
      "discovery-setup-wizard__copy discovery-setup-wizard__copy--lead",
    );
    if (context.snapshot.blockingIssue) {
      const warn = createEl(
        "div",
        "discovery-setup-wizard__callout discovery-setup-wizard__callout--warning",
      );
      appendText(
        warn,
        getBlockingIssueLabel(context.snapshot.blockingIssue),
        "discovery-setup-wizard__callout-text",
      );
      card.appendChild(warn);
    }
    aside.appendChild(card);

    const checklistCard = createEl(
      "div",
      "discovery-setup-wizard__summary-card",
    );
    appendText(
      checklistCard,
      "Checklist",
      "discovery-setup-wizard__card-kicker",
    );
    checklistCard.appendChild(
      renderSnapshotChecklist(buildSnapshotChecklist(context.snapshot)),
    );
    aside.appendChild(checklistCard);
    return aside;
  }

  function renderStepFrame(context) {
    const frame = createEl("section", "discovery-setup-wizard__frame", {
      "aria-live": "polite",
    });
    const step = context.activeStep;

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
    appendText(
      kicker,
      `Step ${context.activeIndex + 1} of ${context.steps.length}`,
      "discovery-setup-wizard__step-kicker-text",
    );
    frame.appendChild(kicker);
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

  function renderFooter(context) {
    const footer = createEl("footer", "discovery-setup-wizard__footer");
    const note = createEl("div", "discovery-setup-wizard__footer-note");
    const defaultNote =
      context.state.currentStep === context.activeStep.id
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
    return footer;
  }

  function renderRoot(context) {
    const shellEl = createEl("div", "discovery-setup-wizard", {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "discoverySetupWizardTitle",
      "aria-describedby": "discoverySetupWizardIntro",
    });

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
    const title = createEl(
      "h2",
      "discovery-setup-wizard__title",
      { id: "discoverySetupWizardTitle" },
      "Discovery setup",
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

    panel.append(
      header,
      renderStepNavigation(context),
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
    if (shell._delegatesBound) return;
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
  }

  function renderWizardShell(input = {}) {
    const mount = ensureMount();
    const context = getWizardContext(input);
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
  });
})();
