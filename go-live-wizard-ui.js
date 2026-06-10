/* ============================================
   COMMAND CENTER v2 — "Use JobBored on other devices" wizard
   Two-path go-live wizard: Tailscale mesh (heavily automated) or cloud
   deploy (detect + guide + verify). Renders through the shared discovery
   wizard shell (variant:"generic", mountId:"goLiveSetupWizardMount") and
   matches its visual language so the experience reads as one wizard family.

   Classic-global IIFE under window.JobBoredGoLive — NOT an ES module
   (matches the discovery wizard's loader). Loaded BEFORE app.js, so the
   app.js helper bridge is read LAZILY inside each function via
   window.JobBoredGoLive.host, never captured at IIFE top.
   ============================================ */
(() => {
  const root = window.JobBoredGoLive || (window.JobBoredGoLive = {});

  // Lazy bridges. app.js / app-compat.js publish these AFTER this file runs.
  function host() {
    return root.host;
  }
  function dom() {
    return (typeof window !== "undefined" && window.JobBoredWizardDom) || null;
  }
  function shellApi() {
    const w = typeof window !== "undefined" && window.JobBoredDiscoveryWizard;
    return (w && w.shell) || null;
  }
  function uc() {
    return (
      (typeof window !== "undefined" && window.CommandCenterUserContent) || null
    );
  }

  // Onboarding funnel telemetry — best-effort, looked up lazily so a missing
  // module never breaks the chain. See onboarding-telemetry.js.
  function emitOnboardingEvent(step, detail) {
    try {
      const t =
        typeof window !== "undefined" && window.JobBoredOnboardingTelemetry;
      if (t && typeof t.emit === "function") t.emit(step, detail);
    } catch (_) {
      /* telemetry is non-critical */
    }
  }

  const MOUNT_ID = "goLiveSetupWizardMount";
  const HEADER_TITLE = "Use JobBored on other devices";
  const TITLE = "Use JobBored on other devices";
  const LEDE =
    "Open your dashboard from your phone or another laptop. Pick the path that fits — both are honest about what's automated and what you run yourself.";
  const DASHBOARD_PORT = 8080;
  const FETCH_TIMEOUT_MS = 6000;
  const SELF_HOSTING_DOC_URL = "docs/SELF-HOSTING.md";

  // ----------------------------------------------------------------------
  // Runtime — intentionally simple. The go-live wizard's state is shallow
  // compared to discovery: which path the user chose, the last probe of
  // tailscale-state + install-doctor, the user-pasted cloud URL, the last
  // verify result, and any user-facing message. No flow cache.
  // ----------------------------------------------------------------------
  function defaultRuntime() {
    return {
      activeStepId: "path_select",
      state: { currentStep: "path_select", completedSteps: [] },
      entryPoint: "manual",
      tailscaleState: null,
      installDoctor: null,
      tailscaleVerify: null,
      cloudPath: "",
      cloudUrl: "",
      cloudVerify: null,
      message: "",
      messageTone: "info",
      _onboardingHidden: false,
    };
  }

  let runtime = null;
  function getRuntime() {
    return runtime || (runtime = defaultRuntime());
  }
  function setRuntime(next) {
    runtime = next || defaultRuntime();
    return runtime;
  }
  function updateRuntime(patch) {
    runtime = { ...getRuntime(), ...(patch || {}) };
    return runtime;
  }
  function clearRuntime() {
    runtime = null;
  }

  function setMessage(text, tone) {
    updateRuntime({ message: text || "", messageTone: tone || "info" });
  }

  // ----------------------------------------------------------------------
  // Probes — every backend call goes through fetchWithTimeout so a dead
  // /__proxy endpoint (deployed dashboard, dev-server down) fails fast.
  // Each probe returns null on failure; callers render guidance instead
  // of bubbling the network error.
  // ----------------------------------------------------------------------
  function fetchWithTimeout(url, options) {
    const opts = options || {};
    const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
    if (typeof AbortController === "undefined") {
      return fetch(url, opts);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {
        /* ignore */
      }
    }, timeoutMs);
    const finalOpts = { ...opts, signal: controller.signal };
    return fetch(url, finalOpts).finally(() => clearTimeout(timer));
  }

  async function probeTailscaleState() {
    try {
      const r = await fetchWithTimeout("/__proxy/tailscale-state", {
        cache: "no-store",
      });
      if (!r || !r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  }

  async function probeInstallDoctor() {
    try {
      // The dev-server routes /__proxy/install-doctor as POST-only; a GET 404s
      // and the cloud path silently degrades to "couldn't reach backend".
      const r = await fetchWithTimeout("/__proxy/install-doctor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      if (!r || !r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  }

  async function runTailscaleServe(port) {
    try {
      const r = await fetchWithTimeout("/__proxy/tailscale-serve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: port || DASHBOARD_PORT }),
      });
      if (!r) return { ok: false, error: "no response" };
      const body = await r.json().catch(() => ({}));
      return { ok: !!r.ok && !!body.ok, ...body };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async function probeUrlReachable(url) {
    if (!url || !/^https?:\/\//i.test(url)) {
      return { ok: false, reason: "invalid_url" };
    }
    try {
      await fetchWithTimeout(url, {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        redirect: "follow",
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err) };
    }
  }

  function deriveTailscaleDashboardUrl(state) {
    if (!state || typeof state !== "object") return "";
    if (typeof state.dashboardUrl === "string" && state.dashboardUrl) {
      return state.dashboardUrl;
    }
    const dns = typeof state.dnsName === "string" ? state.dnsName.trim() : "";
    if (!dns) return "";
    return `https://${dns.replace(/\/$/, "")}`;
  }

  // ----------------------------------------------------------------------
  // Body builders. Each receives the current runtime and returns a DOM
  // node assembled with the shared window.JobBoredWizardDom helpers (FE-1
  // contract). When the helpers aren't loaded (early init), we fall back
  // to plain document.createElement so the wizard never throws during
  // first paint.
  // ----------------------------------------------------------------------
  function safeCreate(tag, className, text) {
    const D = dom();
    if (D && typeof D.createWizardNode === "function") {
      return D.createWizardNode(tag, className, text);
    }
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function safeParagraph(parent, text, className) {
    if (!text) return null;
    const D = dom();
    if (D && typeof D.appendWizardParagraph === "function") {
      return D.appendWizardParagraph(
        parent,
        text,
        className || "discovery-setup-wizard__copy",
      );
    }
    const p = safeCreate(
      "p",
      className || "discovery-setup-wizard__copy",
      text,
    );
    parent.appendChild(p);
    return p;
  }

  function safeList(parent, items) {
    const D = dom();
    if (D && typeof D.appendWizardList === "function") {
      return D.appendWizardList(parent, items);
    }
    const ul = safeCreate("ul", "discovery-setup-wizard__list");
    (items || []).filter(Boolean).forEach((item) => {
      const li = safeCreate("li", "", String(item));
      ul.appendChild(li);
    });
    parent.appendChild(ul);
    return ul;
  }

  function safeCodeBlock(parent, text, copyLabel) {
    if (!text) return null;
    const D = dom();
    if (D && typeof D.appendWizardCodeBlock === "function") {
      return D.appendWizardCodeBlock(parent, text, copyLabel || "Copy");
    }
    const row = safeCreate("div", "scraper-setup-copyrow");
    const code = safeCreate("pre", "scraper-setup-code", text);
    const btn = safeCreate(
      "button",
      "btn-copy-scraper",
      copyLabel || "Copy",
    );
    btn.type = "button";
    btn.addEventListener("click", () => {
      const h = host();
      if (h && typeof h.copyTextToClipboard === "function") {
        h.copyTextToClipboard(text);
      }
    });
    row.appendChild(code);
    row.appendChild(btn);
    parent.appendChild(row);
    return row;
  }

  function safeCallout(parent, text, tone) {
    if (!text) return null;
    const card = safeCreate(
      "div",
      `discovery-setup-wizard__callout${tone ? ` discovery-setup-wizard__callout--${tone}` : ""}`,
    );
    safeParagraph(card, text, "discovery-setup-wizard__callout-text");
    parent.appendChild(card);
    return card;
  }

  function safeInput(parent, options) {
    const opts = options || {};
    const D = dom();
    if (D && typeof D.appendWizardInput === "function") {
      return D.appendWizardInput(parent, opts);
    }
    const wrap = safeCreate("div", "discovery-setup-wizard__inputrow");
    if (opts.label) {
      const lbl = safeCreate("label", "settings-field-label", opts.label);
      if (opts.id) lbl.setAttribute("for", opts.id);
      wrap.appendChild(lbl);
    }
    const input = safeCreate("input", "settings-input");
    input.type = opts.type || "text";
    if (opts.id) input.id = opts.id;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.value != null) input.value = String(opts.value);
    if (typeof opts.onInput === "function") {
      input.addEventListener("input", (ev) =>
        opts.onInput(ev && ev.target ? ev.target.value : ""),
      );
    }
    wrap.appendChild(input);
    if (opts.hint) {
      const hint = safeCreate("p", "settings-field-hint", opts.hint);
      wrap.appendChild(hint);
    }
    parent.appendChild(wrap);
    return wrap;
  }

  function safeResultCard(parent, result, title) {
    const D = dom();
    if (D && typeof D.appendWizardResultCard === "function") {
      return D.appendWizardResultCard(parent, result, title);
    }
    const card = safeCreate(
      "div",
      `discovery-setup-wizard__summary-card discovery-setup-wizard__summary-card--${result && result.ok ? "ok" : "warn"}`,
    );
    if (title) {
      const h = safeCreate(
        "h4",
        "discovery-setup-wizard__card-title",
        title,
      );
      card.appendChild(h);
    }
    if (result && result.message) {
      safeParagraph(card, result.message);
    }
    parent.appendChild(card);
    return card;
  }

  // ----------------------------------------------------------------------
  // Step 1 — Path select. Two cards, plain language about what's automated
  // vs. what the user runs. Cards dispatch via the shell's data-wizard-action
  // delegate so they integrate with the keyboard + focus story.
  // ----------------------------------------------------------------------
  function buildPathCard(parent, descriptor) {
    const card = safeCreate(
      "button",
      "discovery-setup-wizard__option-card go-live-wizard__path-card",
    );
    card.type = "button";
    card.setAttribute("data-wizard-action", "action");
    card.setAttribute("data-action-id", descriptor.actionId);
    card.setAttribute("data-step-id", "path_select");
    card.setAttribute("data-action-kind", "primary");
    if (descriptor.recommended) {
      card.classList && card.classList.add("go-live-wizard__path-card--recommended");
    }

    if (descriptor.kicker) {
      const kicker = safeCreate(
        "span",
        "discovery-setup-wizard__card-kicker",
        descriptor.kicker,
      );
      card.appendChild(kicker);
    }
    const title = safeCreate(
      "h4",
      "discovery-setup-wizard__card-title",
      descriptor.title,
    );
    card.appendChild(title);
    if (descriptor.summary) {
      safeParagraph(card, descriptor.summary, "go-live-wizard__path-summary");
    }
    // Structured trade-off rows — a colored glyph per row instead of "+ x"
    // prefix strings, so the comparison scans at a glance.
    const points = safeCreate("ul", "go-live-wizard__path-points");
    const addPoint = (text, kind) => {
      const li = safeCreate(
        "li",
        `go-live-wizard__path-point go-live-wizard__path-point--${kind}`,
      );
      const glyph = safeCreate(
        "span",
        "go-live-wizard__path-glyph",
        kind === "pro" ? "✓" : "−",
      );
      glyph.setAttribute("aria-hidden", "true");
      li.appendChild(glyph);
      li.appendChild(safeCreate("span", "", String(text)));
      points.appendChild(li);
    };
    (descriptor.pros || []).forEach((p) => addPoint(p, "pro"));
    (descriptor.cons || []).forEach((c) => addPoint(c, "con"));
    if (points.children && points.children.length) card.appendChild(points);
    const choose = safeCreate(
      "span",
      "go-live-wizard__path-choose",
      descriptor.recommended ? "Choose this path →" : "Choose this instead →",
    );
    card.appendChild(choose);
    parent.appendChild(card);
    return card;
  }

  function buildPathSelectBody() {
    const container = safeCreate("div", "go-live-wizard__path-select");
    safeParagraph(
      container,
      "Both paths solve the same problem (open the dashboard on another device). They trade off differently:",
    );
    const grid = safeCreate("div", "discovery-setup-wizard__option-grid");
    buildPathCard(grid, {
      actionId: "wizard_choose_path_tailscale",
      kicker: "Recommended",
      title: "Tailscale mesh",
      summary:
        "Open your local dashboard from any device on your private tailnet, over a stable HTTPS URL that never rotates.",
      pros: [
        "Private — only your devices, no public URL",
        "Stable — the tailnet URL doesn't change",
        "Mostly automated — we detect, expose port 8080, and verify for you",
      ],
      cons: [
        "All devices must be signed into the same Tailscale account",
        "Your laptop has to be on and serving",
      ],
      recommended: true,
    });
    buildPathCard(grid, {
      actionId: "wizard_choose_path_cloud",
      kicker: "Alternative",
      title: "Deploy to the cloud",
      summary:
        "Publish the static dashboard to Vercel, Netlify, or GitHub Pages so any device with the URL can use it.",
      pros: [
        "Reachable without Tailscale (any browser, any network)",
        "Free tiers cover this entirely",
      ],
      cons: [
        "Cloud sign-in is interactive — the deploy click is yours",
        "Public URL needs to be added to Google OAuth authorized origins",
      ],
    });
    container.appendChild(grid);
    safeCallout(
      container,
      "Worker discovery is a separate setup — finish either of these and we'll recommend it next.",
      "info",
    );
    return container;
  }

  // ----------------------------------------------------------------------
  // Step 2 — Tailscale path. The "ready" / "needs_serve" / "needs_login"
  // / "needs_install" recommendation drives which sub-state we render.
  // We always read the latest tailscaleState probe + install-doctor tools.
  // ----------------------------------------------------------------------
  function buildTailscaleBody(rt) {
    const container = safeCreate("div", "go-live-wizard__tailscale");
    const state = rt.tailscaleState;
    const doctor = rt.installDoctor;
    const proxyAvailable = state !== null || (doctor && doctor.ok === true);

    if (!proxyAvailable) {
      safeCallout(
        container,
        "We couldn't reach the local backend (/__proxy endpoints didn't respond). Start the local dev server (npm run web-only) and click Re-detect.",
        "warn",
      );
      // Link to full reference even when proxy is unreachable.
      const link = safeCreate(
        "a",
        "discovery-setup-wizard__link",
        "Full Tailscale + dashboard reference",
      );
      link.setAttribute("href", SELF_HOSTING_DOC_URL);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
      container.appendChild(link);
      return container;
    }

    const installed = !!(state && state.installed);
    const loggedIn = !!(state && state.loggedIn);
    const recommendation =
      (state && state.recommendation) ||
      (!installed
        ? "needs_install"
        : !loggedIn
          ? "needs_login"
          : !(state.serving && state.serving[DASHBOARD_PORT])
            ? "needs_serve"
            : "ready");
    const derivedUrl = deriveTailscaleDashboardUrl(state);

    // Step indicators — show every sub-step and what's currently blocking.
    const items = [];
    items.push(
      installed
        ? `Tailscale installed${state.version ? ` (${state.version})` : ""}`
        : "Tailscale not installed",
    );
    items.push(loggedIn ? "Logged into your tailnet" : "Not logged in");
    const serving = !!(state && state.serving && state.serving[DASHBOARD_PORT]);
    items.push(
      serving
        ? `Serving dashboard on port ${DASHBOARD_PORT}`
        : `Not serving port ${DASHBOARD_PORT} yet`,
    );
    safeList(container, items);

    if (recommendation === "needs_install") {
      safeParagraph(
        container,
        "Install Tailscale, then click Re-detect:",
        "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
      );
      safeList(container, [
        "macOS: brew install --cask tailscale (or download from tailscale.com/download)",
        "Linux: curl -fsSL https://tailscale.com/install.sh | sh",
        "Windows: download the installer from tailscale.com/download",
      ]);
    } else if (recommendation === "needs_login") {
      safeParagraph(
        container,
        "Tailscale is installed but signed out. Run this in a terminal, then click Re-detect:",
        "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
      );
      safeCodeBlock(container, "tailscale up", "Copy command");
    } else if (recommendation === "needs_serve") {
      safeParagraph(
        container,
        `Tailscale is up. Expose your local dashboard (port ${DASHBOARD_PORT}) over a stable HTTPS URL:`,
        "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
      );
      // The serve action is one-click via /__proxy/tailscale-serve.
    } else if (recommendation === "ready") {
      const urlBlock = safeCreate(
        "div",
        "discovery-setup-wizard__url-block",
      );
      safeParagraph(
        urlBlock,
        "Your dashboard URL — open this on any device on the same tailnet:",
        "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
      );
      safeCodeBlock(urlBlock, derivedUrl || "(no URL yet)", "Copy URL");
      container.appendChild(urlBlock);
      if (rt.tailscaleVerify) {
        safeResultCard(
          container,
          {
            ok: !!rt.tailscaleVerify.ok,
            message: rt.tailscaleVerify.ok
              ? `Reachable — last checked just now.`
              : `Couldn't reach ${derivedUrl}. ${rt.tailscaleVerify.reason || ""}`,
          },
          "Reachability check",
        );
      }
      safeCallout(
        container,
        "Last step: add this URL to your Google OAuth authorized origins (console.cloud.google.com → Credentials → your OAuth client). That step can't be automated — Google requires you to do it from their console.",
      );
    }

    // Always link the deep reference (kept as the spec says).
    const link = safeCreate(
      "a",
      "discovery-setup-wizard__link",
      "Full Tailscale + dashboard reference",
    );
    link.setAttribute("href", SELF_HOSTING_DOC_URL);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener");
    container.appendChild(link);

    return container;
  }

  function buildTailscaleActions(rt) {
    const state = rt.tailscaleState;
    const doctor = rt.installDoctor;
    const proxyAvailable = state !== null || (doctor && doctor.ok === true);
    if (!proxyAvailable) {
      return [
        {
          id: "wizard_tailscale_redetect",
          label: "Re-detect",
          variant: "primary",
        },
      ];
    }
    const recommendation =
      (state && state.recommendation) ||
      (!(state && state.installed)
        ? "needs_install"
        : !(state && state.loggedIn)
          ? "needs_login"
          : !(state && state.serving && state.serving[DASHBOARD_PORT])
            ? "needs_serve"
            : "ready");
    if (recommendation === "ready") {
      return [
        {
          id: "wizard_tailscale_verify",
          label: "Verify URL is reachable",
          variant: "primary",
        },
        {
          id: "go_live_complete_tailscale",
          label: "I added it to Google OAuth — finish",
          variant: "secondary",
        },
      ];
    }
    if (recommendation === "needs_serve") {
      return [
        {
          id: "wizard_tailscale_serve",
          label: `Expose port ${DASHBOARD_PORT} (one click)`,
          variant: "primary",
        },
        {
          id: "wizard_tailscale_redetect",
          label: "Re-detect",
          variant: "secondary",
        },
      ];
    }
    return [
      {
        id: "wizard_tailscale_redetect",
        label: "Re-detect",
        variant: "primary",
      },
    ];
  }

  // ----------------------------------------------------------------------
  // Step 3 — Cloud path. The detect → command/buttons → paste URL → probe
  // flow. We never claim "deploying…" — the deploy click is the user's.
  // ----------------------------------------------------------------------
  function buildCloudBody(rt) {
    const container = safeCreate("div", "go-live-wizard__cloud");
    const doctor = rt.installDoctor;
    const tools = (doctor && doctor.tools) || null;

    if (!tools) {
      safeCallout(
        container,
        "We couldn't reach the local backend to detect deploy CLIs. The README's one-click Deploy buttons work without a CLI — pick one, deploy, then paste the live URL below.",
        "warn",
      );
    } else {
      const lines = [];
      const v = tools.vercel || {};
      const n = tools.netlify || {};
      const g = tools.gh || {};
      lines.push(
        v.installed
          ? `Vercel CLI installed${v.loggedIn ? " (signed in)" : " (signed out)"}`
          : "Vercel CLI not installed",
      );
      lines.push(
        n.installed
          ? `Netlify CLI installed${n.loggedIn ? " (signed in)" : " (signed out)"}`
          : "Netlify CLI not installed",
      );
      lines.push(
        g.installed
          ? `GitHub CLI (gh) installed${g.loggedIn ? " (signed in)" : " (signed out)"}`
          : "GitHub CLI (gh) not installed",
      );
      safeList(container, lines);
    }

    // Pick a recommended command. Honest copy: state who runs what.
    const v = tools && tools.vercel;
    const n = tools && tools.netlify;
    if (v && v.installed) {
      safeParagraph(
        container,
        "Vercel CLI detected. Run this in your repo:",
        "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
      );
      safeCodeBlock(container, "vercel", "Copy command");
    } else if (n && n.installed) {
      safeParagraph(
        container,
        "Netlify CLI detected. Run this in your repo:",
        "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
      );
      safeCodeBlock(container, "netlify deploy --build --prod", "Copy command");
    } else {
      safeParagraph(
        container,
        "No deploy CLI detected. Use the README's one-click buttons:",
        "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
      );
      const buttons = safeCreate(
        "div",
        "discovery-setup-wizard__button-row",
      );
      [
        {
          label: "Deploy to Vercel",
          href: "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Femilio3435%2FJob-Bored",
        },
        {
          label: "Deploy to Netlify",
          href: "https://app.netlify.com/start/deploy?repository=https://github.com/emilio3435/Job-Bored",
        },
        {
          label: "GitHub Pages reference",
          href: SELF_HOSTING_DOC_URL,
        },
      ].forEach((btn) => {
        const a = safeCreate(
          "a",
          "discovery-setup-wizard__btn discovery-setup-wizard__btn--secondary",
          btn.label,
        );
        a.setAttribute("href", btn.href);
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
        buttons.appendChild(a);
      });
      container.appendChild(buttons);
    }

    safeInput(container, {
      id: "goLiveCloudUrlInput",
      label: "Paste your live dashboard URL",
      placeholder: "https://your-app.vercel.app",
      value: rt.cloudUrl || "",
      hint: "We'll fetch-probe it to confirm it serves.",
      onInput: (val) => {
        updateRuntime({ cloudUrl: String(val || "").trim() });
      },
    });

    if (rt.cloudVerify) {
      safeResultCard(
        container,
        {
          ok: !!rt.cloudVerify.ok,
          message: rt.cloudVerify.ok
            ? `Reachable — ${rt.cloudUrl}`
            : `Couldn't reach ${rt.cloudUrl}. ${rt.cloudVerify.reason || ""}`,
        },
        "Reachability check",
      );
    }

    safeCallout(
      container,
      "Last step: add the live URL to your Google OAuth authorized origins. Google's console can't be automated from here.",
    );

    return container;
  }

  function buildCloudActions(rt) {
    const hasUrl = !!(rt.cloudUrl && /^https?:\/\//i.test(rt.cloudUrl));
    return [
      {
        id: "wizard_cloud_verify",
        label: "Verify URL is reachable",
        variant: "primary",
        disabled: !hasUrl,
      },
      {
        id: "wizard_cloud_redetect",
        label: "Re-detect CLIs",
        variant: "secondary",
      },
      {
        id: "go_live_complete_cloud",
        label: "I added it to Google OAuth — finish",
        variant: "secondary",
        disabled: !(rt.cloudVerify && rt.cloudVerify.ok),
      },
    ];
  }

  // ----------------------------------------------------------------------
  // Step 4 — Done. Cross-recommends discovery when its completion flag is
  // false. The flag is owned by FE-3 (user-content-store.js) — we read it
  // through CommandCenterUserContent and degrade to "no recommendation"
  // when the store isn't loaded yet.
  // ----------------------------------------------------------------------
  function buildDoneBody(rt) {
    const container = safeCreate("div", "go-live-wizard__done");
    const url =
      rt.cloudPath === "tailscale"
        ? deriveTailscaleDashboardUrl(rt.tailscaleState)
        : rt.cloudUrl;
    safeParagraph(
      container,
      "Your dashboard is reachable from other devices.",
      "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
    );
    if (url) {
      safeCodeBlock(container, url, "Copy URL");
    }
    safeCallout(
      container,
      "Recommended next: turn on job discovery so the dashboard has fresh listings to show.",
    );
    return container;
  }

  function buildDoneActions(rt) {
    // The "Recommended next" CTA renders only when the discovery flag is
    // still false. The render path is async (UC store hits IndexedDB), so
    // the runtime carries the precomputed gate set by the action handler.
    const showDiscoveryCta = rt._discoveryCtaVisible !== false;
    const showEnhancementsCta =
      !showDiscoveryCta && rt._enhancementsCtaVisible === true;
    const actions = [];
    if (showDiscoveryCta) {
      actions.push({
        id: "go_live_open_discovery",
        label: "Turn on job discovery",
        variant: "primary",
      });
    }
    if (showEnhancementsCta) {
      actions.push({
        id: "go_live_open_enhancements",
        label: "Maximize your results (optional)",
        variant: "primary",
      });
    }
    actions.push({
      id: "go_live_finish",
      label: "Close",
      variant: showDiscoveryCta || showEnhancementsCta ? "secondary" : "primary",
    });
    return actions;
  }

  // ----------------------------------------------------------------------
  // Step model.
  // ----------------------------------------------------------------------
  function buildGoLiveWizardSteps(rt) {
    const r = rt || getRuntime();
    return [
      {
        id: "path_select",
        label: "Path",
        title: "How will you reach JobBored from another device?",
        description:
          "Click a card to choose. Both options will guide you through verification.",
        body: () => buildPathSelectBody(),
        actions: [],
        secondaryActions: [],
      },
      {
        id: "tailscale",
        label: "Tailscale",
        title: "Open your dashboard over Tailscale.",
        description:
          "Detect Tailscale, expose port 8080, verify the URL responds, then add it to Google OAuth.",
        body: () => buildTailscaleBody(r),
        actions: buildTailscaleActions(r),
        secondaryActions: [
          {
            id: "go_live_back_to_paths",
            label: "Back to paths",
            variant: "secondary",
          },
        ],
      },
      {
        id: "cloud",
        label: "Cloud",
        title: "Deploy your dashboard to a host.",
        description:
          "Detect a CLI, copy the deploy command, paste your live URL when it's up, then add it to Google OAuth.",
        body: () => buildCloudBody(r),
        actions: buildCloudActions(r),
        secondaryActions: [
          {
            id: "go_live_back_to_paths",
            label: "Back to paths",
            variant: "secondary",
          },
        ],
      },
      {
        id: "done",
        label: "Done",
        title: "Your dashboard is reachable.",
        description: "Add the URL to Google OAuth, then take the next step.",
        body: () => buildDoneBody(r),
        actions: buildDoneActions(r),
        secondaryActions: [],
      },
    ];
  }

  // ----------------------------------------------------------------------
  // Render + navigate.
  // ----------------------------------------------------------------------
  function renderGoLiveSetupWizard() {
    const api = shellApi();
    if (!api || typeof api.renderWizardShell !== "function") {
      return null;
    }
    const rt = getRuntime();
    return api.renderWizardShell({
      mountId: MOUNT_ID,
      variant: "generic",
      headerTitle: HEADER_TITLE,
      title: TITLE,
      lede: LEDE,
      // Continuity chrome: same journey strip + mascot family as discovery.
      journeyStage: "devices",
      mascotSrc:
        "assets/jobbored-brand-mascot-kit/exports/04-mascot-poses/pose-03-writing-notes.webp",
      steps: buildGoLiveWizardSteps(rt),
      activeStepId: rt.activeStepId,
      state: rt.state,
      onAction: (actionId) => {
        void handleGoLiveWizardAction(actionId).catch((err) => {
          if (typeof console !== "undefined") {
            console.error("[JobBored] go-live wizard action:", actionId, err);
          }
        });
      },
      onNavigate: (stepId) => {
        updateRuntime({
          activeStepId: stepId,
          state: { ...rt.state, currentStep: stepId },
        });
      },
      onClose: () => {
        const r = getRuntime();
        const shouldRestoreOnboarding = !!(r && r._onboardingHidden);
        clearRuntime();
        // Re-check the setup card against fresh completion state on every
        // close — it must never keep showing a stale count.
        try {
          const banner =
            typeof window !== "undefined" &&
            window.JobBoredApp &&
            window.JobBoredApp.whatsNextBanner;
          if (banner && typeof banner.refreshBanner === "function") {
            void Promise.resolve(banner.refreshBanner()).catch(() => {});
          }
        } catch (_) {
          /* banner refresh is best-effort */
        }
        if (shouldRestoreOnboarding) {
          const h = host();
          if (h && typeof h.showOnboardingWizard === "function") {
            h.showOnboardingWizard();
          }
        }
      },
    });
  }

  function moveToStep(stepId, patch) {
    const rt = updateRuntime({
      activeStepId: stepId,
      state: { ...getRuntime().state, currentStep: stepId },
      ...(patch || {}),
    });
    return renderGoLiveSetupWizard();
  }

  // ----------------------------------------------------------------------
  // Action dispatcher.
  // ----------------------------------------------------------------------
  async function handleGoLiveWizardAction(actionId) {
    const id = String(actionId || "");

    if (id === "go_live_back_to_paths") {
      return moveToStep("path_select");
    }

    if (id === "go_live_finish") {
      const api = shellApi();
      if (api && typeof api.closeWizardShell === "function") {
        api.closeWizardShell("finish");
      }
      return null;
    }

    if (id === "wizard_choose_path_tailscale") {
      const [state, doctor] = await Promise.all([
        probeTailscaleState(),
        probeInstallDoctor(),
      ]);
      return moveToStep("tailscale", {
        tailscaleState: state,
        installDoctor: doctor,
        cloudPath: "tailscale",
        tailscaleVerify: null,
      });
    }

    if (id === "wizard_choose_path_cloud") {
      const doctor = await probeInstallDoctor();
      return moveToStep("cloud", {
        installDoctor: doctor,
        cloudPath: "cloud",
        cloudVerify: null,
      });
    }

    if (id === "wizard_tailscale_redetect") {
      const [state, doctor] = await Promise.all([
        probeTailscaleState(),
        probeInstallDoctor(),
      ]);
      updateRuntime({
        tailscaleState: state,
        installDoctor: doctor,
        tailscaleVerify: null,
      });
      setMessage("Re-detected Tailscale state.", "info");
      return renderGoLiveSetupWizard();
    }

    if (id === "wizard_tailscale_serve") {
      const result = await runTailscaleServe(DASHBOARD_PORT);
      const state = await probeTailscaleState();
      updateRuntime({
        tailscaleState: state,
        message: result.ok
          ? "Tailscale is now serving the dashboard."
          : `Tailscale serve failed${result.error ? `: ${result.error}` : ""}.`,
        messageTone: result.ok ? "success" : "warning",
      });
      return renderGoLiveSetupWizard();
    }

    if (id === "wizard_tailscale_verify") {
      const url = deriveTailscaleDashboardUrl(getRuntime().tailscaleState);
      if (!url) {
        updateRuntime({
          tailscaleVerify: { ok: false, reason: "no_url" },
        });
        return renderGoLiveSetupWizard();
      }
      const verify = await probeUrlReachable(url);
      updateRuntime({ tailscaleVerify: verify });
      return renderGoLiveSetupWizard();
    }

    if (id === "wizard_cloud_redetect") {
      const doctor = await probeInstallDoctor();
      updateRuntime({ installDoctor: doctor, cloudVerify: null });
      return renderGoLiveSetupWizard();
    }

    if (id === "wizard_cloud_verify") {
      const url = String(getRuntime().cloudUrl || "").trim();
      const verify = await probeUrlReachable(url);
      updateRuntime({ cloudVerify: verify });
      return renderGoLiveSetupWizard();
    }

    if (id === "go_live_complete_tailscale" || id === "go_live_complete_cloud") {
      let showCta = true;
      const UC = uc();
      if (UC && typeof UC.completeGoLiveSetup === "function") {
        try {
          await UC.completeGoLiveSetup();
        } catch (_) {
          /* never block the user on completion-flag bookkeeping */
        }
      }
      if (UC && typeof UC.isDiscoverySetupComplete === "function") {
        try {
          showCta = !(await UC.isDiscoverySetupComplete());
        } catch (_) {
          showCta = true;
        }
      }
      // When discovery is already done, finishing go-live may complete the
      // full mandatory track. In that case, cross-rec the optional
      // enhancements wizard instead of the discovery CTA.
      let showEnhancementsCta = false;
      if (!showCta) {
        if (UC && typeof UC.isAllMandatorySetupComplete === "function") {
          try {
            showEnhancementsCta = !!(await UC.isAllMandatorySetupComplete());
          } catch (_) {
            showEnhancementsCta = false;
          }
        }
      }
      // Funnel telemetry: go-live finished (always), plus both_done when
      // discovery is already complete (this finish completes the pair).
      emitOnboardingEvent("go_live_finished");
      if (!showCta) emitOnboardingEvent("both_done");
      // Mandatory two-track onboarding (symmetry): when discovery is still
      // incomplete, auto-open it so finishing go-live first chains into
      // discovery. The in-wizard "Turn on job discovery" CTA (gated on the
      // same showCta) stays as the manual fallback if the user closes the
      // auto-opened wizard.
      if (showCta) {
        try {
          const h = host();
          if (h && typeof h.requestDiscoverySetup === "function") {
            void h.requestDiscoverySetup({
              entryPoint: "onboarding_chain",
              allowWhileOnboarding: true,
            });
          }
        } catch (e) {
          console.warn("[JobBored] auto-open discovery:", e);
        }
      }
      return moveToStep("done", {
        _discoveryCtaVisible: showCta,
        _enhancementsCtaVisible: showEnhancementsCta,
      });
    }

    if (id === "go_live_open_discovery") {
      const api = shellApi();
      if (api && typeof api.closeWizardShell === "function") {
        api.closeWizardShell("cross_rec");
      }
      const h = host();
      if (h && typeof h.requestDiscoverySetup === "function") {
        return h.requestDiscoverySetup({
          entryPoint: "go_live_cross_rec",
          allowWhileOnboarding: true,
        });
      }
      return null;
    }

    if (id === "go_live_open_enhancements") {
      const api = shellApi();
      if (api && typeof api.closeWizardShell === "function") {
        api.closeWizardShell("enhancements_cross_rec");
      }
      const h = host();
      if (h && typeof h.requestEnhancementsSetup === "function") {
        return h.requestEnhancementsSetup({
          entryPoint: "go_live_cross_rec",
          allowWhileOnboarding: false,
        });
      }
      return null;
    }

    return null;
  }

  // ----------------------------------------------------------------------
  // Entry points.
  // ----------------------------------------------------------------------
  async function openGoLiveSetupWizard(options) {
    const opts = options || {};
    // Funnel telemetry: the go-live setup surface was entered.
    emitOnboardingEvent("go_live_opened", {
      entryPoint: opts.entryPoint || "manual",
    });
    const h = host();

    const onboardingWasVisible =
      h && typeof h.isOnboardingWizardVisible === "function"
        ? !!h.isOnboardingWizardVisible()
        : false;
    if (onboardingWasVisible && h && typeof h.hideOnboardingWizard === "function") {
      h.hideOnboardingWizard();
    }

    setRuntime({
      ...defaultRuntime(),
      entryPoint: opts.entryPoint || "manual",
      _onboardingHidden: onboardingWasVisible,
    });
    return renderGoLiveSetupWizard();
  }

  async function requestGoLiveSetup(options) {
    const opts = options || {};
    const { allowWhileOnboarding = false, ...wizardOptions } = opts;
    const h = host();
    if (h && !allowWhileOnboarding) {
      const onboardingUp =
        typeof h.isOnboardingWizardVisible === "function" &&
        h.isOnboardingWizardVisible();
      const firstRunUp =
        typeof h.isFirstRunWizardVisible === "function" &&
        h.isFirstRunWizardVisible();
      if (onboardingUp || firstRunUp) {
        return { deferred: true };
      }
    }
    await openGoLiveSetupWizard(wizardOptions);
    return { deferred: false };
  }

  // ----------------------------------------------------------------------
  // Public surface.
  // ----------------------------------------------------------------------
  root.openGoLiveSetupWizard = openGoLiveSetupWizard;
  root.requestGoLiveSetup = requestGoLiveSetup;
  root.renderGoLiveSetupWizard = renderGoLiveSetupWizard;
  root.handleAction = handleGoLiveWizardAction;
  root.buildGoLiveWizardSteps = buildGoLiveWizardSteps;
  root.deriveTailscaleDashboardUrl = deriveTailscaleDashboardUrl;
  root.MOUNT_ID = MOUNT_ID;
  root.HEADER_TITLE = HEADER_TITLE;
  // Test seams (read in tests; never relied on from app code).
  root._internal = {
    getRuntime,
    setRuntime,
    updateRuntime,
    clearRuntime,
    buildPathSelectBody,
    buildTailscaleBody,
    buildCloudBody,
    buildDoneBody,
    buildTailscaleActions,
    buildCloudActions,
    buildDoneActions,
  };
})();
