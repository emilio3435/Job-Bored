/**
 * fit-profile-wizard.js — Task #4 onboarding flow + shared form builder.
 *
 * Responsibilities:
 *   1. Render the 5-step onboarding wizard at #/onboarding/fit-profile.
 *      Steps mirror the schema buckets: identity → strengths → wants →
 *      avoids → hard constraints, plus a Review screen.
 *   2. Expose `window.FitProfileForm` — the renderer for each of the 5
 *      buckets, reused by fit-profile-editor.js (Settings → Fit Profile).
 *   3. Build canonical JSON shaped per user-profile.schema.json and POST
 *      it to /profile.
 *
 * Networking:
 *   The Express server with /profile lives at the same origin as the
 *   existing /api/scrape-job. We reuse the same "localhost defaults to
 *   127.0.0.1:3847" rule that app.js already uses.
 *
 * No dependency on legacy onboarding or settings-profile-tab.js.
 * Vanilla JS, IIFE, talks to globals only.
 */
(function () {
  "use strict";

  /* ── Config ───────────────────────────────────────────────────────── */

  var PROFILE_SCHEMA_VERSION = 1;
  var WORK_MODES = [
    { id: "any", label: "Any" },
    { id: "remote_only", label: "Remote only" },
    { id: "hybrid_ok", label: "Hybrid OK" },
    { id: "onsite_ok", label: "Onsite OK" },
  ];
  var SENIORITY_OPTIONS = [
    "intern",
    "entry",
    "ic_mid",
    "ic_senior",
    "ic_staff",
    "ic_principal",
    "manager",
    "director",
    "head",
    "vp",
    "c_level",
    "any",
  ];
  var WORK_AUTH_OPTIONS = [
    { id: "any", label: "Any" },
    { id: "us_citizen", label: "US citizen" },
    { id: "us_authorized", label: "US authorized" },
    { id: "needs_sponsorship", label: "Needs sponsorship" },
  ];
  var NARRATIVE_MIN = 20;
  var NARRATIVE_MAX = 1200;
  var TARGET_ROLES_MAX = 8;
  var STRENGTHS_MAX = 8;
  var WANTS_MAX = 12;
  var AVOIDS_MAX = 12;
  var ACCEPTABLE_LOCATIONS_MAX = 20;
  var SKIP_TITLES_MAX = 30;

  var TEMPLATES_AVAILABLE = [
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

  /* ── Server-base resolver ─────────────────────────────────────────── */
  // Mirrors app.js: explicit config wins, else localhost defaults to 3847.
  function getProfileApiBase() {
    var cfg = window.COMMAND_CENTER_CONFIG || {};
    var raw =
      cfg.jobBoredApiUrl ||
      cfg.jobPostingScrapeUrl /* same scraper server hosts both */ ||
      "";
    if (raw && typeof raw === "string" && raw.trim()) {
      return String(raw).trim().replace(/\/+$/, "");
    }
    if (typeof window === "undefined") return "";
    var h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
      return "http://127.0.0.1:3847";
    }
    return "";
  }

  function profileUrl(path) {
    var base = getProfileApiBase();
    return (base || "") + path;
  }

  async function fetchTemplate(id) {
    var res = await fetch(profileUrl("/profile/template/" + encodeURIComponent(id)), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    var data = await res.json().catch(function () {
      return null;
    });
    if (!res.ok || !data || data.ok !== true) {
      throw new Error(
        (data && data.reason ? data.reason : "template_fetch_failed") +
          " (HTTP " + res.status + ")",
      );
    }
    return data.template;
  }

  /**
   * Ask the server to read the stored resume + run it through Gemini.
   * Returns the v1 UserProfile draft. Throws on 404/500 with a code we can
   * branch on in the caller (`no_resume_stored`, `gemini_*`).
   */
  async function fetchProfileFromResume() {
    var res = await fetch(profileUrl("/profile/from-resume"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    var data = await res.json().catch(function () {
      return null;
    });
    if (res.status === 404) {
      var err404 = new Error("No resume on file.");
      err404.code = (data && data.reason) || "no_resume_stored";
      throw err404;
    }
    if (!res.ok || !data || data.ok !== true) {
      var reason = data && data.reason ? data.reason : "from_resume_failed";
      var msg = data && data.message ? data.message : "HTTP " + res.status;
      var err = new Error(msg);
      err.code = reason;
      throw err;
    }
    return { profile: data.profile, source: data.source };
  }

  async function fetchProfile() {
    var res = await fetch(profileUrl("/profile"));
    var data = await res.json().catch(function () {
      return null;
    });
    if (!data) throw new Error("profile_response_invalid");
    return data;
  }

  async function saveProfile(profile) {
    var res = await fetch(profileUrl("/profile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    var data = await res.json().catch(function () {
      return null;
    });
    return { httpStatus: res.status, data: data };
  }

  /* ── Tiny DOM helpers ─────────────────────────────────────────────── */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === "class") node.className = v;
        else if (k === "style" && typeof v === "object") {
          Object.assign(node.style, v);
        } else if (k.indexOf("on") === 0 && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "html") {
          node.innerHTML = v;
        } else if (v === true) {
          node.setAttribute(k, "");
        } else if (v !== false && v != null) {
          node.setAttribute(k, String(v));
        }
      });
    }
    if (Array.isArray(children)) {
      children.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    } else if (typeof children === "string") {
      node.textContent = children;
    } else if (children) {
      node.appendChild(children);
    }
    return node;
  }

  function clearChildren(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  /* ── Profile state (mutable working draft) ───────────────────────── */

  function emptyProfile() {
    return {
      version: PROFILE_SCHEMA_VERSION,
      identity: {
        targetRoles: [""],
        targetSeniority: "any",
        yearsRelevantExperience: undefined,
        primaryNarrative: "",
      },
      strengths: [],
      wants: [],
      avoids: [],
      hardConstraints: {
        workMode: "any",
        acceptableLocations: [],
        workAuth: "any",
        skipTitles: [],
        salaryFloor: null,
        salaryRequired: false,
      },
    };
  }

  /**
   * Build a clean JSON object ready to send to POST /profile. Strips
   * empties, undefineds, and the wizard-only fields the schema rejects.
   */
  function buildPayload(state) {
    var p = {
      version: PROFILE_SCHEMA_VERSION,
    };
    if (state.starterTemplate && state.starterTemplate !== "blank") {
      p.starterTemplate = state.starterTemplate;
    } else if (state.starterTemplate === "blank") {
      p.starterTemplate = "custom";
    }
    // Identity
    var id = state.identity || {};
    var roles = (id.targetRoles || [])
      .map(function (r) { return String(r || "").trim(); })
      .filter(function (r) { return r.length > 0; });
    p.identity = {
      targetRoles: roles,
      targetSeniority: id.targetSeniority || "any",
      primaryNarrative: String(id.primaryNarrative || "").trim(),
    };
    if (Number.isFinite(id.yearsRelevantExperience) && id.yearsRelevantExperience >= 0) {
      p.identity.yearsRelevantExperience = Math.floor(id.yearsRelevantExperience);
    }
    // Strengths — rank = list order (1-based)
    p.strengths = (state.strengths || [])
      .map(function (s, i) {
        var name = String(s && s.name ? s.name : "").trim();
        if (!name) return null;
        var entry = { name: name, rank: i + 1 };
        var ev = String(s && s.evidence ? s.evidence : "").trim();
        if (ev) entry.evidence = ev;
        var kws = (s && Array.isArray(s.keywords) ? s.keywords : [])
          .map(function (k) { return String(k || "").trim(); })
          .filter(function (k) { return k.length > 0; });
        if (kws.length) entry.keywords = kws;
        return entry;
      })
      .filter(Boolean);
    // Wants
    var wants = (state.wants || [])
      .map(function (w) { return String(w || "").trim(); })
      .filter(function (w) { return w.length > 0; });
    if (wants.length) p.wants = wants;
    // Avoids
    var avoids = (state.avoids || [])
      .map(function (w) { return String(w || "").trim(); })
      .filter(function (w) { return w.length > 0; });
    if (avoids.length) p.avoids = avoids;
    // Hard constraints
    var hc = state.hardConstraints || {};
    var locations = (hc.acceptableLocations || [])
      .map(function (s) { return String(s || "").trim(); })
      .filter(function (s) { return s.length > 0; });
    var skipTitles = (hc.skipTitles || [])
      .map(function (s) { return String(s || "").trim(); })
      .filter(function (s) { return s.length > 0; });
    var hardConstraints = {
      workMode: hc.workMode || "any",
    };
    if (locations.length) hardConstraints.acceptableLocations = locations;
    if (hc.workAuth && hc.workAuth !== "any") hardConstraints.workAuth = hc.workAuth;
    else hardConstraints.workAuth = "any";
    if (skipTitles.length) hardConstraints.skipTitles = skipTitles;
    if (hc.salaryRequired === true) hardConstraints.salaryRequired = true;
    if (Number.isFinite(hc.salaryFloor) && hc.salaryFloor > 0) {
      hardConstraints.salaryFloor = Math.floor(hc.salaryFloor);
    } else if (hc.salaryFloor === null) {
      hardConstraints.salaryFloor = null;
    }
    p.hardConstraints = hardConstraints;
    return p;
  }

  /**
   * Client-side warnings. NOT authoritative — the server's ajv pass is.
   * Returns [] when nothing to warn about.
   */
  function validateClientSide(payload) {
    var problems = [];
    if (!payload.identity || !Array.isArray(payload.identity.targetRoles) ||
        payload.identity.targetRoles.length === 0) {
      problems.push("Add at least one target role.");
    }
    var narr = String(payload.identity && payload.identity.primaryNarrative || "");
    if (narr.length < NARRATIVE_MIN) {
      problems.push("Narrative is too short — aim for at least " + NARRATIVE_MIN + " characters.");
    }
    if (narr.length > NARRATIVE_MAX) {
      problems.push("Narrative is too long — keep under " + NARRATIVE_MAX + " characters.");
    }
    if (!Array.isArray(payload.strengths) || payload.strengths.length === 0) {
      problems.push("Add at least one strength.");
    }
    var hc = payload.hardConstraints || {};
    if (hc.workMode !== "remote_only" &&
        hc.acceptableLocations &&
        hc.acceptableLocations.length === 0 &&
        (hc.workMode === "hybrid_ok" || hc.workMode === "onsite_ok")) {
      // Soft: schema allows missing acceptableLocations even on onsite/hybrid,
      // but warn the user it'll defeat the pre-filter.
      problems.push(
        "You picked " + hc.workMode +
          " but didn't list any acceptable locations — the listing filter won't reject onsite jobs by location.",
      );
    }
    return problems;
  }

  /* ── Shared form builders (one per bucket) ─────────────────────────
   * Each takes the live state object + an onChange callback. They mutate
   * state in place and call onChange() so the host (wizard or settings)
   * can re-render or update progress.
   */

  function renderTargetRolesList(state, onChange) {
    var wrap = el("div");
    var listEl = el("ul", { class: "fp-list" });

    function rerender() {
      clearChildren(listEl);
      state.identity.targetRoles.forEach(function (role, idx) {
        var input = el("input", {
          type: "text",
          class: "fp-input",
          value: role,
          maxlength: 80,
          placeholder: "e.g., Senior Product Manager",
          oninput: function (ev) {
            state.identity.targetRoles[idx] = ev.target.value;
            onChange();
          },
        });
        var handleUp = el(
          "button",
          {
            type: "button",
            class: "fp-list__handle",
            title: "Move up",
            "aria-label": "Move up",
            disabled: idx === 0,
            onclick: function () {
              if (idx === 0) return;
              var tmp = state.identity.targetRoles[idx - 1];
              state.identity.targetRoles[idx - 1] = state.identity.targetRoles[idx];
              state.identity.targetRoles[idx] = tmp;
              onChange();
              rerender();
            },
          },
          "↑",
        );
        var handleDown = el(
          "button",
          {
            type: "button",
            class: "fp-list__handle",
            title: "Move down",
            "aria-label": "Move down",
            disabled: idx === state.identity.targetRoles.length - 1,
            onclick: function () {
              if (idx === state.identity.targetRoles.length - 1) return;
              var tmp = state.identity.targetRoles[idx + 1];
              state.identity.targetRoles[idx + 1] = state.identity.targetRoles[idx];
              state.identity.targetRoles[idx] = tmp;
              onChange();
              rerender();
            },
          },
          "↓",
        );
        var rank = el("span", { class: "fp-list__rank" }, String(idx + 1));
        var remove = el(
          "button",
          {
            type: "button",
            class: "fp-list__remove",
            title: "Remove",
            onclick: function () {
              state.identity.targetRoles.splice(idx, 1);
              if (state.identity.targetRoles.length === 0) {
                state.identity.targetRoles.push("");
              }
              onChange();
              rerender();
            },
          },
          "Remove",
        );
        var item = el("li", { class: "fp-list__item" }, [
          handleUp,
          handleDown,
          rank,
          el("div", { class: "fp-list__body" }, [input]),
          remove,
        ]);
        listEl.appendChild(item);
      });
    }

    var addBtn = el(
      "button",
      {
        type: "button",
        class: "fp-btn fp-btn--ghost",
        disabled: state.identity.targetRoles.length >= TARGET_ROLES_MAX,
        onclick: function () {
          if (state.identity.targetRoles.length >= TARGET_ROLES_MAX) return;
          state.identity.targetRoles.push("");
          onChange();
          rerender();
          addBtn.disabled = state.identity.targetRoles.length >= TARGET_ROLES_MAX;
        },
      },
      "+ Add another role",
    );

    rerender();
    wrap.appendChild(listEl);
    wrap.appendChild(addBtn);
    wrap.appendChild(
      el(
        "p",
        { class: "fp-field__hint" },
        "Order matters — most-wanted role first. Max " + TARGET_ROLES_MAX + ".",
      ),
    );
    return wrap;
  }

  function renderIdentityForm(state, onChange) {
    var box = el("div");

    // Target roles
    box.appendChild(
      el("div", { class: "fp-field" }, [
        el("label", { class: "fp-field__label" }, "Target roles"),
        renderTargetRolesList(state, onChange),
      ]),
    );

    // Seniority
    var senSelect = el("select", { class: "fp-select" });
    SENIORITY_OPTIONS.forEach(function (s) {
      var opt = el("option", { value: s }, s);
      if (state.identity.targetSeniority === s) opt.selected = true;
      senSelect.appendChild(opt);
    });
    senSelect.addEventListener("change", function () {
      state.identity.targetSeniority = senSelect.value;
      onChange();
    });
    box.appendChild(
      el("div", { class: "fp-field" }, [
        el("label", { class: "fp-field__label" }, "Target seniority"),
        senSelect,
      ]),
    );

    // Years
    var yearsInput = el("input", {
      type: "number",
      class: "fp-input",
      min: "0",
      max: "60",
      step: "1",
      placeholder: "Optional",
      value: Number.isFinite(state.identity.yearsRelevantExperience)
        ? String(state.identity.yearsRelevantExperience)
        : "",
      oninput: function () {
        var raw = yearsInput.value.trim();
        if (raw === "") {
          state.identity.yearsRelevantExperience = undefined;
        } else {
          var n = Number(raw);
          state.identity.yearsRelevantExperience = Number.isFinite(n) ? n : undefined;
        }
        onChange();
      },
    });
    box.appendChild(
      el("div", { class: "fp-field" }, [
        el("label", { class: "fp-field__label" }, "Years of relevant experience"),
        yearsInput,
      ]),
    );

    // Narrative
    var narrativeTextarea = el("textarea", {
      class: "fp-textarea",
      maxlength: NARRATIVE_MAX + 50, // soft slack, char counter governs
      rows: "5",
      placeholder:
        "1–4 sentences. First person. Who you are, what you've shipped, what you want next.",
    });
    narrativeTextarea.value = state.identity.primaryNarrative || "";
    var counter = el("div", { class: "fp-counter" });
    function updateCounter() {
      var len = narrativeTextarea.value.length;
      counter.textContent =
        len + " / " + NARRATIVE_MAX + " chars (min " + NARRATIVE_MIN + ")";
      counter.dataset.warn = String(len < NARRATIVE_MIN || len > NARRATIVE_MAX);
    }
    narrativeTextarea.addEventListener("input", function () {
      state.identity.primaryNarrative = narrativeTextarea.value;
      updateCounter();
      onChange();
    });
    updateCounter();
    box.appendChild(
      el("div", { class: "fp-field" }, [
        el("label", { class: "fp-field__label" }, "Primary narrative"),
        narrativeTextarea,
        counter,
        el(
          "p",
          { class: "fp-field__hint" },
          "This goes verbatim into the LLM scoring prompt — write it for the model.",
        ),
      ]),
    );

    return box;
  }

  function renderStrengthsList(state, onChange) {
    var wrap = el("div");
    var listEl = el("ul", { class: "fp-list" });

    function rerender() {
      clearChildren(listEl);
      state.strengths.forEach(function (s, idx) {
        var nameInput = el("input", {
          type: "text",
          class: "fp-input",
          value: s.name || "",
          maxlength: 60,
          placeholder: "Strength name (e.g., Distributed systems)",
          oninput: function () {
            state.strengths[idx].name = nameInput.value;
            onChange();
          },
        });
        var evidenceArea = el("textarea", {
          class: "fp-textarea",
          maxlength: 400,
          rows: "2",
          placeholder: "Optional 1–2 sentence proof point.",
        });
        evidenceArea.value = s.evidence || "";
        evidenceArea.addEventListener("input", function () {
          state.strengths[idx].evidence = evidenceArea.value;
          onChange();
        });
        var keywordsBox = renderChipInput({
          values: Array.isArray(s.keywords) ? s.keywords : [],
          placeholder: "Optional keyword + Enter",
          max: 20,
          onChange: function (next) {
            state.strengths[idx].keywords = next;
            onChange();
          },
        });

        var handleUp = el(
          "button",
          {
            type: "button",
            class: "fp-list__handle",
            disabled: idx === 0,
            title: "Move up",
            "aria-label": "Move up",
            onclick: function () {
              if (idx === 0) return;
              var tmp = state.strengths[idx - 1];
              state.strengths[idx - 1] = state.strengths[idx];
              state.strengths[idx] = tmp;
              onChange();
              rerender();
            },
          },
          "↑",
        );
        var handleDown = el(
          "button",
          {
            type: "button",
            class: "fp-list__handle",
            disabled: idx === state.strengths.length - 1,
            title: "Move down",
            "aria-label": "Move down",
            onclick: function () {
              if (idx === state.strengths.length - 1) return;
              var tmp = state.strengths[idx + 1];
              state.strengths[idx + 1] = state.strengths[idx];
              state.strengths[idx] = tmp;
              onChange();
              rerender();
            },
          },
          "↓",
        );
        var rank = el("span", { class: "fp-list__rank" }, String(idx + 1));
        var remove = el(
          "button",
          {
            type: "button",
            class: "fp-list__remove",
            onclick: function () {
              state.strengths.splice(idx, 1);
              onChange();
              rerender();
            },
          },
          "Remove",
        );

        var body = el("div", { class: "fp-list__body" }, [
          nameInput,
          evidenceArea,
          el("label", { class: "fp-field__hint" }, "Keywords (optional)"),
          keywordsBox,
        ]);
        var item = el("li", { class: "fp-list__item" }, [
          handleUp,
          handleDown,
          rank,
          body,
          remove,
        ]);
        listEl.appendChild(item);
      });
    }

    var addBtn = el(
      "button",
      {
        type: "button",
        class: "fp-btn fp-btn--ghost",
        onclick: function () {
          if (state.strengths.length >= STRENGTHS_MAX) return;
          state.strengths.push({ name: "", evidence: "", keywords: [] });
          onChange();
          rerender();
        },
      },
      "+ Add a strength",
    );

    rerender();
    wrap.appendChild(listEl);
    wrap.appendChild(addBtn);
    wrap.appendChild(
      el(
        "p",
        { class: "fp-field__hint" },
        "Rank = order. Top of the list = rank 1 = highest weight in scoring. Max " +
          STRENGTHS_MAX +
          ".",
      ),
    );
    return wrap;
  }

  /**
   * Chip input. Adds on Enter or comma; removes on click. Returns the
   * container element; calls opts.onChange with the next array.
   */
  function renderChipInput(opts) {
    var values = Array.isArray(opts.values) ? opts.values.slice() : [];
    var max = Number.isFinite(opts.max) ? opts.max : 99;
    var wrap = el("div");
    var chipsRow = el("div", { class: "fp-chips" });
    var addRow = el("div", { class: "fp-list__add-row" });

    var input = el("input", {
      type: "text",
      class: "fp-input",
      placeholder: opts.placeholder || "Add and press Enter",
      maxlength: 200,
    });

    function rerenderChips() {
      clearChildren(chipsRow);
      values.forEach(function (v, idx) {
        var chip = el("span", { class: "fp-chip" }, [
          document.createTextNode(v),
          el(
            "button",
            {
              type: "button",
              class: "fp-chip__remove",
              "aria-label": "Remove " + v,
              onclick: function () {
                values.splice(idx, 1);
                opts.onChange(values.slice());
                rerenderChips();
                addBtn.disabled = values.length >= max;
              },
            },
            "×",
          ),
        ]);
        chipsRow.appendChild(chip);
      });
    }

    function commit() {
      var raw = input.value.trim();
      if (!raw) return;
      // Allow comma-separated paste in one shot.
      var parts = raw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      parts.forEach(function (p) {
        if (values.length >= max) return;
        if (values.indexOf(p) === -1) values.push(p);
      });
      input.value = "";
      opts.onChange(values.slice());
      rerenderChips();
      addBtn.disabled = values.length >= max;
    }

    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === ",") {
        ev.preventDefault();
        commit();
      }
    });

    var addBtn = el(
      "button",
      {
        type: "button",
        class: "fp-btn fp-btn--ghost",
        disabled: values.length >= max,
        onclick: commit,
      },
      "Add",
    );

    rerenderChips();
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    wrap.appendChild(chipsRow);
    wrap.appendChild(addRow);
    return wrap;
  }

  function renderWantsAvoids(state, key, max, onChange) {
    var box = el("div");
    box.appendChild(
      renderChipInput({
        values: state[key] || [],
        placeholder: "Add a " + (key === "wants" ? "want" : "avoid") + " and press Enter",
        max: max,
        onChange: function (next) {
          state[key] = next;
          onChange();
        },
      }),
    );
    box.appendChild(
      el(
        "p",
        { class: "fp-field__hint" },
        "Free-form English. Max " + max + ". Examples: " +
          (key === "wants"
            ? '"hands-on coding", "P&L responsibility", "small team".'
            : '"pure people management", "enterprise sales", "agency work".'),
      ),
    );
    return box;
  }

  function renderHardConstraints(state, onChange) {
    var box = el("div");
    var hc = state.hardConstraints;

    // Work mode radios
    var radioGroup = el("div", { class: "fp-radio-group", role: "radiogroup" });
    var locationField; // referenced below; revealed unless remote_only.
    function repaintRadios() {
      Array.from(radioGroup.querySelectorAll(".fp-radio")).forEach(function (label) {
        label.dataset.checked = String(label.dataset.value === hc.workMode);
      });
      if (locationField) {
        locationField.style.display = hc.workMode === "remote_only" ? "none" : "";
      }
    }
    WORK_MODES.forEach(function (m) {
      var label = el(
        "label",
        {
          class: "fp-radio",
          "data-value": m.id,
          "data-checked": String(hc.workMode === m.id),
        },
        [
          el("input", {
            type: "radio",
            name: "fp-workmode",
            value: m.id,
            checked: hc.workMode === m.id,
            onchange: function () {
              hc.workMode = m.id;
              onChange();
              repaintRadios();
            },
          }),
          document.createTextNode(m.label),
        ],
      );
      radioGroup.appendChild(label);
    });
    box.appendChild(
      el("div", { class: "fp-field" }, [
        el("label", { class: "fp-field__label" }, "Work mode"),
        radioGroup,
      ]),
    );

    // Acceptable locations
    locationField = el("div", { class: "fp-field" }, [
      el("label", { class: "fp-field__label" }, "Acceptable locations"),
      renderChipInput({
        values: hc.acceptableLocations || [],
        placeholder: "City or metro, then Enter (e.g., Austin)",
        max: ACCEPTABLE_LOCATIONS_MAX,
        onChange: function (next) {
          hc.acceptableLocations = next;
          onChange();
        },
      }),
      el(
        "p",
        { class: "fp-field__hint" },
        "Used only for onsite/hybrid listings. Remote-only ignores this.",
      ),
    ]);
    if (hc.workMode === "remote_only") locationField.style.display = "none";
    box.appendChild(locationField);

    // Salary
    var salaryFloorInput = el("input", {
      type: "number",
      class: "fp-input",
      min: "0",
      step: "1000",
      placeholder: "e.g., 180000 (optional)",
      value: Number.isFinite(hc.salaryFloor) && hc.salaryFloor > 0
        ? String(hc.salaryFloor)
        : "",
      oninput: function () {
        var raw = salaryFloorInput.value.trim();
        if (raw === "") {
          hc.salaryFloor = null;
        } else {
          var n = Number(raw);
          hc.salaryFloor = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        }
        onChange();
      },
    });
    var salaryRequiredInput = el("input", {
      type: "checkbox",
      checked: hc.salaryRequired === true,
      onchange: function () {
        hc.salaryRequired = !!salaryRequiredInput.checked;
        onChange();
      },
    });
    var salaryRow = el("div", { class: "fp-inline-row" }, [
      el("div", { style: { flex: "1 1 200px" } }, [
        el("label", { class: "fp-field__label" }, "Salary floor (USD/year)"),
        salaryFloorInput,
      ]),
      el("label", { class: "fp-toggle-label" }, [
        salaryRequiredInput,
        document.createTextNode("Reject listings without published salary"),
      ]),
    ]);
    box.appendChild(el("div", { class: "fp-field" }, [salaryRow]));

    // Work auth
    var authSelect = el("select", { class: "fp-select" });
    WORK_AUTH_OPTIONS.forEach(function (o) {
      var opt = el("option", { value: o.id }, o.label);
      if ((hc.workAuth || "any") === o.id) opt.selected = true;
      authSelect.appendChild(opt);
    });
    authSelect.addEventListener("change", function () {
      hc.workAuth = authSelect.value;
      onChange();
    });
    box.appendChild(
      el("div", { class: "fp-field" }, [
        el("label", { class: "fp-field__label" }, "Work authorization"),
        authSelect,
      ]),
    );

    // Skip titles
    box.appendChild(
      el("div", { class: "fp-field" }, [
        el("label", { class: "fp-field__label" }, "Skip titles"),
        renderChipInput({
          values: hc.skipTitles || [],
          placeholder: "Title substring to hard-reject",
          max: SKIP_TITLES_MAX,
          onChange: function (next) {
            hc.skipTitles = next;
            onChange();
          },
        }),
        el(
          "p",
          { class: "fp-field__hint" },
          "Case-insensitive substring match. Hard-rejected before LLM scoring.",
        ),
      ]),
    );

    return box;
  }

  /* ── Wizard plumbing ──────────────────────────────────────────────── */

  var wizardState = null;
  var wizardEls = {};

  function ensureWizardRoot() {
    var root = document.getElementById("fitProfileWizard");
    if (!root) {
      root = document.createElement("div");
      root.id = "fitProfileWizard";
      root.className = "fp-wizard";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-labelledby", "fpWizardTitle");
      document.body.appendChild(root);
    }
    return root;
  }

  function buildWizardShell() {
    var root = ensureWizardRoot();
    clearChildren(root);
    var inner = el("div", { class: "fp-wizard__inner" });

    var stepLabel = el("span", { class: "fp-wizard__step-label" }, "Step 1 of 6");
    var head = el("div", { class: "fp-wizard__head" }, [
      el("h2", { class: "fp-wizard__title", id: "fpWizardTitle" }, "Fit profile setup"),
      stepLabel,
    ]);
    var progress = el("div", { class: "fp-wizard__progress" }, [
      el("div", { class: "fp-wizard__progress-fill", style: { width: "16%" } }),
    ]);
    var errorEl = el("div", { class: "fp-wizard__error", style: { display: "none" } });

    var panels = {};
    [
      { id: 1, key: "template", title: "Pick a starting point",
        lede: "Pick a template to seed strengths and target roles. You can edit every field — templates are not locks." },
      { id: 2, key: "identity", title: "Identity",
        lede: "Who you are and what you want next. The primary narrative goes straight into the LLM scoring prompt." },
      { id: 3, key: "strengths", title: "Strengths",
        lede: "Capability areas, ranked 1 (top) to 8. Each can have optional evidence + keywords." },
      { id: 4, key: "wants", title: "Wants",
        lede: "Specific things you want the role to involve." },
      { id: 5, key: "avoids", title: "Avoids",
        lede: 'Soft "please skip" signals. The LLM uses these to penalize matches, not reject them.' },
      { id: 6, key: "hard", title: "Hard constraints",
        lede: "The only rules that hard-reject a listing before the LLM ever sees it." },
      { id: 7, key: "review", title: "Review & confirm",
        lede: "This is the JSON we'll save to ~/.jobbored/profile.json. Edit any step from the back button." },
    ].forEach(function (panel) {
      var node = el("section", {
        class: "fp-wizard__panel",
        "data-step": String(panel.id),
        "data-active": panel.id === 1 ? "true" : "false",
      }, [
        el("h3", { class: "fp-wizard__panel-title" }, panel.title),
        el("p", { class: "fp-wizard__panel-lede" }, panel.lede),
        el("div", { class: "fp-wizard__panel-body", "data-key": panel.key }),
      ]);
      panels[panel.id] = node;
      inner.appendChild(node);
    });

    var backBtn = el(
      "button",
      { type: "button", class: "fp-btn fp-btn--ghost", onclick: function () { goToStep(currentStep - 1); } },
      "Back",
    );
    var cancelBtn = el(
      "button",
      { type: "button", class: "fp-btn fp-btn--ghost", onclick: closeWizard },
      "Cancel",
    );
    var nextBtn = el(
      "button",
      { type: "button", class: "fp-btn fp-btn--primary", onclick: function () { goToStep(currentStep + 1); } },
      "Continue",
    );
    var saveBtn = el(
      "button",
      { type: "button", class: "fp-btn fp-btn--primary", onclick: submitWizard },
      "Looks good — save profile",
    );
    var actionsRight = el("div", { class: "fp-wizard__actions-right" }, [nextBtn, saveBtn]);
    var actions = el("div", { class: "fp-wizard__actions" }, [
      el("div", {}, [cancelBtn, backBtn]),
      actionsRight,
    ]);

    inner.appendChild(errorEl);
    inner.appendChild(actions);
    root.appendChild(el("div", { class: "fp-wizard__head-wrap" }, [head]));
    root.insertBefore(progress, root.firstChild ? root.firstChild.nextSibling : null);
    root.appendChild(inner);

    wizardEls = {
      root: root,
      panels: panels,
      stepLabel: stepLabel,
      progressFill: progress.firstChild,
      backBtn: backBtn,
      nextBtn: nextBtn,
      saveBtn: saveBtn,
      errorEl: errorEl,
    };
  }

  var currentStep = 1;
  var TOTAL_STEPS = 7;

  function paintBucket(key) {
    var bodyEl = wizardEls.panels[currentStep].querySelector(".fp-wizard__panel-body");
    clearChildren(bodyEl);
    if (key === "template") {
      bodyEl.appendChild(renderTemplatePicker());
    } else if (key === "identity") {
      bodyEl.appendChild(renderIdentityForm(wizardState, onWizardChange));
    } else if (key === "strengths") {
      bodyEl.appendChild(renderStrengthsList(wizardState, onWizardChange));
    } else if (key === "wants") {
      bodyEl.appendChild(renderWantsAvoids(wizardState, "wants", WANTS_MAX, onWizardChange));
    } else if (key === "avoids") {
      bodyEl.appendChild(renderWantsAvoids(wizardState, "avoids", AVOIDS_MAX, onWizardChange));
    } else if (key === "hard") {
      bodyEl.appendChild(renderHardConstraints(wizardState, onWizardChange));
    } else if (key === "review") {
      bodyEl.appendChild(renderReviewPanel());
    }
  }

  // Track whether the user already tried resume-prefill this session so we
  // can swap the card into a "no resume found" state without throwing.
  var resumePrefillState = { status: "idle", message: "" };
  // status: "idle" | "loading" | "missing" | "error"

  function renderResumePrefillCard() {
    var isLoading = resumePrefillState.status === "loading";
    var card = el(
      "button",
      {
        type: "button",
        class: "fp-resume-prefill-card",
        "data-state": resumePrefillState.status,
        "data-selected": String(wizardState.starterTemplate === "custom" && resumePrefillState.status === "ok"),
        disabled: isLoading || resumePrefillState.status === "missing",
        onclick: function () {
          applyResumePrefill().catch(function (err) {
            // applyResumePrefill already updates resumePrefillState + repaints.
            // This catch is just a final safety net.
            showWizardError(
              "Could not pre-fill from resume: " + (err && err.message ? err.message : err),
            );
          });
        },
      },
      [
        el("span", { class: "fp-resume-prefill-card__name" },
          isLoading ? "Reading your resume…" : "Use my resume to pre-fill"),
        el("span", { class: "fp-resume-prefill-card__desc" },
          isLoading
            ? "Running it through Gemini. This takes a few seconds."
            : "We'll run your stored resume through Gemini and pre-fill every section. You can edit anything before saving."),
      ],
    );
    var wrap = el("div", { class: "fp-resume-prefill" }, [card]);
    if (resumePrefillState.status === "missing") {
      wrap.appendChild(
        el(
          "p",
          { class: "fp-resume-prefill__hint" },
          "No resume on file yet — pick a template below to get started, then upload a resume from Settings later.",
        ),
      );
    } else if (resumePrefillState.status === "error" && resumePrefillState.message) {
      wrap.appendChild(
        el(
          "p",
          { class: "fp-resume-prefill__hint fp-resume-prefill__hint--error" },
          "Pre-fill failed: " + resumePrefillState.message + " — you can still pick a template below.",
        ),
      );
    }
    return wrap;
  }

  function renderTemplatePicker() {
    var wrap = el("div");
    wrap.appendChild(renderResumePrefillCard());
    wrap.appendChild(
      el(
        "p",
        { class: "fp-field__hint" },
        "Or pick a starter template:",
      ),
    );
    var grid = el("div", { class: "fp-template-grid" });
    TEMPLATES_AVAILABLE.forEach(function (t) {
      var card = el(
        "button",
        {
          type: "button",
          class: "fp-template-card",
          "data-selected": String(wizardState.starterTemplate === t.id),
          onclick: function () {
            applyTemplate(t.id).catch(function (err) {
              showWizardError("Could not load template: " + (err.message || err));
            });
          },
        },
        [
          el("span", { class: "fp-template-card__name" }, t.name),
          el("span", { class: "fp-template-card__desc" }, t.desc),
        ],
      );
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    wrap.appendChild(
      el(
        "p",
        { class: "fp-field__hint" },
        "Templates are seeds — you can edit every field on the next screens.",
      ),
    );
    return wrap;
  }

  function repaintTemplateStep() {
    if (!wizardEls || !wizardEls.panels || !wizardEls.panels[1]) return;
    var bodyEl = wizardEls.panels[1].querySelector(".fp-wizard__panel-body");
    if (!bodyEl) return;
    clearChildren(bodyEl);
    bodyEl.appendChild(renderTemplatePicker());
  }

  async function applyResumePrefill() {
    showWizardError("");
    resumePrefillState = { status: "loading", message: "" };
    repaintTemplateStep();
    try {
      var result = await fetchProfileFromResume();
      // Merge through the same path templates use so we drop unknown fields
      // and normalize shape against the form's internal state.
      wizardState = mergeStateFromProfile(result.profile);
      wizardState.starterTemplate = "custom";
      resumePrefillState = { status: "ok", message: "" };
      repaintTemplateStep();
      // Advance to step 2 (Identity) so the user can immediately review.
      goToStep(2);
    } catch (err) {
      if (err && err.code === "no_resume_stored") {
        resumePrefillState = { status: "missing", message: "" };
      } else {
        resumePrefillState = {
          status: "error",
          message: err && err.message ? String(err.message) : "unknown error",
        };
      }
      repaintTemplateStep();
    }
  }

  async function applyTemplate(id) {
    showWizardError("");
    if (id === "blank") {
      wizardState = emptyProfile();
      wizardState.starterTemplate = "blank";
    } else {
      var tpl;
      try {
        tpl = await fetchTemplate(id);
      } catch (err) {
        throw err;
      }
      // Merge template into a fresh state so unknown fields are dropped.
      wizardState = mergeStateFromProfile(tpl);
      wizardState.starterTemplate = id;
    }
    // Re-paint card selection
    var bodyEl = wizardEls.panels[1].querySelector(".fp-wizard__panel-body");
    clearChildren(bodyEl);
    bodyEl.appendChild(renderTemplatePicker());
  }

  function mergeStateFromProfile(profile) {
    var state = emptyProfile();
    if (!profile || typeof profile !== "object") return state;
    if (profile.identity) {
      state.identity.targetRoles =
        Array.isArray(profile.identity.targetRoles) && profile.identity.targetRoles.length
          ? profile.identity.targetRoles.slice()
          : [""];
      state.identity.targetSeniority = profile.identity.targetSeniority || "any";
      state.identity.yearsRelevantExperience =
        Number.isFinite(profile.identity.yearsRelevantExperience)
          ? profile.identity.yearsRelevantExperience
          : undefined;
      state.identity.primaryNarrative = String(profile.identity.primaryNarrative || "");
    }
    if (Array.isArray(profile.strengths)) {
      state.strengths = profile.strengths
        .slice()
        .sort(function (a, b) {
          return (a.rank || 99) - (b.rank || 99);
        })
        .map(function (s) {
          return {
            name: String(s.name || ""),
            evidence: String(s.evidence || ""),
            keywords: Array.isArray(s.keywords) ? s.keywords.slice() : [],
          };
        });
    }
    state.wants = Array.isArray(profile.wants) ? profile.wants.slice() : [];
    state.avoids = Array.isArray(profile.avoids) ? profile.avoids.slice() : [];
    if (profile.hardConstraints) {
      var hc = profile.hardConstraints;
      state.hardConstraints = {
        workMode: hc.workMode || "any",
        acceptableLocations: Array.isArray(hc.acceptableLocations)
          ? hc.acceptableLocations.slice()
          : [],
        workAuth: hc.workAuth || "any",
        skipTitles: Array.isArray(hc.skipTitles) ? hc.skipTitles.slice() : [],
        salaryFloor: Number.isFinite(hc.salaryFloor) ? hc.salaryFloor : null,
        salaryRequired: hc.salaryRequired === true,
      };
    }
    if (typeof profile.starterTemplate === "string") {
      state.starterTemplate = profile.starterTemplate;
    }
    return state;
  }

  function renderReviewPanel() {
    var wrap = el("div");
    var payload = buildPayload(wizardState);
    var warnings = validateClientSide(payload);
    if (warnings.length) {
      var ul = el("ul");
      warnings.forEach(function (w) {
        ul.appendChild(el("li", {}, w));
      });
      wrap.appendChild(
        el("div", { class: "fp-wizard__error" }, [
          el("strong", {}, "Before saving:"),
          ul,
        ]),
      );
    }
    var details = el("details", { class: "fp-review", open: true });
    details.appendChild(
      el("summary", { class: "fp-review__summary" }, "Saved profile (JSON)"),
    );
    details.appendChild(
      el("pre", { class: "fp-review__pre" }, JSON.stringify(payload, null, 2)),
    );
    wrap.appendChild(details);
    return wrap;
  }

  function showWizardError(msg) {
    if (!wizardEls.errorEl) return;
    if (!msg) {
      wizardEls.errorEl.textContent = "";
      wizardEls.errorEl.style.display = "none";
      return;
    }
    wizardEls.errorEl.textContent = msg;
    wizardEls.errorEl.style.display = "";
  }

  function onWizardChange() {
    // Live updates happen via the form-builder's own DOM. Nothing to repaint
    // at the wizard level except progress, which depends on currentStep only.
  }

  function goToStep(n) {
    if (n < 1 || n > TOTAL_STEPS) return;
    showWizardError("");
    Object.keys(wizardEls.panels).forEach(function (k) {
      wizardEls.panels[k].dataset.active = "false";
    });
    currentStep = n;
    wizardEls.panels[n].dataset.active = "true";
    wizardEls.stepLabel.textContent = "Step " + n + " of " + TOTAL_STEPS;
    wizardEls.progressFill.style.width = Math.round((n / TOTAL_STEPS) * 100) + "%";
    wizardEls.backBtn.disabled = n === 1;
    if (n === TOTAL_STEPS) {
      wizardEls.nextBtn.style.display = "none";
      wizardEls.saveBtn.style.display = "";
    } else {
      wizardEls.nextBtn.style.display = "";
      wizardEls.saveBtn.style.display = "none";
    }
    var keys = {
      1: "template",
      2: "identity",
      3: "strengths",
      4: "wants",
      5: "avoids",
      6: "hard",
      7: "review",
    };
    paintBucket(keys[n]);
  }

  async function submitWizard() {
    var payload = buildPayload(wizardState);
    var warnings = validateClientSide(payload);
    if (warnings.length) {
      showWizardError(warnings.join(" "));
      return;
    }
    wizardEls.saveBtn.disabled = true;
    wizardEls.saveBtn.textContent = "Saving…";
    try {
      var res = await saveProfile(payload);
      if (!res.data || res.data.ok !== true) {
        var msg = "Save failed.";
        if (res.data && res.data.reason === "invalid_profile" && Array.isArray(res.data.errors)) {
          msg = "Server rejected the profile: " +
            res.data.errors
              .map(function (e) { return (e.instancePath || "/") + " " + e.message; })
              .join("; ");
        } else if (res.data && res.data.detail) {
          msg = "Save failed: " + res.data.detail;
        }
        showWizardError(msg);
        return;
      }
      try {
        localStorage.setItem("fitProfileOnboardingComplete", "1");
      } catch (_) {
        // ignore
      }
      // Close wizard and bounce back to dashboard root.
      closeWizard({ navigateHome: true });
      // Optional: tell the rest of the app a fresh profile exists.
      try {
        document.dispatchEvent(
          new CustomEvent("jobbored:fit-profile-saved", {
            detail: { updatedAt: res.data.updatedAt },
          }),
        );
      } catch (_) {
        // ignore
      }
    } catch (err) {
      showWizardError("Network error: " + (err && err.message ? err.message : err));
    } finally {
      wizardEls.saveBtn.disabled = false;
      wizardEls.saveBtn.textContent = "Looks good — save profile";
    }
  }

  function openWizard() {
    if (!wizardState) {
      wizardState = emptyProfile();
    }
    buildWizardShell();
    wizardEls.root.dataset.active = "true";
    document.body.style.overflow = "hidden";
    currentStep = 1;
    goToStep(1);
  }

  function closeWizard(opts) {
    if (wizardEls.root) wizardEls.root.dataset.active = "false";
    document.body.style.overflow = "";
    if (opts && opts.navigateHome) {
      try {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch (_) {
        window.location.hash = "";
      }
    }
  }

  /* ── Hash routing ─────────────────────────────────────────────────── */

  function handleHashChange() {
    var hash = String(window.location.hash || "");
    if (hash === "#/onboarding/fit-profile") {
      openWizard();
    } else if (wizardEls.root && wizardEls.root.dataset.active === "true") {
      closeWizard();
    }
  }

  /* ── Public surface for the settings editor ───────────────────────── */

  window.FitProfileForm = {
    emptyProfile: emptyProfile,
    mergeStateFromProfile: mergeStateFromProfile,
    buildPayload: buildPayload,
    validateClientSide: validateClientSide,
    renderIdentityForm: renderIdentityForm,
    renderStrengthsList: renderStrengthsList,
    renderWantsAvoids: renderWantsAvoids,
    renderHardConstraints: renderHardConstraints,
    fetchProfile: fetchProfile,
    saveProfile: saveProfile,
    profileUrl: profileUrl,
    constants: {
      WANTS_MAX: WANTS_MAX,
      AVOIDS_MAX: AVOIDS_MAX,
      NARRATIVE_MIN: NARRATIVE_MIN,
      NARRATIVE_MAX: NARRATIVE_MAX,
    },
  };

  // Public open helper so other parts of the app can trigger the wizard
  // without going through the URL fragment.
  window.openFitProfileWizard = openWizard;

  /* ── Boot ─────────────────────────────────────────────────────────── */

  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", handleHashChange);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", handleHashChange);
    } else {
      handleHashChange();
    }
  }
})();
