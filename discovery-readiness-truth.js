/* global module */
/* Pure discovery readiness truth classifier (browser + Node tests). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JobBoredDiscoveryReadinessTruth = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function engineStateValue(engineState, snapshot) {
    if (engineState && typeof engineState === "object") {
      return clean(engineState.state);
    }
    return clean(engineState) || clean(snapshot && snapshot.engineState);
  }

  function checkedAtValue(engineState, lastCheckedAt) {
    if (clean(lastCheckedAt)) return clean(lastCheckedAt);
    if (engineState && typeof engineState === "object") {
      return clean(engineState.lastCheckedAt);
    }
    return "";
  }

  function isStale(lastCheckedAt, nowMs) {
    var checkedMs = Date.parse(clean(lastCheckedAt));
    if (!Number.isFinite(checkedMs)) return true;
    var currentMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    return currentMs - checkedMs > DEFAULT_STALE_AFTER_MS;
  }

  // UX01 C8 (FD-14): each reason reads as what to do next. Four causes
  // used to share "Discovery blocked"; "Ready to test" and "Stub only"
  // meant nothing to a stranger.
  function result(level, reason, label) {
    return { level: level, reason: reason, label: label };
  }

  function classifyDiscoveryReadiness(snapshot, engineState, lastCheckedAt) {
    var state = snapshot && typeof snapshot === "object" ? snapshot : {};
    var savedWebhookUrl = clean(state.savedWebhookUrl);
    var previousWebhookUrl = clean(state.previousSavedWebhookUrl);
    var engineWebhookUrl =
      engineState && typeof engineState === "object"
        ? clean(engineState.webhookUrl)
        : "";
    var engine = engineStateValue(engineState, state);

    if (!savedWebhookUrl && (previousWebhookUrl || engineWebhookUrl)) {
      return result("blocked", "webhook_cleared", "Search disconnected — reconnect");
    }
    if (state.sheetConfigured === false || state.blockingIssue === "missing_sheet") {
      return result("blocked", "missing_sheet", "Reconnect your Sheet");
    }
    if (
      savedWebhookUrl &&
      state.localRecoveryState &&
      state.localRecoveryState !== "ok"
    ) {
      return result("blocked", "recovery_required", "Search stopped — fix setup");
    }
    if (!savedWebhookUrl) {
      var hasPartialPath = !!(
        state.localWebhookUrl ||
        state.tunnelPublicUrl ||
        state.relayTargetUrl ||
        state.appsScriptState === "stub_only"
      );
      return hasPartialPath
        ? result("partial", "setup_incomplete", "Finish setup")
        : result("blocked", "not_configured", "Not set up yet");
    }
    if (engine === "connected") {
      return isStale(checkedAtValue(engineState, lastCheckedAt))
        ? result("stale", "verification_stale", "Re-check your search")
        : result("verified", "endpoint_verified", "Discovery ready");
    }
    if (engine === "stub_only") {
      return result("partial", "stub_only", "Test mode — no real jobs");
    }
    if (engine === "unverified" || engine === "none" || !engine) {
      return result("ready_to_test", "endpoint_unverified", "Connected — run a check");
    }
    return result("blocked", "engine_state_unknown", "Search status unknown");
  }

  return {
    DEFAULT_STALE_AFTER_MS: DEFAULT_STALE_AFTER_MS,
    classifyDiscoveryReadiness: classifyDiscoveryReadiness,
    isStale: isStale,
  };
});
