/* ============================================
   Beat B4 of the one-flow onboarding — Confirm your fit.

   A confirm-don't-compose review: B3 supplies the draft, this beat lets the
   user correct it in place, then writes one canonical payload to the server
   fit profile and one query-shaped projection to the discovery profile.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  "use strict";

  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Here's how we'll judge every job for you.";
  const SUB =
    "We drafted this from your resume. Fix anything that's off — this " +
    "is the one-time part that makes every match yours.";
  const ACTION_ID = "confirm-fit";
  const NARRATIVE_MIN = 20;
  const NARRATIVE_MAX = 1200;

  // Copied from discovery-drawer.js's TargetSeniority label map. This beat
  // intentionally does not import another classic-global module at parse time.
  const SENIORITY_OPTIONS = [
    { id: "intern", label: "Intern" },
    { id: "entry", label: "Entry" },
    { id: "ic_mid", label: "Mid" },
    { id: "ic_senior", label: "Senior" },
    { id: "ic_staff", label: "Staff" },
    { id: "ic_principal", label: "Principal" },
    { id: "manager", label: "Manager" },
    { id: "director", label: "Director" },
    { id: "head", label: "Head" },
    { id: "vp", label: "VP" },
    { id: "c_level", label: "C-level" },
    { id: "any", label: "Any" },
  ];
  const WORK_MODES = [
    { id: "any", label: "Any" },
    { id: "remote_only", label: "Remote only" },
    { id: "hybrid_ok", label: "Hybrid OK" },
    { id: "onsite_ok", label: "Onsite OK" },
  ];
  const WORK_AUTH_OPTIONS = [
    { id: "any", label: "Any" },
    { id: "us_citizen", label: "US citizen" },
    { id: "us_authorized", label: "US authorized" },
    { id: "needs_sponsorship", label: "Needs sponsorship" },
  ];

  function text(value) {
    return value == null ? "" : String(value).trim();
  }

  function strings(raw) {
    return (Array.isArray(raw) ? raw : []).map(text).filter(Boolean);
  }

  function cloneArray(raw) {
    return Array.isArray(raw)
      ? raw.map(function (entry) {
          if (!entry || typeof entry !== "object") return entry;
          return { ...entry };
        })
      : [];
  }

  function seniorityLabel(value) {
    const match = SENIORITY_OPTIONS.find(function (candidate) {
      return candidate.id === value;
    });
    return match ? match.label : "Any";
  }

  function workModeUsesLocations(workMode) {
    return workMode === "hybrid_ok" || workMode === "onsite_ok";
  }

  function remotePolicyFor(workMode) {
    if (workMode === "remote_only") return "remote";
    if (workMode === "hybrid_ok") return "hybrid";
    if (workMode === "onsite_ok") return "onsite";
    return "";
  }

  function normalizeDraft(raw) {
    const wrapped = raw && typeof raw === "object" ? raw : {};
    const source =
      (wrapped.profile && typeof wrapped.profile === "object" && wrapped.profile) ||
      (wrapped.template && typeof wrapped.template === "object" && wrapped.template) ||
      wrapped;
    const identity = source.identity && typeof source.identity === "object"
      ? source.identity
      : {};
    const hard = source.hardConstraints && typeof source.hardConstraints === "object"
      ? source.hardConstraints
      : {};
    const strengths = cloneArray(source.strengths)
      .sort(function (a, b) {
        return (Number(a && a.rank) || 99) - (Number(b && b.rank) || 99);
      })
      .map(function (strength) {
        return {
          name: text(strength && strength.name),
          evidence: text(strength && strength.evidence),
          keywords: strings(strength && strength.keywords),
        };
      })
      .filter(function (strength) {
        return strength.name;
      });

    return {
      version: 1,
      identity: {
        targetRoles: strings(identity.targetRoles),
        targetSeniority: text(identity.targetSeniority) || "any",
        primaryNarrative: text(identity.primaryNarrative),
      },
      strengths,
      wants: strings(source.wants),
      avoids: strings(source.avoids),
      experiences: cloneArray(source.experiences),
      projects: cloneArray(source.projects),
      hardConstraints: {
        workMode: text(hard.workMode) || "any",
        acceptableLocations: strings(hard.acceptableLocations),
        workAuth: text(hard.workAuth) || "any",
        skipTitles: strings(hard.skipTitles),
        salaryFloor:
          typeof hard.salaryFloor === "number" && Number.isFinite(hard.salaryFloor)
            ? Math.floor(hard.salaryFloor)
            : null,
        salaryRequired: hard.salaryRequired === true,
      },
      tieBreakers:
        source.tieBreakers && typeof source.tieBreakers === "object"
          ? { ...source.tieBreakers }
          : null,
    };
  }

  function buildPayload(model) {
    const hard = model.hardConstraints;
    const payload = {
      version: 1,
      identity: {
        targetRoles: strings(model.identity.targetRoles),
        targetSeniority: text(model.identity.targetSeniority) || "any",
        primaryNarrative: text(model.identity.primaryNarrative),
      },
      strengths: model.strengths
        .map(function (strength, index) {
          const entry = { name: text(strength.name), rank: index + 1 };
          if (!entry.name) return null;
          if (text(strength.evidence)) entry.evidence = text(strength.evidence);
          const keywords = strings(strength.keywords);
          if (keywords.length) entry.keywords = keywords;
          return entry;
        })
        .filter(Boolean),
      hardConstraints: {
        workMode: text(hard.workMode) || "any",
        workAuth: text(hard.workAuth) || "any",
        salaryFloor:
          typeof hard.salaryFloor === "number" && hard.salaryFloor > 0
            ? Math.floor(hard.salaryFloor)
            : null,
      },
    };
    const locations = strings(hard.acceptableLocations);
    const skipTitles = strings(hard.skipTitles);
    if (locations.length) payload.hardConstraints.acceptableLocations = locations;
    if (skipTitles.length) payload.hardConstraints.skipTitles = skipTitles;
    if (hard.salaryRequired === true) payload.hardConstraints.salaryRequired = true;
    if (model.wants.length) payload.wants = strings(model.wants);
    if (model.avoids.length) payload.avoids = strings(model.avoids);
    if (model.experiences.length) payload.experiences = cloneArray(model.experiences);
    if (model.projects.length) payload.projects = cloneArray(model.projects);
    if (model.tieBreakers) payload.tieBreakers = { ...model.tieBreakers };
    return payload;
  }

  function discoveryPayload(model) {
    const hard = model.hardConstraints;
    return {
      targetRoles: strings(model.identity.targetRoles).join(", "),
      locations: workModeUsesLocations(hard.workMode)
        ? strings(hard.acceptableLocations).join(", ")
        : "",
      remotePolicy: remotePolicyFor(hard.workMode),
      seniority: seniorityLabel(model.identity.targetSeniority),
      keywordsInclude: model.strengths
        .map(function (strength) {
          return text(strength.name);
        })
        .filter(Boolean)
        .join(", "),
      keywordsExclude: strings(hard.skipTitles).join(", "),
    };
  }

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = String(content);
    return node;
  }

  function button(label, className, onClick) {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function option(value, label, selected) {
    const node = el("option", "", label);
    node.value = value;
    node.selected = !!selected;
    return node;
  }

  function setError(node, message) {
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
  }

  function markChanged(record, errorKey) {
    if (errorKey && record.errors) setError(record.errors[errorKey], "");
    if (record.jsonPre) {
      record.jsonPre.textContent = JSON.stringify(buildPayload(record.model), null, 2);
    }
    if (record.updateSummary) record.updateSummary();
  }

  function renderChipEditor(values, options, record) {
    const wrap = el("div", "oneflow-fit-chips");
    const list = el("div", "oneflow-fit-chips__list");
    const addRow = el("div", "oneflow-fit-chips__add");
    const addInput = el("input", "oneflow-fit-input");
    addInput.type = "text";
    addInput.placeholder = options.placeholder || "Add one";

    function rerender() {
      list.replaceChildren();
      values.forEach(function (value, index) {
        const chip = el("span", "oneflow-fit-chip");
        const input = el("input", "oneflow-fit-chip__input");
        input.type = "text";
        input.value = value;
        input.setAttribute("aria-label", `${options.label} ${index + 1}`);
        input.addEventListener("input", function () {
          values[index] = input.value;
          markChanged(record, options.errorKey);
        });
        chip.appendChild(input);
        if (options.ordered) {
          const up = button("↑", "oneflow-fit-chip__move", function () {
            if (index === 0) return;
            const previous = values[index - 1];
            values[index - 1] = values[index];
            values[index] = previous;
            rerender();
            markChanged(record, options.errorKey);
          });
          up.disabled = index === 0;
          up.setAttribute("aria-label", `Move ${options.label} up`);
          const down = button("↓", "oneflow-fit-chip__move", function () {
            if (index === values.length - 1) return;
            const next = values[index + 1];
            values[index + 1] = values[index];
            values[index] = next;
            rerender();
            markChanged(record, options.errorKey);
          });
          down.disabled = index === values.length - 1;
          down.setAttribute("aria-label", `Move ${options.label} down`);
          chip.append(up, down);
        }
        const remove = button("×", "oneflow-fit-chip__remove", function () {
          values.splice(index, 1);
          rerender();
          markChanged(record, options.errorKey);
        });
        remove.setAttribute("aria-label", `Remove ${options.label}`);
        chip.appendChild(remove);
        list.appendChild(chip);
      });
    }

    function addValue() {
      const value = text(addInput.value);
      if (!value) return;
      if (!values.some(function (current) {
        return text(current).toLowerCase() === value.toLowerCase();
      })) {
        values.push(value);
      }
      addInput.value = "";
      rerender();
      markChanged(record, options.errorKey);
    }

    addInput.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addValue();
    });
    addRow.append(addInput, button("Add", "oneflow-fit-link-button", addValue));
    rerender();
    wrap.append(list, addRow);
    return wrap;
  }

  function renderStrengths(record) {
    const wrap = el("div", "oneflow-fit-strengths");
    const list = el("ol", "oneflow-fit-strengths__list");
    const addRow = el("div", "oneflow-fit-chips__add");
    const addInput = el("input", "oneflow-fit-input");
    addInput.type = "text";
    addInput.placeholder = "Add a strength";
    let dragged = -1;

    function move(from, to) {
      if (
        from < 0 ||
        to < 0 ||
        from >= record.model.strengths.length ||
        to >= record.model.strengths.length
      ) {
        return;
      }
      const moved = record.model.strengths.splice(from, 1)[0];
      record.model.strengths.splice(to, 0, moved);
      rerender();
      markChanged(record, "strengths");
    }

    function rerender() {
      list.replaceChildren();
      record.model.strengths.forEach(function (strength, index) {
        const item = el("li", "oneflow-fit-strength");
        item.setAttribute("draggable", "true");
        item.addEventListener("dragstart", function () {
          dragged = index;
        });
        item.addEventListener("dragover", function (event) {
          event.preventDefault();
        });
        item.addEventListener("drop", function (event) {
          event.preventDefault();
          move(dragged, index);
          dragged = -1;
        });
        item.appendChild(el("span", "oneflow-fit-strength__rank", String(index + 1)));
        const input = el("input", "oneflow-fit-input");
        input.type = "text";
        input.value = strength.name;
        input.setAttribute("aria-label", `Strength ${index + 1}`);
        input.addEventListener("input", function () {
          strength.name = input.value;
          markChanged(record, "strengths");
        });
        item.appendChild(input);
        const up = button("↑", "oneflow-fit-chip__move", function () {
          move(index, index - 1);
        });
        up.disabled = index === 0;
        up.setAttribute("aria-label", "Move strength up");
        const down = button("↓", "oneflow-fit-chip__move", function () {
          move(index, index + 1);
        });
        down.disabled = index === record.model.strengths.length - 1;
        down.setAttribute("aria-label", "Move strength down");
        const remove = button("×", "oneflow-fit-chip__remove", function () {
          record.model.strengths.splice(index, 1);
          rerender();
          markChanged(record, "strengths");
        });
        remove.setAttribute("aria-label", "Remove strength");
        item.append(up, down, remove);
        list.appendChild(item);
      });
    }

    function addStrength() {
      const name = text(addInput.value);
      if (!name) return;
      record.model.strengths.push({ name, evidence: "", keywords: [] });
      addInput.value = "";
      rerender();
      markChanged(record, "strengths");
    }

    addInput.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addStrength();
    });
    addRow.append(addInput, button("Add", "oneflow-fit-link-button", addStrength));
    rerender();
    wrap.append(list, addRow);
    return wrap;
  }

  function getDraft(ctx) {
    const runtime = ctx.runtime || {};
    const state = ctx.state || {};
    return (
      runtime.profileDraft ||
      runtime.fitProfileDraft ||
      // B3 leaves its draft under `resumeDraft` (oneflow-beat-resume.js:429),
      // wrapped as { profile, source, starterTemplate } — the shape
      // normalizeDraft already unwraps. Without this alias the whole
      // resume-first premise (spec §2.3) dies between B3 and B4: the beat
      // renders empty and the user retypes what they just uploaded.
      runtime.resumeDraft ||
      state.profileDraft ||
      state.fitProfileDraft ||
      {}
    );
  }

  function getRecord(ctx) {
    const runtime = ctx.runtime || {};
    if (!runtime.oneFlowFitReview) {
      const model = normalizeDraft(getDraft(ctx));
      runtime.oneFlowFitReview = {
        model,
        originalPayload: JSON.stringify(buildPayload(model)),
        saving: false,
        errors: {},
      };
    }
    return runtime.oneFlowFitReview;
  }

  function summaryLocation(model) {
    const hard = model.hardConstraints;
    let location = "Anywhere";
    if (hard.workMode === "remote_only") location = "Remote";
    if (workModeUsesLocations(hard.workMode)) {
      location =
        strings(hard.acceptableLocations).join(" or ") ||
        (hard.workMode === "hybrid_ok" ? "Hybrid" : "Onsite");
    }
    const floor =
      typeof hard.salaryFloor === "number" && hard.salaryFloor > 0
        ? ` · $${Math.round(hard.salaryFloor / 1000)}k floor`
        : "";
    return location + floor;
  }

  function render(container, ctx) {
    const record = getRecord(ctx);
    const model = record.model;
    record.ctx = ctx;
    record.container = container;
    record.errors = {};

    const grid = el("div", "oneflow-fit-grid");

    const looking = el("section", "oneflow-fit-card oneflow-fit-card--looking");
    looking.appendChild(el("h3", "oneflow-fit-card__title", "Looking for"));
    record.errors.roles = el("p", "oneflow-fit-error oneflow-fit-error--roles");
    record.errors.roles.hidden = true;
    looking.appendChild(record.errors.roles);
    looking.appendChild(
      renderChipEditor(
        model.identity.targetRoles,
        {
          label: "target role",
          placeholder: "Add a target role",
          ordered: true,
          errorKey: "roles",
        },
        record,
      ),
    );

    const seniorityRow = el("label", "oneflow-fit-field oneflow-fit-seniority");
    seniorityRow.appendChild(el("span", "oneflow-fit-field__label", "Seniority"));
    const seniority = el("select", "oneflow-fit-select");
    SENIORITY_OPTIONS.forEach(function (item) {
      seniority.appendChild(
        option(item.id, item.label, item.id === model.identity.targetSeniority),
      );
    });
    seniority.value = model.identity.targetSeniority;
    seniority.addEventListener("change", function () {
      model.identity.targetSeniority = seniority.value;
      markChanged(record);
    });
    seniorityRow.appendChild(seniority);
    looking.appendChild(seniorityRow);
    const locationLine = el("p", "oneflow-fit-location-line");
    looking.appendChild(locationLine);

    const edge = el("section", "oneflow-fit-card oneflow-fit-card--edge");
    edge.appendChild(el("h3", "oneflow-fit-card__title", "Your edge"));
    record.errors.strengths = el(
      "p",
      "oneflow-fit-error oneflow-fit-error--strengths",
    );
    record.errors.strengths.hidden = true;
    edge.appendChild(record.errors.strengths);
    edge.appendChild(renderStrengths(record));
    record.errors.narrative = el(
      "p",
      "oneflow-fit-error oneflow-fit-error--narrative",
    );
    record.errors.narrative.hidden = true;
    edge.appendChild(record.errors.narrative);
    const narrativeRow = el("div", "oneflow-fit-narrative");
    const narrativeLine = el("p", "oneflow-fit-narrative__line");
    const narrativeText = el(
      "em",
      "oneflow-fit-narrative__text",
      model.identity.primaryNarrative,
    );
    narrativeLine.appendChild(narrativeText);
    const narrativeInput = el("textarea", "oneflow-fit-textarea");
    narrativeInput.value = model.identity.primaryNarrative;
    narrativeInput.rows = 4;
    narrativeInput.hidden = true;
    narrativeInput.addEventListener("input", function () {
      model.identity.primaryNarrative = narrativeInput.value;
      narrativeText.textContent = narrativeInput.value;
      markChanged(record, "narrative");
    });
    const editNarrative = button("edit", "oneflow-fit-link-button", function () {
      narrativeInput.hidden = !narrativeInput.hidden;
      narrativeLine.hidden = !narrativeInput.hidden;
      if (!narrativeInput.hidden) narrativeInput.focus();
    });
    narrativeRow.append(narrativeLine, editNarrative, narrativeInput);
    edge.appendChild(narrativeRow);

    const lean = el("section", "oneflow-fit-card oneflow-fit-card--lean");
    lean.appendChild(el("h3", "oneflow-fit-card__title", "Lean toward / away"));
    lean.appendChild(el("h4", "oneflow-fit-card__subhead", "Lean toward"));
    lean.appendChild(
      renderChipEditor(
        model.wants,
        { label: "want", placeholder: "Add what you want" },
        record,
      ),
    );
    lean.appendChild(el("h4", "oneflow-fit-card__subhead", "Lean away"));
    lean.appendChild(
      renderChipEditor(
        model.avoids,
        { label: "avoid", placeholder: "Add what to avoid" },
        record,
      ),
    );

    grid.append(looking, edge, lean);
    container.appendChild(grid);

    const details = el("details", "oneflow-fit-details");
    details.appendChild(el("summary", "oneflow-fit-details__summary", "Edit details"));
    const detailsBody = el("div", "oneflow-fit-details__body");
    detailsBody.appendChild(el("h4", "oneflow-fit-field__label", "Work mode"));
    const workModes = el("div", "oneflow-fit-radios");
    let locationsRow;
    WORK_MODES.forEach(function (item) {
      const label = el("label", "oneflow-fit-radio");
      const input = el("input", "");
      input.type = "radio";
      input.name = "oneflow-fit-work-mode";
      input.value = item.id;
      input.checked = model.hardConstraints.workMode === item.id;
      input.dataset.workMode = item.id;
      input.addEventListener("change", function () {
        model.hardConstraints.workMode = item.id;
        if (locationsRow) locationsRow.hidden = !workModeUsesLocations(item.id);
        markChanged(record);
      });
      label.append(input, el("span", "", item.label));
      workModes.appendChild(label);
    });
    detailsBody.appendChild(workModes);

    locationsRow = el("div", "oneflow-fit-field oneflow-fit-locations");
    locationsRow.hidden = !workModeUsesLocations(model.hardConstraints.workMode);
    locationsRow.appendChild(
      el("span", "oneflow-fit-field__label", "Acceptable locations"),
    );
    locationsRow.appendChild(
      renderChipEditor(
        model.hardConstraints.acceptableLocations,
        { label: "location", placeholder: "Add a city or metro" },
        record,
      ),
    );
    detailsBody.appendChild(locationsRow);

    const salaryField = el("label", "oneflow-fit-field");
    salaryField.appendChild(
      el("span", "oneflow-fit-field__label", "Salary floor (USD/year)"),
    );
    const salary = el("input", "oneflow-fit-input");
    salary.type = "number";
    salary.min = "0";
    salary.step = "1000";
    salary.value = model.hardConstraints.salaryFloor || "";
    salary.addEventListener("input", function () {
      const value = Number(salary.value);
      model.hardConstraints.salaryFloor =
        Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
      markChanged(record);
    });
    salaryField.appendChild(salary);
    detailsBody.appendChild(salaryField);

    const salaryRequired = el("label", "oneflow-fit-check");
    const salaryRequiredInput = el("input", "");
    salaryRequiredInput.type = "checkbox";
    salaryRequiredInput.checked = model.hardConstraints.salaryRequired;
    salaryRequiredInput.addEventListener("change", function () {
      model.hardConstraints.salaryRequired = !!salaryRequiredInput.checked;
      markChanged(record);
    });
    salaryRequired.append(
      salaryRequiredInput,
      el("span", "", "Reject listings without published salary"),
    );
    detailsBody.appendChild(salaryRequired);

    const skipField = el("div", "oneflow-fit-field");
    skipField.appendChild(el("span", "oneflow-fit-field__label", "Skip titles"));
    skipField.appendChild(
      renderChipEditor(
        model.hardConstraints.skipTitles,
        { label: "skip title", placeholder: "Add a title to skip" },
        record,
      ),
    );
    detailsBody.appendChild(skipField);

    const authField = el("label", "oneflow-fit-field");
    authField.appendChild(
      el("span", "oneflow-fit-field__label", "Work authorization"),
    );
    const auth = el("select", "oneflow-fit-select");
    WORK_AUTH_OPTIONS.forEach(function (item) {
      auth.appendChild(
        option(item.id, item.label, item.id === model.hardConstraints.workAuth),
      );
    });
    auth.value = model.hardConstraints.workAuth;
    auth.addEventListener("change", function () {
      model.hardConstraints.workAuth = auth.value;
      markChanged(record);
    });
    authField.appendChild(auth);
    detailsBody.appendChild(authField);
    details.appendChild(detailsBody);
    container.appendChild(details);

    const raw = el("details", "oneflow-fit-json");
    raw.appendChild(
      el("summary", "oneflow-fit-details__summary", "Raw profile JSON"),
    );
    record.jsonPre = el(
      "pre",
      "oneflow-fit-json__pre",
      JSON.stringify(buildPayload(model), null, 2),
    );
    raw.appendChild(record.jsonPre);
    container.appendChild(raw);

    record.updateSummary = function () {
      locationLine.textContent = summaryLocation(model);
    };
    record.updateSummary();
  }

  function profileUrl() {
    const config = window.COMMAND_CENTER_CONFIG || {};
    const raw = text(config.jobBoredApiUrl || config.jobPostingScrapeUrl);
    return (raw ? raw.replace(/\/+$/, "") : "") + "/profile";
  }

  async function postFitProfile(payload) {
    if (typeof window.fetch !== "function") {
      throw new Error("The JobBored profile API is unavailable.");
    }
    const response = await window.fetch(profileUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(function () {
      return null;
    });
    if (!response.ok || !data || data.ok !== true) {
      throw new Error(
        (data && (data.detail || data.reason || data.message)) ||
          `Profile save failed (HTTP ${response.status}).`,
      );
    }
    return data;
  }

  function validate(record) {
    const payload = buildPayload(record.model);
    const rolesOk = payload.identity.targetRoles.length >= 1;
    const strengthsOk = payload.strengths.length >= 1;
    const narrativeLength = payload.identity.primaryNarrative.length;
    const narrativeOk =
      narrativeLength >= NARRATIVE_MIN && narrativeLength <= NARRATIVE_MAX;
    setError(record.errors.roles, rolesOk ? "" : "Add at least one target role.");
    setError(
      record.errors.strengths,
      strengthsOk ? "" : "Add at least one strength.",
    );
    setError(
      record.errors.narrative,
      narrativeOk ? "" : "Keep the narrative between 20 and 1200 characters.",
    );
    return rolesOk && strengthsOk && narrativeOk ? payload : null;
  }

  async function confirmFit(ctx) {
    const record = getRecord(ctx);
    if (record.saving) return;
    const payload = validate(record);
    if (!payload) return;
    const store = window.CommandCenterUserContent;
    if (!store || typeof store.saveDiscoveryProfile !== "function") {
      ctx.setMessage(
        "Could not save your discovery profile. Reload and try again.",
        "error",
      );
      return;
    }

    record.saving = true;
    ctx.setBusy(ACTION_ID, [
      { label: "Saving your fit profile…", state: "active" },
    ]);
    try {
      await Promise.all([
        store.saveDiscoveryProfile(discoveryPayload(record.model)),
        postFitProfile(payload),
      ]);
      ctx.clearBusy();
      // B6's "Your search" card prefers the profile the flow just saved
      // over a second GET /profile (spec §5 B6): leave it on the runtime
      // so the payoff renders from what the user literally just confirmed.
      if (ctx.runtime) ctx.runtime.fitProfile = payload;
      await ctx.completeBeat({
        edited: JSON.stringify(payload) !== record.originalPayload,
      });
    } catch (error) {
      ctx.clearBusy();
      ctx.setMessage(
        `Could not save your fit profile: ${text(error && error.message) || "try again."}`,
        "error",
      );
    } finally {
      record.saving = false;
    }
  }

  flow.registerBeat({
    id: "fit",
    order: 4,
    label: "Your fit",
    timeLabel: "about 7 min left",
    headline: HEADLINE,
    sub: SUB,
    actions: [
      {
        id: ACTION_ID,
        label: "Looks like me →",
        variant: "primary",
        kind: "action",
      },
    ],
    render,
    onAction(actionId, ctx) {
      if (actionId !== ACTION_ID) return;
      return confirmFit(ctx);
    },
  });
})();
