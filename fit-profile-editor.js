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

  function profileApiPath(path) {
    var FP = window.FitProfileForm;
    return FP && typeof FP.profileUrl === "function" ? FP.profileUrl(path) : path;
  }

  function isValidLogoSlug(value) {
    return /^[a-z0-9][a-z0-9-]{0,127}$/.test(String(value || ""));
  }

  function logoSlugFrom(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 128);
  }

  function logoDomainFrom(value) {
    var domain = String(value || "").trim();
    if (!domain) return "";
    domain = domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    domain = domain.split(/[/?#]/)[0].trim().toLowerCase();
    return domain;
  }

  function faviconPreviewUrl(domain) {
    var d = logoDomainFrom(domain);
    if (!d) return "";
    return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(d) + "&sz=128";
  }

  function collectLogoRows() {
    var rows = [];
    function add(type, item) {
      if (!item || typeof item !== "object") return;
      var label = String(item.label || item.company || item.name || item.title || "").trim();
      var slug = isValidLogoSlug(item.slug) ? String(item.slug) : logoSlugFrom(label);
      if (!slug || !isValidLogoSlug(slug)) return;
      rows.push({
        type: type,
        item: item,
        slug: slug,
        label: label || slug,
        domain: logoDomainFrom(item.logoDomain || item.domain || item.website),
      });
    }
    (Array.isArray(state && state.experiences) ? state.experiences : []).forEach(function (item) {
      add("experience", item);
    });
    (Array.isArray(state && state.projects) ? state.projects : []).forEach(function (item) {
      add("project", item);
    });
    return rows;
  }

  async function fetchBrandLogos() {
    var res = await fetch(profileApiPath("/api/brand-logos"), { method: "GET" });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) || "brand logo fetch failed");
    }
    return Array.isArray(data.logos) ? data.logos : [];
  }

  async function postResolveBrandLogos(force) {
    var res = await fetch(profileApiPath("/api/brand-logos/resolve"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: !!force }),
    });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) || "brand logo resolve failed");
    }
    return data.logos || [];
  }

  async function uploadBrandLogo(row, file) {
    if (!row || !file) return;
    row.item.slug = row.slug;
    row.item.label = row.label;
    row.item.logoUpload = "uploads/logo-" + row.slug + ".png";
    var form = new FormData();
    form.append("file", file);
    var res = await fetch(profileApiPath("/api/brand-logos/" + encodeURIComponent(row.slug)), {
      method: "POST",
      body: form,
    });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) || "logo upload failed");
    }
    return data;
  }

  function setLogoPanelStatus(panel, message, kind) {
    var status = panel ? panel.querySelector("[data-logo-status]") : null;
    if (!status) return;
    status.textContent = message || "";
    if (message) status.dataset.kind = kind || "info";
    else delete status.dataset.kind;
  }

  async function addBrandFromName(panel, name, domain) {
    var label = String(name || "").trim();
    if (!label) {
      setLogoPanelStatus(panel, "Enter a company name first.", "error");
      return false;
    }
    var slug = logoSlugFrom(label);
    if (!isValidLogoSlug(slug)) {
      setLogoPanelStatus(panel, "That company name can't be turned into a logo key.", "error");
      return false;
    }
    if (!Array.isArray(state.experiences)) state.experiences = [];
    var existing = state.experiences.concat(Array.isArray(state.projects) ? state.projects : []);
    var dup = existing.some(function (item) {
      if (!item) return false;
      var itemSlug = isValidLogoSlug(item.slug)
        ? item.slug
        : logoSlugFrom(item.label || item.company || item.name || item.title);
      return itemSlug === slug;
    });
    if (dup) {
      setLogoPanelStatus(panel, '"' + label + '" is already in the list.', "error");
      return false;
    }
    var entry = { slug: slug, label: label, company: label };
    var cleanDomain = logoDomainFrom(domain);
    if (cleanDomain) entry.logoDomain = cleanDomain;
    state.experiences.push(entry);
    setLogoPanelStatus(panel, 'Adding "' + label + '"…', "info");
    try {
      await handleSave();
      await postResolveBrandLogos(false);
      var refreshed = await fetchBrandLogos();
      renderBrandLogoRows(panel, refreshed);
      setLogoPanelStatus(panel, 'Resolved a logo for "' + label + '".', "ok");
      return true;
    } catch (err) {
      setLogoPanelStatus(panel, "Add failed: " + (err && err.message ? err.message : err), "error");
      return false;
    }
  }

  function renderAddBrandForm(panel) {
    var nameInput = el("input", {
      class: "fp-field__control fp-brand-logos__add-name",
      type: "text",
      placeholder: "Company name (e.g. Stripe)",
      "aria-label": "Company name to resolve a logo",
    });
    var domainInput = el("input", {
      class: "fp-field__control fp-brand-logos__add-domain",
      type: "text",
      placeholder: "Domain (optional)",
      "aria-label": "Logo domain override (optional)",
    });
    var addBtn = el(
      "button",
      {
        type: "button",
        class: "fp-btn fp-btn--primary",
        onclick: async function () {
          addBtn.disabled = true;
          addBtn.textContent = "Adding…";
          try {
            var ok = await addBrandFromName(panel, nameInput.value, domainInput.value);
            if (ok) {
              nameInput.value = "";
              domainInput.value = "";
            }
          } finally {
            addBtn.disabled = false;
            addBtn.textContent = "Add";
          }
        },
      },
      "Add",
    );
    nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addBtn.click();
      }
    });
    return el("div", { class: "fp-brand-logos__add" }, [
      el("span", { class: "fp-field__label fp-brand-logos__add-label" }, "Add a company"),
      el(
        "p",
        { class: "fp-field__hint" },
        "Type a company name and JobBored resolves its logo automatically. Domain is an optional override.",
      ),
      el("div", { class: "fp-brand-logos__add-row" }, [nameInput, domainInput, addBtn]),
    ]);
  }

  function renderLogoDropzone(onFile, labelText) {
    var input = el("input", {
      type: "file",
      accept: ".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp",
      hidden: true,
    });
    input.addEventListener("change", function () {
      var f = input.files && input.files[0];
      input.value = "";
      if (f) onFile(f);
    });
    var zone = el(
      "div",
      {
        class: "fp-logo-drop",
        role: "button",
        tabindex: "0",
        "aria-label": "Upload a logo image — drop a file or click to browse",
        onclick: function () {
          input.click();
        },
        onkeydown: function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.click();
          }
        },
      },
      [
        el("span", { class: "fp-logo-drop__icon", "aria-hidden": "true" }, "↑"),
        el("span", { class: "fp-logo-drop__text" }, labelText || "Drop logo or click"),
        input,
      ],
    );
    ["dragenter", "dragover"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        zone.classList.add("is-drag");
      });
    });
    ["dragleave", "dragend"].forEach(function (ev) {
      zone.addEventListener(ev, function () {
        zone.classList.remove("is-drag");
      });
    });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      zone.classList.remove("is-drag");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
    return zone;
  }

  function renderBrandLogoRows(panel, logos) {
    var list = panel.querySelector("[data-logo-list]");
    if (!list) return;
    clearChildren(list);
    var rows = collectLogoRows();
    if (!rows.length) {
      list.appendChild(
        el(
          "p",
          { class: "fp-brand-logos__empty" },
          "No experience or project logos yet. Add a company below to resolve its logo automatically.",
        ),
      );
      list.appendChild(renderAddBrandForm(panel));
      return;
    }
    var bySlug = {};
    (logos || []).forEach(function (logo) {
      if (logo && logo.slug) bySlug[logo.slug] = logo;
    });
    rows.forEach(function (row) {
      var current = bySlug[row.slug] || {};
      var mark = current.mark && current.mark.dataUrl ? current.mark.dataUrl : "";
      var preview = mark || faviconPreviewUrl(row.domain);
      var img = el("img", {
        class: "fp-brand-logo-row__thumb",
        alt: "",
        src: preview || "",
      });
      if (!preview) img.hidden = true;
      var domainInput = el("input", {
        class: "fp-field__control fp-brand-logo-row__domain",
        type: "text",
        value: row.domain,
        placeholder: "example.com",
        "aria-label": "Logo domain for " + row.label,
        oninput: function () {
          var domain = logoDomainFrom(domainInput.value);
          row.item.slug = row.slug;
          row.item.label = row.label;
          row.item.logoDomain = domain;
          var nextPreview = faviconPreviewUrl(domain);
          if (nextPreview) {
            img.hidden = false;
            img.src = nextPreview;
          }
          onAnyChange();
        },
      });
      var handleLogoFile = async function (file) {
        if (!file) return;
        setLogoPanelStatus(panel, "Uploading " + file.name + "…", "info");
        try {
          await uploadBrandLogo(row, file);
          await handleSave();
          var refreshed = await fetchBrandLogos();
          renderBrandLogoRows(panel, refreshed);
          setLogoPanelStatus(panel, "Logo uploaded.", "ok");
        } catch (err) {
          setLogoPanelStatus(panel, "Upload failed: " + (err && err.message ? err.message : err), "error");
        }
      };
      list.appendChild(
        el("div", { class: "fp-brand-logo-row" }, [
          img,
          el("div", { class: "fp-brand-logo-row__main" }, [
            el("div", { class: "fp-brand-logo-row__head" }, [
              el("span", { class: "fp-brand-logo-row__label" }, row.label),
              el("span", { class: "fp-brand-logo-row__meta" }, row.type + " · " + row.slug),
            ]),
            el("label", { class: "fp-brand-logo-row__field" }, [
              el("span", { class: "fp-brand-logo-row__field-label" }, "Logo domain"),
              domainInput,
            ]),
          ]),
          renderLogoDropzone(handleLogoFile, "Drop logo or click"),
        ]),
      );
    });
    list.appendChild(renderAddBrandForm(panel));
  }

  function renderBrandLogosPanel() {
    var list = el("div", { class: "fp-brand-logos__list", "data-logo-list": true }, [
      el("p", { class: "fp-brand-logos__empty" }, "Loading logo marks…"),
    ]);
    var panel = el("section", { class: "fp-settings__bucket fp-brand-logos" }, [
      el("div", { class: "fp-brand-logos__head" }, [
        el("div", {}, [
          el("h4", { class: "fp-settings__bucket-title" }, "Brand Logos"),
          el(
            "p",
            { class: "fp-settings__bucket-lede" },
            "Uploaded marks win. Otherwise JobBored auto-resolves a favicon from the company name or domain; if none is found, the logo is simply omitted.",
          ),
        ]),
        el(
          "button",
          {
            type: "button",
            class: "fp-btn fp-btn--ghost",
            onclick: async function () {
              setLogoPanelStatus(panel, "Resolving logo marks…", "info");
              try {
                await postResolveBrandLogos(true);
                var logos = await fetchBrandLogos();
                renderBrandLogoRows(panel, logos);
                setLogoPanelStatus(panel, "Logo marks refreshed.", "ok");
              } catch (err) {
                setLogoPanelStatus(panel, "Resolve failed: " + (err && err.message ? err.message : err), "error");
              }
            },
          },
          "Re-resolve",
        ),
      ]),
      list,
      el("span", { class: "fp-settings__status", "data-logo-status": true }),
    ]);
    fetchBrandLogos()
      .then(function (logos) { renderBrandLogoRows(panel, logos); })
      .catch(function (err) {
        clearChildren(list);
        list.appendChild(
          el("p", { class: "fp-brand-logos__empty" }, "Logo status is unavailable while the local server is offline."),
        );
        var offlineActions = el("div", { class: "fp-brand-logos__add-row fp-brand-logos__offline-actions" }, [
          el(
            "button",
            {
              type: "button",
              class: "fp-btn fp-btn--ghost",
              onclick: function () {
                setLogoPanelStatus(panel, "Retrying…", "info");
                fetchBrandLogos()
                  .then(function (logos) {
                    renderBrandLogoRows(panel, logos);
                    setLogoPanelStatus(panel, "Logo marks loaded.", "ok");
                  })
                  .catch(function (retryErr) {
                    setLogoPanelStatus(
                      panel,
                      retryErr && retryErr.message ? retryErr.message : "Logo fetch failed",
                      "error",
                    );
                  });
              },
            },
            "Retry",
          ),
        ]);
        list.appendChild(offlineActions);
        list.appendChild(renderAddBrandForm(panel));
        setLogoPanelStatus(panel, err && err.message ? err.message : "Logo fetch failed", "error");
      });
    return panel;
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
    var bucket6 = renderBrandLogosPanel();
    container.appendChild(bucket1);
    container.appendChild(bucket2);
    container.appendChild(bucket3);
    container.appendChild(bucket4);
    container.appendChild(bucket5);
    container.appendChild(bucket6);
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
