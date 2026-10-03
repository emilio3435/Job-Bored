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
