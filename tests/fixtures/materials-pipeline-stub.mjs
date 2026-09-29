/**
 * A scripted stub for the pipeline's three narrow model calls (extract →
 * select → draft). In-process tests for the drafter, FIFO, resume-required
 * and letter-budget suites share it so each draft behaves the same way.
 */

import { EXAMPLE_RESUME_SOURCE } from "./materials-example-writer.mjs";
import { modelReadReplyFixture, modelReplyFixture, resumeSourceFromReadPrompt } from "./materials-model-structure.mjs";
import { RESUME_STRUCTURE_SYSTEM_PROMPT } from "../../server/materials-resume-structure-model.mjs";

export { EXAMPLE_RESUME_SOURCE };

const SPELLED = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

/**
 * @param {{ gate?: Promise<unknown>, gateAt?: number }} [extra]
 * @returns {{ fetchImpl: (url: string, init: { body: string }) => Promise<{ ok: boolean, json: () => Promise<unknown> }>, calls: Array<{ system: string, user: string }> }}
 */
export function scriptedPipelineFetch(extra = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    /* Gemini and Anthropic pins speak their own shapes; the stage's user
     * text lives in a different field for each. */
    const href = String(url || "");
    const flavor = href.includes("generativelanguage.googleapis.com")
      ? "gemini"
      : href.includes("api.anthropic.com")
        ? "anthropic"
        : "chat";
    const parts = (node) => {
      if (!node || typeof node !== "object") return "";
      if (Array.isArray(node.parts)) return node.parts.map((p) => (p && p.text) || "").join("");
      return "";
    };
    const system = flavor === "gemini"
      ? parts(body.systemInstruction)
      : flavor === "anthropic"
        ? String(body.system || "")
        : (body.messages && body.messages[0] && body.messages[0].content) || "";
    const user = flavor === "gemini"
      ? parts(body.contents && body.contents[0])
      : flavor === "anthropic"
        ? (body.messages || []).map((m) => (typeof m.content === "string" ? m.content : "")).join("\n")
        : (body.messages && body.messages[1] && body.messages[1].content) || "";
    calls.push({ system: String(system), user: String(user) });
    const readCall = (call) => call.system === RESUME_STRUCTURE_SYSTEM_PROMPT || call.system.startsWith("Read the numbered resume lines");
    const pipelineCallCount = calls.filter((call) => !readCall(call)).length;
    if (extra.gate && pipelineCallCount === (extra.gateAt || 1)) await extra.gate;
    let content;
    /* The letter support check (voice v5) answers by prompt, not by call
     * index: every sentence supported. */
    const supportCall = String(system).startsWith("You check a cover letter's facts");
    const stageIndex = calls.filter((c) => !readCall(c) && !c.system.startsWith("You check a cover letter's facts")).length;
    if (String(system) === RESUME_STRUCTURE_SYSTEM_PROMPT) {
      const resumeText = String(user).match(/── BEGIN RESUME ──\n([\s\S]*?)\n── END RESUME ──/)?.[1] || "";
      content = JSON.stringify(modelReplyFixture(resumeText));
    } else if (String(system).startsWith("Read the numbered resume lines")) {
      content = JSON.stringify(modelReadReplyFixture(resumeSourceFromReadPrompt(user)));
    } else if (supportCall) {
      const count = [...String(user).split("Letter sentences:")[1]?.matchAll(/^(\d+)\. /gm) || []].length;
      content = JSON.stringify({ verdicts: Array.from({ length: count }, (_, i) => ({ i: i + 1, factual: true, supported: true, source: "stub" })) });
    } else if (stageIndex === 1) {
      content = JSON.stringify({
        outcomes: [{ id: "pipe-math", text: "Own pipeline math with analysts", weight: 0.9 }],
        differentiators: [],
        bars: [],
        constraints: [],
        echoBans: [],
        nounWeights: {},
      });
    } else if (stageIndex === 2) {
      const ids = [...user.matchAll(/^(\d+)\. (\S+)/gm)].map((m) => m[2]);
      const kept = ids.slice(0, 5);
      content = JSON.stringify({
        kept: kept.map((claimId, i) => ({ claimId, slot: `s${i}`, reason: "ok" })),
        dropped: [],
        transfers: [],
        letter: { analyticsProof: kept[0], aiOpsProof: kept[1] || kept[0] },
      });
    } else {
      const featured = [...user.matchAll(/^- (\S+): /gm)].map((m) => m[1]);
      content = JSON.stringify({
        statement: "Operations analyst with analytics depth.",
        bullets: featured.map((claimId, i) => ({ claimId, text: `Drafted work item ${SPELLED[i] || "nine"} with concrete outcomes.` })),
        earlier: [],
        letter: {
          thesis: "You are hiring someone to keep pipelines honest, and that is the work I have done for years with clear weekly readouts. Honest pipelines are quiet.",
          analyticsProof: "I owned pipeline math with analysts and shipped reporting the business trusted every single week.",
          aiOpsProof: "I built streaming ingestion for analytics events with Kafka and Postgres in production for customers.",
          nextStep: "I would start by tracing one pipeline from source to readout, and I would be glad to walk through it.",
        },
      });
    }
    const payload = flavor === "gemini"
      ? { candidates: [{ content: { parts: [{ text: content }] } }] }
      : flavor === "anthropic"
        ? { content: [{ type: "text", text: content }] }
        : { choices: [{ message: { content } }] };
    return { ok: true, json: async () => payload };
  };
  return { fetchImpl, calls };
}
