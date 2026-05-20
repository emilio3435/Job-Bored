#!/usr/bin/env node
// tools/check-jb-ui-budget.mjs
// Zero-dependency bundle-size budget checker for jb-ui.js / jb-ui.css.
// Computes raw / minified / gzipped byte sizes and compares against budgets.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import process from 'node:process';

const DEFAULT_JS_BUDGET = 12000;
const DEFAULT_CSS_BUDGET = 6000;

/**
 * Strip block comments from a source string.
 * @param {string} src
 * @returns {string}
 */
export function stripBlockComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (i + 1 < n && src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/**
 * Strip JS line comments only when the `//` is at line start or preceded by
 * whitespace (keeps protocol-relative `//` inside string literals safe).
 * @param {string} src
 * @returns {string}
 */
export function stripJsLineComments(src) {
  const lines = src.split('\n');
  const out = [];
  for (const line of lines) {
    const idx = findLineCommentStart(line);
    out.push(idx === -1 ? line : line.slice(0, idx).replace(/\s+$/, ''));
  }
  return out.join('\n');
}

/**
 * @param {string} line
 * @returns {number}
 */
function findLineCommentStart(line) {
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '/' && line[i + 1] === '/') {
      if (i === 0) return i;
      const prev = line[i - 1];
      if (prev === ' ' || prev === '\t') return i;
    }
  }
  return -1;
}

/**
 * Collapse blank lines and runs of spaces; preserve newlines for safety.
 * @param {string} src
 * @returns {string}
 */
export function collapseWhitespace(src) {
  return src
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/^ | $/g, ''))
    .filter((l) => l.length > 0)
    .join('\n');
}

/**
 * Strip CSS-irrelevant whitespace around structural punctuation. Does NOT
 * touch contents of strings: a CSS string boundary is `"` or `'` and we
 * track it. Conservative: when in doubt, keep the byte.
 * @param {string} src
 * @returns {string}
 */
export function compactCss(src) {
  let out = '';
  let inStr = null; // null | '"' | "'"
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) {
        out += src[++i];
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      // Skip if surrounding chars are structural punctuation.
      const prev = out[out.length - 1];
      let j = i;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
      const next = src[j] || '';
      const punct = '{};:,>+~()';
      if (punct.includes(prev) || punct.includes(next)) {
        i = j - 1;
        continue;
      }
      // Otherwise collapse the run to a single space.
      out += ' ';
      i = j - 1;
    } else {
      out += ch;
    }
  }
  return out.replace(/;}/g, '}');
}

/**
 * Strip CSS-irrelevant whitespace from JS — conservative single-space
 * collapse; do not touch operators because that changes semantics. JS bytes
 * just compact via comment removal + line collapse.
 * @param {string} src
 * @returns {string}
 */
export function compactJs(src) {
  return src
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/^ | $/g, ''))
    .filter((l) => l.length > 0)
    .join('');
}

/**
 * Tiny minifier for both JS and CSS used only for size estimation.
 * @param {string} src
 * @param {'js'|'css'} kind
 * @returns {string}
 */
export function minify(src, kind) {
  let s = stripBlockComments(src);
  if (kind === 'js') {
    s = stripJsLineComments(s);
    return compactJs(s);
  }
  return compactCss(s);
}

/**
 * Compute byte sizes for a source string.
 * @param {string} src
 * @param {'js'|'css'} kind
 * @returns {{ raw: number, min: number, gz: number }}
 */
export function measure(src, kind) {
  const minified = minify(src, kind);
  const raw = Buffer.byteLength(src, 'utf8');
  const min = Buffer.byteLength(minified, 'utf8');
  const gz = gzipSync(Buffer.from(minified, 'utf8')).length;
  return { raw, min, gz };
}

/**
 * @param {string} p
 * @returns {string|null}
 */
function readOrNull(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @param {string} name
 * @param {{raw:number,min:number,gz:number}} m
 * @param {number} budget
 * @returns {string}
 */
function formatLine(name, m, budget) {
  const ok = m.min <= budget;
  const flag = ok ? '✓' : '✗';
  return `${name.padEnd(10)} raw=${m.raw}  min=${m.min}  gz=${m.gz}  / budget ${budget}  ${flag}`;
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const opts = { json: false, quiet: false, help: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--quiet') opts.quiet = true;
  }
  return opts;
}

const USAGE = `Usage: check-jb-ui-budget.mjs [options]

Measures jb-ui.js and jb-ui.css from CWD against a minified-byte budget.

Env overrides:
  JB_UI_JS_BUDGET   (default ${DEFAULT_JS_BUDGET})
  JB_UI_CSS_BUDGET  (default ${DEFAULT_CSS_BUDGET})

Options:
  --json    Print JSON report.
  --quiet   Print only the final pass/fail summary line.
  --help    Show this help and exit 0.

Exit code:
  0 = both within budget
  1 = one or both over budget
  2 = jb-ui.js or jb-ui.css missing
`;

/**
 * @returns {{ js: number, css: number }}
 */
function resolveBudgets() {
  const js = Number(process.env.JB_UI_JS_BUDGET) || DEFAULT_JS_BUDGET;
  const css = Number(process.env.JB_UI_CSS_BUDGET) || DEFAULT_CSS_BUDGET;
  return { js, css };
}

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
  const jsPath = resolve(process.cwd(), 'jb-ui.js');
  const cssPath = resolve(process.cwd(), 'jb-ui.css');
  const jsSrc = readOrNull(jsPath);
  const cssSrc = readOrNull(cssPath);
  if (jsSrc === null || cssSrc === null) {
    const missing = [
      jsSrc === null ? 'jb-ui.js' : null,
      cssSrc === null ? 'jb-ui.css' : null,
    ].filter(Boolean);
    process.stderr.write(`missing: ${missing.join(', ')} (looked in ${process.cwd()})\n`);
    return 2;
  }
  const budgets = resolveBudgets();
  const jsM = measure(jsSrc, 'js');
  const cssM = measure(cssSrc, 'css');
  const jsOk = jsM.min <= budgets.js;
  const cssOk = cssM.min <= budgets.css;
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        js: { ...jsM, budget: budgets.js, ok: jsOk },
        css: { ...cssM, budget: budgets.css, ok: cssOk },
        ok: jsOk && cssOk,
      }) + '\n',
    );
  } else if (opts.quiet) {
    process.stdout.write(
      `${jsOk && cssOk ? 'PASS' : 'FAIL'} js=${jsM.min}/${budgets.js} css=${cssM.min}/${budgets.css}\n`,
    );
  } else {
    process.stdout.write(formatLine('jb-ui.js', jsM, budgets.js) + '\n');
    process.stdout.write(formatLine('jb-ui.css', cssM, budgets.css) + '\n');
  }
  return jsOk && cssOk ? 0 : 1;
}

if (process.env.NODE_TEST) {
  const { test } = await import('node:test');
  const assertMod = await import('node:assert');
  const assert = assertMod.default ?? assertMod;

  test('minify strips CSS block comments', () => {
    const src = '.x { /* drop me */ color: red; }';
    const out = minify(src, 'css');
    assert.ok(!out.includes('drop me'));
    assert.ok(out.includes('color: red'));
  });

  test('minify strips JS line comments at safe positions', () => {
    const src = 'const a = 1; // trailing\n// leading\nconst b = 2;';
    const out = minify(src, 'js');
    assert.ok(!out.includes('trailing'));
    assert.ok(!out.includes('leading'));
    assert.ok(out.includes('const a = 1;'));
    assert.ok(out.includes('const b = 2;'));
  });

  test('minify preserves protocol-relative // in string literals', () => {
    const src = "const u = 'https://example.com';";
    const out = minify(src, 'js');
    assert.ok(out.includes('https://example.com'));
  });

  test('budget pass and fail via temp files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jbui-budget-'));
    const cwd = process.cwd();
    try {
      writeFileSync(join(dir, 'jb-ui.js'), 'const a = 1;\n');
      writeFileSync(join(dir, 'jb-ui.css'), '.x{color:red}\n');
      process.chdir(dir);
      const passCode = await main();
      assert.strictEqual(passCode, 0);
      const big = '.x{color:red}'.repeat(1000);
      writeFileSync(join(dir, 'jb-ui.css'), big);
      process.env.JB_UI_CSS_BUDGET = '100';
      const failCode = await main();
      assert.strictEqual(failCode, 1);
      delete process.env.JB_UI_CSS_BUDGET;
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing files → exit code 2', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jbui-missing-'));
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      const code = await main();
      assert.strictEqual(code, 2);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

if (!process.env.NODE_TEST && import.meta.url === `file://${process.argv[1]}`) {
  const code = await main();
  process.exit(code);
}
