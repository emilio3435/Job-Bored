/*
 * Hand-written fictional model replies for downstream ledger tests. These
 * expected structures are independent of the resume rules parser; the real
 * quote validator still runs when modelStructureFixture builds a structure.
 */
import { validateModelStructure } from "../../server/materials-resume-structure-model.mjs";

/** @param {string} text */
function claim(text) {
  return { text, sourceQuote: text };
}

/** @param {string} title @param {string} quote @param {string|null} start @param {string|null} end @param {Array<{text:string,sourceQuote:string}>} [claims] @param {string} [dateQuote] */
function role(title, quote, start = null, end = null, claims = [], dateQuote = quote) {
  return {
    title,
    sourceQuote: quote,
    start,
    startSourceQuote: start ? dateQuote : null,
    end,
    endSourceQuote: end ? dateQuote : null,
    claims,
  };
}

/** @param {string} name @param {string} quote @param {Array<Record<string, unknown>>} roles @param {Array<{text:string,sourceQuote:string}>} [claims] @param {string|null} [start] @param {string|null} [end] @param {string} [dateQuote] */
function employer(name, quote, roles, claims = [], start = null, end = null, dateQuote = quote) {
  return {
    name,
    sourceQuote: quote,
    start,
    startSourceQuote: start ? dateQuote : null,
    end,
    endSourceQuote: end ? dateQuote : null,
    roles,
    claims,
  };
}

const resumeTextReply = {
  employers: [
    employer("Northwind", "Northwind — Digital Sales Manager, 2021–2026", [
      role("Digital Sales Manager", "Northwind — Digital Sales Manager, 2021–2026", "2021", "2026", [
        claim("Grew Austin to a top-3 national ranking on a $10M+ book."),
        claim("Drove 130% YoY paid-search conversion growth on a flagship account."),
        claim("Led the market to a 60% digital revenue mix across Google Ads and Meta."),
      ]),
    ], [], "2021", "2026"),
    employer("Example App", "Example App — Founder, 2024–present", [
      role("Founder", "Example App — Founder, 2024–present", "2024", "present", [
        claim("Shipped an SEM forecast tool on Gemini that ran 21+ forecasts against $2.4M of pipeline."),
        claim("Operate scheduled workflows across 8-10 API keys."),
      ]),
    ], [], "2024", "present"),
  ],
  looseClaims: [],
  education: [claim("B.S. Mathematics, Example State University")],
  credentials: [],
};

const digitalPipelineReply = {
  employers: [
    employer("Northwind", "Northwind — Digital Sales Manager, 2021–2026", [
      role("Digital Sales Manager", "Northwind — Digital Sales Manager, 2021–2026", "2021", "2026", [
        claim("Grew Austin to a top-3 national ranking on a $10M+ book"),
        claim("Drove 130% YoY paid-search conversion growth"),
      ]),
    ], [], "2021", "2026"),
    employer("Example App", "Example App — Founder, 2024–present", [
      role("Founder", "Example App — Founder, 2024–present", "2024", "present", [
        claim("Ran 21+ forecasts against $2.4M of pipeline."),
        claim("Built streaming ingestion for analytics events with Kafka and Postgres."),
      ]),
    ], [], "2024", "present"),
  ],
  looseClaims: [],
  education: [],
  credentials: [],
};

const digitalOutreachReply = {
  employers: [
    employer("Northwind", "Northwind — Digital Sales Manager, 2021–2026", [
      role("Digital Sales Manager", "Northwind — Digital Sales Manager, 2021–2026", "2021", "2026", [
        claim("Grew Austin to a top-3 national ranking on a $10M+ book with Google Ads."),
        claim("Drove 130% YoY paid-search conversion growth on a flagship account."),
        claim("Led the market to a 60% digital revenue mix with clear weekly readouts."),
      ]),
    ], [], "2021", "2026"),
    employer("Example App", "Example App — Founder, 2024–present", [
      role("Founder", "Example App — Founder, 2024–present", "2024", "present", [
        claim("Shipped an SEM forecast tool on Gemini that ran 21+ forecasts against $2.4M of pipeline."),
        claim("Built streaming ingestion for analytics events with Kafka and Postgres."),
      ]),
    ], [], "2024", "present"),
  ],
  looseClaims: [],
  education: [],
  credentials: [],
};

const customizerReply = {
  employers: [
    employer("Acme", "Acme — Digital Sales Manager, 2021–2026", [
      role("Digital Sales Manager", "Acme — Digital Sales Manager, 2021–2026", "2021", "2026", [
        claim("Became the market's go-to client-facing strategist, leading high-stakes pitches and QBRs for 20+ accounts."),
      ]),
    ], [], "2021", "2026"),
  ],
  looseClaims: [],
  education: [],
  credentials: [],
};

const metricReadoutReply = {
  employers: [
    employer("Northwind Studio", "Northwind Studio — Founder, 2023 – Present", [
      role("Founder", "Northwind Studio — Founder, 2023 – Present", "2023", "Present", [
        claim("Built a platform backed by Google Chirp 3 HD text-to-speech."),
        claim("Owned a $ 12 M + annual digital book with a top -4 ranking."),
      ]),
    ], [], "2023", "Present"),
  ],
  looseClaims: [],
  education: [],
  credentials: [],
};

const northwindOpsReply = {
  employers: [
    employer("Northwind Logistics", "Northwind Logistics — Operations Analyst, 2021–2025", [
      role("Operations Analyst", "Northwind Logistics — Operations Analyst, 2021–2025", "2021", "2025", [
        claim("Cut late shipments 18% by rebuilding the carrier scorecard."),
      ]),
    ], [], "2021", "2025"),
  ],
  looseClaims: [],
  education: [],
  credentials: [],
};

const bulletedUploadReply = {
  employers: [
    employer("Northwind Media (formerly Contoso Radio)", "Northwind Media (formerly Contoso Radio)", [
      role("Director, Digital Sales", "Director, Digital Sales, Northwind Media Jan 2022 – Present", "Jan 2022", "Present", [
        claim("Led digital strategy for a $12M annual book and kept Austin a top-5 national market in digital revenue for three straight years."),
        claim("Coached 8 account-executive desks through 25+ tracked pitches a month with weekly office hours and a quarterly contest calendar."),
        claim("Moved the market from a broadcast-first mix to 55% digital revenue while holding total revenue flat through a soft ad market."),
        claim("Launched a streaming-audio and CTV bundle that closed $1.4M in first-year bookings across 40 local advertisers."),
      ]),
      role("Senior Account Manager", "Account Manager → Senior Account Manager, Contoso Radio Mar 2019 – Dec 2021", "Mar 2019", "Dec 2021", [
        claim("Grew a strategic portfolio of 30 accounts by 22% year over year across SEM, paid social and OTT placements."),
        claim("Earned promotion to Senior Account Manager on account retention of 94% during the 2020 downturn."),
      ], "Mar 2019 – Dec 2021"),
      role("Digital Campaign Manager", "Digital Campaign Manager, Contoso Radio Sep 2016 – Feb 2019", "Sep 2016", "Feb 2019", [
        claim("Owned setup, trafficking and weekly reporting for 60+ concurrent search, social and programmatic campaigns."),
        claim("Cut average campaign launch time from 9 days to 4 by templating the trafficking checklist in Google Sheets."),
      ]),
    ], [], "Sep 2016", "Present", "Sep 2016 – Present"),
    employer("Example Labs", "Example Labs", [
      role("Founder", "Founder | Example Labs — Austin, TX 2023 – Present", "2023", "Present", [
        claim("Built a lead-scoring pipeline in Python on Cloud Run that ranks 2,000+ inbound leads a week for three agency clients."),
        claim("Shipped a forecasting assistant that ran 30+ pitch forecasts against $3.1M of open pipeline."),
      ], "Founder | Example Labs — Austin, TX 2023 – Present"),
    ], [], "2023", "Present", "Founder | Example Labs — Austin, TX 2023 – Present"),
  ],
  looseClaims: [claim("Revenue leader with ten years in digital media sales and a builder's habit of automating the work around the pitch.")],
  education: [claim("Bachelor of Science, Economics | Example State University — Austin, TX 2016")],
  credentials: [],
};

const profileRouteReply = {
  employers: [
    employer("Northwind", "Northwind — Manager, 2021-2026", [
      role("Manager", "Northwind — Manager, 2021-2026", "2021", "2026", [
        claim("Grew revenue 30% on a $2M book."),
      ]),
    ], [], "2021", "2026"),
  ],
  looseClaims: [],
  education: [],
  credentials: [],
};

const emptyExperienceReply = { employers: [], looseClaims: [], education: [], credentials: [] };

const pipelineReply = {
  employers: [
    employer("Northwind", "Northwind — Operations Analyst, 2021–2026", [
      role("Operations Analyst", "Northwind — Operations Analyst, 2021–2026", "2021", "2026", [
        claim("Built a route forecaster for 620 vans and reduced missed windows from 9.1% to 4.3%."),
        claim("Ran a weekly readout for 14 dispatch leads and 40 stores."),
      ]),
    ], [], "2021", "2026"),
    employer("RouteLab", "RouteLab — Founder, 2024–present", [
      role("Founder", "RouteLab — Founder, 2024–present", "2024", "present", [
        claim("Shipped a scheduling tool for 80 drivers using Postgres and Kafka."),
      ]),
    ], [], "2024", "present"),
  ],
  looseClaims: [],
  education: [],
  credentials: [],
};

const pipelineBudgetReply = {
  employers: [
    employer("Northwind", "Northwind — Operations Analyst, 2021–2026", [
      role("Operations Analyst", "Northwind — Operations Analyst, 2021–2026", "2021", "2026", [
        claim("Built a route forecaster for 620 vans across four regional depots."),
        claim("Ran weekly dispatch readouts for 14 leads and 40 stores."),
        claim("Shipped a Postgres scheduling data pipeline for 80 drivers."),
        claim("Reduced missed delivery windows by improving route alerts."),
        claim("Trained store leads to use the new delivery reliability dashboard."),
      ]),
    ], [], "2021", "2026"),
  ],
  looseClaims: [],
  education: [],
  credentials: [],
};

const exampleWriterReply = {
  employers: [
    employer("Northwind Logistics", "Northwind Logistics, Senior Operations Analyst, 2021-2025, Austin, TX", [
      role("Senior Operations Analyst", "Northwind Logistics, Senior Operations Analyst, 2021-2025, Austin, TX", "2021", "2025", [
        claim("Cut late shipments 18% by rebuilding the carrier scorecard around on-time pickup."),
        claim("Owned a $4.2M freight budget and moved 30% of lanes to better-rated carriers."),
        claim("Built the weekly network readout that 12 regional managers use to plan capacity."),
        claim("Automated 9 recurring reports with SQL and Python, saving about 20 hours a week."),
      ]),
    ], [], "2021", "2025"),
    employer("Contoso Labs", "Contoso Labs, Data Analyst, 2018-2021, Remote", [
      role("Data Analyst", "Contoso Labs, Data Analyst, 2018-2021, Remote", "2018", "2021", [
        claim("Modeled demand for 140 SKUs and cut stockouts 25% across three warehouses."),
        claim("Shipped a Looker dashboard used by 60 people in sales and supply."),
        claim("Ran the vendor data audit that removed 2,400 duplicate records."),
      ]),
    ], [], "2018", "2021"),
    employer("Fabrikam Freight", "Fabrikam Freight, Operations Coordinator, 2016-2018, Dallas, TX", [
      role("Operations Coordinator", "Fabrikam Freight, Operations Coordinator, 2016-2018, Dallas, TX", "2016", "2018", [
        claim("Scheduled 45 daily pickups and resolved carrier exceptions."),
      ]),
    ], [], "2016", "2018"),
  ],
  looseClaims: [claim("Operations analytics lead who turns carrier and warehouse data into decisions.")],
  education: [claim("B.S. Industrial Engineering, Example State University, 2016")],
  credentials: [],
};

const realshapeReply = {
  employers: [
    employer("Brightwave Media (formerly Tidewater Radio)", "Brightwave Media (formerly Tidewater Radio)", [
      role("Digital Sales Manager", "Digital Sales Manager, Brightwave Media May 2021 – 2026", "May 2021", "2026", [
        claim("Ran digital planning for an $8M+ yearly digital book, advising a wide mix of local clients in legal, landscaping, veterinary, furniture, fitness, and auto repair on combined on-air and online campaigns."),
        claim("Kept Portland in the top five of Brightwave's twenty-two markets for digital revenue per seller even though Portland ranks #24 among U.S. markets by population; hit the annual digital target in four of five years."),
        claim("Moved the market's revenue mix from mostly on-air spots to roughly half digital, starting from a client base that had only tested online ads in small pilots."),
        claim("Coached 9 account-executive desks through a digital-first sales rhythm: 15+ logged pitches a week, one-on-one ride-alongs, weekly drop-in hours, and a monthly Lunch & Learn series on search, connected TV, and measurement."),
        claim("Supervised up to 4 campaign coordinators and worked with in-house producers, outside agencies, and ad-tech vendors to launch and tune campaigns against client goals such as calls, bookings, and cost per lead."),
        claim("Became the market's trusted client-facing strategist and speaker — leading renewal meetings, quarterly reviews, and annual plans that kept anchor accounts, including 110% YoY search conversion growth and 17% YoY new-customer lift for a regional credit union."),
        claim("Advised clients on measurement design, local search changes, and landing-page structure — helping the sales team talk about new ad products before competing stations did."),
      ]),
      role("Senior Account Executive", "Account Executive → Senior Account Executive, Tidewater Radio May 2019 – May 2021", "May 2019", "May 2021", [
        claim("Handled a book of mid-size Portland accounts as the team's digital specialist, pairing with on-air sellers to keep and grow spend across search, social, connected TV, and streaming audio."),
        claim("Promoted to Senior Account Executive after two years of high renewal rates and digital growth; moved into the Digital Sales Manager role when the station group rebranded as Brightwave Media in May 2021."),
      ], "Tidewater Radio May 2019 – May 2021"),
      role("Digital Campaign Coordinator", "Digital Campaign Coordinator, Tidewater Radio Sep 2017 – Apr 2019", "Sep 2017", "Apr 2019", [
        claim("Set up, trafficked, monitored, and reported on search, social, connected TV, and display campaigns for local and regional advertisers — the platform groundwork behind every later sales role."),
      ]),
    ], [], "Sep 2017", "2026", "Portland Market · Sep 2017 – 2026"),
    employer("Lumen Signal Studio", "Lumen Signal Studio", [
      role("Founder & ML Engineer", "Founder & ML Engineer | Lumen Signal Studio", "2024", "Present", [
        claim("Built and runs a small retrieval assistant on a managed cloud platform that answers questions over past proposals, call notes, and rate cards, choosing between two hosted language models by cost and response time."),
        claim("Shipped a budget-pacing checker that flags under-delivering campaigns each morning, run against 14 client accounts and about $1.1M in active spend."),
        claim("Set up scheduled jobs for weekly client summaries and daily market-news digests with chat delivery, managing a handful of API keys and two cloud service accounts."),
      ], "Portland, OR 2024 – Present"),
    ], [], "2024", "Present", "Portland, OR 2024 – Present"),
    employer("Quiet Fox Works & ShelfScout", "Quiet Fox Works & ShelfScout", [
      role("Founder", "Founder | Quiet Fox Works & ShelfScout", "2024", "Present", [
        claim("Quiet Fox Works: a two-person studio building reporting and follow-up automations for local service businesses, with a written playbook of 12 reusable workflows."),
        claim("ShelfScout: designing a small web app that tracks price changes on used books across three marketplaces and sends a weekly email of the best finds."),
      ], "Portland, OR 2024 – Present"),
    ], [], "2024", "Present", "Portland, OR 2024 – Present"),
    employer("Panelry", "Panelry — Recruited survey panelists", [
      role("Cofounder", "Cofounder, Panelry", "2016", "2017", [
        claim("Recruited survey panelists for small research agencies through paid social and search campaigns."),
      ], "campaigns. 2016 – 2017"),
    ], [], "2016", "2017", "campaigns. 2016 – 2017"),
    employer("Summit Ridge Lending Inc.", "Summit Ridge Lending Inc.", [
      role("Digital Marketing Strategist", "Digital Marketing Strategist, Summit Ridge Lending Inc.", "2015", "2016", [
        claim("Ran search campaigns and blog content for loan officers and real-estate partners across 6 states."),
      ], "across 6 states. 2015 – 2016"),
    ], [], "2015", "2016", "across 6 states. 2015 – 2016"),
  ],
  looseClaims: [
    claim("Media sales leader and automation builder with 11 years in local advertising — including 8+ years and four roles at Brightwave Media (formerly Tidewater Radio) Portland, moving from Digital Campaign Coordinator to Account Executive to Senior Account Executive to Digital Sales Manager while the station group shifted from on-air spots to a mixed audio and digital offer."),
    claim("Core Competencies Digital Media & Advertising: Search, social, connected TV, streaming audio, display, geofencing; campaign measurement; local listings and review programs"),
    claim("Sales Leadership: Book growth, team coaching, seller onboarding, pitch rhythm, incentive design"),
    claim("Client Strategy & Presentation: Annual planning, quarterly reviews, renewal meetings, needs discovery, results reporting, retention through budget cuts"),
    claim("Automation & Engineering: Scheduled data jobs, retrieval search over sales notes, cloud function deployment, lightweight internal dashboards"),
  ],
  education: [claim("Bachelor of Arts, Economics and Statistics | Example State University — Eugene, OR 2017")],
  credentials: [claim("Certifications: Search advertising fundamentals; web analytics certificate.")],
};

const fixtures = [
  {
    matches: (text) => text.includes("Northwind — Digital Sales Manager, 2021–2026") && text.includes("Example App — Founder, 2024–present") && text.includes("Led the market to a 60% digital revenue mix across Google Ads and Meta") && text.includes("Operate scheduled workflows across 8-10 API keys."),
    reply: resumeTextReply,
  },
  {
    matches: (text) => text.includes("Grew Austin to a top-3 national ranking on a $10M+ book with Google Ads.") && text.includes("Led the market to a 60% digital revenue mix with clear weekly readouts."),
    reply: digitalOutreachReply,
  },
  {
    matches: (text) => text.includes("Northwind — Digital Sales Manager, 2021–2026") && text.includes("Example App — Founder, 2024–present"),
    reply: digitalPipelineReply,
  },
  {
    matches: (text) => text.includes("Acme — Digital Sales Manager, 2021–2026") && text.includes("go-to client-facing strategist"),
    reply: customizerReply,
  },
  {
    matches: (text) => text.includes("Northwind Studio — Founder, 2023 – Present"),
    reply: metricReadoutReply,
  },
  {
    matches: (text) => text.includes("Northwind Logistics — Operations Analyst, 2021–2025"),
    reply: northwindOpsReply,
  },
  {
    matches: (text) => text.includes("Northwind Media (formerly Contoso Radio) — Austin Market"),
    reply: bulletedUploadReply,
  },
  {
    matches: (text) => text.includes("Northwind — Manager, 2021-2026") && text.includes("Grew revenue 30% on a $2M book."),
    reply: profileRouteReply,
  },
  {
    matches: (text) => text.includes("No experience listed."),
    reply: emptyExperienceReply,
  },
  {
    matches: (text) => text.includes("Northwind — Operations Analyst, 2021–2026") && text.includes("Built a route forecaster for 620 vans across four regional depots."),
    reply: pipelineBudgetReply,
  },
  {
    matches: (text) => text.includes("Northwind — Operations Analyst, 2021–2026") && text.includes("RouteLab — Founder, 2024–present"),
    reply: pipelineReply,
  },
  {
    matches: (text) => text.includes("Northwind Logistics, Senior Operations Analyst, 2021-2025"),
    reply: exampleWriterReply,
  },
  {
    matches: (text) => text.toLocaleLowerCase("en-US").includes("morgan “mo” ellison-park") && text.includes("Brightwave Media (formerly Tidewater Radio)"),
    reply: realshapeReply,
  },
];

/** @param {string} text */
export function modelReplyFixture(text) {
  const source = String(text || "");
  const fixture = fixtures.find((row) => row.matches(source));
  if (!fixture) throw new Error("No hand-written model reply fixture matches this fictional resume.");
  return structuredClone(fixture.reply);
}

/** @param {string} text */
export function modelStructureFixture(text) {
  const result = validateModelStructure(modelReplyFixture(text), text);
  if (result.rejected.length) {
    throw new Error(`Invalid model fixture structure: ${JSON.stringify(result.rejected)}`);
  }
  return result.structure;
}
