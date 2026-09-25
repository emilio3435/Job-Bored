const DUPLICATED_TALKING_POINT =
  "Lead with AI systems experience — multi-model routing, RAG, GCP deploy";

const REQUIREMENTS = [
  "Set the enterprise lifecycle marketing and CRM strategy across the customer journey",
  "Own acquisition, activation, retention, loyalty, and win-back performance",
  "Build a concise performance narrative. Automation & Technology",
  "Create a durable capability edge. Customer Intelligence & CDP",
  "Lead the loyalty program roadmap across digital and store experiences",
  "Deliver profitable growth with direct P&L accountability",
  "Translate customer intelligence into prioritized audience strategies",
  "Design automated journeys that improve relevance and conversion",
  "Partner with executive leadership on annual and quarterly planning",
  "Build a measurement framework for incremental revenue and lifetime value",
  "Manage agency, platform, and media budgets against clear outcomes",
  "Lead cross-functional work with product, analytics, creative, and operations",
  "Own retention forecasting and surface risks before targets move",
  "Establish an experimentation roadmap across channels and customer segments",
  "Build segmentation that reflects behavior, value, and lifecycle stage",
  "Guide marketing technology architecture and vendor selection",
  "Measure CAC, repeat rate, churn, and customer lifetime value",
  "Develop executive-ready narratives from complex performance data",
  "Recruit, coach, and retain a high-performing lifecycle team",
  "Align campaigns with merchandising, inventory, and store operations",
  "Design a CDP activation model with reliable identity resolution",
  "Use predictive models to improve offer and message selection",
  "Communicate tradeoffs clearly to technical and non-technical partners",
  "Ensure consent, privacy, and preference controls across every channel",
  "Apply [<|\"|>AI integrations to accelerate testing without weakening review",
];

const STACK = [
  "Salesforce Marketing Cloud",
  "Braze Canvas",
  "Segment CDP",
  "Snowflake Data Cloud",
  "Tableau dashboards",
  "Looker Studio",
  "Amplitude Analytics",
  "Optimizely Web Experimentation",
  "Google Analytics 4",
  "Structured Query Language",
  "Python",
  "JavaScript",
  "API",
  "APIs",
  "AI",
  "AI integrations",
  "Customer.io",
  "Iterable Journeys",
  "Twilio Segment",
  "CDP",
  "SMS",
];

export const REAL_SHAPE_ENRICHMENT = {
  roleInOneLine:
    "Turn customer intelligence into profitable lifecycle growth across every channel.",
  description: REQUIREMENTS.join("\n"),
  postingSummary:
    "CSC Generation is hiring a lifecycle leader to own CRM, loyalty, automation, and customer intelligence.",
  fitAngle:
    "Lead with enterprise lifecycle systems and connect the operating model to measurable growth.",
  requirements: REQUIREMENTS,
  // The card transport caps each array at 16. Carrying the final nine here
  // lets the real browser path reconstruct all 25 without changing app code.
  mustHaves: REQUIREMENTS.slice(16),
  niceToHaves: [
    "Retail or direct-to-consumer operating experience",
    "Experience integrating acquired brands onto a shared lifecycle platform",
    "Familiarity with loyalty economics and member benefit design",
  ],
  toolsAndStack: STACK,
  // The same transport cap applies to stack arrays. These five restore the
  // tail after model dedupe, keeping the browser fixture at the real 21 items.
  skills: STACK.slice(16),
  talkingPoints: [],
  scrapedAt: "2026-09-03T04:30:00.000Z",
  method: "ats-api",
  _parseMode: "schema",
};

export const REAL_SHAPE_SCORECARD = {
  overallScore: 78,
  topStrengths: [
    "P&L management)",
    "CRM",
    "AI",
    "API",
    "APIs",
    "AI integrations",
    "Led enterprise lifecycle marketing transformations",
  ],
  evidence: [
    {
      claim: "Lifecycle ownership",
      sourceSnippet:
        "Led acquisition, retention, and loyalty programs across a multi-brand portfolio.",
      sourceType: "resume",
    },
    {
      claim: "Customer intelligence",
      sourceSnippet:
        "Built behavioral segments that increased repeat purchase rate across digital channels.",
      sourceType: "resume",
    },
    {
      claim: "Marketing technology",
      sourceSnippet:
        "Integrated CRM, warehouse, and experimentation systems into one operating cadence.",
      sourceType: "resume",
    },
  ],
  criticalGaps: [
    {
      gap: "Proven omni-channel acumen (eCommerce, physical retail, and experiential…",
      whyItMatters: "The posting makes channel breadth a core leadership expectation.",
      severity: "high",
    },
    {
      gap: "Proven omni-channel acumen (eCommerce",
      whyItMatters: "This is a truncated duplicate of the same gap.",
      severity: "high",
    },
    {
      gap: "experiential)",
      whyItMatters: "This is the orphaned tail of the same gap.",
      severity: "high",
    },
    {
      gap: "Direct ownership of loyalty program economics",
      whyItMatters: "The role owns the loyalty roadmap and its financial return.",
      severity: "medium",
    },
    {
      gap: "Recent retail store operations partnership",
      whyItMatters: "Campaign plans must align with store inventory and operations.",
      severity: "low",
    },
  ],
  dimensionScores: {
    requirementsCoverage: 76,
    experienceRelevance: 82,
    impactClarity: 74,
    atsParseability: 90,
    toneFit: 84,
  },
  confidence: 0.86,
  model: "fixture/real-shape-v1",
};

function parsedJob(overrides) {
  return {
    title: "Director, Lifecycle Marketing & CRM",
    company: "CSC Generation",
    location: "Chicago, IL",
    link: "https://jobs.csc-generation.test/director-lifecycle-marketing-crm",
    source: "Ashby",
    salary: "$190–230k",
    fitScore: 8,
    priority: "⚡",
    tags: "Lifecycle Marketing, Loyalty",
    fitAssessment: "Strong fit for enterprise lifecycle and CRM leadership.",
    contact: "",
    status: "Researching",
    appliedDate: "",
    notes: "",
    followUpDate: "",
    talkingPoints: DUPLICATED_TALKING_POINT,
    lastHeardFrom: "",
    responseFlag: "Unknown",
    logoUrl: "",
    matchScore: 78,
    favorite: true,
    dateFoundRaw: "2026-09-03",
    _postingEnrichment: REAL_SHAPE_ENRICHMENT,
    ...overrides,
  };
}

export const REAL_SHAPE_PIPELINE_JOBS = [
  parsedJob(),
  parsedJob({
    title: "VP, Growth Marketing",
    company: "Northstar Retail",
    location: "New York, NY",
    link: "https://jobs.northstar-retail.test/vp-growth-marketing",
    fitScore: 7,
    tags: "Growth Marketing",
    fitAssessment: "Adjacent growth leadership role.",
    dateFoundRaw: "2026-09-02",
    _postingEnrichment: null,
  }),
  parsedJob({
    title: "Enterprise Account Executive",
    company: "Figma",
    location: "Remote",
    link: "https://jobs.figma.test/enterprise-account-executive",
    fitScore: 6,
    tags: "Enterprise Sales",
    fitAssessment: "Enterprise sales role with technical buyers.",
    dateFoundRaw: "2026-09-01",
    _postingEnrichment: null,
  }),
];

const PIPELINE_HEADERS = [
  "Date Found",
  "Title",
  "Company",
  "Location",
  "Link",
  "Source",
  "Salary",
  "Fit Score",
  "Priority",
  "Tags",
  "Fit Assessment",
  "Contact",
  "Status",
  "Applied Date",
  "Notes",
  "Follow-up Date",
  "Talking Points",
  "Last contact",
  "Did they reply?",
  "Logo URL",
  "Match Score",
  "Favorite",
  "Dismissed At",
  "Approval Status",
  "Edit Lock",
];

function rawSheetRow(job) {
  return [
    job.dateFoundRaw,
    job.title,
    job.company,
    job.location,
    job.link,
    job.source,
    job.salary,
    String(job.fitScore),
    job.priority,
    job.tags,
    job.fitAssessment,
    job.contact,
    job.status,
    job.appliedDate,
    job.notes,
    job.followUpDate,
    job.talkingPoints,
    job.lastHeardFrom,
    job.responseFlag,
    job.logoUrl,
    String(job.matchScore),
    job.favorite ? "TRUE" : "",
    "",
    "",
    "",
  ];
}

export const REAL_SHAPE_PIPELINE_RAW_ROWS = [
  PIPELINE_HEADERS,
  ...REAL_SHAPE_PIPELINE_JOBS.map(rawSheetRow),
];

export { DUPLICATED_TALKING_POINT as REAL_SHAPE_DUPLICATED_TALKING_POINT };
