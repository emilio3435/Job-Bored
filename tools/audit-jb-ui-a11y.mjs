#!/usr/bin/env node
// tools/audit-jb-ui-a11y.mjs
// Static a11y attribute checker for jb-ui.demo.html. Zero dependencies.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const VALID_STAGES = new Set([
  'new',
  'researching',
  'applied',
  'phone',
  'interviewing',
  'offer',
  'rejected',
  'passed',
]);

/**
 * Match every opening tag (incl. self-closing) for a given local name.
 * @param {string} src
 * @param {string} tag
 */
function matchTags(src, tag) {
  const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const openRe = new RegExp(`<${escaped}\\b([^>]*)>`, 'gi');
  const out = [];
  let m;
  while ((m = openRe.exec(src)) !== null) {
    const attrs = m[1] || '';
    const after = m.index + m[0].length;
    const closeRe = new RegExp(`</${escaped}\\s*>`, 'i');
    const tail = src.slice(after);
    const closeMatch = tail.match(closeRe);
    const inner = closeMatch ? tail.slice(0, closeMatch.index) : '';
    out.push({ attrs, inner, index: m.index });
  }
  return out;
}

/**
 * Match elements by class token (e.g. `.jb-sticker`).
 * @param {string} src
 * @param {string} cls
 */
function matchByClass(src, cls) {
  const re = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const attrs = m[2] || '';
    const classAttr = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    if (!classAttr) continue;
    const value = classAttr[2] ?? classAttr[3] ?? '';
    const tokens = value.split(/\s+/);
    if (!tokens.includes(cls)) continue;
    const after = m.index + m[0].length;
    const tag = m[1];
    const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
    const tail = src.slice(after);
    const closeMatch = tail.match(closeRe);
    const inner = closeMatch ? tail.slice(0, closeMatch.index) : '';
    out.push({ tag, attrs, inner, index: m.index });
  }
  return out;
}

/**
 * @param {string} attrs
 * @param {string} name
 */
function getAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(attrs);
  if (!m) return null;
  return m[2] ?? m[3] ?? '';
}

/**
 * Audit <jb-fit-ring> usages.
 * @param {string} src
 */
function auditFitRing(src) {
  const tags = matchTags(src, 'jb-fit-ring');
  const issues = [];
  for (const t of tags) {
    const percent = getAttr(t.attrs, 'percent');
    if (percent === null) {
      issues.push({
        component: 'jb-fit-ring',
        index: t.index,
        message: 'missing required percent="" attribute',
      });
    }
  }
  return {
    count: tags.length,
    issues,
    todos: [
      'Manually verify <jb-fit-ring> sets role="meter" + aria-valuenow on the host (component does this on connect).',
    ],
  };
}

/**
 * Audit <jb-ai-chip> usages.
 * @param {string} src
 */
function auditAiChip(src) {
  const tags = matchTags(src, 'jb-ai-chip');
  const issues = [];
  for (const t of tags) {
    const text = t.inner.replace(/<[^>]*>/g, '').trim();
    if (text.length === 0) {
      issues.push({
        component: 'jb-ai-chip',
        index: t.index,
        message: 'empty slotted content; chip must contain user-visible text',
      });
    }
  }
  return { count: tags.length, issues, todos: [] };
}

/**
 * Audit <jb-kbd> usages.
 * @param {string} src
 */
function auditKbd(src) {
  const tags = matchTags(src, 'jb-kbd');
  const issues = [];
  for (const t of tags) {
    const keys = getAttr(t.attrs, 'keys');
    if (!keys || keys.trim().length === 0) {
      issues.push({
        component: 'jb-kbd',
        index: t.index,
        message: 'missing or empty keys="" attribute',
      });
    }
  }
  return { count: tags.length, issues, todos: [] };
}

/**
 * Audit <jb-stage-dot> usages.
 * @param {string} src
 */
function auditStageDot(src) {
  const tags = matchTags(src, 'jb-stage-dot');
  const issues = [];
  for (const t of tags) {
    const stage = getAttr(t.attrs, 'stage');
    if (!stage) {
      issues.push({
        component: 'jb-stage-dot',
        index: t.index,
        message: 'missing stage="" attribute',
      });
    } else if (!VALID_STAGES.has(stage.toLowerCase())) {
      issues.push({
        component: 'jb-stage-dot',
        index: t.index,
        message: `stage="${stage}" not one of ${[...VALID_STAGES].join(', ')}`,
      });
    }
  }
  return { count: tags.length, issues, todos: [] };
}

/**
 * Audit `.jb-sticker` usages — must have visible text content.
 * @param {string} src
 */
function auditSticker(src) {
  const tags = matchByClass(src, 'jb-sticker');
  const issues = [];
  for (const t of tags) {
    const text = t.inner.replace(/<[^>]*>/g, '').trim();
    if (text.length === 0) {
      issues.push({
        component: '.jb-sticker',
        index: t.index,
        message: 'empty visible text; provide a label for screen readers',
      });
    }
  }
  return { count: tags.length, issues, todos: [] };
}

/**
 * @param {string} src
 */
export function audit(src) {
  return {
    'jb-fit-ring': auditFitRing(src),
    'jb-ai-chip': auditAiChip(src),
    'jb-kbd': auditKbd(src),
    'jb-stage-dot': auditStageDot(src),
    '.jb-sticker': auditSticker(src),
  };
}

/**
 * @param {ReturnType<typeof audit>} result
 */
function renderMarkdown(result) {
  const lines = ['# jb-ui demo a11y audit', ''];
  for (const [name, r] of Object.entries(result)) {
    const ok = r.issues.length === 0;
    lines.push(`## ${name} (${r.count} occurrence${r.count === 1 ? '' : 's'}) ${ok ? '✓' : '✗'}`);
    if (r.issues.length === 0) {
      lines.push('- [x] all required attributes / content present');
    } else {
      for (const issue of r.issues) {
        lines.push(`- [ ] @${issue.index}: ${issue.message}`);
      }
    }
    for (const todo of r.todos) {
      lines.push(`- [ ] manual: ${todo}`);
    }
    lines.push('');
  }
  return lines.join('\n');
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

const USAGE = `Usage: audit-jb-ui-a11y.mjs [options]

Static checker for jb-ui.demo.html (read from CWD).
Verifies <jb-*> and .jb-sticker authoring conventions; component-internal
a11y must still be checked manually (recorded as TODO in the report).

Options:
  --json   Print JSON report.
  --quiet  Print only the final pass/fail summary line.
  --help   Show this help and exit 0.

Exit code:
  0 = no missing-attribute issues
  1 = one or more authoring issues found
  2 = jb-ui.demo.html missing
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
  const demoPath = resolve(process.cwd(), 'jb-ui.demo.html');
  let src;
  try {
    src = readFileSync(demoPath, 'utf8');
  } catch {
    process.stderr.write(`missing: jb-ui.demo.html (looked in ${process.cwd()})\n`);
    return 2;
  }
  const result = audit(src);
  const total = Object.values(result).reduce((n, r) => n + r.issues.length, 0);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: total === 0, result }) + '\n');
  } else if (opts.quiet) {
    process.stdout.write(`${total === 0 ? 'PASS' : 'FAIL'} issues=${total}\n`);
  } else {
    process.stdout.write(renderMarkdown(result));
  }
  return total === 0 ? 0 : 1;
}

if (process.env.NODE_TEST) {
  const { test } = await import('node:test');
  const assertMod = await import('node:assert');
  const assert = assertMod.default ?? assertMod;

  test('jb-kbd without keys → issue', () => {
    const r = audit('<jb-kbd></jb-kbd>');
    assert.strictEqual(r['jb-kbd'].issues.length, 1);
  });

  test('jb-kbd with keys → no issue', () => {
    const r = audit('<jb-kbd keys="cmd+k"></jb-kbd>');
    assert.strictEqual(r['jb-kbd'].issues.length, 0);
  });

  test('jb-stage-dot with invalid stage → issue', () => {
    const r = audit('<jb-stage-dot stage="bogus"></jb-stage-dot>');
    assert.strictEqual(r['jb-stage-dot'].issues.length, 1);
  });

  test('jb-stage-dot with valid stage → no issue', () => {
    const r = audit('<jb-stage-dot stage="applied"></jb-stage-dot>');
    assert.strictEqual(r['jb-stage-dot'].issues.length, 0);
  });

  test('jb-ai-chip empty inner → issue', () => {
    const r = audit('<jb-ai-chip></jb-ai-chip>');
    assert.strictEqual(r['jb-ai-chip'].issues.length, 1);
  });
}

if (!process.env.NODE_TEST && import.meta.url === `file://${process.argv[1]}`) {
  const code = await main();
  process.exit(code);
}
