/**
 * Settings tab controller — ARIA-compliant tablist with keyboard nav.
 * Depends on settings-tab-schema.js being loaded first.
 */
(function () {
  "use strict";

  var Schema = window.JobBoredSettingsTabSchema;
  var activeTabId = null;
  var rootEl = null;

  /**
   * Initialize the settings tabs inside the given root element.
   * @param {HTMLElement} root  - The settings modal / container element
   * @param {object}      [opts]
   * @param {string}      [opts.defaultTab] - Tab to show on init (default: Schema.DEFAULT_TAB)
   */
  function initSettingsTabs(root, opts) {
    if (!root) return;
    rootEl = root;
    var defaultTab = (opts && opts.defaultTab) || Schema.DEFAULT_TAB;

    var tabButtons = root.querySelectorAll('[role="tab"]');
    tabButtons.forEach(function (btn) {
      if (btn.dataset.settingsTabsBound === "true") return;
      btn.dataset.settingsTabsBound = "true";
      btn.addEventListener("click", function () {
        var tabId = btn.getAttribute("data-tab-id");
        if (tabId) setActiveSettingsTab(tabId);
      });
      btn.addEventListener("keydown", handleTabKeydown);
    });

    setActiveSettingsTab(defaultTab, { silent: true });
  }

  /**
   * Activate a tab by id.
   * @param {string} tabId
   * @param {object} [opts]
   * @param {boolean} [opts.silent]     - Skip focus of the tab button
   * @param {string}  [opts.focusField] - After activation, focus this element id
   */
  function setActiveSettingsTab(tabId, opts) {
    if (!rootEl) return;
    var meta = Schema.getSettingsTabMeta(tabId);
    if (!meta) return;

    var order = Schema.getSettingsTabOrder();

    // Deactivate all tabs and hide all panels
    order.forEach(function (tid) {
      var m = Schema.getSettingsTabMeta(tid);
      if (!m) return;
      var btn = rootEl.querySelector("#" + m.buttonId);
      var panel = rootEl.querySelector("#" + m.panelId);
      if (btn) {
        btn.setAttribute("aria-selected", "false");
        btn.setAttribute("tabindex", "-1");
      }
      if (panel) {
        panel.hidden = true;
      }
    });

    // Activate requested tab
    var activeBtn = rootEl.querySelector("#" + meta.buttonId);
    var activePanel = rootEl.querySelector("#" + meta.panelId);
    if (activeBtn) {
      activeBtn.setAttribute("aria-selected", "true");
      activeBtn.setAttribute("tabindex", "0");
    }
    if (activePanel) {
      activePanel.hidden = false;
    }

    activeTabId = tabId;

    var silent = opts && opts.silent;
    if (!silent && activeBtn) {
      activeBtn.focus();
    }

    // Optional: focus a specific field after tab switch
    if (opts && opts.focusField) {
      requestAnimationFrame(function () {
        var field = document.getElementById(opts.focusField);
        if (field) {
          field.focus();
          if (typeof field.select === "function" && field.tagName === "INPUT") {
            field.select();
          }
        }
      });
    }
  }

  function getActiveSettingsTab() {
    return activeTabId;
  }

  /**
   * Activate the tab containing a given field, then focus it.
   * @param {string} fieldId
   */
  function activateTabForField(fieldId) {
    var tabId = Schema.getSettingsTabForField(fieldId);
    if (!tabId) return;
    setActiveSettingsTab(tabId, { silent: true, focusField: fieldId });
  }

  /** Arrow-key navigation within the tablist (WAI-ARIA tabs pattern). */
  function handleTabKeydown(e) {
    var order = Schema.getSettingsTabOrder();
    var currentIdx = order.indexOf(activeTabId);
    if (currentIdx === -1) return;

    var nextIdx = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (currentIdx + 1) % order.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (currentIdx - 1 + order.length) % order.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = order.length - 1;
    }

    if (nextIdx >= 0) {
      e.preventDefault();
      setActiveSettingsTab(order[nextIdx]);
    }
  }

  window.JobBoredSettingsTabs = {
    initSettingsTabs: initSettingsTabs,
    setActiveSettingsTab: setActiveSettingsTab,
    getActiveSettingsTab: getActiveSettingsTab,
    activateTabForField: activateTabForField,
  };
})();
