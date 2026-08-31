import assert from 'node:assert/strict';
import test from 'node:test';

import { findHexInSource, stripComments } from '../tools/lint-tokens.mjs';

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
