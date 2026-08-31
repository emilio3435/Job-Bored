/* ============================================================
   jb-a11y.js — JobBored shared accessibility primitives (T0 / P0-F)

   window.JobBoredA11y = { dialog, drawer, live, toast, tabs, field, stageMenu }

   Contract doc: JB-A11Y.md (sibling of JB-UI.md). The API surface is LOCKED by
   T0-SUBSTRATE.md §2 — five other lanes code against it. Additions are allowed;
   reshapes are not.

   THREE RULES THIS FILE LIVES BY
   1. Classic-global IIFE, NOT an ES module. This file is loaded by index.html
      as a plain `defer` script. A single top-level `export` makes the browser
      parse-fail the WHOLE file silently (jb-ui.js:472-474 carries the same
      warning). Attach to window.JobBoredA11y like every neighbour does.
   2. NOT scoped to body.jb-v2. jb-ui.css gates its components behind the v2
      flag with a `body:not(.jb-v2) { display: none }` kill-switch. These
      primitives serve the LEGACY view too — the settings modal, the first-run
      wizard, the fit-profile wizard all render without the v2 class, and that
      is the user path the a11y audit actually walked.
   3. No state, no I/O, no writes. Every mutation is an INJECTED callback
      (stageMenu's commitMove) and every host lookup is lazy, resolved at call
      time. bridge-registry.js assigns window.JobBoredApp.core.host at runtime;
      jb-a11y.js loads early, so a load-time host() read would break cold start
      (tests/index-html-cold-start.test.mjs pins boot).

   Internals lifted from the audited settings-modal.js focus block (:38-67,
   :522-631) — opener capture before the menu closes, body-children inert,
   Escape-to-close, focus restore with { preventScroll: true } — plus the three
   stack fixes the audit demanded: re-scan on every open (so a dialog appended
   later is still covered), inert the PARENT dialog when stacking, and repair
   the stack on an interleaved (out-of-order) close.
   ============================================================ */
(function () {
  "use strict";

  /** Lazily resolve the app host bridge. Never called at load time. */
  function host() {
    var app = typeof window !== "undefined" ? window.JobBoredApp : null;
    return (app && app.core && app.core.host) || null;
  }

  var uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return "jb-a11y-" + prefix + "-" + uidCounter;
  }

  // Dispatched on BOTH window and document, per the convention AGENT_CONTRACT.md
  // states for every jb:* event family.
  function emit(type, detail) {
    try {
      var event = new CustomEvent(type, { detail: detail });
      document.dispatchEvent(event);
      if (typeof window !== "undefined" && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent(type, { detail: detail }));
      }
    } catch (err) {
      /* observability only — never break a caller over an event */
    }
  }

  /** Best-effort focus, always with preventScroll (settings-modal.js:617-630). */
  function focusEl(node) {
    if (!node || typeof node.focus !== "function") return false;
    try {
      node.focus({ preventScroll: true });
      return true;
    } catch (err) {
      return false;
    }
  }

  function isFocusable(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.disabled === true || node.hidden === true || node.inert === true) {
      return false;
    }
    var tag = node.tagName;
    if (tag === "A") return node.hasAttribute("href");
    if (
      tag === "BUTTON" ||
      tag === "INPUT" ||
      tag === "SELECT" ||
      tag === "TEXTAREA"
    ) {
      return true;
    }
    var ti = node.getAttribute("tabindex");
    return ti !== null && Number(ti) >= 0;
  }

  /** First focusable descendant in document order, or null. */
  function firstFocusable(root) {
    if (!root) return null;
    var found = null;
    (function visit(node) {
      var kids = node.children || [];
      for (var i = 0; i < kids.length && !found; i++) {
        if (isFocusable(kids[i])) {
          found = kids[i];
          return;
        }
        visit(kids[i]);
      }
    })(root);
    return found;
  }

  /** True when the element already carries an accessible name. */
  function hasAccessibleName(el) {
    return (
      el.hasAttribute("aria-label") ||
      el.hasAttribute("aria-labelledby") ||
      el.hasAttribute("title")
    );
  }

  /* ============================================================
     live — two singleton visually-hidden regions
     Markup recipe promoted from lattice.js buildLive (:693-706).
     ============================================================ */

  var ANNOUNCE_DEBOUNCE_MS = 150;
  var liveRegions = { polite: null, assertive: null };
  var lastAnnouncement = { text: "", at: 0 };

  function ensureLiveRegion(kind) {
    var existing = liveRegions[kind];
    if (existing && document.contains(existing)) return existing;
    var node = document.createElement("div");
    node.className = "jb-a11y-visually-hidden";
    node.setAttribute("data-jb-a11y-live", kind);
    node.setAttribute("role", kind === "assertive" ? "alert" : "status");
    node.setAttribute("aria-live", kind);
    node.setAttribute("aria-atomic", "true");
    var mount = document.body || document.documentElement;
    if (!mount) return null;
    mount.appendChild(node);
    liveRegions[kind] = node;
    return node;
  }

  /**
   * Announce a message to assistive technology.
   * @param {string} message
   * @param {{assertive?: boolean}} [opts]
   */
  function announce(message, opts) {
    if (typeof message !== "string") return;
    var text = message.trim();
    if (!text) return;
    var now = Date.now();
    // Identical repeats inside the debounce window are dropped: a burst of
    // retried writes would otherwise read the same sentence three times.
    if (
      text === lastAnnouncement.text &&
      now - lastAnnouncement.at < ANNOUNCE_DEBOUNCE_MS
    ) {
      return;
    }
    lastAnnouncement = { text: text, at: now };
    var region = ensureLiveRegion(
      opts && opts.assertive === true ? "assertive" : "polite",
    );
    if (region) region.textContent = text;
  }

  /* ============================================================
     toast — announce always, render when the host bridge exists
     ============================================================ */

  /**
   * @param {string} message
   * @param {string} [type] success | error | info | warning
   * @param {{persistent?: boolean, action?: {label: string, onClick: Function}}} [opts]
   * @returns {Function} dismiss
   */
  function toast(message, type, opts) {
    var o = opts || {};
    var kind = String(type || "success");
    // The announcement is the part that must never depend on the bridge —
    // #toastContainer has no aria-live, so this IS the accessible channel.
    announce(message, { assertive: kind === "error" });
    var bridge = host();
    if (bridge && typeof bridge.showToast === "function") {
      try {
        var dismiss = bridge.showToast(
          message,
          kind,
          o.persistent === true,
          o.action,
        );
        if (typeof dismiss === "function") return dismiss;
      } catch (err) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[JobBored] a11y toast render failed:", err);
        }
      }
    }
    return function noopDismiss() {};
  }

  /* ============================================================
     dialog / drawer — LIFO stack with re-scanned inert
     ============================================================ */

  /** @type {Array<{el: Element, opener: Element|null, onClose: Function|null,
   *                drawer: boolean, closed: boolean}>} */
  var stack = [];
  /** Nodes THIS module set inert. Never includes nodes already inert. */
  var ownedInert = [];
  var escapeHandler = null;

  function releaseOwnedInert() {
    while (ownedInert.length) {
      var node = ownedInert.pop();
      if (node) node.inert = false;
    }
  }

  /**
   * Inert everything except the ancestor path of `el`. Walking up from the
   * dialog (rather than only inerting body children, as settings-modal.js did)
   * keeps a dialog that lives inside a wrapper correctly contained.
   */
  function applyInert(el) {
    var claimed = [];
    var node = el;
    var body = document.body;
    while (node && node.parentNode && node !== body) {
      var siblings = node.parentNode.children || [];
      for (var i = 0; i < siblings.length; i++) {
        var sib = siblings[i];
        if (sib === node) continue;
        if (sib.inert === true) continue; // someone else owns this one
        sib.inert = true;
        claimed.push(sib);
      }
      node = node.parentNode;
    }
    return claimed;
  }

  /**
   * Recompute inert for the whole stack. Called on every open and close, which
   * is what makes late-appended dialogs and out-of-order closes correct: the
   * background is always derived from the CURRENT top of the stack rather than
   * from a snapshot taken when some earlier dialog opened.
   */
  function syncInert() {
    releaseOwnedInert();
    if (!stack.length) return;
    ownedInert = applyInert(stack[stack.length - 1].el);
  }

  function onDocumentKeydown(event) {
    if (!event || event.key !== "Escape") return;
    if (!stack.length) return;
    closeEntry(stack[stack.length - 1], "escape");
  }

  function syncEscapeHandler() {
    if (stack.length && !escapeHandler) {
      escapeHandler = onDocumentKeydown;
      document.addEventListener("keydown", escapeHandler);
    } else if (!stack.length && escapeHandler) {
      document.removeEventListener("keydown", escapeHandler);
      escapeHandler = null;
    }
  }

  function closeEntry(entry, reason) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    var depth = stack.indexOf(entry) + 1;
    var index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);

    if (entry.drawer && document.body && document.body.classList) {
      document.body.classList.remove("detail-open");
    }

    syncInert();
    syncEscapeHandler();

    // Restore focus only when the user is still inside the dialog we are
    // closing (or nowhere). Closing a BACKGROUND dialog must not yank focus
    // out of the dialog the user is actually working in.
    var active = document.activeElement;
    var focusIsOurs =
      !active ||
      active === document.body ||
      (typeof entry.el.contains === "function" && entry.el.contains(active));
    if (
      focusIsOurs &&
      entry.opener &&
      typeof document.contains === "function" &&
      document.contains(entry.opener)
    ) {
      focusEl(entry.opener);
    }

    var normalizedReason = reason === "escape" ? "escape" : "programmatic";
    emit("jb:a11y:dialog:closed", {
      el: entry.el,
      depth: depth,
      reason: normalizedReason,
    });
    if (typeof entry.onClose === "function") {
      try {
        entry.onClose(normalizedReason);
      } catch (err) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[JobBored] a11y dialog onClose threw:", err);
        }
      }
    }
  }

  /**
   * Open `el` as a modal dialog.
   *
   * The element must ALREADY be visible when this is called — focus() is a
   * no-op on a `display: none` node. Callers flip their own visibility (a
   * class, a style, a data-attribute) and then call open().
   *
   * @param {Element} el
   * @param {{opener?: Element, initialFocus?: Element|string, label?: string,
   *          onClose?: (reason: 'escape'|'programmatic') => void}} [opts]
   * @returns {{close: (reason?: string) => void, el: Element}}
   */
  function openDialog(el, opts, isDrawer) {
    var o = opts || {};
    if (!el) {
      return { close: function () {}, el: el };
    }

    if (!el.hasAttribute("role")) el.setAttribute("role", "dialog");
    if (!el.hasAttribute("aria-modal")) el.setAttribute("aria-modal", "true");
    if (o.label && !hasAccessibleName(el)) {
      el.setAttribute("aria-label", String(o.label));
    }

    // Capture the opener BEFORE anything shifts focus — menus that close on the
    // way into a dialog dump activeElement onto <body> (settings-modal.js:522-528).
    var opener =
      o.opener ||
      (document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : null);

    var entry = {
      el: el,
      opener: opener,
      onClose: typeof o.onClose === "function" ? o.onClose : null,
      drawer: isDrawer === true,
      closed: false,
    };
    stack.push(entry);

    if (entry.drawer && document.body && document.body.classList) {
      document.body.classList.add("detail-open");
    }

    syncInert();
    syncEscapeHandler();

    var target = null;
    if (o.initialFocus) {
      target =
        typeof o.initialFocus === "string"
          ? el.querySelector(o.initialFocus)
          : o.initialFocus;
    }
    if (!target) target = firstFocusable(el);
    if (!target) {
      // Nothing focusable inside: make the dialog itself the landing spot so
      // Tab starts here rather than at the top of the inert page behind it.
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      target = el;
    }
    focusEl(target);

    emit("jb:a11y:dialog:opened", { el: el, depth: stack.length });

    return {
      el: el,
      close: function (reason) {
        closeEntry(entry, reason);
      },
    };
  }

  /* ============================================================
     field — label/control association
     Option shape matches wizard-dom.js appendWizardInput (:92-126).
     ============================================================ */

  var LABELABLE = {
    INPUT: true,
    SELECT: true,
    TEXTAREA: true,
    BUTTON: true,
    METER: true,
    OUTPUT: true,
    PROGRESS: true,
  };

  /**
   * Give `labelEl` a programmatic relationship to `controlEl`.
   *
   * Labelable controls get the plain for/id pairing. Everything else — the chip
   * inputs, the radio groups, any composite widget — gets aria-labelledby plus
   * role=group instead, because `for=` pointed at a <div> is dead markup that
   * looks correct in review and announces nothing.
   */
  function associate(labelEl, controlEl) {
    if (!labelEl || !controlEl) return;
    if (LABELABLE[controlEl.tagName] === true) {
      if (!controlEl.id) controlEl.id = uid("field");
      labelEl.setAttribute("for", controlEl.id);
      return;
    }
    if (hasAccessibleName(controlEl)) return;
    if (!labelEl.id) labelEl.id = uid("label");
    controlEl.setAttribute("aria-labelledby", labelEl.id);
    if (!controlEl.hasAttribute("role")) {
      controlEl.setAttribute("role", "group");
    }
  }

  /**
   * Build a labeled field.
   * @param {{label: string, id?: string, hint?: string, multiline?: boolean,
   *          type?: string, value?: string, rows?: number, placeholder?: string,
   *          onInput?: (value: string) => void}} options
   * @returns {{wrap: Element, input: Element}}
   */
  function buildField(options) {
    var o = options && typeof options === "object" ? options : {};
    var wrap = document.createElement("div");
    wrap.className = "jb-a11y-field";

    var label = document.createElement("label");
    label.className = "jb-a11y-field__label";
    label.textContent = o.label || "";

    var input = document.createElement(
      o.multiline === true ? "textarea" : "input",
    );
    input.className = o.multiline === true
      ? "jb-a11y-field__control jb-a11y-field__control--multiline"
      : "jb-a11y-field__control";
    input.id = o.id || uid("field");
    if (o.multiline === true) {
      input.setAttribute("rows", String(o.rows || 3));
    } else {
      input.setAttribute("type", o.type || "text");
    }
    if (o.placeholder) input.setAttribute("placeholder", o.placeholder);
    input.value = o.value == null ? "" : String(o.value);

    associate(label, input);
    wrap.appendChild(label);
    wrap.appendChild(input);

    if (o.hint) {
      var hint = document.createElement("p");
      hint.className = "jb-a11y-field__hint";
      hint.id = uid("hint");
      hint.textContent = String(o.hint);
      // Programmatically attached, not just visually adjacent.
      input.setAttribute("aria-describedby", hint.id);
      wrap.appendChild(hint);
    }

    if (typeof o.onInput === "function") {
      input.addEventListener("input", function (event) {
        var target = event && event.target ? event.target : input;
        o.onInput(String(target.value == null ? "" : target.value));
      });
    }

    return { wrap: wrap, input: input };
  }

  /* ============================================================
     dialog.confirm — a built dialog with optional fields
     ============================================================ */

  /**
   * @param {{title: string, body?: string, confirmLabel?: string,
   *          cancelLabel?: string, fields?: Array<object>}} spec
   * @returns {Promise<{confirmed: boolean, values: Record<string, string>}>}
   */
  function confirmDialog(spec) {
    var s = spec && typeof spec === "object" ? spec : {};
    var root = document.createElement("div");
    root.className = "jb-a11y-dialog jb-a11y-dialog--confirm";
    var panel = document.createElement("div");
    panel.className = "jb-a11y-dialog__panel";
    root.appendChild(panel);

    var title = document.createElement("h2");
    title.className = "jb-a11y-dialog__title";
    title.id = uid("title");
    title.textContent = s.title || "";
    root.setAttribute("aria-labelledby", title.id);
    panel.appendChild(title);

    if (s.body) {
      var body = document.createElement("p");
      body.className = "jb-a11y-dialog__body";
      body.textContent = String(s.body);
      panel.appendChild(body);
    }

    var built = [];
    var specs = Array.isArray(s.fields) ? s.fields : [];
    for (var i = 0; i < specs.length; i++) {
      var fieldSpec = specs[i] || {};
      var field = buildField(fieldSpec);
      built.push({
        key: fieldSpec.id || fieldSpec.name || field.input.id,
        input: field.input,
      });
      panel.appendChild(field.wrap);
    }

    var actions = document.createElement("div");
    actions.className = "jb-a11y-dialog__actions";
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className =
      "jb-a11y-dialog__btn jb-a11y-dialog__btn--cancel jb-a11y-touch-target";
    cancelBtn.textContent = s.cancelLabel || "Cancel";
    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className =
      "jb-a11y-dialog__btn jb-a11y-dialog__btn--confirm jb-a11y-touch-target";
    confirmBtn.textContent = s.confirmLabel || "Confirm";
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    panel.appendChild(actions);

    (document.body || document.documentElement).appendChild(root);

    return new Promise(function (resolve) {
      var settled = false;
      function readValues() {
        var values = {};
        for (var j = 0; j < built.length; j++) {
          values[built[j].key] = String(
            built[j].input.value == null ? "" : built[j].input.value,
          );
        }
        return values;
      }
      function settle(confirmed) {
        if (settled) return;
        settled = true;
        var values = readValues();
        handle.close();
        if (root.parentNode) root.parentNode.removeChild(root);
        resolve({ confirmed: confirmed, values: values });
      }
      cancelBtn.addEventListener("click", function () {
        settle(false);
      });
      confirmBtn.addEventListener("click", function () {
        settle(true);
      });
      var handle = openDialog(
        root,
        {
          initialFocus: built.length ? built[0].input : confirmBtn,
          onClose: function () {
            // Escape (or a programmatic close) is a cancel, with whatever the
            // user had typed — never silently discarded, never treated as OK.
            if (settled) return;
            settled = true;
            var values = readValues();
            if (root.parentNode) root.parentNode.removeChild(root);
            resolve({ confirmed: false, values: values });
          },
        },
        false,
      );
    });
  }

  /* ============================================================
     tabs — WAI-ARIA tablist, generalized from settings-tabs.js (:44-133)
     ============================================================ */

  /**
   * @param {Element} root
   * @param {{tabs: Array<{id: string, buttonId: string, panelId: string}>,
   *          onChange?: (id: string) => void}} opts
   * @returns {{activate: (id: string) => void, getActive: () => string|null,
   *            destroy: () => void}}
   */
  function initTabs(root, opts) {
    var o = opts || {};
    var specs = Array.isArray(o.tabs) ? o.tabs : [];
    var activeId = null;
    var bound = [];

    function find(id) {
      if (!id) return null;
      return (root && root.querySelector("#" + id)) || document.getElementById(id);
    }

    function activate(id, silent) {
      var match = null;
      for (var i = 0; i < specs.length; i++) {
        if (specs[i].id === id) match = specs[i];
      }
      if (!match) return;
      for (var j = 0; j < specs.length; j++) {
        var btn = find(specs[j].buttonId);
        var panel = find(specs[j].panelId);
        var on = specs[j].id === id;
        if (btn) {
          btn.setAttribute("aria-selected", on ? "true" : "false");
          btn.setAttribute("tabindex", on ? "0" : "-1");
        }
        if (panel) panel.hidden = !on;
      }
      activeId = id;
      var activeBtn = find(match.buttonId);
      if (!silent && activeBtn) focusEl(activeBtn);
      if (typeof o.onChange === "function") o.onChange(id);
    }

    function onKeydown(event) {
      var order = specs.map(function (s) {
        return s.id;
      });
      var current = order.indexOf(activeId);
      if (current === -1) return;
      var next = -1;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (current + 1) % order.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (current - 1 + order.length) % order.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = order.length - 1;
      }
      if (next < 0) return;
      event.preventDefault();
      activate(order[next]);
    }

    for (var k = 0; k < specs.length; k++) {
      (function (spec) {
        var btn = find(spec.buttonId);
        if (!btn) return;
        var onClick = function () {
          activate(spec.id);
        };
        btn.setAttribute("role", "tab");
        btn.addEventListener("click", onClick);
        btn.addEventListener("keydown", onKeydown);
        var panel = find(spec.panelId);
        if (panel) {
          if (!panel.hasAttribute("role")) panel.setAttribute("role", "tabpanel");
          if (!panel.hasAttribute("aria-labelledby")) {
            panel.setAttribute("aria-labelledby", spec.buttonId);
          }
        }
        bound.push({ btn: btn, onClick: onClick });
      })(specs[k]);
    }

    if (specs.length) activate(specs[0].id, true);

    return {
      activate: function (id) {
        activate(id);
      },
      getActive: function () {
        return activeId;
      },
      destroy: function () {
        for (var i = 0; i < bound.length; i++) {
          bound[i].btn.removeEventListener("click", bound[i].onClick);
          bound[i].btn.removeEventListener("keydown", onKeydown);
        }
        bound = [];
      },
    };
  }

  /* ============================================================
     stageMenu — the explicit, labeled, touch-operable stage move
     ============================================================ */

  // tokens-v2.css names the stage rails; the only place the token name diverges
  // from the stage vocabulary is the two-word stage.
  var STAGE_TOKEN_ALIAS = { "phone-screen": "phone" };
  var STAGE_TOKENS = {
    new: true,
    researching: true,
    applied: true,
    phone: true,
    interviewing: true,
    offer: true,
    rejected: true,
    passed: true,
    expired: true,
  };

  function stageToken(key) {
    var slug = String(key || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (STAGE_TOKEN_ALIAS[slug]) slug = STAGE_TOKEN_ALIAS[slug];
    // An unrecognised stage renders NEUTRAL rather than borrowing some other
    // stage's colour: unknown must never be shown as a confident value.
    return STAGE_TOKENS[slug] === true
      ? "var(--jb-stage-" + slug + ")"
      : "var(--jb-ink-3)";
  }

  /**
   * Attach a visible "Move to stage" control to a card.
   *
   * commitMove is INJECTED and is the ONLY write path. This primitive never
   * calls updateJobStatus, never mutates job.status, never reads pipeline data.
   * With no commitMove supplied it renders nothing at all — a dead control that
   * silently does nothing is worse than no control.
   *
   * @param {Element} cardEl
   * @param {{stages: Array<{key: string, label: string}>, current: string,
   *          jobKey: string, getLabel?: (key: string) => string,
   *          commitMove: (jobKey: string, toStage: string, fromStage: string)
   *            => Promise<boolean>}} opts
   * @returns {Function} detach
   */
  function attachStageMenu(cardEl, opts) {
    var o = opts || {};
    var noop = function () {};
    if (!cardEl || typeof o.commitMove !== "function") return noop;

    var stages = Array.isArray(o.stages) ? o.stages : [];
    if (!stages.length) return noop;

    // Idempotent per card: lattice re-renders constantly, and a duplicated
    // trigger would double every keyboard path.
    var previous = cardEl.querySelector(".jb-a11y-stage-menu");
    if (previous && previous.parentNode) previous.parentNode.removeChild(previous);

    var current = o.current;
    var open = false;

    function labelFor(key) {
      if (typeof o.getLabel === "function") return String(o.getLabel(key));
      for (var i = 0; i < stages.length; i++) {
        if (stages[i].key === key) return String(stages[i].label || key);
      }
      return String(key);
    }

    var wrap = document.createElement("div");
    wrap.className = "jb-a11y-stage-menu";

    var menu = document.createElement("div");
    menu.className = "jb-a11y-stage-menu__list";
    menu.id = uid("menu");
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "jb-a11y-stage-menu__trigger jb-a11y-touch-target";
    trigger.setAttribute("data-action", "move-to-stage");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", menu.id);
    trigger.textContent = "Move to stage";

    function syncTriggerName() {
      trigger.setAttribute(
        "aria-label",
        "Move to stage — currently " + labelFor(current),
      );
      trigger.setAttribute("data-current-stage", String(current));
    }
    syncTriggerName();

    /** @type {Element[]} */
    var items = [];

    function renderItems() {
      while (menu.children.length) menu.removeChild(menu.children[0]);
      items = [];
      for (var i = 0; i < stages.length; i++) {
        if (stages[i].key === current) continue;
        var item = document.createElement("button");
        item.type = "button";
        item.className = "jb-a11y-stage-menu__item jb-a11y-touch-target";
        item.setAttribute("role", "menuitem");
        item.setAttribute("data-stage", String(stages[i].key));
        item.setAttribute("tabindex", "-1");
        item.style.setProperty(
          "--jb-a11y-stage-color",
          stageToken(stages[i].key),
        );
        item.textContent = labelFor(stages[i].key);
        item.addEventListener("click", onItemClick);
        item.addEventListener("keydown", onItemKeydown);
        menu.appendChild(item);
        items.push(item);
      }
      if (items.length) items[0].setAttribute("tabindex", "0");
    }

    function focusItem(index) {
      if (!items.length) return;
      var wrapped = (index + items.length) % items.length;
      for (var i = 0; i < items.length; i++) {
        items[i].setAttribute("tabindex", i === wrapped ? "0" : "-1");
      }
      focusEl(items[wrapped]);
    }

    function setOpen(next) {
      open = next === true;
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function closeMenu(restoreFocus) {
      if (!open) return;
      setOpen(false);
      if (restoreFocus) focusEl(trigger);
    }

    function onTriggerClick() {
      if (open) {
        closeMenu(true);
        return;
      }
      setOpen(true);
      focusItem(0);
    }

    function onItemKeydown(event) {
      var index = items.indexOf(event.currentTarget || event.target);
      if (index < 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusItem(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusItem(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusItem(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusItem(items.length - 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    }

    function onItemClick(event) {
      var item = event.currentTarget || event.target;
      var toStage = item.getAttribute("data-stage");
      if (!toStage) return;
      var fromStage = current;
      closeMenu(true);

      // Optimistic announce, then revert copy on failure — the same contract
      // lattice.js handleStageChange (:926-951) already implements locally.
      announce("Moved to " + labelFor(toStage));
      var pending;
      try {
        pending = o.commitMove(o.jobKey, toStage, fromStage);
      } catch (err) {
        pending = Promise.reject(err);
      }
      Promise.resolve(pending).then(
        function (ok) {
          if (ok) {
            current = toStage;
            syncTriggerName();
            renderItems();
            return;
          }
          revert(fromStage);
        },
        function () {
          revert(fromStage);
        },
      );
    }

    function revert(fromStage) {
      current = fromStage;
      syncTriggerName();
      renderItems();
      announce("Move failed; reverted to " + labelFor(fromStage), {
        assertive: true,
      });
    }

    trigger.addEventListener("click", onTriggerClick);
    renderItems();
    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    cardEl.appendChild(wrap);

    return function detach() {
      trigger.removeEventListener("click", onTriggerClick);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    };
  }

  /* ============================================================
     Public surface — LOCKED by T0-SUBSTRATE.md §2
     ============================================================ */

  window.JobBoredA11y = {
    dialog: {
      open: function (el, opts) {
        return openDialog(el, opts, false);
      },
      confirm: confirmDialog,
    },
    drawer: {
      open: function (el, opts) {
        return openDialog(el, opts, true);
      },
    },
    live: { announce: announce },
    toast: toast,
    tabs: { init: initTabs },
    field: { associate: associate, build: buildField },
    stageMenu: { attach: attachStageMenu },
  };
})();
