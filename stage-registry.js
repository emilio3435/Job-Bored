/* ============================================================
   stage-registry.js — the ONE pipeline stage vocabulary
   ------------------------------------------------------------
   Owner:     T0 lane P0-A (canonical pipeline)
   Publishes: window.JobBoredStages

   Before this file existed the repo carried six divergent stage
   lists (pipeline.js, pipeline-render.js x3, pipeline-controller.js,
   dawn-data.js, lattice.js, flowing-writes.js) that disagreed about
   which stages exist and what they are called. Rows in a stage a
   board did not know about were silently dropped, and writes for
   those stages could not resolve a Sheet label at all.

   The list below MIRRORS the status enum of
   schemas/pipeline-row.v1.json (column M). That schema is the
   canonical source and is READ-ONLY for every lane, including this
   one. Browser files cannot read JSON at load time in this no-build
   app, so the mirror is pinned instead:
   tests/stage-registry-canonical.test.mjs fails if this list and the
   schema enum ever drift apart, and fails if any consumer's
   load-order fallback drifts from either.

   Consumers bind to the window global LAZILY (at render time, not at
   script-eval time) so script order cannot decide whether the board
   has a stage list. Each keeps a four-line STAGE_FALLBACK for the
   case where this file is absent entirely.

   Classic-global IIFE. NOT an ES module — no exports.
   ============================================================ */

(function (root) {
  "use strict";

  /* [key, sheet label, jb-stage-dot key] in schema-enum order.
     `key` is the slug used by v2 surfaces and CSS (kanban-card--stage-X,
     --jb-stage-X); `label` is the exact Sheet column-M value; `dotKey` is
     the token name jb-ui.js <jb-stage-dot> understands (phone-screen
     collapses to "phone" because that is the token name in tokens-v2.css). */
  var ROWS = [
    ["new",          "New",          "new"],
    ["researching",  "Researching",  "researching"],
    ["applied",      "Applied",      "applied"],
    ["phone-screen", "Phone Screen", "phone"],
    ["interviewing", "Interviewing", "interviewing"],
    ["offer",        "Offer",        "offer"],
    ["rejected",     "Rejected",     "rejected"],
    ["passed",       "Passed",       "passed"],
    ["expired",      "Expired",      "expired"],
  ];

  /* Terminal outcomes the candidate reached: hidden behind a "show closed"
     affordance rather than collapsed. Expired is NOT closed — an expired
     posting is a fact about the posting, not about the candidate. */
  var CLOSED_KEYS = ["rejected", "passed"];

  /* Stages that are collapsed by default on a board: everything closed,
     plus expired. Matches the legacy pipeline-controller STAGE_ARCHIVE. */
  var ARCHIVE_KEYS = ["rejected", "passed", "expired"];

  /* Spellings seen in Sheet data and legacy CSS class names that are not
     the canonical key. Everything else normalizes by lowercasing and
     collapsing whitespace to a hyphen.

     "dismissed" is deliberately NOT an alias for "expired": dismissed is a
     separate column-W fact about the candidate's intent, expired is a fact
     about the posting. See pipeline-transitions.js and
     tests/closure-model-convergence.test.mjs ("separate facts, not
     synonyms"). */
  var ALIASES = {
    "phone": "phone-screen",
    "phonescreen": "phone-screen",
    "phone-screens": "phone-screen",
    "interview": "interviewing",
    "reject": "rejected",
    "pass": "passed",
    "discovered": "new",
  };

  var KEYS = [];
  var STATUSES = [];
  var LABELS = {};
  var DOT_KEYS = {};
  var ORDER = {};
  var STAGES = [];
  var CLOSED_SET = {};
  var ARCHIVE_SET = {};

  (function build() {
    var i;
    for (i = 0; i < CLOSED_KEYS.length; i++) CLOSED_SET[CLOSED_KEYS[i]] = true;
    for (i = 0; i < ARCHIVE_KEYS.length; i++) ARCHIVE_SET[ARCHIVE_KEYS[i]] = true;
    for (i = 0; i < ROWS.length; i++) {
      var key = ROWS[i][0];
      var label = ROWS[i][1];
      var dotKey = ROWS[i][2];
      KEYS.push(key);
      STATUSES.push(label);
      LABELS[key] = label;
      DOT_KEYS[key] = dotKey;
      ORDER[key] = i;
      STAGES.push(Object.freeze({
        key: key,
        label: label,
        dotKey: dotKey,
        closed: !!CLOSED_SET[key],
        archived: !!ARCHIVE_SET[key],
      }));
    }
  })();

  /** Normalize any Sheet status, CSS stage token, or slug to a canonical key.
   *  Returns null for empty/unknown input — callers decide the default so
   *  "no status yet" is never silently promoted to a real stage here. */
  function toKey(value) {
    if (value == null) return null;
    var s = String(value).trim().toLowerCase();
    if (!s) return null;
    s = s.replace(/[\s_]+/g, "-");
    if (Object.prototype.hasOwnProperty.call(ORDER, s)) return s;
    if (Object.prototype.hasOwnProperty.call(ALIASES, s)) return ALIASES[s];
    return null;
  }

  /** Canonical Sheet column-M label for a key/status, or null if unknown. */
  function toLabel(value) {
    var key = toKey(value);
    return key ? LABELS[key] : null;
  }

  /** <jb-stage-dot stage="…"> token for a key/status, or null if unknown. */
  function toDotKey(value) {
    var key = toKey(value);
    return key ? DOT_KEYS[key] : null;
  }

  /** Board position of a key/status; -1 when unknown. */
  function orderOf(value) {
    var key = toKey(value);
    return key ? ORDER[key] : -1;
  }

  function isClosed(value) {
    var key = toKey(value);
    return !!(key && CLOSED_SET[key]);
  }

  function isArchived(value) {
    var key = toKey(value);
    return !!(key && ARCHIVE_SET[key]);
  }

  /** Fresh [{key,label}] pairs in board order. Callers mutate their copy
   *  (e.g. to apply a board-local display label) without touching ours. */
  function pairs() {
    return STAGES.map(function (s) { return { key: s.key, label: s.label }; });
  }

  /* ----------------------------------------------------------------
     Closure vocabulary.

     Closure used to be two unrelated models with swapped labels:
     dismissJob wrote Pipeline!W + a Blacklist row (the row then vanished
     from every board), markStatusExpired wrote Pipeline!M = "Expired"
     (the row stayed, in the column pipeline.js called "Dismissed"), and
     restoreJob reversed only the first — nothing could un-expire.

     One vocabulary, four actions, every one with an inverse. Surfaces
     express closure as an INTENT and never write cells themselves.
     ---------------------------------------------------------------- */
  var CLOSURE_INVERSE = {
    dismiss: "restore",
    restore: "dismiss",
    expire: "unexpire",
    unexpire: "expire",
  };
  var CLOSURE_ACTIONS = Object.keys(CLOSURE_INVERSE);

  /** Dispatch a `jb:closure:change` intent.
   *
   *  The handler that performs the write is owned by the integrator
   *  (T0-SUBSTRATE.md §3) and is not in the page yet, so the event is
   *  CANCELABLE and this returns whether a handler claimed it:
   *
   *    claimed → the handler owns the write; the caller does nothing more.
   *    unclaimed → the caller runs its existing legacy write, unchanged.
   *
   *  That default binding is what keeps dismiss/expire working before the
   *  shim lands. A handler claims an intent by calling preventDefault().
   *
   *  @returns {boolean} true when a handler took ownership. */
  function requestClosure(jobKey, action, source) {
    if (!Object.prototype.hasOwnProperty.call(CLOSURE_INVERSE, action)) return false;
    if (typeof document === "undefined" || !document.dispatchEvent) return false;
    var ev;
    try {
      ev = new CustomEvent("jb:closure:change", {
        detail: { jobKey: jobKey, action: action, source: source || "" },
        bubbles: true,
        cancelable: true,
      });
    } catch (_) {
      return false;
    }
    return document.dispatchEvent(ev) === false;
  }

  root.JobBoredStages = {
    SCHEMA: "schemas/pipeline-row.v1.json#status",
    KEYS: KEYS.slice(),
    STATUSES: STATUSES.slice(),
    STAGES: STAGES.slice(),
    LABELS: LABELS,
    DOT_KEYS: DOT_KEYS,
    CLOSED_KEYS: CLOSED_KEYS.slice(),
    ARCHIVE_KEYS: ARCHIVE_KEYS.slice(),
    CLOSURE_ACTIONS: CLOSURE_ACTIONS.slice(),
    CLOSURE_INVERSE: CLOSURE_INVERSE,
    requestClosure: requestClosure,
    pairs: pairs,
    toKey: toKey,
    toLabel: toLabel,
    toDotKey: toDotKey,
    orderOf: orderOf,
    isClosed: isClosed,
    isArchived: isArchived,
  };
})(typeof window !== "undefined" ? window : globalThis);
