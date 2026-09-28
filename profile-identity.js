/* ============================================
   profile-identity.js — "Your details": the name and contact block every
   resume and cover letter prints.

   One form, two homes: the one-flow "Your details" beat (right after the
   resume) and the "Your details" section at the top of Settings → Fit
   Profile. Both pre-fill from the resume through
   POST /profile/contact/suggest (server/profile-identity.mjs parses; it
   never saves) and the user confirms. Saving goes through
   POST /profile/contact, which replaces the contact half of
   profile.json's `identity` — a field left empty is cleared.

   Validation is fit-profile-schema.js's validateContact, the same rules
   the server's ajv schema enforces, with the same field paths.

   Classic-global IIFE. Attaches window.JobBoredProfileIdentity. Load after
   fit-profile-schema.js; the beat and the Settings editor call it later.
   ============================================ */
(function () {
  "use strict";

  var MAX_OTHER_LINKS = 3;
  /** Suggestions under this confidence are flagged "check this". */
  var LOW_CONFIDENCE = 0.7;

  var FIELDS = [
    { key: "fullName", label: "Full name", type: "text", autocomplete: "name", placeholder: "Jordan Rivera", group: "who" },
    {
      key: "headline",
      label: "Headline",
      type: "text",
      autocomplete: "organization-title",
      placeholder: "Growth Marketing Leader · AI Product Builder",
      group: "who",
      hint: "The line under your name.",
    },
    { key: "email", label: "Email", type: "email", autocomplete: "email", placeholder: "you@example.com", group: "reach" },
    { key: "phone", label: "Phone", type: "tel", autocomplete: "tel", placeholder: "(555) 010-0100", group: "reach" },
    { key: "location.city", label: "City", type: "text", autocomplete: "address-level2", placeholder: "Austin", group: "reach" },
    { key: "location.state", label: "State", type: "text", autocomplete: "address-level1", placeholder: "TX", group: "reach" },
    { key: "links.linkedin", label: "LinkedIn", type: "url", autocomplete: "url", placeholder: "linkedin.com/in/you", group: "links" },
    { key: "links.website", label: "Website or portfolio", type: "url", autocomplete: "url", placeholder: "yourname.com", group: "links" },
    { key: "links.github", label: "GitHub", type: "url", autocomplete: "url", placeholder: "github.com/you", group: "links" },
  ];

  var idCounter = 0;
  function nextId(prefix) {
    idCounter += 1;
    return "jbDetails-" + prefix + "-" + idCounter;
  }

  function text(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  // ---------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------

  /* E4: the JobBored API transport. Attaches the hosted token when
     hosted-api-auth.js is loaded; plain fetch otherwise. */
  function apiFetch(url, init) {
    var scope = typeof window !== "undefined" ? window : null;
    var auth = scope && scope.JobBoredHostedApiAuth;
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

  /**
   * Suggestions from a resume. `resumeText` may be empty: the server then
   * reads the resume it has stored. Resolves null when no server answers —
   * the form then simply starts empty.
   */
  async function suggest(resumeText) {
    try {
      var res = await apiFetch(profileUrl("/profile/contact/suggest"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(resumeText ? { resumeText: String(resumeText) } : {}),
      });
      var data = await readJson(res);
      if (!res.ok || !data || data.ok !== true) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  /** The saved contact half of the profile, or null (no profile / no server). */
  async function fetchSaved() {
    try {
      var res = await apiFetch(profileUrl("/profile"), { method: "GET" });
      var data = await readJson(res);
      if (!data || data.ok !== true || !isObject(data.profile)) {
        return { exists: false, contact: null };
      }
      return { exists: true, contact: contactOf(data.profile.identity), profile: data.profile };
    } catch (_) {
      return { exists: false, contact: null, offline: true };
    }
  }

  /**
   * Save the contact half. Resolves
   *   { ok: true, contact }                      saved to profile.json
   *   { ok: false, reason: "no_profile" }        no fit profile yet (409)
   *   { ok: false, reason: "rejected", errors }  the server refused a field
   *   { ok: false, reason: "offline" }           nothing answered
   */
  async function save(contact) {
    var res;
    try {
      res = await apiFetch(profileUrl("/profile/contact"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(contact || {}),
      });
    } catch (_) {
      return { ok: false, reason: "offline", message: "JobBored's local server didn't answer." };
    }
    var data = await readJson(res);
    if (res.ok && data && data.ok === true) {
      return { ok: true, contact: data.contact || contact, updatedAt: data.updatedAt || "" };
    }
    if (res.status === 409 && data && data.reason === "no_profile") {
      return { ok: false, reason: "no_profile", message: text(data.message) };
    }
    if (res.status === 400 && data && Array.isArray(data.errors)) {
      return { ok: false, reason: "rejected", errors: data.errors };
    }
    return {
      ok: false,
      reason: "server_error",
      message: (data && (text(data.message) || text(data.detail))) || "Save failed (HTTP " + res.status + ").",
    };
  }

  // ---------------------------------------------------------------
  // Shape
  // ---------------------------------------------------------------

  var CONTACT_KEYS = ["fullName", "headline", "headlineConfirmed", "email", "phone", "location", "links"];

  function contactOf(identity) {
    var out = {};
    if (!isObject(identity)) return out;
    CONTACT_KEYS.forEach(function (k) {
      if (identity[k] !== undefined) out[k] = identity[k];
    });
    return out;
  }

  /**
   * "linkedin.com/in/you" → "https://linkedin.com/in/you". Anything that is
   * not host-shaped (spaces, no dot) is returned as typed, so validation
   * names it instead of a scheme quietly making it "valid".
   */
  function withScheme(value) {
    var v = text(value);
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (/\s/.test(v) || !/^[^/]+\.[a-z]{2,}(\/|$)/i.test(v)) return v;
    return "https://" + v.replace(/^\/+/, "");
  }

  /** Flat form values → the schema's shape, empties dropped. */
  function toContact(values) {
    var v = values || {};
    var out = {};
    ["fullName", "headline", "email", "phone"].forEach(function (k) {
      var t = text(v[k]);
      if (t) out[k] = t;
    });
    // Wave 3: a headline the user typed (or one saved as confirmed) wins
    // over the per-role positioning headline on drafts.
    if (out.headline && v.headlineConfirmed === true) out.headlineConfirmed = true;
    var city = text(v["location.city"]);
    var state = text(v["location.state"]);
    if (city || state) {
      out.location = {};
      if (city) out.location.city = city;
      if (state) out.location.state = state;
    }
    var links = {};
    ["linkedin", "website", "github"].forEach(function (k) {
      var u = withScheme(v["links." + k]);
      if (u) links[k] = u;
    });
    var other = (Array.isArray(v.otherLinks) ? v.otherLinks : [])
      .map(function (row) {
        return { label: text(row && row.label), url: withScheme(row && row.url) };
      })
      .filter(function (row) {
        return row.label || row.url;
      })
      .slice(0, MAX_OTHER_LINKS);
    if (other.length) links.other = other;
    if (Object.keys(links).length) out.links = links;
    return out;
  }

  /** Schema shape → flat form values. */
  function toValues(contact) {
    var c = isObject(contact) ? contact : {};
    var loc = isObject(c.location) ? c.location : {};
    var links = isObject(c.links) ? c.links : {};
    return {
      fullName: text(c.fullName),
      headline: text(c.headline),
      headlineConfirmed: c.headlineConfirmed === true,
      email: text(c.email),
      phone: text(c.phone),
      "location.city": text(loc.city),
      "location.state": text(loc.state),
      "links.linkedin": text(links.linkedin),
      "links.website": text(links.website),
      "links.github": text(links.github),
      otherLinks: (Array.isArray(links.other) ? links.other : []).slice(0, MAX_OTHER_LINKS).map(function (o) {
        return { label: text(o && o.label), url: text(o && o.url) };
      }),
    };
  }

  /** Per-field confidence for the flat keys, from a suggest response. */
  function confidenceOf(suggestions) {
    var s = isObject(suggestions) ? suggestions : {};
    var links = isObject(s.links) ? s.links : {};
    var out = {};
    function put(key, entry) {
      if (isObject(entry) && typeof entry.confidence === "number") out[key] = entry.confidence;
    }
    put("fullName", s.fullName);
    put("headline", s.headline);
    put("email", s.email);
    put("phone", s.phone);
    if (isObject(s.location)) {
      put("location.city", s.location);
      put("location.state", s.location);
    }
    put("links.linkedin", links.linkedin);
    put("links.website", links.website);
    put("links.github", links.github);
    return out;
  }

  function validate(contact) {
    var schema = window.JobBoredFitProfileSchema;
    if (!schema || typeof schema.validateContact !== "function") return [];
    return schema.validateContact(contact, "");
  }

  /** "identity.links.other[1].url" / "links.other[1].url" → form key. */
  function fieldKeyFor(path) {
    var at = String(path || "").replace(/^identity\./, "");
    var other = /^links\.other\[(\d+)\](?:\.(label|url))?/.exec(at);
    if (other) return "other." + other[1] + "." + (other[2] || "url");
    if (at === "location") return "location.city";
    return at;
  }

  // ---------------------------------------------------------------
  // The form
  // ---------------------------------------------------------------

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = String(content);
    return node;
  }

  /**
   * Render the details form into `container`.
   *
   * options:
   *   values       flat initial values (toValues shape)
   *   headingLevel "h3" (beat) or "h5" (Settings, under the tab's h4)
   *   onChange()   after any edit
   *
   * Returns a controller:
   *   getValues(), getContact(), setValues(values, { onlyEmpty, confidence }),
   *   showErrors(errors) → count, validate() → errors (painted),
   *   focusFirstInvalid(), isDirty(), root
   */
  function renderForm(container, options) {
    var opts = options || {};
    var heading = opts.headingLevel || "h3";
    var root = el("div", "jb-details");
    var inputs = {};
    var hints = {};
    var errors = {};
    var otherList = null;
    var otherRows = [];
    var addOther = null;
    var touched = {};
    // Wave 3: true once the user types the headline (or it loads as
    // confirmed); a resume suggestion leaves it unconfirmed.
    var headlineConfirmed = false;
    var dirty = false;

    function changed(key) {
      if (key) touched[key] = true;
      dirty = true;
      if (typeof opts.onChange === "function") opts.onChange();
    }

    function group(key, title, lede) {
      var node = el("section", "jb-details__group jb-details__group--" + key);
      var h = el(heading, "jb-details__group-title", title);
      h.id = nextId("group-" + key);
      node.setAttribute("aria-labelledby", h.id);
      node.appendChild(h);
      if (lede) node.appendChild(el("p", "jb-details__group-lede", lede));
      var grid = el("div", "jb-details__grid");
      node.appendChild(grid);
      root.appendChild(node);
      return grid;
    }

    function field(grid, spec) {
      var wrap = el("div", "jb-details__field jb-details__field--" + spec.key.replace(/\./g, "-"));
      var input = el("input", "jb-details__input");
      input.id = nextId(spec.key.replace(/\./g, "-"));
      input.type = spec.type;
      input.name = spec.key;
      input.autocomplete = spec.autocomplete;
      input.placeholder = spec.placeholder || "";
      input.spellcheck = spec.type === "text";
      input.dataset.field = spec.key;
      var label = el("label", "jb-details__label", spec.label);
      label.htmlFor = input.id;
      var hint = el("p", "jb-details__hint", spec.hint || "");
      hint.id = nextId("hint");
      hint.hidden = !spec.hint;
      hint.dataset.base = spec.hint || "";
      var error = el("p", "jb-details__error");
      error.id = nextId("error");
      error.hidden = true;
      input.setAttribute("aria-describedby", hint.id + " " + error.id);
      input.addEventListener("input", function () {
        if (spec.key === "headline") headlineConfirmed = true;
        clearFieldError(spec.key);
        clearProvenance(spec.key);
        changed(spec.key);
      });
      wrap.append(label, input, hint, error);
      grid.appendChild(wrap);
      inputs[spec.key] = input;
      hints[spec.key] = hint;
      errors[spec.key] = error;
    }

    var who = group("who", "Name and headline", "Exactly as it should print — no nickname.");
    var reach = group("reach", "How to reach you");
    var linkGrid = group("links", "Links", "Printed as clickable links on your resume and letter.");
    FIELDS.forEach(function (spec) {
      field(spec.group === "who" ? who : spec.group === "reach" ? reach : linkGrid, spec);
    });

    // Up to three more links, each a label + a web address.
    var otherWrap = el("div", "jb-details__other");
    otherWrap.appendChild(el("p", "jb-details__label", "Other links"));
    otherList = el("div", "jb-details__other-list");
    otherWrap.appendChild(otherList);
    addOther = el("button", "jb-details__add", "+ Add a link");
    addOther.type = "button";
    addOther.addEventListener("click", function () {
      addOtherRow({ label: "", url: "" }, true);
      changed("otherLinks");
    });
    otherWrap.appendChild(addOther);
    linkGrid.appendChild(otherWrap);

    function refreshAddOther() {
      addOther.hidden = otherRows.length >= MAX_OTHER_LINKS;
    }

    function addOtherRow(value, focus) {
      if (otherRows.length >= MAX_OTHER_LINKS) return;
      var index = otherRows.length;
      var row = el("div", "jb-details__other-row");
      var label = el("input", "jb-details__input jb-details__input--label");
      label.id = nextId("other-label");
      label.type = "text";
      label.placeholder = "Label";
      label.value = value.label || "";
      label.setAttribute("aria-label", "Link " + (index + 1) + " label");
      var url = el("input", "jb-details__input");
      url.id = nextId("other-url");
      url.type = "url";
      url.placeholder = "https://";
      url.value = value.url || "";
      url.setAttribute("aria-label", "Link " + (index + 1) + " web address");
      var remove = el("button", "jb-details__remove", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove link " + (index + 1));
      var error = el("p", "jb-details__error");
      error.id = nextId("error");
      error.hidden = true;
      label.setAttribute("aria-describedby", error.id);
      url.setAttribute("aria-describedby", error.id);
      var record = { row: row, label: label, url: url, error: error };
      [label, url].forEach(function (input) {
        input.addEventListener("input", function () {
          error.hidden = true;
          error.textContent = "";
          label.removeAttribute("aria-invalid");
          url.removeAttribute("aria-invalid");
          changed("otherLinks");
        });
      });
      remove.addEventListener("click", function () {
        var at = otherRows.indexOf(record);
        if (at >= 0) otherRows.splice(at, 1);
        row.remove();
        refreshAddOther();
        changed("otherLinks");
      });
      row.append(label, url, remove, error);
      otherList.appendChild(row);
      otherRows.push(record);
      refreshAddOther();
      if (focus) label.focus();
    }

    function clearFieldError(key) {
      var slot = errors[key];
      if (slot) {
        slot.hidden = true;
        slot.textContent = "";
      }
      if (inputs[key]) inputs[key].removeAttribute("aria-invalid");
    }

    function clearProvenance(key) {
      var hint = hints[key];
      var input = inputs[key];
      if (!hint || !input || !input.dataset.provenance) return;
      delete input.dataset.provenance;
      delete input.dataset.confidence;
      hint.textContent = hint.dataset.base || "";
      hint.hidden = !hint.dataset.base;
      hint.classList.remove("jb-details__hint--check");
    }

    function markProvenance(key, confidence) {
      var hint = hints[key];
      var input = inputs[key];
      if (!hint || !input) return;
      var low = typeof confidence === "number" && confidence < LOW_CONFIDENCE;
      input.dataset.provenance = low ? "check" : "resume";
      input.dataset.confidence = typeof confidence === "number" ? String(confidence) : "";
      hint.textContent = low ? "From your resume — we weren't sure, check this." : "From your resume.";
      hint.hidden = false;
      hint.classList.toggle("jb-details__hint--check", low);
    }

    function getValues() {
      var out = {};
      Object.keys(inputs).forEach(function (k) {
        out[k] = inputs[k].value;
      });
      out.otherLinks = otherRows.map(function (r) {
        return { label: r.label.value, url: r.url.value };
      });
      out.headlineConfirmed = headlineConfirmed;
      return out;
    }

    function setValues(values, setOpts) {
      var so = setOpts || {};
      var v = values || {};
      var confidence = so.confidence || {};
      Object.keys(inputs).forEach(function (k) {
        var next = text(v[k]);
        if (!next) return;
        if (so.onlyEmpty && (text(inputs[k].value) || touched[k])) return;
        inputs[k].value = next;
        if (k === "headline") headlineConfirmed = !so.provenance && v.headlineConfirmed === true;
        if (so.provenance) markProvenance(k, confidence[k]);
      });
      var others = Array.isArray(v.otherLinks) ? v.otherLinks : [];
      if (others.length && !(so.onlyEmpty && (otherRows.length || touched.otherLinks))) {
        otherRows.slice().forEach(function (r) {
          r.row.remove();
        });
        otherRows = [];
        others.slice(0, MAX_OTHER_LINKS).forEach(function (o) {
          addOtherRow(o, false);
        });
      }
      refreshAddOther();
    }

    function showErrors(list) {
      Object.keys(errors).forEach(clearFieldError);
      otherRows.forEach(function (r) {
        r.error.hidden = true;
        r.error.textContent = "";
        r.label.removeAttribute("aria-invalid");
        r.url.removeAttribute("aria-invalid");
      });
      var count = 0;
      (list || []).forEach(function (e) {
        var key = fieldKeyFor(e.field || e.instancePath || "");
        var other = /^other\.(\d+)\.(label|url)$/.exec(key);
        if (other) {
          var r = otherRows[Number(other[1])];
          if (!r) return;
          r[other[2]].setAttribute("aria-invalid", "true");
          if (r.error.hidden) {
            r.error.textContent = e.message || "Check this link.";
            r.error.hidden = false;
          }
          count += 1;
          return;
        }
        if (!errors[key]) return;
        if (errors[key].hidden) {
          errors[key].textContent = e.message || "Check this field.";
          errors[key].hidden = false;
        }
        inputs[key].setAttribute("aria-invalid", "true");
        count += 1;
      });
      return count;
    }

    function focusFirstInvalid() {
      var first = root.querySelector('[aria-invalid="true"]');
      if (first && typeof first.focus === "function") first.focus();
      return !!first;
    }

    container.appendChild(root);
    if (opts.values) setValues(opts.values);
    refreshAddOther();

    /** Which fields still show a resume suggestion: key → confidence. */
    function getProvenance() {
      var out = {};
      Object.keys(inputs).forEach(function (k) {
        var input = inputs[k];
        if (!input.dataset.provenance) return;
        var c = Number(input.dataset.confidence);
        out[k] = Number.isFinite(c) && input.dataset.confidence !== "" ? c : null;
      });
      return out;
    }

    function restoreProvenance(map) {
      Object.keys(map || {}).forEach(function (k) {
        if (inputs[k] && text(inputs[k].value)) markProvenance(k, map[k] == null ? undefined : map[k]);
      });
    }

    return {
      root: root,
      getValues: getValues,
      getProvenance: getProvenance,
      restoreProvenance: restoreProvenance,
      getContact: function () {
        return toContact(getValues());
      },
      setValues: setValues,
      showErrors: showErrors,
      validate: function () {
        var list = validate(toContact(getValues()));
        showErrors(list);
        return list;
      },
      focusFirstInvalid: focusFirstInvalid,
      isDirty: function () {
        return dirty;
      },
      markClean: function () {
        dirty = false;
      },
    };
  }

  // ---------------------------------------------------------------
  // Settings → Fit Profile → "Your details"
  // ---------------------------------------------------------------

  /**
   * RESJ K2: say which resume the details came from. The server answers
   * "stored" when it read the saved resume instead of this browser's copy
   * (missing, or garbled PDF text) and "merged" when both added fields.
   */
  function refillMessage(result) {
    if (result && result.source === "stored") {
      return result.requestGarbled
        ? "Filled from your saved resume, because this browser's copy came out broken. Check the fields, then save."
        : "Filled from your saved resume. Check the fields, then save.";
    }
    if (result && result.source === "merged") {
      return "Filled the empty fields from your resume and your saved copy. Check them, then save.";
    }
    return "Filled the empty fields from your resume. Check them, then save.";
  }

  /**
   * Mount the Settings section into `slot` (fit-profile-editor.js leaves
   * #profileDetailsSlot at the top of the Fit Profile panel). Loads the
   * saved details; "Re-fill from my resume" fills EMPTY fields from the
   * stored resume; Save posts /profile/contact.
   */
  function mountSettings(slot) {
    if (!slot) return null;
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    var section = el("section", "jb-details-settings");
    section.id = "settingsYourDetails";
    var head = el("div", "jb-details-settings__head");
    var title = el("h4", "jb-details-settings__title", "Your details");
    title.id = nextId("settings-title");
    section.setAttribute("aria-labelledby", title.id);
    head.appendChild(title);
    var refill = el("button", "fp-btn fp-btn--ghost jb-details-settings__refill", "Re-fill from my resume");
    refill.type = "button";
    refill.id = "profileDetailsRefillBtn";
    head.appendChild(refill);
    section.appendChild(head);
    section.appendChild(
      el(
        "p",
        "jb-details-settings__lede",
        "Your name and contact block on every resume and cover letter. Empty fields fall back to what your resume says.",
      ),
    );
    var body = el("div", "jb-details-settings__body");
    section.appendChild(body);
    var status = el("p", "jb-details-settings__status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var saveBtn = el("button", "fp-btn fp-btn--primary jb-details-settings__save", "Save details");
    saveBtn.type = "button";
    saveBtn.id = "profileDetailsSaveBtn";
    var foot = el("div", "jb-details-settings__foot");
    foot.append(status, saveBtn);
    section.appendChild(foot);
    // RESJ2-EXTRACT: what the resume read found, so a miss is easy to spot.
    var readHost = el("div", "");
    readHost.id = "settingsResumeRead";
    section.appendChild(readHost);
    mountReadPanel(readHost);
    slot.appendChild(section);

    function setStatus(message, kind) {
      status.textContent = message || "";
      if (message) status.dataset.kind = kind || "info";
      else delete status.dataset.kind;
    }

    var form = renderForm(body, {
      headingLevel: "h5",
      onChange: function () {
        setStatus("Unsaved changes.", "info");
      },
    });

    fetchSaved().then(function (saved) {
      if (saved && saved.contact) {
        form.setValues(toValues(saved.contact), { onlyEmpty: true });
        form.markClean();
      }
      if (saved && saved.offline) {
        setStatus("Couldn't reach JobBored's local server. Your edits stay in this tab until you save.", "error");
      }
    });

    refill.addEventListener("click", async function () {
      refill.disabled = true;
      setStatus("Reading your resume…", "info");
      var store = window.CommandCenterUserContent;
      var resumeText = "";
      try {
        if (store && typeof store.getStagedResumeTextForAnalysis === "function") {
          resumeText = String((await store.getStagedResumeTextForAnalysis()) || "");
        }
      } catch (_) {
        resumeText = "";
      }
      var result = await suggest(resumeText);
      refill.disabled = false;
      if (!result || !result.values || !Object.keys(result.values).length) {
        setStatus("We couldn't find details on your resume. Fill them in here.", "info");
        return;
      }
      var before = JSON.stringify(form.getValues());
      form.setValues(toValues(result.values), {
        onlyEmpty: true,
        provenance: true,
        confidence: confidenceOf(result.suggestions),
      });
      var filled = before !== JSON.stringify(form.getValues());
      setStatus(filled ? refillMessage(result) : "Every field already has a value — clear one to re-fill it from your resume.", "info");
    });

    saveBtn.addEventListener("click", async function () {
      var problems = form.validate();
      if (problems.length) {
        form.focusFirstInvalid();
        setStatus("Fix the highlighted fields, then save.", "error");
        return;
      }
      saveBtn.disabled = true;
      setStatus("Saving…", "info");
      var result = await save(form.getContact());
      saveBtn.disabled = false;
      if (result.ok) {
        form.markClean();
        setStatus("Saved. New drafts will use these details.", "ok");
        try {
          document.dispatchEvent(new CustomEvent("jobbored:profile-details-saved", { detail: result }));
        } catch (_) {
          // ignore
        }
        return;
      }
      if (result.reason === "rejected") {
        form.showErrors(result.errors);
        form.focusFirstInvalid();
        setStatus("JobBored couldn't save these. Fix the highlighted fields.", "error");
        return;
      }
      if (result.reason === "no_profile") {
        setStatus("Save your fit profile below first — then your details can be saved with it.", "error");
        return;
      }
      setStatus(result.message || "Save failed.", "error");
    });

    return { form: form, section: section };
  }

  // ---------------------------------------------------------------
  // "What JobBored read from your resume" (RESJ2-EXTRACT)
  //
  // The text box filling after an upload is the browser pulling text out
  // of the file — instant, no AI. These helpers make the AI step visible:
  // a status line that names the provider and model while it reads, then
  // what it read (counts from the server's `read` record), or the plain
  // reason it failed. The panel lists everything so a miss is easy to spot.
  // Used by onboarding B3, Portfolio → Resume and Settings → Your details.
  // ---------------------------------------------------------------

  var PROVIDER_NAMES = {
    gemini: "Gemini",
    openrouter: "OpenRouter",
    openai: "OpenAI",
    anthropic: "Anthropic",
    local: "your local model",
    openai_compatible: "your local model",
  };

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  /** "OpenRouter (gpt-oss-120b)", "Gemini", or "your AI provider". */
  function providerLabel(provider, model) {
    var name = PROVIDER_NAMES[text(provider)] || "";
    var m = text(model);
    if (name && m) return name + " (" + m + ")";
    return name || m || "your AI provider";
  }

  /** The provider B2 verified, or null (oneflow-beat-resume.js owns the rule). */
  function verifiedProvider() {
    var beat = window.JobBoredOneFlowBeatResume;
    if (!beat || typeof beat.verifiedProviderConfig !== "function") return null;
    try {
      return beat.verifiedProviderConfig() || null;
    } catch (_) {
      return null;
    }
  }

  function readingLine(provider) {
    return "Reading your resume with " + providerLabel(provider && provider.provider, provider && provider.model) + "…";
  }

  /** Sections that are present, named in the order a resume lists them. */
  function presentSections(read) {
    var c = (read && read.counts) || {};
    var out = [];
    if (c.education) out.push("education");
    if (c.certifications) out.push("certifications");
    if (c.awards) out.push("awards");
    if (c.projects) out.push("projects");
    if (c.languages) out.push("languages");
    if (c.links) out.push("links");
    return out;
  }

  /**
   * "Read by gemini-flash: 6 roles across 3 employers, 14 achievements with
   * numbers, 22 skills, education, certifications, links." A rules-only
   * read (no model) says so instead of claiming an AI read it.
   */
  function summaryLine(read) {
    if (!read || !read.counts) return "";
    var c = read.counts;
    var parts = [];
    /* A browser-only read has no parser to confirm employers and roles, so
     * it says when they get checked instead of claiming "0 roles". */
    var unchecked = read.experienceChecked === false;
    if (!unchecked) {
      parts.push(c.employers ? plural(c.roles, "role", "roles") + " across " + plural(c.employers, "employer", "employers") : "no work history found");
    }
    parts.push(plural(c.withNumbers || 0, "achievement", "achievements") + " with numbers");
    parts.push(plural(c.skills || 0, "skill", "skills"));
    var list = parts.concat(presentSections(read)).join(", ");
    var who = read.by && read.by.model ? "Read by " + read.by.model : "Read without AI (no model has read this copy yet)";
    return who + ": " + list + "." + (unchecked ? " Work history is checked when JobBored on this computer reads it." : "");
  }

  function failedLine(message) {
    var reason = text(message) || "The AI provider didn't answer.";
    return "JobBored couldn't read your resume with AI. " + reason;
  }

  function announceRead(read) {
    try {
      document.dispatchEvent(new CustomEvent("jobbored:resume-read", { detail: { read: read } }));
    } catch (_) {
      // ignore
    }
  }

  /**
   * Have the AI read `resumeText` (POST /profile/from-resume, the same call
   * onboarding makes). Resolves { ok: true, read } or { ok: false, message,
   * locked } — locked means no provider is connected, so Try again cannot help.
   */
  async function readWithAi(resumeText) {
    var provider = verifiedProvider();
    if (!provider) {
      return {
        ok: false,
        locked: true,
        message: "Connect an AI provider in Settings so JobBored can read it. Your resume is saved.",
      };
    }
    var payload = { resumeText: String(resumeText || "") };
    Object.keys(provider).forEach(function (k) {
      payload[k] = provider[k];
    });
    try {
      var res = await apiFetch(profileUrl("/profile/from-resume"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      var data = await readJson(res);
      if (!res.ok || !data || data.ok !== true || !isObject(data.read)) {
        return {
          ok: false,
          message: (data && (text(data.message) || text(data.error))) || "The reader answered HTTP " + res.status + ".",
        };
      }
      announceRead(data.read);
      return { ok: true, read: data.read, profile: data.profile };
    } catch (_) {
      return { ok: false, message: "Couldn't reach JobBored's local server. Start it, then press Try again." };
    }
  }

  /** The saved read (GET /profile/resume/read): read, null, or undefined offline. */
  async function fetchRead() {
    try {
      var res = await apiFetch(profileUrl("/profile/resume/read"), { method: "GET" });
      var data = await readJson(res);
      if (!res.ok || !data || data.ok !== true) return undefined;
      return isObject(data.read) ? data.read : null;
    } catch (_) {
      return undefined;
    }
  }

  /**
   * The status line: running / done / failed. `onRetry` adds Try again to a
   * failure that a retry can fix.
   */
  function renderReadStatus(node, state, message, onRetry) {
    while (node.firstChild) node.removeChild(node.firstChild);
    node.className = "jb-resume-read-status";
    node.dataset.state = state;
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.hidden = !message;
    node.appendChild(el("span", "jb-resume-read-status__text", message || ""));
    if (state === "failed" && typeof onRetry === "function") {
      var retry = el("button", "jb-resume-read-status__retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", onRetry);
      node.appendChild(retry);
    }
  }

  /** "$8M+" inside an achievement, emphasized so the numbers are easy to check. */
  function achievementNode(a) {
    var li = el("li", "jb-resume-read__achievement");
    var body = text(a && a.text);
    var metrics = (a && Array.isArray(a.metrics) ? a.metrics : []).filter(Boolean);
    var cursor = 0;
    metrics.forEach(function (token) {
      var at = body.indexOf(token, cursor);
      if (at < 0) return;
      if (at > cursor) li.appendChild(document.createTextNode(body.slice(cursor, at)));
      li.appendChild(el("strong", "jb-resume-read__metric", token));
      cursor = at + token.length;
    });
    if (cursor < body.length) li.appendChild(document.createTextNode(body.slice(cursor)));
    return li;
  }

  /**
   * "Mar 2015 – May 2018", "Jan 2022 – Present" only when the resume's own
   * line was open-ended (role.present), else the start alone — a missing
   * end is never shown as current (Grok review, present-end).
   */
  function formatRoleDates(role) {
    var s = text(role && role.start);
    if (!s) return "";
    var e = text(role && role.end);
    if (e) return s + " – " + e;
    return role && role.present === true ? s + " – Present" : s;
  }

  function listBlock(label, items) {
    var block = el("div", "jb-resume-read__block");
    block.appendChild(el("h6", "jb-resume-read__label", label));
    var ul = el("ul", "jb-resume-read__list");
    items.forEach(function (item) {
      ul.appendChild(el("li", "", item));
    });
    block.appendChild(ul);
    return block;
  }

  /**
   * Render the expandable panel into `host` (replacing what was there).
   * `read` null shows the empty state; undefined (offline) hides the panel.
   */
  function renderReadPanel(host, read) {
    if (!host) return null;
    while (host.firstChild) host.removeChild(host.firstChild);
    host.hidden = read === undefined;
    if (read === undefined) return null;
    var panel = el("details", "jb-resume-read");
    var summary = el("summary", "jb-resume-read__summary");
    summary.appendChild(el("span", "jb-resume-read__title", "What JobBored read from your resume"));
    summary.appendChild(
      el("span", "jb-resume-read__counts", read ? summaryLine(read) : "No resume saved yet. Upload one in Portfolio → Resume."),
    );
    panel.appendChild(summary);
    if (!read) {
      host.appendChild(panel);
      return panel;
    }
    var body = el("div", "jb-resume-read__body");
    var contact = read.contact || {};
    var who = [text(contact.name), text(read.headline)].filter(Boolean);
    var reach = [text(contact.email), text(contact.phone), text(contact.location)]
      .concat((contact.links || []).map(function (l) { return text(l && l.url); }))
      .filter(Boolean);
    if (who.length || reach.length) {
      var contactBlock = listBlock("Contact", who.concat(reach));
      contactBlock.classList.add("jb-resume-read__block--inline");
      body.appendChild(contactBlock);
    }
    if (text(read.summary)) {
      var sum = el("div", "jb-resume-read__block");
      sum.appendChild(el("h6", "jb-resume-read__label", "Summary"));
      sum.appendChild(el("p", "jb-resume-read__prose", read.summary));
      body.appendChild(sum);
    }

    var employers = Array.isArray(read.employers) ? read.employers : [];
    if (employers.length) {
      var exp = el("div", "jb-resume-read__block");
      exp.appendChild(el("h6", "jb-resume-read__label", "Experience"));
      employers.forEach(function (e) {
        var item = el("div", "jb-resume-read__employer");
        var name = text(e.name) + (e.formerly && e.formerly.length ? " (formerly " + e.formerly.join(", ") + ")" : "");
        item.appendChild(el("p", "jb-resume-read__employer-name", name));
        var roles = el("ul", "jb-resume-read__roles");
        (e.roles || []).forEach(function (r) {
          var d = formatRoleDates(r);
          roles.appendChild(el("li", "", text(r.title) + (d ? ", " + d : "")));
        });
        if (roles.firstChild) item.appendChild(roles);
        var ach = e.achievements || [];
        if (ach.length) {
          var achList = el("ul", "jb-resume-read__achievements");
          ach.forEach(function (a) {
            achList.appendChild(achievementNode(a));
          });
          item.appendChild(achList);
        }
        exp.appendChild(item);
      });
      body.appendChild(exp);
    }
    if (Array.isArray(read.highlights) && read.highlights.length) {
      var hl = el("div", "jb-resume-read__block");
      hl.appendChild(el("h6", "jb-resume-read__label", "Other achievements"));
      var hlList = el("ul", "jb-resume-read__achievements");
      read.highlights.forEach(function (a) {
        hlList.appendChild(achievementNode(a));
      });
      hl.appendChild(hlList);
      body.appendChild(hl);
    }

    var skills = read.skills || {};
    var skillGroups = [
      ["Skills", skills.hard],
      ["Tools", skills.tools],
      ["Soft skills", skills.soft],
    ].filter(function (g) {
      return Array.isArray(g[1]) && g[1].length;
    });
    if (skillGroups.length) {
      var sk = el("div", "jb-resume-read__block");
      skillGroups.forEach(function (g) {
        sk.appendChild(el("h6", "jb-resume-read__label", g[0]));
        var chips = el("ul", "jb-resume-read__chips");
        g[1].forEach(function (s) {
          chips.appendChild(el("li", "jb-resume-read__chip", s));
        });
        sk.appendChild(chips);
      });
      body.appendChild(sk);
    }

    var missing = [];
    [
      ["Education", read.education],
      ["Certifications", read.certifications],
      ["Awards", read.awards],
      ["Languages", read.languages],
    ].forEach(function (g) {
      if (Array.isArray(g[1]) && g[1].length) body.appendChild(listBlock(g[0], g[1]));
      else missing.push(g[0].toLowerCase());
    });
    var projects = Array.isArray(read.projects) ? read.projects : [];
    if (projects.length) {
      body.appendChild(
        listBlock(
          "Projects",
          projects.map(function (p) {
            return text(p.name) + (text(p.url) ? " (" + text(p.url) + ")" : "");
          }),
        ),
      );
    } else {
      missing.push("projects");
    }
    if (!employers.length) missing.unshift("work history");

    var foot = el("p", "jb-resume-read__foot");
    var lines = [];
    if (missing.length) lines.push("Not found on your resume: " + missing.join(", ") + ".");
    if (read.dropped) {
      lines.push(
        plural(read.dropped, "thing", "things") +
          " the AI named " + (read.dropped === 1 ? "isn't" : "aren't") + " on your resume, so " +
          (read.dropped === 1 ? "it was" : "they were") + " left out.",
      );
    }
    lines.push("Everything here is copied from your resume. Something missing? Fix it in the resume and upload it again.");
    foot.textContent = lines.join(" ");
    body.appendChild(foot);
    panel.appendChild(body);
    host.appendChild(panel);
    return panel;
  }

  /**
   * Mount a self-updating panel: loads the saved read, and redraws when an
   * upload anywhere in the app finishes a read.
   */
  function mountReadPanel(host) {
    if (!host) return null;
    host.classList.add("jb-resume-read-host");
    fetchRead().then(function (read) {
      renderReadPanel(host, read);
    });
    document.addEventListener("jobbored:resume-read", function (event) {
      var detail = event && event.detail;
      if (detail && isObject(detail.read) && host.isConnected) renderReadPanel(host, detail.read);
    });
    return host;
  }

  window.JobBoredResumeRead = {
    providerLabel: providerLabel,
    readingLine: readingLine,
    formatRoleDates: formatRoleDates,
    summaryLine: summaryLine,
    failedLine: failedLine,
    readWithAi: readWithAi,
    fetchRead: fetchRead,
    announceRead: announceRead,
    renderReadStatus: renderReadStatus,
    renderReadPanel: renderReadPanel,
    mountReadPanel: mountReadPanel,
  };

  window.JobBoredProfileIdentity = {
    MAX_OTHER_LINKS: MAX_OTHER_LINKS,
    LOW_CONFIDENCE: LOW_CONFIDENCE,
    CONTACT_KEYS: CONTACT_KEYS,
    suggest: suggest,
    fetchSaved: fetchSaved,
    save: save,
    toContact: toContact,
    toValues: toValues,
    contactOf: contactOf,
    confidenceOf: confidenceOf,
    validate: validate,
    renderForm: renderForm,
    mountSettings: mountSettings,
  };
})();
