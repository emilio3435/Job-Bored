/**
 * Customizer follow-ups from the live Northwind proof (2c418312):
 *   1. the resume reaches the 8-bullet target when the ledger has the claims;
 *   2. "go-to" is not the Go language;
 *   3. a signature line in the middle of the evidence is a soft tell
 *      (REVIEW), never spliced out after writing;
 *   4. the prompt asks for the company within the first 40 words (no
 *      post-draft sentence moving; letters are not spliced after writing).
 * No live model calls: the model's select reply is the one recorded live.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { scoreClaims } from "../server/materials-claim-score.mjs";
import { draftSystemPrompt } from "../server/materials-draft.mjs";
import { deterministicExtract } from "../server/materials-jd-extract.mjs";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { buildOutline } from "../server/materials-outline.mjs";
import { BULLET_TARGET, selectClaims } from "../server/materials-select.mjs";
import { toolPattern } from "../server/materials-tool-match.mjs";
import { soundsHumanRow } from "../server/materials-voice-tells.mjs";

const NORTHWIND_JD = readFileSync(new URL("./fixtures/jobs/northwind-director-digital-sales.txt", import.meta.url), "utf8");
const PIN = { provider: "local", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
const GATE = { verdict: "usable", confidence: 0.9, signals: {} };

/* The live run's shape: Contoso with three roles and many claims, a
 * current founder role with three, and an earlier venture. */
const LEDGER = {
  contract: "materials.claim-ledger.v1",
  ledgerHash: "sha256:c0ffee",
  employers: [
    {
      id: "contoso", name: "Contoso (formerly Fabrikam)", start: "Oct 2018", end: "2026",
      roles: [
        { id: "contoso-r1", title: "Regional Growth Lead", start: "Jun 2022", end: "2026" },
        { id: "contoso-r2", title: "Client Strategy Lead", start: "Feb 2020", end: "Jun 2022" },
        { id: "contoso-r3", title: "Campaign Operations Lead", start: "Oct 2018", end: "Jan 2020" },
      ],
    },
    { id: "meridian", name: "Meridian Insights Group", start: "2024", end: null, roles: [{ id: "meridian-r1", title: "Founder & AI Engineer", start: "2024", end: null }] },
    { id: "cedar", name: "Cedar Lantern & JobBored", start: "2024", end: null },
  ],
  claims: [
    { id: "a1", employerId: "contoso", roleId: "contoso-r1", kind: "operations", text: "Supported 12 AE desks through 24+ tracked pitches a month and enablement sessions on OTT, SEM and programmatic.", metrics: [{ token: "12" }, { token: "24+" }], verified: true },
    { id: "a2", employerId: "contoso", roleId: "contoso-r1", kind: "achievement", text: "Led digital strategy for a $12M+ annual book, driving Austin to a top-4 national ranking in digital revenue.", metrics: [{ token: "$12M+" }, { token: "top-4" }], verified: true },
    { id: "a3", employerId: "contoso", roleId: "contoso-r1", kind: "achievement", text: "Led the market's digital transformation to approximately 60% of total revenue in digital.", metrics: [{ token: "60%" }], verified: true },
    { id: "a4", employerId: "contoso", roleId: "contoso-r1", kind: "achievement", text: "Delivered 125% YoY paid-search conversion growth on a strategic financial-services account.", metrics: [{ token: "125%" }], verified: true },
    { id: "a5", employerId: "contoso", roleId: "contoso-r2", kind: "operations", text: "Partnered with Account Executives across strategic Austin accounts to grow spend across SEM, OTT/CTV and Streaming Audio.", metrics: [], verified: true },
    { id: "a6", employerId: "contoso", roleId: "contoso-r1", kind: "system", text: "Led client strategy on attribution modeling and AI-search readiness for the market.", metrics: [], verified: true },
    { id: "e1", employerId: "meridian", roleId: "meridian-r1", kind: "system", text: "Released an SEM Income Projection application on Gemini running 24+ forecasts against $3.1M of pipeline data.", metrics: [{ token: "24+" }, { token: "$3.1M" }], verified: true },
    { id: "e2", employerId: "meridian", roleId: "meridian-r1", kind: "system", text: "Stood up agentic scheduled workflows for client-pulse briefings across 8–10 API keys.", metrics: [{ token: "8–10" }], verified: true },
    { id: "e3", employerId: "meridian", roleId: "meridian-r1", kind: "system", text: "Deployed a multi-engine AI platform on GCP Cloud Run directing across Claude, GPT and Gemini.", metrics: [], verified: true },
    { id: "h1", employerId: "cedar", kind: "system", text: "Authored an 18-idea automation playbook for SMB marketing and ops workflows.", metrics: [{ token: "18" }], verified: true },
  ],
  toolInventory: [],
};

const extract = () => deterministicExtract({ jdText: NORTHWIND_JD, company: "NorthwindMedia, Inc.", title: "Director, Digital Sales", gate: GATE });

describe("1. the resume reaches the 8-bullet target", () => {
  it("should backfill past the model's budget drops until the plan shows 8 bullets", async () => {
    const ex = extract();
    const shortlist = scoreClaims({ extract: ex, ledger: LEDGER, limit: 20 });
    /* The live model's pick: six Contoso claims, one Meridian claim, the
     * venture; the other Meridian claims dropped "for budget". */
    const reply = JSON.stringify({
      kept: ["a1", "a2", "a3", "a4", "a5", "a6", "e1", "h1"].map((claimId) => ({ claimId, slot: "s", reason: "fit" })),
      dropped: [{ claimId: "e2", code: "budget", reason: "page" }, { claimId: "e3", code: "budget", reason: "page" }],
      transfers: [],
      letter: {},
    });
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) });
    const { selection } = await selectClaims({ extract: ex, shortlist, ledger: LEDGER, pin: PIN, fetchImpl });
    const outline = buildOutline({ selection, ledger: LEDGER, feature: "resume", extract: ex });
    const bullets = outline.featured.reduce((n, f) => n + f.claimIds.length, 0);
    assert.ok(bullets >= BULLET_TARGET, `${bullets} bullets: ${JSON.stringify(outline.featured.map((f) => f.claimIds))}`);
    const kept = new Set(selection.kept.map((k) => k.claimId));
    assert.ok(kept.has("e2"), "a numbered claim the model dropped for budget comes back");
    assert.ok(!selection.dropped.some((d) => kept.has(d.claimId)), "a kept claim is not also recorded as dropped");
  });
});

describe("2. ambiguous tool names", () => {
  it("should not read 'go-to' or 'R&D' as the Go or R languages", () => {
    assert.equal(toolPattern("Go").test("the market's go-to client-facing strategist"), false);
    assert.equal(toolPattern("Go").test("Go-to presenter"), false);
    assert.equal(toolPattern("Go").test("services written in Go and Rust"), true);
    assert.equal(toolPattern("R").test("an R&D budget"), false);
    assert.equal(toolPattern("R").test("SQL, R and Python"), true);
    assert.equal(toolPattern("Google Ads").test("google ads budgets"), true, "unambiguous names stay case-insensitive");
  });

  it("should build no Go tool from a resume that says go-to", () => {
    const ledger = buildLedger({
      profile: { version: 1, identity: { targetRoles: ["x"], targetSeniority: "director", primaryNarrative: "x" }, strengths: [], hardConstraints: { workMode: "any" } },
      resumeText: [
        "Example Person",
        "Acme — Digital Sales Manager, 2021–2026",
        "- Served as the team's lead presenter for major pitches and quarterly reviews for 24+ accounts.",
      ].join("\n"),
    });
    const tools = (ledger.toolInventory || []).map((t) => t.tool);
    assert.equal(tools.includes("Go"), false, tools.join(", "));
    assert.equal(ledger.claims.some((c) => Array.isArray(c.tools) && c.tools.includes("Go")), false);
  });
});

describe("3 and 4. letter shape without splicing", () => {
  const SIGNATURE = "The best marketers aren’t just troubleshooters — they’re problem-finders.";
  const evidence = "At Contoso I led digital revenue strategy for a $12M+ annual book and supported 12 AE desks. The best marketers aren't just troubleshooters — they're problem-finders.";

  it("should flag a signature line in the evidence paragraph as a soft tell (REVIEW, not FAIL)", () => {
    const paragraphs = [
      "I spent eight years building campaigns for NorthwindMedia-sized audio books, and I want to do it for NorthwindMedia.",
      evidence,
      "I want to map one East Region campaign for NorthwindMedia. Worth a quick call this week?",
    ];
    const row = soundsHumanRow(paragraphs, { company: "NorthwindMedia", signatureLines: [SIGNATURE], signatureTellLines: [SIGNATURE] });
    const tell = row.tells.find((t) => t.code === "signature_mid_evidence");
    assert.ok(tell, row.note);
    assert.equal(tell.weight, "soft");
    assert.equal(tell.paragraph, 1);
  });

  it("should not flag the same line in the close", () => {
    const paragraphs = [
      "I spent eight years building campaigns, and I want to do it for NorthwindMedia.",
      "At Contoso I led digital revenue strategy for a $12M+ annual book and supported 12 AE desks.",
      "The best marketers aren't just troubleshooters — they're problem-finders. Worth a quick call this week?",
    ];
    const row = soundsHumanRow(paragraphs, { company: "NorthwindMedia", signatureLines: [SIGNATURE], signatureTellLines: [SIGNATURE] });
    assert.equal(row.tells.some((t) => t.code === "signature_mid_evidence"), false);
  });

  it("should ask the model to name the company within the first 40 words", () => {
    assert.match(draftSystemPrompt([120, 200]), /Name the company within the first 40 words of the letter/);
  });
});
