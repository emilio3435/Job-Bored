/* ============================================
   Beat B3 of the one-flow onboarding — Hand us your resume.

   ONE-FLOW-ONBOARDING-SPEC §5 B3, staged (JOBQA). An upload or paste is
   NOT saved here, in the browser or on the server: the text lives in the
   wizard draft (ctx.saveDraft, restored on reload), and
   POST /profile/from-resume only READS it to draft the profile (the
   server caches nothing). The resume becomes the saved one when the user
   confirms B4, whose one commit (POST /profile/commit) writes resume.txt,
   the profile and the voice guide together, then the browser's copy.
   So "nothing is saved until you approve it" is literally true, and an
   upload in a fresh browser can never replace someone else's saved
   resume. If the draft fails, the upload still survives in the draft.

   Drafting runs on the provider B2 verified, so the template path is a
   CHOICE here, never the consolation prize for a missing key. That is
   literal now: the POST body carries `{provider, apiKey, model, baseUrl}`
   from getResumeGenerationConfig(), because a server that only read its own
   env answered a freshly-connected OpenRouter install with "Missing Gemini
   API key" (SIXBEATS-2 NEW-2).

   Everything the user has typed or drafted is also written through
   ctx.saveDraft() — the controller's persisted scratch (SIXBEATS2-SPEC
   locked decision 4) — so a refresh mid-beat costs neither the pasted
   resume (NEW-7) nor the drafted profile B4 is waiting on (NEW-14).

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Drop in your resume. AI drafts your profile from it.";

  const SUB =
    "From this one file we'll draft your whole fit profile — target " +
    "roles, strengths, what you want, what to avoid. You'll review " +
    "everything on the next screen; nothing is saved until you approve " +
    "it.";

  const ACTION_TEMPLATE = "resume_template";
  const ACTION_RETRY = "resume_retry";
  const ACTION_USE_TEXT = "resume_use_text";
  const ACTION_BACK = "resume_back";
  const ACTION_CONNECT_AI = "resume_connect_ai";

  /**
   * GREENFIELD §4.1 (F1). The one line a visitor with no usable provider
   * reads, whether this beat refused to ask the server or the server said
   * the same thing back. Locked copy, byte-for-byte the controller's gate
   * note for the AI beat — the situation is identical, so the sentence is.
   */
  const CONNECT_AI_COPY =
    "Connect an AI provider first \u2014 your resume is drafted with it.";
  const CONNECT_AI_LABEL = "Connect an AI provider";

  const FILE_INPUT_ID = "oneFlowResumeFile";
  const PASTE_INPUT_ID = "oneFlowResumePaste";

  /**
   * GFX N-B3-2 / B3-9: the two stages that really happen, with no glyph
   * baked in — the shell draws ✓ from `state: "done"`.
   * RESJ2-EXTRACT: named for what each one is. The first is the browser
   * pulling text out of the file and saving it (instant, no AI) — the text
   * box filling is this step. The second is the AI read; while it runs it
   * names the provider and model, and when it finishes it says what it
   * read (readingLabel / doneLabel below).
   */
  const STAGE_LABELS = ["Keeping your resume for review (not saved yet)", "Reading your resume with AI"];

  /**
   * GFX B3-4: the clock on a draft, ported from B2's CHECK_TIMINGS. Past
   * `slowAfterMs` the drafting stage counts seconds; past `stalledAfterMs`
   * the message slot says the wait is normal for free tiers and names the
   * exit; at `abortAfterMs` both the server fetch and the browser-direct
   * call are abandoned. Mutable so tests run it in milliseconds.
   */
  const DRAFT_TIMINGS = {
    slowAfterMs: 2000,
    tickMs: 1000,
    stalledAfterMs: 30000,
    abortAfterMs: 90000,
  };

  const STALLED_MESSAGE =
    "Still waiting on your AI provider — free tiers can be slow. Leave it " +
    "running, or start from a template.";

  /** Resolves the draft race when the deadline wins. */
  const TIMED_OUT = { timedOut: true };

  /** Where "JobBored on this computer" lives for a page that isn't it. */
  const LOCAL_JOBBORED_URL = "http://localhost:8080/";

  /**
   * The four starter templates, copied from fit-profile-wizard.js rather
   * than imported: that module is a Settings editor now (spec §11.3) and
   * the flow must not depend on a surface it does not own. The seed
   * PROFILE still comes from the server's /profile/template/:id, which is
   * the same source the editor uses.
   */
  const TEMPLATES = [
    {
      id: "marketer",
      name: "Marketer",
      desc: "Senior marketing / director. Performance + brand + analytics.",
    },
    {
      id: "engineer",
      name: "Engineer",
      desc: "Staff / senior backend IC. Distributed systems + tech leadership.",
    },
    {
      id: "product_manager",
      name: "Product Manager",
      desc: "Senior / principal PM. Strategy + research + technical fluency.",
    },
    {
      id: "blank",
      name: "Start blank",
      desc: "Fill every field yourself. No seed data.",
    },
  ];

  // ---------------------------------------------------------------
  // Beat-local state
  // ---------------------------------------------------------------

  const state = {
    mode: "intake", // "intake" | "templates"
    pasteDraft: "",
    stages: [],
    failed: false,
    lastText: "",
    lastSource: "",
    lastDocument: null,
    writeOrder: [],
    draft: null,
    // True while the only useful next step is Beat 2 (GREENFIELD A3/A4).
    providerLocked: false,
    // Seconds the draft has been running, once past the slow threshold.
    draftSeconds: null,
    // The draft that owns the screen; a template pick or a newer draft
    // bumps it and the older answer is dropped.
    ingestRun: 0,
    // Body copy that a message-slot string can't carry: the start link
    // (B3-7) and the raw error behind "Technical detail" (B3-6).
    notice: null, // { link: boolean, technical: string }
    // RESJ2-EXTRACT: stage 2's live label ("Reading your resume with
    // OpenRouter (model)") and, once read, what was read.
    readingLabel: "",
    doneLabel: "",
    // JOBQA: the account scope this state was built under.
    scope: null,
  };

  /**
   * A different account's setup: drop everything this beat held for the
   * old one. Bumping ingestRun makes any draft still in flight land nowhere.
   */
  function resetState() {
    state.mode = "intake";
    state.pasteDraft = "";
    state.stages = [];
    state.failed = false;
    state.lastText = "";
    state.lastSource = "";
    state.lastDocument = null;
    state.writeOrder = [];
    state.draft = null;
    state.providerLocked = false;
    state.draftSeconds = null;
    state.ingestRun += 1;
    state.notice = null;
    state.readingLabel = "";
    state.doneLabel = "";
    if (draftWatch) stopDraftWatch(true);
  }

  const fields = { paste: null };
  const ACTIONS = [];
  let lastCtx = null;

  function ingestApi() {
    return window.CommandCenterResumeIngest || null;
  }

  /* E4: the JobBored API transport. Attaches the hosted token when
     hosted-api-auth.js is loaded; plain fetch otherwise. */
  function apiFetch(url, init) {
    const scope = typeof window !== "undefined" ? window : null;
    const auth = scope && scope.JobBoredHostedApiAuth;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    return fetch(url, init);
  }

  function profileUrl(path) {
    const api = window.JobBoredProfileApi;
    if (api && typeof api.getProfileApiBase === "function") {
      return `${api.getProfileApiBase() || ""}${path}`;
    }
    const cfg = window.COMMAND_CENTER_CONFIG || {};
    const raw = String(cfg.jobBoredApiUrl || cfg.jobPostingScrapeUrl || "").trim();
    if (raw) return `${raw.replace(/\/+$/, "")}${path}`;
    // file:// has no origin to be relative to — the deprecated dev workflow.
    if (window.location && window.location.protocol === "file:") {
      return `http://127.0.0.1:3847${path}`;
    }
    return path;
  }

  function el(tag, className, attrs = {}, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "dataset" && typeof value === "object") {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          node.dataset[dataKey] = String(dataValue);
        }
        continue;
      }
      if (key in node) {
        node[key] = value;
        continue;
      }
      node.setAttribute(key, String(value));
    }
    if (text != null) node.textContent = String(text);
    return node;
  }

  /**
   * Where each provider's key/model/base URL live in the config
   * resume-generate.js publishes. `webhook` is deliberately absent: the
   * drafter cannot call it, and sending it would only replace the server's
   * usable env config with an unusable one.
   */
  const PROVIDER_FIELDS = {
    gemini: { key: "resumeGeminiApiKey", model: "resumeGeminiModel", baseUrl: "" },
    openrouter: {
      key: "resumeOpenRouterApiKey",
      model: "resumeOpenRouterModel",
      baseUrl: "resumeOpenRouterBaseUrl",
    },
    openai: { key: "resumeOpenAIApiKey", model: "resumeOpenAIModel", baseUrl: "" },
    anthropic: {
      key: "resumeAnthropicApiKey",
      model: "resumeAnthropicModel",
      baseUrl: "",
    },
    local: {
      key: "resumeLocalApiKey",
      model: "resumeLocalModel",
      baseUrl: "resumeLocalBaseUrl",
    },
  };

  /**
   * The B2-verified provider as the server reads it off the request body
   * (SIXBEATS2-SPEC locked decision 3). Null when nothing usable is
   * configured, which leaves the server's own env in charge exactly as
   * before.
   */
  function verifiedProviderConfig() {
    const api = window.CommandCenterResumeGenerate;
    if (!api || typeof api.getResumeGenerationConfig !== "function") return null;
    let cfg;
    try {
      cfg = api.getResumeGenerationConfig();
    } catch (err) {
      console.warn("[JobBored] one-flow B3 provider config:", err);
      return null;
    }
    const fields = cfg && PROVIDER_FIELDS[cfg.provider];
    if (!fields) return null;
    const resolved = {
      provider: cfg.provider,
      apiKey: String((fields.key && cfg[fields.key]) || ""),
      model: String((fields.model && cfg[fields.model]) || ""),
      baseUrl: String((fields.baseUrl && cfg[fields.baseUrl]) || ""),
    };
    // getResumeGenerationConfig() names a provider even when Beat 2 never
    // persisted one (resume-generate.js defaults it), so a NAME is not
    // evidence of anything. The credential is: a key for the hosted
    // providers, a base URL for Local, which has no key by design. Without
    // one there is nothing to draft with, and drafting anyway is how a
    // fresh OpenRouter install got told "Missing Gemini API key" (F1).
    const credential = cfg.provider === "local" ? resolved.baseUrl : resolved.apiKey;
    if (!credential.trim()) return null;
    return resolved;
  }

  /**
   * Write through to the controller's persisted scratch. Debounce and
   * storage are the controller's job (locked decision 4); a controller
   * that has not grown the seam yet simply loses nothing it had before.
   */
  function saveDraft(ctx, key, value) {
    const context = ctx || lastCtx;
    if (!context || typeof context.saveDraft !== "function") return;
    try {
      context.saveDraft(key, value);
    } catch (err) {
      console.warn("[JobBored] one-flow B3 saveDraft:", err);
    }
  }

  /**
   * The synchronous copy of the pasted text (GREENFIELD spec §4.2).
   *
   * The controller owns the key, the shape and the cap; these two only
   * reach it. Both answer "nothing" against a controller that predates
   * the seam, which is the same thing the beat had before the mirror
   * existed — no mirror is a lost keystroke, never a broken beat.
   */
  function writePasteMirror(text) {
    if (flow && typeof flow.writeDraftMirror === "function") {
      return flow.writeDraftMirror(text);
    }
    return false;
  }

  function readPasteMirror() {
    if (flow && typeof flow.readDraftMirror === "function") {
      return flow.readDraftMirror();
    }
    return "";
  }

  /**
   * Bring back what a refresh interrupted. Only fills what the beat does
   * not already hold, so a repaint can never resurrect text the user has
   * since cleared.
   *
   * The mirror is read FIRST because it is never staler than the drafts
   * bag: it is written on the keystroke, the bag lands 400 ms later, and
   * the reload that loses the difference between them is the F2 repro.
   */
  function hydrateFromDrafts(ctx) {
    const drafts = ctx && ctx.runtime ? ctx.runtime.drafts : null;
    const mirrored = readPasteMirror();
    if (!state.pasteDraft && mirrored) state.pasteDraft = mirrored;
    if (!drafts || typeof drafts !== "object") return;
    if (!state.pasteDraft && typeof drafts.resumeText === "string") {
      state.pasteDraft = drafts.resumeText;
    }
    if (!state.draft && drafts.profileDraft && typeof drafts.profileDraft === "object") {
      state.draft = drafts.profileDraft;
    }
  }

  function readPaste() {
    const node = fields.paste;
    if (node && typeof node.value === "string") return node.value;
    return state.pasteDraft;
  }

  function syncActions() {
    ACTIONS.length = 0;
    // The template grid used to be a one-way door: it replaced the dropzone
    // and the paste box, so the only route back was a reload — which also
    // threw away whatever had been pasted. Looking at a template must cost
    // nothing (spec §5 B3).
    if (state.mode === "templates") {
      ACTIONS.push({
        id: ACTION_BACK,
        label: "Back to upload or paste",
        variant: "ghost",
      });
      return;
    }
    // GFX N-B3-3: one primary per state. GREENFIELD A3/A4: with no provider
    // to draft with, the only action that changes the outcome connects one.
    if (state.providerLocked) {
      ACTIONS.push({
        id: ACTION_CONNECT_AI,
        label: CONNECT_AI_LABEL,
        variant: "primary",
      });
    } else if (state.failed) {
      ACTIONS.push({ id: ACTION_RETRY, label: "Try again", variant: "primary" });
    } else {
      ACTIONS.push({
        id: ACTION_USE_TEXT,
        label: "Build my profile from this text",
        variant: "primary",
      });
    }
    ACTIONS.push({
      id: ACTION_TEMPLATE,
      label: "I'd rather start from a template",
      variant: "ghost",
    });
  }

  syncActions();

  function repaint(ctx, message, tone) {
    syncActions();
    if (ctx && typeof ctx.setMessage === "function") {
      ctx.setMessage(message == null ? "" : message, tone || "info");
    }
  }

  /** Advance the normative stage list to `index` (everything before is done). */
  function setStage(ctx, index) {
    const labels = STAGE_LABELS.map((label, i) => (i === 1 && state.readingLabel ? state.readingLabel : label));
    state.stages = labels.map((label, i) => ({
      label:
        i === index && i === 1 && state.draftSeconds != null
          ? `${label} — ${state.draftSeconds} s`
          : label,
      state: i < index ? "done" : i === index ? "active" : "todo",
    }));
    if (index >= STAGE_LABELS.length) {
      state.stages = labels.map((label, i) => ({
        label: i === 1 && state.doneLabel ? state.doneLabel : label,
        state: "done",
      }));
    }
    if (ctx && typeof ctx.setBusy === "function") {
      ctx.setBusy(ACTION_USE_TEXT, state.stages);
    }
  }

  function clearStages(ctx) {
    state.stages = [];
    if (ctx && typeof ctx.clearBusy === "function") ctx.clearBusy();
  }

  let draftWatch = null;

  function abortControllerCtor() {
    if (typeof window !== "undefined" && typeof window.AbortController === "function") {
      return window.AbortController;
    }
    return typeof AbortController === "function" ? AbortController : null;
  }

  /** Stop the clock; `abort` also cancels whatever request is in flight. */
  function stopDraftWatch(abort) {
    const watch = draftWatch;
    draftWatch = null;
    state.draftSeconds = null;
    if (!watch) return;
    for (const timer of watch.timers) clearTimeout(timer);
    if (abort && watch.controller) {
      try {
        watch.controller.abort();
      } catch (_) {
        /* the race below already settled */
      }
    }
  }

  /**
   * GFX B3-4. Start the draft's clock: a seconds counter, the stall line,
   * and a deadline that resolves TIMED_OUT and aborts the fetch.
   */
  function startDraftWatch(ctx) {
    stopDraftWatch(false);
    const Ctor = abortControllerCtor();
    const watch = {
      controller: Ctor ? new Ctor() : null,
      timers: [],
      stalled: false,
      deadline: null,
    };
    const startedAt = Date.now();
    watch.deadline = new Promise((resolve) => {
      watch.timers.push(
        setTimeout(() => {
          if (watch.controller) {
            try {
              watch.controller.abort();
            } catch (_) {
              /* resolving below is what ends the wait */
            }
          }
          resolve(TIMED_OUT);
        }, DRAFT_TIMINGS.abortAfterMs),
      );
    });
    const tick = () => {
      if (draftWatch !== watch) return;
      const elapsed = Date.now() - startedAt;
      state.draftSeconds = Math.floor(elapsed / 1000);
      setStage(ctx, 1);
      if (!watch.stalled && elapsed >= DRAFT_TIMINGS.stalledAfterMs) {
        watch.stalled = true;
        if (ctx && typeof ctx.setMessage === "function") {
          ctx.setMessage(STALLED_MESSAGE, "info");
        }
      }
      watch.timers.push(setTimeout(tick, DRAFT_TIMINGS.tickMs));
    };
    watch.timers.push(setTimeout(tick, DRAFT_TIMINGS.slowAfterMs));
    draftWatch = watch;
    return watch;
  }

  /** How to start JobBored here — the one sentence (GFX X1). */
  function startHint() {
    const api = window.JobBoredLocalServer;
    return api && typeof api.localServerHint === "function"
      ? api.localServerHint({})
      : "start JobBored on this computer";
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  function renderDropzone(ctx) {
    const zone = el("div", "oneflow-resume__drop", {
      dataset: { dropzone: "resume" },
    });
    zone.appendChild(
      el(
        "p",
        "oneflow-resume__drop-lede",
        {},
        "Drag your resume here — PDF, Word (.docx) or plain text.",
      ),
    );
    const input = el("input", "oneflow-resume__file", {
      id: FILE_INPUT_ID,
      type: "file",
      // GFX B3-2: no .doc — there is no parser for it.
      accept: ".pdf,.docx,.txt,.md",
      "aria-label": "Choose a resume file",
    });
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) void ingestFile(file, ctx);
    });
    zone.appendChild(input);
    zone.addEventListener("dragover", (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      zone.classList.add("oneflow-resume__drop--over");
    });
    zone.addEventListener("dragleave", () => {
      zone.classList.remove("oneflow-resume__drop--over");
    });
    zone.addEventListener("drop", (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      zone.classList.remove("oneflow-resume__drop--over");
      const file =
        event && event.dataTransfer && event.dataTransfer.files
          ? event.dataTransfer.files[0]
          : null;
      if (file) void ingestFile(file, ctx);
    });
    return zone;
  }

  function renderPasteBox(ctx) {
    const wrap = el("div", "oneflow-resume__paste");
    wrap.appendChild(
      el(
        "label",
        "oneflow-resume__paste-label",
        { htmlFor: PASTE_INPUT_ID },
        "Or paste the text",
      ),
    );
    const box = el("textarea", "oneflow-resume__paste-field", {
      id: PASTE_INPUT_ID,
      rows: 6,
      spellcheck: false,
      placeholder: "Paste your resume text here.",
      value: state.pasteDraft,
      "aria-label": "Resume text",
    });
    /**
     * Every route text takes into this box, not just typing: `input` for
     * keystrokes, `change` for a programmatic value set, `paste` for the
     * clipboard. The walkthrough pasted a resume and lost it because only
     * the first of the three was ever recorded (GREENFIELD F2).
     */
    const record = () => {
      state.pasteDraft = String(box.value || "");
      // Mirrored here as well as inside the controller's saveDraft, so the
      // box's own guarantee does not depend on which context rendered it.
      writePasteMirror(state.pasteDraft);
      saveDraft(ctx, "resumeText", state.pasteDraft);
    };
    box.addEventListener("input", record);
    box.addEventListener("change", record);
    box.addEventListener("paste", () => {
      // The clipboard lands on the node AFTER this handler returns, so
      // record what is there now and again once the text has arrived.
      record();
      setTimeout(record, 0);
    });
    fields.paste = box;
    wrap.appendChild(box);
    return wrap;
  }

  function renderTemplates(ctx) {
    const wrap = el("div", "oneflow-resume__templates");
    wrap.appendChild(
      el(
        "p",
        "oneflow-resume__templates-lede",
        {},
        "Pick the closest starting point. You can change everything on the " +
          "next screen.",
      ),
    );
    const grid = el("div", "oneflow-resume__template-grid");
    for (const template of TEMPLATES) {
      const card = el("button", "oneflow-resume__template-card", {
        type: "button",
        dataset: { templateId: template.id },
      });
      card.appendChild(
        el("span", "oneflow-resume__template-name", {}, template.name),
      );
      card.appendChild(
        el("span", "oneflow-resume__template-desc", {}, template.desc),
      );
      card.addEventListener("click", () => {
        void pickTemplate(template.id, ctx);
      });
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  /**
   * What a failed draft needs beyond one message line: B3-7's link to
   * JobBored on this computer, and B3-6's raw error kept out of the
   * sentence, behind "Technical detail".
   */
  function renderNotice(notice) {
    const wrap = el("div", "oneflow-resume__notice");
    if (notice.link) {
      const line = el("p", "oneflow-resume__notice-line");
      line.appendChild(el("span", "", {}, "Drafting works in "));
      line.appendChild(
        el(
          "a",
          "oneflow-resume__open-local",
          { href: LOCAL_JOBBORED_URL, target: "_blank", rel: "noopener" },
          "JobBored on this computer",
        ),
      );
      line.appendChild(el("span", "", {}, `. To start it, ${startHint()}.`));
      wrap.appendChild(line);
    }
    if (notice.technical) {
      const details = el("details", "oneflow-resume__tech");
      details.appendChild(
        el("summary", "oneflow-resume__tech-summary", {}, "Technical detail"),
      );
      details.appendChild(el("p", "oneflow-resume__tech-body", {}, notice.technical));
      wrap.appendChild(details);
    }
    return wrap;
  }

  function render(container, ctx) {
    lastCtx = ctx;
    fields.paste = null;
    if (ctx && state.scope !== null && state.scope !== ctx.scope) resetState();
    if (ctx) state.scope = ctx.scope;
    hydrateFromDrafts(ctx);
    const body = el("div", "oneflow-resume");
    if (state.mode === "templates") {
      body.appendChild(renderTemplates(ctx));
      container.appendChild(body);
      return;
    }
    body.appendChild(renderDropzone(ctx));
    body.appendChild(renderPasteBox(ctx));
    if (state.notice) body.appendChild(renderNotice(state.notice));
    body.appendChild(
      el(
        "p",
        "oneflow-resume__privacy",
        {},
        "Your resume stays in this browser and on this machine. We send the " +
          "text to the AI provider you connected on the last screen, and " +
          "nowhere else.",
      ),
    );
    container.appendChild(body);
  }

  // ---------------------------------------------------------------
  // The read-only draft (spec §5 B3, staged by JOBQA)
  // ---------------------------------------------------------------

  /**
   * `locked` marks the one failure whose fix is Beat 2 rather than a retry.
   *
   * @returns {Promise<{ok: true, profile: object} | {ok: false, message: string, missing: boolean, locked?: boolean, directFallback?: boolean}>}
   * directFallback marks transport absence (no endpoint here at all —
   * 405, unreachable) as opposed to a bad resume or bad key. Only those
   * outcomes may retry straight from the browser; provider errors must
   * surface, not silently re-attempt.
   */
  async function draftOnServer(text, signal, document) {
    const provider = verifiedProviderConfig();
    // GREENFIELD A3: no usable provider means no request. The server would
    // only answer with an error, and an error the browser could have
    // predicted is a round trip spent to say "we already knew".
    if (!provider) return { ok: false, missing: false, locked: true, message: CONNECT_AI_COPY };
    state.writeOrder.push("server");
    const payload = { resumeText: text, ...provider };
    if (document) payload.document = document;
    let res;
    try {
      const init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      };
      if (signal) init.signal = signal;
      res = await apiFetch(profileUrl("/profile/from-resume"), init);
    } catch (err) {
      return {
        ok: false,
        missing: false,
        directFallback: true,
        message:
          "Couldn't reach JobBored on this computer to draft your resume. " +
          `To start it, ${startHint()}, then press Try again.`,
        notice: { link: false, technical: String((err && err.message) || err || "") },
      };
    }
    const data = res ? await res.json().catch(() => null) : null;
    // The honest 404/500 split: "we never got your resume" and "the AI
    // provider failed" have different fixes, so they keep different copy.
    if (res && res.status === 404) {
      return {
        ok: false,
        missing: true,
        message:
          "The server couldn't read your resume — nothing came through. Try " +
          "the upload again, or paste the text instead.",
      };
    }
    // A 405 means the page answering us has no drafting endpoint at all —
    // the signature of the static hosted site, where /profile/from-resume
    // hits the file host instead of the local API server. That is a
    // missing-server situation, not a broken resume: name the template
    // escape hatch (always on screen) instead of a retry that cannot help.
    if (res && res.status === 405) {
      return {
        ok: false,
        missing: false,
        directFallback: true,
        message:
          "This page can't draft your resume by itself. Press 'I'd rather " +
          "start from a template', or draft it in JobBored on this computer.",
        notice: { link: true, technical: "HTTP 405 from /profile/from-resume" },
      };
    }
    if (!res || !res.ok || !data || data.ok !== true) {
      // A provider that was never connected is a Beat 2 problem, whatever
      // name the server fell back to — its own words ("reconnect Gemini")
      // named a provider the user never chose (greenfield walkthrough
      // 2026-09-02, step 12). The guard above catches this before the
      // request in the ordinary case; the server can still answer it for a
      // key blanked after Beat 2, or a stale server env. Same situation,
      // same locked line, same button.
      const reason = String((data && data.reason) || "");
      if (/_not_configured$/.test(reason)) {
        return { ok: false, missing: false, locked: true, message: CONNECT_AI_COPY };
      }
      return {
        ok: false,
        missing: false,
        message:
          (data && data.message) ||
          reason ||
          `The profile drafter failed (HTTP ${res ? res.status : "?"}).`,
      };
    }
    return { ok: true, profile: data.profile, read: data.read || null };
  }

  /** The shared reader in profile-identity.js, when it loaded. */
  function resumeReader() {
    const reader = window.JobBoredResumeRead;
    return reader && typeof reader.summaryLine === "function" ? reader : null;
  }

  /** "Reading your resume with OpenRouter (gpt-oss-120b)". */
  function readingLabelFor(provider) {
    const reader = resumeReader();
    if (!reader || !provider) return "";
    return `Reading your resume with ${reader.providerLabel(provider.provider, provider.model)}`;
  }

  /**
   * Serverless drafting for pages with no API server (the hosted site) or
   * a down local server. Drafts straight from the browser through the same
   * provider call the generation features use, with the shared prompt and
   * clamp — the profile B4 receives is shaped exactly like a server
   * draft. Never throws. GFX N-B3-1: when the provider itself refused
   * (429, bad key), `message` carries its words; a bare { ok:false } means
   * the browser could not try, and the server's message stands.
   */
  async function draftDirectFromResume(resumeText) {
    try {
      const provider = verifiedProviderConfig();
      const api = window.CommandCenterResumeGenerate;
      const shared = window.JobBoredProfileDraft;
      if (!provider || provider.provider === "webhook") return { ok: false };
      if (!api || typeof api.callConfiguredAi !== "function") return { ok: false };
      if (
        !shared ||
        typeof shared.buildUserPrompt !== "function" ||
        typeof shared.parseJsonSafe !== "function" ||
        typeof shared.clampToUserProfile !== "function"
      ) {
        return { ok: false };
      }
      let text;
      try {
        text = await api.callConfiguredAi(
          shared.SYSTEM_PROMPT,
          shared.buildUserPrompt(resumeText),
          { json: true },
        );
      } catch (err) {
        const message = String((err && err.message) || "").trim();
        return message ? { ok: false, message } : { ok: false };
      }
      const raw = shared.parseJsonSafe(text);
      // RESJ2-EXTRACT (Grok review, direct-no-counts): no server means no
      // server read, so say what was read from the model's checked facts,
      // named for the provider that answered.
      const read =
        typeof shared.readFromResumeFacts === "function" && typeof shared.resumeFactsOf === "function"
          ? shared.readFromResumeFacts(resumeText, shared.resumeFactsOf(raw), {
              provider: provider.provider,
              model: provider.model || provider.provider,
            })
          : null;
      return {
        ok: true,
        profile: shared.clampToUserProfile(raw),
        read,
      };
    } catch (_) {
      return { ok: false };
    }
  }

  async function ingest(text, source, ctx, modelDocument) {
    const context = ctx || lastCtx;
    const clean = String(text || "").trim();
    if (!clean) {
      state.failed = false;
      repaint(
        context,
        "Drop in a file or paste the text of your resume first.",
        "error",
      );
      return;
    }

    const run = (state.ingestRun += 1);
    state.lastText = clean;
    state.lastSource = source;
    state.lastDocument = modelDocument || null;
    state.failed = false;
    state.providerLocked = false;
    state.notice = null;
    state.writeOrder = [];
    state.readingLabel = readingLabelFor(verifiedProviderConfig());
    state.doneLabel = "";
    // JOBQA: the only write an upload makes is to the wizard draft. The
    // saved resume changes on B4's commit, never here.
    saveDraft(context, "resumeText", clean);
    state.writeOrder.push("draft");
    setStage(context, 0);

    if (run !== state.ingestRun) return;
    setStage(context, 1);
    const watch = startDraftWatch(context);
    let drafted;
    try {
      drafted = await Promise.race([
        draftOnServer(clean, watch.controller ? watch.controller.signal : null, modelDocument),
        watch.deadline,
      ]);
      if (source !== "upload" && drafted !== TIMED_OUT && !drafted.ok && drafted.directFallback) {
        // No drafting endpoint answered (static host, or the local server
        // is down) — draft straight from the browser with the B2-verified
        // provider before giving up, on the same deadline.
        const direct = await Promise.race([draftDirectFromResume(clean), watch.deadline]);
        if (direct === TIMED_OUT) drafted = TIMED_OUT;
        else if (direct.ok) drafted = { ok: true, profile: direct.profile, read: direct.read || null };
        // GFX N-B3-1: the provider answered with a refusal — its words beat
        // a guess about the server.
        else if (direct.message) drafted = { ok: false, missing: false, message: direct.message };
      }
    } finally {
      if (draftWatch === watch) stopDraftWatch(false);
    }
    if (run !== state.ingestRun) return;
    if (drafted === TIMED_OUT) {
      drafted = {
        ok: false,
        missing: false,
        message: source === "upload"
          ? "We couldn't read that file: try again or paste the text."
          : `Your AI provider didn't answer in ${Math.round(DRAFT_TIMINGS.abortAfterMs / 1000)} seconds. Press Try again, or start from a template.`,
      };
    }
    if (!drafted.ok) {
      clearStages(context);
      // A locked draft is not a failure to retry — retrying without a
      // provider lands in exactly the same place. Offer the fix instead.
      state.providerLocked = !!drafted.locked;
      state.failed = !drafted.locked;
      state.notice = drafted.notice || null;
      if (source === "upload" && !drafted.locked && !/10 MB limit/i.test(drafted.message || "")) {
        drafted.message = "We couldn't read that file: try again or paste the text.";
      }
      repaint(context, drafted.message, "error");
      return;
    }

    state.draft = { profile: drafted.profile, source, starterTemplate: "custom" };
    state.lastDocument = null;
    if (context && context.runtime) {
      context.runtime.profileDraft = state.draft;
      // JOBQA: what the AI read, kept for B4's commit (saved only with it).
      context.runtime.resumeRead = drafted.read || null;
    }
    saveDraft(context, "profileDraft", state.draft);
    // RESJ2-EXTRACT: say what the AI read, in the stage list and in a toast
    // that outlives the move to the next beat.
    const reader = resumeReader();
    const readLine = reader && drafted.read ? reader.summaryLine(drafted.read) : "";
    state.doneLabel = readLine;
    setStage(context, STAGE_LABELS.length);
    if (readLine) {
      reader.announceRead(drafted.read);
      const app = window.JobBoredApp;
      const host = app && app.core && app.core.host;
      if (host && typeof host.showToast === "function") host.showToast(readLine, "success");
    }

    if (run !== state.ingestRun) return;

    if (context && typeof context.completeBeat === "function") {
      await context.completeBeat({ source });
    }
  }

  async function ingestFile(file, ctx) {
    const context = ctx || lastCtx;
    const api = ingestApi();
    if (!api || typeof api.extractTextFromFile !== "function") {
      state.failed = true;
      repaint(
        context,
        "The resume reader didn't load. Reload the page, or paste the text instead.",
        "error",
      );
      return;
    }
    setStage(context, 0);
    let text;
    let modelDocument = null;
    try {
      text = await api.extractTextFromFile(file);
      if (typeof api.documentForModel === "function") modelDocument = await api.documentForModel(file);
    } catch (err) {
      clearStages(context);
      state.failed = true;
      // GFX N-B3-4: the reader's own errors often already point at the
      // paste box; say it once.
      const reason = String((err && err.message) || err || "Couldn't read that file.");
      repaint(
        context,
        /paste/i.test(reason) ? reason : `${reason} You can paste the text instead.`,
        "error",
      );
      return;
    }
    const normalize =
      typeof api.normalizeExtractedText === "function"
        ? api.normalizeExtractedText
        : (t) => t;
    return ingest(normalize(text), "upload", context, modelDocument);
  }

  // ---------------------------------------------------------------
  // The template path (spec §5 B3 fallbacks)
  // ---------------------------------------------------------------

  async function fetchTemplateSeed(id) {
    if (id === "blank") return null;
    try {
      const res = await apiFetch(profileUrl(`/profile/template/${encodeURIComponent(id)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = res ? await res.json().catch(() => null) : null;
      if (!res || !res.ok || !data || data.ok !== true) return null;
      return data.template || null;
    } catch (err) {
      console.warn("[JobBored] one-flow B3 template seed:", err);
      return null;
    }
  }

  async function pickTemplate(id, ctx) {
    const context = ctx || lastCtx;
    const profile = await fetchTemplateSeed(id);
    state.failed = false;
    state.mode = "intake";
    state.draft = { profile, source: "template", starterTemplate: id };
    if (context && context.runtime) context.runtime.profileDraft = state.draft;
    saveDraft(context, "profileDraft", state.draft);
    syncActions();
    if (context && typeof context.completeBeat === "function") {
      await context.completeBeat({ source: "template" });
    }
  }

  // ---------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------

  function supersedeDraft() {
    state.ingestRun += 1;
    stopDraftWatch(true);
  }

  async function handleAction(actionId, ctx) {
    const context = ctx || lastCtx;
    if (!context) return undefined;
    switch (actionId) {
      case ACTION_USE_TEXT:
        return ingest(readPaste(), "paste", context);
      case ACTION_RETRY: {
        // Text edited in the box since the failure is what the user means.
        const text =
          state.lastSource === "paste" ? readPaste() || state.lastText : state.lastText;
        if (text) return ingest(text, state.lastSource || "paste", context, state.lastDocument);
        state.failed = false;
        repaint(context, "");
        return undefined;
      }
      case ACTION_CONNECT_AI:
        supersedeDraft();
        if (typeof context.goToBeat === "function") return context.goToBeat("ai");
        return undefined;
      case ACTION_TEMPLATE:
        // The stall line offers this exit mid-draft: the draft in flight
        // is dropped so it can't overwrite the template's profile later.
        supersedeDraft();
        state.mode = "templates";
        state.failed = false;
        state.notice = null;
        clearStages(context);
        repaint(context, "");
        return undefined;
      case ACTION_BACK:
        // state.pasteDraft is what makes this free: it is written on every
        // keystroke and survives the mode switch, so the intake screen comes
        // back with the text still in it.
        state.mode = "intake";
        state.failed = false;
        repaint(context, "");
        return undefined;
      default:
        return undefined;
    }
  }

  flow.registerBeat({
    id: "resume",
    order: 3,
    label: "Resume",
    timeLabel: "about 10 min left",
    headline: HEADLINE,
    sub: SUB,
    actions: ACTIONS,
    render,
    onAction(actionId, ctx) {
      return handleAction(actionId, ctx);
    },
  });

  window.JobBoredOneFlowBeatResume = {
    HEADLINE,
    SUB,
    TEMPLATES,
    STAGE_LABELS,
    CONNECT_AI_COPY,
    // Exported for the legacy fit-profile editor, which posts the same
    // /profile/from-resume route and must send the same provider block
    // (GREENFIELD A4). One reader, one definition of "usable provider".
    verifiedProviderConfig,
    handleAction,
    ingestText(text, source) {
      return ingest(text, source || "paste", lastCtx);
    },
    ingestFile(file) {
      return ingestFile(file, lastCtx);
    },
    pickTemplate(id) {
      return pickTemplate(id, lastCtx);
    },
    getRenderedStages() {
      return state.stages.slice();
    },
    getWriteOrder() {
      return state.writeOrder.slice();
    },
    getDraft() {
      return state.draft;
    },
    // Test seam: the B3-4 clock, and the footer's current actions.
    _internal: {
      timings: DRAFT_TIMINGS,
      actions() {
        return ACTIONS.slice();
      },
    },
  };
})();
