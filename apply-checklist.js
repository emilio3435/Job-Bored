/* ============================================================
   apply-checklist.js — <jb-apply-checklist> (Materials Wave 2)
   ------------------------------------------------------------
   The manual-apply checklist, inline on the role's materials rows.
   The server builds it from the application package (no model call)
   and stores it as checklist.json; this element renders it, ticks
   items (PUT, persisted in the application folder) and runs each
   item's one-click action.

   It paints as a horizontal progress strip (MREV CHECKLIST): a track of
   one tick per step, the step in view with its tick box and action, a
   peek at the next undone step, chevrons (and ←/→) to move, "N steps
   remaining · X completed", and finished steps folded into a disclosure.

     <jb-apply-checklist data-slug data-base data-version data-contact>

   Light DOM like jb-ui.js's primitives, so the body.jb-v2 cascade and
   materials-insights.css reach it. A download action is a plain
   data-action="materials-download" link inside the materials section,
   so role-materials.js's FAIL gate asks before a failed resume leaves.
   Ticking "Submit the application" moves the role to Applied through
   the dossier's own stage stepper (the existing write-back path, with
   its confirmation), and only when the role is still before Applied.

   Events:
     EMITS jb:checklist:changed { slug, done, total }
     EMITS jb:role:action { action: resume-tailor | resume-cover } (Draft)
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root.HTMLElement !== "function" || !root.customElements) return;

  var TAG = "jb-apply-checklist";
  /* Last checklist per slug, so a re-render paints at once. */
  var cache = {};

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function apiFetch(url, init) {
    var auth = root.JobBoredHostedApiAuth;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    return root.fetch(url, init);
  }

  function readJson(res) {
    return res.text().then(function (txt) {
      var body = null;
      try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = null; }
      if (!res.ok) throw new Error((body && body.error) || ("The materials server answered " + res.status));
      return body;
    });
  }

  function fileHref(base, slug, filename, download) {
    return base + "/api/applications/" + encodeURIComponent(slug) + "/files/" + encodeURIComponent(filename)
      + (download ? "?download=1" : "");
  }

  function progressOf(data) {
    var items = data && Array.isArray(data.items) ? data.items : [];
    var done = items.filter(function (i) { return i && i.done; }).length;
    return { done: done, total: items.length };
  }

  function formatDoneAt(iso) {
    var t = Date.parse(String(iso || ""));
    if (!Number.isFinite(t)) return "";
    var d = new Date(t);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return "done " + months[d.getMonth()] + " " + d.getDate();
  }

  /* One item's action as a link or button. */
  function actionHtml(item, base, slug) {
    var a = item.action;
    if (!a || !a.kind) return "";
    var label = esc(a.label || "Open");
    var btn = 'class="case__doc-btn case__doc-btn--ghost jb-cl__btn"';
    if (a.kind === "open" && /^https?:\/\//i.test(String(a.href || ""))) {
      return "<a " + btn + ' href="' + esc(a.href) + '" target="_blank" rel="noopener" data-cl-open>' + label + "</a>";
    }
    if (a.kind === "download" && a.filename) {
      return "<a " + btn + ' href="' + esc(fileHref(base, slug, a.filename, true)) + '" download'
        + ' data-action="materials-download" data-filename="' + esc(a.filename) + '"'
        + (a.gate ? ' data-gate="fail"' : "") + ">" + label + "</a>";
    }
    if (a.kind === "preview" && a.filename) {
      return "<a " + btn + ' href="' + esc(fileHref(base, slug, a.filename, false)) + '" target="_blank" rel="noopener">' + label + "</a>";
    }
    return "<button type=\"button\" " + btn + ' data-cl-action="' + esc(a.kind) + '">' + label + "</button>";
  }

  var CHEVRON_PREV = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHEVRON_NEXT = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* The strip's trailing summary: what is left, then what is behind you. */
  function summaryText(p) {
    var left = p.total - p.done;
    if (p.total && left <= 0) return p.total === 1 ? "The 1 step is done" : "All " + p.total + " steps done";
    return plural(left, "step", "steps") + " remaining · " + p.done + " completed";
  }

  /* Which step the strip holds in focus, and which one it peeks at.
     focusId is the step the person last looked at; a step that has just
     been ticked hands focus to the next undone step after it. */
  function stripModel(data, focusId) {
    var items = data && Array.isArray(data.items) ? data.items.filter(Boolean) : [];
    var pending = [];
    var completed = [];
    items.forEach(function (item) { (item.done ? completed : pending).push(item); });
    var at = 0;
    if (focusId != null && pending.length) {
      var idx = -1;
      pending.forEach(function (item, i) { if (idx < 0 && item.id === focusId) idx = i; });
      if (idx < 0) {
        var order = -1;
        items.forEach(function (item, i) { if (order < 0 && item.id === focusId) order = i; });
        idx = 0;
        if (order >= 0) {
          for (var i = 0; i < pending.length; i += 1) {
            if (items.indexOf(pending[i]) > order) { idx = i; break; }
          }
        }
      }
      at = idx;
    }
    var current = pending[at] || null;
    return {
      items: items,
      pending: pending,
      completed: completed,
      current: current,
      peek: pending[at + 1] || null,
      hasPrev: at > 0,
      hasNext: at + 1 < pending.length,
      position: current ? items.indexOf(current) : -1,
      done: completed.length,
      total: items.length,
    };
  }

  function trackHtml(m, headingId) {
    var ticks = m.items.map(function (item, i) {
      var cls = item.done ? " jb-cl__tick--done" : (i === m.position ? " jb-cl__tick--now" : "");
      if (!item.done && item.tone === "warn") cls += " jb-cl__tick--warn";
      return '<i class="jb-cl__tick' + cls + '" aria-hidden="true"></i>';
    }).join("");
    return '<div class="jb-cl__track" role="progressbar" aria-labelledby="' + esc(headingId) + '"'
      + ' aria-valuemin="0" aria-valuemax="' + m.total + '" aria-valuenow="' + m.done + '"'
      + ' aria-valuetext="' + esc(m.done + " of " + plural(m.total, "step", "steps") + " done") + '">' + ticks + "</div>";
  }

  function headHtml(m, headingId) {
    return '<div class="jb-cl__head">'
      + '<h4 class="jb-cl__title" id="' + esc(headingId) + '">Before you apply</h4>'
      + (m.total ? '<span class="jb-cl__count" aria-live="polite">' + esc(summaryText(m)) + "</span>" : "")
      + "</div>";
  }

  /* The focused step: its tick box, words and one-click action. */
  function nowHtml(item, m, opts) {
    var id = esc(item.id);
    var inputId = opts.headingId + "-" + item.id;
    var gatedDoc = item.action && item.action.kind === "download" && item.action.doc ? item.action.doc : "";
    var warn = item.tone === "warn";
    return '<div class="jb-cl__now' + (warn ? " jb-cl__now--warn" : "") + '" data-item="' + id + '"'
      + (gatedDoc ? ' data-doc-type="' + esc(gatedDoc) + '"' : "") + ">"
      + '<span class="jb-cl__pos">Step ' + (m.position + 1) + " of " + m.total + "</span>"
      + '<div class="jb-cl__check">'
      + '<input class="jb-cl__input" type="checkbox" id="' + esc(inputId) + '" data-cl-id="' + id + '">'
      + '<label class="jb-cl__label" for="' + esc(inputId) + '">' + esc(item.label) + "</label>"
      + "</div>"
      + (item.detail ? '<p class="jb-cl__detail">' + esc(item.detail) + "</p>" : "")
      + (item.action ? '<div class="jb-cl__act">' + actionHtml(item, opts.base, opts.slug) + "</div>" : "")
      + "</div>";
  }

  /* Completed steps fold into one disclosure; each can be unticked. */
  function doneHtml(m, opts) {
    if (!m.completed.length) return "";
    var rows = m.completed.map(function (item) {
      var id = esc(item.id);
      var inputId = opts.headingId + "-" + item.id;
      return '<li class="jb-cl__item jb-cl__item--done" data-item="' + id + '">'
        + '<input class="jb-cl__input" type="checkbox" id="' + esc(inputId) + '" data-cl-id="' + id + '" checked>'
        + '<label class="jb-cl__label" for="' + esc(inputId) + '">' + esc(item.label) + "</label>"
        + (item.doneAt ? '<span class="jb-cl__when">' + esc(formatDoneAt(item.doneAt)) + "</span>" : "")
        + "</li>";
    }).join("");
    return '<details class="jb-cl__done"' + (opts.doneOpen ? " open" : "") + ">"
      + '<summary class="jb-cl__done-sum">Review ' + plural(m.completed.length, "completed step", "completed steps") + "</summary>"
      + '<ol class="jb-cl__done-list">' + rows + "</ol>"
      + "</details>";
  }

  /* The whole strip for one checklist. opts: base, slug, headingId,
     focusId (the step in view), doneOpen, dir ("next" | "prev"). */
  function stripHtml(data, opts) {
    var m = stripModel(data, opts.focusId);
    var note = '<p class="jb-cl__note" data-cl-note hidden></p>';
    if (!m.total) {
      return '<div class="jb-cl__strip" data-cl-state="empty">' + headHtml(m, opts.headingId)
        + '<p class="jb-cl__empty">No steps yet. They appear once this role has a resume or cover letter to send.</p>'
        + note + "</div>";
    }
    if (!m.current) {
      return '<div class="jb-cl__strip" data-cl-state="done">' + headHtml(m, opts.headingId) + trackHtml(m, opts.headingId)
        + '<p class="jb-cl__alldone"><span class="jb-cl__alldone-mark" aria-hidden="true"></span>Nothing left to do before you apply.</p>'
        + doneHtml(m, opts) + note + "</div>";
    }
    return '<div class="jb-cl__strip" data-cl-state="active">' + headHtml(m, opts.headingId) + trackHtml(m, opts.headingId)
      + '<div class="jb-cl__row"' + (opts.dir ? ' data-cl-dir="' + esc(opts.dir) + '"' : "") + ">"
      + '<button type="button" class="jb-cl__nav jb-cl__nav--prev" data-cl-nav="prev" aria-label="Previous step"'
      + (m.hasPrev ? "" : " disabled") + ">" + CHEVRON_PREV + "</button>"
      + nowHtml(m.current, m, opts)
      + (m.peek
        ? '<button type="button" class="jb-cl__peek" data-cl-nav="next"><span class="jb-cl__peek-k">Up next</span>'
          + '<span class="jb-cl__peek-label">' + esc(m.peek.label) + "</span></button>"
        : '<p class="jb-cl__peek jb-cl__peek--last">This is the last step left.</p>')
      + '<button type="button" class="jb-cl__nav jb-cl__nav--next" data-cl-nav="next" aria-label="Next step"'
      + (m.hasNext ? "" : " disabled") + ">" + CHEVRON_NEXT + "</button>"
      + "</div>"
      + doneHtml(m, opts) + note + "</div>";
  }

  function errorHtml(message) {
    return '<div class="jb-cl__strip" data-cl-state="error" role="alert">'
      + '<p class="jb-cl__error">' + esc("Couldn’t load the checklist: " + (message || "unknown error")) + "</p>"
      + '<button type="button" class="case__doc-btn case__doc-btn--ghost jb-cl__btn" data-cl-retry>Try again</button>'
      + "</div>";
  }

  /* The role's stage stepper: is the role still before Applied? */
  function stepBeforeApplied() {
    var region = root.document && root.document.querySelector('[data-region="role"]');
    if (!region) return null;
    var steps = Array.prototype.slice.call(region.querySelectorAll('[data-action="stage-step"]'));
    var applied = region.querySelector('[data-action="stage-step"][data-stage="applied"]');
    var now = region.querySelector(".case__step--now");
    if (!applied || !now) return null;
    return steps.indexOf(now) < steps.indexOf(applied) ? applied : null;
  }

  var seq = 0;

  class JbApplyChecklist extends root.HTMLElement {
    connectedCallback() {
      if (!this._wired) this._wire();
      seq += 1;
      this._headingId = "jb-cl-" + seq;
      var slug = this.getAttribute("data-slug") || "";
      var hit = cache[slug];
      if (hit) this._paint(hit.data);
      else this.innerHTML = '<p class="jb-cl__loading">Building your checklist…</p>';
      /* One fetch per package version; a poll re-render reuses it. */
      var version = this.getAttribute("data-version") || "";
      if (!hit || hit.version !== version) this.refresh();
    }

    _base() { return String(this.getAttribute("data-base") || "").replace(/\/+$/, ""); }
    _slug() { return this.getAttribute("data-slug") || ""; }
    _url() {
      return this._base() + "/api/applications/" + encodeURIComponent(this._slug()) + "/checklist";
    }

    refresh() {
      var self = this;
      var slug = this._slug();
      var version = this.getAttribute("data-version") || "";
      var contact = this.getAttribute("data-contact") || "";
      if (!slug) return Promise.resolve(null);
      return apiFetch(this._url() + (contact ? "?contact=" + encodeURIComponent(contact) : ""), { credentials: "omit", cache: "no-store" })
        .then(readJson)
        .then(function (data) {
          cache[slug] = { data: data, version: version };
          if (self.isConnected) self._paint(data);
          return data;
        })
        .catch(function (err) {
          if (!self.isConnected) return null;
          if (!cache[slug]) self.innerHTML = errorHtml((err && err.message) || "unknown error");
          return null;
        });
    }

    _paint(data, dir) {
      var m = stripModel(data, this._focusId);
      /* Hold the step in view across repaints (a poll, a tick elsewhere). */
      this._focusId = m.current ? m.current.id : null;
      this.innerHTML = stripHtml(data, {
        base: this._base(),
        slug: this._slug(),
        headingId: this._headingId,
        focusId: this._focusId,
        doneOpen: !!this._doneOpen,
        dir: dir || "",
      });
      var p = progressOf(data);
      var row = this.closest("[data-doc]");
      var pill = row && row.querySelector(".case__docst");
      if (pill) pill.textContent = p.done + " / " + p.total + " done";
      this.dispatchEvent(new root.CustomEvent("jb:checklist:changed", {
        bubbles: true,
        detail: { slug: this._slug(), done: p.done, total: p.total },
      }));
    }

    _note(text) {
      var note = this.querySelector("[data-cl-note]");
      if (!note) return;
      note.textContent = text;
      if (text) note.removeAttribute("hidden");
      else note.setAttribute("hidden", "");
    }

    _data() {
      var hit = cache[this._slug()];
      return hit ? hit.data : null;
    }

    /* Move the strip one step forward or back through the undone steps. */
    _step(dir, fromKey) {
      var data = this._data();
      if (!data) return false;
      var m = stripModel(data, this._focusId);
      var at = m.current ? m.pending.indexOf(m.current) : -1;
      var to = m.pending[dir === "prev" ? at - 1 : at + 1];
      if (!to) return false;
      var active = root.document && root.document.activeElement;
      var navFocused = !fromKey && active && active.getAttribute && active.getAttribute("data-cl-nav") === dir
        && active.classList.contains("jb-cl__nav");
      this._focusId = to.id;
      this._paint(data, dir);
      /* A chevron keeps focus while it can go on; otherwise the new step's
         tick box takes it, so Space ticks what is in view. */
      var keep = navFocused ? this.querySelector('.jb-cl__nav[data-cl-nav="' + dir + '"]:not([disabled])') : null;
      var target = keep || this.querySelector(".jb-cl__now .jb-cl__input");
      if (target && typeof target.focus === "function") target.focus();
      return true;
    }

    _wire() {
      var self = this;
      this._wired = true;
      this.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        var t = e.target;
        var tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
        if (tag === "textarea" || (tag === "input" && t.type !== "checkbox")) return;
        if (t && t.closest && t.closest(".jb-cl__done, .mat-confirm, [role='alertdialog'], [role='menu']")) return;
        if (self._step(e.key === "ArrowRight" ? "next" : "prev", true)) e.preventDefault();
      });
      /* toggle does not bubble: listen in the capture phase. */
      this.addEventListener("toggle", function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains("jb-cl__done")) self._doneOpen = !!t.open;
      }, true);
      this.addEventListener("change", function (e) {
        var input = e.target;
        if (!input || !input.getAttribute || input.getAttribute("data-cl-id") == null) return;
        self._toggle(input.getAttribute("data-cl-id"), !!input.checked, input);
      });
      this.addEventListener("click", function (e) {
        var t = e.target;
        while (t && t !== self && t.getAttribute) {
          var nav = t.getAttribute("data-cl-nav");
          if (nav) {
            e.preventDefault();
            self._step(nav);
            return;
          }
          if (t.getAttribute("data-cl-retry") != null) {
            e.preventDefault();
            self.innerHTML = '<p class="jb-cl__loading">Building your checklist…</p>';
            self.refresh();
            return;
          }
          var kind = t.getAttribute("data-cl-action");
          if (kind) {
            e.preventDefault();
            self._act(kind, t);
            return;
          }
          t = t.parentNode;
        }
      });
    }

    _toggle(id, done, input) {
      var self = this;
      var slug = this._slug();
      var li = input.closest("[data-item]");
      if (li) li.classList.add("jb-cl__saving");
      input.disabled = true;
      apiFetch(this._url(), {
        method: "PUT",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, done: done, contact: this.getAttribute("data-contact") || "" }),
      }).then(readJson).then(function (data) {
        cache[slug] = { data: data, version: self.getAttribute("data-version") || "" };
        /* Unticking brings that step back into view; ticking hands the
           strip to the next undone step. */
        if (!done) self._focusId = id;
        self._paint(data, done ? "next" : "");
        /* Submitted on the company site: move the card to Applied through
           the dossier's own stepper (its confirmation guards the write). */
        if (id === "submit" && done) {
          var step = stepBeforeApplied();
          if (step) step.click();
        }
        var focus = self.querySelector(".jb-cl__now .jb-cl__input") || self.querySelector(".jb-cl__done-sum");
        if (focus && typeof focus.focus === "function") focus.focus();
      }).catch(function (err) {
        input.disabled = false;
        input.checked = !done;
        if (li) li.classList.remove("jb-cl__saving");
        self._note("Couldn’t save that tick: " + ((err && err.message) || "unknown error"));
      });
    }

    _act(kind, btn) {
      var li = btn.closest("[data-item]");
      var id = li ? li.getAttribute("data-item") : "";
      var data = cache[this._slug()] && cache[this._slug()].data;
      var item = data && Array.isArray(data.items) ? data.items.filter(function (i) { return i.id === id; })[0] : null;
      var action = item && item.action ? item.action : {};
      if (kind === "copy") {
        this._copy(String(action.text || ""), li);
      } else if (kind === "draft") {
        var ev = new root.CustomEvent("jb:role:action", {
          bubbles: true,
          detail: {
            action: action.doc === "cover_letter" ? "resume-cover" : "resume-tailor",
            jobKey: root.JobBoredFlowing && root.JobBoredFlowing.openRole && root.JobBoredFlowing.openRole.get
              ? root.JobBoredFlowing.openRole.get() : null,
          },
        });
        root.document.dispatchEvent(ev);
      } else if (kind === "profile") {
        if (typeof root.openCommandCenterSettingsModal === "function") root.openCommandCenterSettingsModal({ tab: "fit-profile" });
      } else if (kind === "stage") {
        var step = stepBeforeApplied();
        if (step) step.click();
        else this._note("This role is already at Applied or later.");
      }
    }

    _copy(text, li) {
      var self = this;
      if (!text) return;
      var nav = root.navigator;
      var write = nav && nav.clipboard && typeof nav.clipboard.writeText === "function"
        ? nav.clipboard.writeText(text)
        : Promise.reject(new Error("no clipboard"));
      write.then(function () {
        self._note("Copied. Paste it into LinkedIn or an email.");
      }, function () {
        if (!li) return;
        var area = root.document.createElement("textarea");
        area.className = "jb-cl__copy";
        area.readOnly = true;
        area.rows = 4;
        area.setAttribute("aria-label", "Outreach note");
        area.value = text;
        li.appendChild(area);
        try { area.focus(); area.select(); } catch (e) { /* a convenience */ }
      });
    }
  }

  if (!root.customElements.get(TAG)) root.customElements.define(TAG, JbApplyChecklist);

  root.JobBoredApplyChecklist = {
    TAG: TAG,
    summaryText: summaryText,
    stripModel: stripModel,
    stripHtml: stripHtml,
    errorHtml: errorHtml,
    progress: function (slug) {
      var hit = cache[slug];
      return hit ? progressOf(hit.data) : null;
    },
    _reset: function () { cache = {}; },
  };
})(typeof window !== "undefined" ? window : this);
