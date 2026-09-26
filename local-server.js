/* ============================================
   Local server substrate — "is JobBored running on this computer, and
   what exactly is wrong if it isn't" (GFX BE-FUEL).

   One module owns the answer so B5's key check, the B1 route-to-local
   screen, B2, B3 and the desktop app never disagree about it:

     · OUTCOMES — the frozen fuel outcome table (PLAN §R2). Each reason
       carries the key the UI shows it under and whether it blocks.
       `unreachable` (the server is up, SerpApi's network is down) is never
       merged into `no_local_server`. There is no `quota` reason: a low
       `searchesLeft` on `ok` is a note, never a block.
     · pingLocalServer — the keyless GET /__proxy/ping against the §R3
       contract. A ping without `version`, or without a route this build
       needs, is a `stale_server`.
     · classifyAnswer — one serpapi-check answer → one outcome. Fails
       closed: nothing unrecognised ever reads as `ok`.
     · localServerHint · isLoopbackPage · jobBoredOpenUrl.

   Loaded by index.html BEFORE the beats. Classic-global IIFE; reads
   `fetch` and `location` at call time so harnesses can swap them.
   ============================================ */
(function () {
  /**
   * PLAN §R2, frozen. `display` is the key copy tables use; only
   * `forbidden` differs (the user needs to hear "wrong address", not a
   * server's word for it). `blocks` is false for `ok` alone.
   */
  const OUTCOMES = Object.freeze({
    ok: Object.freeze({ display: "ok", blocks: false }),
    invalid_key: Object.freeze({ display: "invalid_key", blocks: true }),
    unreachable: Object.freeze({ display: "unreachable", blocks: true }),
    upstream_error: Object.freeze({ display: "upstream_error", blocks: true }),
    forbidden: Object.freeze({ display: "wrong_origin", blocks: true }),
    internal_error: Object.freeze({ display: "internal_error", blocks: true }),
    no_local_server: Object.freeze({ display: "no_local_server", blocks: true }),
    stale_server: Object.freeze({ display: "stale_server", blocks: true }),
    static_host: Object.freeze({ display: "static_host", blocks: true }),
  });

  /** The /__proxy routes this client needs a server to advertise. */
  const REQUIRED_ROUTES = Object.freeze(["serpapi-check"]);

  /** Onboarding beat ids a `jobbored://open` link may name (R4, D8). */
  const OPEN_BEATS = Object.freeze([
    "google",
    "ai",
    "resume",
    "fit",
    "discovery",
    "payoff",
  ]);

  const PING_TIMEOUT_MS = 3000;

  /**
   * Reasons the dev server's serpapi-check speaks, mapped onto the table.
   * `empty_key` is the server refusing a blank key — a key problem.
   * Anything else is a server this client does not recognise.
   */
  const SERVER_REASONS = Object.freeze({
    invalid_key: "invalid_key",
    empty_key: "invalid_key",
    unreachable: "unreachable",
    upstream_error: "upstream_error",
    forbidden: "forbidden",
    internal_error: "internal_error",
  });

  function outcome(reason, extra) {
    const row = OUTCOMES[reason] || OUTCOMES.stale_server;
    const key = OUTCOMES[reason] ? reason : "stale_server";
    return Object.assign(
      { outcome: key, display: row.display, blocks: row.blocks },
      extra || {},
    );
  }

  function isLoopbackHostname(hostname) {
    const host = String(hostname || "").toLowerCase();
    return (
      host === "localhost" ||
      host === "[::1]" ||
      host === "::1" ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  }

  /**
   * True when the page is served from loopback (localhost, 127.0.0.0/8,
   * [::1]). Defaults to window.location. No location, or an unreadable
   * one, is not loopback.
   */
  function isLoopbackPage(location) {
    try {
      const loc =
        location !== undefined ? location : window.location;
      return isLoopbackHostname(loc && loc.hostname);
    } catch (_) {
      return false;
    }
  }

  function currentPageHostname() {
    try {
      const loc = window.location;
      return String((loc && loc.hostname) || "");
    } catch (_) {
      return "";
    }
  }

  /**
   * The hostname whose server answered: the base URL's when there is one
   * (a hosted page probing http://localhost:8080), else the page's own.
   */
  function answeringHostname(base, pageHostname) {
    if (base) {
      try {
        return new URL(String(base)).hostname;
      } catch (_) {
        return "";
      }
    }
    return pageHostname !== undefined
      ? String(pageHostname || "")
      : currentPageHostname();
  }

  function contentTypeOf(response) {
    try {
      const headers = response && response.headers;
      return headers && typeof headers.get === "function"
        ? String(headers.get("content-type") || "")
        : "";
    } catch (_) {
      return "";
    }
  }

  async function readJson(response) {
    if (!response || typeof response.json !== "function") return null;
    try {
      const body = await response.json();
      return body && typeof body === "object" && !Array.isArray(body)
        ? body
        : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * A non-JobBored answer: on loopback it is a stale or foreign server on
   * this computer; off loopback, a 404/405/501 or an HTML page is the
   * static host's signature. Anything else off loopback is unproven, so
   * it reads as nothing answering.
   */
  function foreignAnswer(response, loopback) {
    if (loopback) return "stale_server";
    const status = response && Number(response.status);
    if (status === 404 || status === 405 || status === 501) return "static_host";
    if (/text\/html/i.test(contentTypeOf(response))) return "static_host";
    return "no_local_server";
  }

  /**
   * Classify one POST /__proxy/serpapi-check answer.
   *
   * @param {Response|null} response the fetch result (a throw is the
   *   caller's `no_local_server`).
   * @param {{pageHostname?: string, base?: string}} [options]
   * @returns {Promise<{outcome, display, blocks, body}>} `body` is the
   *   server's JSON on `ok` (plan, searchesLeft), otherwise null.
   */
  async function classifyAnswer(response, options) {
    const opts = options || {};
    const loopback = isLoopbackHostname(
      answeringHostname(opts.base, opts.pageHostname),
    );
    if (!response) return outcome("no_local_server", { body: null });
    const status = Number(response.status);
    if (status === 404 || status === 405) {
      return outcome(foreignAnswer(response, loopback), { body: null });
    }
    const body = await readJson(response);
    if (!body || typeof body.ok !== "boolean") {
      return outcome(foreignAnswer(response, loopback), { body: null });
    }
    if (body.ok === true) {
      const left = Number(body.searchesLeft);
      const clean = { ok: true };
      if (typeof body.plan === "string" && body.plan.trim()) clean.plan = body.plan;
      if (body.searchesLeft != null && Number.isFinite(left)) {
        clean.searchesLeft = left;
      }
      return outcome("ok", { body: clean });
    }
    const reason = SERVER_REASONS[String(body.reason || "")];
    if (reason) return outcome(reason, { body: null });
    // A JobBored-shaped failure with a reason this build never taught the
    // client: the server and the page disagree about the contract.
    if (status === 500) return outcome("internal_error", { body: null });
    return outcome("stale_server", { body: null });
  }

  function hasRequiredRoutes(routes) {
    if (!Array.isArray(routes)) return false;
    return REQUIRED_ROUTES.every((route) => routes.includes(route));
  }

  /**
   * Keyless GET /__proxy/ping (PLAN §R3). Never sends a body or a key.
   *
   * @param {{base?: string, signal?: AbortSignal, pageHostname?: string,
   *   fetchImpl?: Function, timeoutMs?: number}} [options] `base` is ""
   *   for same-origin, or an absolute origin such as
   *   "http://localhost:8080".
   * @returns {Promise<{outcome: string, up: boolean, current: boolean,
   *   status: number, version: string, runtime: string, routes: string[],
   *   desktopVersion: string, aborted: boolean}>}
   *   `outcome` is `ok` (a current build), `forbidden` (a JobBored server
   *   whose origin gate refused the ping — up, but unverified; the keyed
   *   check decides, GFX-N3), `stale_server`, `static_host` or
   *   `no_local_server`. `up` is true for `ok` and `forbidden` only.
   */
  async function pingLocalServer(options) {
    const opts = options || {};
    const base = String(opts.base || "").replace(/\/+$/, "");
    const loopback = isLoopbackHostname(
      answeringHostname(base, opts.pageHostname),
    );
    const result = {
      outcome: "no_local_server",
      up: false,
      current: false,
      status: 0,
      version: "",
      runtime: "",
      routes: [],
      desktopVersion: "",
      aborted: false,
    };
    const doFetch =
      typeof opts.fetchImpl === "function"
        ? opts.fetchImpl
        : typeof fetch === "function"
          ? fetch
          : null;
    if (!doFetch) return result;

    let ctrl = null;
    let timer = null;
    let unlink = null;
    if (typeof AbortController !== "undefined") {
      ctrl = new AbortController();
      const timeoutMs =
        Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
          ? opts.timeoutMs
          : PING_TIMEOUT_MS;
      timer = setTimeout(() => {
        try {
          ctrl.abort();
        } catch (_) {
          /* the fetch below reads the abort as no answer */
        }
      }, timeoutMs);
      const outer = opts.signal;
      if (outer && typeof outer.addEventListener === "function") {
        if (outer.aborted) ctrl.abort();
        const onAbort = () => ctrl.abort();
        outer.addEventListener("abort", onAbort);
        unlink = () => outer.removeEventListener("abort", onAbort);
      }
    }
    let response = null;
    try {
      response = await doFetch(
        `${base}/__proxy/ping`,
        ctrl ? { method: "GET", signal: ctrl.signal } : { method: "GET" },
      );
    } catch (e) {
      result.aborted = !!(e && e.name === "AbortError");
      return result;
    } finally {
      if (timer != null) clearTimeout(timer);
      if (unlink) unlink();
    }
    if (!response) return result;
    result.status = Number(response.status) || 0;
    const body = await readJson(response);
    if (!body || typeof body.ok !== "boolean") {
      result.outcome = foreignAnswer(response, loopback);
      return result;
    }
    if (body.ok !== true) {
      // GFX-N3: Safari <16.4 and some webviews send no Sec-Fetch-Site, so a
      // running server can refuse the keyless ping with a JSON 403. It is
      // up; the keyed check (which carries Origin) decides.
      if (body.reason === "forbidden") {
        result.outcome = "forbidden";
        result.up = true;
        return result;
      }
      result.outcome = "stale_server";
      return result;
    }
    result.version = typeof body.version === "string" ? body.version : "";
    result.runtime = typeof body.runtime === "string" ? body.runtime : "";
    result.routes = Array.isArray(body.routes)
      ? body.routes.filter((route) => typeof route === "string")
      : [];
    result.desktopVersion =
      typeof body.desktopVersion === "string" ? body.desktopVersion : "";
    if (!result.version || !hasRequiredRoutes(result.routes)) {
      // N-stale: a server that predates the §R3 contract, or one that
      // doesn't serve the check this client is about to make.
      result.outcome = "stale_server";
      return result;
    }
    result.outcome = "ok";
    result.up = true;
    result.current = true;
    return result;
  }

  /**
   * The whole fuel check: ping first (keyless), then POST the key to
   * /__proxy/serpapi-check and classify the answer. The key leaves the
   * browser only after a JobBored server answered the ping, only in a
   * POST body, and only to `base` (same-origin when ""). It is never put
   * in a URL or a log line.
   *
   * @returns {Promise<{outcome, display, blocks, body, ping}>}
   */
  async function checkSerpApiKey(key, options) {
    const opts = options || {};
    const base = String(opts.base || "").replace(/\/+$/, "");
    const ping = await pingLocalServer(opts);
    if (!ping.up) return outcome(ping.outcome, { body: null, ping });
    const doFetch =
      typeof opts.fetchImpl === "function"
        ? opts.fetchImpl
        : typeof fetch === "function"
          ? fetch
          : null;
    if (!doFetch) return outcome("no_local_server", { body: null, ping });
    let response;
    try {
      response = await doFetch(`${base}/__proxy/serpapi-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: String(key == null ? "" : key) }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (_) {
      return outcome("no_local_server", { body: null, ping });
    }
    const answer = await classifyAnswer(response, opts);
    answer.ping = ping;
    return answer;
  }

  function readPlatform() {
    try {
      const nav =
        window.navigator ||
        (typeof navigator !== "undefined" ? navigator : null);
      if (!nav) return "";
      return String(
        (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "",
      );
    } catch (_) {
      return "";
    }
  }

  /**
   * How to start JobBored on this machine, as a clause that fits
   * "To start it, …" (GFX-X1: the one sentence B2, B3 and B5 share).
   * macOS gets the double-clickable start.command; every other platform
   * runs the same start.sh. `platform` defaults to the navigator's.
   */
  function localServerHint(platform) {
    const name = platform === undefined ? readPlatform() : String(platform || "");
    return /mac/i.test(name)
      ? "double-click start.command in the JobBored folder"
      : "run ./start.sh in the JobBored folder";
  }

  /**
   * The desktop app's open link. No argument is the greenfield default
   * (`jobbored://open`, R4); an allowlisted beat id re-enters that beat;
   * anything else — an unknown id, extra params, an injection — is null.
   * `returnTo` is never allowed in the protocol.
   */
  function jobBoredOpenUrl(beat) {
    if (beat === undefined) return "jobbored://open";
    if (typeof beat !== "string") return null;
    if (!OPEN_BEATS.includes(beat)) return null;
    return `jobbored://open?beat=${beat}`;
  }

  window.JobBoredLocalServer = Object.freeze({
    OUTCOMES,
    REQUIRED_ROUTES,
    OPEN_BEATS,
    pingLocalServer,
    classifyAnswer,
    checkSerpApiKey,
    localServerHint,
    isLoopbackPage,
    isLoopbackHostname,
    jobBoredOpenUrl,
  });
})();
