/* ============================================
   Beat "Your voice" of the one-flow onboarding — right after "Your
   details".

   JobBored drafts cover letters and recruiter notes from a voice guide:
   a short Markdown page about how the user writes, stored at
   ~/.jobbored/profile/voice.md (PUT /profile/voice). This step captures
   it two ways:
   (a) "Write it with your chatbot": copy a prompt, paste it into ChatGPT,
       Claude or Gemini, answer its questions, paste the guide back;
   (b) "I already have one": paste it, or upload a .md / .txt file.
   Either way the guide lands in one field with a live preview (word
   count, sections found, a gentle note when "Approved facts" or "Cover
   letter rules" is missing). Nothing is saved until Save; the text rides
   the flow draft `voiceDraft` across a refresh. Skipping is allowed and
   stays visibly unfinished on the spine, like "Your details".

   Saving never overwrites silently: a guide that already exists is shown
   here first, the server backs up whatever it replaces, and a guide saved
   elsewhere since this step loaded is a 409 the user is told about.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Make your drafts sound like you.";
  const SUB =
    "JobBored writes your cover letters and recruiter notes from a short voice guide — " +
    "a page about how you write. With one, drafts sound like you, not like a machine.";

  const ACTION_SAVE = "voice_save";
  const ACTION_SKIP = "voice_skip";

  const TAB_CHATBOT = "chatbot";
  const TAB_OWN = "own";

  /**
   * The beat's state. The shell re-renders the whole step on every
   * setMessage / setBusy, so the DOM is disposable and everything worth
   * keeping lives here.
   */
  const state = {
    text: "",
    tab: "",
    // "idle" → "running" → "done": the saved guide is read once per load.
    load: "idle",
    saved: null,
    offline: false,
    note: "",
    noteKind: "info",
    saving: false,
    field: null,
  };

  function api() {
    return window.JobBoredProfileVoice || null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function draftText(ctx) {
    const runtime = (ctx && ctx.runtime) || {};
    const drafts = runtime.drafts && typeof runtime.drafts === "object" ? runtime.drafts : {};
    return typeof drafts.voiceDraft === "string" ? drafts.voiceDraft : "";
  }

  function persist(ctx) {
    if (!ctx || typeof ctx.saveDraft !== "function") return;
    try {
      ctx.saveDraft("voiceDraft", state.text);
    } catch (err) {
      console.warn("[JobBored] one-flow voice saveDraft:", err);
    }
  }

  function words(n) {
    return n + (n === 1 ? " word" : " words");
  }

  /** The line above the tabs: what is saved already, if anything. */
  function savedLine() {
    const lib = api();
    const saved = state.saved;
    if (!saved || !saved.exists) return "";
    const date = lib ? lib.formatDate(saved.updatedAt) : "";
    return (
      "You already have a voice guide" +
      (date ? " from " + date : "") +
      " (" + words(saved.words) + "). It's below — edit it or save it as is. " +
      "If you replace it, JobBored keeps the old one as a backup."
    );
  }

  function paintNote(root) {
    const node = root && root.querySelector(".oneflow-voice__note");
    if (!node) return;
    node.textContent = state.note;
    node.hidden = !state.note;
    if (state.note) node.dataset.kind = state.noteKind;
  }

  /**
   * Read the saved guide once per load. The user's own draft wins (a
   * refresh mid-step); otherwise an existing guide fills the field so the
   * user sees what they would replace.
   */
  async function load(ctx, root) {
    const lib = api();
    if (!lib || state.load !== "idle") return;
    state.load = "running";
    const result = await lib.fetchVoice();
    state.load = "done";
    if (!result.ok) {
      state.offline = result.reason === "offline";
      return;
    }
    state.saved = result;
    const mount = root && root.isConnected ? root : document.querySelector(".oneflow-voice");
    if (result.exists && !state.text) {
      state.text = result.text;
      if (state.field) state.field.setText(result.text);
      state.tab = TAB_OWN;
      if (mount) rerenderTabs(mount);
    }
    if (mount) {
      const line = mount.querySelector(".oneflow-voice__saved");
      if (line) {
        line.textContent = savedLine();
        line.hidden = !line.textContent;
      }
      mount.dataset.load = "done";
    }
  }

  // ---------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------

  function setTab(root, tab, focus) {
    state.tab = tab;
    rerenderTabs(root);
    if (focus) {
      const active = root.querySelector('.oneflow-voice__tab[aria-selected="true"]');
      if (active) active.focus();
    }
  }

  function rerenderTabs(root) {
    root.querySelectorAll(".oneflow-voice__tab").forEach((tab) => {
      const on = tab.dataset.tab === state.tab;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
    root.querySelectorAll(".oneflow-voice__panel").forEach((panel) => {
      panel.hidden = panel.dataset.tab !== state.tab;
    });
  }

  function renderTabs(root, panels) {
    const list = el("div", "oneflow-voice__tabs");
    list.setAttribute("role", "tablist");
    list.setAttribute("aria-label", "How to add your voice guide");
    const tabs = [
      { id: TAB_CHATBOT, label: "Write it with your chatbot" },
      { id: TAB_OWN, label: "I already have one" },
    ];
    tabs.forEach((spec) => {
      const tab = el("button", "oneflow-voice__tab", spec.label);
      tab.type = "button";
      tab.id = "oneflowVoiceTab-" + spec.id;
      tab.dataset.tab = spec.id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "oneflowVoicePanel-" + spec.id);
      tab.addEventListener("click", () => setTab(root, spec.id, false));
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const index = tabs.findIndex((t) => t.id === state.tab);
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        setTab(root, tabs[next].id, true);
      });
      list.appendChild(tab);
    });
    root.appendChild(list);
    panels.forEach((panel) => {
      panel.setAttribute("role", "tabpanel");
      panel.id = "oneflowVoicePanel-" + panel.dataset.tab;
      panel.setAttribute("aria-labelledby", "oneflowVoiceTab-" + panel.dataset.tab);
      root.appendChild(panel);
    });
  }

  function renderChatbotPanel(lib) {
    const panel = el("div", "oneflow-voice__panel");
    panel.dataset.tab = TAB_CHATBOT;
    const steps = el("ol", "oneflow-voice__steps");
    [
      "Copy the prompt below.",
      "Paste it into ChatGPT, Claude or Gemini and answer its questions — it asks a few at a time.",
      "Copy the guide it writes and paste it into the box below.",
    ].forEach((line) => steps.appendChild(el("li", "oneflow-voice__step", line)));
    panel.appendChild(steps);
    lib.renderPromptBox(panel, { label: "The prompt", rows: 7 });
    return panel;
  }

  function renderOwnPanel(lib, ctx) {
    const panel = el("div", "oneflow-voice__panel");
    panel.dataset.tab = TAB_OWN;
    panel.appendChild(
      el(
        "p",
        "oneflow-voice__lede",
        "Paste your guide into the box below, or upload it as a Markdown (.md) or plain text (.txt) file.",
      ),
    );
    const row = el("div", "oneflow-voice__upload-row");
    const status = el("p", "oneflow-voice__upload-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const picker = lib.filePicker("Upload a file", async (file) => {
      const read = await lib.readTextFile(file);
      if (!read.ok) {
        status.textContent = read.message;
        status.dataset.kind = "error";
        return;
      }
      if (state.field) state.field.setText(read.text);
      else {
        state.text = read.text;
        persist(ctx);
      }
      status.textContent = "Loaded " + read.name + ". Check it below, then save.";
      status.dataset.kind = "ok";
    });
    picker.button.id = "oneflowVoiceUpload";
    row.append(picker.button, picker.input, status);
    panel.appendChild(row);
    return panel;
  }

  function render(container, ctx) {
    const lib = api();
    const root = el("div", "oneflow-voice");
    if (!lib) {
      root.appendChild(
        el("p", "oneflow-voice__note", "This step didn't load. Skip it for now and add your voice guide in Settings."),
      );
      container.appendChild(root);
      return;
    }
    if (!state.text) state.text = draftText(ctx);
    if (!state.tab) state.tab = state.text ? TAB_OWN : TAB_CHATBOT;
    root.dataset.load = state.load === "done" ? "done" : "pending";

    const saved = el("p", "oneflow-voice__saved", savedLine());
    saved.hidden = !saved.textContent;
    root.appendChild(saved);

    renderTabs(root, [renderChatbotPanel(lib), renderOwnPanel(lib, ctx)]);
    rerenderTabs(root);

    state.field = lib.renderGuideField(root, {
      label: "Your voice guide",
      value: state.text,
      rows: 10,
      placeholder: "Paste the guide here — Markdown or plain text.",
      onChange(text) {
        state.text = text;
        if (state.note && state.noteKind === "error") {
          state.note = "";
          paintNote(root);
        }
        persist(ctx);
      },
    });
    state.field.textarea.id = "oneflowVoiceGuide";
    const label = state.field.root.querySelector("label");
    if (label) label.htmlFor = "oneflowVoiceGuide";

    const note = el("p", "oneflow-voice__note");
    note.setAttribute("role", "status");
    root.appendChild(note);
    paintNote(root);

    root.appendChild(
      el(
        "p",
        "oneflow-voice__privacy",
        "Your guide stays on this computer, in your JobBored profile folder. Only your drafts use it.",
      ),
    );
    container.appendChild(root);
    if (state.load === "idle") load(ctx, root);
  }

  async function save(ctx) {
    const lib = api();
    const shared = window.JobBoredProfileVoiceShared;
    if (!lib || state.saving) return;
    if (state.field) state.text = state.field.getText();
    const problem = shared ? shared.voiceProblem(state.text) : "";
    if (problem) {
      state.note = "";
      ctx.setMessage(
        problem === "empty"
          ? "Paste your voice guide first — or skip for now and add it later in Settings."
          : lib.problemMessage(problem),
        "error",
      );
      return;
    }
    state.saving = true;
    let result;
    try {
      ctx.setBusy(ACTION_SAVE, [{ label: "Saving your voice guide…", state: "active" }]);
      const saved = state.saved;
      // What this step read: the server refuses the save if the guide
      // changed since. Unread (the server didn't answer): no check.
      const seen = state.load === "done" && saved ? (saved.exists ? saved.updatedAt : null) : undefined;
      result = await lib.saveVoice(state.text, seen);
    } finally {
      ctx.clearBusy();
      state.saving = false;
    }
    if (result.ok) {
      state.saved = { exists: true, updatedAt: result.updatedAt, words: result.words, text: state.text };
      state.note = "";
      persist(ctx);
      ctx.setMessage("", "info");
      await ctx.completeBeat({ words: result.words, replaced: !!result.backup, unchanged: !!result.unchanged });
      return;
    }
    if (result.reason === "changed") {
      state.saved = { exists: !!result.updatedAt, updatedAt: result.updatedAt, words: 0, text: "" };
      ctx.setMessage(
        "A voice guide was saved on this computer after this step opened. Your text is still here — " +
          "save again to replace it (the other one is kept as a backup).",
        "error",
      );
      return;
    }
    if (result.reason === "offline") {
      ctx.setMessage(
        "JobBored's local server didn't answer, so the guide isn't saved yet. Start JobBored on this " +
          "computer and try again — or skip for now; your text stays here.",
        "error",
      );
      return;
    }
    ctx.setMessage(result.message, "error");
  }

  function skip(ctx) {
    if (state.field) state.text = state.field.getText();
    persist(ctx);
    return ctx.skipBeat({ beat: "voice" });
  }

  flow.registerBeat({
    id: "voice",
    // Between "Your details" (3.5) and the fit review (4).
    order: 3.75,
    label: "Your voice",
    timeLabel: "about 10 min left",
    headline: HEADLINE,
    sub: SUB,
    actions: [
      { id: ACTION_SAVE, label: "Save my voice guide →", variant: "primary" },
      { id: ACTION_SKIP, label: "Skip for now", variant: "ghost" },
    ],
    render,
    onAction(actionId, ctx) {
      if (actionId === ACTION_SAVE) return save(ctx);
      if (actionId === ACTION_SKIP) return skip(ctx);
      return undefined;
    },
  });

  window.JobBoredOneFlowBeatVoice = {
    HEADLINE,
    SUB,
    ACTION_SAVE,
    ACTION_SKIP,
    getField() {
      return state.field;
    },
  };
})();
