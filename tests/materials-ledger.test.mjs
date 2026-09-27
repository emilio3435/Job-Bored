import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildStarterTemplate,
  listStarterTemplateIds,
} from "../server/user-profile.mjs";
import {
  hashLedger,
  readLedger,
  resolveLedgerPath,
  validateLedger,
  writeLedgerAtomic,
} from "../server/materials-ledger.mjs";
import { buildLedger, ensureLedger, ledgerEmptyError } from "../server/materials-ledger-build.mjs";

const RESUME_TEXT = [
  "Jordan Rivera",
  "Austin, TX · jordan.rivera@example.com · 555-010-2030",
  "",
  "EXPERIENCE",
  "Northwind — Digital Sales Manager, 2021–2026",
  "- Grew Austin to a top-3 national ranking on a $10M+ book.",
  "- Drove 130% YoY paid-search conversion growth on a flagship account.",
  "- Led the market to a 60% digital revenue mix across Google Ads and Meta.",
  "",
  "Example App — Founder, 2024–present",
  "- Shipped an SEM forecast tool on Gemini that ran 21+ forecasts against $2.4M of pipeline.",
  "- Operate scheduled workflows across 8-10 API keys.",
  "",
  "EDUCATION",
  "B.S. Mathematics, Example State University",
].join("\n");

function fixtureProfile() {
  const tpl = buildStarterTemplate(listStarterTemplateIds()[0]);
  tpl.strengths = [
    {
      name: "Performance marketing",
      rank: 1,
      evidence: "Ran paid acquisition at $5M+ annual spend with CAC payback under 12 months.",
      keywords: ["Google Ads", "Power BI"],
    },
  ];
  tpl.experiences = [
    { slug: "northwind", company: "Northwind", title: "Digital Sales Manager" },
  ];
  return tpl;
}

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "jb-ledger-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.JOBBORED_PROFILE_PATH = join(home, ".jobbored", "profile.json");
  return home;
}

describe("materials ledger (slice 1)", () => {
  it("builds claims with ids, metric tokens and tool levels from resume + profile", () => {
    const ledger = buildLedger({
      profile: fixtureProfile(),
      resumeText: RESUME_TEXT,
      resumeSource: "upload",
      nowIso: "2026-09-26T04:00:00.000Z",
    });
    const validation = validateLedger(ledger);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors || []));
    assert.equal(ledger.contract, "materials.claim-ledger.v1");
    assert.match(ledger.ledgerHash, /^sha256:[0-9a-f]+$/);

    const employers = Object.fromEntries(ledger.employers.map((e) => [e.id, e]));
    assert.ok(employers.northwind, "profile experience becomes an employer");
    assert.equal(employers.northwind.title, "Digital Sales Manager");
    assert.ok(employers["example-app"], "resume header becomes an employer");

    const byId = Object.fromEntries(ledger.claims.map((c) => [c.id, c]));
    assert.ok(byId["profile-strength-1"], "strength evidence becomes a claim");
    const bullet = Object.values(byId).find((c) => c.text.includes("top-3 national ranking"));
    assert.ok(bullet, "resume bullet becomes a claim");
    assert.equal(bullet.employerId, "northwind");
    const tokens = bullet.metrics.map((m) => m.token);
    assert.ok(tokens.includes("$10M+"), `metric tokens: ${JSON.stringify(tokens)}`);
    assert.ok(byId["resume-b4"].metrics.some((m) => m.token === "21+"), "forecast metric traced");
    assert.equal(byId["resume-b1"].verified, true);

    const tools = Object.fromEntries(ledger.toolInventory.map((t) => [t.tool, t]));
    assert.equal(tools["Google Ads"].level, "owned", "profile keyword tools are owned");
    assert.equal(tools.Gemini.level, "adjacent", "resume-only tools are adjacent");
  });

  it("round-trips through read/write with a stable hash", async () => {
    sandbox();
    const ledger = buildLedger({ profile: fixtureProfile(), resumeText: RESUME_TEXT });
    const first = hashLedger(ledger);
    const { path } = await writeLedgerAtomic(ledger);
    assert.equal(path, resolveLedgerPath());
    const back = await readLedger();
    assert.equal(back.ok, true);
    assert.equal(hashLedger(back.ledger), first);
  });

  it("fails ledger_empty when neither input yields facts", () => {
    const err = ledgerEmptyError();
    assert.equal(err.code, "ledger_empty");
    assert.throws(
      () => buildLedger({ profile: null, resumeText: "   " }),
      (e) => e.code === "ledger_empty",
    );
    assert.throws(
      () => buildLedger({ profile: { strengths: [] }, resumeText: "" }),
      (e) => e.code === "ledger_empty",
    );
  });

  it("ensureLedger reuses a fresh ledger and rebuilds on input change", async () => {
    sandbox();
    const profile = fixtureProfile();
    const first = await ensureLedger({ profile, resumeText: RESUME_TEXT });
    const second = await ensureLedger({ profile, resumeText: RESUME_TEXT });
    assert.equal(second.ledgerHash, first.ledgerHash);
    assert.equal(second.rebuilt, false);
    const third = await ensureLedger({ profile, resumeText: `${RESUME_TEXT}\nExtra line.` });
    assert.equal(third.rebuilt, true);
    assert.notEqual(third.ledgerHash, first.ledgerHash);
  });
});

describe("F11: resume.txt is the canonical stored resume", () => {
  it("getStoredResumeText prefers resume.txt over worker-config", async () => {
    const home = sandbox();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(home, ".jobbored"), { recursive: true });
    writeFileSync(join(home, ".jobbored", "resume.txt"), "NEW resume from resume.txt");
    const workerCfg = join(home, "worker-config.json");
    writeFileSync(
      workerCfg,
      JSON.stringify({ candidateProfile: { resumeText: "OLD resume from worker-config" } }),
    );
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = workerCfg;
    try {
      const mod = await import(`../server/profile-from-resume.mjs?t=${Date.now()}`);
      const stored = await mod.getStoredResumeText();
      assert.equal(stored.source, "jobbored_text");
      assert.equal(stored.text, "NEW resume from resume.txt");
    } finally {
      delete process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH;
    }
  });
});
