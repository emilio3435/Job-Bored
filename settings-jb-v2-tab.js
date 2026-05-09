/**
 * settings-jb-v2-tab.js — Conductor / Phase 4 + Phase 2.E (Droid 2.E)
 * ------------------------------------------------------------
 * Wires the "Enable v2 redesign" switch in the Settings → Setup
 * tab to Atlas's existing window.JB_V2 plumbing, plus a Phase 2.E
 * "Flowing layout" sub-toggle that controls `body.flowing`.
 *
 * Contract:
 *   - Reads window.JB_V2.on for current state on mount.
 *   - On v2 toggle ON  → window.JB_V2.enable()  (sets body.jb-v2 + persists).
 *   - On v2 toggle OFF → window.JB_V2.disable() (removes class + clears storage).
 *     Also forces body.flowing OFF (flowing is a v2-only layout).
 *   - Reflects cross-tab storage changes back into the checkboxes.
 *   - Flowing sub-toggle:
 *       • Visible only when v2 is ON.
 *       • Defaults to ON when v2 is on (flowing is the only v2 layout shipping).
 *       • Persists to localStorage under JB_FLOWING_KEY.
 *       • When ON and v2 is ON: body.classList.add('flowing').
 *       • When OFF or v2 is OFF: body.classList.remove('flowing').
 *   - URL override: ?flow=1 force-enables both v2 and flowing on load
 *     (mirrors the existing ?jb-v2=1 pattern in index.html).
 *
 * No new tokens, no new components. The switch DOM uses
 * .jb-v2-switch styles defined in settings-tabs.css.
 */
(function () {
  "use strict";

  var TOGGLE_ID = "settingsJbV2Toggle";
  var FLOW_TOGGLE_ID = "settingsJbV2FlowingToggle";
  var FLOW_ROW_ID = "settingsJbV2FlowingRow";
  var FLOW_KEY = "jb-flowing-flag";
  var bound = false;

  function getApi() {
    return (typeof window !== "undefined" && window.JB_V2) || null;
  }

  function isOn() {
    var api = getApi();
    if (api && typeof api.on === "boolean") return api.on;
    // Fallback: trust the DOM if the flag plumbing is unavailable.
    return !!(document.body && document.body.classList.contains("jb-v2"));
  }

  // ----- Flowing sub-flag plumbing --------------------------------------
  // Storage default: when v2 is on and the user has never touched the
  // sub-toggle, flowing is treated as ON (since it is the only v2 layout
  // shipping). The key is only written once the user toggles, or by the
  // ?flow=1 URL override.
  function readFlowingStored() {
    try {
      return localStorage.getItem(FLOW_KEY);
    } catch (_) {
      return null;
    }
  }

  function writeFlowingStored(value) {
    try {
      if (value === null) localStorage.removeItem(FLOW_KEY);
      else localStorage.setItem(FLOW_KEY, value);
    } catch (_) {
      /* noop */
    }
  }

  function isFlowingDesired() {
    // Flowing only exists when v2 is on. Off-v2 always means off-flowing.
    if (!isOn()) return false;
    var stored = readFlowingStored();
    if (stored === "1") return true;
    if (stored === "0") return false;
    // Default for the sub-toggle when v2 is on: ON.
    return true;
  }

  function applyFlowingClass() {
    if (!document.body) return;
    var want = isFlowingDesired();
    if (want) document.body.classList.add("flowing");
    else document.body.classList.remove("flowing");
  }

  // ----- URL override: ?flow=1 ----------------------------------------
  // Eager (pre-DOMContentLoaded) so first paint reflects the override.
  // Mirrors the ?jb-v2=1 pattern in index.html.
  (function applyUrlOverride() {
    try {
      var qs = new URLSearchParams(window.location.search);
      var flow = qs.get("flow");
      if (flow === "1" || flow === "true") {
        // Force flowing ON.
        writeFlowingStored("1");
        // Also force v2 ON (flowing requires v2).
        var api = getApi();
        if (api && typeof api.enable === "function") {
          api.enable();
          api.on = true;
        } else if (document.body) {
          // Plumbing not yet attached; flip the class directly. The
          // JB_V2 boot script in index.html will pick up the storage
          // value on next load via its own ?jb-v2=1 path. We don't
          // touch its (redacted) storage key here.
          document.body.classList.add("jb-v2");
        }
        // Apply body.flowing now if body is parsed.
        if (document.body) document.body.classList.add("flowing");
        else
          document.addEventListener(
            "DOMContentLoaded",
            function () {
              document.body.classList.add("flowing");
            },
            { once: true },
          );
      } else if (flow === "0" || flow === "false") {
        // Explicit opt-out. Persist OFF so reloads stick.
        writeFlowingStored("0");
      }
    } catch (_) {
      /* noop: flag stays at its stored/default value */
    }
  })();

  // ----- Sub-toggle DOM injection -------------------------------------
  // We do not own index.html, so the flowing sub-toggle is built in JS
  // and inserted into the same .jb-v2-toggle-row container as the v2
  // toggle. Reuses the existing .jb-v2-switch* classes (token-only CSS
  // already in settings-tabs.css).
  function buildFlowingRow() {
    var row = document.createElement("div");
    row.id = FLOW_ROW_ID;
    row.className = "jb-v2-toggle-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-labelledby", FLOW_TOGGLE_ID + "Label");

    var label = document.createElement("label");
    label.className = "jb-v2-switch";
    label.setAttribute("for", FLOW_TOGGLE_ID);

    var input = document.createElement("input");
    input.type = "checkbox";
    input.id = FLOW_TOGGLE_ID;
    input.className = "jb-v2-switch__input";
    input.setAttribute("role", "switch");
    input.setAttribute("aria-checked", "false");

    var track = document.createElement("span");
    track.className = "jb-v2-switch__track";
    track.setAttribute("aria-hidden", "true");
    var thumb = document.createElement("span");
    thumb.className = "jb-v2-switch__thumb";
    track.appendChild(thumb);

    var labelText = document.createElement("span");
    labelText.className = "jb-v2-switch__label";
    labelText.id = FLOW_TOGGLE_ID + "Label";
    labelText.textContent = "Flowing layout";

    label.appendChild(input);
    label.appendChild(track);
    label.appendChild(labelText);

    var hint = document.createElement("p");
    hint.className = "settings-field-hint settings-field-hint--compact";
    hint.id = FLOW_TOGGLE_ID + "Hint";
    hint.textContent =
      "Single-page flowing layout (Brief / Pipeline / Letter). Requires v2 redesign.";

    row.appendChild(label);
    row.appendChild(hint);
    return row;
  }

  function ensureFlowingRow() {
    var existing = document.getElementById(FLOW_TOGGLE_ID);
    if (existing) return existing;
    var v2Input = document.getElementById(TOGGLE_ID);
    if (!v2Input) return null;
    var v2Row = v2Input.closest(".jb-v2-toggle-row");
    if (!v2Row || !v2Row.parentNode) return null;
    var row = buildFlowingRow();
    v2Row.parentNode.insertBefore(row, v2Row.nextSibling);
    return document.getElementById(FLOW_TOGGLE_ID);
  }

  function syncFlowingVisibility() {
    var row = document.getElementById(FLOW_ROW_ID);
    if (!row) return;
    row.style.display = isOn() ? "" : "none";
  }

  function syncFlowingCheckbox(input) {
    if (!input) input = document.getElementById(FLOW_TOGGLE_ID);
    if (!input) return;
    var on = isFlowingDesired();
    input.checked = on;
    input.setAttribute("aria-checked", on ? "true" : "false");
    // Mirror to body class so the rest of the page agrees.
    applyFlowingClass();
    syncFlowingVisibility();
  }

  function onFlowingChange(event) {
    var input = event.target;
    if (!input) return;
    // Flowing only meaningful while v2 is on; if v2 is off, revert.
    if (!isOn()) {
      input.checked = false;
      input.setAttribute("aria-checked", "false");
      writeFlowingStored("0");
      applyFlowingClass();
      return;
    }
    var nextOn = !!input.checked;
    writeFlowingStored(nextOn ? "1" : "0");
    input.setAttribute("aria-checked", nextOn ? "true" : "false");
    applyFlowingClass();
  }

  // ----- v2 toggle plumbing (existing) --------------------------------
  function syncCheckbox(input) {
    if (!input) return;
    var on = isOn();
    input.checked = on;
    input.setAttribute("aria-checked", on ? "true" : "false");
    // Whenever v2 state changes, re-evaluate the flowing sub-toggle.
    syncFlowingCheckbox();
  }

  function applyState(on) {
    var api = getApi();
    if (!api) return false;
    try {
      if (on) {
        api.enable();
      } else {
        api.disable();
      }
      // window.JB_V2.on is captured at boot. Refresh the local mirror so
      // subsequent reads (smoke harness, other modules) see the new state.
      api.on = on;
      // v2 OFF must force flowing OFF (flowing is v2-only).
      if (!on) {
        if (document.body) document.body.classList.remove("flowing");
      } else {
        // v2 ON: re-apply flowing class per stored/default preference.
        applyFlowingClass();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function onChange(event) {
    var input = event.target;
    if (!input) return;
    var nextOn = !!input.checked;
    var ok = applyState(nextOn);
    if (!ok) {
      // Revert the checkbox if the API failed.
      input.checked = !nextOn;
    }
    input.setAttribute("aria-checked", input.checked ? "true" : "false");
    // Sub-toggle visibility / value follows v2 state.
    syncFlowingCheckbox();
  }

  function onStorageEvent(_event) {
    // Other tabs flipping the flag should reflect here. We don't know the
    // exact storage key for v2 (it's redacted), so any storage change re-syncs.
    var input = document.getElementById(TOGGLE_ID);
    if (!input) return;
    // Re-read the API; window.JB_V2.on may be stale across tabs, but
    // body.jb-v2 reflects the live DOM state.
    syncCheckbox(input);
    syncFlowingCheckbox();
  }

  function init() {
    if (bound) return;
    var input = document.getElementById(TOGGLE_ID);
    if (!input) return;
    bound = true;
    syncCheckbox(input);
    input.addEventListener("change", onChange);
    // Build / wire flowing sub-toggle.
    var flowInput = ensureFlowingRow();
    if (flowInput) {
      syncFlowingCheckbox(flowInput);
      flowInput.addEventListener("change", onFlowingChange);
    }
    // Always reconcile body.flowing on init (covers ?flow=1 + page-level
    // boot timing, and ensures legacy tabs without the toggle still
    // apply the class consistently).
    applyFlowingClass();
    window.addEventListener("storage", onStorageEvent);
  }

  function whenReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  // Apply body.flowing as soon as <body> is parsed, even before init()
  // finds the settings markup (settings modal is mounted lazily).
  whenReady(applyFlowingClass);
  whenReady(init);

  window.JobBoredJbV2Tab = {
    init: init,
    syncCheckbox: function () {
      syncCheckbox(document.getElementById(TOGGLE_ID));
    },
    syncFlowingCheckbox: function () {
      syncFlowingCheckbox(document.getElementById(FLOW_TOGGLE_ID));
    },
    isFlowingDesired: isFlowingDesired,
  };
})();
