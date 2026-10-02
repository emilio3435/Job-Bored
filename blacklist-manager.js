/* ============================================================
   blacklist-manager.js — "Dismissed & blocked" (HOLES R13)
   ------------------------------------------------------------
   Lists the Blacklist tab (the roles discovery will not add back), one
   entry per role, keyed by URL plus the board's posting id where the URL
   carries one. Restore lifts every block for the role and un-dismisses
   its Pipeline row when there is one (sheetsWrite.restoreBlockedRole).

   Loaded on first use by the sync bar's "Blocked" button
   (sheets-read-load.js openBlockedRoles). Classic global IIFE:
     window.JobBoredBlacklistManager = { open(opener) }
   ============================================================ */
(function (root) {
  "use strict";

  var current = null;

  function doc() {
    return root.document;
  }

  function writer() {
    var app = root.JobBoredApp;
    return (app && app.sheetsWrite) || null;
  }

  function el(tag, cls, text) {
    var node = doc().createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /** Only http(s) URLs become links: Blacklist cells are typed by anyone. */
  function safeHref(url) {
    try {
      var u = new URL(String(url || ""));
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
    } catch (_) {
      return "";
    }
  }

  function hostOf(url) {
    try {
      return new URL(String(url || "")).hostname.replace(/^www\./, "");
    } catch (_) {
      return "";
    }
  }

  function describe(entry) {
    var title = entry.title || hostOf(entry.url) || "This role";
    return entry.company ? title + " at " + entry.company : title;
  }

  function dayOf(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }

  function setStatus(view, text, retry) {
    view.status.replaceChildren();
    view.status.textContent = "";
    view.status.appendChild(el("span", null, text));
    if (retry) {
      var btn = el("button", "jb-a11y-dialog__btn jb-btn jb-btn--secondary jb-a11y-touch-target", "Retry");
      btn.setAttribute("type", "button");
      btn.addEventListener("click", function () {
        return load(view);
      });
      view.status.appendChild(btn);
    }
  }

  function renderItem(view, entry) {
    var item = el("li", "jb-blocked__item");
    var text = el("div", "jb-blocked__text");
    text.appendChild(el("strong", "jb-blocked__title", entry.title || hostOf(entry.url) || "Untitled role"));
    var meta = el("span", "jb-blocked__meta");
    if (entry.company) meta.appendChild(el("span", null, entry.company + " · "));
    var href = safeHref(entry.url);
    if (href) {
      var link = el("a", null, hostOf(href));
      link.setAttribute("href", href);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
      meta.appendChild(link);
    } else if (entry.url) {
      meta.appendChild(el("span", null, String(entry.url)));
    }
    var day = dayOf(entry.dismissedAt);
    if (day) meta.appendChild(el("span", null, " · dismissed " + day));
    text.appendChild(meta);
    item.appendChild(text);

    var restore = el(
      "button",
      "jb-blocked__restore jb-a11y-dialog__btn jb-btn jb-btn--secondary jb-a11y-touch-target",
      "Restore",
    );
    restore.setAttribute("type", "button");
    restore.setAttribute("aria-label", "Restore " + describe(entry));
    restore.addEventListener("click", function () {
      return restoreEntry(view, entry, item, restore);
    });
    item.appendChild(restore);
    return item;
  }

  function restoreEntry(view, entry, item, button) {
    var w = writer();
    if (!w || typeof w.restoreBlockedRole !== "function") return undefined;
    button.disabled = true;
    button.textContent = "Restoring…";
    return Promise.resolve()
      .then(function () {
        return w.restoreBlockedRole(entry);
      })
      .catch(function () {
        return false;
      })
      .then(function (ok) {
        if (ok) {
          if (item.parentNode) item.parentNode.removeChild(item);
          var left = view.list.children.length;
          setStatus(
            view,
            "Restored " + describe(entry) + ". Discovery can add it again." +
              (left ? "" : " Nothing else is blocked."),
          );
          return;
        }
        button.disabled = false;
        button.textContent = "Restore";
        setStatus(view, "Couldn’t restore " + describe(entry) + ". Try again.");
      });
  }

  function load(view) {
    var w = writer();
    view.list.replaceChildren();
    setStatus(view, "Loading…");
    if (!w || typeof w.listBlockedRoles !== "function") {
      setStatus(view, "Couldn’t read your Blacklist tab.", true);
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(function () {
        return w.listBlockedRoles();
      })
      .then(
        function (entries) {
          var list = Array.isArray(entries) ? entries : [];
          if (!list.length) {
            setStatus(view, "Nothing is blocked. Roles you dismiss show up here.");
            return;
          }
          for (var i = 0; i < list.length; i++) view.list.appendChild(renderItem(view, list[i]));
          setStatus(
            view,
            list.length === 1 ? "1 blocked role." : list.length + " blocked roles.",
          );
        },
        function () {
          setStatus(view, "Couldn’t read your Blacklist tab.", true);
        },
      );
  }

  function open(opener) {
    if (current) return current;
    var dialog = el("div", "jb-a11y-dialog jb-blocked");
    var panel = el("div", "jb-a11y-dialog__panel");
    var title = el("h2", "jb-a11y-dialog__title", "Dismissed & blocked");
    title.setAttribute("id", "jbBlockedTitle");
    dialog.setAttribute("aria-labelledby", "jbBlockedTitle");
    panel.appendChild(title);
    panel.appendChild(
      el(
        "p",
        "jb-a11y-dialog__body",
        "Roles you dismissed. Discovery won’t add them back until you restore them.",
      ),
    );
    var status = el("div", "jb-blocked__status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    panel.appendChild(status);
    var list = el("ul", "jb-blocked__list");
    panel.appendChild(list);
    var actions = el("div", "jb-a11y-dialog__actions");
    var close = el("button", "jb-a11y-dialog__btn jb-btn jb-btn--secondary jb-a11y-touch-target", "Close");
    close.setAttribute("type", "button");
    actions.appendChild(close);
    panel.appendChild(actions);
    dialog.appendChild(panel);
    (doc().body || doc().documentElement).appendChild(dialog);

    var view = { el: dialog, status: status, list: list, handle: null };
    function teardown() {
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      current = null;
    }
    var a11y = root.JobBoredA11y;
    if (a11y && a11y.dialog && typeof a11y.dialog.open === "function") {
      view.handle = a11y.dialog.open(dialog, {
        opener: opener,
        initialFocus: close,
        onClose: teardown,
      });
    } else if (typeof close.focus === "function") {
      close.focus();
    }
    close.addEventListener("click", function () {
      if (view.handle) view.handle.close();
      else teardown();
    });
    current = view;
    load(view);
    return view;
  }

  root.JobBoredBlacklistManager = { open: open };
})(typeof window !== "undefined" ? window : globalThis);
