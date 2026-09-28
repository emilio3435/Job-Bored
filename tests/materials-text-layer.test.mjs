/**
 * The materials PDF text layer must extract whole words. Chromium prints a
 * variable font as a Type3 font, and pypdf / pdftotext / ATS parsers then
 * split words at glyph-advance drift ("Directo r, Digital S ales",
 * "m anaging"). The renderer inlines static instances instead
 * (vendor/fonts/materials, scripts/build-materials-fonts.py). This file
 * holds that line, plus the monogram and addressee pieces of the logo chain.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { openPdfSession, pdfType3FontCount } from "../server/materials-pdf.mjs";
import { employersWithoutMarks, renderPackage } from "../server/materials-package.mjs";
import { addresseeMark, companyDisplayName, companyDomainHint, companyKey, monogramInitials, monogramLogo, targetCompanyOf, withMonograms } from "../server/materials-monogram.mjs";
import { loadEmployerMarks, looksLikeImage, targetSlug } from "../server/brand-logos.mjs";
import { buildRenderModelFromWriter } from "../server/materials-render-model-adapter.mjs";
import { cleanCaption, contactLink, fitName, inlineFontCss, materialsFontFaces, nameDots, renderDocument, repeatsHeadline } from "../server/materials-render.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { NORTHWIND_RESUME_TEXT, NORTHWIND_WRITER_JSON } from "./fixtures/materials-northwind-sample.mjs";

const FAMILIES = ["signal", "dossier", "editorial"];
const repoRoot = join(import.meta.dirname, "..");

/** @param {string} family */
function northwindModel(family) {
  return buildRenderModelFromWriter({
    writerJson: NORTHWIND_WRITER_JSON,
    resumeText: NORTHWIND_RESUME_TEXT,
    request: { company: "NorthwindMedia, Inc.", title: "Director, Digital Sales" },
    family: resolveFamily(family),
    marks: [],
    nowIso: "2026-09-27T12:00:00.000Z",
  });
}

describe("static materials fonts", () => {
  it("should inline only static faces (one weight each), never a variable weight range", () => {
    for (const family of FAMILIES) {
      const css = inlineFontCss(resolveFamily(family).fonts);
      assert.ok(css.includes("@font-face"), `${family} inlines faces`);
      assert.doesNotMatch(css, /font-weight:\s*\d+\s+\d+/, `${family}: a weight range means a variable font, which prints as Type3`);
    }
  });

  it("should ship a static face on disk for every family a template sets", () => {
    const faces = materialsFontFaces();
    for (const family of FAMILIES) {
      for (const name of resolveFamily(family).fonts) {
        const bare = name.replace(/ Italic$/, "");
        const matching = faces.filter((f) => f.family === bare);
        assert.ok(matching.length > 0, `${family}: no static instance of ${name}`);
        for (const face of matching) assert.ok(existsSync(join(repoRoot, "vendor/fonts", face.src)), face.src);
      }
    }
  });
});

describe("monograms and the addressee", () => {
  it("should take initials from the first two significant words and drop legal suffixes", () => {
    assert.equal(monogramInitials("Hearst Newspapers"), "HN");
    assert.equal(monogramInitials("NorthwindMedia, Inc."), "NO", "one word: its first two letters");
    assert.equal(monogramInitials("The Walt Disney Company"), "WD");
  });

  it("should draw a monogram as an SVG mark with no network reference", () => {
    const mark = monogramLogo("Clear Channel Outdoor");
    assert.equal(mark.source, "monogram");
    const svg = Buffer.from(mark.src.split(",")[1], "base64").toString("utf8");
    assert.match(svg, />CC</);
    assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/);
  });

  it("should give every featured employer without a mark a monogram, and leave the input model alone", () => {
    const model = northwindModel("signal");
    const filled = withMonograms(model);
    const entries = filled.documents.resume.sections.find((s) => s.kind === "experience").entries;
    assert.ok(entries.length > 0 && entries.every((e) => e.logo && e.logo.source === "monogram"));
    assert.ok(model.documents.resume.sections.find((s) => s.kind === "experience").entries.every((e) => !e.logo));
  });

  it("should read the addressed company from the letter's own To rail", () => {
    assert.equal(targetCompanyOf(northwindModel("signal")), "NorthwindMedia, Inc.");
  });

  it("should print the addressee's mark on the signal letter and never on the resume", () => {
    const target = { company: "NorthwindMedia, Inc.", logo: monogramLogo("NorthwindMedia, Inc.") };
    const letter = renderDocument(northwindModel("signal"), "coverLetter", { target });
    assert.match(letter, /class="addressee socket--mark"><img class="mark" src="data:image\/svg\+xml/);
    const resume = renderDocument(northwindModel("signal"), "resume", { target });
    assert.doesNotMatch(resume, /class="addressee/,"a resume naming the target company could read as current employment");
  });
});

describe("addressee mark keying (round-2 regression: 3E printed NorthwindMedia's logo)", () => {
  const northwindMark = { src: "data:image/png;base64,iVBORw0KGgo=", alt: "NorthwindMedia, Inc. logo", shape: "wordmark", company: "NorthwindMedia, Inc." };

  it("should never give company 3E the NorthwindMedia mark, and print 3E's monogram instead", () => {
    const logo = addresseeMark("3E", northwindMark);
    assert.equal(logo.source, "monogram");
    assert.notEqual(logo.src, northwindMark.src);
    assert.match(Buffer.from(logo.src.split(",")[1], "base64").toString("utf8"), />3E</);
  });

  it("should print a mark only for its own company, legal suffix aside", () => {
    assert.equal(addresseeMark("NorthwindMedia", northwindMark).src, northwindMark.src);
    assert.equal(addresseeMark("NorthwindMedia, Inc.", northwindMark).src, northwindMark.src);
  });

  it("should distrust a mark that does not say whose it is", () => {
    const { company: _c, ...anonymous } = northwindMark;
    assert.equal(addresseeMark("NorthwindMedia, Inc.", anonymous).source, "monogram");
  });

  it("should render the 3E fixture letter with 3E's monogram even when handed NorthwindMedia's mark", async () => {
    const { fullRenderModel } = await import("./fixtures/materials-render-fixture.mjs");
    const out = await renderPackage({ model: fullRenderModel("signal"), feature: "cover_letter", targetMark: northwindMark });
    assert.doesNotMatch(out.letterHtml, /NorthwindMedia, Inc\. logo/);
    assert.match(out.letterHtml, /alt="3E monogram"/);
  });

  it("should key the target cache by company, so two companies never share a file", () => {
    assert.notEqual(targetSlug("3E"), targetSlug("NorthwindMedia, Inc."));
    assert.equal(targetSlug("NorthwindMedia, Inc."), companyKey("NorthwindMedia"));
  });
});

describe("signal layout guards", () => {
  it("should let a long Re title wrap inside the rail instead of running into the letter", () => {
    const model = northwindModel("signal");
    model.documents.coverLetter.rail.find((r) => r.label === "Re").lines = ["Senior Director, Enterprise AI & Marketing Analytics Platforms"];
    const html = renderDocument(model, "coverLetter");
    assert.doesNotMatch(html, /white-space:\s*nowrap[^}]*\}[^{]*\.meta|\.meta[^{]*\{[^}]*white-space:\s*nowrap/);
    assert.match(html, /\.meta dd \{[^}]*overflow-wrap: break-word/);
    assert.match(html, /\.rail \{[^}]*min-width: 0/);
  });

  it("should print a thin model's earlier lines without repeating the section label", () => {
    const model = northwindModel("signal");
    const resume = model.documents.resume;
    resume.sections = [{ kind: "earlier", label: "Earlier", entries: [{ employerId: "earlier", meta: [], org: "Earlier", line: "Led digital strategy for a book." }] }];
    for (const family of FAMILIES) {
      model.template.family = family;
      const html = renderDocument(model, "resume");
      assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ""), />Earlier<\/(b|h3)>/, `${family} repeats the label as an employer`);
    }
  });

  it("should set the resume's figures as one ticker line with no employer brackets", () => {
    const html = renderDocument(northwindModel("signal"), "resume");
    assert.match(html, /<section class="ticker"/);
    assert.doesNotMatch(html, /class="channel/);
    const ticks = html.match(/<p class="tick"/g) || [];
    assert.ok(ticks.length >= 1 && ticks.length <= 4, `${ticks.length} ticks`);
  });
});

describe("signal contacts and header variants", () => {
  it("should derive a clickable URI for every contact kind but location, and nothing else", () => {
    assert.equal(contactLink({ kind: "email", text: "user@example.com" }), "mailto:user@example.com");
    assert.equal(contactLink({ kind: "phone", text: "555-010-2080" }), "tel:5550102080");
    assert.equal(contactLink({ kind: "phone", text: "+1 (555) 010-2080" }), "tel:+15550102080");
    assert.equal(contactLink({ kind: "linkedin", text: "linkedin.com/in/example" }), "https://linkedin.com/in/example");
    assert.equal(contactLink({ kind: "site", text: "example.com" }), "https://example.com");
    assert.equal(contactLink({ kind: "location", text: "Austin, CO" }), "");
    assert.equal(contactLink({ kind: "site", text: "javascript:alert(1)" }), "", "only mailto:, tel: and http(s): leave the renderer");
  });

  it("should print one header variant the family lists, and fall back to the default for anything else", () => {
    const family = resolveFamily("signal");
    assert.deepEqual(family.headers, ["paper", "ink"]);
    assert.ok(family.headers.includes(family.defaultHeader));
    const model = northwindModel("signal");
    assert.match(renderDocument(model, "resume", { header: "ink" }), /data-header="ink"/);
    assert.match(renderDocument(model, "resume", { header: "aurora" }), new RegExp(`data-header="${family.defaultHeader}"`), "the round-3 gradients are gone");
    const css = readFileSync(join(repoRoot, "templates/materials/signal/signal.css"), "utf8");
    assert.doesNotMatch(css, /data-palette/);
  });

  it("should keep the name one plain text run and put a dot over every i and j that fits on one line", () => {
    const spec = resolveFamily("signal").nameDots;
    const model = northwindModel("signal");
    model.identity.name = "Jordan Rivera";
    const html = renderDocument(model, "resume");
    assert.match(html, /<h1 class="name name--dots">Jordan Rivera<\/h1>/, "HTML text extractors (critic, quality) read the name whole");
    assert.equal((html.match(/<i class="nd nd--\d"/g) || []).length, 1);
    assert.equal(nameDots("Ruth Carlson", spec), null, "no i or j: no tittles, only the closing dot");
    assert.deepEqual(nameDots("Björn Olsen", spec).map((d) => d.n), [1], "the j of Björn takes the dot");
    assert.equal(nameDots("JORDAN “JO” RIVERA", spec), null);
    assert.equal((nameDots("Maximiliana Wilhelmina Fitzgibbon-Illingsworth", spec) || []).length, 8, "a long name still gets all eight of its dots: it shrinks to one line, it never wraps");
    assert.deepEqual(nameDots("Jiří", spec).map((d) => d.n), [1], "the lowercase i takes a dot; J and í do not");
    const css = readFileSync(join(repoRoot, "templates/materials/signal/signal.css"), "utf8");
    const name = /\n\.name \{([^}]*)\}/.exec(css)[1];
    assert.match(name, new RegExp(`letter-spacing: ${spec.letterSpacingEm}em;`));
    assert.match(name, new RegExp(`line-height: ${spec.lineHeight};`));
    assert.match(css, /\n\.name \{ white-space: nowrap; font-kerning: none; font-variant-ligatures: none; \}/);
  });

  it("should keep every header text/background pair at WCAG AA in both variants", () => {
    const css = readFileSync(join(repoRoot, "templates/materials/signal/signal.css"), "utf8");
    const root = /:root \{([^}]*)\}/.exec(css)[1];
    /** @param {string} body @param {string} name */
    const prop = (body, name) => (new RegExp(`--${name}:\\s*([^;]+);`).exec(body) || [])[1]?.trim();
    /** @param {string} v @param {number[]} [under] */
    const color = (v, under = [255, 255, 255]) => {
      const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
      if (ref) return color(prop(root, ref[1]), under);
      if (v.startsWith("#")) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
      const m = /rgba?\(([^)]+)\)/.exec(v);
      const [r, g, b, a = 1] = m[1].split(",").map(Number);
      return [r, g, b].map((c, i) => Math.round(a * c + (1 - a) * under[i]));
    };
    /** @param {number[]} c */
    const lum = (c) => {
      const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    /** @param {number[]} a @param {number[]} b */
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const id of resolveFamily("signal").headers) {
      const body = new RegExp(`\\.sheet\\[data-header="${id}"\\] \\{([^}]*)\\}`).exec(css)[1];
      const bg = color(prop(body, "band-bg"));
      const chip = color(prop(body, "chip-fill"), bg);
      const pairs = {
        "name and contact": [color(prop(body, "band-ink"), bg), bg],
        "target line": [color(prop(body, "band-soft"), bg), bg],
        "portfolio chip": [color(prop(body, "band-ink"), chip), chip],
      };
      for (const [label, [fg, back]] of Object.entries(pairs)) {
        assert.ok(ratio(fg, back) >= 4.5, `${id} ${label}: ${ratio(fg, back).toFixed(2)}`);
      }
    }
  });
});

describe("round 5: one-line names, employer marks, degraded summary, clean captions", () => {
  it("should size every family's name to one line from the face's metrics, shrinking long names and never below the floor", () => {
    const cases = [
      ["signal", "resume", { contact: ["512-555-0148", "linkedin.com/in/jordan-rivera-1a6885110"] }],
      ["signal", "coverLetter", { contact: ["512-555-0148", "linkedin.com/in/jordan-rivera-1a6885110"] }],
      ["dossier", "resume", { target: "Director, Digital Sales" }],
      ["editorial", "resume", {}],
      ["editorial", "coverLetter", { contact: ["512-555-0148", "linkedin.com/in/jordan-rivera-1a6885110"] }],
    ];
    for (const [family, doc, extra] of cases) {
      const spec = resolveFamily(family).nameFit[doc];
      const identity = { name: "", nameFirst: "", nameLast: "", target: "", contact: [], ...extra };
      const short = fitName({ ...identity, name: "Ann Lee", nameFirst: "Ann ", nameLast: "Lee" }, spec);
      assert.equal(Number(short.pt), spec.maxPt, `${family} ${doc}: a short name keeps the design size`);
      const caps = fitName({ ...identity, name: "JORDAN RIVERA", nameFirst: "JORDAN ", nameLast: "RIVERA" }, spec);
      assert.ok(Number(caps.pt) <= spec.maxPt && Number(caps.pt) >= 10, `${family} ${doc}: ${caps.pt}pt`);
      const huge = fitName({ ...identity, name: "Maximiliana Wilhelmina Fitzgibbon-Illingsworth de la Cruz", nameFirst: "Maximiliana Wilhelmina ", nameLast: "Fitzgibbon-Illingsworth de la Cruz" }, spec);
      assert.ok(Number(huge.pt) < Number(caps.pt), `${family} ${doc}: a longer name sets smaller`);
    }
  });

  it("should key and monogram a company by its own name, without parentheticals or 'formerly' clauses", () => {
    assert.equal(companyKey("Contoso (formerly Fabrikam)"), "contoso");
    assert.equal(companyKey("Contoso, formerly Fabrikam"), "contoso");
    assert.equal(monogramInitials("Contoso (formerly Fabrikam)"), "CO");
    assert.equal(companyDisplayName("Meridian Insights Group (meridian.example.org)"), "Meridian Insights Group");
    assert.equal(companyDomainHint("Meridian Insights Group (meridian.example.org)"), "meridian.example.org", "a domain the resume gives is the lookup hint");
    assert.equal(companyDomainHint("Contoso (formerly Fabrikam)"), "");
    assert.equal(companyKey("Now Media Group"), "now-media-group", "only 'formerly'-style clauses are asides");
  });

  it("should resolve a mark for every employer, cache it, and never touch the network in tests", async () => {
    const root = mkdtempSync(join(tmpdir(), "materials-employer-marks-"));
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000060000000600806000000e2987738000000017352474200aece1ce90000000c49444154789c63600000000200015e2f5b1d0000000049454e44ae426082", "hex");
    /** @type {Array<{ slug: string, label: string, domain: string }>} */
    const jobs = [];
    const resolve = async (/** @type {{ dir: string, slug: string, label: string, domain: string }} */ job) => {
      jobs.push({ slug: job.slug, label: job.label, domain: job.domain });
      if (job.slug === "pipeworks") return [{ slug: job.slug, source: "missing", detail: "" }];
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(join(job.dir, "assets"), { recursive: true });
      writeFileSync(join(job.dir, "assets", `logo-${job.slug}.png`), png);
      return [{ slug: job.slug, source: "site", detail: "stub" }];
    };
    try {
      const names = ["Contoso (formerly Fabrikam)", "Meridian Insights Group (meridian.example.org)", "Pipeworks"];
      const marks = await loadEmployerMarks(names, { templateRoot: root, resolve });
      /* Lookups run a few at a time, so they may finish in any order. */
      assert.deepEqual(jobs.map((j) => [j.slug, j.label, j.domain]).sort(), [
        ["contoso", "Contoso", ""],
        ["meridian-insights-group", "Meridian Insights Group", "meridian.example.org"],
        ["pipeworks", "Pipeworks", ""],
      ], "one lookup each, by the company's own name, with the resume's domain when it gives one");
      assert.deepEqual(marks.map((m) => m.slug).sort(), ["contoso", "meridian-insights-group"]);
      assert.ok(marks.every((m) => m.src.startsWith("data:image/png;base64,")), "embedded offline, as data URIs");
      jobs.length = 0;
      await loadEmployerMarks(names, { templateRoot: root, resolve });
      assert.deepEqual(jobs, [], "cached marks and a recent miss are not looked up again");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("should read a cached SVG logo that opens with an XML prolog (meridian.example.org serves one)", () => {
    assert.equal(looksLikeImage(Buffer.from("<?xml version='1.0' encoding='utf-8'?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"></svg>")), true);
    assert.equal(looksLikeImage(Buffer.from("<!DOCTYPE html><html><body>soft 404</body></html>")), false);
  });

  it("should print a resolved mark for each employer and a monogram only where every source failed", async () => {
    const model = northwindModel("signal");
    const experience = model.documents.resume.sections.find((s) => s.kind === "experience");
    const [first, second] = experience.entries;
    first.org = "Cumulus Media (formerly Cumulus Broadcasting)";
    const mark = { slug: "cumulus-media", label: "Cumulus Media", domain: "", src: "data:image/png;base64,iVBORw0KGgo=", alt: "Cumulus Media logo", shape: "mark" };
    const out = await renderPackage({ model, feature: "resume", employerMarks: [mark] });
    assert.match(out.resumeHtml, /alt="Cumulus Media logo"/, "the resolved mark, matched by the company's own name");
    assert.match(out.resumeHtml, new RegExp(`alt="${second.org} monogram"`), "no source found: the monogram, and only then");
    assert.deepEqual(employersWithoutMarks(model).slice(0, 2), [first.org, second.org]);
  });

  it("should print no summary when a degraded draft's summary only repeats the headline", () => {
    const model = northwindModel("signal");
    model.identity.target = "Digital Sales Leader • AI Product Builder";
    model.documents.resume.statement = { runs: [{ t: "Digital Sales Leader \u2022 AI Product Builder" }] };
    for (const family of FAMILIES) {
      const m = JSON.parse(JSON.stringify(model));
      m.template.family = family;
      const html = renderDocument(m, "resume");
      assert.match(html, /<section data-section="summary" data-omitted="repeats-headline" hidden><\/section>/, `${family}: an empty, hidden marker QA reads`);
      assert.doesNotMatch(html, /data-section="summary">/, `${family}: no summary section with the headline in it`);
    }
    assert.equal(repeatsHeadline("A real summary about the work.", "Director, Digital Sales"), false);
  });

  it("should end every ticker caption at a clean boundary, or drop the figure", () => {
    const src = "Assisted 12 AE desks via a digital-first motion: 24+ logged proposals/period via Samplecrm, 1:1 coaching";
    assert.equal(cleanCaption("AE desks via a digital-first", src), "AE desks");
    assert.equal(cleanCaption("24+ logged proposals/period via Samplecrm", src), "24+ logged proposals/period via Samplecrm");
    assert.equal(cleanCaption("Online Program Leads", "up to 4 Online Program Leads and partnered with media teams"), "Online Program Leads");
    assert.equal(cleanCaption("in three years while holding", "from $6.1M to $10.4M in three years while holding 94% retention"), "in three years");
    assert.equal(cleanCaption("of the", "x of the y"), "", "nothing clean left: drop it");
    const model = northwindModel("signal");
    const html = renderDocument(model, "resume");
    for (const cap of html.match(/<span class="cap">[^<]*<\/span>/g) || []) {
      assert.doesNotMatch(cap, /\s(a|an|the|and|or|to|of|for|with|through|via|while)<\/span>$/, `dangling caption ${cap}`);
    }
  });
});

describe("PDF text layer (needs Playwright's Chromium)", async () => {
  const session = await openPdfSession();
  after(() => session?.close());
  const python = spawnSync("/usr/bin/python3", ["-c", "import pypdf"], { stdio: "ignore" }).status === 0 ? "/usr/bin/python3" : null;

  it("should embed no Type3 font and extract probe words whole in every family", { skip: session ? false : "Playwright unavailable" }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "materials-text-layer-"));
    try {
      for (const family of FAMILIES) {
        const resumePdfPath = join(dir, `${family}-resume.pdf`);
        const coverLetterPdfPath = join(dir, `${family}-letter.pdf`);
        const out = await renderPackage({ model: northwindModel(family), feature: "both", session, pdfPaths: { resumePdfPath, coverLetterPdfPath } });
        assert.ok(!out.notes.some((n) => n.startsWith("pdf_text_layer")), `${family}: ${out.notes.join("; ")}`);
        for (const path of [resumePdfPath, coverLetterPdfPath]) {
          assert.equal(pdfType3FontCount(readFileSync(path)), 0, `${path} embeds a Type3 font`);
          if (!python) continue;
          const text = spawnSync(python, ["-c", "import sys,pypdf;print(''.join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))", path], { encoding: "utf8" }).stdout;
          for (const word of ["Director", "Digital", "Sales", "Cumulus", "account", "programmatic"]) {
            assert.ok(text.includes(word), `${family} ${path.endsWith("letter.pdf") ? "letter" : "resume"}: "${word}" split or missing in pypdf text`);
          }
          assert.doesNotMatch(text, /Directo r|S ales|m anag/);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should extract the header name exactly, for any name, in both header variants", { skip: !session ? "Playwright unavailable" : !python ? "pypdf unavailable" : false }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "materials-name-"));
    try {
      /* Names with i's (colored tittles), none (only the closing dot), all
         caps, a j, and letters outside ASCII. */
      for (const name of ["Jordan Avila", "Jordan Rivera", "Björn Olsen", "Ruth Carlson", "JORDAN “JO” RIVERA", "Jiří Novák"]) {
        for (const header of ["paper", "ink"]) {
          const model = northwindModel("signal");
          model.identity.name = name;
          const path = join(dir, `${header}-${name.length}.pdf`);
          await renderPackage({ model, feature: "resume", session, header, pdfPaths: { resumePdfPath: path } });
          const text = spawnSync(python, ["-c", "import sys,pypdf;print(pypdf.PdfReader(sys.argv[1]).pages[0].extract_text())", path], { encoding: "utf8" }).stdout;
          /* A long name wraps; its line break stands for the space it replaced
             (and it must be a real break: at line-height <= 1 pypdf glued the
             lines as "“JO”RIVERA"). */
          const flat = text.replace(/\n/g, " ");
          assert.ok(flat.startsWith(name), `${header}: "${name}" extracted as "${flat.slice(0, name.length + 8)}"`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should keep long and hyphenated names on one line in every family's PDF", { skip: !session ? "Playwright unavailable" : !python ? "pypdf unavailable" : false }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "materials-oneline-"));
    try {
      for (const name of ["JORDAN RIVERA", "Maximiliana Wilhelmina Fitzgibbon-Illingsworth de la Cruz"]) {
        for (const [family, header] of [["signal", "paper"], ["signal", "ink"], ["dossier", undefined], ["editorial", undefined]]) {
          for (const doc of ["resume", "coverLetter"]) {
            const model = northwindModel(family);
            model.identity.name = name;
            model.identity.contact = [
              { kind: "phone", text: "512-555-0148" },
              { kind: "linkedin", text: "linkedin.com/in/jordan-rivera-1a6885110" },
            ];
            const path = join(dir, `${family}-${header || "x"}-${doc}-${name.length}.pdf`);
            await renderPackage({
              model, feature: doc === "resume" ? "resume" : "cover_letter", session, header,
              pdfPaths: doc === "resume" ? { resumePdfPath: path } : { coverLetterPdfPath: path },
            });
            const first = spawnSync(python, ["-c", "import sys,pypdf;print(pypdf.PdfReader(sys.argv[1]).pages[0].extract_text().split(chr(10))[0])", path], { encoding: "utf8" }).stdout.trim();
            /* Editorial sets first and last names on two lines by design;
               each must stay whole on its line. */
            const want = family === "editorial" && doc === "resume" ? name.split(" ")[0] : name;
            /* Dossier's target line shares the name's row, so it follows on the same extracted line. */
            assert.ok(first === want || first.startsWith(`${want} `), `${family} ${header || ""} ${doc}: first line "${first}"`);
          }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should make every signal contact a real PDF link and still read it as plain text", { skip: !session ? "Playwright unavailable" : !python ? "pypdf unavailable" : false }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "materials-links-"));
    try {
      for (const doc of ["resume", "cover-letter"]) {
        const path = join(dir, `${doc}.pdf`);
        await renderPackage({
          model: northwindModel("signal"),
          feature: doc === "resume" ? "resume" : "cover_letter",
          session,
          pdfPaths: doc === "resume" ? { resumePdfPath: path } : { coverLetterPdfPath: path },
        });
        const script = [
          "import sys, json, pypdf",
          "r = pypdf.PdfReader(sys.argv[1]); p = r.pages[0]",
          "uris = [a.get_object()['/A'].get('/URI') for a in (p.get('/Annots') or []) if a.get_object().get('/Subtype') == '/Link' and '/A' in a.get_object()]",
          "print(json.dumps({'uris': uris, 'text': p.extract_text()}))",
        ].join("\n");
        const out = JSON.parse(spawnSync(python, ["-c", script, path], { encoding: "utf8" }).stdout);
        for (const uri of ["mailto:user@example.com", "tel:5550102080", "https://linkedin.com/in/jordan-avila-example", "https://jordan-avila.example.com"]) {
          /* Chromium writes a bare host with its root slash ("https://x.com/"). */
          assert.ok(out.uris.includes(uri) || out.uris.includes(`${uri}/`), `${doc}: no /Link to ${uri} (got ${out.uris.join(", ")})`);
        }
        for (const plain of ["user@example.com", "555-010-2080", "linkedin.com/in/jordan-avila-example", "jordan-avila.example.com", "Austin, CO"]) {
          assert.ok(out.text.includes(plain), `${doc}: "${plain}" does not read as plain text`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /* Jordan's Northwind resume (2026-09-28): pypdf 6.13 read the emphasized
     figures as "$10M +" and "$3.1M  of" while the letter and resume.txt were
     clean. Geist Mono's advances were the cause; figures now stay in the text
     face. Every local pypdf is asked, since versions differ on this. */
  const pythons = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"].filter(
    (py, i, all) => all.indexOf(py) === i && existsSync(py) && spawnSync(py, ["-c", "import pypdf"], { stdio: "ignore" }).status === 0,
  );
  it("should extract emphasized resume figures whole: $12M+, $3.1M of, 125% YoY", { skip: !session ? "Playwright unavailable" : !pythons.length ? "pypdf unavailable" : false }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "materials-figures-"));
    try {
      for (const family of FAMILIES) {
        const model = northwindModel(family);
        const resume = model.documents.resume;
        resume.statement = { runs: [{ t: "Digital sales leader who grew a " }, { n: "$12M+" }, { t: " media book to a " }, { n: "top-4" }, { t: " national ranking." }] };
        const experience = resume.sections.find((s) => s.kind === "experience");
        const entry = experience && experience.entries ? experience.entries[0] : null;
        assert.ok(entry, `${family}: fixture has an experience entry`);
        entry.bullets = [
          { claimId: "f1", runs: [{ t: "Owned a " }, { n: "$12M+" }, { t: " annual digital media P&L across Austin accounts." }] },
          { claimId: "f2", runs: [{ t: "Ran " }, { n: "24+" }, { t: " forecasts against " }, { n: "$3.1M" }, { t: " of live pipeline data." }] },
          { claimId: "f3", runs: [{ t: "Delivered " }, { n: "125%" }, { t: " YoY paid-search conversion growth." }] },
        ];
        resume.sections = resume.sections.filter((s) => s.kind !== "readouts");
        resume.sections.unshift({
          kind: "readouts",
          label: "Verified figures",
          readouts: [
            { n: "$12M+", caption: "annual digital media P&L", claimId: "f1", employerId: entry.employerId },
            { n: "$3.1M", caption: "of live pipeline data", claimId: "f2", employerId: entry.employerId },
            { n: "125%", caption: "YoY conversion growth", claimId: "f3", employerId: entry.employerId },
          ],
        });
        for (const header of family === "signal" ? ["paper", "ink"] : [undefined]) {
          const path = join(dir, `${family}-${header || "default"}.pdf`);
          await renderPackage({ model, feature: "resume", session, ...(header ? { header } : {}), pdfPaths: { resumePdfPath: path } });
          for (const py of pythons) {
            const text = spawnSync(py, ["-c", "import sys,pypdf;print(pypdf.PdfReader(sys.argv[1]).pages[0].extract_text())", path], { encoding: "utf8" }).stdout;
            const flat = text.replace(/\s*\n\s*/g, " ");
            for (const probe of ["$12M+", "$3.1M of", "125% YoY"]) {
              assert.ok(flat.includes(probe), `${family}${header ? `/${header}` : ""} (${py}): "${probe}" split in the text layer`);
            }
            assert.doesNotMatch(text, /\$10M \+|\$2\.4M {2,}of|130 %/, `${family}${header ? `/${header}` : ""} (${py})`);
          }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
