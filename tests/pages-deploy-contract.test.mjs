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
  for (const match of html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)) {
    tags.push({ tag: match[0], url: match[1] });
  }
  for (const match of html.matchAll(/<link\b[^>]*\shref="([^"]+)"/g)) {
    tags.push({ tag: match[0], url: match[1] });
  }
  return tags.filter(
    ({ url }) =>
      !/^(?:https?:)?\/\//.test(url) &&
      !url.startsWith("data:") &&
      !url.startsWith("#"),
  );
}

function isPreloadHint(tag) {
  const rel = /\srel="([^"]*)"/.exec(tag);
  if (!rel) return false;
  return rel[1]
    .split(/\s+/)
    .some((token) =>
      ["preload", "modulepreload", "prefetch", "prerender"].includes(
        token.toLowerCase(),
      ),
    );
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
      if (isPreloadHint(tag)) continue;
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
      if (isPreloadHint(tag)) continue;
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
});
