// tests/text-normalize.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  decodeHtmlEntities,
  htmlToText,
  normalizeJobText,
  normalizeInlineField,
} from "../server/shared/text-normalize.mjs";

describe("htmlToText", () => {
  it("keeps paragraph boundaries as blank lines (Canonical Job Text §3)", () => {
    assert.equal(
      htmlToText("<div>About Us</div><div>We are building rockets.</div>"),
      "About Us\n\nWe are building rockets.",
    );
    assert.equal(
      htmlToText("<p>First.</p><p>Second.</p>"),
      "First.\n\nSecond.",
    );
  });
  it("renders list items as '- ' lines", () => {
    assert.equal(
      htmlToText("<h3>Requirements:</h3><ul><li>5+ years</li><li>Go &amp; Rust</li></ul>"),
      "Requirements:\n\n- 5+ years\n- Go & Rust",
    );
  });
  it("decodes entity-encoded HTML before stripping (Greenhouse double-encoding)", () => {
    assert.equal(
      htmlToText("&lt;p&gt;Health &amp;amp; dental&lt;/p&gt;&lt;p&gt;401k&lt;/p&gt;"),
      "Health &amp; dental\n\n401k",
    );
  });
  it("separates table cells and rows", () => {
    const out = htmlToText("<table><tr><td>Base</td><td>$150k</td></tr><tr><td>Bonus</td><td>10%</td></tr></table>");
    assert.match(out, /Base · \$150k\nBonus · 10%/);
  });
  it("drops script/style and survives junk", () => {
    assert.equal(htmlToText("<style>p{}</style><p>Real</p><script>x()</script>"), "Real");
    assert.equal(htmlToText(null), "");
  });
});

describe("normalizeJobText", () => {
  it("normalizes newlines, strips zero-width + markdown emphasis, caps blank runs", () => {
    assert.equal(
      normalizeJobText("Line\u200B one\r\n\r\n\r\n\r\n**Bold** two\r\nthree\t "),
      "Line one\n\nBold two\nthree",
    );
  });
});

describe("normalizeInlineField", () => {
  it("collapses to a clean single line", () => {
    assert.equal(normalizeInlineField("Senior\nEngineer&nbsp;— *Remote*"), "Senior Engineer — Remote");
  });
});

describe("decodeHtmlEntities", () => {
  it("is single-level like the client twin", () => {
    assert.equal(decodeHtmlEntities("&amp;amp;"), "&amp;");
    assert.equal(decodeHtmlEntities("AT&T"), "AT&T");
  });
});

/* The two modules deliberately carry duplicate copies of the entity map and
   the shared regexes (browser classic script vs. server ESM — see the header
   of each file). This pins them together so a fix applied to one runtime can
   never silently skip the other. */
describe("client/server twin parity", () => {
  const read = (rel) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");
  const clientSrc = read("jb-text.js");
  const serverSrc = read("server/shared/text-normalize.mjs");

  const entityMap = (src) => {
    const start = src.indexOf("NAMED_ENTITIES = {");
    assert.ok(start > -1, "NAMED_ENTITIES map must exist");
    const end = src.indexOf("};", start) + 2;
    return src
      .slice(start, end)
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
  };

  it("keeps NAMED_ENTITIES byte-identical across runtimes", () => {
    assert.equal(entityMap(clientSrc), entityMap(serverSrc));
  });

  it("keeps the shared scanning regexes identical across runtimes", () => {
    for (const name of ["ENTITY_RE", "ZERO_WIDTH_RE", "CONTROL_RE"]) {
      const pick = (src) => {
        const m = new RegExp(`${name} = (.*);`).exec(src);
        assert.ok(m, `${name} must exist`);
        return m[1];
      };
      assert.equal(pick(clientSrc), pick(serverSrc), name);
    }
  });
});
