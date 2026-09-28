import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { loadVoicePack } from "../server/materials-delint.mjs";
import { delint } from "../server/materials-delint.mjs";
import { voiceProfileLines } from "../server/materials-draft.mjs";
import { buildRenderModelFromDraft } from "../server/materials-render-model-adapter.mjs";
import { linkify } from "../server/materials-render.mjs";
import { applySupport, letterSentenceGrounding, scoreRubric } from "../server/materials-rubric.mjs";
import { checkLetterSupport, parseVerdicts, supportPrompt, SUPPORT_SYSTEM_PROMPT } from "../server/materials-support.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { parseVoiceProfile, voiceClaims, withVoiceClaims } from "../server/materials-voice-profile.mjs";
import { detectAiWords, detectCannedAsides, detectOffVoice, soundsHumanRow } from "../server/materials-voice-tells.mjs";
import { rubricIssues } from "../server/materials-qa.mjs";
import { parseStageJson } from "../server/materials-writer.mjs";

const VOICE_MD = readFileSync(new URL("./fixtures/materials-voice/voice.md", import.meta.url), "utf8");
const PROFILE = parseVoiceProfile(VOICE_MD, "/fixture/voice.md");
const RECORDED = JSON.parse(readFileSync(new URL("./fixtures/materials-voice/support-reply.json", import.meta.url), "utf8"));
const LEDGER = {
  employers: [{ id: "cascade", name: "Cascade Logistics", title: "Fleet Analyst" }],
  claims: [
    { id: "c1", employerId: "cascade", text: "Rebuilt the route forecaster for 620 vans and cut missed windows from 9.1% to 4.3%.", metrics: [{ token: "620" }, { token: "9.1%" }, { token: "4.3%" }] },
    { id: "c2", employerId: "cascade", text: "Ran a Monday readout for 14 dispatch leads.", metrics: [{ token: "14" }] },
  ],
};

describe("voice.md parsing", () => {
  it("should read the facts from the core narrative, threads, samples, phrasing and approved clients", () => {
    assert.ok(PROFILE.facts.includes("I'm a fleet analyst and tool builder."));
    assert.ok(PROFILE.facts.some((f) => /ended owning the route forecaster for 620 vans/.test(f)));
    assert.ok(PROFILE.facts.includes("Lumen Grocers, 40 stores."));
    assert.ok(PROFILE.facts.some((f) => /^Clients include Lumen Grocers, Harbor Co-op, Pine Freight\.$/.test(f)));
    assert.ok(PROFILE.facts.some((f) => /^Tool builder: RouteLab/.test(f)), "numbered threads, markdown stripped");
  });

  it("should keep signature lines verbatim and read the project links", () => {
    assert.ok(PROFILE.signatureLines.includes("The best forecasters aren't just modelers — they're drivers' advocates."));
    assert.ok(PROFILE.signatureLines.includes("I know what dispatchers need because I sat in the chair."));
    assert.deepEqual(PROFILE.links, [{ text: "RouteLab", href: "https://routelab.example" }]);
  });

  it("should turn the avoid list into tells, without the 'use' gloss or over-broad stems", () => {
    const text = "I spearheaded it, leveraged a model, was let go, and wanted to move the needle. I use the first van.";
    const hits = detectAiWords(text, PROFILE.avoid).map((h) => h.text.toLowerCase());
    for (const expected of ["spearheaded", "leveraged", "let go", "move the needle"]) assert.ok(hits.includes(expected), `${expected}: ${hits.join(", ")}`);
    assert.ok(!hits.includes("use") && !hits.includes("first"), hits.join(", "));
  });

  it("should give the draft prompt the guide as source of truth, the facts, the signature lines and the projects", () => {
    const lines = voiceProfileLines(PROFILE).join("\n");
    assert.match(lines, /source of truth for voice, positioning and letter shape; where it conflicts with the shipped voice guide, follow this one/);
    assert.match(lines, /## cover letter voice rules/);
    assert.match(lines, /The lead is fleet analyst \+ tool builder/);
    assert.match(lines, /- voice-\d+: Lumen Grocers, 40 stores\./);
    assert.match(lines, /quoted EXACTLY as written, or not at all; never paraphrase them/);
    assert.match(lines, /Projects: write these names exactly as shown; they render as links: RouteLab\./);
    assert.deepEqual(voiceProfileLines(null), []);
  });
});

describe("voice facts are approved claims", () => {
  it("should carry provenance 'voice' and their own numbers as metric tokens", () => {
    const claims = voiceClaims(PROFILE);
    const stores = claims.find((c) => c.text === "Lumen Grocers, 40 stores.");
    assert.ok(stores);
    assert.equal(stores.provenance.source, "voice");
    assert.deepEqual(stores.metrics, [{ token: "40" }]);
  });

  it("should ground a sentence that restates a voice fact, which the ledger alone cannot", () => {
    const draft = { letter: { proof1: "I ran forecasts for Lumen Grocers across 40 stores." } };
    const bare = letterSentenceGrounding({ draft, ledger: LEDGER, company: "Lumen Parcel" });
    assert.equal(bare[0].grounded, false);
    const withVoice = letterSentenceGrounding({ draft, ledger: withVoiceClaims(LEDGER, PROFILE), company: "Lumen Parcel" });
    assert.equal(withVoice[0].grounded, true, withVoice[0].reason);
  });
});

describe("signature lines are exempt from the tell lint only when quoted exactly", () => {
  const exact = "The best forecasters aren't just modelers — they're drivers' advocates.";
  const paraphrase = "Good forecasters aren't just modelers — they're drivers' advocates.";
  const letter = (line) => [
    `${line} I'm a fleet analyst and tool builder with six years at Cascade Logistics, and Lumen Parcel runs the kind of fleet I know.`,
    "At Cascade I rebuilt the route forecaster for 620 vans and cut missed windows from 9.1% to 4.3%. I ran a Monday readout for 14 dispatch leads.",
    "Send me one week of Lumen Parcel's route data and I'll show you where the model and the drivers disagree.",
  ];

  it("should not flag the exact quote", () => {
    const row = soundsHumanRow(letter(exact), { company: "Lumen Parcel", signatureLines: PROFILE.signatureLines });
    assert.ok(!row.tells.some((t) => t.code === "contrast_frame"), row.note);
  });

  it("should flag a paraphrase of it", () => {
    const row = soundsHumanRow(letter(paraphrase), { company: "Lumen Parcel", signatureLines: PROFILE.signatureLines });
    assert.ok(row.tells.some((t) => t.code === "contrast_frame"), row.note);
  });

  it("should exempt the exact quote in delint too", async () => {
    const pack = { ...(await loadVoicePack()), signatureLines: PROFILE.signatureLines };
    const hits = (text) => delint({ fields: { "letter.hook": text }, pack }).spans.filter((s) => s.code === "contrast_frame").length;
    assert.equal(hits(exact), 0);
    assert.equal(hits(paraphrase), 1);
  });
});

describe("off-voice tells from the user's 'not' list", () => {
  it("should flag flattery, false humility, compensation and departure framing", () => {
    const codes = detectOffVoice(
      "I have long admired Acme. I might not have the perfect background. My salary target is $150k. I was laid off in March.",
    ).map((h) => h.code);
    assert.deepEqual(codes, ["flattery", "false_humility", "compensation", "departure_framing"]);
    assert.deepEqual(detectOffVoice("My role ended as part of a broader restructure. I ran 620 vans."), []);
  });

  it("should flag canned asides and leave real short sentences alone", () => {
    for (const aside of ["The math kept our planning grounded.", "The lift proved the model.", "It took daily discipline.", "The fix was boring."]) {
      assert.equal(detectCannedAsides(aside).length, 1, aside);
    }
    for (const line of ["I sell and ship.", "Routes are promises with wheels on them.", "I ran 620 vans.", "That is the job."]) {
      assert.equal(detectCannedAsides(line).length, 0, line);
    }
  });
});

describe("meaning-level support check (recorded reply)", () => {
  const draft = { letter: RECORDED.letter };
  const ledger = withVoiceClaims(LEDGER, PROFILE);

  it("should number every sentence and list claims plus voice facts in the prompt", () => {
    const { userText, sentences } = supportPrompt({ draft, ledger: { ...ledger, employers: [{ name: "Cascade Logistics", title: "Fleet Analyst", start: "2019", end: "2025" }] }, postingText: "Lumen Parcel runs a regional delivery fleet.", company: "Lumen Parcel", title: "Fleet Director" });
    assert.match(userText, /^The letter is addressed to Lumen Parcel for the Fleet Director role\. Naming Lumen Parcel, the role, or what the candidate wants to do there is not a claim to check\./m);
    assert.match(userText, /^- employer: Cascade Logistics · Fleet Analyst · 2019–2025$/m);
    assert.equal(sentences.length, 5);
    assert.match(userText, /^- c1: Rebuilt the route forecaster/m);
    assert.match(userText, /^- voice-1: I'm a fleet analyst and tool builder\./m);
    assert.match(userText, /^2\. I rebuilt the route forecaster for the Harbor Co-op's 90 drivers\./m);
    assert.match(SUPPORT_SYSTEM_PROMPT, /Judge strictly/);
  });

  it("should parse the recorded reply and keep sentence order", () => {
    const { sentences } = supportPrompt({ draft, ledger });
    const verdicts = parseVerdicts(RECORDED.reply, sentences);
    assert.equal(verdicts?.length, 5);
    assert.equal(verdicts?.[1].supported, false);
    assert.equal(verdicts?.[1].source, "c1");
    assert.equal(verdicts?.[4].factual, false);
    assert.equal(parseVerdicts({ nope: 1 }, sentences), null);
  });

  it("should catch the connective claim the overlap check passes, and send it to the repair", async () => {
    const overlap = letterSentenceGrounding({ draft, ledger, company: "Lumen Parcel" });
    const invented = overlap.find((j) => /Harbor Co-op/.test(j.sentence));
    /* Every word and number is a claim's or a voice fact's, so the overlap
     * judgement alone passes the invented pairing. */
    assert.equal(invented?.grounded, true, invented?.reason);
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(RECORDED.reply) } }] }) });
    const pin = { provider: "local", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
    const { verdicts } = await checkLetterSupport({ draft, ledger, pin, fetchImpl });
    const judged = applySupport(overlap, verdicts);
    const flagged = judged.find((j) => /Harbor Co-op/.test(j.sentence));
    assert.equal(flagged?.grounded, false);
    assert.match(flagged?.reason || "", /unsupported in meaning: no source says the forecaster was built for the Harbor Co-op/);
    assert.match(flagged?.reason || "", /rewrite from c1/);

    const rubric = scoreRubric({ document: "letter", extract: {}, selection: {}, ledger, draft, company: "Lumen Parcel", support: verdicts });
    const row = rubric.rows.find((r) => r.id === "letter_ungrounded");
    assert.equal(row?.score, 0);
    assert.match(row?.note || "", /rewrite each from one named claim's own words/);
    assert.ok(rubricIssues("letter", rubric).some((i) => i.code === "letter_ungrounded" && i.severity === "fail"));
  });

  it("should fall back to the overlap check with no pin", async () => {
    const { verdicts } = await checkLetterSupport({ draft, ledger, pin: null, fetchImpl: async () => { throw new Error("no call"); } });
    assert.equal(verdicts, null);
    const overlap = letterSentenceGrounding({ draft, ledger, company: "Lumen Parcel" });
    assert.deepEqual(applySupport(overlap, verdicts), overlap);
  });
});

describe("project links", () => {
  it("should link the first plain occurrence of a project name, escaped, http(s) only", () => {
    assert.equal(
      linkify("I built RouteLab. RouteLab again.", [{ text: "RouteLab", href: "https://routelab.example" }]),
      '<a class="proj" href="https://routelab.example">RouteLab</a>. RouteLab again.'.replace(/^/, "I built "),
    );
    assert.equal(linkify("I built RouteLab.", [{ text: "RouteLab", href: "javascript:alert(1)" }]), "I built RouteLab.");
  });

  it("should attach links to the letter paragraph that names the project, in three paragraphs", () => {
    const model = buildRenderModelFromDraft({
      draft: { statement: "", bullets: [], earlier: [], letter: { hook: "I built RouteLab.", companyInsight: "", proof1: "I ran 620 vans.", proof2: "I ran 14 leads.", ask: "Send the data." } },
      outline: { featured: [], earlier: [], toolsLine: [] },
      ledger: LEDGER,
      resumeText: "Priya Raman\npriya@example.com",
      request: { company: "Lumen Parcel", title: "Fleet Analyst" },
      family: resolveFamily("signal"),
      nowIso: "2026-09-27T00:00:00Z",
      links: PROFILE.links,
    });
    const paragraphs = model.documents.coverLetter.paragraphs;
    assert.equal(paragraphs.length, 3);
    assert.deepEqual(paragraphs[0].links, [{ text: "RouteLab", href: "https://routelab.example" }]);
    assert.equal(paragraphs[1].text, "I ran 620 vans. I ran 14 leads.");
    assert.equal(paragraphs[1].links, undefined);
  });
});

describe("company praise is flattery", () => {
  it("should flag the company as subject with an admiring verdict, and pass a plain fact", async () => {
    const { detectCompanyPraise } = await import("../server/materials-voice-tells.mjs");
    assert.equal(detectCompanyPraise("NorthwindMedia turns broadcast reach into digital scale better than anyone, and bridging that gap is where I live.", "NorthwindMedia, Inc.").length, 1);
    assert.equal(detectCompanyPraise("Lumen Parcel is an industry-leading fleet.", "Lumen Parcel").length, 1);
    assert.equal(detectCompanyPraise("NorthwindMedia reaches 88% of Americans every month.", "NorthwindMedia, Inc.").length, 0);
    assert.equal(detectCompanyPraise("The best forecasters aren't just modelers.", "Lumen Parcel").length, 0, "praise not about the company");
    const row = soundsHumanRow(["NorthwindMedia turns broadcast reach into digital scale better than anyone, and I want in.", "I ran 620 vans. Short one.", "Send the data."], { company: "NorthwindMedia" });
    assert.ok(row.tells.some((t) => t.code === "flattery"), row.note);
  });
});

describe("support check on a recorded live reply", () => {
  it("should parse the model's raw reply and flag the invented clause it named", () => {
    const live = JSON.parse(readFileSync(new URL("./fixtures/materials-voice/support-reply-live.json", import.meta.url), "utf8"));
    const value = parseStageJson(live.replyText);
    const verdicts = parseVerdicts(value, live.sentences.map((sentence) => ({ beat: "letter", sentence })));
    assert.equal(verdicts?.length, live.sentences.length);
    const bad = (verdicts || []).filter((v) => v.factual && v.supported === false);
    assert.equal(bad.length, 1);
    assert.match(bad[0].sentence, /protected profit margins/);
    assert.match(bad[0].reason, /protected profit margins not in sources/);
  });
});

describe("purpose-clause openers", () => {
  it("should flag 'To <verb> …, I' and 'In order to' openers, not a plain 'To' phrase", async () => {
    const { detectPurposeOpeners } = await import("../server/materials-voice-tells.mjs");
    assert.equal(detectPurposeOpeners("To scale that revenue strategy, I supported 12 AE desks.").length, 1);
    assert.equal(detectPurposeOpeners("In order to grow, we hired.").length, 1);
    assert.equal(detectPurposeOpeners("I supported 12 AE desks to scale the strategy. To date it works.").length, 0);
    const row = soundsHumanRow(["To scale that revenue strategy, I supported 12 AE desks at Cascade Logistics for Lumen Parcel.", "I ran 620 vans.", "Send the data."], { company: "Lumen Parcel" });
    assert.ok(row.tells.some((t) => t.code === "purpose_opener" && t.weight === "hard"), row.note);
  });
});
