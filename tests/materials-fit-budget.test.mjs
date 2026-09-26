import test from "node:test";
import assert from "node:assert/strict";
import {
  MATERIALS_BUDGETS,
  TRIM_LADDER,
  VOLT_RESUME_METRICS,
  estimateResumeHeightPt,
  solveFit,
} from "../server/materials-fit-budget.mjs";

/**
 * The 3E fixture plan, with the Primary Residential Mortgage description line
 * the fit solver removed. `run.json` records this as the one trim the run
 * needed, so this test is the executable version of that ledger entry.
 */
function threeEPlan() {
  return {
    pageBudget: 1,
    statement:
      "Sixty percent of this role is making spend explain itself; forty is running the AI that does the explaining. I have shipped both — an attribution argument over a $10M book, and a production multi-model stack with live data connections underneath it.",
    featured: [
      {
        employerId: "elio",
        rank: 1,
        seat: true,
        bullets: [
          {
            claimId: "elio-platform",
            text: "Built and operate a multi-model platform on Cloud Run — Claude, Gemini, GPT, Grok, and Llama behind task-fit routing, Vertex AI Search retrieval, and live data connections. Structurally the same object as a 25-skill Claude graph wired to 15 systems.",
          },
          {
            claimId: "elio-forecast",
            text: "Shipped a grounded SEM forecaster that ran 21 scenarios against $2.4M of live pipeline, so the seller walked in with spend-to-stage math instead of a dashboard.",
          },
          {
            claimId: "elio-ops",
            text: "Own the unglamorous half: 8–10 API keys, 3–4 GCP service accounts, scheduled agent runs, and the pager when a connection drifts.",
          },
        ],
      },
      {
        employerId: "audacy-dsm",
        rank: 2,
        seat: true,
        bullets: [
          {
            claimId: "audacy-book",
            text: "Carried the book and the attribution argument behind it. Reallocated Google, Meta, OTT/CTV, and programmatic against marginal ROAS until Denver held a top-3 national rank out of a #19-sized market.",
          },
          {
            claimId: "audacy-framework",
            text: "Wrote the bidding and attribution framework the QBRs ran on — last-click versus assisted, incrementality, which channel actually moved buying stage — then taught 10 AE desks to defend it without me in the room.",
          },
          {
            claimId: "audacy-metric",
            text: "130% YoY paid-search conversion growth and a 13% new-user lift on a flagship financial-services account. The deliverable was the readout: what happened, why, what we cut Monday.",
          },
        ],
      },
    ],
    earlier: [
      {
        employerId: "audacy-earlier",
        description:
          "Trafficked Google, Meta, and OTT, built the market's reporting, and became the digital SME account executives brought into client calls.",
      },
      {
        employerId: "prmi",
        description: "Ran paid search and site content for loan-officer demand generation.",
      },
    ],
    tokens: [
      "Claude API",
      "Claude Code",
      "Gemini + Vertex AI",
      "multi-model routing",
      "RAG",
      "Python",
      "SQL",
      "REST + webhooks",
      "scheduled agent runs",
      "Looker Studio",
      "GA4",
      "GTM",
      "attribution (last-click, DDA, MTA)",
    ],
    education: "B.A. Mathematical Economics, Colorado College, 2017 / English & Spanish",
  };
}

test("the budget table is the single copy of the numbers v2 got wrong", () => {
  // The 325-word letter floor is what forced the filler the 3E run was flagged for.
  assert.deepEqual(MATERIALS_BUDGETS.letter.bodyWords, [180, 260]);
  assert.equal(MATERIALS_BUDGETS.letter.bodyWordsHardMax, 280);
  assert.equal(MATERIALS_BUDGETS.letter.paragraphs, 4);
  assert.equal(MATERIALS_BUDGETS.resume.pages, 1);
  assert.equal(MATERIALS_BUDGETS.resume.pagesMax, 2);
  assert.deepEqual(MATERIALS_BUDGETS.resume.bulletsPerFeatured, [2, 4]);
  assert.equal(MATERIALS_BUDGETS.run.llmCallsMax, 4);
  assert.ok(Object.isFrozen(MATERIALS_BUDGETS));
});

test("the trim ladder is ordered from cheapest cut to structural cut", () => {
  assert.deepEqual(TRIM_LADDER, [
    "drop_earlier_description",
    "drop_weakest_bullet",
    "trim_tokens",
    "drop_weakest_earlier",
    "drop_weakest_featured",
    "escalate_page_budget",
  ]);
});

test("the 3E plan lands inside the estimator safety band and one ladder step clears it", () => {
  const plan = threeEPlan();
  const comfortablePt = VOLT_RESUME_METRICS.usableHeightPt - VOLT_RESUME_METRICS.safetyBandPt;
  const before = estimateResumeHeightPt(plan);
  assert.ok(
    before <= VOLT_RESUME_METRICS.usableHeightPt,
    `expected ${before}pt to stay on one page`,
  );
  assert.ok(
    before > comfortablePt,
    `expected ${before}pt to exceed ${comfortablePt}pt of banded capacity`,
  );

  const result = solveFit(plan);
  assert.equal(result.fits, true);
  assert.deepEqual(result.applied, ["drop_earlier_description"]);
  assert.equal(result.plan.earlier.length, 2, "the employer stays; only its description line goes");
  assert.equal(result.plan.earlier[1].description, undefined);
  assert.equal(result.plan.featured[0].bullets.length, 3, "no bullet was sacrificed");
  assert.equal(result.plan.tokens.length, 13, "no token was sacrificed");
  assert.ok(result.estimatePt <= result.capacityPt);
});

test("solveFit never mutates the plan it was given", () => {
  const plan = threeEPlan();
  solveFit(plan);
  assert.equal(plan.earlier[1].description, "Ran paid search and site content for loan-officer demand generation.");
});

test("a badly overstuffed plan walks down the ladder instead of shrinking type", () => {
  const plan = threeEPlan();
  for (const entry of plan.featured) {
    entry.bullets.push({
      claimId: `${entry.employerId}-filler`,
      text: "A fourth bullet of the same length as the others, added to force the solver past the cheap cuts and into dropping evidence rather than reflowing the page.",
    });
  }
  const result = solveFit(plan);
  assert.equal(result.fits, true);
  assert.equal(result.applied[0], "drop_earlier_description");
  assert.ok(result.applied.includes("drop_weakest_bullet"));
  assert.ok(
    result.plan.featured.every(
      (entry) => entry.bullets.length >= MATERIALS_BUDGETS.resume.bulletsPerFeatured[0],
    ),
    "no featured employer is trimmed below the minimum bullet count",
  );
});

test("page-budget escalation requires a recorded reason", () => {
  const huge = {
    ...threeEPlan(),
    statement: "x".repeat(4000),
  };
  const withoutReason = solveFit(huge);
  assert.equal(withoutReason.plan.pageBudget, 1);
  assert.equal(withoutReason.applied.includes("escalate_page_budget"), false);

  const withReason = solveFit({
    ...huge,
    pageBudgetReason: "15+ years of directly relevant IC evidence",
  });
  assert.equal(withReason.plan.pageBudget, 2);
  assert.ok(withReason.applied.includes("escalate_page_budget"));
});
