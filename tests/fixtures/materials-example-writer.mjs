/**
 * A neutral example candidate for the template registry: a writer JSON in
 * today's v2 shape, the resume text it was drafted from, and two resolver-
 * style marks. No real person: "Alex Rivera", user@example.com, 555 numbers.
 * Used by the adapter, drafter and regenerate tests, and by the per-family
 * sample renders, so no default render carries a real identity.
 */

const wordmarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="100" viewBox="0 0 480 100"><rect width="480" height="100" fill="#ffffff"/><circle cx="50" cy="50" r="34" fill="#1f6feb"/><text x="100" y="66" font-family="Arial, sans-serif" font-size="52" font-weight="700" fill="#0b2e59">Northwind</text></svg>`;
const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#0f766e"/><text x="50" y="66" text-anchor="middle" font-family="Arial, sans-serif" font-size="46" font-weight="700" fill="#ffffff">CL</text></svg>`;

/** @param {string} svg */
function dataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export const EXAMPLE_MARKS = [
  { slug: "northwind-logistics", label: "Northwind Logistics", src: dataUri(wordmarkSvg), alt: "Northwind Logistics logo", shape: "wordmark", source: "upload" },
  { slug: "contoso-labs", label: "Contoso Labs", src: dataUri(markSvg), alt: "Contoso Labs logo", shape: "mark", source: "upload" },
];

export const EXAMPLE_RESUME_TEXT = [
  "Alex Rivera",
  "Austin, TX | 555-010-4477 | user@example.com | linkedin.com/in/alex-rivera-example",
  "",
  "Operations analytics lead who turns carrier and warehouse data into decisions.",
  "",
  "Northwind Logistics, Senior Operations Analyst, 2021-2025, Austin, TX",
  "- Cut late shipments 18% by rebuilding the carrier scorecard around on-time pickup.",
  "- Owned a $4.2M freight budget and moved 30% of lanes to better-rated carriers.",
  "- Built the weekly network readout that 12 regional managers use to plan capacity.",
  "- Automated 9 recurring reports with SQL and Python, saving about 20 hours a week.",
  "",
  "Contoso Labs, Data Analyst, 2018-2021, Remote",
  "- Modeled demand for 140 SKUs and cut stockouts 25% across three warehouses.",
  "- Shipped a Looker dashboard used by 60 people in sales and supply.",
  "- Ran the vendor data audit that removed 2,400 duplicate records.",
  "",
  "Fabrikam Freight, Operations Coordinator, 2016-2018, Dallas, TX",
  "- Scheduled 45 daily pickups and resolved carrier exceptions.",
  "",
  "Education",
  "B.S. Industrial Engineering, Example State University, 2016",
  "",
  "Skills",
  "SQL, Python, Looker, Tableau, forecasting, carrier management, Excel, dbt",
].join("\n");

export const EXAMPLE_WRITER_JSON = {
  letter: {
    date: "September 25, 2026",
    company: "Acme Robotics",
    companyAddr: "Pittsburgh, PA",
    role: "Operations Analytics Manager",
    hiringManager: "",
    hook: "You are hiring someone to make a growing fulfillment network explain itself every Monday, and that is the job I have been doing for four years.",
    whyThem: "Acme Robotics is scaling from two warehouses to five, and the posting is clear that the analytics function has to keep up with the floor instead of reporting on it after the fact. That is the moment where a scorecard either earns trust or gets ignored.",
    whyMe: "At Northwind Logistics I rebuilt the carrier scorecard around on-time pickup and cut late shipments 18%. I owned a $4.2M freight budget and moved 30% of lanes to better-rated carriers, and the weekly network readout I built is what 12 regional managers now plan capacity from.",
    whyNow: "Before that, at Contoso Labs, I modeled demand for 140 SKUs and cut stockouts 25% across three warehouses, so I know what a forecast has to look like before a floor manager will act on it.",
    closing: "I would start by sitting with one shift lead and tracing a single late order from the scan to the report someone acts on. I would be glad to walk you through the scorecard and the readout.",
    flourish: "",
  },
  resume: {
    header: {
      name: "Alex Rivera",
      headline: "Operations Analytics Manager",
      contact: ["Austin, TX", "555-010-4477", "user@example.com", "linkedin.com/in/alex-rivera-example"],
    },
    summary: {
      opener: "Operations analytics lead who makes a fulfillment network explain itself.",
      body: "Four years turning carrier and warehouse data into weekly decisions, with an 18% cut in late shipments and a readout 12 regional managers plan from.",
    },
    roles: [
      {
        id: "northwind-logistics",
        company: "Northwind Logistics",
        title: "Senior Operations Analyst",
        dates: "2021 – 2025",
        location: "Austin, TX",
        bullets: [
          "Cut late shipments 18% by rebuilding the carrier scorecard around on-time pickup.",
          "Owned a $4.2M freight budget and moved 30% of lanes to better-rated carriers.",
          "Built the weekly network readout that 12 regional managers use to plan capacity.",
          "Automated 9 recurring reports with SQL and Python, saving about 20 hours a week.",
        ],
      },
      {
        id: "contoso-labs",
        company: "Contoso Labs",
        title: "Data Analyst",
        dates: "2018 – 2021",
        location: "Remote",
        bullets: [
          "Modeled demand for 140 SKUs and cut stockouts 25% across three warehouses.",
          "Shipped a Looker dashboard used by 60 people in sales and supply.",
          "Ran the vendor data audit that removed 2,400 duplicate records.",
        ],
      },
      {
        id: "fabrikam-freight",
        company: "Fabrikam Freight",
        title: "Operations Coordinator",
        dates: "2016 – 2018",
        location: "Dallas, TX",
        bullets: ["Scheduled 45 daily pickups and resolved carrier exceptions."],
      },
    ],
    education: ["B.S. Industrial Engineering, Example State University, 2016"],
    skills: ["SQL", "Python", "Looker", "Tableau", "forecasting", "carrier management", "Excel", "dbt"],
  },
};

export const EXAMPLE_RESUME_SOURCE = {
  source: "portfolio",
  filename: "alex-rivera.pdf",
  addedAt: "2026-09-20T15:00:00.000Z",
  text: EXAMPLE_RESUME_TEXT,
};
