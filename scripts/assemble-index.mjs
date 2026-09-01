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
// `--write` output therefore rewrites each local `<script src>` and
// `<link rel="stylesheet" href>` to `path?v=<sha256(bytes)[0..10]>`, so a
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

function assetTagPattern() {
  return /<(?:script|link)\b[^>]*>/gi;
}

function tagName(tag) {
  const match = /^<\s*([a-zA-Z]+)/.exec(tag);
  return match ? match[1].toLowerCase() : "";
}

function tagAttribute(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag);
  return match ? match[1] : null;
}

function isLocalAssetUrl(url) {
  if (!url) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return false;
  if (url.startsWith("//")) return false;
  if (url.startsWith("#")) return false;
  return true;
}

// Only a `rel="stylesheet"` link loads a file this HTML owns. A
// `preload`/`prefetch` href is a hint that must byte-match the request some
// other consumer makes — the two font preloads pair with url() refs inside
// vendor/fonts/fonts.css, which this transform does not rewrite — so stamping
// one would turn a single font fetch into two and waste the hint.
function linkIsStylesheet(tag) {
  const rel = tagAttribute(tag, "rel");
  if (!rel) return false;
  return rel.split(/\s+/).some((token) => token.toLowerCase() === "stylesheet");
}

/** The local URL a tag loads directly, or null when nothing should be stamped. */
function stampableAssetUrl(tag) {
  const name = tagName(tag);
  if (name === "script") {
    const src = tagAttribute(tag, "src");
    return isLocalAssetUrl(src) ? src : null;
  }
  if (name === "link" && linkIsStylesheet(tag)) {
    const href = tagAttribute(tag, "href");
    return isLocalAssetUrl(href) ? href : null;
  }
  return null;
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
    const url = stampableAssetUrl(tag);
    if (!url) return tag;
    const [assetPath] = url.split("?");
    const target = resolveWithinRoot(repoRoot, assetPath);
    if (!target) return tag;
    const digest = digestOfFile(target);
    if (!digest) return tag;
    return tag.replace(`"${url}"`, () => `"${assetPath}?v=${digest}"`);
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
    const url = stampableAssetUrl(match[0]);
    if (!url) continue;
    const [assetPath, query = ""] = url.split("?");
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
