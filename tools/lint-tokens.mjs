#!/usr/bin/env node
// tools/lint-tokens.mjs
// Zero-dependency CSS token-drift linter for the JobBored swarm refactor.
// Flags raw hex literals in v2 CSS files and tells authors to use --jb-* tokens.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/**
 * @typedef {{ path: string, line: number, col: number, hex: string }} Finding
 */

const SKIP_DIRS = new Set(['node_modules', '.git', 'uploads', 'evidence']);
const ALLOW_LIST = new Set([
  'style.css',
  'settings-tabs.css',
  'tokens.css',
  'tokens-v2.css',
]);
const HEX_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi;
const V2_MARKER = 'body.jb-v2';
const V2_HEAD_LINES = 200;

/**
 * Recursively collect all .css files under root, skipping SKIP_DIRS.
 * @param {string} root
 * @returns {string[]}
 */
function walkCss(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        visit(join(dir, ent.name));
      } else if (ent.isFile() && ent.name.endsWith('.css')) {
        out.push(join(dir, ent.name));
      }
    }
  };
  visit(root);
  return out;
}

/**
 * True if a CSS file should be scanned.
 * Matches jb-*.css, pipeline-cards.css, scorecard.css, empty-states.css,
 * or any *.css whose first 200 lines mention `body.jb-v2`.
 * @param {string} filePath
 * @returns {boolean}
 */
export function shouldScan(filePath) {
  const name = basename(filePath);
  if (ALLOW_LIST.has(name)) return false;
  if (!name.endsWith('.css')) return false;
  if (/^jb-.*\.css$/i.test(name)) return true;
  if (
    name === 'pipeline-cards.css' ||
    name === 'scorecard.css' ||
    name === 'empty-states.css'
  ) {
    return true;
  }
  let head = '';
  try {
    head = readFileSync(filePath, 'utf8').split('\n').slice(0, V2_HEAD_LINES).join('\n');
  } catch {
    return false;
  }
  return head.includes(V2_MARKER);
}

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
      for (let j = i; j < stop; j++) {
        out += src[j] === '\n' ? '\n' : ' ';
      }
      i = stop;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/**
 * Find raw hex color literals in source (with comments already stripped).
 * @param {string} src
 * @param {string} relPath
 * @returns {Finding[]}
 */
export function findHexInSource(src, relPath) {
  /** @type {Finding[]} */
  const findings = [];
  const lines = src.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    HEX_RE.lastIndex = 0;
    let m;
    while ((m = HEX_RE.exec(line)) !== null) {
      findings.push({
        path: relPath,
        line: li + 1,
        col: m.index + 1,
        hex: m[0],
      });
    }
  }
  return findings;
}

/** Linter that scans CSS files for raw hex literals outside comments. */
export class TokenLinter {
  constructor() {
    /** @type {Finding[]} */
    this.findings = [];
  }

  /**
   * Scan the provided absolute file paths.
   * @param {string[]} paths
   * @returns {{ findings: Finding[], scanned: number }}
   */
  scan(paths) {
    /** @type {Finding[]} */
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
      const stripped = stripComments(raw);
      const rel = relative(process.cwd(), p) || p;
      findings.push(...findHexInSource(stripped, rel));
    }
    this.findings = findings;
    return { findings, scanned };
  }
}

/**
 * Parse argv into a small options object.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const opts = {
    json: false,
    quiet: false,
    help: false,
    /** @type {string[]} */
    paths: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--paths') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        opts.paths.push(argv[++i]);
      }
    }
  }
  return opts;
}

const USAGE = `Usage: lint-tokens.mjs [options]

Walks the repo from CWD and flags raw hex literals in v2-scope CSS files.

Options:
  --paths <a.css> <b.css>  Lint only the listed files (skips discovery).
  --json                   Print JSON array of findings, no human output.
  --quiet                  Print only the final tally line.
  --help, -h               Show this help and exit 0.

Exit code: 0 when no findings, 1 when one or more raw hex literals were found.
`;

/**
 * CLI entry point.
 * @returns {Promise<number>}
 */
export async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  /** @type {string[]} */
  let targets;
  if (opts.paths.length > 0) {
    targets = opts.paths.map((p) => resolve(process.cwd(), p));
  } else {
    targets = walkCss(process.cwd()).filter((p) => shouldScan(p));
  }
  const linter = new TokenLinter();
  const { findings, scanned } = linter.scan(targets);
  if (opts.json) {
    process.stdout.write(JSON.stringify(findings) + '\n');
  } else if (opts.quiet) {
    process.stdout.write(`${findings.length} findings across ${scanned} file(s)\n`);
  } else {
    for (const f of findings) {
      process.stdout.write(
        `${f.path}:${f.line}:${f.col}  ${f.hex}  (raw hex; use a --jb-* token instead)\n`,
      );
    }
    process.stdout.write(`${findings.length} findings across ${scanned} file(s)\n`);
  }
  return findings.length === 0 ? 0 : 1;
}

if (process.env.NODE_TEST) {
  const { test } = await import('node:test');
  const assertMod = await import('node:assert');
  const assert = assertMod.default ?? assertMod;

  test('clean string with var(--jb-*) only → 0 findings', () => {
    const src = '.x { color: var(--jb-fg); background: var(--jb-bg-1); }';
    const stripped = stripComments(src);
    const findings = findHexInSource(stripped, 'mem.css');
    assert.strictEqual(findings.length, 0);
  });

  test('raw hex outside comment → 1 finding', () => {
    const src = '.x { color: #abc; }';
    const stripped = stripComments(src);
    const findings = findHexInSource(stripped, 'mem.css');
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].hex.toLowerCase(), '#abc');
    assert.strictEqual(findings[0].line, 1);
  });

  test('hex inside /* comment */ only → 0 findings', () => {
    const src = '.x {\n  /* #fff is the old token */\n  color: var(--jb-fg);\n}';
    const stripped = stripComments(src);
    const findings = findHexInSource(stripped, 'mem.css');
    assert.strictEqual(findings.length, 0);
  });
}

if (!process.env.NODE_TEST && import.meta.url === `file://${process.argv[1]}`) {
  const code = await main();
  process.exit(code);
}
