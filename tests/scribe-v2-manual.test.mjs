import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { FakeDocument, makeEnv } from './fixtures/jb-dom.mjs';
const settle = () => new Promise(resolve => setImmediate(resolve));
async function desk(which = 'resume', result) {
  const win = makeEnv(); const calls = []; const timers = new Map(); let seq = 0;
  win.setTimeout = (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; }; win.clearTimeout = id => timers.delete(id);
  win.JBScribeApi = { MAX_INSTRUCTION: 2000 };
  for (const file of ['scribe-v2-diff.js', 'scribe-v2.js']) vm.runInNewContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), win);
  const ids = which === 'resume' ? ['line:beta', 'b:acme:c14'] : ['p:p3', 'p:p2'];
  const nodes = ids.map(id => ({ id, kind: which === 'resume' ? 'line' : 'paragraph', text: 'Tracked daily operations.', locked: { whole: false, spans: [] } }));
  const api = {
    listVersions: async () => ({ currentRunId: 'r0', versions: [{ runId: 'r0', n: 0 }] }),
    getModel: async () => ({ model: {}, nodes }), preview: async () => ({ html: 'preview' }),
    manualEdit: async body => { calls.push(body); if (result) return result(body, calls.length); return { run: { runId: 'r1', n: 1 } }; },
  };
  const ctl = win.JB_SCRIBE_V2.open({ slug: 'acme-example', doc: which, api }); await settle();
  const inner = new FakeDocument(); inner.head = inner.createElement('head'); inner.documentElement.appendChild(inner.head);
  const els = nodes.map(node => { const el = inner.createElement('p'); el.setAttribute('data-node', node.id); el.textContent = node.text; inner.body.appendChild(el); return el; });
  ctl.refs.frame.contentDocument = inner; ctl.refs.frame.onload(); await settle();
  const edit = (el, text) => {
    inner.dispatchEvent({ type: 'dblclick', target: el }); assert.equal(el.getAttribute('contenteditable'), 'plaintext-only');
    el.textContent = text; inner.dispatchEvent({ type: 'input', target: el }); inner.dispatchEvent({ type: 'focusout', target: el });
  };
  const flush = async () => { for (const [id, t] of [...timers]) if (t.ms === 2000) { timers.delete(id); t.fn(); } await settle(); };
  return { win, api, ctl, inner, els, nodes, calls, timers, edit, flush };
}
for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F39 GAP-01 ${which} batches unique replacements on one base after 2 seconds`, async () => {
    const { ctl, els, calls, timers, edit, flush } = await desk(which);
    edit(els[0], 'Tracked operations.'); edit(els[1], 'Tracked daily work.'); edit(els[0], 'Tracked work.');
    assert.equal(calls.length, 0); assert.equal([...timers.values()].filter(t => t.ms === 2000).length, 1);
    await flush(); assert.equal(calls.length, 1); assert.equal(calls[0].baseRunId, 'r0'); assert.equal(calls[0].manualOps.length, 2);
    assert.equal(calls[0].manualOps[0].text, 'Tracked work.'); assert.match(ctl.refs.manualState.textContent, /Saved as v1/); ctl.close();
  });
  test(`SCRP-F40 GAP-01 ${which} unchanged and undone edits send nothing`, async () => {
    const { ctl, els, calls, edit, flush } = await desk(which);
    edit(els[0], 'Tracked daily operations.'); await flush(); assert.equal(calls.length, 0);
    edit(els[0], 'Tracked work.'); edit(els[0], 'Tracked daily operations.'); await flush(); assert.equal(calls.length, 0); ctl.close();
  });
  test(`SCRP-F41 GAP-01 ${which} fact confirmation keeps exact ops and conflict keeps draft`, async () => {
    const { ctl, els, calls, edit, flush } = await desk(which, (_body, n) => {
      if (n === 1) throw { status: 400, code: 'unverified_confirmation_required' };
      throw { status: 409, code: 'stale_base' };
    });
    edit(els[0], 'Tracked Contoso operations.'); await flush();
    assert.equal(ctl.refs.manualState.getAttribute('data-state'), 'confirm');
    ctl.refs.manualState.querySelector('[data-manual="confirm"]').dispatchEvent({ type: 'click' }); await settle();
    assert.equal(calls[1].confirmUnverified[0], calls[0].manualOps[0].opId);
    assert.equal(ctl.refs.manualState.getAttribute('data-state'), 'conflict'); assert.equal(els[0].textContent, 'Tracked Contoso operations.');
    assert.equal(ctl.manual.drafts[els[0].getAttribute('data-node')].text, 'Tracked Contoso operations.');
    ctl.close(); assert.equal(ctl.closed, false); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' });
  });
}
test('SCRP-F42 GAP-01 paste uses text only and metric edits roll back locally', async () => {
  const { ctl, inner, els, nodes, edit, calls, flush } = await desk();
  nodes[0].text = '😀 Reduced delays 38%.'; nodes[0].locked.spans = [[18, 21]]; els[0].textContent = nodes[0].text;
  edit(els[0], '😀 Reduced delays 40%.'); await flush(); assert.equal(calls.length, 0); assert.equal(els[0].textContent, nodes[0].text);
  assert.match(ctl.refs.manualState.textContent, /Figures in this line are locked/);
  inner.dispatchEvent({ type: 'dblclick', target: els[1] });
  const ev = { type: 'paste', target: els[1], clipboardData: { getData: type => type === 'text/plain' ? 'Plain text' : '<b>Markup</b>' } };
  inner.dispatchEvent(ev); assert.equal(ev.defaultPrevented, true); assert.equal(ctl.manual.drafts[nodes[1].id].text, "Tracked daily operations.Plain text"); ctl.close(); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: "click" });
});

test('SCRP-F50 GAP-01 navigation Save, Discard and Stay require an explicit choice', async () => {
  for (const choice of ['save', 'discard', 'stay']) {
    const { ctl, els, edit, calls } = await desk(); edit(els[0], 'Tracked operations.');
    ctl.setDoc('cover_letter'); assert.equal(ctl.state.doc, 'resume'); assert.equal(calls.length, 0);
    ctl.refs.unsaved.querySelector(`[data-unsaved="${choice}"]`).dispatchEvent({ type: 'click' }); await settle();
    assert.equal(calls.length, choice === 'save' ? 1 : 0);
    assert.equal(ctl.state.doc, choice === 'stay' ? 'resume' : 'cover_letter');
    if (choice === 'stay') { ctl.close(); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' }); } else ctl.close();
  }
});
test('SCRP-F51 GAP-01 open suggestions pause edits; metric offsets shift in UTF-16', async () => {
  const { ctl, inner, els, nodes, edit, calls, flush } = await desk();
  ctl.state.proposal = { ops: [] }; inner.dispatchEvent({ type: 'dblclick', target: els[0] }); assert.equal(els[0].getAttribute('contenteditable'), null); ctl.state.proposal = null;
  nodes[0].text = '😀 delays 38%.'; nodes[0].locked.spans = [[10, 13]]; els[0].textContent = nodes[0].text;
  edit(els[0], '😀 daily delays 38%.');
  inner.dispatchEvent({ type: 'dblclick', target: els[0] }); els[0].textContent = '😀 daily delays 40%.'; inner.dispatchEvent({ type: 'input', target: els[0] });
  assert.equal(els[0].textContent, '😀 daily delays 38%.'); inner.dispatchEvent({ type: 'focusout', target: els[0] }); await flush(); assert.equal(calls[0].manualOps[0].text, '😀 daily delays 38%.'); ctl.close();
});

test('SCRP-F52 GAP-01 confirmed locked facts remain blocked and pending recovery reads once', async () => {
  for (const failure of ['locked', 'materials_pending']) {
    const { ctl, els, edit, flush, calls } = await desk('resume', (_body, n) => {
      if (failure === 'locked' && n === 1) throw { code: 'unverified_confirmation_required', status: 400 };
      throw { code: failure, status: failure === 'locked' ? 400 : 409 };
    });
    let reads = 0;
    ctl.api.getOpenEdit = async () => { reads++; return { proposal: { proposalId: 'other-tab', doc: 'cover_letter', status: 'ready', ops: [] } }; };
    edit(els[0], 'Tracked Contoso operations.'); await flush();
    if (failure === 'locked') {
      ctl.refs.manualState.querySelector('[data-manual="confirm"]').dispatchEvent({ type: 'click' }); await settle();
      assert.equal(ctl.refs.manualState.getAttribute('data-state'), 'error'); assert.match(ctl.refs.manualState.textContent, /locked/); assert.equal(calls.length, 2); assert.equal(reads, 0);
    } else { assert.equal(reads, 1); assert.equal(ctl.openProposal.proposalId, 'other-tab'); }
    assert.equal(ctl.manual.drafts[els[0].getAttribute('data-node')].text, 'Tracked Contoso operations.');
    ctl.close(); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' });
  }
});

test('SCRP-F53 GAP-01 zero-change blur releases the base before a newer version is opened', async () => {
  const { ctl, inner, els, edit } = await desk(); edit(els[0], 'Tracked daily operations.');
  ctl.state.currentRunId = 'r1'; inner.dispatchEvent({ type: 'dblclick', target: els[1] });
  assert.equal(els[1].getAttribute('contenteditable'), 'plaintext-only'); assert.equal(ctl.manual.base, 'r1'); ctl.close();
});

test('SCRP-F54 GAP-01/02 a selected manual committed-503 keeps its truthful saved status', async () => {
  const { ctl, inner, els, edit, flush } = await desk('resume', () => ({ textSaved: true, run: { runId: 'r1', n: 1, pdf: 'stale' } }));
  inner.getSelection = () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => ({ intersectsNode: el => el === els[0] }) });
  inner.dispatchEvent({ type: 'selectionchange', target: inner });
  edit(els[0], 'Tracked operations.'); await flush();
  assert.equal(ctl.refs.statusText.textContent, 'Text saved as v1. PDF unavailable — it’s rebuilt on your next save.');
  assert.match(ctl.refs.scope.textContent, /Your selection changed. Select the text again\./); ctl.close();
});

test('SCRP-F55 GAP-01 pending sibling Continue retains the draft behind unsaved navigation', async () => {
  const { ctl, els, edit, flush } = await desk('resume', () => { throw { status: 409, code: 'materials_pending' }; });
  ctl.api.getOpenEdit = async () => ({ proposal: { proposalId: 'pending-sibling', doc: 'cover_letter', baseRunId: 'r0', status: 'pending', ops: [] } });
  edit(els[0], 'Tracked operations.'); await flush();
  assert.doesNotThrow(() => ctl.refs.recover.querySelector('[data-action="continue-request"]').dispatchEvent({ type: 'click' }));
  assert.equal(ctl.refs.unsaved.hasAttribute('hidden'), false); assert.equal(ctl.state.doc, 'resume'); assert.equal(Object.keys(ctl.manual.drafts).length, 1);
  ctl.refs.unsaved.querySelector('[data-unsaved="stay"]').dispatchEvent({ type: 'click' });
  ctl.close(); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' });
});

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F71 R2-#1 ${which} confirmation quotes and freezes every replacement`, async () => {
    const { ctl, els, calls, edit, flush } = await desk(which, (_body, n) => {
      if (n === 1) throw { code: 'unverified_confirmation_required' };
      throw { code: 'locked' };
    });
    edit(els[0], 'Tracked operations.'); edit(els[1], 'Led Contoso operations in 2025.'); await flush();
    const prompt = ctl.refs.manualState.textContent;
    assert.ok(prompt.includes('“Tracked operations.”'));
    assert.ok(prompt.includes('“Led Contoso operations in 2025.”'));
    const confirm = ctl.refs.manualState.querySelector('[data-manual="confirm"]');
    confirm.dispatchEvent({ type: 'click' }); await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1].confirmUnverified)), calls[0].manualOps.map(op => op.opId));
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1].manualOps)), JSON.parse(JSON.stringify(calls[0].manualOps)));
    // A detached old confirmation cannot approve a newly edited batch.
    edit(els[1], 'Led Example operations.'); confirm.dispatchEvent({ type: 'click' }); await settle();
    assert.equal(calls.length, 2);
    ctl.close(); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' });
  });
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F72 R2-#2 ${which} repeated tokens never relocate transformed UTF-16 locks`, async () => {
    const { ctl, inner, els, nodes, edit, calls, flush } = await desk(which);
    nodes[0].text = '😀 delays 38%.'; nodes[0].locked.spans = [[10, 13]]; els[0].textContent = nodes[0].text;
    edit(els[0], '38% 😀 delays 38%.');
    inner.dispatchEvent({ type: 'dblclick', target: els[0] });
    els[0].textContent = '38% 😀 delays 40%.'; inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, '38% 😀 delays 38%.');
    // The new prefix is editable; only the original occurrence is locked.
    els[0].textContent = '40% 😀 delays 38%.'; inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, '40% 😀 delays 38%.');
    inner.dispatchEvent({ type: 'focusout', target: els[0] }); await flush();
    assert.equal(calls[0].manualOps[0].text, '40% 😀 delays 38%.');
    assert.deepEqual(Object.keys(calls[0].manualOps[0]).sort(), ['node', 'op', 'opId', 'text']); ctl.close();
  });
}

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F73 R2-#3 ${which} role-close drafts restore from session memory only`, async () => {
    const { win, api, ctl, inner, els, nodes, edit, calls } = await desk(which);
    nodes[0].text = '😀 delays 38%.'; nodes[0].locked.spans = [[10, 13]]; els[0].textContent = nodes[0].text;
    edit(els[0], '38% 😀 delays 38%.'); const opId = ctl.manual.drafts[nodes[0].id].opId;
    ctl.close('role-closed'); assert.equal(ctl.closed, true); assert.equal(calls.length, 0);
    const reopened = win.JB_SCRIBE_V2.open({ slug: 'acme-example', doc: which, api }); await settle();
    reopened.refs.frame.contentDocument = inner; reopened.refs.frame.onload(); await settle();
    assert.equal(els[0].textContent, '38% 😀 delays 38%.');
    assert.equal(reopened.manual.base, 'r0'); assert.equal(reopened.manual.drafts[nodes[0].id].opId, opId);
    assert.equal(reopened.refs.unsaved.hasAttribute('hidden'), false);
    assert.match(reopened.refs.unsaved.textContent, /You have unsaved text/);
    assert.ok(reopened.refs.unsaved.querySelector('[data-unsaved="save"]'));
    reopened.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' });
    assert.equal(els[0].textContent, nodes[0].text); reopened.close('role-closed');
    const empty = win.JB_SCRIBE_V2.open({ slug: 'acme-example', doc: which, api }); await settle();
    assert.equal(Object.keys(empty.manual.drafts).length, 0); empty.close();
    // A new script session has no drafts: persistence remains memory-only.
    const fresh = await desk(which); assert.equal(Object.keys(fresh.ctl.manual.drafts).length, 0); fresh.ctl.close();
  });
}

test('SCRP-F78 R2-#9 manual errors use mapped copy plus nextStep and keep Try again', async () => {
  let win; let fails = true;
  const t = await desk('resume', () => { if (fails) throw new win.JBScribeApi.ScribeApiError(429, 'rate_limited', 'RAW server response HTTP 429', 'Try again in 30 s.'); return { run: { runId: 'r1', n: 1 } }; });
  win = t.win; vm.runInNewContext(readFileSync(new URL('../scribe-v2-api.js', import.meta.url), 'utf8'), win);
  t.edit(t.els[0], 'Tracked operations.'); await t.flush();
  assert.match(t.ctl.refs.manualState.textContent, /Not saved\. Your text is kept\..*Too many requests right now.*Try again in 30 s\./);
  assert.doesNotMatch(t.ctl.refs.manualState.textContent, /RAW server/);
  fails = false; t.ctl.refs.manualState.querySelector('[data-manual="retry"]').dispatchEvent({ type: 'click' }); await settle();
  assert.equal(t.calls.length, 2); assert.match(t.ctl.refs.manualState.textContent, /Saved as v1/); t.ctl.close();
});
