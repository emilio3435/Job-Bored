/* ============================================
   Beat B3 of the one-flow onboarding — Hand us your resume.

   ONE-FLOW-ONBOARDING-SPEC §5 B3. This beat closes the teardown's
   keystone bug: a resume uploaded in wizard 1 was invisible to wizard 2,
   because one stored it in IndexedDB and the other read the filesystem.
   The fix is a DUAL write, in a fixed order —

     1. UC.setPrimaryResume(...)                 (the browser's copy)
     2. POST /profile/from-resume { resumeText } (the server's copy,
        which server/profile-from-resume.mjs now caches to
        ~/.jobbored/resume.txt for every later reader)

   — because the server must never be asked to draft from a resume the
   browser has not yet committed. If the draft fails, the upload still
   survives; losing it is the bug, not the fallback.

   Drafting runs on the provider B2 verified, so the template path is a
   CHOICE here, never the consolation prize for a missing key.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Drop in your resume. We'll do the typing.";

  const SUB =
    "From this one file we'll draft your whole fit profile — target " +
    "roles, strengths, what you want, what to avoid. You'll review " +
    "everything on the next screen; nothing is saved until you approve " +
    "it.";

  const ACTION_TEMPLATE = "resume_template";
  const ACTION_RETRY = "resume_retry";
  const ACTION_USE_TEXT = "resume_use_text";

  const FILE_INPUT_ID = "oneFlowResumeFile";
  const PASTE_INPUT_ID = "oneFlowResumePaste";

  /** Spec §5 B3: the stage list is normative. */
  const STAGE_LABELS = [
    "Reading your resume ✓",
    "Drafting target roles & strengths…",
    "Writing your first-person narrative…",
    "Draft ready ✓",
  ];

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
    writeOrder: [],
    draft: null,
  };

  const fields = { paste: null };
  const ACTIONS = [];
  let lastCtx = null;

  function store() {
    return window.CommandCenterUserContent || null;
  }

  function ingestApi() {
    return window.CommandCenterResumeIngest || null;
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

  function readPaste() {
    const node = fields.paste;
    if (node && typeof node.value === "string") return node.value;
    return state.pasteDraft;
  }

  function syncActions() {
    ACTIONS.length = 0;
    if (state.mode === "intake") {
      ACTIONS.push({
        id: ACTION_USE_TEXT,
        label: "Draft from this text",
        variant: "primary",
      });
    }
    if (state.failed) {
      ACTIONS.push({ id: ACTION_RETRY, label: "Try again", variant: "primary" });
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
    state.stages = STAGE_LABELS.map((label, i) => ({
      label,
      state: i < index ? "done" : i === index ? "active" : "todo",
    }));
    if (index >= STAGE_LABELS.length) {
      state.stages = STAGE_LABELS.map((label) => ({ label, state: "done" }));
    }
    if (ctx && typeof ctx.setBusy === "function") {
      ctx.setBusy(ACTION_USE_TEXT, state.stages);
    }
  }

  function clearStages(ctx) {
    state.stages = [];
    if (ctx && typeof ctx.clearBusy === "function") ctx.clearBusy();
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
        "Drag your resume here — PDF, Word, or plain text.",
      ),
    );
    const input = el("input", "oneflow-resume__file", {
      id: FILE_INPUT_ID,
      type: "file",
      accept: ".pdf,.doc,.docx,.txt,.md",
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

  function renderPasteBox() {
    const wrap = el("div", "oneflow-resume__paste");
    wrap.appendChild(
      el(
        "label",
        "oneflow-resume__paste-label",
        { htmlFor: PASTE_INPUT_ID },
        "…or paste the text instead",
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
    box.addEventListener("input", () => {
      state.pasteDraft = String(box.value || "");
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
        "Pick the closest starting point. Everything is editable on the next " +
          "screen — a template is a seed, not a lock.",
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

  function render(container, ctx) {
    lastCtx = ctx;
    fields.paste = null;
    const body = el("div", "oneflow-resume");
    if (state.mode === "templates") {
      body.appendChild(renderTemplates(ctx));
      container.appendChild(body);
      return;
    }
    body.appendChild(renderDropzone(ctx));
    body.appendChild(renderPasteBox());
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
  // The dual write (spec §5 B3)
  // ---------------------------------------------------------------

  async function writeToBrowserStore(text, source) {
    const uc = store();
    if (!uc || typeof uc.setPrimaryResume !== "function") {
      throw new Error(
        "The browser's resume store didn't load. Reload the page and try again.",
      );
    }
    await uc.setPrimaryResume({
      source: source === "upload" ? "file" : "paste",
      rawMime: null,
      label: "My resume",
      extractedText: text,
    });
    state.writeOrder.push("indexeddb");
  }

  /**
   * @returns {Promise<{ok: true, profile: object} | {ok: false, message: string, missing: boolean}>}
   */
  async function draftOnServer(text) {
    state.writeOrder.push("server");
    let res;
    try {
      res = await fetch(profileUrl("/profile/from-resume"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: text }),
      });
    } catch (err) {
      return {
        ok: false,
        missing: false,
        message:
          "Couldn't reach the local server. Make sure npm start is running, " +
          `then try again. (${String((err && err.message) || err || "")})`,
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
    if (!res || !res.ok || !data || data.ok !== true) {
      return {
        ok: false,
        missing: false,
        message:
          (data && data.message) ||
          (data && data.reason) ||
          `The profile drafter failed (HTTP ${res ? res.status : "?"}).`,
      };
    }
    return { ok: true, profile: data.profile };
  }

  async function ingest(text, source, ctx) {
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

    state.lastText = clean;
    state.lastSource = source;
    state.failed = false;
    state.writeOrder = [];
    setStage(context, 0);

    try {
      await writeToBrowserStore(clean, source);
    } catch (err) {
      clearStages(context);
      state.failed = true;
      repaint(context, String((err && err.message) || err || ""), "error");
      return;
    }

    setStage(context, 1);
    const drafted = await draftOnServer(clean);
    if (!drafted.ok) {
      clearStages(context);
      state.failed = true;
      repaint(context, drafted.message, "error");
      return;
    }

    setStage(context, 2);
    state.draft = { profile: drafted.profile, source, starterTemplate: "custom" };
    if (context && context.runtime) context.runtime.resumeDraft = state.draft;
    setStage(context, STAGE_LABELS.length);

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
    try {
      text = await api.extractTextFromFile(file);
    } catch (err) {
      clearStages(context);
      state.failed = true;
      repaint(
        context,
        String((err && err.message) || err || "Couldn't read that file.") +
          " You can paste the text instead.",
        "error",
      );
      return;
    }
    const normalize =
      typeof api.normalizeExtractedText === "function"
        ? api.normalizeExtractedText
        : (t) => t;
    return ingest(normalize(text), "upload", context);
  }

  // ---------------------------------------------------------------
  // The template path (spec §5 B3 fallbacks)
  // ---------------------------------------------------------------

  async function fetchTemplateSeed(id) {
    if (id === "blank") return null;
    try {
      const res = await fetch(profileUrl(`/profile/template/${encodeURIComponent(id)}`), {
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
    if (context && context.runtime) context.runtime.resumeDraft = state.draft;
    syncActions();
    if (context && typeof context.completeBeat === "function") {
      await context.completeBeat({ source: "template" });
    }
  }

  // ---------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------

  async function handleAction(actionId, ctx) {
    const context = ctx || lastCtx;
    if (!context) return undefined;
    switch (actionId) {
      case ACTION_USE_TEXT:
        return ingest(readPaste(), "paste", context);
      case ACTION_RETRY:
        if (state.lastText) return ingest(state.lastText, state.lastSource, context);
        state.failed = false;
        repaint(context, "");
        return undefined;
      case ACTION_TEMPLATE:
        state.mode = "templates";
        state.failed = false;
        clearStages(context);
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
    timeLabel: "about 8 min left",
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
  };
})();
