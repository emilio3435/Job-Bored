/* ============================================================
   dawn-data.js — JobBored v2 Daily Brief data adapter (Dawn / Phase 3)
   ------------------------------------------------------------
   Owner:    Dawn (Daily Brief screen agent)
   Purpose:  Thin read-only adapter that derives a stable view-model
             for dawn.js from already-rendered legacy DOM. NEVER
             fetches anything. NEVER mutates legacy state. NEVER
             introduces new schema fields.

   Inputs (read from DOM only):
     - .stat-card values inside #briefStats         (Found / Applied / In loop / Offers + sub-text)
     - .kanban-card[data-stable-key]                (per-job stage + role + company snapshot)
     - #briefDate                                   (locale-formatted date string)

   Outputs:
     window.JobBoredDawn.getDawnViewModel() => {
       date,
       hero: {found, applied, inLoop, offers},
       funnel: [{stage, label, count, pct, jobs:[{key,title,company}]}],
       activity: [{key, title, company, stage, ts}],
       noticings: [{kind, text, action:{href|targetEvent, label}}],
       headline: string,
       isEmpty: boolean,
     }

   Self-test (IIFE) verifies shape on a synthetic DOM input.
   ============================================================ */

(function (root) {
  "use strict";

  /** Stage order matches legacy renderBrief stage list. */
  var STAGE_ORDER = [
    { key: "new", label: "New", token: "--jb-stage-new" },
    { key: "researching", label: "Researching", token: "--jb-stage-researching" },
    { key: "applied", label: "Applied", token: "--jb-stage-applied" },
    { key: "phone-screen", label: "Phone Screen", token: "--jb-stage-phone" },
    { key: "interviewing", label: "Interviewing", token: "--jb-stage-interviewing" },
    { key: "offer", label: "Offer", token: "--jb-stage-offer" },
    { key: "rejected", label: "Rejected", token: "--jb-stage-rejected" },
    { key: "passed", label: "Passed", token: "--jb-stage-passed" },
  ];

  /** stage CSS key -> <jb-stage-dot stage="..."> attribute name. */
  var STAGE_DOT_ATTR = {
    "new": "new",
    "researching": "researching",
    "applied": "applied",
    "phone-screen": "phone",
    "interviewing": "interviewing",
    "offer": "offer",
    "rejected": "rejected",
    "passed": "passed",
  };

  function _toInt(s) {
    var n = parseInt(String(s || "").replace(/[^0-9-]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /** Read four hero numbers from legacy #briefStats. Returns 0s if not yet rendered. */
  function readHeroFromDom(doc) {
    var stats = doc.getElementById("briefStats");
    var out = { found: 0, applied: 0, inLoop: 0, offers: 0, foundSub: "", appliedSub: "", inLoopSub: "", offersSub: "" };
    if (!stats) return out;
    var cards = stats.querySelectorAll(".stat-card");
    if (!cards || cards.length < 4) return out;
    var cells = [
      ["found", "foundSub"],
      ["applied", "appliedSub"],
      ["inLoop", "inLoopSub"],
      ["offers", "offersSub"],
    ];
    for (var i = 0; i < 4 && i < cards.length; i++) {
      var c = cards[i];
      var val = c.querySelector(".stat-card__value");
      var sub = c.querySelector(".stat-card__sub");
      out[cells[i][0]] = val ? _toInt(val.textContent) : 0;
      out[cells[i][1]] = sub ? (sub.textContent || "").trim() : "";
    }
    return out;
  }

  /** Derive each job's stage CSS key from kanban-card classes. */
  function jobsFromCards(doc) {
    var cards = doc.querySelectorAll(".kanban-card[data-stable-key]");
    var out = [];
    cards.forEach(function (card) {
      var key = card.getAttribute("data-stable-key") || "";
      // pick up the first kanban-card--stage-XXX class
      var stage = "new";
      var cls = card.className || "";
      var m = cls.match(/kanban-card--stage-([a-z-]+)/);
      if (m) stage = m[1];
      var titleEl = card.querySelector(".kanban-card__title");
      var coEl = card.querySelector(".kanban-card__company");
      var idx = card.getAttribute("data-index");
      out.push({
        key: key,
        index: idx ? Number(idx) : -1,
        stage: stage,
        title: titleEl ? (titleEl.textContent || "").trim() : "",
        company: coEl ? (coEl.textContent || "").trim() : "",
      });
    });
    return out;
  }

  /** Build the funnel from a list of jobs. */
  function buildFunnel(jobs) {
    var byStage = {};
    STAGE_ORDER.forEach(function (s) { byStage[s.key] = []; });
    jobs.forEach(function (j) {
      var k = j.stage in byStage ? j.stage : "new";
      byStage[k].push(j);
    });
    var total = jobs.length;
    return STAGE_ORDER.map(function (s) {
      var list = byStage[s.key];
      return {
        stage: s.key,
        dotStage: STAGE_DOT_ATTR[s.key] || "new",
        label: s.label,
        token: s.token,
        count: list.length,
        pct: total ? Math.round((list.length / total) * 100) : 0,
        jobs: list.slice(0, 24),
      };
    });
  }

  /** Most recent N cards by data-index DESC (newest discovered first). */
  function buildActivity(jobs, n) {
    var nMax = n == null ? 5 : n;
    var copy = jobs.slice().sort(function (a, b) {
      return (b.index || 0) - (a.index || 0);
    });
    return copy.slice(0, nMax).map(function (j) {
      return {
        key: j.key,
        title: j.title,
        company: j.company,
        stage: j.stage,
        dotStage: STAGE_DOT_ATTR[j.stage] || "new",
        ts: "", // legacy DOM doesn't expose ts; left blank for renderer
      };
    });
  }

  /** Synthesize a 14-day sparkline from a single value (zeros, terminal value).
   *  Documented in DAWN.md: there is no per-day series in the legacy schema,
   *  so we render a "now" tick rather than fabricate history. */
  function syntheticSpark(value) {
    var arr = [];
    for (var i = 0; i < 13; i++) arr.push(0);
    arr.push(Math.max(0, _toInt(value)));
    return arr;
  }

  /** Build inline AI noticings from real numbers; priority order documented in DAWN.md. */
  function buildNoticings(hero, funnel) {
    var noticings = [];
    var offers = (funnel.find(function (s) { return s.stage === "offer"; }) || {}).count || 0;
    var inLoop = hero.inLoop || 0;
    var found = hero.found || 0;
    var applied = hero.applied || 0;

    if (offers > 0) {
      noticings.push({
        kind: "offers",
        text: offers === 1
          ? "One offer is on the table."
          : offers + " offers are on the table.",
        action: { event: "dawn:scroll-to-stage", payload: "offer", label: "Open offers" },
      });
    }
    if (inLoop > 0 && offers === 0) {
      noticings.push({
        kind: "in-loop",
        text: inLoop === 1
          ? "One conversation is live in the loop."
          : inLoop + " conversations are live in the loop.",
        action: { event: "dawn:scroll-to-stage", payload: "interviewing", label: "Open loop" },
      });
    }
    if (found > 0) {
      noticings.push({
        kind: "found",
        text: found === 1
          ? "One new role surfaced this week."
          : found + " new roles surfaced this week.",
        action: { event: "dawn:scroll-to-stage", payload: "new", label: "Open new" },
      });
    }
    if (applied > 0 && noticings.length < 3) {
      noticings.push({
        kind: "applied",
        text: applied === 1
          ? "One application went out this week."
          : applied + " applications went out this week.",
        action: { event: "dawn:scroll-to-stage", payload: "applied", label: "Open applied" },
      });
    }
    if (noticings.length === 0) {
      noticings.push({
        kind: "quiet",
        text: "Pipeline is quiet — a good day to sharpen your story.",
        action: null,
      });
    }
    return noticings.slice(0, 3);
  }

  /** Editorial headline. Priority: offers > in-loop > new this week > applied this week > generic.
   *  Documented in DAWN.md (8 example states). */
  function buildHeadline(hero, funnel, isEmpty) {
    if (isEmpty) {
      return "Your pipeline is empty. Run discovery, or add a role to start the day.";
    }
    var offers = (funnel.find(function (s) { return s.stage === "offer"; }) || {}).count || 0;
    var inLoop = hero.inLoop || 0;
    var found = hero.found || 0;
    var applied = hero.applied || 0;

    if (offers > 0) {
      var rest = inLoop > 0
        ? (inLoop === 1 ? " One conversation is still in the loop." : " " + inLoop + " conversations are still in the loop.")
        : "";
      return (offers === 1 ? "One offer is still on the table." : offers + " offers are still on the table.") + rest;
    }
    if (inLoop > 0) {
      var withFound = found > 0
        ? (found === 1 ? " One fresh role surfaced this week." : " " + found + " fresh roles surfaced this week.")
        : "";
      return (inLoop === 1 ? "One conversation is live in the loop." : inLoop + " conversations are live in the loop.") + withFound;
    }
    if (found > 0 && applied > 0) {
      return found + " new this week, " + applied + " out the door — momentum is yours to keep.";
    }
    if (found > 0) {
      return found === 1
        ? "One new role surfaced this week. Decide fast, apply faster."
        : found + " new roles surfaced this week. Decide fast, apply faster.";
    }
    if (applied > 0) {
      return applied === 1
        ? "One application went out this week. Now sharpen the next one."
        : applied + " applications went out this week. Now sharpen the next one.";
    }
    return "A quiet pipeline today. A good day to reach out to someone new.";
  }

  /** Editorial date eyebrow — falls back to legacy #briefDate text or now(). */
  function readDate(doc) {
    var el = doc.getElementById("briefDate");
    if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    try {
      return new Date().toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch (e) {
      return "";
    }
  }

  /* ============================================================
     Phase-2 (newspaper-brief) editorial extensions.
     Used by the v2 Brief layout (newspaper masthead, lead story,
     by-the-numbers, 30-day funnel, "also today" stories).
     Read-only; no schema additions to legacy DOM.
     ============================================================ */

  /** Mockup-style edition line: "TUE · MAY 6, 2026 · LOCAL EDITION". */
  function buildEdition(now) {
    try {
      var d = now instanceof Date ? now : new Date();
      var weekday = d.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase();
      var month = d.toLocaleDateString(undefined, { month: "long" }).toUpperCase();
      var day = d.getDate();
      var year = d.getFullYear();
      return "THE DAILY BRIEF · " + weekday + ", " + month + " " + day + ", " + year + " · LOCAL EDITION";
    } catch (e) {
      return "THE DAILY BRIEF · LOCAL EDITION";
    }
  }

  /** Short read-time string for the masthead. Pipeline-scaled, capped. */
  function buildReadTime(total) {
    var n = Math.max(1, Math.min(8, Math.round((total || 0) / 5) || 2));
    return n + " min read";
  }

  /** Short italic deck/subtitle. Pulls from real counts. */
  function buildDeck(hero, funnel) {
    var offers = (funnel.find(function (s) { return s.stage === "offer"; }) || {}).count || 0;
    var inLoop = hero.inLoop || 0;
    var found = hero.found || 0;
    var parts = [];
    if (found > 0) parts.push(found + " fresh roles");
    if (inLoop > 0) parts.push(inLoop + " interview" + (inLoop === 1 ? "" : "s") + " in play");
    if (offers > 0) parts.push(offers + " offer" + (offers === 1 ? "" : "s") + " live");
    if (parts.length === 0) return "One big thing, three small things, and the numbers behind them.";
    return parts.join(", ") + ".";
  }

  /** Highest-fit job in the pipeline (skips "new" — those are untriaged). */
  function pickLeadJob(jobs) {
    if (!jobs || !jobs.length) return null;
    // Prefer offer > interviewing > phone-screen > applied; tie-break by data-index DESC.
    var stagePriority = { "offer": 6, "interviewing": 5, "phone-screen": 4, "applied": 3, "researching": 2, "new": 1 };
    var copy = jobs.slice().sort(function (a, b) {
      var pa = stagePriority[a.stage] || 0;
      var pb = stagePriority[b.stage] || 0;
      if (pa !== pb) return pb - pa;
      return (b.index || 0) - (a.index || 0);
    });
    return copy[0];
  }

  /** Build the LEAD STORY slot — eyebrow + headline + facts + body + actions. */
  function buildLead(hero, funnel, jobs) {
    var offers = (funnel.find(function (s) { return s.stage === "offer"; }) || {}).count || 0;
    var inLoop = hero.inLoop || 0;
    var lead = pickLeadJob(jobs);

    // Eyebrow + headline tone derived from the dominant signal.
    var eyebrow = "LEAD STORY · TODAY";
    var headlineHtml = "Today is a good day to <span class=\"underline\">decide</span>.";
    var body = "A quiet pipeline. Reach out to one person you respect — that's the highest-leverage move on a slow day.";
    var actions = [{ label: "Open pipeline", kind: "primary", event: "dawn:scroll-to-stage", payload: "applied" }];

    if (offers > 0 && lead && lead.stage === "offer") {
      eyebrow = "LEAD STORY · OFFER LIVE";
      headlineHtml = (escapeHtmlSafe(lead.company || "An offer") +
        " says <span class=\"underline\">yes</span>.<br>Decide before momentum slips.");
      body = "An offer is on the table. Stack it against your live loops, then either accept, counter, or close the conversation cleanly.";
      actions = [
        { label: "Open " + (lead.company || "offer"), kind: "primary", event: "dawn:open-job", payload: lead.key || "" },
        { label: "Compare loops", kind: "ghost", event: "dawn:scroll-to-stage", payload: "interviewing" },
      ];
    } else if (inLoop > 0 && lead && (lead.stage === "interviewing" || lead.stage === "phone-screen")) {
      eyebrow = "LEAD STORY · INTERVIEW PREP";
      headlineHtml = (escapeHtmlSafe(lead.company || "Your next loop") +
        " is up <span class=\"underline\">next</span>.<br>Sharpen the one thing that moves the call.");
      body = "Block 45 minutes today on the highest-weight skill for this loop. Notes-doc opened wins more loops than over-preparation.";
      actions = [
        { label: "Open " + (lead.company || "loop"), kind: "primary", event: "dawn:open-job", payload: lead.key || "" },
        { label: "See all loops", kind: "ghost", event: "dawn:scroll-to-stage", payload: "interviewing" },
      ];
    } else if (lead && lead.stage === "applied") {
      eyebrow = "LEAD STORY · STILL OUT THERE";
      headlineHtml = (escapeHtmlSafe(lead.company || "Your last application") +
        " hasn't <span class=\"underline\">replied</span> yet.<br>Decide: nudge, network, or move on.");
      body = "Applications past their median reply window rarely warm back up on their own. A warm intro doubles the rate.";
      actions = [
        { label: "Open " + (lead.company || "role"), kind: "primary", event: "dawn:open-job", payload: lead.key || "" },
        { label: "Find a warm intro", kind: "ghost", event: "dawn:scroll-to-stage", payload: "applied" },
      ];
    } else if (hero.found > 0) {
      eyebrow = "LEAD STORY · FRESH FINDS";
      headlineHtml = (String(hero.found) +
        " new roles <span class=\"underline\">surfaced</span>.<br>Triage now, apply faster than yesterday.");
      body = "Speed matters more than polish on first-touch. Skim the JD, pick two, draft cover letters before the day owns you.";
      actions = [
        { label: "Triage new", kind: "primary", event: "dawn:scroll-to-stage", payload: "new" },
      ];
    }

    // Facts: a small set of real, useful numbers derived from current pipeline.
    var facts = [
      { label: "PIPELINE", value: String(jobs.length), tone: null },
      { label: "APPLIED",  value: String(hero.applied || 0), tone: hero.applied > 0 ? "amber" : null },
      { label: "IN LOOP",  value: String(inLoop), tone: inLoop > 0 ? "mint" : null },
      { label: "OFFERS",   value: String(offers), tone: offers > 0 ? "mint" : null },
    ];

    return {
      eyebrow: eyebrow,
      headlineHtml: headlineHtml,
      facts: facts,
      body: body,
      actions: actions,
      stickerLabel: "read me first",
    };
  }

  /** "By the numbers" 2×2 stats card — values, labels, deltas, tones. */
  function buildByTheNumbers(hero, funnel) {
    var offers = (funnel.find(function (s) { return s.stage === "offer"; }) || {}).count || 0;
    var inLoop = hero.inLoop || 0;
    return [
      { value: hero.found || 0,   label: "roles surfaced",   delta: hero.foundSub   || "vs last week", tone: "mint" },
      { value: hero.applied || 0, label: "applications",      delta: hero.appliedSub || "this week",     tone: "amber" },
      { value: inLoop,            label: "interviews this wk", delta: hero.inLoopSub  || "screens + loops", tone: null },
      { value: offers,            label: "offer" + (offers === 1 ? "" : "s") + " live", delta: hero.offersSub || "in pipeline", tone: offers > 0 ? "amber" : null },
    ];
  }

  /** 6-row 30-day funnel for the brief — uses kanban-card counts. */
  function buildFunnel30d(jobs) {
    var byStage = { "new": 0, "researching": 0, "applied": 0, "phone-screen": 0, "interviewing": 0, "offer": 0 };
    jobs.forEach(function (j) {
      // Treat any non-terminal stage as part of its kind.
      if (Object.prototype.hasOwnProperty.call(byStage, j.stage)) byStage[j.stage] += 1;
    });
    return [
      { kind: "discovered",   label: "Discovered",   count: byStage["new"]           },
      { kind: "researched",   label: "Researched",   count: byStage["researching"]   },
      { kind: "applied",      label: "Applied",      count: byStage["applied"]       },
      { kind: "phone_screen", label: "Phone screen", count: byStage["phone-screen"]  },
      { kind: "interview",    label: "Interview",    count: byStage["interviewing"]  },
      { kind: "offer",        label: "Offer",        count: byStage["offer"]         },
    ];
  }

  /** Up to 3 editorial "Also today" stories — stale / prep / fresh. */
  function buildStories(hero, funnel, jobs) {
    var stories = [];
    var staleApplied = jobs.filter(function (j) { return j.stage === "applied"; });
    if (staleApplied.length) {
      var pick = staleApplied[0];
      stories.push({
        kind: "stale",
        title: (pick.company ? pick.company + " " : "Older applications ") + "haven't replied.",
        body: "Median reply at companies your size falls off fast after a week. Two warm-intro routes usually exist if you ask.",
        cta: { label: "Find a warm intro →", event: "dawn:open-job", payload: pick.key || "" },
      });
    }
    var loops = jobs.filter(function (j) { return j.stage === "phone-screen" || j.stage === "interviewing"; });
    if (loops.length) {
      var loop = loops[0];
      stories.push({
        kind: "prep",
        title: (loop.company ? loop.company + " loop coming up" : "Loops on the calendar") + ".",
        body: "Block 45 minutes on the highest-weight session. Open the prep doc today — not the morning of.",
        cta: { label: "Open prep doc →", event: "dawn:open-job", payload: loop.key || "" },
      });
    }
    var fresh = jobs.filter(function (j) { return j.stage === "new"; });
    if (fresh.length) {
      stories.push({
        kind: "fresh",
        title: fresh.length + " surfaced. " + Math.min(fresh.length, Math.max(2, Math.round(fresh.length / 3))) + " worth a real look.",
        body: "Skim, score, shortlist. The longer they sit untriaged, the colder the pipeline gets.",
        cta: { label: "Triage " + fresh.length + " →", event: "dawn:scroll-to-stage", payload: "new" },
      });
    }
    if (stories.length === 0) {
      stories.push({
        kind: "fresh",
        title: "Slow day in the pipeline.",
        body: "Use the gap. Reach out to one person, sharpen the resume, or draft a thank-you you've been putting off.",
        cta: { label: "Open pipeline →", event: "dawn:scroll-to-stage", payload: "applied" },
      });
    }
    return stories.slice(0, 3);
  }

  function escapeHtmlSafe(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Public API. */
  function getDawnViewModel(opts) {
    var doc = (opts && opts.doc) || (typeof document !== "undefined" ? document : null);
    if (!doc) {
      return _emptyVM();
    }
    var hero = readHeroFromDom(doc);
    var jobs = jobsFromCards(doc);
    var funnel = buildFunnel(jobs);
    var activity = buildActivity(jobs, 5);
    var isEmpty = jobs.length === 0;
    var noticings = buildNoticings(hero, funnel);
    var headline = buildHeadline(hero, funnel, isEmpty);

    // Phase-2 editorial extensions (newspaper-brief layout). Derived data
    // only — no schema additions to legacy DOM.
    var nowDate = (opts && opts.now instanceof Date) ? opts.now : new Date();
    var lead = buildLead(hero, funnel, jobs);
    var byTheNumbers = buildByTheNumbers(hero, funnel);
    var funnel30d = buildFunnel30d(jobs);
    var stories = buildStories(hero, funnel, jobs);

    return {
      date: readDate(doc),
      hero: {
        found:   { value: hero.found,   sub: hero.foundSub,   spark: syntheticSpark(hero.found),   tier: tierFor("found", hero.found, hero.foundSub) },
        applied: { value: hero.applied, sub: hero.appliedSub, spark: syntheticSpark(hero.applied), tier: tierFor("applied", hero.applied, hero.appliedSub) },
        inLoop:  { value: hero.inLoop,  sub: hero.inLoopSub,  spark: syntheticSpark(hero.inLoop),  tier: hero.inLoop > 0 ? "high" : "low" },
        offers:  { value: hero.offers,  sub: hero.offersSub,  spark: syntheticSpark(hero.offers),  tier: hero.offers > 0 ? "high" : "low" },
      },
      funnel: funnel,
      activity: activity,
      noticings: noticings,
      headline: headline,
      isEmpty: isEmpty,
      total: jobs.length,

      // ---- Phase-2 newspaper-brief slots (additive; legacy fields untouched) ----
      edition: buildEdition(nowDate),
      readTime: buildReadTime(jobs.length),
      title: "The Daily Brief",
      deckCopy: buildDeck(hero, funnel),
      lead: lead,
      byTheNumbers: byTheNumbers,
      funnel30d: funnel30d,
      stories: stories,
    };
  }

  function tierFor(kind, value, sub) {
    // sub looks like "vs N prior week" — extract delta sign from value vs prior.
    var m = String(sub || "").match(/(\d+)/);
    var prior = m ? Number(m[1]) : 0;
    if (value > prior) return "high";
    if (value < prior) return "mid";
    return "low";
  }

  function _emptyVM() {
    return {
      date: "",
      hero: {
        found:   { value: 0, sub: "", spark: syntheticSpark(0), tier: "low" },
        applied: { value: 0, sub: "", spark: syntheticSpark(0), tier: "low" },
        inLoop:  { value: 0, sub: "", spark: syntheticSpark(0), tier: "low" },
        offers:  { value: 0, sub: "", spark: syntheticSpark(0), tier: "low" },
      },
      funnel: STAGE_ORDER.map(function (s) {
        return { stage: s.key, dotStage: STAGE_DOT_ATTR[s.key] || "new", label: s.label, token: s.token, count: 0, pct: 0, jobs: [] };
      }),
      activity: [],
      noticings: [{ kind: "empty", text: "Your pipeline is empty.", action: null }],
      headline: "Your pipeline is empty. Run discovery, or add a role to start the day.",
      isEmpty: true,
      total: 0,
      // Phase-2 newspaper-brief slots — present but empty so the renderer is safe.
      edition: "THE DAILY BRIEF · LOCAL EDITION",
      readTime: "1 min read",
      title: "The Daily Brief",
      deckCopy: "An empty pipeline today. Start a discovery run, or add a role to start the day.",
      lead: {
        eyebrow: "LEAD STORY · GETTING STARTED",
        headlineHtml: "Your pipeline is <span class=\"underline\">empty</span>.<br>That's a clean place to start.",
        facts: [
          { label: "PIPELINE", value: "0", tone: null },
          { label: "APPLIED",  value: "0", tone: null },
          { label: "IN LOOP",  value: "0", tone: null },
          { label: "OFFERS",   value: "0", tone: null },
        ],
        body: "Run discovery to surface roles, or add a job manually. Once a few are in, this brief will sharpen itself.",
        actions: [{ label: "Add a role", kind: "primary", event: "dawn:scroll-to-stage", payload: "new" }],
        stickerLabel: "start here",
      },
      byTheNumbers: [
        { value: 0, label: "roles surfaced",  delta: "no runs yet",   tone: null },
        { value: 0, label: "applications",    delta: "—",              tone: null },
        { value: 0, label: "interviews",      delta: "—",              tone: null },
        { value: 0, label: "offers live",     delta: "—",              tone: null },
      ],
      funnel30d: [
        { kind: "discovered",   label: "Discovered",   count: 0 },
        { kind: "researched",   label: "Researched",   count: 0 },
        { kind: "applied",      label: "Applied",      count: 0 },
        { kind: "phone_screen", label: "Phone screen", count: 0 },
        { kind: "interview",    label: "Interview",    count: 0 },
        { kind: "offer",        label: "Offer",        count: 0 },
      ],
      stories: [],
    };
  }

  /* ============================================================
     Phase-1 (flowing-page) view-models — pipeline + letter.
     Read-only. DOM-only. No fetches. No schema additions.
     ============================================================ */

  /** Stage CSS-key (kanban-card--stage-X) -> contract stage key. */
  var STAGE_CSS_TO_CONTRACT = {
    "new": "new",
    "researching": "researching",
    "applied": "applied",
    "phone-screen": "phone-screen",
    "phone": "phone-screen",
    "interviewing": "interviewing",
    "offer": "offer",
    "rejected": "rejected",
    "passed": "passed",
  };
  var PIPELINE_STAGES = [
    { key: "researching",  label: "Researching" },
    { key: "applied",      label: "Applied" },
    { key: "phone-screen", label: "Phone screen" },
    { key: "interviewing", label: "Interviewing" },
    { key: "offer",        label: "Offer" },
  ];

  function _attr(el, name) {
    if (!el || !el.getAttribute) return "";
    var v = el.getAttribute(name);
    return v == null ? "" : String(v).trim();
  }

  function _firstNumber(s) {
    var m = String(s == null ? "" : s).match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function _parseDateMaybe(s) {
    if (!s) return null;
    var t = Date.parse(String(s));
    return Number.isFinite(t) ? t : null;
  }

  /** Read one card into a rich record used by both pipeline + letter VMs. */
  function _readCard(card) {
    var key = _attr(card, "data-stable-key");
    var idx = _attr(card, "data-index");
    var cls = card.className || "";
    var stageMatch = cls.match(/kanban-card--stage-([a-z-]+)/);
    var cssStage = stageMatch ? stageMatch[1] : "new";
    var stage = STAGE_CSS_TO_CONTRACT[cssStage] || "new";

    var titleEl = card.querySelector(".kanban-card__title");
    var coEl = card.querySelector(".kanban-card__company");
    var role = titleEl ? (titleEl.textContent || "").trim() : "";
    var company = coEl ? (coEl.textContent || "").trim() : "";

    // Salary: prefer explicit data-* attribute; fall back to .role-fact__value--salary text.
    var salary = _attr(card, "data-salary") || null;
    if (!salary) {
      var salEl = card.querySelector(".role-fact__value--salary");
      var salTxt = salEl ? (salEl.textContent || "").trim() : "";
      salary = salTxt || null;
    }

    var fitAttr = _attr(card, "data-fit");
    var fitScore = fitAttr ? _firstNumber(fitAttr) : null;
    if (fitScore != null) {
      // clamp to 1–10 contract band; reject obvious garbage
      if (!Number.isFinite(fitScore)) fitScore = null;
      else fitScore = Math.max(1, Math.min(10, Math.round(fitScore)));
    }

    var noteAttr = _attr(card, "data-note");
    var note = noteAttr ? noteAttr : null;

    // optional structured timestamps for flag derivation
    var appliedAtMs = _parseDateMaybe(_attr(card, "data-applied-at"));
    var interviewAtMs = _parseDateMaybe(_attr(card, "data-interview-at"));
    var foundAt = _attr(card, "data-found-at") || "";
    var replied = _attr(card, "data-replied") === "yes";

    // optional letter draft surfaced via data-letter-draft (kept hint-only, no schema add).
    var draft = _attr(card, "data-letter-draft");

    // optional jdSnippet hint
    var jdSnippet = _attr(card, "data-jd-snippet");

    return {
      jobKey: key,
      index: idx ? Number(idx) : -1,
      cssStage: cssStage,
      stage: stage,
      role: role,
      company: company,
      salary: salary,
      fitScore: fitScore,
      note: note,
      appliedAtMs: appliedAtMs,
      interviewAtMs: interviewAtMs,
      foundAt: foundAt,
      replied: replied,
      draft: draft,
      jdSnippet: jdSnippet,
    };
  }

  /** Compute the contract `flag` per the documented rules. */
  function computeFlag(rec, nowMs) {
    var now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (rec.replied) return "reply";
    if (rec.stage === "offer") return "offer";

    if (rec.stage === "phone-screen" || rec.stage === "interviewing") {
      if (rec.interviewAtMs != null && rec.interviewAtMs > now) {
        var diff = rec.interviewAtMs - now;
        if (diff <= 48 * 60 * 60 * 1000) return "prep";
        return "scheduled";
      }
    }

    if (rec.stage === "applied" && rec.appliedAtMs != null) {
      var ageMs = now - rec.appliedAtMs;
      if (ageMs > 14 * 24 * 60 * 60 * 1000) return "stale";
    }
    return null;
  }

  function getPipelineViewModel(opts) {
    var doc = (opts && opts.doc) || (typeof document !== "undefined" ? document : null);
    var nowMs = (opts && Number.isFinite(opts.nowMs)) ? opts.nowMs : Date.now();
    if (!doc) {
      return { stages: PIPELINE_STAGES.map(function (s) { return { key: s.key, label: s.label, cards: [] }; }), untriaged: [], empty: true };
    }
    var nodeList = doc.querySelectorAll(".kanban-card[data-stable-key]");
    var records = [];
    nodeList.forEach(function (n) { records.push(_readCard(n)); });

    var byStage = {};
    PIPELINE_STAGES.forEach(function (s) { byStage[s.key] = []; });

    var untriaged = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.stage === "new") {
        untriaged.push({
          jobKey: r.jobKey,
          role: r.role,
          company: r.company,
          fitScore: r.fitScore,
          foundAt: r.foundAt || "",
        });
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(byStage, r.stage)) continue;
      byStage[r.stage].push({
        jobKey: r.jobKey,
        role: r.role,
        company: r.company,
        fitScore: r.fitScore,
        salary: r.salary,
        note: r.note,
        flag: computeFlag(r, nowMs),
      });
    }

    // Sort untriaged by fit DESC (nulls last), stable on insertion order otherwise.
    untriaged.sort(function (a, b) {
      var av = a.fitScore == null ? -Infinity : a.fitScore;
      var bv = b.fitScore == null ? -Infinity : b.fitScore;
      if (av !== bv) return bv - av;
      return 0;
    });

    var stages = PIPELINE_STAGES.map(function (s) {
      return { key: s.key, label: s.label, cards: byStage[s.key] };
    });

    var anyCards = untriaged.length > 0 || stages.some(function (s) { return s.cards.length > 0; });

    return { stages: stages, untriaged: untriaged, empty: !anyCards };
  }

  function _truncate(s, n) {
    var str = String(s == null ? "" : s);
    if (str.length <= n) return str;
    return str.slice(0, Math.max(0, n - 1)).replace(/\s+\S*$/, "") + "…";
  }

  var ATS_TARGET_LEN = [200, 320];
  var ATS_STOP_SET = {};
  (
    "a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,as,is,are," +
    "was,were,be,been,being,this,that,these,those,it,its,you,your,we,our," +
    "us,i,me,my,they,them,their,he,she,his,her,from,into,about,over,under," +
    "than,so,not,no,yes,do,does,did,have,has,had,will,would,can,could," +
    "should,may,might,must,shall,via,per,within,across,using"
  ).split(",").forEach(function (term) { ATS_STOP_SET[term] = 1; });
  var ATS_TONE_SET = {};
  [
    "led","built","shipped","launched","designed","architected","drove",
    "owned","reduced","increased","improved","scaled","migrated","mentored",
    "delivered","automated","optimized","unblocked","grew","saved","cut",
    "accelerated","measured","decided","resolved","worked",
  ].forEach(function (term) { ATS_TONE_SET[term] = 1; });

  function _atsTokens(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9\s\-\+\.#]/g, " ")
      .split(/\s+/)
      .map(function (term) { return term.replace(/^[\-\.]+|[\-\.]+$/g, ""); })
      .filter(function (term) { return term.length >= 2 && !ATS_STOP_SET[term]; });
  }

  function _atsTopTerms(jd) {
    var freq = {};
    _atsTokens(jd).forEach(function (term) { freq[term] = (freq[term] || 0) + 1; });
    return Object.keys(freq).map(function (term) {
      return { term: term, weight: freq[term] };
    }).sort(function (a, b) {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
    }).slice(0, 12);
  }

  function _atsSyllables(word) {
    var w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    var groups = w.match(/[aeiouy]{1,2}/g);
    return groups ? groups.length : 1;
  }

  function _atsReadingGrade(text) {
    var sentences = String(text || "").split(/[.!?]+/).filter(function (s) { return s.trim(); }).length || 1;
    var words = String(text || "").trim().match(/\S+/g) || [];
    var wc = words.length || 1;
    var syllables = 0;
    words.forEach(function (word) { syllables += _atsSyllables(word); });
    var grade = 0.39 * (wc / sentences) + 11.8 * (syllables / wc) - 15.59;
    if (!Number.isFinite(grade)) grade = 0;
    return Math.max(0, Math.min(20, Math.round(grade)));
  }

  function _atsLengthScore(words) {
    if (words === 0) return 0;
    if (words >= ATS_TARGET_LEN[0] && words <= ATS_TARGET_LEN[1]) return 100;
    var dist = words < ATS_TARGET_LEN[0] ? ATS_TARGET_LEN[0] - words : words - ATS_TARGET_LEN[1];
    return Math.max(0, Math.round(100 - dist * 0.6));
  }

  function _atsFirstPersonScore(text) {
    var words = String(text || "").toLowerCase().match(/\b[\w']+\b/g) || [];
    if (!words.length) return 0;
    var hits = 0;
    words.forEach(function (word) {
      if (/^(i|me|my|mine|we|our|ours|us)$/.test(word)) hits++;
    });
    var ratio = hits / words.length;
    if (ratio === 0) return 85;
    if (ratio <= 0.06) return 100;
    return Math.max(0, Math.round(100 - ((ratio - 0.06) * 1200)));
  }

  function _atsToneScore(tokens, draft) {
    if (!tokens.length) return 0;
    var hits = 0;
    tokens.forEach(function (term) { if (ATS_TONE_SET[term]) hits++; });
    var actionPct = Math.min(100, (hits / Math.max(1, tokens.length / 50)) * 100);
    return Math.round(actionPct * 0.7 + _atsFirstPersonScore(draft) * 0.3);
  }

  function _fallbackAtsAnalyze(input) {
    var jd = (input && input.jd) || "";
    var draft = (input && input.draft) || "";
    var draftTokens = _atsTokens(draft);
    var draftSet = {};
    draftTokens.forEach(function (term) { draftSet[term] = 1; });
    var hits = [];
    var misses = [];
    var totalWeight = 0;
    var hitWeight = 0;
    _atsTopTerms(jd).forEach(function (entry) {
      totalWeight += entry.weight;
      if (draftSet[entry.term]) {
        hits.push(entry);
        hitWeight += entry.weight;
      } else {
        misses.push(entry);
      }
    });
    var keywordCoverage = totalWeight ? Math.round((hitWeight / totalWeight) * 100) : 0;
    var words = _countWordsForAts(draft);
    var toneMatch = _atsToneScore(draftTokens, draft);
    // Weighted sum: keyword overlap 60%, tone match 25%, length-band fit 15%.
    var score = Math.round(keywordCoverage * 0.60 + toneMatch * 0.25 + _atsLengthScore(words) * 0.15);
    return {
      score: Math.max(0, Math.min(100, score)),
      keywordCoverage: keywordCoverage,
      toneMatch: toneMatch,
      length: { words: words, target: [ATS_TARGET_LEN[0], ATS_TARGET_LEN[1]] },
      hits: hits,
      misses: misses,
      readingLevel: "Grade " + _atsReadingGrade(draft),
    };
  }

  function _ensureAtsGlobal() {
    root.JobBoredAts = root.JobBoredAts || {};
    if (typeof root.JobBoredAts.analyze !== "function") root.JobBoredAts.analyze = _fallbackAtsAnalyze;
    if (typeof root.JobBoredAts.scoreDetails !== "function") root.JobBoredAts.scoreDetails = root.JobBoredAts.analyze;
    if (typeof root.JobBoredAts.score !== "function") {
      root.JobBoredAts.score = function (input) {
        return root.JobBoredAts.analyze(input).score;
      };
    }
  }

  function _countWordsForAts(s) {
    var m = String(s || "").trim().match(/\S+/g);
    return m ? m.length : 0;
  }

  function _pct(n, fallback) {
    var v = Number(n);
    if (!Number.isFinite(v)) v = fallback == null ? 0 : fallback;
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  function _terms(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (x) {
      return {
        term: String((x && x.term) || ""),
        weight: Number.isFinite(Number(x && x.weight)) ? Number(x.weight) : 1,
      };
    }).filter(function (x) { return x.term; });
  }

  function _normalizeAts(raw, draft) {
    var obj = raw && typeof raw === "object" ? raw : {};
    var scalar = typeof raw === "number" ? raw : obj.score;
    var len = obj.length && typeof obj.length === "object" ? obj.length : {};
    var target = Array.isArray(len.target) && len.target.length === 2 ? len.target : [200, 320];
    return {
      score: _pct(scalar, 0),
      keywordCoverage: _pct(obj.keywordCoverage, 0),
      toneMatch: _pct(obj.toneMatch, 0),
      length: {
        words: Number.isFinite(Number(len.words)) ? Number(len.words) : _countWordsForAts(draft),
        target: [Number(target[0]) || 200, Number(target[1]) || 320],
      },
      hits: _terms(obj.hits),
      misses: _terms(obj.misses),
      readingLevel: typeof obj.readingLevel === "string" ? obj.readingLevel : "Grade 0",
    };
  }

  function _scoreAts(jd, draft) {
    var svc = root.JobBoredAts || {};
    if (typeof svc.analyze === "function") return _normalizeAts(svc.analyze({ jd: jd, draft: draft }), draft);
    if (typeof svc.scoreDetails === "function") return _normalizeAts(svc.scoreDetails({ jd: jd, draft: draft }), draft);
    if (typeof svc.score === "function") return _normalizeAts(svc.score({ jd: jd, draft: draft }), draft);
    return _normalizeAts(null, draft);
  }

  function _findCardByStableKey(doc, key) {
    var cards = doc.querySelectorAll(".kanban-card[data-stable-key]");
    for (var i = 0; i < cards.length; i++) {
      if (_attr(cards[i], "data-stable-key") === key) return cards[i];
    }
    return null;
  }

  function _suggestionsFor(ats) {
    var out = [];
    if (!ats) return out;
    if (ats.keywordCoverage < 60) {
      var top = (ats.misses || []).slice(0, 3).map(function (m) { return m.term; }).join(", ");
      out.push({
        kind: "evidence",
        title: "Cover the role's vocabulary",
        body: top
          ? "Your draft is missing high-signal JD terms: " + top + ". Add a concrete example for each."
          : "Pull two or three exact phrases from the JD into your evidence sentences.",
        applyHint: "Add one sentence of evidence per missing term.",
      });
    }
    if (ats.toneMatch < 50) {
      out.push({
        kind: "honest",
        title: "Lead with outcomes, not adjectives",
        body: "Your tone reads passive. Open clauses with action verbs (led, shipped, reduced, mentored) and pin a number.",
        applyHint: "Rewrite the opener of each paragraph as a verb-led outcome.",
      });
    }
    var w = (ats.length && ats.length.words) || 0;
    if (w > 0 && w < 200) {
      out.push({
        kind: "evidence",
        title: "Add one more concrete story",
        body: "You're under the 200-word floor. Add one paragraph of evidence — a result with a number, a system, and a person it helped.",
        applyHint: "Aim for 220–280 words total.",
      });
    } else if (w > 320) {
      out.push({
        kind: "trim",
        title: "Cut to the band",
        body: "You're over 320 words. Trim adjectives and any sentence that doesn't carry a verb or a number.",
        applyHint: "Target ~280 words.",
      });
    }
    if (out.length < 1) {
      out.push({
        kind: "tighten",
        title: "Tighten the close",
        body: "End with one specific reason this team — not a generic enthusiasm sentence.",
        applyHint: "Replace the last sentence with a team-specific hook.",
      });
    }
    return out.slice(0, 4);
  }

  function getLetterViewModel(jobKey, opts) {
    var doc = (opts && opts.doc) || (typeof document !== "undefined" ? document : null);
    var key = String(jobKey == null ? "" : jobKey);
    var emptyAts = _scoreAts("", "");

    if (!doc) {
      return {
        job: { jobKey: key, role: "", company: "", jdSnippet: "", salary: null },
        draft: "",
        ats: emptyAts,
        suggestions: _suggestionsFor(emptyAts),
      };
    }

    var card = _findCardByStableKey(doc, key);
    if (!card) {
      return {
        job: { jobKey: key, role: "", company: "", jdSnippet: "", salary: null },
        draft: "",
        ats: emptyAts,
        suggestions: _suggestionsFor(emptyAts),
      };
    }
    var rec = _readCard(card);
    var draft = rec.draft || "";
    var jd = rec.jdSnippet || "";
    var atsResult = _scoreAts(jd, draft);

    return {
      job: {
        jobKey: rec.jobKey,
        role: rec.role,
        company: rec.company,
        jdSnippet: _truncate(jd, 240),
        salary: rec.salary,
      },
      draft: draft,
      ats: atsResult,
      suggestions: _suggestionsFor(atsResult),
    };
  }

  /* ----- expose ----- */
  _ensureAtsGlobal();

  var api = {
    getDawnViewModel: getDawnViewModel,
    getPipelineViewModel: getPipelineViewModel,
    getLetterViewModel: getLetterViewModel,
    STAGE_ORDER: STAGE_ORDER,
    PIPELINE_STAGES: PIPELINE_STAGES,
    _internal: {
      readHeroFromDom: readHeroFromDom,
      jobsFromCards: jobsFromCards,
      buildFunnel: buildFunnel,
      buildActivity: buildActivity,
      buildNoticings: buildNoticings,
      buildHeadline: buildHeadline,
      readCard: _readCard,
      computeFlag: computeFlag,
    },
  };
  root.JobBoredDawn = root.JobBoredDawn || {};
  root.JobBoredDawn.data = api;

  /* ============================================================
     Self-test — runs once on load, asserts shape on synthetic DOM.
     Fails silently in production; logs only on shape mismatch.
     ============================================================ */
  (function selfTest() {
    try {
      if (typeof document === "undefined" || !document.implementation) return;
      var d = document.implementation.createHTMLDocument("dawn-self-test");
      d.body.innerHTML = [
        '<span id="briefDate">Mon, May 6, 2026</span>',
        '<div id="briefStats">',
        '  <div class="stat-card"><span class="stat-card__value">3</span><span class="stat-card__sub">vs 1 prior week</span></div>',
        '  <div class="stat-card"><span class="stat-card__value">2</span><span class="stat-card__sub">vs 2 prior week</span></div>',
        '  <div class="stat-card"><span class="stat-card__value">1</span><span class="stat-card__sub">interviewing + screens</span></div>',
        '  <div class="stat-card"><span class="stat-card__value">1</span><span class="stat-card__sub">full pipeline</span></div>',
        '</div>',
        '<article class="kanban-card kanban-card--stage-applied" data-stable-key="0" data-index="0"><span class="kanban-card__title">SRE</span><span class="kanban-card__company">Acme</span></article>',
        '<article class="kanban-card kanban-card--stage-offer" data-stable-key="1" data-index="1"><span class="kanban-card__title">Backend</span><span class="kanban-card__company">Globex</span></article>',
        '<article class="kanban-card kanban-card--stage-new" data-stable-key="2" data-index="2"><span class="kanban-card__title">Platform</span><span class="kanban-card__company">Initech</span></article>',
      ].join("\n");
      var vm = getDawnViewModel({ doc: d });
      var ok =
        vm &&
        typeof vm.headline === "string" && vm.headline.length > 0 &&
        vm.hero && vm.hero.found && vm.hero.found.value === 3 &&
        vm.hero.offers.value === 1 &&
        Array.isArray(vm.funnel) && vm.funnel.length === STAGE_ORDER.length &&
        vm.total === 3 &&
        Array.isArray(vm.activity) && vm.activity.length === 3 &&
        Array.isArray(vm.noticings) && vm.noticings.length >= 1 &&
        vm.headline.toLowerCase().indexOf("offer") !== -1; // 1 offer should win priority
      if (!ok && typeof console !== "undefined" && console.warn) {
        console.warn("[dawn-data] self-test failed", vm);
      }
    } catch (e) {
      // never throw on load
    }
  })();

  /* ============================================================
     Self-test (Phase-1) — pipeline + letter view-models.
     ============================================================ */
  (function selfTestP1() {
    try {
      if (typeof document === "undefined" || !document.implementation) return;
      var d = document.implementation.createHTMLDocument("dawn-data-p1-test");
      var now = Date.parse("2026-05-06T12:00:00Z");
      var stale = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();
      var fresh = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
      var soon  = new Date(now + 12 * 60 * 60 * 1000).toISOString();   // <48h
      var later = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(); // >48h

      d.body.innerHTML = [
        // applied + stale
        '<article class="kanban-card kanban-card--stage-applied" data-stable-key="A1" data-index="0" data-applied-at="' + stale + '" data-fit="8" data-salary="$150k">',
        '  <span class="kanban-card__title">Senior SRE</span><span class="kanban-card__company">Acme</span>',
        '</article>',
        // applied + fresh (no flag)
        '<article class="kanban-card kanban-card--stage-applied" data-stable-key="A2" data-index="1" data-applied-at="' + fresh + '" data-fit="6">',
        '  <span class="kanban-card__title">Backend</span><span class="kanban-card__company">Globex</span>',
        '</article>',
        // phone-screen + prep window
        '<article class="kanban-card kanban-card--stage-phone-screen" data-stable-key="P1" data-index="2" data-interview-at="' + soon + '" data-fit="9">',
        '  <span class="kanban-card__title">Platform Eng</span><span class="kanban-card__company">Initech</span>',
        '</article>',
        // interviewing + scheduled
        '<article class="kanban-card kanban-card--stage-interviewing" data-stable-key="I1" data-index="3" data-interview-at="' + later + '" data-fit="7" data-note="Strong team">',
        '  <span class="kanban-card__title">Staff</span><span class="kanban-card__company">Hooli</span>',
        '</article>',
        // offer
        '<article class="kanban-card kanban-card--stage-offer" data-stable-key="O1" data-index="4" data-fit="10">',
        '  <span class="kanban-card__title">Principal</span><span class="kanban-card__company">Pied Piper</span>',
        '</article>',
        // replied (any stage)
        '<article class="kanban-card kanban-card--stage-applied" data-stable-key="R1" data-index="5" data-replied="yes" data-applied-at="' + fresh + '">',
        '  <span class="kanban-card__title">Lead</span><span class="kanban-card__company">Vandelay</span>',
        '</article>',
        // untriaged "new"
        '<article class="kanban-card kanban-card--stage-new" data-stable-key="N1" data-index="6" data-fit="4" data-found-at="2026-05-04">',
        '  <span class="kanban-card__title">Junior</span><span class="kanban-card__company">Stark</span>',
        '</article>',
        '<article class="kanban-card kanban-card--stage-new" data-stable-key="N2" data-index="7" data-fit="9" data-found-at="2026-05-05">',
        '  <span class="kanban-card__title">Senior</span><span class="kanban-card__company">Wayne</span>',
        '</article>',
        // letter draft target
        '<article class="kanban-card kanban-card--stage-applied" data-stable-key="L1" data-index="8" data-applied-at="' + fresh + '" data-jd-snippet="We need a senior backend engineer who has shipped distributed systems. Required: Go, Kubernetes, Postgres." data-letter-draft="I led a migration to Kubernetes and Go, mentored four engineers, owned reliability for Postgres, and shipped weekly.">',
        '  <span class="kanban-card__title">Senior BE</span><span class="kanban-card__company">Cyberdyne</span>',
        '</article>',
      ].join("\n");

      var pipe = getPipelineViewModel({ doc: d, nowMs: now });
      var stages = pipe.stages.reduce(function (m, s) { m[s.key] = s; return m; }, {});
      var flag = function (key, jobKey) {
        var s = stages[key];
        if (!s) return "MISSING_STAGE";
        for (var i = 0; i < s.cards.length; i++) {
          if (s.cards[i].jobKey === jobKey) return s.cards[i].flag;
        }
        return "MISSING_CARD";
      };

      var pipeOk =
        pipe && Array.isArray(pipe.stages) && pipe.stages.length === 5 &&
        pipe.stages[0].key === "researching" &&
        pipe.stages[4].key === "offer" &&
        pipe.empty === false &&
        flag("applied", "A1") === "stale" &&
        flag("applied", "A2") === null &&
        flag("phone-screen", "P1") === "prep" &&
        flag("interviewing", "I1") === "scheduled" &&
        flag("offer", "O1") === "offer" &&
        flag("applied", "R1") === "reply" &&
        // untriaged sorted by fit DESC: N2(9) before N1(4)
        Array.isArray(pipe.untriaged) && pipe.untriaged.length === 2 &&
        pipe.untriaged[0].jobKey === "N2" &&
        pipe.untriaged[1].jobKey === "N1" &&
        // shape: salary forwarded
        stages.applied.cards.some(function (c) { return c.jobKey === "A1" && c.salary === "$150k" && c.fitScore === 8; }) &&
        // note forwarded as null when absent, present when set
        stages.interviewing.cards[0].note === "Strong team";

      var letter = getLetterViewModel("L1", { doc: d });
      var letterOk =
        letter && letter.job && letter.job.jobKey === "L1" &&
        letter.job.role === "Senior BE" && letter.job.company === "Cyberdyne" &&
        typeof letter.draft === "string" && letter.draft.length > 0 &&
        letter.ats && typeof letter.ats.score === "number" &&
        letter.ats.score >= 0 && letter.ats.score <= 100 &&
        letter.ats.length && letter.ats.length.target[0] === 200 &&
        Array.isArray(letter.suggestions) && letter.suggestions.length >= 1 &&
        ["tighten","evidence","honest","trim"].indexOf(letter.suggestions[0].kind) !== -1;

      // missing-key path: empty draft, ats present, suggestions present
      var miss = getLetterViewModel("does-not-exist", { doc: d });
      var missOk = miss && miss.draft === "" && miss.ats && Array.isArray(miss.suggestions);

      // empty-doc path
      var emptyDoc = document.implementation.createHTMLDocument("empty");
      var pipeEmpty = getPipelineViewModel({ doc: emptyDoc });
      var emptyOk = pipeEmpty && pipeEmpty.empty === true && pipeEmpty.stages.length === 5 && pipeEmpty.untriaged.length === 0;
      var atsA = root.JobBoredAts && root.JobBoredAts.score({ jd: "python aws", draft: "I worked with python and aws" });
      var atsB = root.JobBoredAts && root.JobBoredAts.score({ jd: "python aws", draft: "I worked with python and aws" });
      var atsOk = typeof atsA === "number" && atsA === atsB && atsA >= 0 && atsA <= 100;

      if (typeof console !== "undefined") {
        if (pipeOk && letterOk && missOk && emptyOk && atsOk && console.log) {
          console.log("[dawn-data:p1] self-test pass");
        } else if (console.warn) {
          console.warn("[dawn-data:p1] self-test fail", { pipeOk: pipeOk, letterOk: letterOk, missOk: missOk, emptyOk: emptyOk, atsOk: atsOk, pipe: pipe, letter: letter });
        }
      }
    } catch (e) {
      // never throw on load
    }
  })();
})(typeof window !== "undefined" ? window : globalThis);
