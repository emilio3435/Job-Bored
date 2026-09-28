/* ============================================
   profile-voice.js — "Your voice": the voice guide JobBored's drafts
   follow, a Markdown page about how the user writes.

   Two homes: the one-flow "Your voice" beat (oneflow-beat-voice.js, right
   after "Your details") and the "Your voice" section in Settings → Fit
   Profile, beside "Your details". Both use the pieces here:
   - the API client for GET / PUT / DELETE /profile/voice (the server
     keeps the guide at ~/.jobbored/profile/voice.md, backs up whatever it
     replaces and refuses a stale save);
   - the chatbot prompt box with a Copy button (clipboard first, then a
     select-the-text fallback);
   - the guide field with a live preview: word count, the headings found,
     and a gentle note when "Approved facts" or "Cover letter rules" is
     missing;
   - reading a .md / .txt file the user picks.

   The prompt and the checks come from server/profile-voice-shared.js
   (window.JobBoredProfileVoiceShared), the same code the server uses.

   Classic-global IIFE. Attaches window.JobBoredProfileVoice. Load after
   server/profile-voice-shared.js.
   ============================================ */
(function () {
  "use strict";

  var PREVIEW_DELAY_MS = 200;
  var FILE_ACCEPT = ".md,.markdown,.txt,text/markdown,text/plain";
  var FILE_EXTENSIONS = /\.(md|markdown|txt)$/i;

  var idCounter = 0;
  function nextId(prefix) {
    idCounter += 1;
    return "jbVoice-" + prefix + "-" + idCounter;
  }

  function shared() {
    return window.JobBoredProfileVoiceShared || null;
  }

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = String(content);
    return node;
  }

  function button(className, label, variant) {
    var kind = variant || "ghost";
    var node = el(
      "button",
      "fp-btn fp-btn--" + kind + " jb-voice__btn jb-voice__btn--" + kind + " " + className,
      label,
    );
    node.type = "button";
    return node;
  }

  // ---------------------------------------------------------------
  // Transport (the same shape as profile-identity.js)
  // ---------------------------------------------------------------

  function apiFetch(url, init) {
    var auth = window.JobBoredHostedApiAuth;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    return fetch(url, init);
  }

  function profileUrl(path) {
    var api = window.JobBoredProfileApi;
    if (api && typeof api.getProfileApiBase === "function") {
      return (api.getProfileApiBase() || "") + path;
    }
    var cfg = window.COMMAND_CENTER_CONFIG || {};
    var raw = String(cfg.jobBoredApiUrl || cfg.jobPostingScrapeUrl || "").trim();
    if (raw) return raw.replace(/\/+$/, "") + path;
    if (window.location && window.location.protocol === "file:") {
      return "http://127.0.0.1:3847" + path;
    }
    return path;
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  var OFFLINE_MESSAGE =
    "JobBored's local server didn't answer. Start JobBored on this computer, then try again.";

  /**
   * The saved guide. Resolves
   *   { ok: true, exists, text, updatedAt, words }
   *   { ok: false, reason: "offline" | "server_error", message }
   */
  async function fetchVoice() {
    var res;
    try {
      res = await apiFetch(profileUrl("/profile/voice"), { method: "GET" });
    } catch (_) {
      return { ok: false, reason: "offline", message: OFFLINE_MESSAGE };
    }
    var data = await readJson(res);
    if (res.ok && data && data.ok === true) {
      return {
        ok: true,
        exists: !!data.exists,
        text: typeof data.text === "string" ? data.text : "",
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
        words: Number(data.words) || 0,
      };
    }
    return {
      ok: false,
      reason: res.status === 503 || res.status === 502 || res.status === 504 ? "offline" : "server_error",
      message: (data && (data.message || data.error)) || OFFLINE_MESSAGE,
    };
  }

  /**
   * Save the guide. `ifUpdatedAt` is the updatedAt the caller last read
   * (null when it saw none); pass undefined to skip the check. Resolves
   *   { ok: true, updatedAt, words, backup, unchanged }
   *   { ok: false, reason: "changed", updatedAt, message }   saved elsewhere since
   *   { ok: false, reason: "empty" | "binary" | "too_large" | "invalid_body", message }
   *   { ok: false, reason: "offline" | "server_error", message }
   */
  async function saveVoice(text, ifUpdatedAt) {
    var body = { text: String(text || "") };
    if (ifUpdatedAt !== undefined) body.ifUpdatedAt = ifUpdatedAt || null;
    var res;
    try {
      res = await apiFetch(profileUrl("/profile/voice"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (_) {
      return { ok: false, reason: "offline", message: OFFLINE_MESSAGE };
    }
    var data = await readJson(res);
    if (res.ok && data && data.ok === true) {
      return {
        ok: true,
        updatedAt: data.updatedAt || null,
        words: Number(data.words) || 0,
        backup: data.backup || null,
        unchanged: !!data.unchanged,
      };
    }
    var reason = data && typeof data.reason === "string" ? data.reason : "";
    if (res.status === 409 && reason === "changed") {
      return { ok: false, reason: "changed", updatedAt: data.updatedAt || null, message: data.message || "" };
    }
    if (reason === "empty" || reason === "binary" || reason === "too_large" || reason === "invalid_body") {
      return { ok: false, reason: reason, message: problemMessage(reason) };
    }
    return {
      ok: false,
      reason: res.status === 503 || res.status === 502 || res.status === 504 ? "offline" : "server_error",
      message: (data && (data.message || data.detail || data.error)) || "Save failed (HTTP " + res.status + ").",
    };
  }

  /** Remove the guide (the server keeps a backup). */
  async function removeVoice() {
    var res;
    try {
      res = await apiFetch(profileUrl("/profile/voice"), { method: "DELETE" });
    } catch (_) {
      return { ok: false, reason: "offline", message: OFFLINE_MESSAGE };
    }
    var data = await readJson(res);
    if (res.ok && data && data.ok === true) return { ok: true, backup: data.backup || null };
    if (res.status === 404) return { ok: true, backup: null, missing: true };
    return {
      ok: false,
      reason: "server_error",
      message: (data && (data.message || data.detail || data.error)) || "Remove failed (HTTP " + res.status + ").",
    };
  }

  // ---------------------------------------------------------------
  // Words the user reads
  // ---------------------------------------------------------------

  function maxKb() {
    var lib = shared();
    return Math.round((lib ? lib.MAX_VOICE_BYTES : 65536) / 1024);
  }

  function problemMessage(code) {
    if (code === "empty") return "Paste or upload your voice guide first.";
    if (code === "binary") {
      return "That doesn't look like text. Save the guide as Markdown (.md) or plain text (.txt) and try again.";
    }
    if (code === "too_large") {
      return "That guide is over " + maxKb() + " KB. A guide works best at a page or two — trim it and try again.";
    }
    return "JobBored couldn't read that guide. Paste it as Markdown or plain text.";
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  /** "Sep 27, 2026" in the reader's locale; "" for a bad date. */
  function formatDate(iso) {
    var date = iso ? new Date(iso) : null;
    if (!date || isNaN(date.getTime())) return "";
    try {
      return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  // ---------------------------------------------------------------
  // Clipboard and files
  // ---------------------------------------------------------------

  /**
   * Copy `text`. Tries the clipboard API, then selects the text in
   * `selectTarget` (a read-only textarea showing it) and tries the legacy
   * copy command. Resolves "copied" or "selected" (the text is selected
   * and the user can press Ctrl+C / ⌘C).
   */
  async function copyText(text, selectTarget) {
    var value = String(text || "");
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(value);
        return "copied";
      }
    } catch (_) {
      // Blocked (permissions, an insecure origin): fall through.
    }
    if (selectTarget) {
      try {
        selectTarget.focus();
        selectTarget.select();
        selectTarget.setSelectionRange(0, value.length);
        if (typeof document.execCommand === "function" && document.execCommand("copy")) {
          return "copied";
        }
      } catch (_) {
        // The selection stays; the user copies it by hand.
      }
    }
    return "selected";
  }

  function copyMessage(outcome) {
    return outcome === "copied"
      ? "Copied. Paste it into ChatGPT, Claude or Gemini."
      : "Your browser didn't let JobBored copy. The prompt is selected — press Ctrl+C (⌘C on a Mac) to copy it.";
  }

  /**
   * Read a .md / .txt file the user picked. Resolves
   * { ok: true, text, name } or { ok: false, message }.
   */
  function readTextFile(file) {
    return new Promise(function (resolve) {
      if (!file) {
        resolve({ ok: false, message: "No file was picked." });
        return;
      }
      var name = String(file.name || "");
      var type = String(file.type || "");
      if (!FILE_EXTENSIONS.test(name) && type !== "text/plain" && type !== "text/markdown") {
        resolve({
          ok: false,
          message: "Pick a Markdown (.md) or plain text (.txt) file. For a Word or PDF file, copy its text and paste it instead.",
        });
        return;
      }
      var lib = shared();
      var limit = lib ? lib.MAX_VOICE_BYTES : 65536;
      if (typeof file.size === "number" && file.size > limit) {
        resolve({ ok: false, message: problemMessage("too_large") });
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var text = typeof reader.result === "string" ? reader.result : "";
        var problem = lib ? lib.voiceProblem(text) : "";
        if (problem) {
          resolve({ ok: false, message: problem === "empty" ? "That file is empty." : problemMessage(problem) });
          return;
        }
        resolve({ ok: true, text: lib ? lib.normalizeVoiceText(text) : text, name: name });
      };
      reader.onerror = function () {
        resolve({ ok: false, message: "JobBored couldn't read that file. Try again, or paste the text instead." });
      };
      reader.readAsText(file);
    });
  }

  /** A hidden file input and the button that opens it. */
  function filePicker(label, onFile) {
    var input = el("input", "jb-voice__file");
    input.type = "file";
    input.accept = FILE_ACCEPT;
    input.hidden = true;
    input.setAttribute("aria-hidden", "true");
    input.tabIndex = -1;
    var trigger = button("jb-voice__upload", label, "ghost");
    trigger.addEventListener("click", function () {
      input.value = "";
      input.click();
    });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (file) onFile(file);
    });
    return { input: input, button: trigger };
  }

  // ---------------------------------------------------------------
  // The prompt box
  // ---------------------------------------------------------------

  /**
   * The chatbot prompt, read-only, with a Copy button and a status line.
   * options.onStatus(message) is told what happened; otherwise the box's
   * own status line says it.
   */
  function renderPromptBox(container, options) {
    var opts = options || {};
    var lib = shared();
    var prompt = lib ? lib.VOICE_GUIDE_PROMPT : "";
    var root = el("div", "jb-voice__prompt");
    var labelRow = el("div", "jb-voice__prompt-head");
    var label = el("label", "jb-voice__label", opts.label || "The prompt");
    var box = el("textarea", "jb-voice__prompt-text");
    box.id = nextId("prompt");
    label.htmlFor = box.id;
    box.readOnly = true;
    box.rows = opts.rows || 8;
    box.spellcheck = false;
    box.value = prompt;
    var copy = button("jb-voice__copy", opts.copyLabel || "Copy the prompt", opts.copyVariant || "primary");
    labelRow.append(label, copy);
    var status = el("p", "jb-voice__prompt-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    root.append(labelRow, box, status);
    copy.addEventListener("click", async function () {
      var outcome = await copyText(prompt, box);
      var message = copyMessage(outcome);
      status.textContent = message;
      status.dataset.kind = outcome === "copied" ? "ok" : "info";
      status.hidden = false;
      if (typeof opts.onCopy === "function") opts.onCopy(outcome);
    });
    container.appendChild(root);
    return { root: root, box: box, copy: copy, status: status };
  }

  // ---------------------------------------------------------------
  // The guide field + live preview
  // ---------------------------------------------------------------

  function renderPreview(node, analysis) {
    while (node.firstChild) node.removeChild(node.firstChild);
    if (!analysis || analysis.empty) {
      node.appendChild(el("p", "jb-voice__preview-empty", "Your guide's word count and sections show up here."));
      node.dataset.state = "empty";
      return;
    }
    var headings = analysis.headings || [];
    node.dataset.state = analysis.missing.length ? "missing" : "ok";
    node.appendChild(
      el(
        "p",
        "jb-voice__count",
        plural(analysis.words, "word", "words") + " · " + plural(headings.length, "section", "sections") + " found",
      ),
    );
    if (headings.length) {
      var list = el("ul", "jb-voice__headings");
      list.setAttribute("aria-label", "Sections found in your guide");
      headings.slice(0, 16).forEach(function (h) {
        var found = analysis.found.some(function (key) {
          return h.text.toLowerCase().indexOf(key.replace(/-/g, " ")) !== -1;
        });
        var item = el("li", "jb-voice__heading" + (found ? " jb-voice__heading--key" : ""), h.text);
        list.appendChild(item);
      });
      if (headings.length > 16) list.appendChild(el("li", "jb-voice__heading jb-voice__heading--more", "+" + (headings.length - 16) + " more"));
      node.appendChild(list);
    }
    if (analysis.tooLarge) {
      node.appendChild(el("p", "jb-voice__warn", problemMessage("too_large")));
    } else if (analysis.binary) {
      node.appendChild(el("p", "jb-voice__warn", problemMessage("binary")));
    }
    analysis.missing.forEach(function (section) {
      node.appendChild(
        el(
          "p",
          "jb-voice__warn jb-voice__warn--section",
          "No “" + section.label + "” section yet. It's where " + section.why + " go — worth adding, but you can save without it.",
        ),
      );
    });
  }

  /**
   * The guide textarea with its live preview.
   *
   * options:
   *   value        initial text
   *   label        the field's label
   *   placeholder
   *   onChange(text) after any edit (typing, paste, setText)
   * Returns { root, textarea, getText(), setText(text), analysis() }.
   */
  function renderGuideField(container, options) {
    var opts = options || {};
    var lib = shared();
    var root = el("div", "jb-voice__field");
    var label = el("label", "jb-voice__label", opts.label || "Your voice guide");
    var area = el("textarea", "jb-voice__guide");
    area.id = nextId("guide");
    label.htmlFor = area.id;
    area.rows = opts.rows || 10;
    area.spellcheck = true;
    area.placeholder = opts.placeholder || "# Voice guide — Your name\n## Voice summary\n…";
    area.value = String(opts.value || "");
    var hint = el(
      "p",
      "jb-voice__hint",
      "Markdown or plain text, up to " + maxKb() + " KB. It stays on this computer.",
    );
    hint.id = nextId("hint");
    area.setAttribute("aria-describedby", hint.id);
    var preview = el("div", "jb-voice__preview");
    preview.setAttribute("aria-live", "polite");
    root.append(label, area, hint, preview);
    container.appendChild(root);

    var timer = null;
    function analyze() {
      return lib ? lib.analyzeVoiceGuide(area.value) : null;
    }
    function refresh() {
      timer = null;
      renderPreview(preview, analyze());
    }
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, PREVIEW_DELAY_MS);
    }
    area.addEventListener("input", function () {
      schedule();
      if (typeof opts.onChange === "function") opts.onChange(area.value);
    });
    refresh();

    return {
      root: root,
      textarea: area,
      preview: preview,
      getText: function () {
        return area.value;
      },
      setText: function (text) {
        area.value = String(text || "");
        refresh();
        if (typeof opts.onChange === "function") opts.onChange(area.value);
      },
      analysis: analyze,
    };
  }

  // ---------------------------------------------------------------
  // Settings → Fit Profile → "Your voice"
  // ---------------------------------------------------------------

  /**
   * Mount the Settings section into `slot` (fit-profile-editor.js leaves
   * #profileVoiceSlot beside "Your details"): status, View / edit,
   * Replace from a file, Copy the prompt, Remove with an in-page confirm.
   */
  function mountSettings(slot) {
    if (!slot) return null;
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    var current = { exists: false, text: "", updatedAt: null, words: 0, loaded: false };

    var section = el("section", "jb-voice-settings");
    section.id = "settingsYourVoice";
    var title = el("h4", "jb-voice-settings__title", "Your voice");
    title.id = nextId("settings-title");
    section.setAttribute("aria-labelledby", title.id);
    var summary = el("p", "jb-voice-settings__summary", "Checking…");
    summary.id = "profileVoiceSummary";
    var head = el("div", "jb-voice-settings__head");
    var heading = el("div", "jb-voice-settings__heading");
    heading.append(title, summary);
    head.appendChild(heading);
    section.appendChild(head);
    section.appendChild(
      el(
        "p",
        "jb-voice-settings__lede",
        "A short guide to how you write. Drafts follow it, so your cover letters and notes sound like you, not like a machine.",
      ),
    );

    var tools = el("div", "jb-voice-settings__tools");
    var editBtn = button("jb-voice-settings__edit", "View / edit", "ghost");
    editBtn.id = "profileVoiceEditBtn";
    editBtn.setAttribute("aria-expanded", "false");
    var picker = filePicker("Replace from a file", onFile);
    picker.button.id = "profileVoiceReplaceBtn";
    var copyBtn = button("jb-voice-settings__copy", "Copy the prompt", "ghost");
    copyBtn.id = "profileVoiceCopyBtn";
    var removeBtn = button("jb-voice-settings__remove", "Remove", "ghost");
    removeBtn.id = "profileVoiceRemoveBtn";
    tools.append(editBtn, picker.button, copyBtn, removeBtn, picker.input);
    section.appendChild(tools);

    // The prompt, for the select-by-hand fallback and for reading it first.
    var promptWrap = el("details", "jb-voice-settings__prompt");
    promptWrap.appendChild(el("summary", "jb-voice-settings__prompt-summary", "See the prompt"));
    promptWrap.appendChild(
      el(
        "p",
        "jb-voice-settings__steps",
        "Paste it into ChatGPT, Claude or Gemini, answer its questions, then paste the guide it writes into View / edit.",
      ),
    );
    var promptBox = renderPromptBox(promptWrap, { label: "Voice guide prompt", rows: 8, copyVariant: "ghost" });
    promptBox.copy.hidden = true;
    section.appendChild(promptWrap);

    var confirm = el("div", "jb-voice-settings__confirm");
    confirm.setAttribute("role", "group");
    confirm.hidden = true;
    var confirmText = el(
      "p",
      "jb-voice-settings__confirm-text",
      "Remove your voice guide? Drafts stop following it. JobBored keeps a backup copy on this computer.",
    );
    confirmText.id = nextId("confirm");
    confirm.setAttribute("aria-labelledby", confirmText.id);
    var confirmYes = button("jb-voice-settings__confirm-yes", "Remove it", "primary");
    confirmYes.id = "profileVoiceConfirmRemoveBtn";
    var confirmNo = button("jb-voice-settings__confirm-no", "Keep it", "ghost");
    var confirmRow = el("div", "jb-voice-settings__confirm-row");
    confirmRow.append(confirmYes, confirmNo);
    confirm.append(confirmText, confirmRow);
    section.appendChild(confirm);

    var editor = el("div", "jb-voice-settings__editor");
    editor.id = nextId("editor");
    editor.hidden = true;
    editBtn.setAttribute("aria-controls", editor.id);
    var field = renderGuideField(editor, {
      label: "Your voice guide",
      rows: 14,
      onChange: function () {
        setStatus("Unsaved changes.", "info");
      },
    });
    var editorFoot = el("div", "jb-voice-settings__editor-foot");
    var cancelBtn = button("jb-voice-settings__cancel", "Cancel", "ghost");
    var saveBtn = button("jb-voice-settings__save", "Save guide", "primary");
    saveBtn.id = "profileVoiceSaveBtn";
    editorFoot.append(cancelBtn, saveBtn);
    editor.appendChild(editorFoot);
    section.appendChild(editor);

    var status = el("p", "jb-voice-settings__status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    section.appendChild(status);
    slot.appendChild(section);

    function setStatus(message, kind) {
      status.textContent = message || "";
      if (message) status.dataset.kind = kind || "info";
      else delete status.dataset.kind;
    }

    function paintSummary() {
      if (!current.loaded) return;
      section.dataset.voice = current.exists ? "set" : "unset";
      if (current.exists) {
        var date = formatDate(current.updatedAt);
        summary.textContent = (date ? "Saved " + date + " · " : "Saved · ") + plural(current.words, "word", "words");
      } else {
        summary.textContent = "Not set yet";
      }
      removeBtn.hidden = !current.exists;
      editBtn.textContent = current.exists ? "View / edit" : "Write or paste one";
    }

    function openEditor(text) {
      field.setText(text);
      editor.hidden = false;
      editBtn.setAttribute("aria-expanded", "true");
      field.textarea.focus();
    }

    function closeEditor() {
      editor.hidden = true;
      editBtn.setAttribute("aria-expanded", "false");
    }

    async function load() {
      var result = await fetchVoice();
      if (!result.ok) {
        summary.textContent = "Couldn't check";
        setStatus(result.message, "error");
        return false;
      }
      current.exists = result.exists;
      current.text = result.text;
      current.updatedAt = result.updatedAt;
      current.words = result.words;
      current.loaded = true;
      paintSummary();
      return true;
    }

    editBtn.addEventListener("click", function () {
      if (!editor.hidden) {
        closeEditor();
        return;
      }
      openEditor(current.text);
      setStatus("", "");
    });

    cancelBtn.addEventListener("click", function () {
      closeEditor();
      setStatus("", "");
      editBtn.focus();
    });

    async function onFile(file) {
      var read = await readTextFile(file);
      if (!read.ok) {
        setStatus(read.message, "error");
        return;
      }
      openEditor(read.text);
      setStatus("Loaded " + read.name + ". Check it, then save to replace your guide.", "info");
    }

    copyBtn.addEventListener("click", async function () {
      var prompt = promptBox.box.value;
      var outcome = await copyText(prompt, null);
      if (outcome !== "copied") {
        // Show the prompt and select it: the legacy copy, or Ctrl+C by hand.
        promptWrap.open = true;
        outcome = await copyText(prompt, promptBox.box);
      }
      setStatus(copyMessage(outcome), outcome === "copied" ? "ok" : "info");
    });

    saveBtn.addEventListener("click", async function () {
      var lib = shared();
      var text = field.getText();
      var problem = lib ? lib.voiceProblem(text) : "";
      if (problem) {
        setStatus(problemMessage(problem), "error");
        field.textarea.focus();
        return;
      }
      saveBtn.disabled = true;
      setStatus("Saving…", "info");
      var result = await saveVoice(text, current.loaded ? current.updatedAt : undefined);
      saveBtn.disabled = false;
      if (result.ok) {
        current.exists = true;
        current.text = lib ? lib.normalizeVoiceText(text) + "\n" : text;
        current.updatedAt = result.updatedAt;
        current.words = result.words;
        current.loaded = true;
        paintSummary();
        closeEditor();
        setStatus(
          result.unchanged
            ? "No changes to save."
            : result.backup
              ? "Saved. New drafts will follow it. Your previous guide is kept as a backup."
              : "Saved. New drafts will follow it.",
          "ok",
        );
        editBtn.focus();
        return;
      }
      if (result.reason === "changed") {
        // Saved somewhere else since this opened: say so, keep the edits,
        // and let the next Save replace it knowingly (with a backup).
        current.updatedAt = result.updatedAt;
        current.exists = !!result.updatedAt;
        setStatus(
          "Your voice guide was changed somewhere else since this opened. Your edits are still here — save again to replace it (the other version is kept as a backup).",
          "error",
        );
        return;
      }
      setStatus(result.message, "error");
    });

    removeBtn.addEventListener("click", function () {
      confirm.hidden = false;
      confirmNo.focus();
    });

    function closeConfirm() {
      confirm.hidden = true;
      removeBtn.focus();
    }

    confirmNo.addEventListener("click", closeConfirm);
    confirm.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeConfirm();
      }
    });

    confirmYes.addEventListener("click", async function () {
      confirmYes.disabled = true;
      var result = await removeVoice();
      confirmYes.disabled = false;
      confirm.hidden = true;
      if (!result.ok) {
        setStatus(result.message, "error");
        removeBtn.focus();
        return;
      }
      current.exists = false;
      current.text = "";
      current.updatedAt = null;
      current.words = 0;
      current.loaded = true;
      closeEditor();
      paintSummary();
      setStatus("Removed. Drafts no longer follow a voice guide. A backup copy stays on this computer.", "ok");
      editBtn.focus();
    });

    load();
    return { section: section, reload: load };
  }

  window.JobBoredProfileVoice = {
    FILE_ACCEPT: FILE_ACCEPT,
    fetchVoice: fetchVoice,
    saveVoice: saveVoice,
    removeVoice: removeVoice,
    copyText: copyText,
    copyMessage: copyMessage,
    readTextFile: readTextFile,
    filePicker: filePicker,
    problemMessage: problemMessage,
    formatDate: formatDate,
    renderPromptBox: renderPromptBox,
    renderGuideField: renderGuideField,
    renderPreview: renderPreview,
    mountSettings: mountSettings,
  };
})();
