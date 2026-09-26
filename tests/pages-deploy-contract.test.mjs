import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  assembleIndex,
  stampLocalAssetDigests,
  verifySiteAssets,
} from "../scripts/assemble-index.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  join(repoRoot, ".github", "workflows", "pages.yml"),
  "utf8",
);

describe("GitHub Pages deployment contract", () => {
  it("deploys an assembled dashboard artifact from main", () => {
    assert.match(workflow, /push:\s*\n\s+branches: \[main\]/);
    assert.match(workflow, /node scripts\/assemble-index\.mjs --write/);
    assert.match(workflow, /cp index\.assembled\.html _site\/index\.html/);
    assert.match(
      workflow,
      /cp config\.example\.js _site\/config\.js/,
      "the public artifact must serve a placeholder config.js instead of logging a 404",
    );
    assert.match(workflow, /actions\/upload-pages-artifact@v4/);
    assert.match(workflow, /path: _site/);
    assert.match(workflow, /actions\/deploy-pages@v4/);
  });

  it("puts protected modal surfaces into the deployed index", () => {
    const assembled = assembleIndex(repoRoot);
    assert.doesNotMatch(assembled, /<!--\s*@include\s+/);
    assert.match(assembled, /id="discoveryRunPreviewTemplate"/);
    assert.match(assembled, /id="discoveryRunPreviewMount"/);
  });
});

// ASSET-1 — a deployed Pages HTML revision cannot silently reference stale
// browser JavaScript. The `--write` output content-addresses every local
// script/stylesheet it loads, and the workflow re-verifies the built `_site`.

function digestOfBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 10);
}

// Deliberately re-implemented here instead of importing the assembler's own
// parser: a bug in the production parser must not be able to hide behind a
// test that reuses it.
function localAssetTags(html) {
  const tags = [];
  for (const match of html.matchAll(/<script\b[^>]*\ssrc=("[^"]+"|'[^']+')/g)) {
    tags.push({ tag: match[0], url: match[1].slice(1, -1) });
  }
  for (const match of html.matchAll(/<link\b[^>]*\shref=("[^"]+"|'[^']+')/g)) {
    tags.push({ tag: match[0], url: match[1].slice(1, -1) });
  }
  return tags.filter(
    ({ url }) =>
      !/^(?:https?:)?\/\//.test(url) &&
      !url.startsWith("data:") &&
      !url.startsWith("#"),
  );
}

function quotedAttribute(tag, name) {
  const match = new RegExp(`\\s${name}=("[^"]*"|'[^']*')`, "i").exec(tag);
  return match ? match[1].slice(1, -1) : null;
}

// A hint is exempt from stamping only when it is NOT the script or style this
// page also loads. `as="font"` must byte-match the url() inside
// vendor/fonts/fonts.css, which the transform does not rewrite, so stamping it
// would turn one font fetch into two. An `as="script"`/`as="style"` hint names
// a file the HTML loads itself, so it must carry the very same digest.
function isUnstampedHint(tag) {
  const rel = quotedAttribute(tag, "rel");
  if (!rel) return false;
  const tokens = rel.split(/\s+/).map((token) => token.toLowerCase());
  const hint = tokens.some((token) =>
    ["preload", "modulepreload", "prefetch", "prerender"].includes(token),
  );
  if (!hint) return false;
  const as = (quotedAttribute(tag, "as") || "").toLowerCase();
  if (as === "script" || as === "style") return false;
  if (as === "" && tokens.includes("modulepreload")) return false;
  return true;
}

function withTempRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "jb-asset1-"));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("ASSET-1: deployed HTML cannot reference stale browser JavaScript", () => {
  it("ASSET-1: every deployable local asset reference carries its own content digest", () => {
    const stamped = stampLocalAssetDigests(assembleIndex(repoRoot), repoRoot);
    const unaddressed = [];
    const exempt = [];
    let checked = 0;
    for (const { tag, url } of localAssetTags(stamped)) {
      if (isUnstampedHint(tag)) continue;
      const [path, query = ""] = url.split("?");
      const stamp = new URLSearchParams(query).get("v");
      let expected;
      try {
        expected = digestOfBytes(readFileSync(join(repoRoot, path)));
      } catch (error) {
        if (error && error.code === "ENOENT") {
          exempt.push(path);
          continue;
        }
        throw error;
      }
      checked += 1;
      if (stamp !== expected) unaddressed.push(`${url}  (expected v=${expected})`);
    }
    assert.deepEqual(
      unaddressed,
      [],
      `the written index carries ${unaddressed.length} asset references not tied to file content:\n` +
        unaddressed.slice(0, 6).join("\n"),
    );
    assert.deepEqual(
      exempt,
      ["config.js"],
      "config.js is the only reference with no file in the repo; anything else is a dangling asset",
    );
    assert.ok(
      checked > 100,
      `expected the whole asset set to be stamped, only ${checked} references were checked`,
    );
  });

  it("ASSET-1: a stamp is a pure function of file content, so editing a file changes it", () => {
    withTempRoot((root) => {
      const html = '<script src="a.js" defer></script>';
      writeFileSync(join(root, "a.js"), "window.a = 1;\n");
      const first = stampLocalAssetDigests(html, root);
      assert.match(first, /src="a\.js\?v=[0-9a-f]{10}"/);

      writeFileSync(join(root, "a.js"), "window.a = 2;\n");
      const afterEdit = stampLocalAssetDigests(html, root);
      assert.notEqual(
        afterEdit,
        first,
        "a changed script must produce a changed URL, or a cached stale copy survives the deploy",
      );

      writeFileSync(join(root, "a.js"), "window.a = 1;\n");
      assert.equal(
        stampLocalAssetDigests(html, root),
        first,
        "two builds of the same tree must be byte-identical: content digest only, no clock, no git sha",
      );
    });
  });

  it("ASSET-1: external, inline, hint and absent references are left untouched", () => {
    withTempRoot((root) => {
      mkdirSync(join(root, "css"), { recursive: true });
      writeFileSync(join(root, "a.js"), "window.a = 1;\n");
      writeFileSync(join(root, "css", "a.css"), ":root{}\n");
      writeFileSync(join(root, "f.woff2"), "font-bytes");
      const html = [
        '<script src="https://accounts.google.com/gsi/client" async></script>',
        '<script src="//cdn.example.com/x.js"></script>',
        '<script src="data:text/javascript,void 0"></script>',
        '<script>window.inline = "src=\\"a.js\\"";</script>',
        '<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="f.woff2" />',
        '<link rel="stylesheet" href="css/a.css" />',
        '<script src="config.js" defer></script>',
        '<script src="a.js" defer></script>',
      ].join("\n");

      const stamped = stampLocalAssetDigests(html, root);

      assert.match(stamped, /src="https:\/\/accounts\.google\.com\/gsi\/client" async/);
      assert.match(stamped, /src="\/\/cdn\.example\.com\/x\.js"/);
      assert.match(stamped, /src="data:text\/javascript,void 0"/);
      assert.match(
        stamped,
        /window\.inline = "src=\\"a\.js\\"";/,
        "inline script bodies are not asset references",
      );
      assert.match(
        stamped,
        /href="f\.woff2" \/>/,
        "a preload hint URL must byte-match the request the stylesheet makes, so it stays unstamped",
      );
      assert.match(
        stamped,
        /src="config\.js" defer/,
        "config.js has no file in the repo — Pages substitutes config.example.js",
      );
      assert.match(stamped, /href="css\/a\.css\?v=[0-9a-f]{10}"/);
      assert.match(stamped, /src="a\.js\?v=[0-9a-f]{10}"/);
    });
  });

  it("ASSET-1: hand-written ?v=N stamps are replaced, not doubled", () => {
    const assembled = assembleIndex(repoRoot);
    assert.match(
      assembled,
      /src="app\.js\?v=30"/,
      "the base index still carries hand stamps; stamping must replace them",
    );
    const stamped = stampLocalAssetDigests(assembled, repoRoot);
    for (const { tag, url } of localAssetTags(stamped)) {
      if (isUnstampedHint(tag)) continue;
      assert.ok(
        url.split("?").length <= 2,
        `${url} carries more than one query string`,
      );
      const query = url.split("?")[1];
      if (!query) continue;
      assert.match(
        query,
        /^v=[0-9a-f]{10}$/,
        `${url} must carry exactly one content digest, not a hand-written revision`,
      );
    }
    assert.doesNotMatch(
      stamped,
      /src="app\.js\?v=30"/,
      "hand-written stamps must be replaced by the content digest",
    );
  });

  it("ASSET-1: stamping does not change script load order", () => {
    const assembled = assembleIndex(repoRoot);
    const stamped = stampLocalAssetDigests(assembled, repoRoot);
    const paths = (html) =>
      [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) =>
        m[1].split("?")[0],
      );
    assert.deepEqual(
      paths(stamped),
      paths(assembled),
      "the deployed artifact must load the same scripts in the same order",
    );
  });

  it("ASSET-1: assembleIndex stays unstamped so the release gate keeps comparing like with like", () => {
    const assembled = assembleIndex(repoRoot);
    assert.match(
      assembled,
      /src="jb-ui\.js" defer/,
      "the digest transform belongs to the --write path only; assembleIndex must stay expandIndexIncludes",
    );
  });

  it("ASSET-1: the Pages workflow verifies the built _site against its own assets", () => {
    assert.match(
      workflow,
      /node scripts\/assemble-index\.mjs --verify-site _site/,
      "without a post-build guard, a hand-edited artifact could pair new HTML with old scripts",
    );
    assert.match(
      workflow,
      /cp config\.example\.js _site\/config\.js/,
      "the guard must not displace the placeholder config.js copy",
    );
    const buildStep = workflow.indexOf("cp index.assembled.html _site/index.html");
    const verifyStep = workflow.indexOf("--verify-site _site");
    const uploadStep = workflow.indexOf("actions/upload-pages-artifact@v4");
    assert.ok(buildStep > -1 && verifyStep > buildStep && uploadStep > verifyStep,
      "the guard must run after _site is built and before it is uploaded");
  });

  it("ASSET-1: verifySiteAssets accepts a site whose HTML and assets agree", () => {
    withTempRoot((root) => {
      writeFileSync(join(root, "a.js"), "window.a = 1;\n");
      // Assembly happens before the Pages build substitutes config.example.js,
      // so config.js is referenced but not on disk — and stays unstamped.
      const html = stampLocalAssetDigests(
        '<script src="a.js" defer></script>\n<script src="config.js" defer></script>',
        root,
      );
      assert.match(html, /src="config\.js" defer/);
      writeFileSync(join(root, "index.html"), html);
      writeFileSync(join(root, "config.js"), "window.CONFIG = {};\n");
      assert.deepEqual(verifySiteAssets(root), []);
    });
  });

  it("ASSET-1: verifySiteAssets rejects a site whose HTML outruns its assets", () => {
    withTempRoot((root) => {
      writeFileSync(join(root, "a.js"), "window.a = 1;\n");
      const html = stampLocalAssetDigests('<script src="a.js" defer></script>', root);
      writeFileSync(join(root, "index.html"), html);

      writeFileSync(join(root, "a.js"), "window.a = 2;\n");
      const drifted = verifySiteAssets(root);
      assert.equal(drifted.length, 1, drifted.join("\n"));
      assert.match(drifted[0], /a\.js/);

      rmSync(join(root, "a.js"));
      const missing = verifySiteAssets(root);
      assert.equal(missing.length, 1, missing.join("\n"));
      assert.match(missing[0], /a\.js/);
    });
  });

  it("ASSET-1: verifySiteAssets rejects an unstamped asset that is not the config placeholder", () => {
    withTempRoot((root) => {
      writeFileSync(join(root, "a.js"), "window.a = 1;\n");
      writeFileSync(
        join(root, "index.html"),
        '<script src="a.js" defer></script>',
      );
      const problems = verifySiteAssets(root);
      assert.equal(problems.length, 1, problems.join("\n"));
      assert.match(problems[0], /a\.js/);
    });
  });
  // --- MINOR-4 repair: the shapes the first parser could not see ----------

  it("ASSET-1: single-quoted references are stamped, and the quote style survives", () => {
    withTempRoot((root) => {
      mkdirSync(join(root, "css"), { recursive: true });
      writeFileSync(join(root, "a.js"), "window.a = 1;\n");
      writeFileSync(join(root, "css", "a.css"), ":root{}\n");
      const html = [
        "<script src='a.js' defer></script>",
        "<link rel='stylesheet' href='css/a.css' />",
      ].join("\n");

      const stamped = stampLocalAssetDigests(html, root);

      assert.match(
        stamped,
        /src='a\.js\?v=[0-9a-f]{10}'/,
        "single quotes are valid HTML: a parser that reads only double quotes ships this script unstamped",
      );
      assert.match(stamped, /href='css\/a\.css\?v=[0-9a-f]{10}'/);
      assert.doesNotMatch(
        stamped,
        /src="a\.js/,
        "the rewrite must preserve the quote style it found",
      );

      const seen = localAssetTags(stamped);
      assert.equal(seen.length, 2, JSON.stringify(seen));
      for (const { url } of seen) {
        const [path, query = ""] = url.split("?");
        assert.equal(
          new URLSearchParams(query).get("v"),
          digestOfBytes(readFileSync(join(root, path))),
          `${url} must carry the digest of its own bytes`,
        );
      }
    });
  });

  it("ASSET-1: verifySiteAssets catches drift behind a single-quoted reference", () => {
    withTempRoot((root) => {
      writeFileSync(join(root, "b.js"), "window.b = 1;\n");
      writeFileSync(
        join(root, "index.html"),
        stampLocalAssetDigests("<script src='b.js' defer></script>", root),
      );
      assert.deepEqual(verifySiteAssets(root), []);

      writeFileSync(join(root, "b.js"), "window.b = 999;\n");
      const problems = verifySiteAssets(root);
      assert.equal(
        problems.length,
        1,
        `a drifted single-quoted script must be reported, not shipped in silence: ${problems.join("\n")}`,
      );
      assert.match(problems[0], /b\.js/);
    });
  });

  it("ASSET-1: a local script or style preload is stamped and its drift is caught", () => {
    withTempRoot((root) => {
      mkdirSync(join(root, "css"), { recursive: true });
      writeFileSync(join(root, "shim.js"), "window.f = 1;\n");
      writeFileSync(join(root, "mod.mjs"), "export const m = 1;\n");
      writeFileSync(join(root, "css", "late.css"), ".late{}\n");
      const html = [
        '<link rel="preload" as="script" href="shim.js">',
        '<link rel="modulepreload" href="mod.mjs">',
        '<link rel="preload" as="style" href="css/late.css">',
      ].join("\n");

      const stamped = stampLocalAssetDigests(html, root);

      assert.match(
        stamped,
        /href="shim\.js\?v=[0-9a-f]{10}"/,
        "a script preload names the very file the page loads, so an unstamped hint fetches a second, stale copy",
      );
      assert.match(
        stamped,
        /href="mod\.mjs\?v=[0-9a-f]{10}"/,
        "modulepreload is a script hint by definition; `as` is optional on it",
      );
      assert.match(stamped, /href="css\/late\.css\?v=[0-9a-f]{10}"/);

      writeFileSync(join(root, "index.html"), stamped);
      assert.deepEqual(verifySiteAssets(root), []);

      writeFileSync(join(root, "shim.js"), "window.f = 999;\n");
      const problems = verifySiteAssets(root);
      assert.equal(problems.length, 1, problems.join("\n"));
      assert.match(problems[0], /shim\.js/);
    });
  });

  it('ASSET-1: an as="font" preload stays unstamped and unflagged', () => {
    withTempRoot((root) => {
      writeFileSync(join(root, "f.woff2"), "font-bytes");
      const html =
        '<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="f.woff2" />';

      const stamped = stampLocalAssetDigests(html, root);
      assert.equal(
        stamped,
        html,
        "the font hint URL must byte-match the url() inside vendor/fonts/fonts.css, which this transform does not rewrite — stamping it would turn one font fetch into two",
      );

      writeFileSync(join(root, "index.html"), stamped);
      assert.deepEqual(
        verifySiteAssets(root),
        [],
        "a font hint is neither a script nor a style reference, so the guard has nothing to check",
      );

      writeFileSync(join(root, "f.woff2"), "other-font-bytes");
      assert.deepEqual(
        verifySiteAssets(root),
        [],
        "and it stays out of scope when the font itself changes",
      );
    });
  });

  it("ASSET-1: verifySiteAssets reports a local script/style reference it cannot classify", () => {
    withTempRoot((root) => {
      writeFileSync(join(root, "a.js"), "window.a = 1;\n");
      writeFileSync(join(root, "b.css"), ".b{}\n");
      writeFileSync(join(root, "favicon.svg"), "<svg/>");
      writeFileSync(
        join(root, "index.html"),
        [
          "<script src=a.js defer></script>",
          '<link rel="prefetch" href="b.css">',
          '<link rel="icon" href="favicon.svg">',
          '<script src="https://accounts.google.com/gsi/client" async></script>',
        ].join("\n"),
      );

      const problems = verifySiteAssets(root);
      assert.equal(
        problems.length,
        2,
        `only the two unclassifiable local script/style references may be reported: ${problems.join("\n")}`,
      );
      assert.ok(
        problems.some((problem) => /a\.js/.test(problem)),
        `an unquoted src is invisible to the parser and must fail loud: ${problems.join("\n")}`,
      );
      assert.ok(
        problems.some((problem) => /b\.css/.test(problem)),
        `a hint shape the parser does not stamp must fail loud: ${problems.join("\n")}`,
      );
    });
  });
  it("ASSET-1: an attribute value containing > neither truncates the tag nor invents a problem", () => {
    withTempRoot((root) => {
      writeFileSync(join(root, "a.js"), "window.a = 1;\n");
      // The real index.html favicon is an inline SVG data: URI full of `>`.
      const favicon =
        '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 32 32\'><rect width=\'32\'/></svg>" />';
      const html = stampLocalAssetDigests(
        `${favicon}\n<script src="a.js" defer></script>`,
        root,
      );

      assert.ok(
        html.includes(favicon),
        "an inline SVG favicon is not an asset reference and must survive byte-identical",
      );
      assert.match(
        html,
        /src="a\.js\?v=[0-9a-f]{10}"/,
        "a tag after the favicon must still be seen and stamped",
      );

      writeFileSync(join(root, "index.html"), html);
      assert.deepEqual(
        verifySiteAssets(root),
        [],
        "a data: URI is not a local reference: failing loud must not mean crying wolf over a tag the matcher cut in half",
      );
    });
  });
});
