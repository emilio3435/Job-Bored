/**
 * HOLES S4: a per-process rate limit and concurrency cap for the routes that
 * spend LLM tokens or launch Chromium. Over either limit the route answers
 * 429 with retryable:true and Retry-After, before any work starts. The
 * limits are per process, not per client: the API serves one user (hosted
 * mode shares one token), so they bound cost and memory, not fairness.
 * The live rescore stream has its own single-flight lock and is not limited.
 */

/** @type {Array<[string, RegExp]>} */
const LIMITED_ROUTES = [
  ["POST", /^\/api\/scrape-job$/],
  ["POST", /^\/api\/ats-scorecard$/],
  ["POST", /^\/api\/leads\/chat$/],
  ["POST", /^\/profile\/from-resume$/],
  ["POST", /^\/api\/llm-config\/judge-test$/],
  ["POST", /^\/api\/llm-config\/judge-models$/],
  [
    "POST",
    /^\/api\/applications\/[^/]+\/(?:request|repair|regenerate|scrape-job-description|edits|edits\/manual|edits\/[^/]+\/accept|versions\/[^/]+\/restore)$/,
  ],
];

const WINDOW_MS = 60_000;

/**
 * @param {string} method
 * @param {string} path
 */
export function isLimitedRoute(method, path) {
  return LIMITED_ROUTES.some(([routeMethod, pattern]) => routeMethod === method && pattern.test(path));
}

/**
 * @param {{ perMinute: number, concurrency: number, now?: () => number }} limits
 * @returns {import("express").RequestHandler}
 */
export function createRouteLimiter({ perMinute, concurrency, now = Date.now }) {
  /** @type {number[]} admission times inside the current window, oldest first */
  const admitted = [];
  let inFlight = 0;
  return (req, res, next) => {
    if (!isLimitedRoute(String(req.method || ""), req.path)) return next();
    const t = now();
    while (admitted.length > 0 && t - admitted[0] >= WINDOW_MS) admitted.shift();
    if (admitted.length >= perMinute) {
      const retryAfter = Math.max(1, Math.ceil(((admitted[0] ?? t) + WINDOW_MS - t) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Too many AI and rendering requests this minute.",
        code: "rate_limited",
        nextStep: `Try again in ${retryAfter} s.`,
        retryable: true,
      });
      return;
    }
    if (inFlight >= concurrency) {
      res.setHeader("Retry-After", "5");
      res.status(429).json({
        error: "Too many AI and rendering requests are already running.",
        code: "too_many_in_flight",
        nextStep: "Try again in a few seconds.",
        retryable: true,
      });
      return;
    }
    admitted.push(t);
    inFlight += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight -= 1;
    };
    // A disconnected client does not finish the work the handler started.
    res.once("finish", release);
    // If it disconnected, finish will not fire when the handler finally answers.
    const end = res.end;
    if (typeof end === "function") {
      res.end = function (/** @type {any[]} */ ...args) {
        try {
          return Reflect.apply(end, this, args);
        } finally {
          if (this.destroyed) release();
        }
      };
    }
    next();
  };
}

/**
 * A positive integer from the environment, else the default.
 * @param {string | undefined} raw
 * @param {number} fallback
 */
export function limitFromEnv(raw, fallback) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
