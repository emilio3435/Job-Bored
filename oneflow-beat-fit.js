/* ============================================
   Beat B4 of the one-flow onboarding — Confirm your fit.

   A confirm-don't-compose review: B3 supplies the draft, this beat lets the
   user correct it in place, then writes one canonical payload to the server
   fit profile and one query-shaped projection to the discovery profile.

   GFX FE-B4: one grouped page (Target → Your story → Strengths →
   Deal-breakers → Preferences). Enums, caps and validation come from
   window.JobBoredFitProfileSchema; the POST goes through
   window.JobBoredFitProfileSync. Both load after this file and are read
   lazily, at render and confirm time.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  "use strict";

  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Here's how we'll match jobs to you.";
  const SUB =
    "We drafted this from your resume. Fix anything that's off — this " +
    "is the one-time part that makes every match yours.";
  const ACTION_ID = "confirm-fit";

  // Display labels only. The option lists themselves come from
  // JobBoredFitProfileSchema.ENUMS (B4-8); an id the schema adds later
  // still renders, under its id.
  const SENIORITY_LABELS = {
    intern: "Intern",
    entry: "Entry",
    ic_mid: "Mid",
    ic_senior: "Senior",
    ic_staff: "Staff",
    ic_principal: "Principal",
    manager: "Manager",
    director: "Director",
    head: "Head",
    vp: "VP",
    c_level: "C-level",
    any: "Any",
  };
  const WORK_MODE_LABELS = {
    any: "Any",
    remote_only: "Remote only",
    hybrid_ok: "Hybrid OK",
    onsite_ok: "Onsite OK",
  };
  const WORK_AUTH_LABELS = {
    any: "Any",
    us_citizen: "US citizen",
    us_authorized: "US authorized",
    needs_sponsorship: "Needs sponsorship",
  };

  // DOM order of the fields: the first invalid one in this order gets focus.
  const FIELD_ORDER = [
    "roles",
    "seniority",
    "narrative",
    "strengths",
    "workMode",
    "locations",
    "workAuth",
    "salary",
    "wants",
    "avoids",
    "skipTitles",
  ];
  const PREFERENCE_FIELDS = { wants: true, avoids: true, skipTitles: true };

  let uid = 0;
  function nextId(prefix) {
    uid += 1;
    return `oneflow-fit-${prefix}-${uid}`;
  }

  function schema() {
    const api = window.JobBoredFitProfileSchema;
    return api && typeof api.validateProfile === "function" ? api : null;
  }

  function limitFor(name) {
    const api = schema();
    return (api && api.LIMITS && api.LIMITS[name]) || {};
  }

  function enumFor(name, labels) {
    const api = schema();
    const list = api && api.ENUMS && api.ENUMS[name];
    return Array.isArray(list) && list.length ? list.slice() : Object.keys(labels);
  }

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
    return SENIORITY_LABELS[value] || "Any";
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
      // "Your details" (name, headline, email, phone, location, links):
      // not edited here, carried through so this save never drops them.
      contact: contactOf(identity),
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

  const CONTACT_KEYS = ["fullName", "headline", "email", "phone", "location", "links"];

  function contactOf(identity) {
    const out = {};
    if (!identity || typeof identity !== "object") return out;
    CONTACT_KEYS.forEach(function (key) {
      if (identity[key] !== undefined && identity[key] !== null && identity[key] !== "") {
        out[key] = identity[key];
      }
    });
    return out;
  }

  /**
   * The details the "Your details" beat confirmed, when it did: the
   * runtime copy first, then the persisted draft (a refresh between the
   * two beats). Null when the step was skipped or never confirmed.
   */
  function confirmedContact(ctx) {
    const runtime = (ctx && ctx.runtime) || {};
    if (runtime.contactIdentity && typeof runtime.contactIdentity === "object") {
      return runtime.contactIdentity;
    }
    const drafts = runtime.drafts && typeof runtime.drafts === "object" ? runtime.drafts : {};
    const draft = drafts.contactDraft;
    if (draft && typeof draft === "object" && draft.confirmed && draft.contact && typeof draft.contact === "object") {
      return draft.contact;
    }
    return null;
  }

  function buildPayload(model) {
    const hard = model.hardConstraints;
    const payload = {
      version: 1,
      identity: Object.assign(
        {
          targetRoles: strings(model.identity.targetRoles),
          targetSeniority: text(model.identity.targetSeniority) || "any",
          primaryNarrative: text(model.identity.primaryNarrative),
        },
        contactOf(model.contact),
      ),
      strengths: model.strengths
        .map(function (strength, index) {
          const entry = { name: text(strength.name), rank: index + 1 };
          if (!entry.name) return null;
          if (text(strength.evidence)) entry.evidence = text(strength.evidence);
          const keywords = strings(strength.keywords);
          if (keywords.length) entry.keywords = keywords;
          return entry;
        })
        .filter(Boolean)
        .map(function (entry, index) {
          entry.rank = index + 1;
          return entry;
        }),
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
    if (strings(model.wants).length) payload.wants = strings(model.wants);
    if (strings(model.avoids).length) payload.avoids = strings(model.avoids);
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
      // UX01 FD-26: the drawer's "Keywords to exclude" carries what the user
      // said to avoid, not just the titles to skip, deduplicated.
      keywordsExclude: strings(hard.skipTitles)
        .concat(strings(model.avoids))
        .filter(function (value, index, all) {
          const key = value.toLowerCase();
          return (
            all.findIndex(function (other) {
              return other.toLowerCase() === key;
            }) === index
          );
        })
        .join(", "),
    };
  }

  // ---------------------------------------------------------------
  // Validation (N-B4-2): schema errors → one message per field.
  // ---------------------------------------------------------------

  function fieldKeyFor(path) {
    const at = String(path || "");
    if (/^identity\.targetRoles/.test(at)) return "roles";
    if (/^identity\.targetSeniority/.test(at)) return "seniority";
    if (/^identity\.primaryNarrative/.test(at)) return "narrative";
    if (/^strengths/.test(at)) return "strengths";
    if (/^wants/.test(at)) return "wants";
    if (/^avoids/.test(at)) return "avoids";
    if (/^hardConstraints\.acceptableLocations/.test(at)) return "locations";
    if (/^hardConstraints\.skipTitles/.test(at)) return "skipTitles";
    if (/^hardConstraints\.salary/.test(at)) return "salary";
    if (/^hardConstraints\.workMode/.test(at)) return "workMode";
    if (/^hardConstraints\.workAuth/.test(at)) return "workAuth";
    return "";
  }

  function itemIndexFor(path) {
    const match = /\[(\d+)\]/.exec(String(path || ""));
    return match ? Number(match[1]) : -1;
  }

  // ajv's "/identity/targetRoles/0" → the schema module's "identity.targetRoles[0]".
  function pathFromPointer(pointer) {
    return String(pointer || "")
      .split("/")
      .filter(Boolean)
      .reduce(function (out, part) {
        if (/^\d+$/.test(part)) return `${out}[${part}]`;
        return out ? `${out}.${part}` : part;
      }, "");
  }

  function fallbackValidate(payload) {
    const errors = [];
    if (!payload.identity.targetRoles.length) {
      errors.push({ field: "identity.targetRoles", message: "Add at least 1 target role." });
    }
    const length = payload.identity.primaryNarrative.length;
    if (length < 20) {
      errors.push({
        field: "identity.primaryNarrative",
        message: "Your narrative needs at least 20 characters.",
      });
    } else if (length > 1200) {
      errors.push({
        field: "identity.primaryNarrative",
        message: "Your narrative must be 1200 characters or fewer.",
      });
    }
    if (!payload.strengths.length) {
      errors.push({ field: "strengths", message: "Add at least one strength." });
    }
    return { ok: errors.length === 0, errors };
  }

  /** { byField: { roles: {message, index} }, general: [messages] } */
  function groupErrors(errors) {
    const byField = {};
    const general = [];
    (errors || []).forEach(function (error) {
      const message = text(error && error.message) || "This isn't valid.";
      const key = fieldKeyFor(error && error.field);
      if (!key) {
        if (general.indexOf(message) === -1) general.push(message);
        return;
      }
      if (!byField[key]) {
        byField[key] = { message, index: itemIndexFor(error.field) };
      }
    });
    return { byField, general };
  }

  function validationFor(payload) {
    const api = schema();
    const result = api ? api.validateProfile(payload) : fallbackValidate(payload);
    return groupErrors(result && result.errors);
  }

  // ---------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------

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

  function describe(node, ids) {
    const list = ids.filter(Boolean).join(" ");
    if (list) node.setAttribute("aria-describedby", list);
    else node.removeAttribute("aria-describedby");
  }

  function sizeTo(input) {
    // `size` is the fallback where `field-sizing: content` is unsupported.
    input.size = Math.max(4, Math.min(40, String(input.value || "").length + 1));
  }

  function autoGrow(textarea) {
    if (!textarea.style || typeof textarea.scrollHeight !== "number") return;
    textarea.style.height = "auto";
    if (textarea.scrollHeight) textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }

  function announce(record, message) {
    if (record.live) record.live.textContent = message;
  }

  function sameText(a, b) {
    return text(a).toLowerCase() === text(b).toLowerCase();
  }

  // ---------------------------------------------------------------
  // Field errors
  // ---------------------------------------------------------------

  function makeErrorSlot(record, key) {
    const node = el("p", `oneflow-fit-error oneflow-fit-error--${key}`);
    node.id = nextId(`error-${key}`);
    node.hidden = true;
    record.errors[key] = node;
    return node;
  }

  function paintField(record, key, entry) {
    const slot = record.errors[key];
    if (slot) {
      slot.textContent = entry ? entry.message : "";
      slot.hidden = !entry;
    }
    const field = record.fields[key];
    if (field && typeof field.invalid === "function") {
      field.invalid(entry || null);
    }
    if (entry) record.shown[key] = true;
    else delete record.shown[key];
  }

  function showErrors(record, grouped) {
    FIELD_ORDER.forEach(function (key) {
      paintField(record, key, grouped.byField[key] || null);
    });
    if (grouped.byField.wants || grouped.byField.avoids || grouped.byField.skipTitles) {
      if (record.prefs) record.prefs.open = true;
    }
    if (
      grouped.byField.locations &&
      record.fields.locations &&
      record.fields.locations.row
    ) {
      record.fields.locations.row.hidden = false;
    }
  }

  function focusFirstInvalid(record, grouped) {
    const key = FIELD_ORDER.find(function (candidate) {
      return grouped.byField[candidate];
    });
    if (!key) return false;
    if (PREFERENCE_FIELDS[key] && record.prefs) record.prefs.open = true;
    const field = record.fields[key];
    const target =
      field && typeof field.focusTarget === "function"
        ? field.focusTarget(grouped.byField[key].index)
        : null;
    if (target && typeof target.focus === "function") target.focus();
    return true;
  }

  /** After an error has been shown, re-check that field as the user types. */
  function revalidateShown(record) {
    const keys = Object.keys(record.shown);
    if (!keys.length) return;
    const grouped = validationFor(buildPayload(record.model));
    keys.forEach(function (key) {
      paintField(record, key, grouped.byField[key] || null);
    });
  }

  function markChanged(record) {
    revalidateShown(record);
    if (record.updateSummary) record.updateSummary();
    persistDraft(record);
  }

  // ---------------------------------------------------------------
  // Tag input (B4-2, B4-3, B4-11, N-B4-5)
  //
  // `items` is the model array. `read`/`write`/`make` adapt it, so the
  // strengths list (objects that carry evidence and keywords the beat
  // never shows) shares the component with the plain string lists.
  // ---------------------------------------------------------------

  function renderTagInput(record, spec) {
    const items = spec.items;
    const read =
      spec.read ||
      function (item) {
        return item;
      };
    const write =
      spec.write ||
      function (index, value) {
        items[index] = value;
      };
    const make =
      spec.make ||
      function (value) {
        return value;
      };
    const limit = limitFor(spec.limit);
    const maxItems = typeof limit.maxItems === "number" ? limit.maxItems : 0;
    const maxLength =
      spec.maxLength ||
      (typeof limit.itemMaxLength === "number" ? limit.itemMaxLength : 0);

    const wrap = el(
      "div",
      `oneflow-fit-tags${spec.ordered ? " oneflow-fit-tags--ordered" : ""}`,
    );
    wrap.dataset.field = spec.key;
    const list = el(spec.ordered ? "ol" : "ul", "oneflow-fit-tags__list");
    if (spec.labelId) list.setAttribute("aria-labelledby", spec.labelId);
    const addRow = el("div", "oneflow-fit-chips__add");
    const addInput = el("input", "oneflow-fit-input oneflow-fit-tags__new");
    addInput.type = "text";
    addInput.placeholder = spec.hint || spec.placeholder;
    addInput.setAttribute("aria-label", spec.placeholder);
    addInput.setAttribute("enterkeyhint", "done");
    if (maxLength) addInput.maxLength = maxLength;
    const addButton = button("Add", "oneflow-fit-link-button", function () {
      addFrom(addInput.value);
      addInput.focus();
    });
    addButton.setAttribute("aria-label", spec.placeholder);
    const cap = el("p", "oneflow-fit-cap");
    cap.id = nextId(`cap-${spec.key}`);
    cap.hidden = true;
    const hintId = spec.ordered ? nextId(`hint-${spec.key}`) : "";
    const hint = spec.ordered
      ? el(
          "p",
          "oneflow-fit-sr",
          "Drag the handle, or focus it and press the up or down arrow key, to reorder.",
        )
      : null;
    if (hint) hint.id = hintId;
    let dragged = -1;
    let invalid = null;
    let inputs = [];
    let handles = [];

    function refreshCap() {
      const full = maxItems > 0 && items.length >= maxItems;
      addInput.disabled = full;
      addButton.disabled = full;
      cap.hidden = !full;
      cap.textContent = full
        ? `${maxItems} ${spec.plural} is the most JobBored can use. Remove one to add another.`
        : "";
      describe(addInput, [full ? cap.id : "", invalid ? spec.errorId : ""]);
    }

    function move(from, to, focusHandle) {
      if (from < 0 || to < 0 || from >= items.length || to >= items.length) return;
      if (from === to) return;
      const moved = items.splice(from, 1)[0];
      items.splice(to, 0, moved);
      rerender();
      markChanged(record);
      announce(
        record,
        `${text(read(moved))} moved to position ${to + 1} of ${items.length}.`,
      );
      if (focusHandle && handles[to]) handles[to].focus();
    }

    function tidy() {
      // N-B4-5: trim, drop empties and case-insensitive duplicates on blur.
      const seen = [];
      let changed = false;
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const raw = read(items[index]);
        const value = text(raw);
        if (value !== raw) {
          write(index, value);
          changed = true;
        }
      }
      for (let index = 0; index < items.length; index += 1) {
        const value = read(items[index]);
        const duplicate = seen.some(function (other) {
          return sameText(other, value);
        });
        if (!value || duplicate) {
          items.splice(index, 1);
          index -= 1;
          changed = true;
        } else {
          seen.push(value);
        }
      }
      return changed;
    }

    function addFrom(raw) {
      const parts = String(raw || "")
        .split(",")
        .map(text)
        .filter(Boolean);
      let added = 0;
      parts.forEach(function (value) {
        if (maxItems > 0 && items.length >= maxItems) return;
        const clipped = maxLength ? value.slice(0, maxLength) : value;
        const exists = items.some(function (item) {
          return sameText(read(item), clipped);
        });
        if (exists) return;
        items.push(make(clipped));
        added += 1;
      });
      addInput.value = "";
      if (!added && !parts.length) return;
      rerender();
      markChanged(record);
      if (added) announce(record, `Added. ${items.length} ${spec.plural}.`);
    }

    function rerender() {
      list.replaceChildren();
      inputs = [];
      handles = [];
      items.forEach(function (item, index) {
        const value = read(item);
        const row = el("li", "oneflow-fit-tag");
        row.addEventListener("dragover", function (event) {
          if (dragged < 0) return;
          event.preventDefault();
          row.classList.add("is-drop-target");
        });
        row.addEventListener("dragleave", function () {
          row.classList.remove("is-drop-target");
        });
        row.addEventListener("drop", function (event) {
          event.preventDefault();
          row.classList.remove("is-drop-target");
          const from = dragged;
          dragged = -1;
          move(from, index, false);
        });

        if (spec.ordered) {
          const handle = button("", "oneflow-fit-tag__handle", function () {});
          handle.setAttribute("draggable", "true");
          handle.setAttribute(
            "aria-label",
            `Reorder ${value || spec.noun}, position ${index + 1} of ${items.length}`,
          );
          describe(handle, [hintId]);
          handle.addEventListener("dragstart", function (event) {
            dragged = index;
            row.classList.add("is-dragging");
            if (event && event.dataTransfer) {
              event.dataTransfer.effectAllowed = "move";
              try {
                event.dataTransfer.setData("text/plain", String(value));
              } catch (_) {
                /* Some browsers refuse setData outside a trusted drag. */
              }
            }
          });
          handle.addEventListener("dragend", function () {
            dragged = -1;
            row.classList.remove("is-dragging");
          });
          handle.addEventListener("keydown", function (event) {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              move(index, index - 1, true);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              move(index, index + 1, true);
            }
          });
          handles.push(handle);
          row.appendChild(handle);
        }
        if (spec.ranked) {
          const rank = el("span", "oneflow-fit-tag__rank", String(index + 1));
          rank.setAttribute("aria-hidden", "true");
          row.appendChild(rank);
        }

        const input = el("input", "oneflow-fit-tag__input");
        input.type = "text";
        input.value = value;
        if (maxLength) input.maxLength = maxLength;
        sizeTo(input);
        input.setAttribute(
          "aria-label",
          `${spec.itemLabel} ${index + 1} of ${items.length}`,
        );
        input.addEventListener("input", function () {
          write(index, input.value);
          sizeTo(input);
          markChanged(record);
        });
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            addInput.focus();
          }
        });
        input.addEventListener("blur", function () {
          if (tidy()) {
            rerender();
            markChanged(record);
          }
        });
        inputs.push(input);
        row.appendChild(input);

        const remove = button("×", "oneflow-fit-tag__remove", function () {
          items.splice(index, 1);
          rerender();
          markChanged(record);
          announce(record, `Removed ${value || spec.noun}.`);
          const next = inputs[Math.min(index, inputs.length - 1)];
          (next || addInput).focus();
        });
        remove.setAttribute("aria-label", `Remove ${value || spec.noun}`);
        row.appendChild(remove);
        list.appendChild(row);
      });
      paintInvalid();
      refreshCap();
    }

    function paintInvalid() {
      inputs.forEach(function (input, index) {
        const hit = invalid && (invalid.index === index || invalid.index < 0);
        if (hit && invalid.index === index) {
          input.setAttribute("aria-invalid", "true");
          describe(input, [spec.errorId]);
        } else {
          input.removeAttribute("aria-invalid");
          input.removeAttribute("aria-describedby");
        }
      });
      if (invalid && invalid.index < 0) addInput.setAttribute("aria-invalid", "true");
      else addInput.removeAttribute("aria-invalid");
    }

    addInput.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== ",") return;
      event.preventDefault();
      addFrom(addInput.value);
    });
    addInput.addEventListener("input", function () {
      // A pasted "a, b, c" lands as three tags.
      if (addInput.value.indexOf(",") !== -1) addFrom(addInput.value);
    });

    record.fields[spec.key] = {
      invalid(entry) {
        invalid = entry;
        paintInvalid();
        refreshCap();
      },
      focusTarget(index) {
        if (index >= 0 && inputs[index]) return inputs[index];
        return addInput.disabled ? inputs[0] || addInput : addInput;
      },
    };

    rerender();
    addRow.append(addInput, addButton);
    wrap.append(list, addRow, cap);
    if (hint) wrap.appendChild(hint);
    return wrap;
  }

  // ---------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------

  function section(key, title, lede) {
    const node = el("section", `oneflow-fit-section oneflow-fit-section--${key}`);
    const heading = el("h3", "oneflow-fit-section__title", title);
    heading.id = nextId(`section-${key}`);
    node.setAttribute("aria-labelledby", heading.id);
    node.appendChild(heading);
    if (lede) node.appendChild(el("p", "oneflow-fit-section__lede", lede));
    return node;
  }

  function fieldLabel(tag, label, forId) {
    const node = el(tag, "oneflow-fit-field__label", label);
    node.id = nextId("label");
    if (forId && tag === "label") node.htmlFor = forId;
    return node;
  }

  function renderTarget(record) {
    const model = record.model;
    const node = section(
      "target",
      "Target",
      "The jobs we go looking for. Put your first choice on top.",
    );

    const roles = el("div", "oneflow-fit-field");
    const rolesLabel = fieldLabel("p", "Roles");
    roles.appendChild(rolesLabel);
    const rolesError = makeErrorSlot(record, "roles");
    roles.appendChild(
      renderTagInput(record, {
        key: "roles",
        items: model.identity.targetRoles,
        limit: "targetRoles",
        ordered: true,
        labelId: rolesLabel.id,
        errorId: rolesError.id,
        itemLabel: "Target role",
        noun: "role",
        plural: "roles",
        placeholder: "Add a target role",
      }),
    );
    roles.appendChild(rolesError);
    node.appendChild(roles);

    const seniorityRow = el("div", "oneflow-fit-field oneflow-fit-seniority");
    const seniority = el("select", "oneflow-fit-select");
    seniority.id = nextId("seniority");
    seniorityRow.appendChild(fieldLabel("label", "Seniority", seniority.id));
    enumFor("seniority", SENIORITY_LABELS).forEach(function (id) {
      seniority.appendChild(
        option(id, SENIORITY_LABELS[id] || id, id === model.identity.targetSeniority),
      );
    });
    seniority.value = model.identity.targetSeniority;
    seniority.addEventListener("change", function () {
      model.identity.targetSeniority = seniority.value;
      markChanged(record);
    });
    const seniorityError = makeErrorSlot(record, "seniority");
    record.fields.seniority = {
      invalid(entry) {
        if (entry) seniority.setAttribute("aria-invalid", "true");
        else seniority.removeAttribute("aria-invalid");
        describe(seniority, [entry ? seniorityError.id : ""]);
      },
      focusTarget() {
        return seniority;
      },
    };
    seniorityRow.append(seniority, seniorityError);
    node.appendChild(seniorityRow);
    return node;
  }

  function renderStory(record) {
    const model = record.model;
    const limit = limitFor("primaryNarrative");
    const min = typeof limit.minLength === "number" ? limit.minLength : 20;
    const max = typeof limit.maxLength === "number" ? limit.maxLength : 1200;
    const node = section("story", "Your story", "");

    const field = el("div", "oneflow-fit-field oneflow-fit-narrative");
    const narrative = el("textarea", "oneflow-fit-textarea");
    narrative.id = nextId("narrative");
    narrative.rows = 3;
    narrative.maxLength = max;
    narrative.value = model.identity.primaryNarrative;
    field.appendChild(
      fieldLabel(
        "label",
        "In one or two sentences, what do you do best?",
        narrative.id,
      ),
    );
    const counter = el("p", "oneflow-fit-counter");
    counter.id = nextId("counter");
    const error = makeErrorSlot(record, "narrative");

    function updateCounter() {
      const length = text(narrative.value).length;
      counter.textContent =
        length < min
          ? `${length} / ${max} · ${min - length} more to go`
          : `${length} / ${max}`;
      counter.classList.toggle("is-short", length < min);
    }

    narrative.addEventListener("input", function () {
      model.identity.primaryNarrative = narrative.value;
      updateCounter();
      autoGrow(narrative);
      markChanged(record);
    });
    describe(narrative, [counter.id]);
    record.fields.narrative = {
      invalid(entry) {
        if (entry) narrative.setAttribute("aria-invalid", "true");
        else narrative.removeAttribute("aria-invalid");
        describe(narrative, [entry ? error.id : "", counter.id]);
      },
      focusTarget() {
        return narrative;
      },
    };
    updateCounter();
    const foot = el("div", "oneflow-fit-narrative__foot");
    foot.append(error, counter);
    field.append(narrative, foot);
    node.appendChild(field);
    record.afterMount.push(function () {
      autoGrow(narrative);
    });
    return node;
  }

  function renderStrengths(record) {
    const node = section(
      "strengths",
      "Strengths",
      "Strongest first. Drag the handle to rerank.",
    );
    const field = el("div", "oneflow-fit-field");
    const label = fieldLabel("p", "Your strengths, ranked");
    label.classList.add("oneflow-fit-sr");
    field.appendChild(label);
    const error = makeErrorSlot(record, "strengths");
    const nameLimit = limitFor("strengthName");
    field.appendChild(
      renderTagInput(record, {
        key: "strengths",
        items: record.model.strengths,
        limit: "strengths",
        maxLength: typeof nameLimit.maxLength === "number" ? nameLimit.maxLength : 0,
        ordered: true,
        ranked: true,
        labelId: label.id,
        errorId: error.id,
        itemLabel: "Strength",
        noun: "strength",
        plural: "strengths",
        placeholder: "Add a strength",
        read(item) {
          return item ? item.name : "";
        },
        write(index, value) {
          record.model.strengths[index].name = value;
        },
        make(value) {
          return { name: value, evidence: "", keywords: [] };
        },
      }),
    );
    field.appendChild(error);
    node.appendChild(field);
    return node;
  }

  function salarySummary(hard) {
    const parts = [];
    if (typeof hard.salaryFloor === "number" && hard.salaryFloor > 0) {
      parts.push(
        `listed salaries under $${Math.round(hard.salaryFloor / 1000)}k are hidden`,
      );
    }
    if (hard.salaryRequired) parts.push("jobs without a salary are hidden");
    return parts;
  }

  function summaryLine(model) {
    const hard = model.hardConstraints;
    let where = "Anywhere";
    if (hard.workMode === "remote_only") where = "Remote only";
    if (workModeUsesLocations(hard.workMode)) {
      const places = strings(hard.acceptableLocations).join(" or ");
      const mode = hard.workMode === "hybrid_ok" ? "Hybrid" : "Onsite";
      where = places ? `${mode} in ${places}` : mode;
    }
    const salary = salarySummary(hard);
    return salary.length ? `${where}; ${salary.join(", and ")}.` : `${where}.`;
  }

  function renderDealBreakers(record) {
    const model = record.model;
    const hard = model.hardConstraints;
    const node = section(
      "dealbreakers",
      "Deal-breakers",
      "Jobs that miss these are hidden, not just ranked lower.",
    );
    const summary = el("p", "oneflow-fit-summary");
    summary.setAttribute("aria-live", "polite");
    node.appendChild(summary);

    // Work mode — a radio group, drawn as a segmented control.
    const modes = el("fieldset", "oneflow-fit-field oneflow-fit-modes");
    modes.appendChild(el("legend", "oneflow-fit-field__label", "Work mode"));
    const radios = el("div", "oneflow-fit-radios");
    const radioInputs = [];
    let locationsRow;
    const radioName = nextId("work-mode");
    enumFor("workMode", WORK_MODE_LABELS).forEach(function (id) {
      const label = el("label", "oneflow-fit-radio");
      const input = el("input", "");
      input.type = "radio";
      input.name = radioName;
      input.value = id;
      input.checked = hard.workMode === id;
      input.dataset.workMode = id;
      input.addEventListener("change", function () {
        hard.workMode = id;
        if (locationsRow) locationsRow.hidden = !workModeUsesLocations(id);
        markChanged(record);
      });
      radioInputs.push(input);
      label.append(input, el("span", "", WORK_MODE_LABELS[id] || id));
      radios.appendChild(label);
    });
    modes.appendChild(radios);
    const modeError = makeErrorSlot(record, "workMode");
    modes.appendChild(modeError);
    record.fields.workMode = {
      invalid() {},
      focusTarget() {
        return (
          radioInputs.find(function (input) {
            return input.checked;
          }) || radioInputs[0]
        );
      },
    };
    node.appendChild(modes);

    locationsRow = el("div", "oneflow-fit-field oneflow-fit-locations");
    locationsRow.hidden = !workModeUsesLocations(hard.workMode);
    const locationsLabel = fieldLabel("p", "Acceptable locations");
    locationsRow.appendChild(locationsLabel);
    const locationsError = makeErrorSlot(record, "locations");
    locationsRow.appendChild(
      renderTagInput(record, {
        key: "locations",
        items: hard.acceptableLocations,
        limit: "acceptableLocations",
        labelId: locationsLabel.id,
        errorId: locationsError.id,
        itemLabel: "Location",
        noun: "location",
        plural: "locations",
        placeholder: "Add a city or metro",
      }),
    );
    locationsRow.appendChild(locationsError);
    record.fields.locations.row = locationsRow;
    node.appendChild(locationsRow);

    const authRow = el("div", "oneflow-fit-field");
    const auth = el("select", "oneflow-fit-select");
    auth.id = nextId("work-auth");
    authRow.appendChild(fieldLabel("label", "Work authorization", auth.id));
    enumFor("workAuth", WORK_AUTH_LABELS).forEach(function (id) {
      auth.appendChild(option(id, WORK_AUTH_LABELS[id] || id, id === hard.workAuth));
    });
    auth.value = hard.workAuth;
    auth.addEventListener("change", function () {
      hard.workAuth = auth.value;
      markChanged(record);
    });
    const authError = makeErrorSlot(record, "workAuth");
    record.fields.workAuth = {
      invalid(entry) {
        if (entry) auth.setAttribute("aria-invalid", "true");
        else auth.removeAttribute("aria-invalid");
        describe(auth, [entry ? authError.id : ""]);
      },
      focusTarget() {
        return auth;
      },
    };
    authRow.append(auth, authError);
    node.appendChild(authRow);

    // D5 / N-B4-4: one salary control, with the rule it follows spelled out.
    const salaryRow = el("div", "oneflow-fit-field oneflow-fit-salary");
    const salary = el("input", "oneflow-fit-input oneflow-fit-salary__input");
    salary.id = nextId("salary");
    salary.type = "number";
    salary.min = "0";
    salary.step = "1000";
    salary.inputMode = "numeric";
    salary.placeholder = "None";
    salary.value = hard.salaryFloor || "";
    salaryRow.appendChild(fieldLabel("label", "Minimum salary", salary.id));
    const salaryBox = el("div", "oneflow-fit-salary__box");
    const currency = el("span", "oneflow-fit-salary__affix", "$");
    currency.setAttribute("aria-hidden", "true");
    const period = el("span", "oneflow-fit-salary__affix", "a year");
    salaryBox.append(currency, salary, period);
    salaryRow.appendChild(salaryBox);
    const help = el(
      "p",
      "oneflow-fit-help",
      "The minimum only applies to jobs that list a salary.",
    );
    help.id = nextId("salary-help");
    const salaryError = makeErrorSlot(record, "salary");
    describe(salary, [help.id]);
    salary.addEventListener("input", function () {
      const value = Number(salary.value);
      hard.salaryFloor =
        salary.value !== "" && Number.isFinite(value) && value > 0
          ? Math.floor(value)
          : null;
      markChanged(record);
    });
    const requiredLabel = el("label", "oneflow-fit-check");
    const required = el("input", "");
    required.type = "checkbox";
    required.checked = hard.salaryRequired;
    required.addEventListener("change", function () {
      hard.salaryRequired = !!required.checked;
      markChanged(record);
    });
    requiredLabel.append(
      required,
      el("span", "", "Also hide jobs that don't list a salary"),
    );
    record.fields.salary = {
      invalid(entry) {
        if (entry) salary.setAttribute("aria-invalid", "true");
        else salary.removeAttribute("aria-invalid");
        describe(salary, [entry ? salaryError.id : "", help.id]);
      },
      focusTarget() {
        return salary;
      },
    };
    salaryRow.append(help, requiredLabel, salaryError);
    node.appendChild(salaryRow);

    return { node, summary };
  }

  function renderPreferences(record) {
    const model = record.model;
    const details = el("details", "oneflow-fit-section oneflow-fit-prefs");
    const summary = el("summary", "oneflow-fit-prefs__summary");
    const title = el("span", "oneflow-fit-section__title", "Preferences");
    const badge = el("span", "oneflow-fit-prefs__count");
    summary.append(title, badge);
    details.appendChild(summary);

    const body = el("div", "oneflow-fit-prefs__body");
    body.appendChild(
      el(
        "p",
        "oneflow-fit-section__lede",
        "More of and Less of nudge the ranking. Skip titles hides jobs with those titles.",
      ),
    );

    [
      {
        key: "wants",
        heading: "More of",
        items: model.wants,
        limit: "wants",
        itemLabel: "More of",
        noun: "item",
        plural: "items",
        placeholder: "Add something you want more of",
        hint: "Add one",
      },
      {
        key: "avoids",
        heading: "Less of",
        items: model.avoids,
        limit: "avoids",
        itemLabel: "Less of",
        noun: "item",
        plural: "items",
        placeholder: "Add something you want less of",
        hint: "Add one",
      },
      {
        key: "skipTitles",
        heading: "Skip titles",
        items: model.hardConstraints.skipTitles,
        limit: "skipTitles",
        itemLabel: "Skip title",
        noun: "title",
        plural: "titles",
        placeholder: "Add a title to skip",
      },
    ].forEach(function (spec) {
      const field = el("div", `oneflow-fit-field oneflow-fit-prefs__${spec.key}`);
      const heading = el("h4", "oneflow-fit-field__label", spec.heading);
      heading.id = nextId("label");
      field.appendChild(heading);
      const error = makeErrorSlot(record, spec.key);
      field.appendChild(
        renderTagInput(record, {
          ...spec,
          labelId: heading.id,
          errorId: error.id,
        }),
      );
      field.appendChild(error);
      body.appendChild(field);
    });
    details.appendChild(body);

    function updateCount() {
      const count =
        strings(model.wants).length +
        strings(model.avoids).length +
        strings(model.hardConstraints.skipTitles).length;
      badge.textContent = String(count);
      badge.setAttribute("aria-label", `${count} set`);
      badge.hidden = count === 0;
    }
    updateCount();
    return { node: details, updateCount };
  }

  // ---------------------------------------------------------------
  // Draft + record
  // ---------------------------------------------------------------

  function getDraft(ctx) {
    const runtime = ctx.runtime || {};
    const state = ctx.state || {};
    // `runtime.drafts` is the persisted bag the controller hydrates on
    // open (spec §3.2). After a refresh it is the ONLY draft there is —
    // the rerun's NEW-14 was this beat reading in-memory scratch alone
    // and rendering an empty, un-advanceable review.
    const drafts =
      runtime.drafts && typeof runtime.drafts === "object" ? runtime.drafts : {};
    return (
      runtime.profileDraft ||
      runtime.fitProfileDraft ||
      drafts.profileDraft ||
      state.profileDraft ||
      state.fitProfileDraft ||
      {}
    );
  }

  /**
   * Persist the correction the user just made (spec §3.2: "B4 edits …
   * persist under the same key on input, debounced"). The controller owns
   * the debounce; this only names the draft.
   */
  function persistDraft(record) {
    const ctx = record.ctx;
    if (!ctx || typeof ctx.saveDraft !== "function") return;
    ctx.saveDraft("profileDraft", buildPayload(record.model));
  }

  function getRecord(ctx) {
    const runtime = ctx.runtime || {};
    // JOBQA: a review built under another account's setup is rebuilt.
    if (runtime.oneFlowFitReview && runtime.oneFlowFitReview.scope !== ctx.scope) {
      runtime.oneFlowFitReview = null;
    }
    if (!runtime.oneFlowFitReview) {
      const model = normalizeDraft(getDraft(ctx));
      runtime.oneFlowFitReview = {
        model,
        originalPayload: JSON.stringify(buildPayload(model)),
        saving: false,
        errors: {},
        fields: {},
        shown: {},
        scope: ctx.scope,
        // The saved setup's revision as this review opened: a save made
        // elsewhere since then makes the commit a 409 instead of a silent
        // overwrite (JOBQA). Only a browser that saved a setup here before
        // can replace one, so only it asks.
        base: readBaseIfReplacing(),
      };
    }
    return runtime.oneFlowFitReview;
  }

  function render(container, ctx) {
    const record = getRecord(ctx);
    record.ctx = ctx;
    record.container = container;
    record.errors = {};
    record.fields = {};
    record.shown = {};
    record.afterMount = [];

    const root = el("div", "oneflow-fit");
    const zones = el("div", "oneflow-fit__zones");
    const main = el("div", "oneflow-fit__zone oneflow-fit__zone--main");
    const aside = el("div", "oneflow-fit__zone oneflow-fit__zone--aside");

    main.append(renderTarget(record), renderStory(record), renderStrengths(record));
    const deal = renderDealBreakers(record);
    const prefs = renderPreferences(record);
    record.prefs = prefs.node;
    aside.append(deal.node, prefs.node);
    zones.append(main, aside);

    record.live = el("p", "oneflow-fit-sr");
    record.live.setAttribute("aria-live", "polite");
    root.append(zones, record.live);
    record.adopt = button("Use the setup saved on this computer", "oneflow-fit-link-button oneflow-fit-adopt", function () {
      adoptSavedSetup(ctx);
    });
    record.adopt.hidden = !record.savedSetup;
    root.appendChild(record.adopt);
    container.appendChild(root);
    if (!record.savedLookup) record.savedLookup = refreshSavedOffer(record, ctx);

    record.updateSummary = function () {
      deal.summary.textContent = summaryLine(record.model);
      prefs.updateCount();
    };
    record.updateSummary();
    record.afterMount.forEach(function (fn) {
      fn();
    });
  }

  // ---------------------------------------------------------------
  // Save (N-B4-1, R7)
  // ---------------------------------------------------------------

  /* E4: the JobBored API transport. Attaches the hosted token when
     hosted-api-auth.js is loaded; plain fetch otherwise. */
  function apiFetch(url, init) {
    const auth = window.JobBoredHostedApiAuth;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    // window.fetch, as fit-profile-sync.js uses: the page's own transport.
    if (typeof window.fetch !== "function") return Promise.reject(new Error("fetch unavailable"));
    return window.fetch(url, init);
  }

  function profileUrl(path) {
    const api = window.JobBoredProfileApi;
    if (api && typeof api.profileUrl === "function") return api.profileUrl(path);
    return path;
  }

  /** Lowercase hex sha256 of `value` (the proof of which saved resume this browser holds). */
  async function sha256Hex(value) {
    const subtle = window.crypto && window.crypto.subtle;
    const Encoder = window.TextEncoder || (typeof TextEncoder === "function" ? TextEncoder : null);
    if (!subtle || !Encoder) return "";
    const digest = await subtle.digest("SHA-256", new Encoder().encode(value));
    return Array.from(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  /** The saved setup's revision, when this browser holds the resume it saved; else null. */
  function readBaseIfReplacing() {
    const store = window.CommandCenterUserContent;
    if (!store || typeof store.getActiveResume !== "function") return Promise.resolve(null);
    return Promise.resolve()
      .then(function () {
        return store.getActiveResume();
      })
      .then(function (held) {
        return held && text(held.extractedText) ? readCommitState() : null;
      })
      .catch(function () {
        return null;
      });
  }

  /** The completed canonical setup's revision and recorded owner. */
  function readCommitState() {
    return apiFetch(profileUrl("/profile/commit/state"), { method: "GET" })
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .then(function (data) {
        return data && data.ok === true
          ? { exists: !!data.exists, revision: text(data.revision), accountHash: text(data.accountHash) || null }
          : null;
      })
      .catch(function () {
        return null;
      });
  }

  async function adoptionAccount(ctx) {
    const signedIn = typeof flow.currentAccountHash === "function" ? await flow.currentAccountHash() : "";
    const current = typeof ctx.isCurrentScope !== "function" || ctx.isCurrentScope(ctx.scope);
    return current && signedIn && (!ctx.accountHash || ctx.accountHash === signedIn) ? signedIn : "";
  }

  function canAdopt(saved, account) {
    return !!(account && saved && saved.exists && (!saved.accountHash || saved.accountHash === account));
  }

  async function refreshSavedOffer(record, ctx) {
    const account = await adoptionAccount(ctx);
    const saved = account ? await readCommitState() : null;
    if (account !== await adoptionAccount(ctx)) return;
    record.savedSetup = canAdopt(saved, account) ? saved : null;
    if (record.adopt) record.adopt.hidden = !record.savedSetup;
  }

  /** Explicitly adopt a completed saved setup; no canonical write is made. */
  async function adoptSavedSetup(ctx) {
    const record = getRecord(ctx);
    if (record.saving) return;
    const store = window.CommandCenterUserContent;
    if (!store || typeof store.setPrimaryResume !== "function" || typeof store.saveDiscoveryProfile !== "function") return;
    record.saving = true;
    const stillHere = () => typeof ctx.isCurrentScope !== "function" || ctx.isCurrentScope(ctx.scope);
    try {
      const account = await adoptionAccount(ctx);
      const before = account ? await readCommitState() : null;
      if (!canAdopt(before, account) || account !== await adoptionAccount(ctx)) {
        if (stillHere()) ctx.setMessage("Sign in with the Google account that owns this computer's saved setup to use it.", "error");
        return;
      }
      ctx.setBusy("adopt-saved-setup", [{ label: "Loading your saved setup…", state: "active" }]);
      const profileRes = await apiFetch(profileUrl("/profile"), { method: "GET" });
      const profileData = profileRes.ok ? await profileRes.json() : null;
      const resumeRes = await apiFetch(profileUrl("/profile/resume"), { method: "GET" });
      const resumeData = resumeRes.ok ? await resumeRes.json() : null;
      if (!stillHere() || account !== await adoptionAccount(ctx)) return;
      const after = await readCommitState();
      if (!canAdopt(after, account) || after.revision !== before.revision || after.accountHash !== before.accountHash) {
        ctx.setMessage("The saved setup changed while it was loading. Use the saved setup again to load its latest version.", "error");
        return;
      }
      const profile = profileData && profileData.ok === true && profileData.profile;
      const resumeText = resumeData && resumeData.resumeText;
      const api = schema();
      if (!profile || !api || !api.validateProfile(profile).ok || !resumeData || resumeData.ok !== true ||
          (resumeText !== null && typeof resumeText !== "string")) {
        ctx.setMessage("The saved setup couldn't be loaded. Open Settings → Resume to review it.", "error");
        return;
      }
      if (!stillHere() || account !== await adoptionAccount(ctx)) return;
      if (resumeText) {
        await store.setPrimaryResume({ source: "file", rawMime: null, label: "My resume", extractedText: resumeText, confirmGarbled: true, syncServer: false });
      } else if (typeof store.setActiveResumeId === "function") {
        await store.setActiveResumeId(null);
      }
      if (!stillHere() || account !== await adoptionAccount(ctx)) return;
      await store.saveDiscoveryProfile(discoveryPayload(normalizeDraft(profile)));
      if (!stillHere() || account !== await adoptionAccount(ctx)) return;
      if (typeof ctx.saveDraft === "function") {
        ctx.saveDraft("profileDraft", profile);
        ctx.saveDraft("resumeText", resumeText || "");
        ctx.saveDraft("contactDraft", null);
        ctx.saveDraft("voiceDraft", null);
        ctx.saveDraft("resumeRead", null);
      }
      ctx.runtime.fitProfile = profile;
      ctx.runtime.profileDraft = profile;
      ctx.runtime.contactIdentity = null;
      ctx.runtime.resumeRead = null;
      ctx.runtime.oneFlowFitReview = null;
      ctx.runtime.fitProfileSync = { ok: true, synced: true, reason: "adopted" };
      forgetCommitId(ctx.accountHash || account);
      ctx.setMessage("", "info");
      await ctx.completeBeat({ edited: false, serverSynced: true, syncReason: "adopted" });
    } catch (_) {
      if (stillHere()) ctx.setMessage("The saved setup couldn't be loaded into this browser. Try using it again, or open Settings → Resume.", "error");
    } finally {
      record.saving = false;
      if (stillHere()) ctx.clearBusy();
    }
  }

  function stagedResumeText(ctx) {
    const runtime = (ctx && ctx.runtime) || {};
    const drafts = runtime.drafts && typeof runtime.drafts === "object" ? runtime.drafts : {};
    return typeof drafts.resumeText === "string" ? drafts.resumeText.replace(/\r/g, "").trim() : "";
  }

  /** The voice guide "Your voice" completed with; null when it was skipped or never used. */
  function stagedVoice(ctx) {
    const flowState = (ctx && ctx.state) || {};
    const used =
      Array.isArray(flowState.completedBeats) &&
      flowState.completedBeats.indexOf("voice") !== -1 &&
      !(flowState.skipped && flowState.skipped.voice);
    const runtime = (ctx && ctx.runtime) || {};
    const drafts = runtime.drafts && typeof runtime.drafts === "object" ? runtime.drafts : {};
    const guide = typeof drafts.voiceDraft === "string" ? drafts.voiceDraft.trim() : "";
    return used && guide ? { text: guide } : null;
  }

  /**
   * One id per setup, kept per account in this browser until the save has
   * fully landed here too: a double click, a lost answer, or a reload after
   * either replays the same save instead of making a second one (or being
   * refused as a second setup).
   */
  const COMMIT_ID_KEY = "jobbored.oneflow.commitId";
  /** This page's ids, so a retry replays even where localStorage is blocked. */
  const commitIds = new Map();
  function commitIdFor(owner) {
    const key = COMMIT_ID_KEY + ":" + String(owner || "unowned");
    if (commitIds.has(key)) return commitIds.get(key);
    try {
      const kept = window.localStorage.getItem(key);
      if (kept) {
        commitIds.set(key, kept);
        return kept;
      }
    } catch (_) {
      /* localStorage blocked: the in-page copy still covers retries */
    }
    const random =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
    const id = "onb-" + String(random).replace(/[^A-Za-z0-9_-]/g, "");
    commitIds.set(key, id);
    try {
      window.localStorage.setItem(key, id);
    } catch (_) {
      /* the in-page copy still covers retries */
    }
    return id;
  }

  function forgetCommitId(owner) {
    const key = COMMIT_ID_KEY + ":" + String(owner || "unowned");
    commitIds.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch (_) {
      /* nothing kept */
    }
  }

  /** What a refused commit tells the user. Nothing was saved in every case. */
  function commitRefusal(reason, fallback) {
    switch (reason) {
      case "canonical_profile_exists":
        return "This computer already has a saved JobBored profile, so nothing was saved. Use the setup saved on this computer with its Google account, or open Settings → Resume. Your answers stay in this setup.";
      case "profile_commit_stale":
        return "Your saved setup changed since this page opened, so nothing was saved. Reload JobBored, then confirm again.";
      case "replace_proof_mismatch":
        return "The resume saved on this computer isn't the one this browser saved, so nothing was replaced. Use the setup saved on this computer, or open Settings → Resume to review it.";
      case "account_mismatch":
        return "This computer's saved setup was confirmed with a different Google account, so nothing was replaced.";
      case "commit_id_reused":
        return "This setup was already saved from this browser. Reload JobBored to see it.";
      case "commit_failed_rolled_back":
        return "Saving failed, and nothing was changed. Try again.";
      default:
        return fallback || "JobBored couldn't save your setup. Nothing was changed. Try again.";
    }
  }

  function rejectedErrors(result) {
    const list = Array.isArray(result.errors) ? result.errors : [];
    return list
      .map(function (error) {
        if (!error || typeof error !== "object") return null;
        let field = pathFromPointer(error.instancePath);
        const missing = error.params && error.params.missingProperty;
        if (missing) field = field ? `${field}.${missing}` : String(missing);
        return { field, message: text(error.message) };
      })
      .filter(Boolean);
  }

  function validate(record) {
    const payload = buildPayload(record.model);
    const grouped = validationFor(payload);
    showErrors(record, grouped);
    if (Object.keys(grouped.byField).length || grouped.general.length) {
      focusFirstInvalid(record, grouped);
      return { payload: null, grouped };
    }
    return { payload, grouped };
  }

  /**
   * "Looks like me" is onboarding's one explicit save (JOBQA). Everything
   * staged since the resume — the resume text, this profile with the
   * details "Your details" confirmed, the voice guide "Your voice" kept —
   * goes to POST /profile/commit together; nothing was saved before this.
   * A fresh or demo browser can only create a setup where none exists; a
   * browser that saved this setup before replaces it with proof of the
   * resume it holds. The browser's own copy is written only after the
   * server said yes, and only while this account's setup is still the one
   * on screen: an answer for another account is never applied here.
   */
  async function confirmFit(ctx) {
    const record = getRecord(ctx);
    if (record.saving) return;
    // Captured before anything is awaited: whose setup this confirm is for.
    const scope = ctx.scope;
    const owner = typeof ctx.accountHash === "string" ? ctx.accountHash : "";
    const stillHere = function () {
      return typeof ctx.isCurrentScope !== "function" || ctx.isCurrentScope(scope);
    };
    // What "Your details" confirmed wins over whatever the draft carried.
    const confirmed = confirmedContact(ctx);
    if (confirmed) record.model.contact = contactOf(confirmed);
    const checked = validate(record);
    if (!checked.payload) {
      if (checked.grouped.general.length) {
        ctx.setMessage(checked.grouped.general.join(" "), "error");
      }
      return;
    }
    const payload = checked.payload;
    const store = window.CommandCenterUserContent;
    if (!store || typeof store.saveDiscoveryProfile !== "function" || typeof store.setPrimaryResume !== "function") {
      ctx.setMessage("Could not save your setup. Reload and try again.", "error");
      return;
    }

    record.saving = true;
    ctx.setMessage("", "info");
    ctx.setBusy(ACTION_ID, [{ label: "Saving your setup…", state: "active" }]);
    const stop = function (message) {
      ctx.clearBusy();
      record.saving = false;
      if (message) ctx.setMessage(message, "error");
    };
    const resumeText = stagedResumeText(ctx);
    let held = null;
    try {
      held = typeof store.getActiveResume === "function" ? await store.getActiveResume() : null;
    } catch (_) {
      held = null;
    }
    const signedIn =
      flow && typeof flow.currentAccountHash === "function" ? await flow.currentAccountHash() : "";
    const base = await (record.base || Promise.resolve(null));
    // Another account's setup took the screen while we waited: this confirm is void.
    if (!stillHere()) {
      record.saving = false;
      return;
    }
    if (owner && signedIn && signedIn !== owner) {
      stop(
        "You're signed in with a different Google account than the one these answers belong to, so nothing was saved. Sign in with that account to save them.",
      );
      return;
    }
    const heldText = held && typeof held.extractedText === "string" ? held.extractedText.replace(/\r/g, "").trim() : "";
    const body = {
      commitId: commitIdFor(owner),
      mode: heldText && resumeText ? "replace" : "create",
      profile: payload,
      accountHash: owner || signedIn || null,
    };
    if (resumeText) body.resumeText = resumeText;
    else body.noResume = true;
    if (body.mode === "replace") {
      body.proof = await sha256Hex(heldText);
      body.baseRevision = base ? base.revision : null;
      if (!stillHere()) {
        record.saving = false;
        return;
      }
    }
    const voice = stagedVoice(ctx);
    if (voice) body.voice = voice;
    const runtime = ctx.runtime || {};
    const read = runtime.resumeRead || (runtime.drafts && runtime.drafts.resumeRead);
    if (read && typeof read === "object" && resumeText && read.textSha256 === await sha256Hex(resumeText)) {
      body.read = read;
    }
    if (!stillHere()) {
      record.saving = false;
      return;
    }

    let res = null;
    let data = null;
    try {
      res = await apiFetch(profileUrl("/profile/commit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(function () {
        return null;
      });
    } catch (_) {
      res = null;
    }
    if (!stillHere()) {
      record.saving = false;
      return;
    }
    // No answer, or one we can't read: the save may or may not have landed.
    // The kept id makes pressing again safe either way.
    if (!res || (!data && (!res.status || res.status >= 500))) {
      stop(
        "We couldn't confirm the save: the connection to JobBored on this computer dropped. Press Looks like me again — it's safe, and it won't save twice.",
      );
      return;
    }
    if (!data || data.ok !== true) {
      const reason = text(data && data.reason);
      if (reason === "invalid_profile") {
        ctx.clearBusy();
        record.saving = false;
        const grouped = groupErrors(rejectedErrors(data));
        showErrors(record, grouped);
        const placed = focusFirstInvalid(record, grouped);
        const general = grouped.general.length ? grouped.general.join(" ") : placed ? "" : text(data.message);
        ctx.setMessage(general || "JobBored couldn't save this profile. Fix the highlighted fields.", "error");
        return;
      }
      // An id already recorded for other details: the next confirm starts a fresh one.
      if (reason === "commit_id_reused") forgetCommitId(owner);
      stop(commitRefusal(reason, text(data && data.message)));
      if (reason === "canonical_profile_exists" || reason === "replace_proof_mismatch") {
        record.savedLookup = refreshSavedOffer(record, ctx);
        await record.savedLookup;
      }
      return;
    }

    // The server holds the setup now. The browser keeps its copy second,
    // and only for the account whose setup this was.
    if (!stillHere()) {
      record.saving = false;
      return;
    }
    try {
      if (resumeText) {
        await store.setPrimaryResume({
          source: "file",
          rawMime: null,
          label: "My resume",
          extractedText: resumeText,
          // The server already checked this text on commit.
          confirmGarbled: true,
          syncServer: false,
        });
        if (!stillHere()) {
          record.saving = false;
          return;
        }
      }
      await store.saveDiscoveryProfile(discoveryPayload(record.model));
    } catch (_) {
      // Keep the id: pressing again replays the saved setup, then retries this copy.
      stop(
        "Your setup is saved on this computer, but this browser couldn't keep its own copy. Press Looks like me again to finish — it won't save twice.",
      );
      return;
    }
    if (!stillHere()) {
      record.saving = false;
      return;
    }
    forgetCommitId(owner);
    ctx.clearBusy();
    record.saving = false;
    // B6's "Your search" card prefers the profile the flow just saved
    // over a second GET /profile (spec §5 B6): leave it on the runtime
    // so the payoff renders from what the user literally just confirmed.
    if (ctx.runtime) {
      ctx.runtime.fitProfile = payload;
      ctx.runtime.fitProfileSync = { ok: true, synced: true, reason: "committed", commitId: data.commitId };
    }
    await ctx.completeBeat({
      edited: JSON.stringify(payload) !== record.originalPayload,
      serverSynced: true,
      syncReason: data.replayed ? "replayed" : "committed",
    });
  }

  flow.registerBeat({
    id: "fit",
    order: 4,
    label: "Your fit",
    timeLabel: "about 9 min left",
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
      if (actionId === "adopt-saved-setup") return adoptSavedSetup(ctx);
      if (actionId !== ACTION_ID) return;
      return confirmFit(ctx);
    },
  });
})();
