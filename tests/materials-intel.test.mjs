/**
 * Wave 3 (C-6): the company intel pack — posting first, ≤ 2 grounded
 * searches, the brand resolver, a 30-day per-domain cache, and a degrade
 * to the posting alone on any failure. The support check accepts an
 * intel fact only when it is cited from the pack. No test touches the
 * network: the search is always a stub.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  INTEL_CONTRACT,
  buildIntelPack,
  cleanDate,
  companyDomain,
  enforceIntelCitations,
  intelFacts,
  intelGroundingText,
  intelKey,
  intelPromptLines,
  isGrounded,
  parseGeminiGrounding,
  parseSearchJson,
  postingTone,
  readCachedIntel,
  searchPrompts,
  sourceFor,
} from "../server/materials-intel.mjs";
import { SUPPORT_INTEL_RULE, checkLetterSupport, supportPrompt } from "../server/materials-support.mjs";
import { scoreRubric } from "../server/materials-rubric.mjs";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const POSTING = [
  "About Acme Analytics",
  "Acme Analytics is the leading warehouse analytics platform for 4,000 retail brands.",
  "Our mission is to make every spend decision measurable.",
  "",
  "The role",
  "You will own pipeline math with analysts and ship streaming ingestion for analytics events.",
  "Apply at https://careers.acmeanalytics.com/jobs/123 or email jobs@acmeanalytics.com.",
].join("\n");

const EXTRACT = {
  role: { title: "Data Platform Engineer", company: "Acme Analytics" },
  outcomes: [
    { id: "o1", text: "Own pipeline math with analysts", weight: 0.9 },
    { id: "o2", text: "Ship streaming ingestion for analytics events", weight: 0.8 },
  ],
};
const OUTLINE = { letterBeats: { proof1: "c1", proof1Pain: "o1", proof2: "c2", proof2Pain: "o2" } };

/** A grounded reply: JSON text plus grounding chunks and supports. */
function grounded(json, sources, supports) {
  return { text: `\`\`\`json\n${JSON.stringify(json)}\n\`\`\``, sources, supports };
}

const NEWS_REPLY = grounded(
  {
    news: [
      { headline: "Acme Analytics launches Spend Graph for retail media", date: "2026-08-14", summary: "Acme Analytics launched Spend Graph, a retail media measurement product.", relevance: "measurement" },
      { headline: "Acme Analytics names new CFO", date: "not a date", summary: "A new CFO joined.", relevance: "" },
      { headline: "Acme Analytics wins a prize nobody reported", date: "2026-07-01", summary: "Unsourced.", relevance: "" },
    ],
  },
  [
    { uri: "https://news.example.com/acme-spend-graph", title: "news.example.com" },
    { uri: "https://other.example.com/cfo", title: "other.example.com" },
  ],
  [
    { text: '"headline":"Acme Analytics launches Spend Graph for retail media"', sources: [0] },
    { text: "A new CFO joined.", sources: [1] },
  ],
);
const COMPANY_REPLY = grounded(
  {
    domain: "acmeanalytics.com",
    ticker: "",
    mission: "Acme Analytics makes every retail spend decision measurable.",
    products: [
      { name: "Spend Graph", oneLine: "Retail media measurement across 4,000 brands." },
      { name: "Phantom Suite", oneLine: "A product no source mentions." },
    ],
  },
  [
    { uri: "https://acmeanalytics.com/about", title: "acmeanalytics.com" },
    { uri: "https://acmeanalytics.com/products", title: "acmeanalytics.com" },
  ],
  [
    { text: "Acme Analytics makes every retail spend decision measurable.", sources: [0] },
    { text: "Retail media measurement across 4,000 brands.", sources: [1] },
  ],
);

/* One merged search per company: the news and company replies as one. */
const MERGED_REPLY = {
  text: `\`\`\`json\n${JSON.stringify({ ...JSON.parse(NEWS_REPLY.text.slice(8, -4)), ...JSON.parse(COMPANY_REPLY.text.slice(8, -4)) })}\n\`\`\``,
  sources: [...NEWS_REPLY.sources, ...COMPANY_REPLY.sources],
  supports: [...NEWS_REPLY.supports, ...COMPANY_REPLY.supports.map((s) => ({ ...s, sources: s.sources.map((i) => i + NEWS_REPLY.sources.length) }))],
  queries: ["acme analytics news 2026"],
};
const UNGROUNDED = (json) => ({ text: `\`\`\`json\n${JSON.stringify(json)}\n\`\`\``, sources: [], supports: [] });

/** Replies in call order ("search", then "retry"); an Error is thrown. */
function stubSearch(replies = [MERGED_REPLY]) {
  const calls = [];
  const search = async ({ kind, prompt }) => {
    calls.push({ kind, prompt });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { search, calls };
}

/* Real Gemini replies recorded on 2026-09-28 (tests/fixtures/intel). */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "intel");
const RECORDED_GROUNDED = parseGeminiGrounding(JSON.parse(readFileSync(join(FIXTURES, "gemini-grounded-northwind.json"), "utf8")));
const RECORDED_UNGROUNDED = parseGeminiGrounding(JSON.parse(readFileSync(join(FIXTURES, "gemini-ungrounded-northwind.json"), "utf8")));

describe("intel pack · build, cache and degrade", () => {
  let root;
  let appDir;
  let cacheRoot;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jb-intel-"));
    appDir = join(root, "app");
    cacheRoot = join(root, "intel");
    await (await import("node:fs/promises")).mkdir(appDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function input(extra = {}) {
    return {
      company: "Acme Analytics",
      title: "Data Platform Engineer",
      jobUrl: "https://boards.greenhouse.io/acme/jobs/123",
      postingText: POSTING,
      extract: EXTRACT,
      outline: OUTLINE,
      contact: "Jane Doe, VP Data",
      cacheRoot,
      appDir,
      now: NOW,
      ...extra,
    };
  }

  it("should build the pack from the posting and one grounded search, each fact dated and sourced", async () => {
    const { search, calls } = stubSearch();
    const out = await buildIntelPack(input({ search, resolveBrand: async () => ({ logoPath: "/logos/acme.png", source: "logo_resolver" }) }));
    assert.equal(calls.length, 1, "one merged search; grounded, so no retry");
    assert.equal(calls[0].kind, "search");
    assert.match(calls[0].prompt, /Use Google Search\. Answer only from search results; cite each fact\./);
    assert.equal(out.modelCalls, 1);
    assert.deepEqual(out.grounding.map(({ ms: _ms, ...a }) => a), [{ call: "search", grounded: true, sources: 4, queries: 1 }]);
    assert.equal(out.degraded, "");
    assert.equal(out.pack.contract, INTEL_CONTRACT);
    assert.equal(out.pack.ttlDays, 30);
    assert.deepEqual(out.pack.company, { name: "Acme Analytics", domain: "acmeanalytics.com" });
    /* Undated and unsourced news items are dropped, never invented. */
    assert.deepEqual(out.pack.news.map((n) => n.headline), ["Acme Analytics launches Spend Graph for retail media"]);
    assert.equal(out.pack.news[0].url, "https://news.example.com/acme-spend-graph");
    assert.equal(out.pack.news[0].date, "2026-08-14");
    assert.deepEqual(out.pack.products.map((p) => p.name), ["Spend Graph"], "an unsourced product is dropped");
    assert.equal(out.pack.brand.logoPath, "/logos/acme.png");
    assert.deepEqual(out.pack.people, { hiringManager: { name: "Jane Doe, VP Data", title: "", source: "sheet" } });
    assert.deepEqual(out.pack.jdPains.map((p) => p.id), ["o1", "o2"]);
    assert.match(out.pack.jdPains[1].jdQuote, /streaming ingestion/);
    assert.deepEqual(out.pack.proofMap, [
      { painId: "o1", claimId: "c1", why: "letter proof 1" },
      { painId: "o2", claimId: "c2", why: "letter proof 2" },
    ]);
    assert.equal(out.pack.budget.limitMs, 60_000, "Jordan's budget: 60 s");
    assert.ok(out.pack.budget.ms < 60_000);
    for (const fact of out.facts) {
      assert.match(fact.id, /^intel-\d+$/);
      assert.match(fact.url, /^https:\/\//);
      assert.match(fact.date, /^\d{4}-\d{2}/);
    }
    assert.deepEqual(out.facts.map((f) => f.kind), ["news", "product", "mission"]);
    /* Company facts cached per domain; the role half in the app dir. */
    const cached = JSON.parse(await readFile(join(cacheRoot, "acmeanalytics.com.json"), "utf8"));
    assert.equal(cached.contract, INTEL_CONTRACT);
    assert.equal(cached.jdPains, undefined, "the shared cache holds company facts only");
    const role = JSON.parse(await readFile(join(appDir, "intel.json"), "utf8"));
    assert.deepEqual(role.jdPains, out.pack.jdPains);
    assert.equal(role.cache.key, "acmeanalytics.com");
  });

  it("should reuse the cached company facts for 30 days with zero search calls", async () => {
    await buildIntelPack(input({ search: stubSearch().search }));
    const again = await buildIntelPack(input({
      search: async () => {
        throw new Error("must not search on a cache hit");
      },
      now: new Date(NOW.getTime() + 29 * 86_400_000),
    }));
    assert.equal(again.cacheHit, true);
    assert.equal(again.modelCalls, 0);
    assert.equal(again.degraded, "");
    assert.equal(again.pack.news.length, 1);
  });

  it("should search again once the 30-day TTL has passed", async () => {
    await buildIntelPack(input({ search: stubSearch().search }));
    const { search, calls } = stubSearch();
    const later = await buildIntelPack(input({ search, now: new Date(NOW.getTime() + 31 * 86_400_000) }));
    assert.equal(later.cacheHit, false);
    assert.equal(calls.length, 1);
    assert.equal(await readCachedIntel(cacheRoot, "acmeanalytics.com", NOW.getTime() + 62 * 86_400_000), null);
  });

  it("should degrade to the posting alone when a search fails, and cache nothing", async () => {
    const { search, calls } = stubSearch([new Error("HTTP 503")]);
    const out = await buildIntelPack(input({ search }));
    assert.match(out.degraded, /search: HTTP 503/);
    assert.equal(calls.length, 1, "an HTTP error is not an ungrounded answer: no retry");
    assert.deepEqual(out.facts, []);
    assert.equal(out.pack.mission, "Our mission is to make every spend decision measurable.");
    assert.ok(out.pack.postingFacts.length >= 1);
    assert.equal(existsSync(join(cacheRoot, "acmeanalytics.com.json")), false, "a failed pack is retried next time");
    assert.ok(existsSync(join(appDir, "intel.json")));
  });

  it("should stop at the budget when a search hangs and still return a posting-only pack", async () => {
    const started = Date.now();
    const out = await buildIntelPack(input({ search: () => new Promise(() => {}), budgetMs: 1800 }));
    assert.ok(Date.now() - started < 3000, `returned in ${Date.now() - started} ms`);
    assert.match(out.degraded, /budget/);
    assert.deepEqual(out.facts, []);
  });

  it("should build a posting-only pack with no search available, and never throw on a bad brand resolver", async () => {
    const out = await buildIntelPack(input({
      search: null,
      resolveBrand: async () => {
        throw new Error("resolver down");
      },
    }));
    assert.equal(out.modelCalls, 0);
    assert.match(out.degraded, /posting only/);
    assert.match(out.degraded, /brand: resolver down/);
    assert.deepEqual(out.pack.brand, { logoPath: "", source: "monogram" });
  });

  it("should retry once with the stricter prompt when the first reply is ungrounded, and use the grounded retry (recorded replies)", async () => {
    const { search, calls } = stubSearch([RECORDED_UNGROUNDED, RECORDED_GROUNDED]);
    const out = await buildIntelPack(input({ company: "NorthwindMedia", jobUrl: "https://www.theladders.com/job/x", search, postingText: "NorthwindMedia is the number one audio company in America." }));
    assert.deepEqual(calls.map((c) => c.kind), ["search", "retry"]);
    assert.match(calls[1].prompt, /You MUST call Google Search before answering/);
    assert.equal(out.modelCalls, 2);
    assert.deepEqual(out.grounding.map((a) => [a.call, a.grounded]), [["search", false], ["retry", true]]);
    assert.equal(out.degraded, "");
    const news = out.facts.filter((f) => f.kind === "news");
    assert.ok(news.length >= 1, JSON.stringify(out.facts));
    for (const f of out.facts) {
      assert.match(f.date, /^\d{4}-\d{2}/);
      assert.match(f.url, /^https:\/\//);
    }
    assert.ok(news.some((f) => /Butler\/Till/.test(f.text) && f.date === "2026-08-20"));
  });

  it("should fall back to the posting alone when both calls are ungrounded, drop every memory item and cache nothing (recorded reply)", async () => {
    assert.equal(isGrounded(RECORDED_UNGROUNDED), false);
    assert.match(RECORDED_UNGROUNDED.text, /"news"/, "the recorded reply does carry plausible JSON");
    const { search, calls } = stubSearch([RECORDED_UNGROUNDED, RECORDED_UNGROUNDED]);
    const out = await buildIntelPack(input({ search }));
    assert.equal(calls.length, 2, "one retry, no more");
    assert.deepEqual(out.grounding.map((a) => [a.call, a.grounded]), [["search", false], ["retry", false]]);
    assert.deepEqual(out.facts, []);
    assert.deepEqual(out.pack.news, []);
    assert.match(out.degraded, /search: not grounded after one retry \(posting only\)/);
    assert.equal(out.pack.mission, "Our mission is to make every spend decision measurable.");
    assert.equal(existsSync(join(cacheRoot, "acmeanalytics.com.json")), false, "an unsearched pack is never cached");
  });

  it("should not retry when the budget cannot fit a second call", async () => {
    let t = 0;
    const { search, calls } = stubSearch([UNGROUNDED({ news: [] }), MERGED_REPLY]);
    const slow = async (req) => {
      t += 59_000;
      return search(req);
    };
    const out = await buildIntelPack(input({ search: slow, clock: () => t }));
    assert.equal(calls.length, 1);
    assert.match(out.degraded, /retry: skipped, intel budget spent/);
  });

  it("should tie an item to a grounding chunk by the domain the model names, and only then", async () => {
    const result = {
      text: "",
      sources: [
        { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/a", title: "reuters.com" },
        { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/b", title: "acmeanalytics.com" },
      ],
      supports: [],
    };
    assert.equal(sourceFor(["Acme raises money"], result, "www.reuters.com")?.title, "reuters.com");
    assert.equal(sourceFor(["Acme raises money"], result, "madeup.example"), null, "a domain no chunk carries is refused");
    const twoPages = { text: "", supports: [], sources: [
      { uri: "https://acme.example/press/launch", title: "acme.example" },
      { uri: "https://acme.example/products", title: "acme.example" },
    ] };
    assert.equal(sourceFor(["Acme Graph"], twoPages, "acme.example"), null, "two pages from the named domain: which one is unknown, so neither");
  });

  it("should keep an unreadable search reply from inventing facts", async () => {
    const out = await buildIntelPack(input({
      search: stubSearch([{ ...MERGED_REPLY, text: "no json here" }]).search,
    }));
    assert.match(out.degraded, /search: unreadable reply/);
    assert.deepEqual(out.pack.news, []);
    assert.deepEqual(out.pack.products, []);
  });
});

describe("intel pack · helpers", () => {
  it("should find the company's own domain, never a job board's", () => {
    assert.equal(companyDomain({ company: "Acme Analytics", jobUrl: "https://boards.greenhouse.io/acme/1", postingText: POSTING }), "acmeanalytics.com");
    assert.equal(companyDomain({ company: "Acme Analytics", jobUrl: "https://careers.acmeanalytics.com/jobs/9" }), "acmeanalytics.com");
    assert.equal(companyDomain({ company: "NorthwindMedia, Inc.", jobUrl: "https://www.theladders.com/job/x" }), "");
    assert.equal(intelKey({ company: "NorthwindMedia, Inc.", domain: "" }), "northwindmedia");
  });

  it("should read grounding metadata and a fenced JSON reply", () => {
    const parsed = parseGeminiGrounding({
      candidates: [{
        content: { parts: [{ text: "```json\n{\"news\":[]}\n```" }] },
        groundingMetadata: {
          groundingChunks: [{ web: { uri: "https://a.example/x", title: "a.example" } }],
          groundingSupports: [{ segment: { text: "abc" }, groundingChunkIndices: [0] }],
        },
      }],
    });
    assert.deepEqual(parsed.sources, [{ uri: "https://a.example/x", title: "a.example" }]);
    assert.deepEqual(parsed.supports, [{ text: "abc", sources: [0] }]);
    assert.deepEqual(parseSearchJson(parsed.text), { news: [] });
    assert.equal(parseSearchJson("nothing"), null);
  });

  it("should tie an item to its grounding source, and refuse when it cannot", () => {
    const src = sourceFor(["Acme Analytics launches Spend Graph for retail media"], NEWS_REPLY);
    assert.equal(src?.uri, "https://news.example.com/acme-spend-graph");
    assert.equal(sourceFor(["Something no segment says at all"], NEWS_REPLY), null);
  });

  it("should accept only real, recent dates", () => {
    const now = NOW.getTime();
    assert.equal(cleanDate("2026-08-14", now), "2026-08-14");
    assert.equal(cleanDate("2026-08", now), "2026-08");
    assert.equal(cleanDate("2027-01-01", now), "", "future");
    assert.equal(cleanDate("2019-01-01", now), "", "too old");
    assert.equal(cleanDate("August 2026", now), "");
  });

  it("should read the posting's register", () => {
    assert.equal(postingTone("We're hiring! Join us! You'll love it! Big wins! Fun team!").register, "playful");
    assert.equal(postingTone(POSTING).register, "formal");
  });

  it("should state the search prompts' limits", () => {
    const p = searchPrompts({ company: "Acme Analytics", domain: "acmeanalytics.com", title: "Data Platform Engineer", today: "2026-09-27" });
    assert.match(p.search, /last 12 months/);
    assert.match(p.search, /Never guess a date/);
    assert.match(p.search, /products: at most 4/);
    assert.match(p.search, /"news":\[/);
    assert.match(p.search, /"products":\[/);
    assert.match(p.retry, /You MUST call Google Search/);
    assert.match(p.retry, /Do not answer from memory/);
  });

  it("should number the citeable facts and render them for the prompt and the grounding text", () => {
    const pack = {
      fetchedAt: "2026-09-27T12:00:00.000Z",
      news: [{ headline: "Acme launches Spend Graph", date: "2026-08-14", url: "https://news.example.com/a", summary: "Spend Graph measures retail media." }],
      products: [{ name: "Spend Graph", oneLine: "Retail media measurement.", url: "https://acme.example/p" }],
      mission: "Posting mission",
      missionSource: { kind: "posting", url: "" },
    };
    const facts = intelFacts(pack);
    assert.deepEqual(facts.map((f) => f.id), ["intel-1", "intel-2"]);
    assert.equal(facts[1].date, "2026-09-27", "an undated kind carries the pack's as-of date");
    const lines = intelPromptLines(facts).join("\n");
    assert.match(lines, /intel-1 \(news, 2026-08-14, news\.example\.com\): Acme launches Spend Graph: Spend Graph measures retail media\./);
    assert.match(lines, /companyInsight may state ONE/);
    assert.match(intelGroundingText(facts), /Retail media measurement\.$/m);
    assert.deepEqual(intelPromptLines([]), []);
  });
});

describe("support check · intel facts count only when cited from the pack", () => {
  const FACTS = [
    { id: "intel-1", kind: "news", text: "Acme Analytics launches Spend Graph for retail media: Acme Analytics launched Spend Graph, a retail media measurement product.", date: "2026-08-14", url: "https://news.example.com/acme-spend-graph" },
  ];
  const v = (beat, sentence, source, supported = true) => ({ beat, sentence, factual: true, supported, reason: "", source });

  it("should accept a cited intel fact in the company insight and carry its URL and date", () => {
    const [out] = enforceIntelCitations([v("companyInsight", "In August 2026 Acme Analytics launched Spend Graph for retail media measurement.", "intel-1")], FACTS, { company: "Acme Analytics" });
    assert.equal(out.supported, true);
    assert.deepEqual(out.intel, { id: "intel-1", url: "https://news.example.com/acme-spend-graph", date: "2026-08-14" });
  });

  it("should reject an intel id that is not in the pack", () => {
    const [out] = enforceIntelCitations([v("companyInsight", "Acme Analytics raised $50M in July.", "intel-7")], FACTS, { company: "Acme Analytics" });
    assert.equal(out.supported, false);
    assert.match(out.reason, /not in the company intel pack/);
  });

  it("should reject a sentence that cites intel but does not restate it", () => {
    const [out] = enforceIntelCitations([v("hook", "Acme Analytics is doubling its sales team this year.", "intel-1")], FACTS, { company: "Acme Analytics" });
    assert.equal(out.supported, false);
    assert.match(out.reason, /does not restate intel-1/);
  });

  it("should reject intel used as proof about the candidate, or with the wrong date", () => {
    const [proof, dated] = enforceIntelCitations([
      v("proof1", "I launched Spend Graph for retail media measurement.", "intel-1"),
      v("companyInsight", "In March 2025 Acme Analytics launched Spend Graph for retail media.", "intel-1"),
    ], FACTS, { company: "Acme Analytics" });
    assert.equal(proof.supported, false);
    assert.match(proof.reason, /opening paragraph or the outreach note/);
    assert.equal(dated.supported, false);
    assert.match(dated.reason, /year that is not intel-1's date/);
  });

  it("should leave non-intel verdicts alone and keep a model's unsupported verdict unsupported", () => {
    const input = [v("proof1", "I grew the book.", "claim-1"), v("companyInsight", "Acme Analytics launched Spend Graph for retail media.", "intel-1", false)];
    const out = enforceIntelCitations(input, FACTS, { company: "Acme Analytics" });
    assert.deepEqual(out[0], input[0]);
    assert.equal(out[1].supported, false);
    assert.equal(enforceIntelCitations(null, FACTS), null);
  });

  it("should list the intel facts in the support prompt and enforce citations on the model's verdicts", async () => {
    const draft = { letter: {
      hook: "I built weekly readouts for analysts.",
      companyInsight: "In August 2026 Acme Analytics launched Spend Graph for retail media measurement. Acme Analytics also won a national award last month.",
      proof1: "", proof2: "", ask: "",
    } };
    const ledger = { claims: [{ id: "c1", text: "Built weekly readouts for analysts." }] };
    const { userText, sentences } = supportPrompt({ draft, ledger, postingText: POSTING, company: "Acme Analytics", intel: FACTS });
    assert.match(userText, /Company intel \(researched, dated, sourced; cite its id\):\n- intel-1 \(2026-08-14\): Acme Analytics launches Spend Graph/);
    assert.equal(sentences.length, 3);
    let system = "";
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      system = body.messages[0].content;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdicts: [
          { i: 1, factual: true, supported: true, source: "c1" },
          { i: 2, factual: true, supported: true, source: "intel-1" },
          /* The model claims an invented award rests on intel: rejected. */
          { i: 3, factual: true, supported: true, source: "intel-1" },
        ] }) } }] }),
      };
    };
    const pin = { provider: "local", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
    const { verdicts } = await checkLetterSupport({ draft, ledger, postingText: POSTING, company: "Acme Analytics", intel: FACTS, pin, fetchImpl });
    assert.ok(system.includes(SUPPORT_INTEL_RULE));
    assert.equal(verdicts[0].supported, true);
    assert.equal(verdicts[1].supported, true);
    assert.equal(verdicts[1].intel.id, "intel-1");
    assert.equal(verdicts[2].supported, false, "an uncited, invented company fact is rejected");
    assert.match(verdicts[2].reason, /does not restate intel-1/);
  });

  it("should let the rubric trace a number that only the intel pack states", () => {
    const draft = { letter: {
      hook: "I grew Austin to a top-4 national ranking on a $12M+ book.",
      companyInsight: "Acme Analytics now measures retail media for 9,000 brands.",
      proof1: "I grew Austin to a top-4 national ranking on a $12M+ book.", proof2: "", ask: "Worth a call with Acme Analytics?",
    } };
    const ledger = { claims: [{ id: "c1", text: "Grew Austin to a top-4 national ranking on a $12M+ book.", metrics: [{ token: "$12M+" }, { token: "top-4" }] }] };
    const common = { document: "letter", extract: { outcomes: [], nouns: [] }, selection: { kept: [] }, ledger, draft, company: "Acme Analytics", postingText: POSTING };
    const without = scoreRubric(common).rows.find((r) => r.id === "letter_ungrounded");
    assert.match(without.note, /untraced numeral\(s\) in the letter: 9,000/);
    const withIntel = scoreRubric({ ...common, intelText: "Acme Analytics measures retail media for 9,000 brands." }).rows.find((r) => r.id === "letter_ungrounded");
    assert.doesNotMatch(withIntel.note, /untraced numeral/);
  });
});

describe("intel pack · the cache file is plain JSON a person can read", () => {
  it("should ignore a stale or foreign cache file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-intel-cache-"));
    try {
      await writeFile(join(dir, "x.com.json"), JSON.stringify({ contract: "other", fetchedAt: NOW.toISOString() }));
      assert.equal(await readCachedIntel(dir, "x.com", NOW.getTime()), null);
      await writeFile(join(dir, "y.com.json"), JSON.stringify({ contract: INTEL_CONTRACT, fetchedAt: NOW.toISOString(), ttlDays: 30 }));
      assert.ok(await readCachedIntel(dir, "y.com", NOW.getTime() + 86_400_000));
      assert.ok(await readCachedIntel(dir, "y.com", NOW.getTime() + 29 * 86_400_000), "still fresh on day 29");
      assert.equal(await readCachedIntel(dir, "y.com", NOW.getTime() + 30 * 86_400_000), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
