/**
 * Materials Wave 1 (L1, decision 1) — the model-structured resume pass.
 *
 * The model may only return the resume's own words. Recorded replies are
 * replayed through the real materials-writer callJsonStage with a stub
 * fetch that answers as Gemini's generateContent does — no live calls.
 *
 * The recorded replies under tests/fixtures/resumes/model-replies/ are
 * hand-built in Gemini's reply shape: the configured key answered HTTP 403
 * on 2026-09-27, so no live reply could be captured. structure-valid.json
 * types one em dash as a hyphen and curls one apostrophe, the drift a real
 * model shows; structure-invents-claim.json adds an invented metric claim,
 * a paraphrase, an invented employer and an invented degree.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validateLedger } from "../server/materials-ledger.mjs";
import { buildLedger, ensureLedger } from "../server/materials-ledger-build.mjs";
import { parseResumeStructure } from "../server/materials-resume-structure.mjs";
import {
  RESUME_STRUCTURE_STAGE,
  RESUME_STRUCTURE_SYSTEM_PROMPT,
  structureResumeWithModel,
  validateModelStructure,
} from "../server/materials-resume-structure-model.mjs";
import { callJsonStage } from "../server/materials-writer.mjs";

/* L2's stage wrapper backs off on 429/5xx; tests skip the real wait. */
const noSleep = async () => {};
const fastStage = (input) => callJsonStage({ ...input, sleep: noSleep });

const fixture = (p) => new URL(`./fixtures/resumes/${p}`, import.meta.url);
const TEXT_FIXTURES = readdirSync(fixture("")).filter((name) => name.endsWith(".txt"));
const GOLDEN = readFileSync(fixture("unbulleted-realshape.txt"), "utf8");
const VALID = JSON.parse(readFileSync(fixture("model-replies/structure-valid.json"), "utf8"));
const INVENTS = JSON.parse(readFileSync(fixture("model-replies/structure-invents-claim.json"), "utf8"));
const PIN = { provider: "gemini", model: "gemini-flash", resolvedModel: "gemini-flash-latest", apiKey: "test-key" };

/**
 * A fetch that answers each call with the next recorded Gemini reply.
 * @param {Array<{ status?: number, body?: unknown }>} replies
 */
function recordedFetch(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")) });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    const status = next.status ?? 200;
    return { ok: status < 400, status, json: async () => next.body ?? {} };
  };
  return { fetchImpl, calls };
}

/** @param {unknown} payload */
function geminiReply(payload, finishReason = "STOP") {
  return {
    body: {
      candidates: [
        {
          finishReason,
          content: { parts: [{ text: typeof payload === "string" ? payload : JSON.stringify(payload) }] },
        },
      ],
    },
  };
}

const employerClaims = (structure) => structure.employers.flatMap((e) => e.claims.map((c) => c.text));

describe("parsed headers bound model structure", () => {
  it("drops Grok's Tucson / Manager / 2015 / Present substring probe before ledger build", () => {
    const resumeText = readFileSync(fixture("nested-roles-caps.txt"), "utf8");
    const baseline = buildLedger({ profile: null, resumeText });
    const { structure, rejected } = validateModelStructure({
      employers: [{ name: "Tucson", start: "2015", end: "Present", roles: [{ title: "Manager", start: "2015", end: "Present" }],
        claims: [{ text: "Grew clinic throughput 31% across 12 sites by redesigning scheduling and intake.", role: "Manager" }] }],
    }, resumeText);
    const ledger = buildLedger({ profile: null, resumeText, structure });
    assert.deepEqual(ledger.employers.map((e) => e.name), baseline.employers.map((e) => e.name));
    assert.equal(ledger.claims.length, baseline.claims.length);
    assert.equal(rejected.filter((r) => r.kind === "employer").length, 1);
  });

  it("keeps the parsed employer, role, and dates when model text renames them", () => {
    const resumeText = [
      "EXPERIENCE",
      "Acme Corp — Director Jan 2018 – Mar 2022",
      "- Led the account team and grew renewal revenue across the region.",
    ].join("\n");
    const { structure, rejected } = validateModelStructure({ employers: [
      { name: "Acme Corp!!!", start: "1999", end: "today", roles: [{ title: "Director!!!", start: "1999", end: "today" }] },
      { index: 0, name: "Acme Corp", roles: [{ index: 0, title: "Director!!!" }] },
      { index: 0, name: "Acme Corp", start: "1999", end: "today", roles: [{ index: 0, title: "Director", start: "1999", end: "today" }] },
    ] }, resumeText);
    assert.deepEqual(structure.employers.map((e) => [e.name, e.start, e.end, ...e.roles.map((r) => [r.title, r.start, r.end])]), [
      ["Acme Corp", "Jan 2018", "Mar 2022", ["Director", "Jan 2018", "Mar 2022"]],
    ]);
    assert.deepEqual(rejected.map((r) => `${r.kind}:${r.reason}`), [
      "employer:not_in_resume", "role:not_in_resume", "date:not_parsed_header", "date:not_parsed_header",
      "date:not_parsed_header", "date:not_parsed_header",
    ]);
  });

  for (const name of TEXT_FIXTURES) {
    it(`${name}: model labels cannot change the ledger's employers or claim count`, () => {
      const resumeText = readFileSync(fixture(name), "utf8");
      const rules = parseResumeStructure(resumeText);
      const raw = { employers: rules.employers.map((employer, index) => ({
        index,
        name: employer.name,
        start: employer.start,
        end: employer.end,
        roles: employer.roles.map((role, roleIndex) => ({ index: roleIndex, ...role })),
        claims: employer.claims.map((claim) => ({ text: claim.text, role: employer.roles[claim.roleIndex]?.title || "" })),
      })) };
      const { structure, rejected } = validateModelStructure(raw, resumeText);
      const baseline = buildLedger({ profile: null, resumeText });
      const modelLedger = buildLedger({ profile: null, resumeText, structure });
      assert.deepEqual(modelLedger.employers.map((e) => e.name), baseline.employers.map((e) => e.name));
      assert.equal(modelLedger.claims.length, baseline.claims.length);
      assert.deepEqual(rejected, []);
    });
  }
});

describe("model-structured resume (decision 1)", () => {
  it("a valid reply is used, and agrees with the rule parser on employers", async () => {
    const { fetchImpl, calls } = recordedFetch([geminiReply(VALID)]);
    /** @type {Array<Record<string, unknown>>} */
    const stageInputs = [];
    const result = await structureResumeWithModel({
      resumeText: GOLDEN,
      pin: PIN,
      fetchImpl,
      callStage: (input) => {
        stageInputs.push(input);
        return callJsonStage(input);
      },
    });
    assert.equal(result.source, "model");
    assert.equal(result.note, "structure:model");
    assert.equal(stageInputs[0].stage, RESUME_STRUCTURE_STAGE, "named stage keys the llm.json fallback");
    assert.equal(calls.length, 1, "one stage call");
    assert.equal(calls[0].body.systemInstruction.parts[0].text, RESUME_STRUCTURE_SYSTEM_PROMPT);
    assert.match(calls[0].body.contents[0].parts[0].text, /^Resume:\nMORGAN/);

    const rules = parseResumeStructure(GOLDEN);
    assert.equal(result.structure.employers.length, rules.employers.length);
    assert.deepEqual(
      result.structure.employers.map((e) => e.name),
      rules.employers.map((e) => e.name),
    );
    assert.deepEqual(result.rejected, []);
    /* The hyphen/curly-quote drift is accepted, and the stored text is the resume's own. */
    const goTo = employerClaims(result.structure).find((t) => t.startsWith("Became the market"));
    assert.ok(goTo && GOLDEN.includes(goTo), "stored claim is verbatim resume text");
    assert.match(goTo, /market's trusted client-facing strategist and speaker — leading/);

    const ledger = buildLedger({ profile: null, resumeText: GOLDEN, structure: result.structure, note: result.note });
    assert.equal(validateLedger(ledger).ok, true);
    assert.equal(ledger.note, "structure:model");
    assert.ok(ledger.claims.length >= 20, `claims: ${ledger.claims.length}`);
    assert.equal(ledger.employers[0].roles?.length, 3);
  });

  it("a reply that invents claims, an employer and a degree is filtered to the resume's words", async () => {
    const { fetchImpl } = recordedFetch([geminiReply(INVENTS)]);
    const result = await structureResumeWithModel({ resumeText: GOLDEN, pin: PIN, fetchImpl });
    assert.equal(result.source, "model", "the true parts of the reply are still used");
    const claims = employerClaims(result.structure);
    assert.equal(claims.some((t) => /Crestline|45%/.test(t)), false, "invented metric claim rejected");
    assert.equal(claims.includes("Ran digital planning for an $8M+ book at Brightwave Media."), false, "paraphrase rejected");
    assert.equal(result.structure.employers.some((e) => /crestline/i.test(e.name)), false, "invented employer rejected");
    assert.equal(result.structure.education.some((t) => /Northfield/.test(t)), false, "invented degree rejected");
    for (const text of [...claims, ...result.structure.education, ...result.structure.credentials]) {
      assert.ok(GOLDEN.replace(/\s+/g, " ").includes(text), `not verbatim: ${text.slice(0, 60)}`);
    }
    const reasons = result.rejected.map((r) => `${r.kind}:${r.reason}`).sort();
    assert.deepEqual(reasons, [
      "claim:not_in_resume",
      "claim:not_in_resume",
      "education:not_in_resume",
      "employer:not_in_resume",
    ]);
  });

  for (const [label, replies, reason] of [
    ["HTTP 403", [{ status: 403, body: { error: { message: "denied" } } }], /^http_403: /],
    ["HTTP 503 on every retry", [{ status: 503 }], /^http_503: .*after 3 attempts/],
    ["non-JSON twice", [geminiReply("I cannot help with that.")], /^invalid_json: /],
    ["MAX_TOKENS twice", [geminiReply('{"employers": [', "MAX_TOKENS")], /^writer_truncated: /],
    ["an empty structure", [geminiReply({ employers: [], education: [] })], /^model_empty$/],
    [
      "a sparse reply",
      [geminiReply({ employers: [{ ...VALID.employers[0], claims: VALID.employers[0].claims.slice(0, 2) }] })],
      /^model_sparse$/,
    ],
  ]) {
    it(`falls back to the rule parser on ${label}`, async () => {
      const { fetchImpl } = recordedFetch(replies);
      const result = await structureResumeWithModel({ resumeText: GOLDEN, pin: PIN, fetchImpl, sleep: noSleep });
      assert.equal(result.source, "rules");
      assert.match(result.fallbackReason, reason);
      assert.match(result.note, /^structure:rules \(model fallback: /);
      assert.deepEqual(result.structure, parseResumeStructure(GOLDEN));
    });
  }
});

describe("L2 retry path", () => {
  it("a 429 then a valid reply still uses the model structure", async () => {
    const { fetchImpl, calls } = recordedFetch([{ status: 429 }, geminiReply(VALID)]);
    const result = await structureResumeWithModel({ resumeText: GOLDEN, pin: PIN, fetchImpl, sleep: noSleep });
    assert.equal(calls.length, 2, "one backoff retry");
    assert.equal(result.source, "model");
  });
});

describe("ensureLedger runs the model pass once per resume", () => {
  function sandbox() {
    const home = mkdtempSync(join(tmpdir(), "jb-structure-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.JOBBORED_PROFILE_PATH = join(home, ".jobbored", "profile.json");
  }

  it("a pinned model cannot write Grok's Tucson employer into the stored ledger", async () => {
    sandbox();
    const resumeText = readFileSync(fixture("nested-roles-caps.txt"), "utf8");
    const rules = parseResumeStructure(resumeText);
    const baseline = buildLedger({ profile: null, resumeText });
    const raw = { employers: [
      ...rules.employers.map((e, index) => ({
        index,
        name: e.name,
        start: e.start,
        end: e.end,
        roles: e.roles.map((r, roleIndex) => ({ index: roleIndex, ...r })),
        claims: e.claims.map((c) => ({ text: c.text, roleIndex: c.roleIndex })),
      })),
      { name: "Tucson", start: "2015", end: "Present", roles: [{ title: "Manager", start: "2015", end: "Present" }],
        claims: [{ text: rules.employers[0].claims[0].text, role: "Manager" }] },
    ] };
    const ledger = await ensureLedger({
      profile: null, resumeText, pin: PIN,
      fetchImpl: async () => { throw new Error("unexpected network call"); },
      callStage: async () => raw,
    });
    assert.equal(ledger.note, "structure:model");
    assert.deepEqual(ledger.employers.map((e) => e.name), baseline.employers.map((e) => e.name));
    assert.equal(ledger.claims.length, baseline.claims.length);
  });

  it("upgrades a rule-parsed ledger when a pin arrives, then reuses it", async () => {
    sandbox();
    const first = await ensureLedger({ profile: null, resumeText: GOLDEN });
    assert.equal(first.note, "structure:rules");
    const { fetchImpl, calls } = recordedFetch([geminiReply(VALID)]);
    const second = await ensureLedger({ profile: null, resumeText: GOLDEN, pin: PIN, fetchImpl });
    assert.equal(second.rebuilt, true);
    assert.equal(second.note, "structure:model");
    const third = await ensureLedger({ profile: null, resumeText: GOLDEN, pin: PIN, fetchImpl });
    assert.equal(third.rebuilt, false);
    assert.equal(calls.length, 1, "no second model call for an unchanged resume");
  });

  it("records a model failure and does not retry it for the same resume", async () => {
    sandbox();
    const { fetchImpl, calls } = recordedFetch([{ status: 500 }]);
    const first = await ensureLedger({ profile: null, resumeText: GOLDEN, pin: PIN, fetchImpl, callStage: fastStage });
    assert.match(first.note, /^structure:rules \(model fallback: http_500: .*after 3 attempts\)$/);
    assert.ok(first.claims.length >= 20);
    const attempts = calls.length;
    assert.equal(attempts, 3, "L2 backs off and retries a 5xx inside the one stage call");
    const again = await ensureLedger({ profile: null, resumeText: GOLDEN, pin: PIN, fetchImpl, callStage: fastStage });
    assert.equal(again.rebuilt, false);
    assert.equal(calls.length, attempts, "the failed stage is not repeated for an unchanged resume");
  });
});
