/**
 * The 3E render-model fixture with the optional family fields filled in
 * (logos from the brand-logo resolver, readouts, ventures, toolkit,
 * credentials, intro, headline, pull quote), so the registry render tests
 * exercise every slot a family can read. Facts are the fixture's own: every
 * figure is a claim-ledger metric token and every claimId is a ledger claim
 * (docs/materials-v3/mocks/3e-ai-marketing-analytics-manager/claim-ledger.json).
 *
 * Logos stand in for resolver output: data: URIs of the shared logo files,
 * tagged with the shape class the resolver reports.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MOCK_DIR = join(repoRoot, "docs/materials-v3/mocks/3e-ai-marketing-analytics-manager");
const LOGO_DIR = join(repoRoot, "docs/materials-v3/mocks/assets/logos");

/**
 * @param {string} file
 * @param {string} alt
 * @param {"mark" | "wordmark" | "lockup"} shape
 */
function logo(file, alt, shape) {
  const mime = file.endsWith(".svg") ? "image/svg+xml" : "image/png";
  const data = readFileSync(join(LOGO_DIR, file)).toString("base64");
  return { src: `data:${mime};base64,${data}`, alt, shape, source: "upload" };
}

/** The bare pipeline fixture, as committed. */
export function baseRenderModel() {
  return JSON.parse(readFileSync(join(MOCK_DIR, "render-model.json"), "utf8"));
}

/**
 * @param {string} [family]
 */
export function fullRenderModel(family = "signal") {
  const model = baseRenderModel();
  model.template = { family, version: "1.0", pageBudget: 1 };
  model.documents.resume.templateId = `${family}.resume`;
  model.documents.coverLetter.templateId = `${family}.letter`;

  const elio = logo("elio.png", "Elio Intelligence Suite logo", "mark");
  const audacy = logo("audacy.svg", "Audacy logo", "wordmark");
  const prm = logo("prm-apple-touch.png", "Primary Residential Mortgage logo", "mark");
  const cc = logo("colorado-college.svg", "Colorado College logo", "lockup");

  const resume = model.documents.resume;
  const experience = resume.sections.find((s) => s.kind === "experience");
  experience.entries[0].logo = elio;
  experience.entries[1].logo = audacy;
  const earlier = resume.sections.find((s) => s.kind === "earlier");
  earlier.entries[1].logo = prm;
  earlier.entries[1].line = "Ran paid search and WordPress site programs for loan-officer demand generation.";
  earlier.entries[1].claimId = "prmi-sem";

  resume.intro = {
    runs: [
      { t: "Since 2015, Emilio Nunez-Garcia has worked the question every media budget eventually faces: what did this spend actually move? He spent 2017 to 2026 at Audacy in Denver, rising from trafficking campaigns to owning a " },
      { n: "$10M+" },
      { t: " digital book. Since 2024 he has built Elio Intelligence Suite, a production multi-model AI platform." },
    ],
    claimIds: ["audacy-book", "audacy-earlier-sme", "elio-platform", "prmi-sem"],
  };

  const readouts = {
    kind: "readouts",
    label: "Verified figures",
    readouts: [
      { n: "21", caption: "forecast scenarios run", claimId: "elio-forecast", employerId: "elio" },
      { n: "$2.4M", caption: "of live pipeline, for a seller pitch", claimId: "elio-forecast", employerId: "elio" },
      { n: "$10M+", caption: "digital book owned", claimId: "audacy-book", employerId: "audacy-dsm" },
      { n: "top-3", caption: "national rank from a #19-sized market", claimId: "audacy-book", employerId: "audacy-dsm" },
      { n: "130%", caption: "YoY paid-search conversion growth", claimId: "audacy-metric", employerId: "audacy-dsm" },
      { n: "13%", caption: "new-user lift, financial services", claimId: "audacy-metric", employerId: "audacy-dsm" },
    ],
  };
  const ventures = {
    kind: "ventures",
    label: "Ventures",
    entries: [
      { employerId: "hormiga", claimId: "hormiga-playbook", meta: ["2025 —", "present"], org: "Hormiga", seat: "founder", line: "Built an 18-idea growth playbook for small-business clients." },
      { employerId: "bucketz", claimId: "bucketz-launch", meta: ["2023 —", "2024"], org: "Bucketz", seat: "founder", line: "Launched a consumer marketplace side product and its paid acquisition test plan on Meta Ads and Shopify." },
    ],
  };
  const toolkit = {
    kind: "toolkit",
    label: "Toolkit",
    groups: [
      { label: "AI systems", items: ["Claude API", "Claude Code", "Gemini", "Vertex AI Search", "GCP Cloud Run", "multi-model routing", "RAG"] },
      { label: "Analytics", items: ["SQL", "Looker Studio", "GA4", "attribution (last-click, DDA, MTA)", "incrementality"] },
      { label: "Media", items: ["Google Ads", "Meta", "OTT/CTV", "programmatic", "paid search"] },
      { label: "Ramping", items: ["Power BI and DAX are new; they transfer from Looker Studio, GA4, and SQL"] },
    ],
  };
  const credentials = {
    kind: "credentials",
    label: "Credentials",
    lines: [
      { claimId: "education", logo: cc, runs: [{ t: "B.A. Mathematical Economics, Colorado College, 2017." }] },
      { claimId: "certs", runs: [{ t: "Google Ads, GA4, and Meta Blueprint certifications. English & Spanish." }] },
    ],
  };
  const others = resume.sections.filter((s) => s.kind === "experience" || s.kind === "earlier");
  resume.sections = [readouts, ...others, ventures, toolkit, credentials];

  const letter = model.documents.coverLetter;
  letter.headline = "Spend that explains itself, and the AI that does the explaining";
  letter.pullQuote = {
    text: "That is the shape of 25 skills and 15 connections, and it is not prompting.",
    fromParagraph: "p3",
  };
  letter.readouts = [
    { n: "$10M+", caption: "digital book owned", claimId: "audacy-book", employerId: "audacy-dsm" },
    { n: "top-3", caption: "national rank from a #19-sized market", claimId: "audacy-book", employerId: "audacy-dsm" },
    { n: "21", caption: "forecast scenarios run", claimId: "elio-forecast", employerId: "elio" },
    { n: "$2.4M", caption: "of live pipeline, for a seller pitch", claimId: "elio-forecast", employerId: "elio" },
  ];
  return model;
}
