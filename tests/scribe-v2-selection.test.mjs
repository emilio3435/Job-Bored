import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { FakeDocument, makeEnv } from './fixtures/jb-dom.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function desk(which = 'resume') {
  const win = makeEnv(); const calls = [];
  const nodes = [
    { id: 'b:acme:c14', kind: 'bullet', text: 'Measured delays.', locked: { whole: false, spans: [] } },
    { id: 'line:beta', kind: 'line', text: 'Tracked shipments.', locked: { whole: false, spans: [] } },
    { id: 'p:p3', kind: 'paragraph', text: 'I welcome a conversation.', locked: { whole: false, spans: [] } },
    { id: 'seat:acme', kind: 'seat', text: 'Analyst', locked: { whole: true, spans: [] } },
  ];
  win.JBScribeApi = { MAX_INSTRUCTION: 2000 };
  for (const file of ['scribe-v2-diff.js', 'scribe-v2.js']) vm.runInNewContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), win);
  const api = {
    listVersions: async () => ({ currentRunId: 'r0', versions: [{ runId: 'r0', n: 0 }] }),
    getModel: async () => ({ model: {}, nodes }), preview: async () => ({ html: 'preview' }),
    propose: body => { calls.push(body); return new Promise(() => {}); }, stopEdit: async () => ({}),
  };
  const ctl = win.JB_SCRIBE_V2.open({ slug: 'acme-example', doc: which, api }); await settle();
  const inner = new FakeDocument(); inner.head = inner.createElement('head'); inner.documentElement.appendChild(inner.head);
  for (const id of ['line:beta', 'b:acme:c14', 'p:p3', 'seat:acme', 'forged']) {
    const el = inner.createElement('p'); el.setAttribute('data-node', id); el.textContent = nodes.find(n => n.id === id)?.text || 'Unknown'; inner.body.appendChild(el);
  }
  ctl.refs.frame.contentDocument = inner; ctl.refs.frame.onload(); await settle();
  const select = ids => {
    inner.getSelection = () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => ({
      intersectsNode: el => ids.includes(el.getAttribute('data-node')),
      getBoundingClientRect: () => ({ left: 10, bottom: 30 }),
    }) });
    inner.dispatchEvent({ type: 'selectionchange', target: inner });
  };
  return { win, ctl, inner, select, calls };
}
for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F36 GAP-02 ${which} intersects authoritative IDs, orders and sends scope`, async () => {
    const { ctl, select, calls } = await desk(which);
    select(which === 'resume' ? ['forged', 'p:p3', 'b:acme:c14', 'line:beta'] : ['p:p3', 'b:acme:c14']);
    assert.match(ctl.refs.scope.textContent, which === 'resume' ? /Selected: 2 blocks/ : /Selected: paragraph 1/);
    ctl.refs.prompt.value = 'Shorten this.'; ctl.refs.composer.dispatchEvent({ type: 'submit', target: ctl.refs.composer });
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].scope)), which === 'resume' ? ['line:beta', 'b:acme:c14'] : ['p:p3']);
    ctl.close();
  });
  test(`SCRP-F37 GAP-02 ${which} refuses stale or forged scope until explicitly cleared`, async () => {
    const { ctl, select, calls } = await desk(which);
    select([which === 'resume' ? 'b:acme:c14' : 'p:p3']); ctl.state.currentRunId = 'r1';
    ctl.refs.prompt.value = 'Rewrite.'; ctl.refs.composer.dispatchEvent({ type: 'submit', target: ctl.refs.composer });
    assert.equal(calls.length, 0); assert.equal(ctl.refs.statusText.textContent, 'Your selection changed. Select the text again.');
    ctl.refs.clearScope.dispatchEvent({ type: 'click', target: ctl.refs.clearScope });
    assert.match(ctl.refs.scope.textContent, /Whole document/);
    select(['forged']); ctl.refs.composer.dispatchEvent({ type: 'submit', target: ctl.refs.composer }); assert.equal(calls.length, 0);
    ctl.close();
  });
}
test('SCRP-F38 GAP-02 locks and parent listener cleanup', async () => {
  const { ctl, inner, select } = await desk(); select(['seat:acme']);
  assert.equal(ctl.refs.statusText.textContent, 'Employer, title and dates are locked.');
  assert.equal(ctl.refs.selectionActions.hasAttribute('hidden'), true);
  ctl.close(); assert.equal(inner._listeners.selectionchange.length, 0);
});

test('SCRP-F49 GAP-02 node removal and template changes refuse retained scope', async () => {
  for (const mutation of ['node', 'template']) {
    const { ctl, inner, select, calls } = await desk(); select(['b:acme:c14']);
    if (mutation === 'node') { const el = inner.querySelector('[data-node="b:acme:c14"]'); el.parentNode.removeChild(el); }
    else ctl.state.model.template = { family: 'dossier' };
    ctl.refs.prompt.value = 'Rewrite.'; ctl.refs.composer.dispatchEvent({ type: 'submit', target: ctl.refs.composer });
    assert.equal(calls.length, 0); assert.equal(ctl.refs.statusText.textContent, 'Your selection changed. Select the text again.'); ctl.close();
  }
});

test('SCRP-R1-22 existing F1/F2 mounts and clear-scope handler are wired', async () => {
  const t = await desk('resume');
  assert.ok(t.ctl.refs.host.querySelector('.scribe__selection-actions'));
  assert.ok(t.ctl.refs.host.querySelector('.scribe__manual-state'));
  t.select(['b:acme:c14']);
  const styles = t.win.JBScribeDiff.markStyles(() => 'blue');
  assert.match(styles, /data-scribe-selected/); assert.match(styles, /data-scribe-editing/);
  t.ctl.refs.clearScope.dispatchEvent({ type: 'click', target: t.ctl.refs.clearScope, bubbles: true });
  assert.equal(t.ctl.scope, null);
  assert.match(t.ctl.refs.scope.textContent, /Whole document/); t.ctl.close();
});

test('SCRP-F710 R2-#11 multi-block Edit text is disabled with a single-block explanation', async () => {
  const { ctl, select } = await desk(); select(['b:acme:c14', 'line:beta']);
  const edit = ctl.refs.selectionActions.querySelector('[data-selection="edit"]');
  assert.ok(edit); assert.equal(edit.getAttribute('aria-disabled'), 'true');
  assert.equal(edit.getAttribute('title'), 'Select one block to edit its text.');
  edit.dispatchEvent({ type: 'click', target: edit }); assert.equal(ctl.manual.active, null);
  select(['b:acme:c14']);
  assert.equal(edit.getAttribute('aria-disabled'), 'false'); assert.equal(edit.getAttribute('title'), null);
  edit.dispatchEvent({ type: 'click', target: edit }); assert.ok(ctl.manual.active); ctl.close();
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F82 R3-#3 ${which} margin and noneditable clicks preserve the scope`, async () => {
  const { ctl, inner } = await desk(which);
  for (const target of [inner.body, inner.createElement('h2')]) {
    if (!target.parentNode) inner.body.appendChild(target);
    inner.dispatchEvent({ type: 'pointerup', target }); assert.equal(ctl.scope, null);
  }
  const el = inner.querySelector(`[data-node="${which === 'resume' ? 'line:beta' : 'p:p3'}"]`);
  inner.dispatchEvent({ type: 'pointerup', target: el }); const scope = ctl.scope;
  inner.dispatchEvent({ type: 'pointerup', target: inner.body });
  assert.equal(ctl.scope, scope); assert.equal(ctl.scope.stale, false); ctl.close();
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F810 R3-#11 ${which} activating multi-block Edit text explains its restriction`, async () => {
  const { ctl, inner, select } = await desk(which);
  const ids = which === 'resume' ? ['line:beta', 'b:acme:c14'] : ['p:p3', 'p:p2'];
  if (which === 'cover_letter') {
    ctl.state.nodes.push({ id: 'p:p2', kind: 'paragraph', text: 'I led daily operations.', locked: { whole: false, spans: [] } });
    const el = inner.createElement('p'); el.setAttribute('data-node', 'p:p2'); el.textContent = 'I led daily operations.'; inner.body.appendChild(el);
  }
  select(ids); const edit = ctl.refs.selectionActions.querySelector('[data-selection="edit"]');
  assert.equal(edit.getAttribute('aria-disabled'), 'true');
  edit.dispatchEvent({ type: 'click', target: edit, bubbles: true });
  assert.equal(ctl.refs.statusText.textContent, 'Select one block to edit its text.');
  assert.equal(ctl.manual.active, null); assert.equal(ctl.refs.selectionActions.hasAttribute('hidden'), false); ctl.close();
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F813 KBD-01 ${which} roving blocks announce locks and support keyboard selection and return`, async () => {
  const { win, ctl, inner } = await desk(which);
  const blocks = [...inner.querySelectorAll('[data-node]')].filter(el => ctl.state.nodes.some(n => n.id === el.getAttribute('data-node') && ((which === 'cover_letter') === (n.kind === 'paragraph' || n.kind === 'salutation'))));
  assert.equal(blocks.filter(el => el.getAttribute('tabindex') === '0').length, 1);
  for (const el of blocks) assert.match(el.getAttribute('aria-label'), /, (locked|editable)$/);
  ctl.refs.docscroll.dispatchEvent({ type: 'focus', target: ctl.refs.docscroll });
  assert.equal(inner.activeElement, blocks[0]);
  inner.dispatchEvent({ type: 'keydown', key: 'ArrowDown', target: blocks[0] });
  const next = blocks[Math.min(1, blocks.length - 1)]; assert.equal(inner.activeElement, next);
  assert.equal(blocks.filter(el => el.getAttribute('tabindex') === '0').length, 1);
  inner.dispatchEvent({ type: 'keydown', key: 'Enter', target: next });
  if (next.getAttribute('data-node') === 'seat:acme') assert.match(ctl.refs.statusText.textContent, /locked/);
  else {
    assert.equal(ctl.refs.selectionActions.hasAttribute('hidden'), false);
    assert.equal(win.document.activeElement, ctl.refs.selectionActions.querySelector('button'));
    win.document.dispatchEvent({ type: 'keydown', key: 'Escape', target: win.document.activeElement });
    assert.equal(inner.activeElement, next);
  }
  inner.dispatchEvent({ type: 'keydown', key: 'Escape', target: next });
  assert.equal(win.document.activeElement, ctl.refs.docscroll); assert.equal(ctl.closed, false); ctl.close();
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F91 R4-#2 ${which} arrows navigate blocks while a proposal owns J and K`, async () => {
  const { ctl, inner } = await desk(which);
  if (which === 'cover_letter') {
    ctl.state.nodes.push({ id: 'p:p2', kind: 'paragraph', text: 'I led operations.', locked: { whole: false, spans: [] } });
    const el = inner.createElement('p'); el.setAttribute('data-node', 'p:p2'); inner.body.appendChild(el);
    ctl.refs.frame.onload(); await settle();
  }
  const blocks = [...inner.querySelectorAll('[data-node]')].filter(el => el.hasAttribute('tabindex'));
  ctl.state.proposal = { id: 'open-request', status: 'ready', ops: [], changes: [], focus: -1 };
  ctl.refs.docscroll.dispatchEvent({ type: 'focus', target: ctl.refs.docscroll });
  const first = inner.activeElement;
  const down = { type: 'keydown', key: 'ArrowDown', target: first }; inner.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true); assert.equal(inner.activeElement, blocks[1]);
  assert.equal(blocks.filter(el => el.getAttribute('tabindex') === '0').length, 1);
  for (const key of ['j', 'k']) { inner.dispatchEvent({ type: 'keydown', key, target: blocks[1] }); assert.equal(inner.activeElement, blocks[1]); }
  const up = { type: 'keydown', key: 'ArrowUp', target: blocks[1] }; inner.dispatchEvent(up);
  assert.equal(up.defaultPrevented, true); assert.equal(inner.activeElement, first); ctl.close();
});
