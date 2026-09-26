#!/usr/bin/env node
// tools/lint-tokens.mjs — `npm run lint:tokens` (UX01 C2, DS-15).
//
// Zero-dependency CSS token linter. tokens-v2.css is the one place design
// values live; this keeps it that way. For every stylesheet index.html links
// (tokens-v2.css excepted) it reports:
//   color          a colour literal (hex, rgb(), rgba(), hsl(), hsla()) in a
//                  declaration value, other than a var(--jb-*, <fallback>)
//   undefined-var  var(--name) with no fallback where --name is defined in no
//                  CSS file and set by no JS/HTML in the repo
//   braces         an unbalanced { } (always fatal, never baselined)
//
// Existing debt is frozen in tools/lint-tokens.baseline.json as per-file
// counts, so only NEW literals fail. Burn debt down, then run
// `npm run lint:tokens -- --update-baseline` to lower the counts.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, basename, resolve } from 'node:path';
import process from 'node:process';

/**
 * @typedef {{ path: string, line: number, col: number, hex: string }} Finding
 * @typedef {{ path: string, line: number, literal: string }} ColorFinding
 * @typedef {{ path: string, line: number, name: string }} VarFinding
 * @typedef {Record<string, Record<string, Record<string, number>>>} Counts
 * @typedef {{ file: string, kind: string, key: string, count: number, allowed: number }} FreshFinding
 */

const SKIP_DIRS = new Set(['node_modules', '.git', 'uploads', 'evidence', '.worktrees', 'docs', 'test-results', 'playwright-report', 'coverage']);
const SOURCE_FILES = new Set(['tokens-v2.css']);
export const DEFAULT_BASELINE = 'tools/lint-tokens.baseline.json';
const HEX_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi;
const FUNC_RE = /\b(?:rgba?|hsla?)\(\s*[^()]*\)/gi;
const COLOR_RE = new RegExp(`${HEX_RE.source}|${FUNC_RE.source}`, 'gi');
const JB_FALLBACK_RE = /var\(\s*--jb-[a-z0-9-]+\s*,\s*((?:#[0-9a-f]{3,8}\b)|(?:(?:rgba?|hsla?)\([^()]*\)))\s*\)/gi;
const VAR_RE = /var\(\s*(--[a-z0-9_-]+)\s*([,)])/gi;
const DEF_RE = /(--[a-z0-9_-]+)\s*:/gi;
const JS_DEF_RE = /['"`](--[a-z0-9_-]+)['"`]|(--[a-z0-9_-]+)\s*:/gi;

/**
 * Replace every character inside /* ... *​/ comments with spaces, preserving
 * newlines and column offsets so line/col numbers stay accurate.
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (i + 1 < n && src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let j = i; j < stop; j++) out += src[j] === '\n' ? '\n' : ' ';
      i = stop;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/** @param {string} src */
function blankStrings(src) {
  return src.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0]);
}

/** @param {string} src @param {number} index */
function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** True when the match at `index` sits in a selector (a `{` comes before any `;` or `}`). */
function inSelector(src, index) {
  for (let i = index; i < src.length; i++) {
    const c = src[i];
    if (c === '{') return true;
    if (c === ';' || c === '}') return false;
  }
  return false;
}

/** @param {string} src */
function fallbackOffsets(src) {
  const set = new Set();
  JB_FALLBACK_RE.lastIndex = 0;
  let m;
  while ((m = JB_FALLBACK_RE.exec(src)) !== null) set.add(m.index + m[0].indexOf(m[1]));
  return set;
}

/** @param {string} literal */
export function normalizeLiteral(literal) {
  return literal
    .toLowerCase()
    .replace(/\s*,\s*/g, ',')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ');
}

/**
 * Raw hex literals (kept for the R6-TOKEN-01 contract).
 * @param {string} src comments already stripped
 * @param {string} relPath
 * @returns {Finding[]}
 */
export function findHexInSource(src, relPath) {
  return findColorLiterals(src, relPath)
    .filter((f) => f.literal.startsWith('#'))
    .map((f) => ({ path: f.path, line: f.line, col: f.col, hex: f.raw }));
}

/**
 * Colour literals in declaration values.
 * @param {string} src comments already stripped
 * @param {string} relPath
 * @returns {(ColorFinding & { col: number, raw: string })[]}
 */
export function findColorLiterals(src, relPath) {
  const skip = fallbackOffsets(src);
  const out = [];
  COLOR_RE.lastIndex = 0;
  let m;
  while ((m = COLOR_RE.exec(src)) !== null) {
    if (skip.has(m.index)) continue;
    if (m[0].startsWith('#') && inSelector(src, m.index)) continue;
    const line = lineOf(src, m.index);
    const col = m.index - src.lastIndexOf('\n', m.index - 1);
    out.push({ path: relPath, line, col, raw: m[0], literal: normalizeLiteral(m[0]) });
  }
  return out;
}

/**
 * Custom properties defined in CSS sources.
 * @param {string[]} sources
 * @returns {Set<string>}
 */
export function collectDefinedProps(sources) {
  const set = new Set();
  for (const s of sources) {
    DEF_RE.lastIndex = 0;
    let m;
    while ((m = DEF_RE.exec(s)) !== null) set.add(m[1]);
  }
  return set;
}

/**
 * var(--x) with no fallback where --x is not defined.
 * @param {string} src comments already stripped
 * @param {string} relPath
 * @param {Set<string>} defined
 * @returns {VarFinding[]}
 */
export function findUndefinedVars(src, relPath, defined) {
  const out = [];
  VAR_RE.lastIndex = 0;
  let m;
  while ((m = VAR_RE.exec(src)) !== null) {
    if (m[2] === ',') continue;
    if (defined.has(m[1])) continue;
    out.push({ path: relPath, line: lineOf(src, m.index), name: m[1] });
  }
  return out;
}

/**
 * @param {string} src comments already stripped
 * @param {string} relPath
 * @returns {{ path: string, message: string } | null}
 */
export function checkBraces(src, relPath) {
  const clean = blankStrings(src);
  let depth = 0;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') {
      depth--;
      if (depth < 0) return { path: relPath, message: `unbalanced braces: stray } at line ${lineOf(clean, i)}` };
    }
  }
  return depth === 0 ? null : { path: relPath, message: `unbalanced braces: ${depth} unclosed {` };
}

/**
 * Local stylesheets index.html links, in order.
 * @param {string} root
 * @returns {string[]}
 */
export function linkedStylesheets(root) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || /^(?:[a-z]+:)?\/\//i.test(href)) continue;
    const clean = href.replace(/^\.\//, '').split(/[?#]/)[0];
    if (!out.includes(clean)) out.push(clean);
  }
  return out;
}

/** @param {string} root @param {(name: string) => boolean} accept */
function walk(root, accept) {
  /** @type {string[]} */
  const out = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        visit(join(dir, ent.name));
      } else if (ent.isFile() && accept(ent.name)) {
        out.push(join(dir, ent.name));
      }
    }
  };
  visit(root);
  return out;
}

/**
 * Every custom property the repo defines: CSS declarations anywhere, plus
 * names JS/HTML sets (setProperty('--x'), style="--x: …").
 * @param {string} root
 */
function repoDefinedProps(root) {
  const css = walk(root, (n) => n.endsWith('.css')).map((p) => stripComments(readFileSync(p, 'utf8')));
  const defined = collectDefinedProps(css);
  for (const p of walk(root, (n) => /\.(?:m?js|html)$/.test(n))) {
    let src;
    try {
      src = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    JS_DEF_RE.lastIndex = 0;
    let m;
    while ((m = JS_DEF_RE.exec(src)) !== null) defined.add(m[1] || m[2]);
  }
  return defined;
}

/**
 * @param {Counts} counts
 * @param {{ files?: Counts }} baseline
 * @returns {FreshFinding[]}
 */
export function diffAgainstBaseline(counts, baseline) {
  const base = baseline?.files || {};
  /** @type {FreshFinding[]} */
  const fresh = [];
  for (const file of Object.keys(counts).sort()) {
    for (const kind of Object.keys(counts[file]).sort()) {
      for (const [key, count] of Object.entries(counts[file][kind])) {
        const allowed = base[file]?.[kind]?.[key] || 0;
        if (count > allowed) fresh.push({ file, kind, key, count, allowed });
      }
    }
  }
  return fresh;
}

/**
 * Lint the linked sheets under `root` against a baseline.
 * @param {string} root
 * @param {{ baseline?: { files?: Counts }, files?: string[] }} [opts]
 */
export function lintRepo(root, opts = {}) {
  const files = (opts.files || linkedStylesheets(root)).filter((f) => !SOURCE_FILES.has(basename(f)));
  const defined = repoDefinedProps(root);
  /** @type {Counts} */
  const counts = {};
  const braces = [];
  /** @type {Record<string, (ColorFinding|VarFinding)[]>} */
  const locations = {};
  for (const file of files) {
    const abs = resolve(root, file);
    if (!existsSync(abs)) continue;
    const rel = relative(root, abs);
    const src = stripComments(readFileSync(abs, 'utf8'));
    const b = checkBraces(src, rel);
    if (b) braces.push(b);
    const entry = { color: {}, 'undefined-var': {} };
    const locs = [];
    for (const f of findColorLiterals(src, rel)) {
      entry.color[f.literal] = (entry.color[f.literal] || 0) + 1;
      locs.push(f);
    }
    for (const f of findUndefinedVars(src, rel, defined)) {
      entry['undefined-var'][f.name] = (entry['undefined-var'][f.name] || 0) + 1;
      locs.push(f);
    }
    counts[rel] = entry;
    locations[rel] = locs;
  }
  const fresh = diffAgainstBaseline(counts, opts.baseline || { files: {} });
  return { ok: fresh.length === 0 && braces.length === 0, fresh, braces, counts, locations, scanned: files.length };
}

/** Legacy class API: raw-hex scan of explicit paths. */
export class TokenLinter {
  constructor() {
    /** @type {Finding[]} */
    this.findings = [];
  }

  /** @param {string[]} paths */
  scan(paths) {
    const findings = [];
    let scanned = 0;
    for (const p of paths) {
      let raw;
      try {
        raw = readFileSync(p, 'utf8');
      } catch {
        continue;
      }
      scanned++;
      findings.push(...findHexInSource(stripComments(raw), relative(process.cwd(), p) || p));
    }
    this.findings = findings;
    return { findings, scanned };
  }
}

/** Kept for callers of the pre-C2 API: true for any .css that is not a token source. */
export function shouldScan(filePath) {
  const name = basename(filePath);
  return name.endsWith('.css') && !SOURCE_FILES.has(name);
}

const USAGE = `Usage: lint-tokens.mjs [options]

Lints every stylesheet index.html links (tokens-v2.css excepted) for colour
literals, var() of undefined tokens without a fallback, and unbalanced braces.
Counts above ${DEFAULT_BASELINE} fail.

Options:
  --baseline <file>     Baseline to compare against (default ${DEFAULT_BASELINE}).
  --update-baseline     Rewrite the baseline to the current counts, exit 0.
  --json                Print the result as JSON.
  --help, -h            Show this help and exit 0.
`;

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  const bi = argv.indexOf('--baseline');
  const baselinePath = resolve(root, bi >= 0 ? argv[bi + 1] : DEFAULT_BASELINE);
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : { files: {} };
  const result = lintRepo(root, { baseline });

  if (argv.includes('--update-baseline')) {
    if (result.braces.length) {
      for (const b of result.braces) process.stderr.write(`${b.path}: ${b.message}\n`);
      return 1;
    }
    const files = {};
    for (const [file, kinds] of Object.entries(result.counts)) {
      const keep = {};
      for (const [kind, map] of Object.entries(kinds)) {
        if (Object.keys(map).length) keep[kind] = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
      }
      if (Object.keys(keep).length) files[file] = keep;
    }
    const doc = {
      note: 'Frozen token debt for npm run lint:tokens. Counts may only go down. Regenerate with: npm run lint:tokens -- --update-baseline',
      files,
    };
    writeFileSync(baselinePath, JSON.stringify(doc, null, 2) + '\n');
    process.stdout.write(`baseline written: ${relative(root, baselinePath)} (${Object.keys(files).length} files)\n`);
    return 0;
  }

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ ok: result.ok, fresh: result.fresh, braces: result.braces }) + '\n');
    return result.ok ? 0 : 1;
  }
  for (const b of result.braces) process.stdout.write(`${b.path}: ${b.message}\n`);
  for (const f of result.fresh) {
    const where = (result.locations[f.file] || [])
      .filter((l) => ('literal' in l ? l.literal : l.name) === f.key)
      .map((l) => l.line)
      .join(', ');
    const hint = f.kind === 'color' ? 'use a --jb-* token from tokens-v2.css' : 'define it in tokens-v2.css or add a fallback';
    process.stdout.write(`${f.file}:${where}  ${f.kind} ${f.key}  (${f.count} > baseline ${f.allowed}; ${hint})\n`);
  }
  process.stdout.write(
    `lint:tokens ${result.ok ? 'ok' : 'FAILED'}: ${result.scanned} sheet(s), ${result.fresh.length} new finding(s), ${result.braces.length} brace error(s)\n`,
  );
  return result.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
