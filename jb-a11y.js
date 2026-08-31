// jb-a11y.js — shared overlay, live-region, label, and Move-to primitives (F3-D)
// Classic <script defer> (see index.html composition notes). No ES export:
// an `export` here is a SyntaxError that aborts the file. API is
// window.JobBoredA11y.
(function (global) {
  "use strict";

  var LIVE_ID = "jb-live-region";
  var MIN_TOUCH_PX = 44;
  var MOVE_TO_STAGES = [
    "New",
    "Researching",
    "Applied",
    "Phone Screen",
    "Interviewing",
    "Offer",
    "Rejected",
    "Passed",
    "Expired",
  ];
  var FIT_PROFILE_LABELS = {
    targetRole: "Target role",
    seniority: "Target seniority",
    narrative: "Primary narrative",
    strength: "Strength",
    evidence: "Evidence",
    notes: "Notes",
    company: "Company name",
    logoDomain: "Logo domain override",
  };
  var PHONE_GEOMETRY_FIXTURES = [
    {
      id: "iphone-se",
      name: "iPhone SE",
      width: 320,
      height: 568,
      deviceScaleFactor: 2,
      keyboardOpenInsetPx: 216,
    },
    {
      id: "iphone-12-mini",
      name: "iPhone 12 mini",
      width: 375,
      height: 812,
      deviceScaleFactor: 3,
      keyboardOpenInsetPx: 260,
    },
    {
      id: "iphone-14",
      name: "iPhone 14",
      width: 393,
      height: 852,
      deviceScaleFactor: 3,
      keyboardOpenInsetPx: 336,
    },
  ];

  function resolveDoc(doc) {
    if (doc) return doc;
    if (typeof document !== "undefined") return document;
    return null;
  }

  function isFocusable(el) {
    if (!el) return false;
    if (el.hidden || el.inert || el.disabled) return false;
    var tabindex = el.getAttribute ? el.getAttribute("tabindex") : null;
    if (tabindex === "-1") return false;
    var tag = String(el.tagName || "").toLowerCase();
    if (tag === "button" || tag === "select" || tag === "textarea") return true;
    if (tag === "a" && el.getAttribute && el.getAttribute("href")) return true;
    if (tag === "input") {
      var type = el.getAttribute ? el.getAttribute("type") : "";
      return type !== "hidden";
    }
    if (tabindex != null && tabindex !== "") return true;
    return false;
  }

  function collectFocusable(root) {
    var out = [];
    function walk(node) {
      if (!node) return;
      if (node !== root && isFocusable(node)) out.push(node);
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
    }
    walk(root);
    return out;
  }

  function ensureLiveRegion(doc) {
    doc = resolveDoc(doc);
    if (!doc || !doc.createElement) return null;
    var el = doc.getElementById ? doc.getElementById(LIVE_ID) : null;
    if (el) return el;
    el = doc.createElement("div");
    el.id = LIVE_ID;
    el.className = "jb-live-region";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    if (doc.body && doc.body.appendChild) doc.body.appendChild(el);
    return el;
  }

  function announce(doc, message, options) {
    options = options || {};
    var el = ensureLiveRegion(doc);
    if (!el) return null;
    var assertive = options.politeness === "assertive";
    el.setAttribute("aria-live", assertive ? "assertive" : "polite");
    el.setAttribute("role", assertive ? "alert" : "status");
    el.textContent = "";
    el.textContent = message == null ? "" : String(message);
    return el;
  }

  function announceToast(doc, options) {
    options = options || {};
    var type = options.type || "info";
    var politeness = type === "error" ? "assertive" : "polite";
    return announce(doc, options.message, { politeness: politeness });
  }

  function applyInertSiblings(root, doc) {
    var marked = [];
    var parent = (root && root.parentNode) || (doc && doc.body);
    if (!parent || !parent.children) return marked;
    var kids = parent.children;
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i];
      if (!child || child === root) continue;
      if (child.inert === true) continue;
      child.inert = true;
      marked.push(child);
    }
    return marked;
  }

  function restoreInert(marked) {
    if (!marked) return;
    for (var i = 0; i < marked.length; i++) {
      if (marked[i]) marked[i].inert = false;
    }
  }

  function focusEl(el) {
    if (el && typeof el.focus === "function") {
      try {
        el.focus({ preventScroll: true });
      } catch (_err) {
        el.focus();
      }
    }
  }

  function trapTab(root, event, doc) {
    var list = collectFocusable(root);
    if (!event || event.key !== "Tab") return false;
    if (event.preventDefault) event.preventDefault();
    if (list.length === 0) {
      focusEl(root);
      return true;
    }
    var active = doc && doc.activeElement;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === active) {
        idx = i;
        break;
      }
    }
    if (event.shiftKey) {
      idx = idx <= 0 ? list.length - 1 : idx - 1;
    } else {
      idx = idx === list.length - 1 || idx === -1 ? 0 : idx + 1;
    }
    focusEl(list[idx]);
    return true;
  }

  function createOverlayOwner(doc) {
    doc = resolveDoc(doc);
    var stack = [];

    function open(opts) {
      opts = opts || {};
      var root = opts.root;
      if (!root) return null;
      root.inert = false;
      if (root.classList && root.classList.add) root.classList.add("jb-overlay");
      else if (root.className != null && String(root.className).indexOf("jb-overlay") === -1) {
        root.className = (root.className ? root.className + " " : "") + "jb-overlay";
      }
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      if (opts.labelledBy) root.setAttribute("aria-labelledby", opts.labelledBy);
      else if (opts.label) root.setAttribute("aria-label", opts.label);
      var prev = stack[stack.length - 1];
      if (prev && prev.root) prev.root.inert = true;
      var opener = doc && doc.activeElement;
      var marked = applyInertSiblings(root, doc);
      var layer = {
        root: root,
        opener: opener,
        marked: marked,
        initialFocus: opts.initialFocus || null,
      };
      stack.push(layer);
      var target = opts.initialFocus || collectFocusable(root)[0] || root;
      focusEl(target);
      return layer;
    }

    function close() {
      var layer = stack.pop();
      if (!layer) return null;
      restoreInert(layer.marked);
      if (layer.root) {
        layer.root.removeAttribute("aria-modal");
      }
      var next = stack[stack.length - 1];
      if (next && next.root) {
        next.root.inert = false;
        var resume = next.initialFocus || collectFocusable(next.root)[0] || next.root;
        focusEl(resume);
      } else {
        focusEl(layer.opener);
      }
      return layer;
    }

    function top() {
      return stack.length ? stack[stack.length - 1] : null;
    }

    function handleKeydown(event) {
      var layer = top();
      if (!layer) return false;
      if (!event) return false;
      if (event.key === "Escape") {
        if (event.preventDefault) event.preventDefault();
        close();
        return true;
      }
      if (event.key === "Tab") {
        return trapTab(layer.root, event, doc);
      }
      return false;
    }

    return {
      open: open,
      close: close,
      top: top,
      depth: function () {
        return stack.length;
      },
      handleKeydown: handleKeydown,
    };
  }

  function ensureControlLabel(el, options) {
    options = options || {};
    if (!el || !el.setAttribute) return el;
    if (options.labelledBy) {
      el.setAttribute("aria-labelledby", options.labelledBy);
      if (el.removeAttribute) el.removeAttribute("aria-label");
    } else if (options.label) {
      el.setAttribute("aria-label", String(options.label));
    }
    return el;
  }

  function labelFitProfileControl(el, fieldKey) {
    var label = FIT_PROFILE_LABELS[fieldKey] || fieldKey;
    return ensureControlLabel(el, { label: label });
  }

  function createMoveToAction(doc, options) {
    doc = resolveDoc(doc);
    options = options || {};
    var stages = options.stages && options.stages.length ? options.stages : MOVE_TO_STAGES.slice();
    var onMove = typeof options.onMove === "function" ? options.onMove : function () {};

    var root = doc.createElement("div");
    root.className = "jb-move-to-wrap";

    var trigger = doc.createElement("button");
    trigger.setAttribute("type", "button");
    trigger.className = "jb-move-to";
    trigger.setAttribute("aria-label", "Move to stage");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.textContent = "Move to";

    var menu = doc.createElement("ul");
    menu.className = "jb-move-to__menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    menu.setAttribute("hidden", "");

    var items = [];
    for (var i = 0; i < stages.length; i++) {
      var li = doc.createElement("li");
      li.setAttribute("role", "none");
      var btn = doc.createElement("button");
      btn.setAttribute("type", "button");
      btn.setAttribute("role", "menuitem");
      btn.setAttribute("data-stage", stages[i]);
      btn.textContent = stages[i];
      li.appendChild(btn);
      menu.appendChild(li);
      items.push(btn);
    }

    root.appendChild(trigger);
    root.appendChild(menu);

    var open = false;
    var activeIndex = 0;

    function setOpen(next) {
      open = next;
      menu.hidden = !next;
      if (next) {
        if (menu.removeAttribute) menu.removeAttribute("hidden");
      } else if (menu.setAttribute) {
        menu.setAttribute("hidden", "");
      }
      trigger.setAttribute("aria-expanded", next ? "true" : "false");
    }

    function choose(index) {
      var stage = stages[index];
      setOpen(false);
      if (stage) onMove(stage);
      focusEl(trigger);
    }

    function handleKeydown(event) {
      if (!event) return false;
      var key = event.key;
      if (!open) {
        if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {
          if (event.preventDefault) event.preventDefault();
          setOpen(true);
          activeIndex = key === "ArrowUp" ? items.length - 1 : 0;
          focusEl(items[activeIndex]);
          return true;
        }
        return false;
      }
      if (key === "Escape") {
        if (event.preventDefault) event.preventDefault();
        setOpen(false);
        focusEl(trigger);
        return true;
      }
      if (key === "ArrowDown") {
        if (event.preventDefault) event.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        focusEl(items[activeIndex]);
        return true;
      }
      if (key === "ArrowUp") {
        if (event.preventDefault) event.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        focusEl(items[activeIndex]);
        return true;
      }
      if (key === "Enter" || key === " ") {
        if (event.preventDefault) event.preventDefault();
        choose(activeIndex);
        return true;
      }
      return false;
    }

    return {
      root: root,
      trigger: trigger,
      menu: menu,
      handleKeydown: handleKeydown,
    };
  }

  var api = {
    LIVE_ID: LIVE_ID,
    MIN_TOUCH_PX: MIN_TOUCH_PX,
    MOVE_TO_STAGES: MOVE_TO_STAGES,
    PHONE_GEOMETRY_FIXTURES: PHONE_GEOMETRY_FIXTURES,
    ensureLiveRegion: ensureLiveRegion,
    announce: announce,
    announceToast: announceToast,
    createOverlayOwner: createOverlayOwner,
    collectFocusable: collectFocusable,
    ensureControlLabel: ensureControlLabel,
    labelFitProfileControl: labelFitProfileControl,
    createMoveToAction: createMoveToAction,
  };

  global.JobBoredA11y = api;
})(typeof window !== "undefined" ? window : globalThis);
