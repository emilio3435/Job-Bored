import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { normalizeAtsRequestPayload } from "../server/ats-request-payload.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");

function extractFunctionSource(src, functionName) {
  const anchor = `function ${functionName}(`;
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error(`Could not find ${functionName}() in app.js`);
  const braceStart = src.indexOf("{", start);
  if (braceStart === -1) {
    throw new Error(`Could not find opening brace for ${functionName}()`);
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escaped = false;

  for (let i = braceStart; i < src.length; i += 1) {
    const ch = src[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (!inDouble && !inBacktick && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === "`") {
      inBacktick = !inBacktick;
      continue;
    }
    if (inSingle || inDouble || inBacktick) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }

  throw new Error(`Could not find closing brace for ${functionName}()`);
}

const buildAtsScorecardRequestPayload = (0, eval)(
  `(${extractFunctionSource(appJs, "buildAtsScorecardRequestPayload")})`,
);

function buildFullPayload() {
  return buildAtsScorecardRequestPayload(
    "This cover letter contains more than twenty characters so ATS validation can run safely.",
    {
      title: "Frontend Engineer",
      company: "Acme Labs",
      link: "https://example.com/jobs/frontend-engineer",
      fitAssessment: "Strong fit for UI systems and growth loops.",
      talkingPoints: "Fast iteration, metrics ownership",
      notes: "Emphasize recruiter empathy and measurable outcomes.",
      _postingEnrichment: {
        description:
          "Build user-facing web products and collaborate with product and design.",
        requirements: [
          "3+ years of frontend experience",
          "Strong JavaScript and TypeScript fundamentals",
        ],
        skills: ["JavaScript", "TypeScript", "React", "CSS"],
        mustHaves: ["React", "TypeScript"],
        responsibilities: ["Ship product features", "Improve onboarding funnel"],
        toolsAndStack: ["React", "Node.js", "PostgreSQL"],
      },
    },
    {
      feature: "cover_letter",
      bundle: {
        job: {
          title: "Frontend Engineer",
          company: "Acme Labs",
          url: "https://example.com/jobs/frontend-engineer",
          fitAssessment: "Strong fit for UI systems and growth loops.",
          talkingPoints: "Fast iteration, metrics ownership",
          notes: "Emphasize recruiter empathy and measurable outcomes.",
          postingEnrichment: {
            description:
              "Build user-facing web products and collaborate with product and design.",
            requirements: [
              "3+ years of frontend experience",
              "Strong JavaScript and TypeScript fundamentals",
            ],
            skills: ["JavaScript", "TypeScript", "React", "CSS"],
            mustHaves: ["React", "TypeScript"],
            responsibilities: ["Ship product features", "Improve onboarding funnel"],
            toolsAndStack: ["React", "Node.js", "PostgreSQL"],
          },
        },
        profile: {
          candidateProfileText:
            "RESUME: Built React growth surfaces and wrote ATS-optimized messaging.",
          resumeSourceText: "Built product experiences in React and TypeScript.",
          linkedinProfileText: "Frontend engineer with analytics ownership.",
          additionalContextText: "Prefer concise, high-signal writing.",
        },
        instructions: {
          userNotes: "Keep the tone direct and concise.",
          refinementFeedback: "Increase emphasis on business impact.",
        },
        meta: {
          sheetId: "sheet_123",
          generatedAt: "2026-04-09T10:00:00.000Z",
        },
      },
    },
  );
}

function buildSparsePayload() {
  return buildAtsScorecardRequestPayload(
    "This resume update draft still contains enough text to trigger ATS validation.",
    {
      title: "Platform Engineer",
      company: "Orbit Systems",
      link: "https://example.com/jobs/platform-engineer",
    },
    {
      feature: "resume_update",
    },
  );
}

describe("ATS request contract and transport alignment", () => {
  it("keeps server-mode normalization identical to the browser payload for full ATS requests", () => {
    const payload = buildFullPayload();
    assert.deepEqual(normalizeAtsRequestPayload(payload), payload);
  });

  it("omits optional null sections from sparse browser payloads and preserves them through server normalization", () => {
    const payload = buildSparsePayload();
    assert.equal("profile" in payload, false);
    assert.equal("instructions" in payload, false);
    assert.equal("meta" in payload, false);
    assert.equal("postingEnrichment" in payload.job, false);
    assert.deepEqual(normalizeAtsRequestPayload(payload), payload);
  });

  it("rejects off-contract ATS request fields so server and webhook transports stay aligned", () => {
    const payload = buildFullPayload();
    payload.providerHint = { provider: "gemini", model: "gemini-2.5-flash" };
    assert.throws(
      () => normalizeAtsRequestPayload(payload),
      /Invalid ATS request field "providerHint"/,
    );
  });
});
