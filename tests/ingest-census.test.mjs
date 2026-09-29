import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { it } from "node:test";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(root, "fixtures/ingest-corpus/C03/source.txt"), "utf8");
const truth = JSON.parse(readFileSync(path.join(root, "fixtures/ingest-corpus/C03/truth.json"), "utf8"));
const load = () => import("../server/resume-ingest-census.mjs");
const scan = async (text) => (await load()).censusResume(text);
const at = (result, kind, line) => result.anchors.filter((anchor) => anchor.kind === kind && anchor.lines[0] === line);

it("T-K4-02 English date grammars and trailing free text are anchored", async () => {
  const cases = [
    ["Jan 2020 – Present", "2020-01", "present"],
    ["01/2020 – 03/2022", "2020-01", "2022-03"],
    ["2019 – 2021", "2019", "2021"],
    ["Sept. 2018 to Dec 2019", "2018-09", "2019-12"],
    ["Summer 2017", "2017", null],
    ["Early 2026 — Present", "2026", "present"],
    ["Mar 2017 — 2026 • Springfield, ST • three progressive roles", "2017-03", "2026"],
  ];
  for (const [line, start, end] of cases) {
    const hit = (await scan(line)).anchors.find((anchor) => anchor.kind === "date_range");
    assert.ok(hit, line);
    assert.equal(hit.dateRange.start, start, line);
    assert.equal(hit.dateRange.end, end, line);
  }
});

it("T-K4-03 date-first umbrella line has a date and its free-text tail", async () => {
  const result = await scan(source);
  assert.equal(at(result, "date_range", 7)[0].dateRange.raw, "Mar 2017 — 2026");
  assert.match(at(result, "umbrella_tail", 7)[0].text, /Springfield, ST.*three progressive roles/);
});

it("T-K4-04 an undated employer above a date-first line keeps its formerly clause", async () => {
  const result = await scan(source);
  assert.equal(at(result, "employer_header", 6)[0].text, truth.employers[0].name);
  assert.equal(at(result, "formerly_clause", 6)[0].text, "formerly Litware Radio");
  assert.equal(at(result, "employer_header", 3).length, 0, "summary mention is not a header");
});

it("T-K4-05 numbered letter-spaced headings open sections including unknown ventures", async () => {
  const result = await scan(source);
  assert.equal(at(result, "section_heading", 5)[0].sectionGuess, "experience");
  assert.equal(at(result, "section_heading", 11)[0].sectionGuess, "unknown");
  assert.equal(at(result, "section_heading", 35)[0].sectionGuess, "education");
  assert.ok(result.sections.some((section) => section.kind === "unknown" && section.lines[0] === 11 && section.lines[1] >= 34));
  assert.equal(at(result, "employer_header", 12)[0].sectionGuess, "unknown");
  assert.equal(at(result, "employer_header", 13)[0].sectionGuess, "unknown");
});

it("T-K4-07 domain suffix headers keep the employer name without the site", async () => {
  const result = await scan(source);
  assert.equal(at(result, "employer_header", 12)[0].text, "Fabrikam Labs");
  assert.equal(at(result, "employer_header", 13)[0].text, "Northwind Trading");
});

it("T-K4-10 census has no AI, structure-model, or provider import", async () => {
  await load();
  const code = readFileSync(path.join(root, "../server/resume-ingest-census.mjs"), "utf8");
  assert.doesNotMatch(code, /(?:from|import\s*\()\s*["'][^"']*(?:server\/ai\/|materials-resume-structure-model|provider)/);
});

it("T-K4-11 census is synchronous, deterministic, and needs no I/O", async () => {
  const { censusResume } = await load();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network forbidden"); };
  try {
    const first = censusResume(source);
    assert.ok(!(first instanceof Promise));
    assert.deepEqual(censusResume(source), first);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const code = readFileSync(path.join(root, "../server/resume-ingest-census.mjs"), "utf8");
  assert.doesNotMatch(code, /(?:node:fs|node:net|node:http|\bfetch\s*\()/);
});

it("T-K4-13 unknown date grammar still produces a fallback anchor", async () => {
  for (const line of ["2014 ~ 2016", "2014 until present"]) {
    const result = await scan(line);
    assert.ok(result.anchors.some((anchor) => anchor.kind === "fallback_date"), line);
  }
});

it("T-K4-16 a descriptor below an employer header is retained", async () => {
  const result = await scan("Contoso Media\nRegional audience sales organization\nJan 2020 — Present");
  assert.equal(at(result, "descriptor", 2)[0].text, "Regional audience sales organization");
});

it("T-K4-17 title-only dated lines stay in the Contoso block and C03 has four dated employer blocks", async () => {
  const result = await scan(source);
  for (const line of [8, 9, 10]) {
    assert.equal(at(result, "date_range", line).length, 1);
    assert.equal(at(result, "employer_header", line).length, 0);
  }
  const employerLines = result.anchors.filter((anchor) => anchor.kind === "employer_header" && anchor.sectionGuess !== "education").map((anchor) => anchor.lines[0]);
  assert.deepEqual(employerLines, truth.employers.map((employer) => employer.block[0]));
  assert.equal(employerLines.length, truth.datedEmployerBlocks);
});

it("T-K4-19 (guard) no server module exports or imports a rules structure builder", () => {
  const files = readdirSync(path.join(root, "../server"), { recursive: true }).filter((file) => /\.(?:mjs|js|ts)$/.test(file) && statSync(path.join(root, "../server", file)).isFile());
  for (const file of files) {
    const code = readFileSync(path.join(root, "../server", file), "utf8");
    assert.doesNotMatch(code, /(?:export|import)[^;\n]*\bparseResumeStructure\b/, file);
  }
});
