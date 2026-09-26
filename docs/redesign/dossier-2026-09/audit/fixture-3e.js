/* ============================================================
   fixture-3e.js — audit fixture for the dossier overflow probe.
   ------------------------------------------------------------
   One realistic role, at realistic content lengths. The probe's whole
   claim is "the shipped layout cannot hold real content", so the fixture
   must not be a short-string caricature: requirement lines, evidence
   snippets and progress messages here are the lengths a Greenhouse /
   Google Jobs posting and a Hermes drafting run actually produce.

   Role: 3E · AI & Marketing Analytics Manager (the role in the dogfood
   report, read off the pipeline screenshot dated 2026-09-17).

   Variants, selected with ?variant= on the probe URL:
     default            filled role, materials ready + one failure
     materials-drafting a cover-letter run in flight
     materials-failed   the state in the dogfood screenshot
     long-title         a real long posting title, for masthead measurement
     loading            enrichment in flight
     no-resume          no keyword data and no scorecard
   ============================================================ */
(function (root) {
  "use strict";

  function param(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(root.location.search);
    return m ? decodeURIComponent(m[1]) : "";
  }
  var VARIANT = param("variant") || "default";

  var LONG_TITLE = "Senior Marketing Manager, Digital Brand Media (US Remote)";

  /* Requirements as a posting writes them, not as a design mock wishes they
     were. Six of the eight run past 40 characters; two run past 90. */
  var REQUIREMENTS = [
    "5+ years owning marketing analytics for a consumer subscription business",
    "Expert SQL and hands-on experience modelling in dbt or an equivalent transformation layer",
    "Demonstrated ownership of incrementality testing and media mix modelling",
    "Fluency with LLM-assisted analysis workflows and prompt evaluation",
    "Experience partnering with brand and lifecycle teams on measurement strategy",
    "Comfort presenting to a CMO and defending methodology",
    "Python for analysis and light production work",
    "Bachelor's degree or equivalent practical experience",
  ];
  var NICE_TO_HAVES = [
    "Experience in a marketplace or two-sided business",
    "Prior work standing up a customer data platform",
    "Familiarity with privacy-safe measurement after ATT",
  ];
  var STACK = [
    "SQL", "dbt", "Snowflake", "Python", "Looker", "Amplitude",
    "GA4", "Braze", "Databricks", "Airflow", "Fivetran", "Hex",
  ];
  var TALKING_POINTS = [
    "Lead with the incrementality program: you rebuilt the holdout design and the CAC read moved 14 points.",
    "Name the LLM evaluation harness you shipped — this posting asks for prompt evaluation and almost nobody has it.",
    "They ask about defending methodology to a CMO. Use the pricing-test story where you overruled the agency.",
    "Ask what happened to the last person in the seat; the posting has been reposted twice.",
  ];

  var KEYWORD_TERMS = [
    { label: "SQL", status: "found" },
    { label: "dbt", status: "found" },
    { label: "Python", status: "found" },
    { label: "media mix modelling", status: "found" },
    { label: "incrementality testing", status: "found" },
    { label: "Looker", status: "partial" },
    { label: "Amplitude", status: "partial" },
    { label: "Snowflake", status: "found" },
    { label: "Braze", status: "missing" },
    { label: "Databricks", status: "missing" },
    { label: "customer data platform", status: "missing" },
    { label: "privacy-safe measurement", status: "missing" },
  ];

  function keywords() {
    if (VARIANT === "no-resume") return null;
    return {
      uniqueTerms: KEYWORD_TERMS,
      percentage: 58,
      foundCount: 6,
      partialCount: 2,
      missingTerms: KEYWORD_TERMS.filter(function (t) { return t.status === "missing"; }),
    };
  }

  function scorecard() {
    if (VARIANT === "no-resume") return null;
    return {
      storedAt: "2026-09-16T22:04:11.000Z",
      result: {
        overallScore: 74,
        topStrengths: [
          "Six years of subscription marketing analytics maps directly onto the ownership this posting describes.",
          "The incrementality and media-mix work is the exact measurement stack they name first.",
          "You have shipped LLM-assisted analysis in production, which the posting treats as a differentiator.",
        ],
        evidence: [
          {
            claim: "Owned incrementality testing end to end",
            sourceSnippet: "Rebuilt the geo-holdout design across nine markets and cut blended CAC 14% in two quarters, presenting the methodology to the CMO monthly.",
            sourceType: "resume",
          },
          {
            claim: "Production LLM evaluation experience",
            sourceSnippet: "Built the prompt-evaluation harness that gated every customer-facing model change, with a labelled regression set of 1,200 cases.",
            sourceType: "work sample",
          },
        ],
        criticalGaps: [
          {
            gap: "No named customer data platform implementation",
            whyItMatters: "They list standing up a CDP as a nice-to-have and the team is mid-migration, so it will come up in the second round.",
            severity: "medium",
          },
          {
            gap: "Braze and Databricks are absent from your materials",
            whyItMatters: "Both are named in the stack paragraph; the resume screen is keyword-driven at this company.",
            severity: "high",
          },
          {
            gap: "No post-ATT privacy-safe measurement work",
            whyItMatters: "Consumer subscription measurement lives or dies on this now.",
            severity: "medium",
          },
        ],
        dimensionScores: {
          requirementsCoverage: 78,
          experienceRelevance: 84,
          impactClarity: 71,
          atsParseability: 66,
          toneFit: 69,
        },
      },
    };
  }

  function job() {
    var enrichment = {
      status: VARIANT === "loading" ? "loading" : "ready",
      enrichedAt: Date.parse("2026-09-17T14:12:00.000Z"),
      parseMode: "schema",
      roleInOneLine: "Own the measurement story for a consumer subscription brand, from media mix to lifecycle, with a mandate to bring LLM-assisted analysis into the team's daily work.",
      mustHaves: REQUIREMENTS,
      niceToHaves: NICE_TO_HAVES,
      toolsAndStack: STACK,
      talkingPoints: TALKING_POINTS,
    };
    if (VARIANT === "loading") {
      enrichment.mustHaves = [];
      enrichment.niceToHaves = [];
      enrichment.toolsAndStack = [];
      enrichment.roleInOneLine = "";
    }
    return {
      jobKey: "3e--ai-marketing-analytics-manager",
      role: VARIANT === "long-title" ? LONG_TITLE : "AI & Marketing Analytics Manager",
      company: VARIANT === "long-title" ? "Fanatics Betting & Gaming" : "3E",
      location: "Anywhere",
      employment: "Full-time",
      salary: "",
      postingSalary: "$165,000 – $195,000",
      source: "Google Jobs (SerpApi)",
      links: [{ href: "https://boards.greenhouse.io/3e/jobs/4416622007" }],
      logoUrl: "",
      foundAt: "2026-09-17",
      postedAt: "2026-09-02",
      closesAt: "2026-10-01",
      priority: "high",
      favorite: true,
      stage: "researching",
      daysInStage: 3,
      appliedAt: "",
      followUpDate: "2026-09-24",
      replied: "Unknown",
      lastHeardFrom: "2026-09-15",
      contacts: [{ name: "Dana Whitfield (Talent Partner)" }],
      fitScore: 6,
      requirements: [],
      skills: [],
      tags: [],
      enrichment: enrichment,
      notes: {
        body: "Reposted twice since July — ask why. Dana said the panel is the CMO plus two analytics leads.",
        editedAt: "2026-09-16",
      },
    };
  }

  /* The manifest shapes role-materials.js reads: documents[] for what exists,
     pending{feature,progress} for a run in flight. */
  function manifest() {
    var docs = [
      {
        type: "resume",
        status: "ready",
        lastModifiedAt: "2026-09-16T21:40:00.000Z",
        primary: "resume.pdf",
        files: [
          { filename: "resume.pdf", size: 184320, format: "pdf" },
          { filename: "resume.html", size: 61440, format: "html" },
        ],
      },
    ];
    if (VARIANT === "materials-drafting") {
      return {
        slug: "3e-ai-marketing-analytics-manager",
        documents: docs,
        pending: {
          feature: "cover_letter",
          progress: {
            phase: "drafting",
            elapsedSeconds: 67,
            attempt: 1,
            startedAt: new Date(Date.now() - 67000).toISOString(),
            message: "Reading the posting and your work samples to find the opening line.",
          },
        },
        quality: { documents: {} },
      };
    }
    if (VARIANT === "materials-failed" || VARIANT === "default") {
      return {
        slug: "3e-ai-marketing-analytics-manager",
        documents: docs,
        pending: {
          feature: "cover_letter",
          progress: {
            phase: "failed",
            elapsedSeconds: 67,
            attempt: 2,
            startedAt: new Date(Date.now() - 67000).toISOString(),
            message: "The drafting worker stopped responding before the letter was written.",
          },
        },
        quality: { documents: {} },
      };
    }
    return { slug: "3e-ai-marketing-analytics-manager", documents: docs, pending: null, quality: { documents: {} } };
  }

  function deps() {
    return {
      vm: { job: job() },
      job: job(),
      keywords: keywords(),
      scorecard: scorecard(),
      manifest: manifest(),
      materialsError: "",
      health: {
        state: "open",
        label: "Posting open",
        detail: "",
        checkedAt: "2026-09-17T09:02:00.000Z",
      },
      stages: root.JobBoredStages,
      provenance: root.JobBoredDossierProvenance,
      providerLabel: "OpenRouter",
      nowMs: Date.parse("2026-09-17T17:00:00.000Z"),
      parseDate: function (s) { var t = Date.parse(String(s || "")); return Number.isFinite(t) ? t : null; },
      keywordsPending: false,
      materialsPending: false,
    };
  }

  /* --------------------------------------------------------------------
     Materials rows, transcribed from role-materials.js renderCaseRows().
     role-materials.js cannot boot in the probe (it needs the profile API,
     the manifest poller and a live base URL), so the probe mounts the same
     markup that function emits. Shape is copied; state comes from the
     fixture above.
     -------------------------------------------------------------------- */
  var CASE_DOC_TYPES = [
    { type: "resume", label: "Tailored resume", draftAction: "resume-tailor" },
    { type: "cover_letter", label: "Cover letter", draftAction: "resume-cover" },
    { type: "manual_apply_checklist", label: "Manual-apply checklist", draftAction: "" },
    { type: "qa_report", label: "QA report", draftAction: "" },
  ];

  function esc(s) { return root.JobBoredText.escapeHtml(String(s == null ? "" : s)); }

  function materialsRowsHtml() {
    var man = manifest();
    var docs = man.documents || [];
    var pending = man.pending && man.pending.feature ? man.pending : null;
    var pendingFeature = pending ? String(pending.feature || "") : "";
    var prog = pending && pending.progress ? pending.progress : null;

    var rows = CASE_DOC_TYPES.map(function (def) {
      var doc = docs.filter(function (d) { return d.type === def.type; })[0] || null;
      var phase = pendingFeature === def.type && prog ? String(prog.phase || "queued") : "";
      var isPending = !!phase && !/^(complete|done|failed)$/i.test(phase);
      var status = isPending
        ? "drafting"
        : (/^failed$/i.test(phase)
          ? "failed"
          : (doc ? (String(doc.status).toLowerCase() === "ready" ? "ready" : "failed") : "missing"));

      var sub = isPending
        ? (/^queued$/i.test(phase) ? "waiting in queue" : "drafting") + " · 1m 07s"
          + (Number(prog.attempt) > 1 ? " · retry " + prog.attempt : "")
        : (doc && doc.lastModifiedAt
          ? String(doc.lastModifiedAt).slice(0, 10)
          : (status === "missing" ? "not drafted" : ""));

      var progressHtml = "";
      if (isPending) {
        progressHtml = '<span class="case__doc-progress" data-phase="' + esc(phase) + '" aria-live="polite">'
          + '<span class="case__doc-eyebrow">'
          + (/^queued$/i.test(phase) ? "WAITING IN QUEUE" : "DRAFTING IN PROGRESS") + "</span>"
          + '<span class="case__doc-msg">' + esc(prog.message) + "</span>"
          + "</span>";
      }

      var actions = [];
      if (status === "ready") {
        actions = [
          '<a class="case__doc-btn case__doc-btn--primary" data-action="materials-preview" href="#">Preview</a>',
          '<a class="case__doc-btn case__doc-btn--ghost" data-action="materials-download" href="#">Download PDF</a>',
        ];
      } else if (status === "missing" && def.draftAction) {
        actions = ['<button type="button" class="case__doc-btn case__doc-btn--primary" data-action="'
          + esc(def.draftAction) + '">Draft</button>'];
      } else if (status === "failed" && pendingFeature) {
        actions = [
          '<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-dismiss"'
          + ' data-feature="' + esc(pendingFeature) + '">Dismiss</button>',
          '<button type="button" class="case__doc-btn case__doc-btn--primary" data-action="materials-retry"'
          + ' data-feature="' + esc(pendingFeature) + '">Try again</button>',
        ];
      }

      return '<div class="case__doc" data-doc="' + esc(def.type) + '">'
        + '<div class="case__doc-n"><span class="case__doc-label">' + esc(def.label) + "</span>"
          + (sub ? "<small>" + esc(sub) + "</small>" : "")
          + progressHtml
        + "</div>"
        + '<span class="case__docst case__docst--' + status + '">'
          + esc(status === "failed" ? "couldn't finish" : status) + "</span>"
        + '<div class="case__doc-actions">' + actions.join("") + "</div>"
      + "</div>";
    }).join("");

    return '<section class="brief-materials brief-materials--rows" aria-label="Application materials"'
      + ' data-slug="' + esc(man.slug) + '">' + rows + "</section>";
  }

  root.JobBoredAuditFixture = {
    variant: VARIANT,
    deps: deps,
    materialsRowsHtml: materialsRowsHtml,
  };
})(typeof window !== "undefined" ? window : globalThis);
