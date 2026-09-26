/**
 * Render model + family → HTML (server/materials-render.mjs), run once per
 * family and document against the 3E fixture (visual spec §8, §9.2).
 * Layout fit, PDF page count and PDF text order need a browser; they live in
 * tests/e2e-visual/materials-templates.spec.mjs.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { critiqueMaterials } from "../server/materials-critic.mjs";
import { analyzeHtml } from "../server/materials-quality.mjs";
import {
  escapeHtml,
  parseTemplate,
  renderDocument,
  renderTemplate,
  retargetModel,
  validateRenderModel,
} from "../server/materials-render.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { baseRenderModel, fullRenderModel, MOCK_DIR } from "./fixtures/materials-render-fixture.mjs";

const FAMILIES = ["signal", "dossier", "editorial"];
const DOCS = /** @type {const} */ (["resume", "coverLetter"]);
const ledger = JSON.parse(readFileSync(`${MOCK_DIR}/claim-ledger.json`, "utf8"));
const LEDGER_CLAIMS = new Set(ledger.claims.map((c) => c.id));
const LEDGER_EMPLOYERS = new Set(ledger.employers.map((e) => e.name));

/** @param {string} html */
function body(html) {
  return html.replace(/<head>[\s\S]*?<\/head>/i, "");
}

/** @param {string} html */
function text(html) {
  return body(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} html */
function styles(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

describe("template engine", () => {
  it("should escape values, print only renderer-built HTML raw, and support if/unless/each", () => {
    const out = renderTemplate(
      "{{a}}|{{#if b}}yes{{else}}no{{/if}}|{{#unless c}}u{{/unless}}|{{#each list}}{{this}}{{#unless @last}},{{/unless}}{{/each}}|{{nested.x}}",
      { a: '<b>"x"</b>', b: false, c: 0, list: ["1", "2"], nested: { x: "&" } },
    );
    assert.equal(out, "&lt;b&gt;&quot;x&quot;&lt;/b&gt;|no|u|1,2|&amp;");
    assert.throws(() => parseTemplate("{{#if a}}open"), /unclosed/);
    assert.throws(() => parseTemplate("{{/if}}"), /unbalanced/);
    assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  });

  it("should never accept markup from the model", () => {
    const model = fullRenderModel("signal");
    model.identity.name = "Alex <script>alert(1)</script> Rivera";
    model.documents.resume.sections[1].entries[0].bullets[0].runs = [{ t: "<img src=x onerror=alert(1)>" }, { n: "21" }];
    for (const doc of DOCS) {
      const html = renderDocument(model, doc);
      assert.doesNotMatch(body(html), /<script>|<img src=x/);
      assert.match(html, /Alex &lt;script&gt;/);
    }
  });
});

for (const family of FAMILIES) {
  for (const doc of DOCS) {
    describe(`${family} ${doc}`, () => {
      const model = fullRenderModel(family);
      const html = renderDocument(model, doc);

      it("should be one article.page[data-page] with no script", () => {
        const pages = html.match(/<article\b[^>]*\bclass="[^"]*\bpage\b[^"]*"[^>]*>/g) || [];
        assert.equal(pages.length, 1);
        assert.match(pages[0], /data-page="1"/);
        assert.match(pages[0], new RegExp(`data-family="${family}"`));
        assert.doesNotMatch(html, /<script/i);
        // server/materials-quality.mjs counts pages from article.page.
        assert.equal(analyzeHtml(html).pageWords.length, 1);
      });

      it("should open on the name, with the contact block before any section heading (rule 6)", () => {
        const t = text(html);
        assert.ok(t.startsWith(model.identity.name), `opens on "${t.slice(0, 60)}"`);
        const sheet = body(html);
        const emailAt = sheet.indexOf("emilio3435@gmail.com");
        const h2At = sheet.search(/<h2\b/);
        assert.ok(emailAt > 0);
        if (h2At >= 0) assert.ok(emailAt < h2At, "contact precedes the first h2");
      });

      it("should inline its vendored faces and load nothing from the network (rule 5)", () => {
        const css = styles(html);
        assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com|<link\b/);
        for (const name of resolveFamily(family).fonts) {
          const faceName = name.replace(/ Italic$/, "");
          assert.match(css, new RegExp(`font-family: '${faceName}';[\\s\\S]*?src: url\\(data:font/woff2;base64,`), `${name} is inlined`);
        }
        for (const url of body(html).match(/(?:src|href)="(https?:[^"]+)"/g) || []) {
          assert.match(url, /href="(https:\/\/(emiliobuilds\.com|www\.linkedin\.com)|mailto:)/, `unexpected remote asset ${url}`);
        }
      });

      it("should render logos from the resolver unaltered, with alt text (rule 3)", () => {
        const imgs = [...body(html).matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
        const logoSrcs = new Set(JSON.stringify(model).match(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g));
        for (const tag of imgs) {
          const src = (tag.match(/\bsrc="([^"]+)"/) || [])[1];
          assert.ok(logoSrcs.has(src), "every img src is a resolver mark, byte for byte");
          assert.match(tag, /\balt="[^"]+ logo"/);
          assert.doesNotMatch(tag, /filter|mix-blend/);
        }
        assert.doesNotMatch(styles(html), /\bfilter\s*:|mix-blend-mode/);
      });

      it("should never split a word with a drop cap (rule 7)", () => {
        const css = styles(html);
        assert.doesNotMatch(css, /initial-letter/);
        for (const rule of css.matchAll(/::first-letter\s*\{([^}]*)\}/g)) {
          assert.doesNotMatch(rule[1], /\bfloat\s*:/);
        }
      });

      it("should carry facts only from the model: every data-claim is a ledger claim", () => {
        const claims = [...html.matchAll(/data-claim="([^"]+)"/g)].map((m) => m[1]);
        assert.ok(claims.length > 0);
        for (const id of claims) assert.ok(LEDGER_CLAIMS.has(id), `data-claim="${id}"`);
      });

      it("should render the accent it is given, and fall back to volt for one the family does not list (rule 10)", () => {
        const ink = fullRenderModel(family);
        ink.template.accent = "ink";
        assert.match(renderDocument(ink, doc), /data-accent="ink"/);
        const bogus = fullRenderModel(family);
        bogus.template.accent = "ember";
        assert.match(renderDocument(bogus, doc), /data-accent="volt"/);
        assert.match(styles(html), /\[data-accent="ink"\]/, "the stylesheet defines the ink accent");
      });

      it("should render unclipped until a measured fit says it may clip (rule 4)", () => {
        /** @param {string} out */
        const sheetTag = (out) => (out.match(/<article\b[^>]*>/) || [""])[0];
        assert.doesNotMatch(sheetTag(html), /data-fit-verified/);
        assert.match(sheetTag(renderDocument(model, doc, { fitVerified: true })), /data-fit-verified/);
        const over = sheetTag(renderDocument(model, doc, { fitVerified: true, overflow: true }));
        assert.match(over, /data-overflow/);
        assert.doesNotMatch(over, /data-fit-verified/);
        assert.match(styles(html), /article\.page:not\(\[data-fit-verified\]\) \{ height: auto !important;[^}]*overflow: visible !important/);
      });

      it("should render acceptably without any optional field (§8)", () => {
        const bare = baseRenderModel();
        const retargeted = retargetModel(bare, resolveFamily(family));
        const out = renderDocument(retargeted, doc);
        assert.ok(text(out).startsWith(retargeted.identity.name));
        assert.doesNotMatch(out, /undefined|\[object Object\]/);
      });
    });
  }

  describe(`${family} resume QA markers`, () => {
    const html = renderDocument(fullRenderModel(family), "resume");

    it("should mark employers as h2.company-name that the critic reads", async () => {
      const names = [...html.matchAll(/<h2\b[^>]*\bcompany-name\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => text(m[1]));
      assert.ok(names.length >= 2);
      for (const name of names) assert.ok(LEDGER_EMPLOYERS.has(name), `h2.company-name "${name}"`);
      const card = await critiqueMaterials({
        letterHtml: "",
        resumeHtml: html,
        jdText: "",
        masterResumeHtml: "",
        sourceResumeText: [...LEDGER_EMPLOYERS].join("\n"),
        writerJson: {},
      });
      assert.equal(card.issues.some((i) => i.code === "invented_employer"), false);
    });

    it("should carry the sections materials-quality requires", () => {
      const sections = analyzeHtml(html).sections;
      for (const name of ["summary", "experience", "education", "skills"]) {
        assert.ok(sections.includes(name), `data-section="${name}"`);
      }
    });

    it("should typeset metric runs as span.n and nothing else as a figure", () => {
      const figures = [...html.matchAll(/<span class="n">([^<]+)<\/span>/g)].map((m) => m[1]);
      const tokens = new Set(ledger.claims.flatMap((c) => (c.metrics || []).map((m) => m.token)).concat(["25", "15"]));
      assert.ok(figures.length >= 6);
      for (const figure of figures) assert.ok(tokens.has(figure), `figure ${figure}`);
    });
  });
}

describe("wordmarks and names", () => {
  it("should hide signal's duplicate name beside a wordmark visually but keep it in the text", () => {
    const html = renderDocument(fullRenderModel("signal"), "resume");
    assert.match(html, /<h2 class="org company-name visually-dup">Audacy <\/h2>/);
    assert.match(html, /<h2 class="org company-name">Elio Intelligence Suite<\/h2>/, "a square mark keeps its visible name");
    assert.match(styles(html), /\.visually-dup\s*\{[^}]*color: transparent/);
    assert.doesNotMatch(styles(html).match(/\.visually-dup\s*\{[^}]*\}/)[0], /overflow:\s*hidden|clip/, "a clipped duplicate drops out of the PDF text layer");
  });

  it("should keep dossier's and editorial's names visible (their logos sit apart from the name)", () => {
    for (const family of ["dossier", "editorial"]) {
      assert.doesNotMatch(renderDocument(fullRenderModel(family), "resume"), /visually-dup">/);
    }
  });

  it("should keep a real text space in editorial's two-line name", () => {
    const html = renderDocument(fullRenderModel("editorial"), "resume");
    assert.match(html, /<span class="l1">Emilio <\/span><span class="l2">Nunez-Garcia<\/span>/);
    assert.match(styles(html), /\.name \.l1 \{ display: block; white-space: pre; \}/);
  });
});

describe("render model helpers", () => {
  it("should validate the full fixture in every family after retargeting", () => {
    for (const family of FAMILIES) {
      const model = retargetModel(fullRenderModel("signal"), resolveFamily(family));
      const result = validateRenderModel(model);
      assert.equal(result.ok, true, `${family}: ${result.errors.join("; ")}`);
      assert.equal(model.template.family, family);
      assert.equal(model.documents.resume.templateId, `${family}.resume`);
      assert.equal(model.documents.coverLetter.templateId, `${family}.letter`);
    }
  });

  it("should leave everything but the template block untouched when retargeting", () => {
    const model = fullRenderModel("signal");
    const out = retargetModel(model, resolveFamily("editorial"));
    const strip = (m) => ({ ...m, template: null, documents: { resume: { ...m.documents.resume, templateId: null }, coverLetter: { ...m.documents.coverLetter, templateId: null } } });
    assert.deepEqual(strip(out), strip(model));
    assert.equal(model.template.family, "signal", "the input is not mutated");
  });
});
