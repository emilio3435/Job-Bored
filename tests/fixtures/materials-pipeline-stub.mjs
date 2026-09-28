/**
 * A scripted stub for resume structure and the three pipeline model calls
 * (extract → select → draft). In-process drafter tests share it so each draft
 * behaves the same way.
 */

import { EXAMPLE_RESUME_SOURCE } from "./materials-example-writer.mjs";
import { parseHeaderLine, parseResumeStructure } from "../../server/materials-resume-structure.mjs";

export { EXAMPLE_RESUME_SOURCE };

const SPELLED = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

/**
 * Return a source-quoted model reply for the resume supplied to the pipeline.
 * The parser is used only to shape this fictional in-process fixture; every
 * fact returned below is copied from the request's resume text.
 * @param {string} userText
 */
function quotedResumeStructure(userText) {
  const source = String(userText).split("<untrusted-resume>\n")[1]?.split("\n</untrusted-resume>")[0] || "";
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = parseResumeStructure(source);
  const employerLine = (name) => lines.find((line) => parseHeaderLine(line)?.name === name)
    || lines.find((line) => line.startsWith(name))
    || lines.find((line) => line.includes(name))
    || name;
  return {
    employers: parsed.employers.map((employer) => {
      const header = employerLine(employer.name);
      const headerAt = lines.indexOf(header);
      return {
        name: employer.name,
        sourceQuote: header,
        start: null,
        startSourceQuote: null,
        end: null,
        endSourceQuote: null,
        roles: employer.roles.map((role, roleIndex) => ({
          title: role.title,
          sourceQuote: lines.slice(Math.max(0, headerAt)).find((line) => parseHeaderLine(line)?.title === role.title) || header,
          start: null,
          end: null,
          claims: employer.claims
            .filter((claim) => claim.roleIndex === roleIndex)
            .map((claim) => ({ text: claim.text, sourceQuote: claim.text })),
        })),
        claims: employer.claims
          .filter((claim) => claim.roleIndex === null)
          .map((claim) => ({ text: claim.text, sourceQuote: claim.text })),
      };
    }),
    looseClaims: parsed.looseClaims.map((text) => ({ text, sourceQuote: text })),
    education: parsed.education.map((text) => ({ text, sourceQuote: text })),
    credentials: parsed.credentials.map((text) => ({ text, sourceQuote: text })),
  };
}

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
    if (extra.gate && calls.length === (extra.gateAt || 1)) await extra.gate;
    let content;
    /* The letter support check (voice v5) answers by prompt, not by call
     * index: every sentence supported. */
    const supportCall = String(system).startsWith("You check a cover letter's facts");
    const structureCall = String(system).startsWith("Interpret the resume source itself");
    const stageIndex = calls.filter((c) =>
      !c.system.startsWith("You check a cover letter's facts")
      && !c.system.startsWith("Interpret the resume source itself")
    ).length;
    if (supportCall) {
      const count = [...String(user).split("Letter sentences:")[1]?.matchAll(/^(\d+)\. /gm) || []].length;
      content = JSON.stringify({ verdicts: Array.from({ length: count }, (_, i) => ({ i: i + 1, factual: true, supported: true, source: "stub" })) });
    } else if (structureCall) {
      content = JSON.stringify(quotedResumeStructure(user));
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
