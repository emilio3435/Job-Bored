import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  abstractionDensity,
  detectAiWords,
  detectCloser,
  detectContrastFrames,
  detectEmDashOveruse,
  detectGush,
  detectOpener,
  detectTricolonStacks,
  letterParagraphs,
  sentenceRhythm,
  soundsHumanRow,
  voiceTells,
} from "../server/materials-voice-tells.mjs";
import { delint, loadVoicePack } from "../server/materials-delint.mjs";
import { draftPromptLines, draftSystemPrompt, voiceGuide } from "../server/materials-draft.mjs";

const RECORDED = JSON.parse(
  readFileSync(new URL("./fixtures/materials-voice/recorded-letters.json", import.meta.url), "utf8"),
);

/* A fictional candidate, written by hand: specific hook tied to the
 * writer, exact numbers with how they were measured, one aside, a short
 * sentence, a concrete and slightly playful close. */
const GOOD_POSTING =
  "Lumen Parcel runs a regional delivery fleet. The Director of Fleet Analytics owns route forecasting, dispatch reporting and weekly readouts for operations leadership.";
const GOOD_LETTER = [
  "Lumen Parcel's posting mentions 1,400 vans and a routing model nobody trusts on snow days. I spent three winters at Cascade Logistics rebuilding that kind of model, mostly by watching it fail.",
  "At Cascade I rebuilt the route forecaster for 620 vans and cut missed delivery windows from 9.1% to 4.3%, measured against scanned delivery times over two quarters. The fix was boring: I stopped trusting the planner's estimates and started logging what drivers actually did.",
  "I also ran a Monday readout for 14 dispatch leads. It began as a spreadsheet I kept for myself. By month three it was the meeting.",
  "Here's my offer: send me one week of Lumen Parcel's route data and I'll bring back a one-page readout of where the model and the drivers disagree. If I'm wrong, you'll know within an hour.",
];

describe("voice tells: word-level detectors", () => {
  it("should flag AI words (delve, tapestry, leverage, robust, seamless, holistic, cutting-edge, landscape, fast-paced)", () => {
    const text =
      "I delve into a rich tapestry of data, leveraging robust, seamless and holistic cutting-edge tools to navigate the complex landscape in today's fast-paced market. It stands as a testament to synergy.";
    const notes = detectAiWords(text).map((h) => h.note);
    for (const expected of ["delve", "tapestry", "leverage as a verb", "robust", "seamless", "holistic", "cutting-edge", "navigate the landscape", "in today's fast-paced", "testament", "synergy"]) {
      assert.ok(notes.includes(expected), `missing ${expected}: ${notes.join(", ")}`);
    }
  });

  it("should not flag plain builder language as AI words", () => {
    assert.deepEqual(detectAiWords(GOOD_LETTER.join(" ")), []);
    assert.deepEqual(detectAiWords("I rebuilt the forecaster and tested it against 24+ real pitches."), []);
  });

  it("should flag gush and leave plain warmth alone", () => {
    assert.equal(detectGush("I am passionate about radio and thrilled by this dream role.").length, 3);
    assert.equal(detectGush("I'm excited to apply.").length, 1);
    assert.deepEqual(detectGush("I like this problem. It's a good one."), []);
  });

  it("should flag 'not X, but Y' and 'it's not just X, it's Y' framing", () => {
    assert.ok(detectContrastFrames("It's not just a forecast, it's a promise.").length >= 1);
    assert.ok(detectContrastFrames("This is not only about reach but also about trust.").length >= 1);
    assert.ok(detectContrastFrames("Durable adoption rather than raw deployment volume.").length >= 1);
    assert.ok(detectContrastFrames("The answer was not more reps, but better pitches.").length >= 1);
    assert.deepEqual(detectContrastFrames("Fictional Labs checks route logs instead of guessing."), []);
  });

  it("should not flag a plain negative sentence as contrast framing", () => {
    assert.deepEqual(detectContrastFrames("I did not expect the forecaster to break on holidays."), []);
    assert.deepEqual(detectContrastFrames(GOOD_LETTER.join(" ")), []);
  });
});

describe("voice tells: rhythm and density detectors", () => {
  it("should flag stacked tricolons and pass a single list", () => {
    const stacked = "I coached for trust, clarity, and speed. We sold reach, frequency, and loyalty. It worked.";
    assert.equal(detectTricolonStacks(stacked).stacked, true);
    const single = "I coached for trust, clarity, and speed. Then I went home. The forecast held.";
    /* Named, concrete lists are specificity, not cadence. */
    const concrete = "I managed search, social, connected-TV, and streaming-audio campaigns. Clients included Western Dental, Arbor Motors, and Bellco. It worked.";
    assert.equal(detectTricolonStacks(concrete).stacked, false);
    assert.equal(detectTricolonStacks(single).stacked, false);
  });

  it("should flag more than one em-dash in a paragraph", () => {
    assert.deepEqual(detectEmDashOveruse(["One — two — three.", "Fine — once."]), [{ paragraph: 0, count: 2 }]);
    assert.deepEqual(detectEmDashOveruse(["Fine — once.", "None here."]), []);
  });

  it("should count abstract nouns that float free of numbers and concrete things", () => {
    const floaty = "Scaling enterprise strategy requires clear governance frameworks so that adoption delivers impact and alignment.";
    const high = abstractionDensity(floaty, { company: "Seabright" });
    assert.ok(high.unanchored.length >= 5, `unanchored: ${high.unanchored.join(",")}`);
    const anchored = abstractionDensity("I ran enablement for 12 AE desks and a strategy review every quarter with SampleCRM.", {});
    assert.equal(anchored.unanchored.length, 0, `unanchored: ${anchored.unanchored.join(",")}`);
  });

  it("should not let the hiring company's own name anchor an abstraction", () => {
    const r = abstractionDensity("Seabright adoption governance impact.", { company: "Seabright" });
    assert.deepEqual(r.unanchored, ["adoption", "governance", "impact"]);
  });

  it("should measure sentence rhythm: flat lengths versus a short sentence among long ones", () => {
    const flat = sentenceRhythm("I built one tool for the desk last year. I ran the pitch cadence for the team. I tuned the forecast on real data. I wrote the playbook for every new rep.");
    assert.ok(flat.cv < 0.3, `cv ${flat.cv}`);
    const varied = sentenceRhythm(GOOD_LETTER.join(" "));
    assert.ok(varied.cv >= 0.3 && varied.shortest <= 9, `cv ${varied.cv} shortest ${varied.shortest}`);
  });
});

describe("voice tells: openers and closers", () => {
  it("should flag stock openers", () => {
    for (const opener of [
      "I am writing to apply for the Director role.",
      "With 10+ years in digital media, I bring deep expertise.",
      "As a seasoned sales leader with 12 years of experience, I lead teams.",
      "I'm excited to apply for this role.",
    ]) {
      assert.equal(detectOpener(opener)?.code, "generic_opener", opener);
    }
  });

  it("should flag an opener that restates what the posting says the company needs", () => {
    assert.equal(detectOpener("Seabright requires operational acceleration that prioritizes durable adoption depth.")?.code, "posting_opener");
    assert.equal(detectOpener("Acme is hiring a Director to own pipeline math. That is the work I do.")?.code, "posting_opener");
  });

  it("should flag an opening paragraph that never ties the company to the writer", () => {
    assert.equal(detectOpener("Lumen Parcel moves boxes across three states. The fleet is large.")?.code, "untied_hook");
  });

  it("should pass a specific opener tied to the writer", () => {
    assert.equal(detectOpener(GOOD_LETTER[0], { postingText: GOOD_POSTING }), null);
    assert.equal(detectOpener("NorthwindMedia reaches 88% of Americans every month, and I spent eight years selling the other side of that dial at Contoso."), null);
  });

  it("should flag stock closers and pass a concrete, playful next step", () => {
    for (const closer of [
      "I would value the chance to explore how I would set up governance at Seabright.",
      "I look forward to hearing from you.",
      "Thank you for your consideration.",
      "I would be a valuable addition to the team.",
    ]) {
      assert.equal(detectCloser(closer)?.code, "generic_closer", closer);
    }
    assert.equal(detectCloser(GOOD_LETTER[3]), null);
  });
});

describe("sounds_human rubric row", () => {
  for (const [name, fixture] of Object.entries(RECORDED).filter(([k]) => k !== "note")) {
    it(`should FAIL the recorded boilerplate ${name} letter`, () => {
      const row = soundsHumanRow(fixture.paragraphs, { company: fixture.company, postingText: fixture.postingText });
      assert.equal(row.score, 0, row.note);
      assert.ok(row.tells.some((t) => t.weight === "hard"), row.note);
    });
  }

  it("should flag the Seabright opener as posting restatement and its closer as stock", () => {
    const { tells } = voiceTells(RECORDED.seabrightLive.paragraphs, { company: "Seabright" });
    const codes = tells.map((t) => t.code);
    assert.ok(codes.includes("posting_opener"), codes.join(","));
    assert.ok(codes.includes("generic_closer"), codes.join(","));
    assert.ok(codes.includes("abstraction_density"), codes.join(","));
  });

  it("should PASS the hand-written fictional letter with a 2", () => {
    const row = soundsHumanRow(GOOD_LETTER, { company: "Lumen Parcel", postingText: GOOD_POSTING });
    assert.equal(row.score, 2, row.note);
    assert.equal(row.note, "no machine tells");
  });

  it("S1: confident verbs like drove and led are not voice penalties", () => {
    const paragraphs = [
      "I drove the forecast rollout for Lumen Parcel's regional fleet.",
      "I led the work end-to-end and cut missed windows by 20%.",
      "I would bring that practical eye to next week's route review.",
    ];
    const row = soundsHumanRow(paragraphs, { company: "Lumen Parcel" });
    assert.ok(!row.tells.some((tell) => /\b(?:drove|led)\b/i.test(tell.text)), row.note);
    assert.deepEqual(detectAiWords(paragraphs.join(" ")).filter((hit) => /\b(?:drove|led)\b/i.test(hit.text)), []);
  });

  it("should score soft tells as 1 (review) and never 0: only a hard tell fails", () => {
    const oneSoft = [...GOOD_LETTER.slice(0, 3), "Here's my offer — a one-page readout — on Lumen Parcel's routes. Send the data."];
    assert.equal(soundsHumanRow(oneSoft, { company: "Lumen Parcel" }).score, 1);
    const flat = [
      "At Cascade I rebuilt a route model for the vans in the north region. I ran the dispatch readout for the leads every Monday morning.",
      "I cut missed windows on the northern routes by half in two quarters. I trained the planners to trust the logged driver times.",
      "Here's my offer — a readout — on Lumen Parcel's routes — this month. I can have a draft of it ready for your leads in a week.",
    ];
    const row = soundsHumanRow(flat, { company: "Lumen Parcel" });
    assert.ok(row.tells.filter((t) => t.weight === "soft").length >= 2, row.note);
    assert.equal(row.score, 1);
  });

  it("should read v2 beats as three paragraphs: hook + companyInsight, proof1 + proof2, ask", () => {
    assert.deepEqual(letterParagraphs({ hook: "A.", companyInsight: "B.", proof1: "C.", proof2: "D.", ask: "E." }), ["A. B.", "C. D.", "E."]);
  });
});

describe("delint carries the voice tells to the rewrite", () => {
  it("should emit failing spans for the opener, the closer and AI words on the beats the rewrite can edit", async () => {
    const pack = await loadVoicePack();
    const [p0, p1, p2, p3] = RECORDED.seabrightLive.paragraphs;
    const letter = { hook: p0, companyInsight: "", proof1: p1, proof2: p2, ask: p3 };
    const fields = { "letter.hook": p0, "letter.proof1": p1, "letter.proof2": p2, "letter.ask": p3 + " It is a robust plan." };
    const { spans } = delint({ fields, letter: { ...letter, ask: fields["letter.ask"] }, company: "Seabright", pack });
    const by = (/** @type {string} */ code) => spans.filter((s) => s.code === code);
    assert.equal(by("posting_opener")[0]?.field, "letter.hook");
    assert.equal(by("generic_closer")[0]?.field, "letter.ask");
    assert.ok(by("ai_word").some((s) => s.field === "letter.ask" && /robust/i.test(s.text)));
    assert.ok(by("ai_word").some((s) => s.field === "letter.hook" && /durable adoption/i.test(s.text)), "the pack's aiTells extend the defaults");
    assert.ok(spans.filter((s) => s.field.startsWith("letter.")).some((s) => s.severity === "fail"));
  });

  it("should flag a buzzword-chain summary line and pass a specific one", async () => {
    const pack = await loadVoicePack();
    const chain = delint({ fields: { statement: "Strategic leader driving adoption, alignment and governance for enterprise transformation." }, pack });
    assert.ok(chain.spans.some((s) => s.code === "buzzword_chain"), JSON.stringify(chain.spans));
    const specific = delint({ fields: { statement: "Digital sales leader who coached 12 AE desks at Contoso and builds his own forecasting tools on weekends." }, pack });
    assert.ok(!specific.spans.some((s) => s.code === "buzzword_chain" || s.code === "ai_word"), JSON.stringify(specific.spans));
  });

  it("should leave the hand-written letter clean", async () => {
    const pack = await loadVoicePack();
    const letter = { hook: GOOD_LETTER[0], companyInsight: "", proof1: GOOD_LETTER[1], proof2: GOOD_LETTER[2], ask: GOOD_LETTER[3] };
    const fields = Object.fromEntries(Object.entries(letter).filter(([, v]) => v).map(([k, v]) => [`letter.${k}`, v]));
    const { spans } = delint({ fields, letter, company: "Lumen Parcel", jdText: GOOD_POSTING, pack });
    assert.deepEqual(spans, []);
  });
});

describe("voice guide reaches the draft prompt", () => {
  it("should carry the one voice guide in the system prompt", () => {
    const system = draftSystemPrompt([180, 260]);
    const guide = voiceGuide();
    const rewrittenOneLine = guide.oneLine?.replace(/and is exact about every number/i, "handles numbers carefully and allows modest rounding when faithful to a claim");
    assert.ok(rewrittenOneLine && system.includes(rewrittenOneLine), "oneLine is adapted for MREV-8 rounding");
    assert.ok(guide.persona && system.includes(guide.persona), "persona");
    for (const line of (guide.do || []).filter((line) => !/at least one sentence|two or three sentences|three or four sentences|^Hook:/i.test(line))) {
      const rewritten = /^Rigor:/i.test(line)
        ? "Rigor: every number stays grounded in a claim and keeps its unit; modest rounding is allowed when faithful (for example, 21 can be written as 20+). Never invent a number."
        : line;
      assert.ok(system.includes(rewritten), `do: ${line}`);
    }
    for (const line of (guide.dont || []).filter((line) => !/^Stock closers:/i.test(line))) assert.ok(system.includes(line), `dont: ${line}`);
    assert.ok(guide.summary && draftSystemPrompt([180, 260], "resume").includes(guide.summary), "resume summary line rule");
    assert.ok(!system.includes(guide.summary), "letter has no summary quota");
    assert.match(system, /whimsical, curious inventor with an analyst's eye/);
    assert.match(system, /open with what the company requires, needs or seeks/);
    assert.match(system, /three short letter paragraphs/);
    assert.doesNotMatch(system, /at least one sentence of nine words|3-4 sentences/);
    assert.doesNotMatch(system, /never round up|exact about every number/i);
    assert.match(system, /never a made-up aside/);
    assert.match(system, /Letter band: 180-260 words/);
  });

  it("should keep the voice guide free of numerals, so no example number leaks into a letter", () => {
    const text = JSON.stringify(voiceGuide());
    assert.doesNotMatch(text, /\d/);
  });

  it("should ask for verified work and a fresh ask without sentence quotas", () => {
    const lines = draftPromptLines({
      outline: { featured: [], earlier: [], letterBeats: { hook: "o1", proof1: "c1", proof1Pain: "o1", proof2: "c2", proof2Pain: "o1" } },
      extract: { role: { company: "Lumen Parcel", title: "Director of Fleet Analytics", family: "analytics" }, outcomes: [{ id: "o1", text: "Own route forecasting." }], nouns: [], companyFacts: [] },
      ledger: { employers: [], claims: [{ id: "c1", text: "Rebuilt the route forecaster for 620 vans." }, { id: "c2", text: "Ran a Monday readout for 14 dispatch leads." }] },
      feature: "cover_letter",
      featuredIds: [],
      earlierIds: [],
    }).join("\n");
    assert.match(lines, /Opening reason: state a specific reason to apply for this role, drawn from the posting and connected to candidate evidence/);
    assert.match(lines, /close with a specific next step and a fresh short ask/);
    assert.doesNotMatch(lines, /2-3 sentences|3-4 sentences|ask, 2 sentences/);
  });
});
