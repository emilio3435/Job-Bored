/* ============================================
   COMMAND CENTER v2 — Scraper / ATS Config
   Extracted from app.js (scraper-ats-config cut).

   Classic-global IIFE under window.JobBoredApp.scraperAts — NOT an ES module.
   Loaded BEFORE app.js. Scraper/ATS endpoint getters, scraper setup modal,
   clipboard helper, connection test, and fetch network-error classifier.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const scraperAts = root.scraperAts || (root.scraperAts = {});

  function showToast(...args) {
    const auth = window.JobBoredApp.auth;
    if (auth && typeof auth.showToast === "function") {
      return auth.showToast(...args);
    }
  }

  /**
   * Scraper API base URL (no trailing slash).
   * Explicit config wins. If unset and the dashboard is opened on localhost, defaults
   * to the local server so `npm start` works without editing config. On GitHub Pages
   * (HTTPS), leave config empty unless you deploy a scraper — see DEPLOY-SCRAPER.md.
   */
  function getJobPostingScrapeUrl() {
    const cfg = window.COMMAND_CENTER_CONFIG;
    const raw = cfg && cfg.jobPostingScrapeUrl;
    if (raw != null && String(raw).trim() !== "") {
      return String(raw).trim().replace(/\/+$/, "");
    }
    if (typeof window === "undefined") return "";
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
      return "http://127.0.0.1:3847";
    }
    return "";
  }

  function getAtsScoringConfig() {
    const cfg = window.COMMAND_CENTER_CONFIG || {};
    const rawMode = String(cfg.atsScoringMode || "server").toLowerCase();
    const mode = rawMode === "webhook" ? "webhook" : "server";
    const serverUrl = String(cfg.atsScoringServerUrl || "").trim();
    const webhookUrl = String(cfg.atsScoringWebhookUrl || "").trim();
    return {
      mode,
      serverUrl,
      webhookUrl,
    };
  }

  function getAtsScorecardApiUrl() {
    const cfg = getAtsScoringConfig();
    if (cfg.mode === "webhook") return cfg.webhookUrl;
    if (cfg.serverUrl) {
      const trimmed = cfg.serverUrl.replace(/\/+$/, "");
      return /\/api\/ats-scorecard$/i.test(trimmed)
        ? trimmed
        : `${trimmed}/api/ats-scorecard`;
    }
    if (typeof window === "undefined") return "";
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
      return "http://127.0.0.1:3847/api/ats-scorecard";
    }
    return "/api/ats-scorecard";
  }

  /**
   * HTTPS pages (e.g. GitHub Pages) cannot fetch http://127.0.0.1 — mixed content.
   */
  function isScraperUrlBlockedOnThisPage(baseUrl) {
    if (!baseUrl) return false;
    if (typeof window === "undefined") return false;
    if (window.location.protocol !== "https:") return false;
    try {
      const u = new URL(baseUrl, window.location.href);
      if (u.protocol !== "http:") return false;
      const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
      return false;
    }
  }

  const SCRAPER_HTTPS_BLOCKED_HINT =
    "HTTPS pages (e.g. GitHub Pages) cannot call http://127.0.0.1 — the browser blocks it. Deploy the scraper to a public HTTPS URL and paste it in Settings, or run the app locally with npm start. See DEPLOY-SCRAPER.md.";

  function openScraperSetupModal() {
    const modal = document.getElementById("scraperSetupModal");
    const result = document.getElementById("scraperTestResult");
    if (result) {
      result.textContent = "";
      result.className = "scraper-test-result";
    }
    if (modal) {
      modal.style.display = "flex";
      document.getElementById("scraperSetupDoneBtn")?.focus();
    }
  }

  function closeScraperSetupModal() {
    const modal = document.getElementById("scraperSetupModal");
    if (modal) modal.style.display = "none";
  }

  function copyTextToClipboard(text) {
    const t = String(text || "");
    if (!t) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(
        () => showToast("Copied to clipboard", "success"),
        () => showToast("Could not copy — select and copy manually", "info"),
      );
    } else {
      showToast("Clipboard not available", "info");
    }
  }

  async function runScraperConnectionTest() {
    const el = document.getElementById("settingsJobPostingScrapeUrl");
    const raw = (el && el.value.trim()) || "";
    const base = (raw || getJobPostingScrapeUrl() || "").replace(/\/+$/, "");
    const out = document.getElementById("scraperTestResult");
    if (out) {
      out.textContent = "Checking…";
      out.className = "scraper-test-result";
    }
    if (!base) {
      if (out) {
        out.textContent =
          "No URL — paste a deployed HTTPS scraper, or open this app on localhost (npm start).";
        out.className = "scraper-test-result scraper-test-result--bad";
      }
      showToast(
        "Set a scraper URL in Settings or use the setup guide for local npm start.",
        "error",
      );
      return;
    }
    if (isScraperUrlBlockedOnThisPage(base)) {
      if (out) {
        out.textContent =
          "Blocked: this HTTPS page cannot reach a local HTTP scraper. See DEPLOY-SCRAPER.md.";
        out.className = "scraper-test-result scraper-test-result--bad";
      }
      showToast(SCRAPER_HTTPS_BLOCKED_HINT, "error", true);
      return;
    }
    const url = `${base}/health`;
    try {
      const r = await fetch(url, { method: "GET", mode: "cors" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (j.ok) {
        if (out) {
          out.textContent = "Server reachable";
          out.className = "scraper-test-result scraper-test-result--ok";
        }
        showToast("Scraper server is running", "success");
      } else {
        throw new Error("Unexpected response");
      }
    } catch (e) {
      let msg =
        e && e.message
          ? String(e.message)
          : "Could not reach server — is npm start running?";
      if (isFetchNetworkError(e)) {
        msg =
          "Can't connect — start the server: cd server && npm start (leave the terminal open).";
      }
      if (out) {
        out.textContent = msg;
        out.className = "scraper-test-result scraper-test-result--bad";
      }
    }
  }

  /** True for offline / connection refused / CORS-style fetch failures
   *  AND for AbortController-driven timeouts (so callers that wrap a
   *  request in a timeout still classify the timeout as a network
   *  problem rather than a hard error). */
  function isFetchNetworkError(err) {
    if (!err) return false;
    const msg = String(err.message || err || "");
    const name = err.name || "";
    return (
      name === "TypeError" ||
      name === "AbortError" ||
      msg === "Failed to fetch" ||
      msg.includes("NetworkError") ||
      msg.includes("Network request failed") ||
      msg.includes("Load failed") ||
      msg.includes("CONNECTION_REFUSED") ||
      msg.includes("aborted")
    );
  }

  function initScraperSetupGuide() {
    document
      .getElementById("openScraperSetupFromSettings")
      ?.addEventListener("click", () => openScraperSetupModal());
    document
      .getElementById("scraperSetupModalClose")
      ?.addEventListener("click", closeScraperSetupModal);
    document
      .getElementById("scraperSetupDoneBtn")
      ?.addEventListener("click", closeScraperSetupModal);
    document
      .getElementById("scraperTestConnectionBtn")
      ?.addEventListener("click", () => runScraperConnectionTest());

    document
      .querySelectorAll(".btn-copy-scraper[data-copy-text]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const text = btn.getAttribute("data-copy-text");
          if (text) copyTextToClipboard(text);
        });
      });

    const overlay = document.getElementById("scraperSetupModal");
    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeScraperSetupModal();
      });
    }
  }

  Object.assign(scraperAts, {
    SCRAPER_HTTPS_BLOCKED_HINT,
    getJobPostingScrapeUrl,
    getAtsScoringConfig,
    getAtsScorecardApiUrl,
    isScraperUrlBlockedOnThisPage,
    openScraperSetupModal,
    closeScraperSetupModal,
    copyTextToClipboard,
    runScraperConnectionTest,
    isFetchNetworkError,
    initScraperSetupGuide,
  });
})();
