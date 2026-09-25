import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkBraces,
  collectDefinedProps,
  diffAgainstBaseline,
  findColorLiterals,
  findHexInSource,
  findUndefinedVars,
  linkedStylesheets,
  lintRepo,
  stripComments,
} from '../tools/lint-tokens.mjs';

test('R6-TOKEN-01 skips only --jb-* var fallbacks and still flags other hex', () => {
  const source = [
    '.token { color: var(--jb-ink, #1b2b33); }',
    '.legacy { color: var(--legacy-ink, #334455); }',
    '.raw { color: #abcdef; }',
  ].join('\n');

  const findings = findHexInSource(stripComments(source), 'fixture.css');

  assert.deepEqual(
    findings.map(({ line, hex }) => ({ line, hex: hex.toLowerCase() })),
    [
      { line: 2, hex: '#334455' },
      { line: 3, hex: '#abcdef' },
    ],
  );
});

test('C2 lint:tokens flags rgb/rgba/hsl literals as well as hex', () => {
  const src = [
    '.a { color: rgb(1, 2, 3); }',
    '.b { background: rgba(14, 58, 78, 0.12); border-color: hsl(120 50% 50%); }',
    '.c { color: var(--jb-ink); }',
  ].join('\n');
  const found = findColorLiterals(stripComments(src), 'x.css').map((f) => [f.line, f.literal]);
  assert.deepEqual(found, [
    [1, 'rgb(1,2,3)'],
    [2, 'rgba(14,58,78,0.12)'],
    [2, 'hsl(120 50% 50%)'],
  ]);
});

test('C2 lint:tokens ignores id selectors that look like hex', () => {
  const src = '#add, #bad .x { color: var(--jb-ink); }\n#face{ top: 0; }';
  assert.equal(findColorLiterals(stripComments(src), 'x.css').length, 0);
});

test('C2 lint:tokens flags var() of an undefined token only when it has no fallback', () => {
  const defined = new Set(['--jb-ink']);
  const src = '.a { color: var(--jb-ink); margin: var(--space-7); padding: var(--nope, 4px); }';
  const found = findUndefinedVars(stripComments(src), 'x.css', defined).map((f) => f.name);
  assert.deepEqual(found, ['--space-7']);
});

test('C2 lint:tokens collects custom properties defined in CSS', () => {
  const defined = collectDefinedProps([':root { --a: 1; --b-c:2 }', '.x{--d : red}']);
  assert.ok(defined.has('--a') && defined.has('--b-c') && defined.has('--d'));
});

test('C2 lint:tokens reports an unbalanced brace', () => {
  assert.equal(checkBraces('.a { color: red; }', 'ok.css'), null);
  const bad = checkBraces('.a { color: red; \n.b { top: 0; }', 'bad.css');
  assert.ok(bad && /unbalanced/.test(bad.message));
  assert.ok(checkBraces('.a { content: "{"; }', 'str.css') === null, 'braces in strings do not count');
});

test('C2 lint:tokens fails only on literals beyond the committed baseline', () => {
  const current = {
    'a.css': { color: { '#fff': 2, 'rgb(1,2,3)': 1 }, 'undefined-var': {} },
  };
  const baseline = { files: { 'a.css': { color: { '#fff': 2 }, 'undefined-var': {} } } };
  const fresh = diffAgainstBaseline(current, baseline);
  assert.deepEqual(fresh, [{ file: 'a.css', kind: 'color', key: 'rgb(1,2,3)', count: 1, allowed: 0 }]);
  assert.deepEqual(diffAgainstBaseline(current, { files: current }), []);
});

test('C2 lint:tokens scans the stylesheets index.html links and skips tokens-v2.css', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-tokens-'));
  mkdirSync(join(root, 'css'));
  writeFileSync(
    join(root, 'index.html'),
    [
      '<link rel="stylesheet" href="tokens-v2.css" />',
      '<link rel="stylesheet" href="css/a.css">',
      '<link rel="stylesheet" href="https://fonts.example/x.css" />',
      '<link rel="preload" href="css/not-a-sheet.css" />',
    ].join('\n'),
  );
  writeFileSync(join(root, 'tokens-v2.css'), ':root { --jb-ink: #1B2B33; }');
  writeFileSync(join(root, 'css/a.css'), '.a { color: var(--jb-ink); background: #fff; margin: var(--ghost); }');
  assert.deepEqual(linkedStylesheets(root), ['tokens-v2.css', 'css/a.css']);

  const clean = lintRepo(root, { baseline: { files: {} } });
  assert.equal(clean.ok, false);
  assert.deepEqual(
    clean.fresh.map((f) => `${f.file} ${f.kind} ${f.key}`),
    ['css/a.css color #fff', 'css/a.css undefined-var --ghost'],
  );

  const baselined = lintRepo(root, { baseline: { files: clean.counts } });
  assert.equal(baselined.ok, true);
});
