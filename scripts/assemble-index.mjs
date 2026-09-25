#!/usr/bin/env node
/**
 * Assemble index.html includes into one HTML document.
 *
 * index.html on disk stays small; the local dashboard server expands at
 * read time. Static hosts that cannot expand includes should serve the
 * `--write` output. F0-A owns HTTP path containment; this assembler
 * expands only after a contained include resolver keeps targets inside
 * the repo root.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createContainedIncludeResolver,
  expandIndexIncludes,
} from "./lib/expand-index-includes.mjs";
import { missingProtectedIds } from "./lib/index-protected-surface.mjs";

export function assembleIndex(repoRoot, options = {}) {
  const indexPath = join(repoRoot, "index.html");
  const template = readFileSync(indexPath, "utf8");
  const resolveIncludePath =
    options.resolveIncludePath || createContainedIncludeResolver(repoRoot);
  return expandIndexIncludes(template, repoRoot, 0, {
    ...options,
    resolveIncludePath,
  });
}

// --- ASSET-1: content-addressed asset revisioning -------------------------
//
// A Pages revision must never pair new HTML with a cached older script. The
// `--write` output therefore rewrites each local `<script src>`,
// `<link rel="stylesheet" href>` and script/style preload hint to
// `path?v=<sha256(bytes)[0..10]>`, so a
// changed file changes its URL. The digest is a pure function of repo content
// (no clock, no git sha), so two builds of the same tree stay byte-identical.
//
// This transform lives in the CLI path only: `assembleIndex()` stays
// byte-identical to `expandIndexIncludes()`, which the hermetic release gate
// pins, and the local dev server keeps serving unstamped includes.

// config.js is gitignored: no file exists in the repo, and the Pages build
// substitutes config.example.js after assembly. Every other local reference
// without a file behind it is a dangling asset the deploy guard must catch.
const UNSTAMPED_SITE_EXEMPT_PATHS = new Set(["config.js"]);

// A tag ends at the first `>` that is not inside a quoted attribute value: the
// real favicon is an inline SVG data: URI full of `>`, and a matcher that stops
// at the first one hands the rest of the pipeline half a tag — which then reads
// as an unquoted href and fails loud on a reference that was never local.
// Each alternative starts with a distinct character, so there is no backtracking.
function assetTagPattern() {
  return /<(?:script|link)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
}

function tagName(tag) {
  const match = /^<\s*([a-zA-Z]+)/.exec(tag);
  return match ? match[1].toLowerCase() : "";
}

// Attribute values in this repo are double-quoted, but `src='a.js'` is equally
// valid HTML. A parser that reads one quote style leaves the other silently
// unstamped — and `verifySiteAssets` reuses this reader, so what the stamper
// cannot see the guard cannot flag either. Both styles are read, and the quote
// character travels with the value so the rewrite can put it back.
function matchAttribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(
    tag,
  );
  if (!match) return null;
  const quote = match[1][0];
  return { value: quote === '"' ? match[2] : match[3], quote };
}

function tagAttribute(tag, name) {
  const attribute = matchAttribute(tag, name);
  return attribute ? attribute.value : null;
}

function isLocalAssetUrl(url) {
  if (!url) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return false;
  if (url.startsWith("//")) return false;
  if (url.startsWith("#")) return false;
  return true;
}

function relTokens(tag) {
  const rel = tagAttribute(tag, "rel");
  if (!rel) return [];
  return rel.split(/\s+/).filter(Boolean).map((token) => token.toLowerCase());
}

// A `rel="stylesheet"` link loads a file this HTML owns.
function linkIsStylesheet(tag) {
  return relTokens(tag).includes("stylesheet");
}

// A `preload`/`modulepreload` hint for a script or a style names the very file
// this HTML also loads: leave the hint unstamped and the browser fetches a
// second, unaddressed copy of it, which is the stale-asset hole ASSET-1 closes.
// `as="font"` is the deliberate exception — the font hint must byte-match the
// url() inside vendor/fonts/fonts.css, which this transform does not rewrite,
// so stamping it would turn one font fetch into two and waste the hint.
function linkIsScriptOrStylePreload(tag) {
  const tokens = relTokens(tag);
  if (!tokens.some((token) => token === "preload" || token === "modulepreload")) {
    return false;
  }
  const as = (tagAttribute(tag, "as") || "").toLowerCase();
  if (as === "script" || as === "style") return true;
  // `modulepreload` is a script hint by definition; `as` is optional on it.
  return as === "" && tokens.includes("modulepreload");
}

/**
 * The local reference a tag loads directly — value plus the quote style it was
 * written with — or null when nothing should be stamped.
 */
function stampableAssetRef(tag) {
  const name = tagName(tag);
  if (name === "script") {
    const src = matchAttribute(tag, "src");
    return src && isLocalAssetUrl(src.value) ? src : null;
  }
  if (
    name === "link" &&
    (linkIsStylesheet(tag) || linkIsScriptOrStylePreload(tag))
  ) {
    const href = matchAttribute(tag, "href");
    return href && isLocalAssetUrl(href.value) ? href : null;
  }
  return null;
}

// Silence is the failure mode ASSET-1 forbids, and the classifier above knows
// only the shapes it was taught. A reference it cannot place — an unquoted
// `src=app.js`, a hint spelling nobody added — but that still points at a local
// script or stylesheet is reported by the deploy guard rather than waved past.
const SCRIPT_OR_STYLE_PATH = /\.(?:m?js|css)$/i;

function unclassifiedAssetProblem(tag) {
  const name = tagName(tag);
  if (name !== "script" && name !== "link") return null;
  const attribute = name === "script" ? "src" : "href";
  if (!new RegExp(`\\s${attribute}\\s*=`, "i").test(tag)) return null;
  const ref = matchAttribute(tag, attribute);
  if (!ref) {
    return `${tag}: ${attribute} value is not quoted, so the deploy guard cannot read it`;
  }
  if (!isLocalAssetUrl(ref.value)) return null;
  const [assetPath] = ref.value.split("?");
  if (!SCRIPT_OR_STYLE_PATH.test(assetPath)) return null;
  return `${assetPath}: local script/style reference the deploy guard cannot classify (${tag})`;
}

function resolveWithinRoot(root, assetPath) {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, assetPath);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    return null;
  }
  return target;
}

function digestOfFile(absolutePath) {
  let bytes;
  try {
    bytes = readFileSync(absolutePath);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
  return createHash("sha256").update(bytes).digest("hex").slice(0, 10);
}

/**
 * Rewrite every local script/stylesheet reference in `html` to carry the
 * sha256 digest of the file it points at, replacing any hand-written `?v=N`.
 * References with no file under `repoRoot` are left alone.
 */
export function stampLocalAssetDigests(html, repoRoot) {
  return html.replace(assetTagPattern(), (tag) => {
    const ref = stampableAssetRef(tag);
    if (!ref) return tag;
    const { value: url, quote } = ref;
    const [assetPath] = url.split("?");
    const target = resolveWithinRoot(repoRoot, assetPath);
    if (!target) return tag;
    const digest = digestOfFile(target);
    if (!digest) return tag;
    return tag.replace(
      `${quote}${url}${quote}`,
      () => `${quote}${assetPath}?v=${digest}${quote}`,
    );
  });
}

/**
 * Post-build guard: read `<siteDir>/index.html` and prove every local asset it
 * loads is stamped and present in the site with a matching digest. Returns the
 * list of problems; an empty list means the artifact is internally consistent.
 */
export function verifySiteAssets(siteDir) {
  const html = readFileSync(join(siteDir, "index.html"), "utf8");
  const problems = [];
  for (const match of html.matchAll(assetTagPattern())) {
    const ref = stampableAssetRef(match[0]);
    if (!ref) {
      const unclassified = unclassifiedAssetProblem(match[0]);
      if (unclassified) problems.push(unclassified);
      continue;
    }
    const [assetPath, query = ""] = ref.value.split("?");
    if (UNSTAMPED_SITE_EXEMPT_PATHS.has(assetPath)) continue;
    const target = resolveWithinRoot(siteDir, assetPath);
    if (!target) {
      problems.push(`${assetPath}: reference escapes the site root`);
      continue;
    }
    const stamp = new URLSearchParams(query).get("v");
    if (!stamp) {
      problems.push(`${assetPath}: reference carries no content digest`);
      continue;
    }
    const digest = digestOfFile(target);
    if (!digest) {
      problems.push(`${assetPath}: referenced by index.html but missing from the site`);
      continue;
    }
    if (digest !== stamp) {
      problems.push(
        `${assetPath}: index.html expects v=${stamp} but the deployed file digests to v=${digest}`,
      );
    }
  }
  return problems;
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function runVerifySite(siteDirArg) {
  if (!siteDirArg || siteDirArg.startsWith("--")) {
    console.error("assemble-index: --verify-site needs a site directory");
    process.exitCode = 1;
    return;
  }
  const problems = verifySiteAssets(resolve(siteDirArg));
  if (problems.length) {
    console.error(
      `assemble-index: ${problems.length} deployed asset reference(s) do not match ${siteDirArg}:`,
    );
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `assemble-index: every local asset reference in ${siteDirArg}/index.html matches its deployed file`,
  );
}

function runCli() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const verifyAt = process.argv.indexOf("--verify-site");
  if (verifyAt !== -1) {
    runVerifySite(process.argv[verifyAt + 1]);
    return;
  }
  const assembled = assembleIndex(repoRoot);
  const missing = missingProtectedIds(assembled);
  if (missing.length) {
    console.error(
      `assemble-index: protected surface missing ids: ${missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  const outPath = process.argv.includes("--write")
    ? join(repoRoot, "index.assembled.html")
    : null;
  if (outPath) {
    const stamped = stampLocalAssetDigests(assembled, repoRoot);
    writeFileSync(outPath, stamped, "utf8");
    console.log(
      `assemble-index: wrote ${outPath} (${stamped.split("\n").length} lines)`,
    );
    return;
  }
  const lineCount = assembled.split("\n").length;
  console.log(`assemble-index: index.html expands to ${lineCount} lines`);
}

if (isMainModule()) {
  runCli();
}
