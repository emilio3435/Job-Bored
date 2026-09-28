/* ============================================================
   apply-checklist.js — <jb-apply-checklist> (Materials Wave 2)
   ------------------------------------------------------------
   The manual-apply checklist, inline on the role's materials rows.
   The server builds it from the application package (no model call)
   and stores it as checklist.json; this element renders it, ticks
   items (PUT, persisted in the application folder) and runs each
   item's one-click action.

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

  function listHtml(data, base, slug, headingId) {
    var items = Array.isArray(data.items) ? data.items : [];
    var p = progressOf(data);
    var rows = items.map(function (item) {
      var id = esc(item.id);
      var inputId = headingId + "-" + id;
      var gatedDoc = item.action && item.action.kind === "download" && item.action.doc ? item.action.doc : "";
      return '<li class="jb-cl__item' + (item.done ? " jb-cl__item--done" : "") + (item.tone === "warn" && !item.done ? " jb-cl__item--warn" : "") + '"'
        + ' data-item="' + id + '"' + (gatedDoc ? ' data-doc-type="' + esc(gatedDoc) + '"' : "") + ">"
        + '<input class="jb-cl__input" type="checkbox" id="' + esc(inputId) + '" data-cl-id="' + id + '"' + (item.done ? " checked" : "") + ">"
        + '<label class="jb-cl__label" for="' + esc(inputId) + '">' + esc(item.label) + "</label>"
        + '<p class="jb-cl__detail">' + esc(item.detail || "")
        + (item.done && item.doneAt ? ' <span class="jb-cl__when">' + esc(formatDoneAt(item.doneAt)) + "</span>" : "")
        + "</p>"
        + (item.action && !item.done ? '<div class="jb-cl__act">' + actionHtml(item, base, slug) + "</div>" : "")
        + "</li>";
    }).join("");
    return '<div class="jb-cl__head">'
      + '<h4 class="jb-cl__title" id="' + esc(headingId) + '">Before you apply</h4>'
      + '<span class="jb-cl__count" aria-live="polite">' + esc(p.done + " of " + p.total + " done") + "</span>"
      + "</div>"
      + '<div class="jb-cl__bar" role="progressbar" aria-labelledby="' + esc(headingId) + '"'
      + ' aria-valuemin="0" aria-valuemax="' + p.total + '" aria-valuenow="' + p.done + '"'
      + ' aria-valuetext="' + esc(p.done + " of " + p.total + " done") + '"><i class="jb-cl__fill"></i></div>'
      + '<ol class="jb-cl__list" aria-labelledby="' + esc(headingId) + '">' + rows + "</ol>"
      + '<p class="jb-cl__note" data-cl-note hidden></p>';
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
          if (!cache[slug]) self.innerHTML = '<p class="jb-cl__loading">' + esc("Couldn’t build the checklist: " + ((err && err.message) || "unknown error")) + "</p>";
          return null;
        });
    }

    _paint(data) {
      this.innerHTML = listHtml(data, this._base(), this._slug(), this._headingId);
      var p = progressOf(data);
      var fill = this.querySelector(".jb-cl__fill");
      if (fill) fill.style.setProperty("--jb-cl-done", p.total ? String(p.done / p.total) : "0");
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

    _wire() {
      var self = this;
      this._wired = true;
      this.addEventListener("change", function (e) {
        var input = e.target;
        if (!input || !input.getAttribute || input.getAttribute("data-cl-id") == null) return;
        self._toggle(input.getAttribute("data-cl-id"), !!input.checked, input);
      });
      this.addEventListener("click", function (e) {
        var t = e.target;
        while (t && t !== self && t.getAttribute) {
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
      var li = input.closest(".jb-cl__item");
      if (li) li.classList.toggle("jb-cl__item--done", done);
      input.disabled = true;
      apiFetch(this._url(), {
        method: "PUT",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, done: done, contact: this.getAttribute("data-contact") || "" }),
      }).then(readJson).then(function (data) {
        cache[slug] = { data: data, version: self.getAttribute("data-version") || "" };
        self._paint(data);
        /* Submitted on the company site: move the card to Applied through
           the dossier's own stepper (its confirmation guards the write). */
        if (id === "submit" && done) {
          var step = stepBeforeApplied();
          if (step) step.click();
        }
        var focus = self.querySelector('[data-cl-id="' + id + '"]');
        if (focus && typeof focus.focus === "function") focus.focus();
      }).catch(function (err) {
        input.disabled = false;
        input.checked = !done;
        if (li) li.classList.toggle("jb-cl__item--done", !done);
        self._note("Couldn’t save that tick: " + ((err && err.message) || "unknown error"));
      });
    }

    _act(kind, btn) {
      var li = btn.closest(".jb-cl__item");
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
    progress: function (slug) {
      var hit = cache[slug];
      return hit ? progressOf(hit.data) : null;
    },
    _reset: function () { cache = {}; },
  };
})(typeof window !== "undefined" ? window : this);
