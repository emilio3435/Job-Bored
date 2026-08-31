/**
 * profile-api-base.js — canonical JobBored API origin resolver.
 *
 * The static dashboard (often :8080) and the Express API (often :3847) are
 * different origins in local split-port setups. Relative `/profile` fetches
 * hit the dashboard and 404. Every Fit Profile / discovery-drawer caller
 * must resolve through getProfileApiBase / profileUrl.
 *
 * Classic-global IIFE (not an ES module) so it can load before
 * fit-profile-wizard.js without a bundler. Attaches window.JobBoredProfileApi.
 *
 * Integration: load this script before fit-profile-wizard.js in index.html.
 */
(function (root) {
  "use strict";

  function getProfileApiBase() {
    var cfg =
      (root && root.COMMAND_CENTER_CONFIG) ||
      (typeof window !== "undefined" && window.COMMAND_CENTER_CONFIG) ||
      {};
    var raw =
      cfg.jobBoredApiUrl ||
      cfg.jobPostingScrapeUrl /* same scraper server hosts both */ ||
      "";
    if (raw && typeof raw === "string" && raw.trim()) {
      return String(raw).trim().replace(/\/+$/, "");
    }
    var loc =
      (root && root.location) ||
      (typeof window !== "undefined" && window.location) ||
      null;
    if (!loc) return "";
    if (loc.protocol === "file:") {
      return "http://127.0.0.1:3847";
    }
    return "";
  }

  function profileUrl(path) {
    var base = getProfileApiBase();
    return (base || "") + String(path || "");
  }

  var api = {
    getProfileApiBase: getProfileApiBase,
    profileUrl: profileUrl,
  };

  if (root) root.JobBoredProfileApi = api;
  if (typeof window !== "undefined") window.JobBoredProfileApi = api;
})(typeof window !== "undefined" ? window : globalThis);
