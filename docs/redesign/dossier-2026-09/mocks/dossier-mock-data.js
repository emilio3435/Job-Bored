/* ============================================================
   dossier-mock-data.js — one role, every state the dossier has.
   ------------------------------------------------------------
   MOCK data for the redesign pages. The role is 3E · AI & Marketing
   Analytics Manager, the role in the 2026-09-17 dogfood report, and
   the content lengths are the lengths a real Google Jobs / Greenhouse
   posting and a real Hermes drafting run produce. A mock that uses
   short strings proves nothing.

   Variants:
     filled              default filled role, resume ready, letter missing
     materials-drafting  a cover-letter run in flight
     materials-failed    the run failed (the dogfood screenshot's state)
     long-title          a 57-character posting title
     loading             enrichment in flight
     no-resume           no keyword data, no scorecard
     enrich-error        the scrape/enrichment failed
     needs-review        the payload had to be recovered from a bad parse
     terminal            rejected — a closed role
   ============================================================ */
(function (root) {
  "use strict";

  var LONG_TITLE = "Senior Marketing Manager, Digital Brand Media (US Remote)";

  var REQUIREMENTS = [
    ["5+ years owning marketing analytics for a consumer subscription business", "found"],
    ["Expert SQL and hands-on experience modelling in dbt or an equivalent transformation layer", "found"],
    ["Demonstrated ownership of incrementality testing and media mix modelling", "found"],
    ["Fluency with LLM-assisted analysis workflows and prompt evaluation", "partial"],
    ["Experience partnering with brand and lifecycle teams on measurement strategy", "partial"],
    ["Comfort presenting to a CMO and defending methodology", "found"],
    ["Python for analysis and light production work", "found"],
    ["Bachelor's degree or equivalent practical experience", "found"],
  ];

  var NICE_TO_HAVES = [
    ["Experience in a marketplace or two-sided business", "found"],
    ["Prior work standing up a customer data platform", "missing"],
    ["Familiarity with privacy-safe measurement after ATT", "missing"],
  ];

  var STACK = [
    ["SQL", "found"], ["dbt", "found"], ["Snowflake", "found"], ["Python", "found"],
    ["Looker", "partial"], ["Amplitude", "partial"], ["GA4", "found"], ["Braze", "missing"],
    ["Databricks", "missing"], ["Airflow", "found"], ["Fivetran", "partial"], ["Hex", "missing"],
  ];

  var POINTS = [
    "Lead with the incrementality program: you rebuilt the holdout design and the blended CAC read moved 14 points.",
    "Name the LLM evaluation harness you shipped — this posting asks for prompt evaluation and almost nobody has it.",
    "They ask about defending methodology to a CMO. Use the pricing-test story where you overruled the agency.",
    "Ask what happened to the last person in the seat; the posting has been reposted twice since July.",
  ];

  var STRENGTHS = [
    "Six years of subscription marketing analytics maps directly onto the ownership this posting describes.",
    "The incrementality and media-mix work is the exact measurement stack they name first.",
    "You have shipped LLM-assisted analysis in production, which the posting treats as a differentiator.",
  ];

  var EVIDENCE = [
    {
      sourceType: "resume",
      snippet: "Rebuilt the geo-holdout design across nine markets and cut blended CAC 14% in two quarters, presenting the methodology to the CMO monthly.",
    },
    {
      sourceType: "work sample",
      snippet: "Built the prompt-evaluation harness that gated every customer-facing model change, with a labelled regression set of 1,200 cases.",
    },
  ];

  var GAPS = [
    {
      severity: "high",
      gap: "Braze and Databricks are absent from your materials",
      why: "Both are named in the stack paragraph and the resume screen at this company is keyword-driven.",
    },
    {
      severity: "medium",
      gap: "No named customer data platform implementation",
      why: "They list standing up a CDP as a nice-to-have and the team is mid-migration, so it will come up in the second round.",
    },
    {
      severity: "medium",
      gap: "No post-ATT privacy-safe measurement work",
      why: "Consumer subscription measurement lives or dies on this now.",
    },
  ];

  var DIMENSIONS = [
    { label: "Requirements", score: 78 },
    { label: "Relevance", score: 84 },
    { label: "Impact clarity", score: 71 },
    { label: "ATS parse", score: 66 },
    { label: "Tone fit", score: 69 },
  ];

  var STAGE_ORDER = [
    { key: "new", label: "New" },
    { key: "researching", label: "Researching" },
    { key: "applied", label: "Applied" },
    { key: "phone_screen", label: "Phone screen" },
    { key: "interviewing", label: "Interviewing" },
    { key: "offer", label: "Offer" },
  ];

  var RECORD = [
    { at: "2026-09-15", label: "Contacted", detail: "No reply yet", state: "done" },
    { at: "2026-09-16", label: "Resume drafted", detail: "", state: "done" },
    { at: "2026-09-17", label: "Found", detail: "Google Jobs (SerpApi) · discovery", state: "done" },
    { at: "2026-09-17", label: "Enriched", detail: "OpenRouter", state: "done" },
    { at: "2026-09-24", label: "Follow-up due", detail: "", state: "due" },
    { at: "", label: "Applied", detail: "Not yet", state: "future" },
  ];

  function mark(pairs) {
    return pairs.map(function (p) { return { text: p[0], status: p[1] }; });
  }

  /* --------------- documents --------------- */
  function docs(variant) {
    var resume = {
      type: "resume",
      label: "Tailored resume",
      state: "ready",
      stateWord: "ready",
      meta: "Drafted 2026-09-16 · 2 files",
      actions: [
        { label: "Preview", action: "materials-preview", href: "#", primary: true },
        { label: "Download PDF", action: "materials-download", href: "#" },
      ],
    };

    var letter;
    if (variant === "materials-drafting") {
      letter = {
        type: "cover_letter",
        label: "Cover letter",
        state: "drafting",
        stateWord: "drafting",
        phase: "drafting in progress",
        elapsed: "1m 07s",
        attempt: 1,
        message: "Reading the posting and your work samples to find the opening line.",
        actions: [{ label: "Cancel", action: "materials-dismiss", feature: "cover_letter" }],
      };
    } else if (variant === "materials-failed") {
      letter = {
        type: "cover_letter",
        label: "Cover letter",
        state: "failed",
        stateWord: "failed",
        meta: "Stopped after 1m 07s · attempt 2",
        detail: "The drafting worker stopped responding before the letter was written. Nothing was saved.",
        actions: [
          { label: "Try again", action: "materials-retry", feature: "cover_letter", primary: true },
          { label: "Dismiss", action: "materials-dismiss", feature: "cover_letter" },
        ],
      };
    } else {
      letter = {
        type: "cover_letter",
        label: "Cover letter",
        state: "missing",
        stateWord: "not drafted",
        meta: "Never requested",
        actions: [{ label: "Draft", action: "resume-cover", primary: true }],
      };
    }

    return [
      resume,
      letter,
      {
        type: "manual_apply_checklist",
        label: "Manual-apply checklist",
        state: "missing",
        stateWord: "not drafted",
        meta: "Written with the resume",
        actions: [],
      },
      {
        type: "qa_report",
        label: "QA report",
        state: "missing",
        stateWord: "not drafted",
        meta: "Written with the resume",
        actions: [],
      },
    ];
  }

  /* --------------- verdict line ---------------
     Three slots — STANDING, GAP, NEXT — assembled from data the model
     already carries. See ../SPEC.md §4 for the derivation table. */
  function verdict(variant) {
    if (variant === "loading") {
      return "<b>Reading the posting.</b> The fit read and the requirement list land in a few seconds.";
    }
    if (variant === "no-resume") {
      return "<b>Fit 6 of 10</b> on your agent's score alone. "
        + "<em>Add a resume to see which of the eight requirements you actually answer.</em>";
    }
    if (variant === "enrich-error") {
      return "<b>Fit 6 of 10.</b> <em>The posting could not be read, so everything below the fold is the sheet's own data.</em>";
    }
    if (variant === "terminal") {
      return "<b>Rejected 2026-09-14</b>, twelve days after applying. "
        + "The resume and letter are still on file if a similar role opens.";
    }
    if (variant === "materials-drafting") {
      return "<b>Solid fit</b> — 6 of 8 requirements matched, 4 keywords missing. "
        + "<em>The cover letter is being written now.</em> Closes in 14 days.";
    }
    if (variant === "materials-failed") {
      return "<b>Solid fit</b> — 6 of 8 requirements matched, 4 keywords missing. "
        + "<em>The cover letter failed twice; the resume is ready.</em> Closes in 14 days.";
    }
    return "<b>Solid fit</b> — 6 of 8 requirements matched, 4 keywords missing. "
      + "<em>Resume is ready; the cover letter has not been drafted.</em> Closes in 14 days.";
  }

  /* --------------- metrics --------------- */
  function metrics(variant) {
    var out = [{ k: "Fit", v: "6", unit: "/10", sub: "Your agent's score", src: "sheet" }];
    if (variant !== "no-resume" && variant !== "enrich-error") {
      out.push({
        k: "Resume score", v: "74", unit: "/100",
        sub: "How well your draft answers this posting", src: "ai",
      });
      out.push({
        k: "Keywords", v: "58", unit: "%",
        sub: "6 found · 2 partial · 4 missing", src: "derived",
        action: "open-profile-match",
      });
    }
    var mat = variant === "materials-drafting"
      ? { k: "Materials", v: "1", unit: "/4", sub: "1 drafting now", src: "files" }
      : (variant === "materials-failed"
        ? { k: "Materials", v: "1", unit: "/4", sub: "1 failed", src: "files" }
        : { k: "Materials", v: "1", unit: "/4", sub: "1 of 4 ready", src: "files" });
    out.push(mat);
    return out;
  }

  /* --------------- assembly --------------- */
  function model(variant) {
    var v = variant || "filled";

    var actions = [
      { label: "Draft cover letter", action: "resume-cover", primary: true },
      { label: "Tailor resume", action: "resume-tailor" },
    ];
    /* A run in flight replaces the request button: the in-flight chip is the
       control, so the same request cannot be issued twice from one surface. */
    if (v === "materials-drafting" || v === "materials-failed") {
      actions = actions.slice(1);
    }
    if (v === "terminal") actions = [];

    var inflight = null;
    if (v === "materials-drafting") inflight = { text: "Drafting cover letter · 1m 07s" };
    if (v === "materials-failed") inflight = { text: "Cover letter failed · retry", failed: true };

    var banner = null;
    if (v === "needs-review") {
      banner = {
        tone: "warn",
        k: "Unverified",
        text: "This posting's fields had to be recovered from a malformed model reply. "
          + "Read the requirements against the posting itself before you rely on them.",
        actions: [
          { label: "Open the posting", action: "brief-view-posting" },
          { label: "Re-read the posting", action: "enrich-retry" },
        ],
      };
    }
    if (v === "enrich-error") {
      banner = {
        tone: "error",
        k: "Could not read the posting",
        text: "Greenhouse returned 403 to the scraper, so there is no requirement list, "
          + "no one-line summary and no keyword match for this role. "
          + "Paste the description and everything below fills in.",
        actions: [
          { label: "Paste the description", action: "jd-paste" },
          { label: "Try the scrape again", action: "enrich-retry" },
        ],
      };
    }

    var youHave;
    if (v === "no-resume") {
      youHave = {
        tag: "",
        invite: {
          text: "No resume on file, so nothing here is matched yet. Add one and this section fills in "
            + "with your strengths, the gaps worth closing, and a per-requirement read.",
          action: "resume-tailor",
          label: "Add a resume",
        },
      };
    } else if (v === "loading" || v === "enrich-error") {
      youHave = null;
    } else {
      youHave = {
        tag: "<span class=\"dossier__src dossier__src--ai\" aria-hidden=\"true\">written by ai</span>",
        strengths: STRENGTHS,
        evidence: EVIDENCE,
        gaps: GAPS,
        dimensions: DIMENSIONS,
        storedAt: "2026-09-16",
      };
    }

    return {
      identity: {
        postingHref: "https://boards.greenhouse.io/3e/jobs/4416622007",
        title: v === "long-title" ? LONG_TITLE : "AI & Marketing Analytics Manager",
        company: v === "long-title" ? "Fanatics Betting & Gaming" : "3E",
        facts: [
          { k: "Where", v: "Anywhere" },
          { k: "Type", v: "Full-time" },
          { k: "Pay", v: "$165k – $195k" },
          { k: "Via", v: "Google Jobs" },
          { k: "Found", v: "2026-09-17" },
          { k: "Posted", v: "2026-09-02" },
          { k: "Priority", v: "High", flag: true },
        ],
      },
      flags: v === "terminal"
        ? [{ tone: "alarm", dot: "crimson", text: "Rejected 2026-09-14" }]
        : [
          { tone: "due", dot: "amber", text: "Follow-up in 7 days" },
          { tone: "due", dot: "amber", text: "Closes in 14 days" },
          { tone: "open", dot: "mint", text: "Posting open" },
        ],
      verdict: verdict(v),
      metrics: metrics(v),
      stage: v === "terminal"
        ? { current: "rejected", terminal: true, terminalLabel: "Rejected · applied 2026-09-02", order: STAGE_ORDER }
        : { current: "researching", terminal: false, daysInStage: 3, order: STAGE_ORDER },
      actions: actions,
      inflight: inflight,
      banner: banner,
      canvas: {
        loading: v === "loading",
        lede: (v === "loading" || v === "enrich-error")
          ? ""
          : "Own the measurement story for a consumer subscription brand, from media mix to lifecycle, "
            + "with a mandate to bring LLM-assisted analysis into the team's daily work.",
        hasMatch: v !== "no-resume",
        needsReview: v === "needs-review",
        requirements: (v === "loading" || v === "enrich-error")
          ? []
          : mark(REQUIREMENTS).map(function (r) {
            return v === "no-resume" ? { text: r.text, status: "unknown" } : r;
          }),
        niceToHaves: (v === "loading" || v === "enrich-error") ? [] : mark(NICE_TO_HAVES),
        stack: (v === "loading" || v === "enrich-error") ? [] : mark(STACK),
        youHave: youHave,
        points: (v === "loading" || v === "enrich-error") ? [] : POINTS,
        notes: "Reposted twice since July — ask why. Dana said the panel is the CMO plus two analytics leads.",
      },
      ledger: {
        docs: docs(v),
        people: {
          nextMove: v === "terminal"
            ? "Nothing owed. Dana said they went internal."
            : "Follow up with Dana on 2026-09-24 — she has not replied since the 15th.",
          contact: "Dana Whitfield (Talent Partner)",
          lastContactAt: "2026-09-15",
          replied: "Unknown",
          followUpAt: "2026-09-24",
        },
        record: RECORD,
        freshness: "Posting last fetched 3h ago",
      },
    };
  }

  root.JobBoredDossierMockData = { model: model };
})(typeof window !== "undefined" ? window : globalThis);
