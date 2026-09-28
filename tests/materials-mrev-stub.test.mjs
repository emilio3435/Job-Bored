/** In-process replies for resume structure and the MREV extract → write → judge funnel. */
import { scriptedPipelineFetch } from "./fixtures/materials-pipeline-stub.mjs";

const dimensions = ["role_relevance", "evidence_quality", "voice", "coherence", "economy"];

/** @param {string} url @param {string} content */
function reply(url, content) {
  const payload = String(url).includes("generativelanguage.googleapis.com")
    ? { candidates: [{ content: { parts: [{ text: content }] } }] }
    : String(url).includes("api.anthropic.com")
      ? { content: [{ type: "text", text: content }] }
      : { choices: [{ message: { content } }] };
  return { ok: true, status: 200, json: async () => payload };
}

/** @param {string} user */
function writerReply(user) {
  const company = user.match(/^Company: (.+)$/m)?.[1] || "the employer";
  const claims = [...user.matchAll(/^- ([a-zA-Z0-9_-]+): (.+)$/gm)].map((match) => {
    let text = match[2];
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "string") text = parsed;
    } catch {
      /* Older prompt shapes use raw text; keep those replies readable. */
    }
    return { claimId: match[1], text };
  });
  const first = claims[0]?.text || "I built a practical reporting process.";
  const second = claims[1]?.text || first;
  const sourceRefs = claims.flatMap(({ claimId, text }) => text
    .split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)
    .map((sentence) => ({ sentence, claimIds: [claimId] })));
  return {
    statement: first,
    bullets: claims,
    earlier: [],
    sourceRefs,
    letter: {
      hook: `I am applying to ${company} with work I can explain and trace to a real source. ${first}`,
      companyInsight: `The posting describes work where people need clear evidence before making a decision. I would bring that care to the team's own priorities and ask where the current process is hardest to use.`,
      proof1: `${first} I would walk your team through the source, the decision it informed, and the parts that still need work.`,
      proof2: `${second} That is the kind of practical work I would start from here, while keeping the scope of each result tied to its actual record.`,
      ask: `I would like to compare one of ${company}'s current priorities with the work in my record and discuss where I could help. Could we talk through one example together?`,
    },
  };
}

/** @param {string} user */
function judgeReply(user) {
  const packet = JSON.parse(user.match(/<untrusted-data type="materials-evidence">\n([\s\S]*?)\n<\/untrusted-data>/)?.[1] || "{}");
  const claim = packet.sources?.claims?.[0];
  return {
    contract: "materials.judge.v1",
    documents: (packet.documents || []).map((doc) => ({
      document: doc.document,
      textHash: doc.textHash,
      ratings: dimensions.map((dimension) => ({ dimension, score: 4, reason: "Stubbed assessment of the test document.", sentenceIds: doc.sentences.slice(0, 1).map((sentence) => sentence.id) })),
      sentences: doc.sentences.map((sentence) => ({
        id: sentence.id,
        status: claim ? "supported" : "nonfactual",
        reason: "Stubbed source check.",
        citations: claim ? [{ sourceId: claim.id, quote: claim.text }] : [],
      })),
      issues: [],
      qualificationGaps: [],
    })),
  };
}

/** @param {{ gate?: Promise<unknown>, gateAt?: number }} [extra] */
export function scriptedMrevFetch(extra = {}) {
  const previous = scriptedPipelineFetch(extra);
  return {
    calls: previous.calls,
    fetchImpl: async (url, init) => {
      const original = await previous.fetchImpl(url, init);
      const { system, user } = previous.calls.at(-1);
      if (system.startsWith("You read a job posting")) return reply(url, JSON.stringify({ outcomes: [{ id: "reliable-reporting", text: "Build reliable reporting from source data", weight: 0.9 }], differentiators: [], bars: [], constraints: [], echoBans: [], nounWeights: {}, roleFamily: "operations", seniority: "director", companyFacts: [] }));
      if (system.startsWith("Goal: Write truthful")) return reply(url, JSON.stringify(writerReply(user)));
      if (system.startsWith("Goal: assess whether")) return reply(url, JSON.stringify(judgeReply(user)));
      return original;
    },
  };
}
