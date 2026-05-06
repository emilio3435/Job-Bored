/* ============================================
   Discovery auto-detect & silent recovery
   --------------------------------------------
   Probes the local discovery stack (worker, ngrok, relay) BEFORE the
   user sees the setup wizard. Three outcomes:

     ready             — close the wizard, show a toast, done
     auto_recoverable  — run /__proxy/full-boot silently, re-probe, then
                         either ready or needs_human
     needs_human       — fall through to the wizard so the user can fill
                         in the gap (Cloudflare auth, OAuth, etc.)

   Owns NO UI. Surfaces to a single insertion point in
   openDiscoverySetupWizard() in app.js.

   Locked endpoint contract — see dev-server.mjs handleDiscoveryState
   header. Do not widen.

   Lane: feat/discovery-autodetect-silent-recover
   ============================================ */

(() => {
  if (typeof window === "undefined") return;

  // Already initialized? (Module is included via plain <script>; guard
  // against double-include in tests / hot-reload.)
  if (window.JobBoredDiscoveryAutodetect) return;

  /** @typedef {{ ready: boolean, recommendation: string, hint?: string, state?: object }} Verdict */

  const STATE_ENDPOINT = "/__proxy/discovery-state";
  const FULL_BOOT_ENDPOINT = "/__proxy/full-boot";
  const PROBE_TIMEOUT_MS = 4000;
  const RECOVERY_TIMEOUT_MS = 90_000;

  // In-process cache so multiple wizard-open calls within a few seconds
  // don't re-fetch state pointlessly.
  const CACHE_TTL_MS = 5000;
  let cached = null; // { state, fetchedAt }

  function isLocalDashboard() {
    try {
      const h = window.location && window.location.hostname;
      return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
    } catch (_) {
      return false;
    }
  }

  /**
   * fetch with a hard timeout so a hung dev-server doesn't hang the wizard
   * open path forever. Returns null on any error (network, timeout, parse).
   */
  async function fetchJson(url, init = {}, timeoutMs = PROBE_TIMEOUT_MS) {
    const ctrl =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl
      ? setTimeout(() => {
          try {
            ctrl.abort();
          } catch (_) {}
        }, timeoutMs)
      : null;
    try {
      const resp = await fetch(url, {
        ...init,
        signal: ctrl ? ctrl.signal : undefined,
      });
      let body = null;
      try {
        body = await resp.json();
      } catch (_) {
        // 501 / non-JSON / empty body — treat as null
      }
      return { ok: resp.ok, status: resp.status, body };
    } catch (_) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Probe the dev-server's aggregated discovery state. Returns null if the
   * dev-server isn't reachable (hosted dashboards, dev-server down, etc.) —
   * callers must treat null as "I don't know, fall through to wizard".
   */
  async function probeState() {
    if (!isLocalDashboard()) return null;
    const result = await fetchJson(STATE_ENDPOINT, { method: "GET" });
    if (!result) return null;
    // 501 = endpoint not yet wired (older dev-server). Treat as unknown.
    if (result.status === 501) return null;
    if (!result.ok || !result.body) return null;
    const fresh = result.body;
    cached = { state: fresh, fetchedAt: Date.now() };
    return fresh;
  }

  function getCachedState() {
    if (!cached) return null;
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
    return cached.state;
  }

  function clearCache() {
    cached = null;
  }

  /**
   * Run /__proxy/full-boot. Returns { ok, body } or null on transport error.
   * The endpoint already orchestrates kill-stale -> start worker -> fix-setup,
   * so we don't need to step through phases here.
   */
  async function runFullBoot() {
    const result = await fetchJson(
      FULL_BOOT_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      RECOVERY_TIMEOUT_MS,
    );
    return result;
  }

  /**
   * Decide what to do based on a probed state body.
   * Pure function — no side effects.
   */
  function classify(state) {
    if (!state || typeof state !== "object") {
      return { ready: false, recommendation: "needs_human", hint: "no_state" };
    }
    const rec = state.recommendation;
    if (rec === "ready") {
      return { ready: true, recommendation: "ready", state };
    }
    if (rec === "auto_recoverable") {
      return {
        ready: false,
        recommendation: "auto_recoverable",
        hint: state.recoverableHint || "",
        state,
      };
    }
    return {
      ready: false,
      recommendation: "needs_human",
      hint: state.recoverableHint || "",
      state,
    };
  }

  /**
   * Top-level entry point. Probes; if `auto_recoverable`, runs full-boot
   * once and re-probes; returns final Verdict.
   *
   * Returns:
   *   { ready: true,  recommendation: "ready", state }                — user has nothing to do
   *   { ready: false, recommendation: "needs_human", hint, state? }   — show wizard
   *   { ready: false, recommendation: "unknown" }                     — show wizard (don't claim ready)
   *
   * @param {{ allowRecover?: boolean }} [opts]
   * @returns {Promise<Verdict>}
   */
  async function recoverIfPossible(opts = {}) {
    const allowRecover = opts.allowRecover !== false; // default true

    // First probe — use cache if we recently checked.
    let state = getCachedState();
    if (!state) {
      state = await probeState();
    }
    if (state == null) {
      return { ready: false, recommendation: "unknown" };
    }

    let verdict = classify(state);
    if (verdict.ready) return verdict;

    if (verdict.recommendation === "auto_recoverable" && allowRecover) {
      const bootResult = await runFullBoot();
      // Successful or not, re-probe so we report the truth.
      clearCache();
      const after = await probeState();
      if (after == null) {
        return { ready: false, recommendation: "needs_human", hint: "post_recovery_probe_failed" };
      }
      verdict = classify(after);
      // Even if classify returns auto_recoverable again (rare — full-boot
      // ran and yet recovery still says recoverable), don't loop. Promote
      // to needs_human so the wizard takes over.
      if (verdict.recommendation === "auto_recoverable") {
        return {
          ready: false,
          recommendation: "needs_human",
          hint:
            (bootResult && bootResult.body && bootResult.body.message) ||
            "recovery_attempted_still_unhealthy",
          state: after,
        };
      }
    }
    return verdict;
  }

  // Pure helpers exposed for testing.
  window.JobBoredDiscoveryAutodetect = {
    probeState,
    recoverIfPossible,
    getCachedState,
    clearCache,
    classify,
    // private but useful in tests
    _isLocalDashboard: isLocalDashboard,
  };
})();
