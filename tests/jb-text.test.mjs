// tests/jb-text.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadJbText() {
  const src = readFileSync(join(repoRoot, "jb-text.js"), "utf8");
  const sandbox = { window: {} };
  /* Evaluated in THIS realm, not a fresh vm realm: node:assert/strict's
     deepEqual is prototype-sensitive, so arrays/objects built inside a
     vm context never deep-equal a literal written here. The module still
     sees only the injected `window`, exactly as it does in the browser. */
  vm.runInThisContext(`(function (window) {\n${src}\n})`)(sandbox.window);
  return sandbox.window.JobBoredText;
}
const T = loadJbText();

describe("decodeEntities", () => {
  it("decodes named, numeric, and hex entities exactly one level", () => {
    assert.equal(T.decodeEntities("Design &amp; Ship"), "Design & Ship");
    assert.equal(T.decodeEntities("&quot;quoted&quot; &#39;apos&#39;"), "\"quoted\" 'apos'");
    assert.equal(T.decodeEntities("A&nbsp;B &ndash; C&hellip;"), "A B – C…");
    assert.equal(T.decodeEntities("&#8217;s &#x2019;s"), "’s ’s");
    // single-level: double-encoded input surfaces the literal entity text
    assert.equal(T.decodeEntities("&amp;amp;"), "&amp;");
    assert.equal(T.decodeEntities("&amp;lt;p&amp;gt;"), "&lt;p&gt;");
  });
  it("leaves non-entities and unknown names untouched", () => {
    assert.equal(T.decodeEntities("AT&T R&D; 5 &up"), "AT&T R&D; 5 &up");
    assert.equal(T.decodeEntities("&notanentity;"), "&notanentity;");
  });
});

describe("stripMarkdownInline", () => {
  it("demotes emphasis, code, and links to plain text", () => {
    assert.equal(T.stripMarkdownInline("**5+ years** of *React* and `Node.js`"), "5+ years of React and Node.js");
    assert.equal(T.stripMarkdownInline("__bold__ and _ital_"), "bold and ital");
    assert.equal(T.stripMarkdownInline("[Apply here](https://x.co/a)"), "Apply here (https://x.co/a)");
  });
  it("never eats legitimate asterisks/underscores inside tokens", () => {
    assert.equal(T.stripMarkdownInline("C* algebra snake_case 2*3"), "C* algebra snake_case 2*3");
  });
});

describe("normalizeInline", () => {
  it("collapses newlines/NBSP, strips zero-width + control chars, trims", () => {
    assert.equal(T.normalizeInline("Senior\nEngineer\u00A0\u200B(Remote)\t"), "Senior Engineer (Remote)");
    assert.equal(T.normalizeInline("**Denver**, CO"), "Denver, CO");
    assert.equal(T.normalizeInline(null), "");
  });
});

describe("stripListGlyph", () => {
  it("strips one leading marker of any flavor", () => {
    for (const g of ["- ", "* ", "• ", "· ", "‣ ", "▪ ", "1. ", "12) ", "– ", "— "]) {
      assert.equal(T.stripListGlyph(`${g}Own the roadmap`), "Own the roadmap", `glyph ${JSON.stringify(g)}`);
    }
    assert.equal(T.stripListGlyph("2020. A fine year"), "A fine year"); // acceptable: leading enum stripped
    assert.equal(T.stripListGlyph("No glyph here"), "No glyph here");
  });
});

describe("itemText", () => {
  it("never yields [object Object]", () => {
    assert.equal(T.itemText({ text: "From object" }), "From object");
    assert.equal(T.itemText({ name: "Named" }), "Named");
    assert.equal(T.itemText({ weird: 1 }), "");
    assert.equal(T.itemText("plain"), "plain");
    assert.equal(T.itemText(7), "7");
  });
});

describe("toBlocks", () => {
  it("splits paragraphs on blank lines and soft-wraps single newlines", () => {
    assert.deepEqual(T.toBlocks("Para one line a\nline b\n\nPara two."), [
      { kind: "p", text: "Para one line a line b" },
      { kind: "p", text: "Para two." },
    ]);
  });
  it("recognizes colon, markdown, and ALL-CAPS headings — including periods and lowercase", () => {
    assert.deepEqual(T.toBlocks("U.S. Requirements:\n- Visa"), [
      { kind: "heading", text: "U.S. Requirements" },
      { kind: "bullets", items: ["Visa"] },
    ]);
    assert.deepEqual(T.toBlocks("## What you'll do\nShip things."), [
      { kind: "heading", text: "What you'll do" },
      { kind: "p", text: "Ship things." },
    ]);
    assert.deepEqual(T.toBlocks("BENEFITS\nHealth. Dental."), [
      { kind: "heading", text: "BENEFITS" },
      { kind: "p", text: "Health. Dental." },
    ]);
  });
  it("does NOT steal the first line of an ordinary paragraph as a heading", () => {
    assert.deepEqual(T.toBlocks("We are seeking an engineer\nwho has experience with Go."), [
      { kind: "p", text: "We are seeking an engineer who has experience with Go." },
    ]);
  });
  it("handles numbered + unicode bullets and wrapped continuation lines", () => {
    assert.deepEqual(T.toBlocks("Duties:\n1. Build the API\n2. Own deploys\nacross three regions\n‣ Mentor"), [
      { kind: "heading", text: "Duties" },
      { kind: "bullets", items: ["Build the API", "Own deploys across three regions", "Mentor"] },
    ]);
  });
  it("returns [] for empty input and never throws on junk", () => {
    assert.deepEqual(T.toBlocks(""), []);
    assert.deepEqual(T.toBlocks(null), []);
  });
});

describe("clip", () => {
  it("returns short strings unchanged, without ellipsis", () => {
    assert.equal(T.clip("short", 300), "short");
  });
  it("cuts at a word boundary with ellipsis, within budget", () => {
    const src = "Architecture reviews and design docs every sprint";
    const out = T.clip(src, 20);
    assert.ok(out.length <= 20, `len ${out.length}`);
    assert.ok(out.endsWith("…"));
    const prefix = out.slice(0, -1);
    assert.ok(src.startsWith(prefix), "clip must be a prefix of the source");
    assert.equal(src.charAt(prefix.length), " ", "cut must land on a word boundary");
    assert.equal(out, "Architecture…");
  });
  it("never splits a surrogate pair", () => {
    const s = "x".repeat(9) + "💡rest of the text";
    const out = T.clip(s, 11); // raw slice(0,10) would land between the 💡 surrogates
    assert.ok(!/[\uD800-\uDBFF]…$/.test(out), "lone high surrogate before ellipsis");
    assert.ok(out.length <= 11);
  });
});

describe("escapeAttr", () => {
  it("escapes the five specials plus newlines", () => {
    assert.equal(T.escapeAttr('a"b\nc'), "a&quot;b&#10;c");
  });
});
