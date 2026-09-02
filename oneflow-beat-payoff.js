/* ============================================
   Beat B6 of the one-flow onboarding — You're live (the payoff).

   ONE-FLOW-ONBOARDING-SPEC §5 B6. The teardown counted eleven "done"
   moments before the user's first job existed. B6 is the ONLY one, and
   it earns the name by reporting back what the user actually bought —
   their roles, their provider, their source count, their sheet — and
   then making jobs appear.

   Every line here is READ, never assumed:
     · the first name from the Google session (graceful "You're live."),
     · roles / where / floor / edge from the just-saved fit profile,
     · the provider from the configured resume provider,
     · the armed-source count from the discovery search plan,
     · the sheet id from the resolved config.

   `Run discovery now` is "guaranteed full-power": B4 wrote the intent
   and B2/B5 verified the keys, so the run cannot bail. This beat asserts
   that invariant BEFORE firing — a run that silently returns
   blank_intent would turn the payoff into another dead end.

   Classic-global IIFE, registered against window.JobBoredOneFlow, with
   its view model exposed on window.JobBoredOneFlowPayoff for probes.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  const root =
    window.JobBoredOneFlowPayoff || (window.JobBoredOneFlowPayoff = {});

  /** Normative copy — spec §5 B6. Ship verbatim (§8). */
  const HEADLINE = "You're live, {firstName}.";
  const HEADLINE_FALLBACK = "You're live.";
  const SUB = "That was the one-time part. From here, JobBored works for you.";
  const ETA_LINE =
    "⏱ First matches land tomorrow morning — or run it right now and watch.";
  const FOOTER_LINE =
    "More power-ups — URL import, grounded search, other devices — live in Settings → Upgrades, each one click, none required.";
  const SKIPPED_LINE =
    "○ Connection is off — your AI and Google-index keys are saved; connect anytime from the banner below";
  const SHEET_LINK_LABEL = "open it ↗";

  /** Provider display names — the same caps Settings shows. */
  const PROVIDER_LABELS = Object.freeze({
    openrouter: "OpenRouter",
    gemini: "Gemini",
    openai: "OpenAI",
    anthropic: "Anthropic",
    local: "Local",
    webhook: "Webhook",
  });

  /**
   * The footer actions. Held as ONE mutable array because the shell reads
   * the step's action list by reference when it renders the footer, which
   * it does AFTER the step body — so the beat resolves its variant during
   * render() and the footer picks it up. tests/oneflow-l4-payoff.test.mjs
   * renders the whole shell for both variants, so if that order ever
   * changes the wrong primary is caught loudly instead of shipping.
   */
  const ACTIONS = [];

  let celebrated = false;
  let firstResultsArmed = false;
  let firstResultsAt = 0;
  let firstResultsSink = null;

  // ---------------------------------------------------------------
  // Lazy collaborator lookups — every one is call-only.
  // ---------------------------------------------------------------

  function appHost() {
    const app = window.JobBoredApp;
    return (app && app.core && app.core.host) || null;
  }

  function auth() {
    const app = window.JobBoredApp;
    return (app && app.auth) || null;
  }

  function store() {
    return window.CommandCenterUserContent || null;
  }

  function steps() {
    const telemetry = window.JobBoredOnboardingTelemetry;
    return (telemetry && telemetry.STEPS) || {};
  }

  function emit(step, detail) {
    const telemetry = window.JobBoredOnboardingTelemetry;
    if (!telemetry || !telemetry.emit || !step) return;
    telemetry.emit(step, detail);
  }

  function asString(raw) {
    return raw == null ? "" : String(raw).trim();
  }

  function config() {
    const h = appHost();
    if (h && typeof h.getConfig === "function") {
      try {
        return h.getConfig() || {};
      } catch (_) {
        /* fall through */
      }
    }
    return window.COMMAND_CENTER_CONFIG || {};
  }

  function sheetId() {
    const h = appHost();
    if (h && typeof h.getSHEET_ID === "function") {
      try {
        const id = asString(h.getSHEET_ID());
        if (id) return id;
      } catch (_) {
        /* fall through */
      }
    }
    return asString(config().sheetId);
  }

  // ---------------------------------------------------------------
  // The view model
  // ---------------------------------------------------------------

  /**
   * The first name, in order of freshness: what the flow already carries
   * (B1 read the session once — asking Google twice is a round trip for
   * a string we have), then the session itself. No name is fine: the
   * spec's fallback drops the comma rather than shipping "You're live, ."
   */
  function resolveFirstName(runtime) {
    const carried = asString(runtime && runtime.firstName);
    if (carried) return carried;
    const a = auth();
    if (a && typeof a.getUserGivenName === "function") {
      try {
        return asString(a.getUserGivenName());
      } catch (_) {
        return "";
      }
    }
    return "";
  }

  function buildHeadline(firstName) {
    return firstName
      ? HEADLINE.replace("{firstName}", firstName)
      : HEADLINE_FALLBACK;
  }

  function providerLabel() {
    const raw = asString(config().resumeProvider).toLowerCase();
    if (!raw) return "";
    return PROVIDER_LABELS[raw] || raw;
  }

  /** Money the way the user typed it — a floor is a promise, not a guess. */
  function formatFloor(value) {
    if (!Number.isFinite(value) || value <= 0) return "";
    return `$${Math.floor(value).toLocaleString("en-US")}`;
  }

  const EMPTY_SEARCH = Object.freeze({
    roles: [],
    locations: [],
    floor: "",
    edge: [],
  });

  /**
   * "Your search" comes from the profile B4 just saved. A dead /profile
   * server costs the card, never the payoff — the receipt still renders.
   */
  async function readSearch(runtime) {
    let profile = (runtime && runtime.fitProfile) || null;
    if (!profile) {
      const api = window.FitProfileForm;
      if (api && typeof api.fetchProfile === "function") {
        try {
          const data = await api.fetchProfile();
          profile = (data && data.profile) || data || null;
        } catch (e) {
          console.warn("[JobBored] B6: could not read the saved profile:", e);
          profile = null;
        }
      }
    }
    if (!profile || typeof profile !== "object") return { ...EMPTY_SEARCH };
    const identity = profile.identity || {};
    const hard = profile.hardConstraints || {};
    const strengths = Array.isArray(profile.strengths) ? profile.strengths : [];
    return {
      roles: (identity.targetRoles || []).map(asString).filter(Boolean),
      locations: (hard.acceptableLocations || []).map(asString).filter(Boolean),
      floor: formatFloor(hard.salaryFloor),
      // The edge is the TOP THREE strengths — a list of eight is not an edge.
      edge: strengths
        .slice()
        .sort((a, b) => (a.rank || 0) - (b.rank || 0))
        .slice(0, 3)
        .map((s) => asString(s && s.name))
        .filter(Boolean),
    };
  }

  /**
   * How many source lanes the saved profile actually arms. Read through
   * the same search-plan builder the run itself uses, so the number on
   * the receipt is the number that ships.
   */
  async function readSourceCount() {
    const payload = window.JobBoredDiscoveryPayload;
    if (!payload || typeof payload.buildSearchPlan !== "function") return 0;
    let discoveryProfile = {};
    const s = store();
    if (s && typeof s.getDiscoveryProfile === "function") {
      try {
        discoveryProfile = (await s.getDiscoveryProfile()) || {};
      } catch (_) {
        discoveryProfile = {};
      }
    }
    try {
      const plan = payload.buildSearchPlan({ discoveryProfile });
      const lanes = (plan && plan.facets && plan.facets.sourceLanes) || [];
      return Array.isArray(lanes) ? lanes.length : 0;
    } catch (e) {
      console.warn("[JobBored] B6: could not read the source plan:", e);
      return 0;
    }
  }

  /** Spec §5 B6: the primary flips with the connect skip, not the copy. */
  function buildActions(flowState) {
    const skipped = !!(
      flowState &&
      flowState.skipped &&
      flowState.skipped.discoveryConnect
    );
    if (skipped) {
      return [
        { id: "payoff_dashboard", label: "Go to my dashboard", variant: "primary" },
        {
          id: "payoff_connect_discovery",
          label: "Actually — connect discovery",
          variant: "ghost",
        },
      ];
    }
    return [
      { id: "payoff_run_now", label: "Run discovery now", variant: "primary" },
      {
        id: "payoff_dashboard",
        label: "Take me to my dashboard",
        variant: "ghost",
      },
    ];
  }

  /** Everything synchronously knowable — what the first paint can show. */
  function baseState(ctx) {
    const flowState = (ctx && ctx.state) || {};
    const runtime = (ctx && ctx.runtime) || {};
    const firstName = resolveFirstName(runtime);
    const id = sheetId();
    return {
      firstName,
      headline: buildHeadline(firstName),
      sub: SUB,
      skippedConnect: !!(flowState.skipped && flowState.skipped.discoveryConnect),
      provider: providerLabel(),
      sheetId: id,
      sheetUrl: id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : "",
      search: { ...EMPTY_SEARCH },
      sourceCount: 0,
      actions: buildActions(flowState),
      hydrated: false,
    };
  }

  /** The full receipt, once the profile and the source plan have answered. */
  async function resolvePayoffState(ctx) {
    const state = baseState(ctx);
    const [search, sourceCount] = await Promise.all([
      readSearch((ctx && ctx.runtime) || {}),
      readSourceCount(),
    ]);
    state.search = search;
    state.sourceCount = sourceCount;
    state.hydrated = true;
    return state;
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function addRow(list, className, text) {
    const li = el("li", `oneflow-payoff__row ${className}`, text);
    list.appendChild(li);
    return li;
  }

  function buildSearchCard(state) {
    const card = el("section", "oneflow-payoff__card oneflow-payoff__search");
    card.appendChild(el("h4", "oneflow-payoff__card-title", "Your search"));
    const list = el("ul", "oneflow-payoff__list");
    const rows = [
      ["Roles", state.search.roles.join(" · ")],
      ["Where", state.search.locations.join(" · ")],
      ["Floor", state.search.floor],
      ["Your edge", state.search.edge.join(" · ")],
    ];
    for (const [label, value] of rows) {
      // Silence beats invention: an unset floor renders no line at all
      // rather than "$0" or "Any", both of which would be claims.
      if (!value) continue;
      const li = el("li", "oneflow-payoff__row");
      li.appendChild(el("span", "oneflow-payoff__row-label", label));
      li.appendChild(el("span", "oneflow-payoff__row-value", value));
      list.appendChild(li);
    }
    if (!list.children.length) {
      card.appendChild(
        el(
          "p",
          "oneflow-payoff__empty",
          "Your saved profile isn't reachable right now — open Settings → Profile to review it.",
        ),
      );
    } else {
      card.appendChild(list);
    }
    return card;
  }

  function buildNowCard(state) {
    const card = el("section", "oneflow-payoff__card oneflow-payoff__now");
    card.appendChild(
      el("h4", "oneflow-payoff__card-title", "What happens now"),
    );
    const list = el("ul", "oneflow-payoff__list");

    if (state.provider) {
      addRow(list, "oneflow-payoff__row--ok", `✓ AI connected — ${state.provider}`);
    }

    if (state.skippedConnect) {
      addRow(list, "oneflow-payoff__row--off", SKIPPED_LINE);
    } else {
      const noun = state.sourceCount === 1 ? "source" : "sources";
      addRow(
        list,
        "oneflow-payoff__row--ok",
        `✓ Discovery armed — ${state.sourceCount} ${noun} watching, including Google's job index`,
      );
    }

    if (state.sheetUrl) {
      const li = el("li", "oneflow-payoff__row oneflow-payoff__row--ok");
      li.appendChild(
        el("span", "", "✓ Pipeline sheet connected — "),
      );
      const link = el("a", "oneflow-payoff__sheet-link", SHEET_LINK_LABEL);
      link.setAttribute("href", state.sheetUrl);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
      li.appendChild(link);
      list.appendChild(li);
    }

    addRow(list, "oneflow-payoff__row--eta", ETA_LINE);
    card.appendChild(list);
    return card;
  }

  /**
   * Build B6's body into `container` from an already-resolved state.
   *
   * The sub-line is NOT rendered here. `registerBeat({ sub })` hands the
   * same string to the shell, which paints it as the step lede above this
   * body — so a paragraph here made the rerun read the promise twice in a
   * row (SIXBEATS2 NEW-10). One lede, one voice.
   */
  function renderPayoff(container, state) {
    if (!container) return container;
    const wrap = el("div", "oneflow-payoff");
    const cards = el("div", "oneflow-payoff__cards");
    cards.appendChild(buildSearchCard(state));
    cards.appendChild(buildNowCard(state));
    wrap.appendChild(cards);
    wrap.appendChild(el("p", "oneflow-payoff__footer", FOOTER_LINE));
    container.appendChild(wrap);
    return container;
  }

  // ---------------------------------------------------------------
  // The one celebration (spec §5 B6, §7)
  // ---------------------------------------------------------------

  function celebrate(state, onDone) {
    const done = typeof onDone === "function" ? onDone : () => {};
    if (celebrated) {
      done();
      return;
    }
    celebrated = true;
    const player = window.JobBoredOnboardingCelebration;
    if (!player || typeof player.playOnboardingCelebration !== "function") {
      done();
      return;
    }
    player.playOnboardingCelebration(done, "flow_payoff", {
      title: state && state.headline,
      sub: state && state.sub,
    });
  }

  // ---------------------------------------------------------------
  // first_results (spec §9)
  // ---------------------------------------------------------------

  /**
   * Arm the one-shot first_results emission. The run tracker already
   * polls and dispatches its state; B6 only listens for the moment rows
   * first land, which is the moment the promise ("watch them appear")
   * is either kept or isn't.
   */
  function armFirstResults(sink) {
    firstResultsArmed = true;
    firstResultsAt = Date.now();
    firstResultsSink = typeof sink === "function" ? sink : null;
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener(
        "jobbored:job-discovery-run-updated",
        onRunUpdatedEvent,
      );
    }
  }

  function onRunUpdatedEvent(event) {
    const detail = event && event.detail;
    onRunUpdate((detail && detail.state) || {});
  }

  function onRunUpdate(runState) {
    if (!firstResultsArmed) return;
    const written = Number(runState && runState.leadsWritten) || 0;
    const updated = Number(runState && runState.leadsUpdated) || 0;
    const count = written + updated;
    if (count <= 0) return;
    firstResultsArmed = false;
    if (typeof document !== "undefined" && document.removeEventListener) {
      document.removeEventListener(
        "jobbored:job-discovery-run-updated",
        onRunUpdatedEvent,
      );
    }
    const detail = { count, ms: Math.max(0, Date.now() - firstResultsAt) };
    if (firstResultsSink) firstResultsSink(detail);
    else emit(steps().FIRST_RESULTS, detail);
  }

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------

  /**
   * The intent guard. B4 wrote target roles and B2/B5 verified the keys,
   * so `Run discovery now` is promised full-power. If that invariant is
   * broken we say so through the message slot instead of firing a run
   * that returns blank_intent and leaves the user staring at nothing.
   *
   * It resolves intent from the SAME payload the run will send, through
   * the SAME shared helper triggerDiscoveryRun guards with — otherwise
   * this check could pass where the run bails, or block a run the worker
   * would have accepted. A fit profile with roles counts as intent even
   * when the free-form discovery profile is empty, which is exactly the
   * shape B3/B4 leave behind.
   */
  async function readIntentSources() {
    const h = appHost();
    if (h && typeof h.buildDiscoveryWebhookPayload === "function") {
      try {
        const payload = await h.buildDiscoveryWebhookPayload(
          typeof h.getSHEET_ID === "function" ? h.getSHEET_ID() : sheetId(),
          { trigger: "onboarding_payoff" },
        );
        if (payload) {
          return {
            discoveryProfile: payload.discoveryProfile,
            mergedUserProfile: payload.mergedUserProfile,
          };
        }
      } catch (e) {
        console.warn("[JobBored] B6: could not build the run payload:", e);
      }
    }
    // No host bridge (or it failed): fall back to the stored profile so the
    // check still means something rather than silently passing.
    const s = store();
    if (s && typeof s.getDiscoveryProfile === "function") {
      try {
        return {
          discoveryProfile: (await s.getDiscoveryProfile()) || {},
          mergedUserProfile: null,
        };
      } catch (_) {
        /* fall through */
      }
    }
    return { discoveryProfile: {}, mergedUserProfile: null };
  }

  async function assertIntent() {
    const api = window.JobBoredEffectiveIntent;
    if (!api || typeof api.buildEffectiveIntent !== "function") return true;
    const sources = await readIntentSources();
    return !api.isBlankIntent(api.buildEffectiveIntent(sources));
  }

  function triggerRun() {
    const h = appHost();
    if (!h || typeof h.triggerDiscoveryRun !== "function") {
      return Promise.resolve({ ok: false, reason: "unavailable" });
    }
    return Promise.resolve(
      h.triggerDiscoveryRun({ trigger: "onboarding_payoff" }),
    ).catch((err) => {
      console.warn("[JobBored] B6: discovery run:", err);
      return { ok: false, reason: "error" };
    });
  }

  async function runNow(ctx) {
    const ok = await assertIntent();
    if (!ok) {
      ctx.setMessage(
        "Your search has no target roles or keywords yet — open Settings → Profile, add them, then run discovery.",
        "error",
      );
      return null;
    }
    ctx.setBusy("payoff_run_now", [
      { label: "Sending your search…", state: "active" },
      { label: "Discovery is looking", state: "todo" },
      { label: "First matches land on your board", state: "todo" },
    ]);
    armFirstResults();
    // Fire and let it stream: the shell closes on completeBeat, and the
    // existing run tracker's toast + poll carry the run from there onto
    // the live board behind it (spec §5 B6 Actions).
    void triggerRun();
    return ctx.completeBeat({ beat: "payoff", ran: true });
  }

  async function onAction(actionId, ctx) {
    const id = asString(actionId);
    if (id === "payoff_run_now") return runNow(ctx);
    if (id === "payoff_dashboard") {
      return ctx.completeBeat({ beat: "payoff", ran: false });
    }
    if (id === "payoff_connect_discovery") {
      // The one escape back: re-enter B5 so the skipped connect panel can
      // be finished without leaving the flow's bookkeeping behind.
      return ctx.goToBeat("discovery");
    }
    return null;
  }

  // ---------------------------------------------------------------
  // Beat registration
  // ---------------------------------------------------------------

  function render(container, ctx) {
    // Resolve the variant NOW: the shell reads this array by reference
    // when it builds the footer, which happens after this body renders.
    const resolved = buildActions((ctx && ctx.state) || {});
    ACTIONS.length = 0;
    ACTIONS.push(...resolved);

    const sync = baseState(ctx);
    renderPayoff(container, sync);

    void resolvePayoffState(ctx)
      .then((state) => {
        if (typeof container.replaceChildren === "function") {
          container.replaceChildren();
        }
        renderPayoff(container, state);
        celebrate(state);
      })
      .catch((e) => {
        console.warn("[JobBored] B6: could not resolve the payoff:", e);
        celebrate(sync);
      });
  }

  if (flow && typeof flow.registerBeat === "function") {
    flow.registerBeat({
      id: "payoff",
      order: 6,
      label: "Done",
      timeLabel: "almost done",
      // A resolver, not a literal: the SHELL title has to read
      // "You're live, {actual name}." too, not just the celebration
      // overlay (spec §5 B6; routed L6 → L7 #9).
      headline: (ctx) => buildHeadline(resolveFirstName((ctx && ctx.runtime) || {})),
      sub: SUB,
      actions: ACTIONS,
      render,
      onAction,
    });
  }

  Object.assign(root, {
    HEADLINE,
    HEADLINE_FALLBACK,
    SUB,
    ETA_LINE,
    FOOTER_LINE,
    SKIPPED_LINE,
    PROVIDER_LABELS,
    buildActions,
    resolvePayoffState,
    renderPayoff,
    celebrate,
    // Test seams — the run tracker's event, drivable without a real poll.
    _armFirstResults: armFirstResults,
    _onRunUpdate: onRunUpdate,
    _reset() {
      celebrated = false;
      firstResultsArmed = false;
      firstResultsSink = null;
    },
  });
})();
