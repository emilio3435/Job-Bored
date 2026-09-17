/**
 * Contract test for the Materials v3 design package.
 *
 * The mocks and fixtures under docs/materials-v3/ are the acceptance snapshot
 * for the Volt visual system and the staged mechanism. This test keeps them
 * honest: fixtures must validate against the shipped schemas, the mock HTML
 * must obey the visual system's forbidden list, and the numbers quoted in
 * qa.json must match the documents they describe.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { MATERIALS_BUDGETS } from "../server/materials-fit-budget.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mockDir = join(repoRoot, "docs/materials-v3/mocks/3e-ai-marketing-analytics-manager");

/** @param {string} relative */
function readMock(relative) {
  return readFileSync(join(mockDir, relative), "utf8");
}

/** @param {string} relative */
function readMockJson(relative) {
  return JSON.parse(readMock(relative));
}

/** @param {string} relative */
function readSchema(relative) {
  return JSON.parse(readFileSync(join(repoRoot, "schemas", relative), "utf8"));
}

/** @param {string} html */
function sheetText(html) {
  return html
    .replace(/<head>[\s\S]*?<\/head>/i, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<p class="stage-tag">[\s\S]*?<\/p>/i, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} text */
function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

const FIXTURE_SCHEMAS = [
  ["jd-extract.json", "materials-jd-extract.v1.schema.json"],
  ["claim-ledger.json", "materials-claim-ledger.v1.schema.json"],
  ["selection.json", "materials-selection.v1.schema.json"],
  ["render-model.json", "materials-render-model.v1.schema.json"],
  ["qa.json", "materials-qa.v1.schema.json"],
  ["run.json", "materials-run.v1.schema.json"],
];

for (const [fixture, schemaFile] of FIXTURE_SCHEMAS) {
  test(`${fixture} validates against ${schemaFile}`, () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(readSchema(schemaFile));
    const valid = validate(readMockJson(fixture));
    assert.ok(
      valid,
      `${fixture} failed validation: ${JSON.stringify(validate.errors, null, 2)}`,
    );
  });
}

test("both documents are a single sheet with no script and no remote assets", () => {
  for (const file of ["resume.html", "cover-letter.html"]) {
    const html = readMock(file);
    assert.equal(
      (html.match(/class="sheet"/g) || []).length,
      1,
      `${file} should render exactly one page`,
    );
    assert.equal(/<script/i.test(html), false, `${file} must not carry script`);
    assert.match(html, /vendor\/fonts\/fonts\.css/, `${file} should use the app's vendored fonts`);
    const remote = html.match(/https?:\/\/[^"']+/g) || [];
    for (const url of remote) {
      assert.match(
        url,
        /^https:\/\/(emiliobuilds\.com|www\.linkedin\.com)/,
        `${file} loads an unexpected remote asset: ${url}`,
      );
    }
  }
});

test("the Volt stylesheet obeys the visual system's forbidden list", () => {
  const css = readMock("volt.css").replace(/\/\*[\s\S]*?\*\//g, " ");
  const forbidden = [
    // the `sans-serif` fallback keyword is fine; an actual serif stack is not
    /(?<!sans-)\bserif\b/i,
    /Newsreader/i,
    /Fraunces/i,
    /#efe4cf/i,
    /#faf4e6/i,
    /font-style:\s*italic/i,
    /border-radius/i,
    /repeating-linear-gradient/i,
  ];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(css), false, `volt.css must not contain ${pattern}`);
  }
  assert.match(css, /--volt:\s*#4a24ff/, "the accent token is electric indigo");
  assert.match(css, /@page\s*\{\s*size:\s*8\.5in 11in;\s*margin:\s*0;/, "the sheet owns its margins");
  assert.match(css, /Geist/, "display and body type is Geist");
  assert.match(css, /JetBrains Mono/, "micro-labels are JetBrains Mono");
});

test("the letter respects the single budget table", () => {
  const model = readMockJson("render-model.json");
  const letter = model.documents.coverLetter;
  const [minWords, maxWords] = MATERIALS_BUDGETS.letter.bodyWords;

  const counted = letter.paragraphs.reduce((total, p) => total + wordCount(p.text), 0);
  assert.equal(letter.paragraphs.length, MATERIALS_BUDGETS.letter.paragraphs);
  assert.ok(
    counted >= minWords && counted <= maxWords,
    `letter body is ${counted} words, outside ${minWords}-${maxWords}`,
  );
  assert.equal(letter.bodyWords, counted, "render-model bodyWords must match the paragraphs");
  assert.deepEqual(
    letter.paragraphs.map((p) => p.beat),
    ["thesis", "analytics-proof", "ai-ops-proof", "next-step"],
  );
});

test("the resume respects the single budget table", () => {
  const model = readMockJson("render-model.json");
  const resume = model.documents.resume;
  const [minBullets, maxBullets] = MATERIALS_BUDGETS.resume.bulletsPerFeatured;
  const [minStatement, maxStatement] = MATERIALS_BUDGETS.resume.statementWords;
  const [minTokens, maxTokens] = MATERIALS_BUDGETS.resume.tokens;

  const experience = resume.sections.find((section) => section.kind === "experience");
  assert.equal(experience.entries.length, MATERIALS_BUDGETS.resume.featuredEmployers);
  for (const entry of experience.entries) {
    assert.ok(
      entry.bullets.length >= minBullets && entry.bullets.length <= maxBullets,
      `${entry.employerId} has ${entry.bullets.length} bullets`,
    );
  }

  const statementWords = resume.statement.runs.reduce(
    (total, run) => total + wordCount(Object.values(run)[0]),
    0,
  );
  assert.ok(
    statementWords >= minStatement && statementWords <= maxStatement,
    `statement is ${statementWords} words, outside ${minStatement}-${maxStatement}`,
  );

  const tokens = resume.sections.find((section) => section.label === "Selected for this role").tokens;
  assert.ok(tokens.length >= minTokens && tokens.length <= maxTokens);

  const visible = wordCount(sheetText(readMock("resume.html")));
  const [minVisible, maxVisible] = MATERIALS_BUDGETS.resume.visibleWords;
  assert.ok(
    visible >= minVisible && visible <= maxVisible,
    `resume renders ${visible} visible words, outside ${minVisible}-${maxVisible}`,
  );
});

test("qa.json measurements match the documents they describe", () => {
  const qa = readMockJson("qa.json");
  const model = readMockJson("render-model.json");

  assert.equal(qa.measurements.letterBodyWords, model.documents.coverLetter.bodyWords);
  assert.equal(qa.measurements.letterParagraphs, model.documents.coverLetter.paragraphs.length);
  assert.equal(qa.measurements.resumeVisibleWords, wordCount(sheetText(readMock("resume.html"))));
  assert.deepEqual(
    qa.measurements.resumeFeaturedBullets,
    model.documents.resume.sections
      .find((section) => section.kind === "experience")
      .entries.map((entry) => entry.bullets.length),
  );
  assert.equal(qa.measurements.resumePages, model.template.pageBudget);
  assert.equal(qa.disposition, "REVIEW");
  assert.equal(
    qa.checks.filter((check) => check.severity === "review").map((check) => check.code).join(),
    "constraint_conflict",
    "the Denver conflict should be the only review finding",
  );
  assert.equal(qa.checks.some((check) => check.severity === "fail"), false);
  assert.ok(qa.rubric.score >= qa.rubric.threshold);
});

test("every rendered bullet and metric run traces back to the render model", () => {
  const html = readMock("resume.html");
  const text = sheetText(html);
  const resume = readMockJson("render-model.json").documents.resume;
  const experience = resume.sections.find((section) => section.kind === "experience");

  for (const entry of experience.entries) {
    for (const bullet of entry.bullets) {
      assert.match(
        html,
        new RegExp(`data-claim="${bullet.claimId}"`),
        `resume.html is missing the claim marker for ${bullet.claimId}`,
      );
      for (const run of bullet.runs) {
        if (!run.n) continue;
        assert.ok(
          text.includes(run.n),
          `metric run "${run.n}" from ${bullet.claimId} is not in the rendered text`,
        );
      }
    }
  }

  const tokenSection = resume.sections.find((section) => section.label === "Selected for this role");
  for (const excluded of tokenSection.excluded) {
    assert.equal(
      text.includes(excluded),
      false,
      `${excluded} is a prose-only transfer and must not appear in the resume`,
    );
  }
});

test("the ATS twins carry the statement, every featured bullet, and no rail-only content", () => {
  const resumeTxt = readMock("resume.txt");
  const letterTxt = readMock("cover-letter.txt");
  const model = readMockJson("render-model.json");
  const resume = model.documents.resume;

  const statement = resume.statement.runs.map((run) => Object.values(run)[0]).join("");
  const statementHead = statement.split(";")[0].trim();
  assert.ok(
    resumeTxt.replace(/\s+/g, " ").includes(statementHead),
    "resume.txt is missing the statement",
  );

  const experience = resume.sections.find((section) => section.kind === "experience");
  const flatResumeTxt = resumeTxt.replace(/\s+/g, " ");
  for (const entry of experience.entries) {
    for (const bullet of entry.bullets) {
      const head = bullet.runs
        .map((run) => Object.values(run)[0])
        .join("")
        .split(/[.—:]/)[0]
        .trim()
        .slice(0, 40);
      assert.ok(flatResumeTxt.includes(head), `resume.txt is missing bullet ${bullet.claimId}`);
    }
  }

  const flatLetterTxt = letterTxt.replace(/\s+/g, " ");
  for (const paragraph of model.documents.coverLetter.paragraphs) {
    assert.ok(
      flatLetterTxt.includes(paragraph.text.replace(/\s+/g, " ")),
      `cover-letter.txt is missing ${paragraph.id}`,
    );
  }

  // The letter rail may only restate metadata, so everything in it must also
  // be reachable from the plain-text twin.
  for (const group of model.documents.coverLetter.rail) {
    for (const line of group.lines) {
      assert.ok(
        flatLetterTxt.includes(line) || flatLetterTxt.includes(line.replace(" / ", " ")),
        `rail line "${line}" is not present in cover-letter.txt`,
      );
    }
  }
});

test("the run ledger stays inside the per-run LLM budget", () => {
  const run = readMockJson("run.json");
  const llmStages = run.stages.filter((stage) => stage.llm === true);
  assert.equal(llmStages.length, run.budget.llmCalls.used);
  assert.ok(run.budget.llmCalls.used <= MATERIALS_BUDGETS.run.llmCallsMax);
  assert.equal(run.budget.llmCalls.max, MATERIALS_BUDGETS.run.llmCallsMax);
  assert.ok(run.budget.outputTokens.used <= MATERIALS_BUDGETS.run.outputTokensMax);
  assert.equal(run.stages.at(-1).stage, "publish");
  assert.equal(
    run.stages.some((stage) => stage.status === "failed"),
    false,
  );
});
