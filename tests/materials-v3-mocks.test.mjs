/**
 * Contract test for the Materials v3 design package.
 *
 * The mocks and fixtures under docs/materials-v3/ are the acceptance snapshot
 * for the template registry and the staged mechanism. This test keeps them
 * honest: fixtures must validate against the shipped schemas, the numbers
 * quoted in qa.json must match the Volt v1 reference render they were measured
 * on (volt-v1/), and every registry family's reference fixture (signal,
 * dossier, editorial) must carry the QA markers, the header-first order, the
 * ledger-only facts, and the offline fonts that the visual spec §9 requires.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { MATERIALS_BUDGETS } from "../server/materials-fit-budget.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mockDir = join(repoRoot, "docs/materials-v3/mocks/3e-ai-marketing-analytics-manager");
/** The Volt 1.0 render the pipeline fixtures were measured on, kept as history. */
const V1 = "volt-v1";

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

test("the Volt v1 documents are a single sheet with no script and no remote assets", () => {
  for (const file of [`${V1}/resume.html`, `${V1}/cover-letter.html`]) {
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

test("the Volt v1 stylesheet still obeys its own forbidden list", () => {
  const css = readMock(`${V1}/volt.css`).replace(/\/\*[\s\S]*?\*\//g, " ");
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

  const visible = wordCount(sheetText(readMock(`${V1}/resume.html`)));
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
  assert.equal(qa.measurements.resumeVisibleWords, wordCount(sheetText(readMock(`${V1}/resume.html`))));
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
  const html = readMock(`${V1}/resume.html`);
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
  const resumeTxt = readMock(`${V1}/resume.txt`);
  const letterTxt = readMock(`${V1}/cover-letter.txt`);
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

// ---------------------------------------------------------------------------
// Template registry reference fixtures (visual spec §9)
// ---------------------------------------------------------------------------

/** Registry families, default first. Keep in sync with the render-model enum. */
const FAMILIES = ["signal", "dossier", "editorial"];
const DEFAULT_FAMILY = "signal";
const FAMILY_FILES = ["resume.html", "resume.pdf", "cover-letter.html", "cover-letter.pdf", "DESIGN.md"];
const LOGO_DIR = join(repoRoot, "docs/materials-v3/mocks/assets/logos");

/**
 * Families whose reference mock still loads a display face from Google Fonts
 * at render time. Empty since plan slice 3 vendored Archivo, Martian Mono and
 * Bodoni Moda into vendor/fonts/ and the mocks dropped their Google Fonts
 * links, so the offline-fonts test below enforces rule 5 for every family.
 */
const GOOGLE_FONTS_GAP = new Set();

/** @param {string} html */
function styleText(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** @param {string} html */
function sheetMarkup(html) {
  const start = html.search(/<article\b[^>]*\bclass="[^"]*\bsheet\b/);
  assert.ok(start >= 0, "no article.sheet found");
  return html.slice(start);
}

/** @param {string} path */
function pdfPageCount(path) {
  const bytes = readFileSync(path).toString("latin1");
  return (bytes.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

test("the render-model fixture names a registry family and matching template IDs", () => {
  const schema = readSchema("materials-render-model.v1.schema.json");
  assert.deepEqual(schema.$defs.family.enum, FAMILIES, "schema enum and registry list drifted");
  assert.equal(schema.properties.template.properties.family.default, DEFAULT_FAMILY);

  const model = readMockJson("render-model.json");
  assert.equal(model.template.family, DEFAULT_FAMILY);
  assert.equal(model.documents.resume.templateId, `${model.template.family}.resume`);
  assert.equal(model.documents.coverLetter.templateId, `${model.template.family}.letter`);

  const run = readMockJson("run.json");
  assert.equal(run.template.family, model.template.family, "run.json must record the family it rendered");
  assert.equal(run.template.version, model.template.version);
  assert.deepEqual(run.template.templateIds, {
    resume: model.documents.resume.templateId,
    coverLetter: model.documents.coverLetter.templateId,
  });
});

test("the render-model schema rejects a template ID from another family", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readSchema("materials-render-model.v1.schema.json"));
  const model = readMockJson("render-model.json");
  model.template.family = "dossier";
  assert.equal(validate(model), false, "signal.resume under family dossier must fail");
  model.documents.resume.templateId = "dossier.resume";
  model.documents.coverLetter.templateId = "dossier.letter";
  assert.equal(validate(model), true, JSON.stringify(validate.errors, null, 2));
  model.template.family = "volt";
  assert.equal(validate(model), false, "volt is no longer a registry family");
});

test("a regenerated package must say which run it re-rendered", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readSchema("materials-run.v1.schema.json"));
  const run = readMockJson("run.json");
  run.template = { ...run.template, family: "editorial", templateIds: { resume: "editorial.resume", coverLetter: "editorial.letter" }, source: "regenerate" };
  assert.equal(validate(run), false, "source regenerate without regeneratedFrom must fail");
  run.template.regeneratedFrom = "mr_2026091718_3e_7f21";
  assert.equal(validate(run), true, JSON.stringify(validate.errors, null, 2));
});

for (const family of FAMILIES) {
  const dir = join(mockDir, family);

  test(`${family}: the reference fixture ships both documents, both PDFs, and its design notes`, () => {
    for (const file of FAMILY_FILES) {
      assert.ok(existsSync(join(dir, file)), `${family}/${file} is missing`);
    }
    for (const file of ["resume.pdf", "cover-letter.pdf"]) {
      assert.equal(pdfPageCount(join(dir, file)), 1, `${family}/${file} must be one page`);
    }
  });

  for (const doc of ["resume", "cover-letter"]) {
    test(`${family} ${doc}: one sheet, QA markers, header first, no script`, () => {
      const html = readMock(`${family}/${doc}.html`);
      assert.equal(/<script/i.test(html), false, "templates carry no script");

      // server/materials-quality.mjs counts pages as article.page elements.
      const pages = html.match(/<article\b[^>]*\bclass="[^"]*\bpage\b[^"]*"[^>]*>/g) || [];
      assert.equal(pages.length, 1, "exactly one article.page");
      assert.match(pages[0], /\bdata-page="1"/, "the page carries data-page");

      // The name and contact header comes first in DOM order, so ATS text
      // extraction reads it before anything else on the sheet.
      const model = readMockJson("render-model.json");
      const text = sheetText(sheetMarkup(html));
      assert.ok(
        text.startsWith(model.identity.name),
        `${family}/${doc}.html must open on the name, but opens on "${text.slice(0, 60)}"`,
      );
      const sheet = sheetMarkup(html);
      const email = model.identity.contact.find((c) => c.kind === "email").text;
      const emailAt = sheet.indexOf(email);
      const firstHeadingAt = sheet.search(/<h2\b/);
      assert.ok(emailAt > 0, "the contact block is present");
      if (firstHeadingAt >= 0) {
        assert.ok(emailAt < firstHeadingAt, "contact comes before the first section heading");
      }
    });
  }

  test(`${family} resume: employers are h2.company-name and match the ledger`, () => {
    const html = readMock(`${family}/resume.html`);
    const ledger = readMockJson("claim-ledger.json");
    const names = new Set(ledger.employers.map((e) => e.name));
    // server/materials-critic.mjs reads employer names from h2.company-name.
    const rendered = [...html.matchAll(/<h2\b[^>]*\bcompany-name\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) =>
      sheetText(m[1]),
    );
    assert.ok(rendered.length >= 2, "at least the featured employers carry h2.company-name");
    for (const name of rendered) {
      assert.ok(names.has(name), `h2.company-name "${name}" is not a ledger employer`);
    }
  });

  test(`${family} resume: every claim marker and metric figure comes from the ledger`, () => {
    const html = readMock(`${family}/resume.html`);
    const ledger = readMockJson("claim-ledger.json");
    const claimIds = new Set(ledger.claims.map((c) => c.id));
    const tokens = new Set(ledger.claims.flatMap((c) => (c.metrics || []).map((m) => m.token)));
    // 3E's own operating model (~25 skills, ~15 connections) is cited from the
    // JD, not claimed; those numbers may be set as figures when framed as 3E's.
    const jdNumbers = new Set([...readMock("jd-extract.json").matchAll(/~(\d+)/g)].map((m) => m[1]));

    const claims = [...html.matchAll(/data-claim="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(claims.length >= 6, "bullets carry data-claim markers");
    for (const id of claims) assert.ok(claimIds.has(id), `data-claim="${id}" is not a ledger claim`);

    const figures = [...html.matchAll(/<span class="(?:n|fig)"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1].trim());
    assert.ok(figures.length >= 6, "metric figures are typeset as data");
    for (const figure of figures) {
      assert.ok(tokens.has(figure) || jdNumbers.has(figure), `figure "${figure}" is not a ledger metric token`);
    }

    const text = sheetText(sheetMarkup(html));
    // An adjacent tool never appears as owned.
    for (const tool of ledger.toolInventory.filter((t) => t.level === "adjacent")) {
      assert.equal(text.includes(tool.name), false, `${tool.name} is rated adjacent and must not be listed`);
    }
    // A tool Emilio does not own may appear only where the page says it is new.
    for (const tool of ledger.toolInventory.filter((t) => t.level === "none")) {
      const at = text.indexOf(tool.name);
      if (at < 0) continue;
      assert.match(
        text.slice(Math.max(0, at - 40), at + 80),
        /\bnew\b/i,
        `${tool.name} is rated none and may only appear labelled as new`,
      );
    }

    const hardMax = MATERIALS_BUDGETS.resume.visibleWordsHardMax;
    const visible = wordCount(text);
    assert.ok(visible <= hardMax, `${family} resume renders ${visible} words, over the ${hardMax} hard max`);
  });

  test(`${family}: logos come from the shared logo folder, with alt text, unaltered`, () => {
    for (const doc of ["resume", "cover-letter"]) {
      const html = readMock(`${family}/${doc}.html`);
      for (const match of html.matchAll(/<img\b[^>]*>/g)) {
        const tag = match[0];
        const src = (tag.match(/\bsrc="([^"]+)"/) || [])[1] || "";
        assert.ok(src.startsWith("../../assets/logos/"), `${family}/${doc} logo ${src} is outside assets/logos/`);
        assert.ok(existsSync(resolve(dir, src)), `${family}/${doc} logo ${src} does not exist`);
        assert.equal(resolve(dir, src).startsWith(LOGO_DIR), true);
        assert.match(tag, /\balt="[^"]+"/, `${family}/${doc} logo ${src} needs alt text`);
      }
      const css = styleText(html);
      assert.equal(/\bfilter\s*:/.test(css), false, `${family}/${doc} must not filter logos`);
      assert.equal(/mix-blend-mode/.test(css), false, `${family}/${doc} must not blend logos`);
    }
  });

  test(`${family}: drop caps and initials never split a word in extracted text`, () => {
    for (const doc of ["resume", "cover-letter"]) {
      const css = styleText(readMock(`${family}/${doc}.html`));
      // A floated ::first-letter or initial-letter extracts as "S" / "ince".
      assert.equal(/initial-letter/.test(css), false, `${family}/${doc} uses initial-letter`);
      for (const rule of css.matchAll(/::first-letter\s*\{([^}]*)\}/g)) {
        assert.equal(/\bfloat\s*:/.test(rule[1]), false, `${family}/${doc} floats a first letter`);
      }
    }
  });

  test(`${family}: fonts come from the repo's vendored stack`, () => {
    for (const doc of ["resume", "cover-letter"]) {
      const html = readMock(`${family}/${doc}.html`);
      const href = (html.match(/href="([^"]*vendor\/fonts\/fonts\.css)"/) || [])[1];
      assert.ok(href, `${family}/${doc} must link vendor/fonts/fonts.css`);
      assert.ok(existsSync(resolve(dir, href)), `${family}/${doc} font path ${href} does not resolve`);
      for (const url of html.match(/https?:\/\/[^"')\s]+/g) || []) {
        assert.match(
          url,
          /^https:\/\/(emiliobuilds\.com|www\.linkedin\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/,
          `${family}/${doc} loads an unexpected remote asset: ${url}`,
        );
      }
    }
  });

  test(
    `${family}: no Google Fonts at render time`,
    GOOGLE_FONTS_GAP.has(family)
      ? { todo: "known gap: display faces still load from Google Fonts until vendored (plan, slice 3)" }
      : {},
    () => {
      for (const doc of ["resume", "cover-letter"]) {
        const html = readMock(`${family}/${doc}.html`);
        assert.equal(/fonts\.(googleapis|gstatic)\.com/.test(html), false, `${family}/${doc} fetches Google Fonts`);
      }
    },
  );
}
