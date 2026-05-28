/**
 * fit-profile-editor.js — Settings → Fit Profile sub-tab.
 *
 * Renders an inline editor (no wizard, all buckets visible at once) into
 * the #settings-panel-fit-profile container. Save button POSTs the same
 * JSON the wizard produces. Last-saved timestamp shown above the save row.
 *
 * Uses the shared form builders exposed by fit-profile-wizard.js via
 * window.FitProfileForm.
 */
(function () {
  "use strict";

  var elsCache = {};
  var state = null;
  var lastSavedAt = null;
  var initialized = false;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === "class") node.className = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) node.setAttribute(k, "");
        else if (v !== false && v != null) node.setAttribute(k, String(v));
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
    } else if (children) node.appendChild(children);
    return node;
  }

  function clearChildren(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function formatTimestamp(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return (
        d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }) +
        " " +
        d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      );
    } catch (_) {
      return iso;
    }
  }

  function setStatus(msg, kind) {
    if (!elsCache.status) return;
    elsCache.status.textContent = msg || "";
    if (msg) elsCache.status.dataset.kind = kind || "info";
    else delete elsCache.status.dataset.kind;
  }

  function setSavedAt(iso) {
    lastSavedAt = iso || null;
    if (elsCache.savedAt) {
      elsCache.savedAt.textContent = lastSavedAt
        ? "Last saved " + formatTimestamp(lastSavedAt)
        : "Not yet saved.";
    }
  }

  function onAnyChange() {
    setStatus("Unsaved changes.", "info");
  }

  function rerender() {
    var FP = window.FitProfileForm;
    if (!FP) return;
    var container = elsCache.container;
    if (!container) return;
    clearChildren(container);

    var bucket1 = el("section", { class: "fp-settings__bucket" }, [
      el("h4", { class: "fp-settings__bucket-title" }, "Identity"),
      el(
        "p",
        { class: "fp-settings__bucket-lede" },
        "Target roles, seniority, years of experience, and your primary narrative.",
      ),
      FP.renderIdentityForm(state, onAnyChange),
    ]);
    var bucket2 = el("section", { class: "fp-settings__bucket" }, [
      el("h4", { class: "fp-settings__bucket-title" }, "Strengths"),
      el(
        "p",
        { class: "fp-settings__bucket-lede" },
        "Capability areas ranked by importance. Rank 1 = top weight.",
      ),
      FP.renderStrengthsList(state, onAnyChange),
    ]);
    var bucket3 = el("section", { class: "fp-settings__bucket" }, [
      el("h4", { class: "fp-settings__bucket-title" }, "Wants"),
      el(
        "p",
        { class: "fp-settings__bucket-lede" },
        "What you want the role to involve. Max " + FP.constants.WANTS_MAX + ".",
      ),
      FP.renderWantsAvoids(state, "wants", FP.constants.WANTS_MAX, onAnyChange),
    ]);
    var bucket4 = el("section", { class: "fp-settings__bucket" }, [
      el("h4", { class: "fp-settings__bucket-title" }, "Avoids"),
      el(
        "p",
        { class: "fp-settings__bucket-lede" },
        'Soft "please skip" signals. Max ' + FP.constants.AVOIDS_MAX + ".",
      ),
      FP.renderWantsAvoids(state, "avoids", FP.constants.AVOIDS_MAX, onAnyChange),
    ]);
    var bucket5 = el("section", { class: "fp-settings__bucket" }, [
      el("h4", { class: "fp-settings__bucket-title" }, "Hard constraints"),
      el(
        "p",
        { class: "fp-settings__bucket-lede" },
        "The only rules that hard-reject a listing before LLM scoring.",
      ),
      FP.renderHardConstraints(state, onAnyChange),
    ]);
    container.appendChild(bucket1);
    container.appendChild(bucket2);
    container.appendChild(bucket3);
    container.appendChild(bucket4);
    container.appendChild(bucket5);
  }

  async function handleSave() {
    var FP = window.FitProfileForm;
    if (!FP) {
      setStatus("Form library not ready — reload the page.", "error");
      return;
    }
    var payload = FP.buildPayload(state);
    var warnings = FP.validateClientSide(payload);
    if (warnings.length) {
      setStatus(warnings.join(" "), "error");
      return;
    }
    elsCache.saveBtn.disabled = true;
    elsCache.saveBtn.textContent = "Saving…";
    setStatus("Saving…", "info");
    try {
      var res = await FP.saveProfile(payload);
      if (!res.data || res.data.ok !== true) {
        if (res.data && Array.isArray(res.data.errors)) {
          setStatus(
            "Server rejected: " +
              res.data.errors
                .map(function (e) { return (e.instancePath || "/") + " " + e.message; })
                .join("; "),
            "error",
          );
        } else if (res.data && res.data.detail) {
          setStatus("Save failed: " + res.data.detail, "error");
        } else {
          setStatus("Save failed (HTTP " + res.httpStatus + ").", "error");
        }
        return;
      }
      setSavedAt(res.data.updatedAt);
      setStatus("Saved. New discoveries will use the updated profile immediately.", "ok");
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
      setStatus("Network error: " + (err && err.message ? err.message : err), "error");
    } finally {
      elsCache.saveBtn.disabled = false;
      elsCache.saveBtn.textContent = "Save profile";
    }
  }

  function buildShell() {
    var panel = document.getElementById("settings-panel-fit-profile");
    if (!panel) return null;
    clearChildren(panel);

    var head = el("div", { class: "fp-settings__head" }, [
      el("h4", { class: "settings-tab-panel__title" }, "Fit Profile"),
      el(
        "button",
        {
          type: "button",
          class: "fp-btn fp-btn--ghost",
          id: "fitProfileOpenWizardBtn",
          onclick: function () {
            window.location.hash = "#/onboarding/fit-profile";
          },
        },
        "Open full wizard",
      ),
    ]);
    var explainer = el(
      "p",
      { class: "fp-settings__explainer" },
      "Your fit profile determines how JobBored scores every job. Edit any bucket below and click Save — new discoveries will use the updated profile immediately. To rescore old listings, click Rescore all (button added by Task #6).",
    );
    var rescoreSlot = el("div", { id: "fit-profile-rescore-slot" });

    var container = el("div", { class: "fp-settings", id: "fitProfileEditorContainer" });
    var status = el("span", { class: "fp-settings__status" });
    var savedAtEl = el("span", { class: "fp-settings__saved-at" }, "Not yet saved.");
    var saveBtn = el(
      "button",
      {
        type: "button",
        class: "fp-btn fp-btn--primary",
        id: "fitProfileSaveBtn",
        onclick: handleSave,
      },
      "Save profile",
    );
    var saveRow = el("div", { class: "fp-settings__save-row" }, [
      savedAtEl,
      el("div", {}, [saveBtn, status]),
    ]);

    panel.appendChild(head);
    panel.appendChild(explainer);
    panel.appendChild(rescoreSlot);
    panel.appendChild(container);
    panel.appendChild(saveRow);

    elsCache = {
      panel: panel,
      container: container,
      saveBtn: saveBtn,
      status: status,
      savedAt: savedAtEl,
    };
    return elsCache;
  }

  async function loadFromServer() {
    var FP = window.FitProfileForm;
    if (!FP) return;
    try {
      var resp = await FP.fetchProfile();
      if (resp && resp.ok === true && resp.profile) {
        state = FP.mergeStateFromProfile(resp.profile);
        setSavedAt(resp.profile.updatedAt || null);
        setStatus("", "info");
      } else {
        state = FP.emptyProfile();
        setSavedAt(null);
        setStatus("No saved profile yet — fill these out and save.", "info");
      }
    } catch (err) {
      state = FP.emptyProfile();
      setStatus(
        "Could not contact the local server. Save will retry — fields will preserve your edits in this tab.",
        "error",
      );
    }
    rerender();
  }

  async function activate() {
    if (!buildShell()) return;
    if (!window.FitProfileForm) {
      setStatus("Form library not loaded.", "error");
      return;
    }
    await loadFromServer();
    initialized = true;
  }

  function maybeAutoActivateOnTabShown() {
    // The Settings tab controller toggles [hidden] on panels. Watch for
    // the panel becoming visible and lazy-init then. Cheap and avoids
    // populating the form before the user opens Settings.
    var panel = document.getElementById("settings-panel-fit-profile");
    if (!panel) return;
    if (!panel.hidden && !initialized) {
      activate();
      return;
    }
    var observer = new MutationObserver(function () {
      if (!panel.hidden && !initialized) {
        activate();
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  }

  function init() {
    maybeAutoActivateOnTabShown();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
