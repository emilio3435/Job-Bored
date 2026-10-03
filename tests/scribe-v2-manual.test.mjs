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
  const { ctl, inner, els, nodes, calls, flush } = await desk();
  nodes[0].text = '😀 Reduced delays 38%.'; nodes[0].locked.spans = [[18, 21]]; els[0].textContent = nodes[0].text;
  inner.dispatchEvent({ type: 'dblclick', target: els[0] });
  els[0].textContent = '😀 Reduced delays 40%.'; inner.dispatchEvent({ type: 'input', target: els[0] });
  assert.match(ctl.refs.manualState.textContent, /Figures in this line are locked/);
  inner.dispatchEvent({ type: 'focusout', target: els[0] }); await flush();
  assert.equal(calls.length, 0); assert.equal(els[0].textContent, nodes[0].text);
  assert.equal(ctl.refs.manualState.hasAttribute('hidden'), true);
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
  test(`SCRP-F72 R2-#2 ${which} repeated tokens preserve the locked numeric-run multiset`, async () => {
    const { ctl, inner, els, nodes, edit, calls, flush } = await desk(which);
    nodes[0].text = '😀 delays 38%.'; nodes[0].locked.spans = [[10, 13]]; els[0].textContent = nodes[0].text;
    edit(els[0], '38% 😀 delays 38%.');
    inner.dispatchEvent({ type: 'dblclick', target: els[0] });
    els[0].textContent = '38% 😀 delays 40%.'; inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, '38% 😀 delays 40%.');
    // D27 allows movement, but losing the last identical run is refused.
    els[0].textContent = '40% 😀 delays 40%.'; inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, '38% 😀 delays 40%.');
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

test('SCRP-F79 R2-#10 zero-change blur and document navigation clear manual status', async () => {
  const t = await desk();
  t.edit(t.els[0], t.nodes[0].text);
  assert.equal(t.ctl.refs.manualState.hasAttribute('hidden'), true);
  // A saved outcome also belongs to its document, and disappears on switch.
  t.edit(t.els[0], 'Tracked operations.'); await t.flush();
  assert.equal(t.ctl.refs.manualState.hasAttribute('hidden'), false);
  t.ctl.setDoc('cover_letter'); await settle();
  assert.equal(t.ctl.refs.manualState.hasAttribute('hidden'), true);
  assert.equal(t.ctl.refs.manualState.textContent, ''); t.ctl.close();
});

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F80 R3-#1 F73 ${which} draft is adopted after reopening through the sibling row`, async () => {
    const { win, api, ctl, inner, els, nodes, edit, calls } = await desk(which);
    edit(els[0], 'Tracked operations.'); const opId = ctl.manual.drafts[nodes[0].id].opId;
    ctl.close('role-closed');
    const sibling = which === 'resume' ? 'cover_letter' : 'resume';
    const reopened = win.JB_SCRIBE_V2.open({ slug: 'acme-example', doc: sibling, api }); await settle();
    assert.equal(reopened.refs.unsaved.hasAttribute('hidden'), true);
    await reopened.setDoc(which); await settle();
    reopened.refs.frame.contentDocument = inner; reopened.refs.frame.onload(); await settle();
    assert.equal(reopened.manual.drafts[nodes[0].id]?.opId, opId);
    assert.equal(reopened.manual.base, 'r0'); assert.equal(els[0].textContent, 'Tracked operations.');
    assert.equal(reopened.refs.unsaved.hasAttribute('hidden'), false);
    assert.match(reopened.refs.unsaved.textContent, /You have unsaved text/); assert.equal(calls.length, 0);
    reopened.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' }); reopened.close();
  });
}

for (const which of ['resume', 'cover_letter']) test(`SCRP-F81 R3-#2 F42/F72 ${which} both locked figure edges are atomic`, async () => {
  const { ctl, inner, els, nodes, edit, calls, flush } = await desk(which);
  nodes[0].text = '😀 delays 38% through review.'; nodes[0].locked.spans = [[10, 13]]; els[0].textContent = nodes[0].text;
  inner.dispatchEvent({ type: 'dblclick', target: els[0] });
  for (const text of ['😀 delays 138% through review.', '😀 delays 38%5 through review.', '😀 delays 2.38% through review.', '😀 delays 38%.5 through review.', '😀 delays A38% through review.', '😀 delays 38%é through review.']) {
    els[0].textContent = text; inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, nodes[0].text, text); assert.match(ctl.refs.manualState.textContent, /Figures in this line are locked/);
  }
  inner.dispatchEvent({ type: 'focusout', target: els[0] }); await flush(); assert.equal(calls.length, 0);
  // D27 lets an identical prefix satisfy the base run; it cannot then be removed.
  edit(els[0], '38% 😀 delays 38% through review.');
  inner.dispatchEvent({ type: 'dblclick', target: els[0] });
  for (const text of ['38% 😀 delays 138% through review.', '38% 😀 delays 38%5 through review.']) {
    els[0].textContent = text; inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, text);
    els[0].textContent = text.replace('38% ', ''); inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, text, 'the last identical run remains protected');
  }
  inner.dispatchEvent({ type: 'focusout', target: els[0] });
  ctl.close(); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' });
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F83 R3-#4 ${which} adopted in-flight save refreshes the reopened desk`, async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const { win, api, ctl, inner, els, edit, flush, calls } = await desk(which, () => pending);
  edit(els[0], 'Tracked operations.'); await flush(); assert.equal(ctl.manual.saving, true);
  ctl.close('role-closed');
  const reopened = win.JB_SCRIBE_V2.open({ slug: 'acme-example', doc: which, api }); await settle();
  reopened.refs.frame.contentDocument = inner; reopened.refs.frame.onload(); await settle();
  assert.equal(reopened.manual, ctl.manual); assert.equal(reopened.refs.unsaved.hasAttribute('hidden'), false);
  api.listVersions = async () => ({ currentRunId: 'r1', versions: [{ runId: 'r1', n: 1 }, { runId: 'r0', n: 0 }] });
  finish({ run: { runId: 'r1', n: 1 } }); await settle(); await settle();
  assert.equal(reopened.refs.unsaved.hasAttribute('hidden'), true);
  assert.equal(reopened.state.currentRunId, 'r1'); assert.equal(reopened.state.latestRunId, 'r1');
  assert.equal(reopened.manual.saving, false); assert.equal(Object.keys(reopened.manual.drafts).length, 0);
  assert.match(reopened.refs.manualState.textContent, /Saved as v1/); assert.equal(calls.length, 1); reopened.close();
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F84 R3-#5 ${which} unchanged blur clears lock refusal and preserves pending decisions`, async () => {
  const { ctl, inner, els, nodes, calls, flush } = await desk(which);
  nodes[0].text = 'Reduced delays 38%.'; nodes[0].locked.spans = [[15, 18]]; els[0].textContent = nodes[0].text;
  inner.dispatchEvent({ type: 'dblclick', target: els[0] });
  els[0].textContent = 'Reduced delays 40%.'; inner.dispatchEvent({ type: 'input', target: els[0] });
  assert.equal(ctl.refs.manualState.getAttribute('data-state'), 'error');
  inner.dispatchEvent({ type: 'focusout', target: els[0] }); await flush();
  assert.equal(ctl.refs.manualState.hasAttribute('hidden'), true); assert.equal(calls.length, 0);
  for (const state of ['saving', 'confirm', 'conflict']) {
    inner.dispatchEvent({ type: 'dblclick', target: els[1] });
    ctl.refs.manualState.setAttribute('data-state', state);
    inner.dispatchEvent({ type: 'focusout', target: els[1] });
    assert.equal(ctl.refs.manualState.getAttribute('data-state'), state);
    assert.equal(ctl.refs.manualState.hasAttribute('hidden'), false);
  }
  ctl.close();
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F85 R3-#6 ${which} Save anyway explains the open-change gate and revokes consent`, async () => {
  const { ctl, els, edit, flush, calls } = await desk(which, () => { throw { code: 'unverified_confirmation_required' }; });
  edit(els[0], 'Led Example operations in 2025.'); await flush();
  const confirm = ctl.refs.manualState.querySelector('[data-manual="confirm"]');
  ctl.state.proposal = { ops: [] }; confirm.dispatchEvent({ type: 'click' }); await settle();
  assert.equal(ctl.refs.manualState.textContent, 'Review or discard the open changes first.Try again');
  assert.ok(ctl.refs.manualState.querySelector('[data-manual="retry"]'));
  assert.equal(ctl.manual.confirmation, null); assert.equal(calls.length, 1);
  ctl.state.proposal = null; confirm.dispatchEvent({ type: 'click' }); await settle(); assert.equal(calls.length, 1);
  ctl.close(); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' });
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F86 R3-#7 ${which} Stay and Escape rearm one manual save with visible status`, async () => {
  for (const choice of ['stay', 'escape', 'restored-escape']) {
    const t = await desk(which); t.edit(t.els[0], 'Tracked operations.'); let ctl = t.ctl;
    if (choice === 'restored-escape') {
      ctl.close('role-closed'); ctl = t.win.JB_SCRIBE_V2.open({ slug: 'acme-example', doc: which, api: t.api }); await settle();
      ctl.refs.frame.contentDocument = t.inner; ctl.refs.frame.onload(); await settle();
    } else ctl.setDoc(which === 'resume' ? 'cover_letter' : 'resume');
    if (choice === 'stay') ctl.refs.unsaved.querySelector('[data-unsaved="stay"]').dispatchEvent({ type: 'click' });
    else t.win.document.dispatchEvent({ type: 'keydown', key: 'Escape', target: t.win.document.activeElement });
    assert.equal(ctl.refs.unsaved.hasAttribute('hidden'), true); assert.equal(ctl.closed, false);
    assert.equal([...t.timers.values()].filter(timer => timer.ms === 2000).length, 1);
    assert.equal(ctl.refs.manualState.hasAttribute('hidden'), false); assert.match(ctl.refs.manualState.textContent, /[Ss]aves/);
    await t.flush(); assert.equal(t.calls.length, 1); ctl.close();
  }
});

for (const which of ['resume', 'cover_letter']) {
  test(`SCRP-F811 R3-#12 ${which} generic manual failure has one Try again`, async () => {
    const { ctl, els, edit, flush } = await desk(which, () => { throw new Error('fictional transport failure'); });
    edit(els[0], 'Tracked operations.'); await flush();
    assert.equal(ctl.refs.manualState.textContent, 'Not saved. Your text is kept.Try again');
    assert.ok(ctl.refs.manualState.querySelector('[data-manual="retry"]'));
    ctl.close(); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' });
  });
  test(`SCRP-F811 R3-#12 ${which} batch confirmation identifies possible novelty and quotes all replacements`, async () => {
    const { ctl, els, edit, flush } = await desk(which, () => { throw { code: 'unverified_confirmation_required' }; });
    edit(els[0], 'Tracked operations.'); edit(els[1], 'Led Example operations in 2025.'); await flush();
    assert.ok(ctl.refs.manualState.textContent.startsWith('Some of this text isn’t in your saved facts:'));
    assert.ok(ctl.refs.manualState.textContent.includes('“Tracked operations.”'));
    assert.ok(ctl.refs.manualState.textContent.includes('“Led Example operations in 2025.”'));
    ctl.close(); ctl.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' });
  });
}

// Selection offsets are UTF-16, matching the browser Range contract.
function caret(inner, el, start, end = start) {
  const range = { startContainer: el, endContainer: el, startOffset: start,
    toString: () => el.textContent.slice(start, end),
    cloneRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => el.textContent.slice(0, start) }) };
  inner.getSelection = () => ({ rangeCount: 1, isCollapsed: start === end, getRangeAt: () => range });
}

for (const which of ['resume', 'cover_letter']) test(`SCRP-F90 R4-#1 ${which} D27 validates full blocks for input, beforeinput and paste`, async () => {
  const cases = [
    ['Processed 38 shipments.', 'Processed 38% shipments.', 12, 12, '%'],
    ['Processed 38 shipments.', 'Processed $38 shipments.', 10, 10, '$'],
    ['Processed 38 shipments.', 'Processed %38 shipments.', 10, 10, '%'],
    ['Processed 38 shipments.', 'Processed 38$ shipments.', 12, 12, '$'],
    ['Processed 38 shipments.', 'Processed 38,000 shipments.', 12, 12, ',000'],
    ['Processed 38 shipments.', 'Processed ,00038 shipments.', 10, 10, ',000'],
    ['38 shipments.', '$38 shipments.', 0, 0, '$'],
    ['Processed 38', 'Processed 38%', 12, 12, '%'],
  ];
  for (const [base, after, start, end, data] of cases) {
    const t = await desk(which); const { ctl, inner, els, nodes } = t;
    nodes[0].text = base; const at = base.indexOf('38'); nodes[0].locked.spans = [[at, at + 2]]; els[0].textContent = base;
    inner.dispatchEvent({ type: 'dblclick', target: els[0] });
    caret(inner, els[0], start, end);
    const event = { type: 'beforeinput', target: els[0], inputType: data ? 'insertText' : 'deleteByCut', data };
    inner.dispatchEvent(event); assert.equal(event.defaultPrevented, true, after);
    if (data) {
      const paste = { type: 'paste', target: els[0], clipboardData: { getData: () => data } };
      inner.dispatchEvent(paste); assert.equal(els[0].textContent, base, after);
    }
    els[0].textContent = after; inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, base, after); assert.match(ctl.refs.manualState.textContent, /Figures in this line are locked/);
    assert.equal(Object.keys(ctl.manual.drafts).length, 0); ctl.close();
  }
  for (const edge of ['before', 'after']) {
    const { ctl, inner, els, nodes } = await desk(which);
    const base = 'Processed 38 shipments.'; const at = base.indexOf('38');
    nodes[0].text = base; nodes[0].locked.spans = [[at, at + 2]]; els[0].textContent = base;
    inner.dispatchEvent({ type: 'dblclick', target: els[0] });
    const staged = edge === 'after' ? base.replace('38', '38 ,000') : base.replace('38', ',000 38');
    els[0].textContent = staged; inner.dispatchEvent({ type: 'input', target: els[0] });
    // D28 now treats a single space between numeric components as part of the run.
    if (edge === 'before') {
      assert.equal(els[0].textContent, base, 'grouped numeric prefix is blocked before it can be joined');
      assert.match(ctl.refs.manualState.textContent, /Figures in this line are locked/);
      ctl.close('role-closed'); continue;
    }
    assert.equal(els[0].textContent, staged, 'a space before punctuation still separates the runs');
    const separator = edge === 'after' ? at + 2 : at + 4;
    caret(inner, els[0], separator + 1);
    const deletion = { type: 'beforeinput', target: els[0], inputType: 'deleteContentBackward', data: null };
    inner.dispatchEvent(deletion); assert.equal(deletion.defaultPrevented, true, edge);
    els[0].textContent = staged.slice(0, separator) + staged.slice(separator + 1);
    inner.dispatchEvent({ type: 'input', target: els[0] }); assert.equal(els[0].textContent, staged, edge);
    ctl.close('role-closed');
  }
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F94 R4-#5 ${which} shared-high-surrogate mutations compare whole locked neighbours`, async () => {
  for (const edge of ['before', 'after']) {
    const { ctl, inner, els, nodes } = await desk(which);
    const base = edge === 'before' ? 'Processed 🎉38% shipments.' : 'Processed 38%🎉 shipments.';
    const at = base.indexOf('38%'); nodes[0].text = base; nodes[0].locked.spans = [[at, at + 3]]; els[0].textContent = base;
    inner.dispatchEvent({ type: 'dblclick', target: els[0] });
    // IME/non-cancellable input uses the same full-block backstop.
    els[0].textContent = base.replace('🎉', '🄁'); inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, base, edge); assert.equal(Object.keys(ctl.manual.drafts).length, 0);
    const low = base.indexOf('🎉') + 1;
    assert.equal('🎉'[0], '🄁'[0], 'regression isolates a shared high surrogate');
    caret(inner, els[0], low, low + 1);
    const ev = { type: 'beforeinput', target: els[0], inputType: 'insertText', data: '🄁'[1] };
    inner.dispatchEvent(ev); assert.equal(ev.defaultPrevented, true, edge);
    const paste = { type: 'paste', target: els[0], clipboardData: { getData: () => '🄁'[1] } };
    inner.dispatchEvent(paste); assert.equal(els[0].textContent, base, edge);
    assert.match(ctl.refs.manualState.textContent, /Figures in this line are locked/); ctl.close();
  }
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F92 R4-#3 ${which} gated Stay retains retry and recovery rearms the unchanged CAS save`, async () => {
  for (const outcome of ['discard', 'other-tab-saved']) {
    const t = await desk(which, (_body, n) => { if (n === 1) throw { code: 'materials_pending', status: 409 }; return { run: { runId: 'r1', n: 1 } }; });
    const sibling = which === 'resume' ? 'cover_letter' : 'resume';
    let open = { proposalId: 'other-request', doc: sibling, baseRunId: 'r0', status: 'ready', ops: [{ opId: 'other', op: 'replace', node: sibling === 'resume' ? 'line:beta' : 'p:p3', text: 'Other wording.' }] };
    t.api.getOpenEdit = async () => ({ proposal: open });
    t.api.rejectEdit = async () => { open = null; };
    t.edit(t.els[0], 'Tracked operations.'); await t.flush();
    t.ctl.setDoc(sibling); t.ctl.refs.unsaved.querySelector('[data-unsaved="stay"]').dispatchEvent({ type: 'click' });
    await t.flush(); assert.equal(t.calls.length, 1);
    assert.ok(t.ctl.refs.manualState.querySelector('[data-manual="retry"]'), 'gated draft always has Try again');
    assert.match(t.ctl.refs.manualState.textContent, /Review or discard/);
    if (outcome === 'discard') {
      t.ctl.refs.recover.querySelector('[data-action="discard-request"]').dispatchEvent({ type: 'click' }); await settle(); await settle();
      assert.equal(t.ctl.openProposal, null); assert.doesNotMatch(t.ctl.refs.manualState.textContent, /Review or discard/);
      assert.equal([...t.timers.values()].filter(timer => timer.ms === 2000).length, 1);
      await t.flush();
    } else {
      open = null; t.ctl.refs.manualState.querySelector('[data-manual="retry"]').dispatchEvent({ type: 'click' }); await settle(); await settle();
    }
    assert.equal(t.calls.length, 2); assert.equal(t.calls[1].baseRunId, 'r0');
    assert.deepEqual(JSON.parse(JSON.stringify(t.calls[1].manualOps)), JSON.parse(JSON.stringify(t.calls[0].manualOps)));
    assert.equal(t.ctl.manual.saving, false); assert.equal(Object.keys(t.ctl.manual.drafts).length, 0);
    assert.match(t.ctl.refs.manualState.textContent, /Saved as v1/); t.ctl.close();
  }
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F93 R4-#4 ${which} adopted failures resolve conflict, confirmation and retry in the reopened controller`, async () => {
  for (const code of ['stale_base', 'unverified_confirmation_required', 'provider_failed', 'materials_pending', 'locked']) {
    let reject; const pending = new Promise((_resolve, fail) => { reject = fail; });
    const t = await desk(which, (_body, n) => n === 1 ? pending : { run: { runId: 'r1', n: 1 } });
    t.edit(t.els[0], 'Tracked operations.'); await t.flush();
    t.ctl.close('role-closed');
    const owner = t.win.JB_SCRIBE_V2.open({ slug: 'acme-example', doc: which, api: t.api }); await settle();
    owner.refs.frame.contentDocument = t.inner; owner.refs.frame.onload(); await settle();
    let reads = 0;
    t.api.getOpenEdit = async () => { reads++; return { proposal: { proposalId: 'other-request', doc: which === 'resume' ? 'cover_letter' : 'resume', baseRunId: 'r0', status: 'pending', ops: [] } }; };
    reject({ code, status: code === 'stale_base' || code === 'materials_pending' ? 409 : 400 }); await settle(); await settle();
    assert.equal(owner.manual.saving, false); assert.equal(owner.refs.unsaved.hasAttribute('hidden'), true, code);
    assert.equal(owner.manual.drafts[t.nodes[0].id].text, 'Tracked operations.'); assert.equal(owner.manual.base, 'r0');
    const action = code === 'stale_base' ? 'reapply' : code === 'unverified_confirmation_required' ? 'confirm' : code === 'locked' ? null : 'retry';
    assert.equal(owner.refs.manualState.getAttribute('data-state'), code === 'stale_base' ? 'conflict' : code === 'unverified_confirmation_required' ? 'confirm' : 'error');
    if (action) assert.ok(owner.refs.manualState.querySelector(`[data-manual="${action}"]`), code);
    else assert.match(owner.refs.manualState.textContent, /locked/);
    assert.equal(reads, code === 'materials_pending' ? 1 : 0);
    if (code === 'provider_failed' || code === 'unverified_confirmation_required') {
      owner.refs.manualState.querySelector(`[data-manual="${action}"]`).dispatchEvent({ type: 'click' }); await settle();
      assert.equal(t.calls.length, 2); assert.equal(t.calls[1].baseRunId, 'r0');
      assert.deepEqual(JSON.parse(JSON.stringify(t.calls[1].manualOps)), JSON.parse(JSON.stringify(t.calls[0].manualOps)));
      assert.deepEqual(JSON.parse(JSON.stringify(t.calls[1].confirmUnverified)), code === 'unverified_confirmation_required' ? [t.calls[0].manualOps[0].opId] : []);
      assert.equal(Object.keys(owner.manual.drafts).length, 0); owner.close();
    } else { owner.close(); owner.refs.unsaved.querySelector('[data-unsaved="discard"]').dispatchEvent({ type: 'click' }); }
  }
});


// D27: evaluate the entire replacement, with the server's plain-text normalization.
async function checkNumericRun(which, base, after, blocked, tokens = ['38'], channel = 'input') {
  const t = await desk(which); const { ctl, inner, els, nodes } = t;
  nodes[0].text = base;
  nodes[0].locked.spans = tokens.map((token, i) => {
    const start = base.indexOf(token, i ? base.indexOf(tokens[i - 1]) + tokens[i - 1].length : 0);
    return [start, start + token.length];
  });
  els[0].textContent = base; inner.dispatchEvent({ type: 'dblclick', target: els[0] });
  if (channel === 'beforeinput') {
    caret(inner, els[0], 0, base.length);
    const e = { type: 'beforeinput', target: els[0], inputType: 'insertText', data: after };
    inner.dispatchEvent(e); assert.equal(!!e.defaultPrevented, blocked, `${base} -> ${after}`);
  } else if (channel === 'paste') {
    const range = { startContainer: els[0], endContainer: els[0], startOffset: 0,
      toString: () => base, cloneRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => '' }),
      deleteContents() { els[0].textContent = ''; }, insertNode(n) { els[0].textContent = n.textContent; }, setStartAfter() {}, collapse() {} };
    inner.getSelection = () => ({ rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange() {} });
    inner.dispatchEvent({ type: 'paste', target: els[0], clipboardData: { getData: () => after } });
    assert.equal(els[0].textContent, blocked ? base : after, `${base} -> ${after}`);
  } else {
    els[0].textContent = after; inner.dispatchEvent({ type: 'input', target: els[0] });
    assert.equal(els[0].textContent, blocked ? base : after, `${base} -> ${after}`);
  }
  if (blocked) assert.match(ctl.refs.manualState.textContent, /Figures in this line are locked/);
  ctl.close('role-closed');
}

for (const which of ['resume', 'cover_letter']) for (const channel of ['beforeinput', 'input', 'paste']) {
  test(`SCRP-F101 R5-#1 ${which} ${channel} preserves atomic numeric runs and their multiplicity`, async () => {
    for (const [base, after, tokens] of [
      ['Reached 38.', 'Reached 38.5'], ['Reached .38.', 'Reached 1.38.'],
      ['Reached 38,', 'Reached 38,000,'], ['Processed 38 shipments.', 'Processed 38,000 shipments.'],
      ['Processed 38 shipments.', 'Processed 38% shipments.'], ['Processed 38 shipments.', 'Processed $38 shipments.'],
      ['Processed 38 shipments.', 'Processed 38𝟙 shipments.'], ['Processed 38 shipments.', 'Processed 𝟙38 shipments.'],
      ['Processed 38 then 38 more.', 'Processed 38 then 99 more.', ['38', '38']],
    ]) await checkNumericRun(which, base, after, true, tokens, channel);
    for (const [base, after, tokens] of [
      ['Reached 38.', 'Reached 38 today.'], ['Processed 38 shipments.', 'Processed (38) shipments.'], [' 38 shipments.', '38 shipments.'],
      ['Processed 38 then 38 more.', 'Processed 38 more, then 38.', ['38', '38']],
    ]) await checkNumericRun(which, base, after, false, tokens, channel);
  });


}

for (const which of ['resume', 'cover_letter']) for (const channel of ['beforeinput', 'input', 'paste']) {
  test(`SCRP-F103 R5-#3 ${which} ${channel} allows moving an identical locked numeric run`, async () => {
    await checkNumericRun(which, 'Cut delays 38% through weekly measurement.', 'Through weekly measurement, cut delays 38%.', false, ['38%'], channel);
  });
}

for (const which of ['resume', 'cover_letter']) test(`SCRP-F104 R5-#4 ${which} clearing a gate waits for an unanswered unsaved choice`, async () => {
  for (const choice of ['save', 'discard', 'stay']) {
    const t = await desk(which, (_body, n) => { if (n === 1) throw { code: 'materials_pending', status: 409 }; return { run: { runId: 'r1', n: 1 } }; });
    const sibling = which === 'resume' ? 'cover_letter' : 'resume';
    let open = { proposalId: 'other-request', doc: sibling, baseRunId: 'r0', status: 'ready', ops: [{ opId: 'other', op: 'replace', node: sibling === 'resume' ? 'line:beta' : 'p:p3', text: 'Other wording.' }] };
    t.api.getOpenEdit = async () => ({ proposal: open }); t.api.rejectEdit = async () => { open = null; };
    t.edit(t.els[0], 'Tracked operations.'); await t.flush(); t.ctl.setDoc(sibling);
    assert.equal(t.ctl.refs.unsaved.hasAttribute('hidden'), false);
    t.ctl.refs.recover.querySelector('[data-action="discard-request"]').dispatchEvent({ type: 'click' }); await settle(); await settle();
    assert.equal([...t.timers.values()].filter(timer => timer.ms === 2000).length, 0, 'an unanswered prompt never arms a save');
    assert.doesNotMatch(t.ctl.refs.manualState.textContent, /Review or discard|Saves in 2 seconds/);
    await t.flush(); assert.equal(t.calls.length, 1); assert.equal(Object.keys(t.ctl.manual.drafts).length, 1);
    assert.equal(t.ctl.refs.unsaved.hasAttribute('hidden'), false);
    t.ctl.refs.unsaved.querySelector(`[data-unsaved="${choice}"]`).dispatchEvent({ type: 'click' }); await settle(); await settle();
    if (choice === 'stay') { assert.equal(t.calls.length, 1); await t.flush(); }
    assert.equal(t.calls.length, choice === 'discard' ? 1 : 2);
    assert.equal(t.ctl.state.doc, choice === 'stay' ? which : sibling);
    if (choice !== 'discard') { assert.equal(t.calls[1].baseRunId, 'r0'); assert.deepEqual(JSON.parse(JSON.stringify(t.calls[1].manualOps)), JSON.parse(JSON.stringify(t.calls[0].manualOps))); }
    t.ctl.close();
  }
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F105 R5-#5 ${which} pending without recoverable changes keeps truthful retry copy`, async () => {
  for (const recovery of ['refused', 'missing-api', 'offline']) {
    const t = await desk(which, () => { throw { code: 'materials_pending', status: 409 }; });
    if (recovery !== 'missing-api') t.api.getOpenEdit = async () => { throw recovery === 'refused' ? { code: 'materials_pending', status: 409 } : new Error('offline'); };
    t.edit(t.els[0], 'Tracked operations.'); await t.flush(); await settle();
    assert.equal(t.ctl.refs.recover.hasAttribute('hidden'), true);
    assert.equal(t.ctl.refs.manualState.textContent, 'Not saved. Your text is kept.Try again');
    assert.ok(t.ctl.refs.manualState.querySelector('[data-manual="retry"]'));
    assert.equal([...t.timers.values()].filter(timer => timer.ms === 2000).length, 0);
    t.ctl.close('role-closed');
  }
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F106 R5-#6 ${which} pending retries stop after three automatic attempts and restart only explicitly`, async () => {
  const t = await desk(which, () => { throw { code: 'materials_pending', status: 409 }; });
  let reads = 0; t.api.getOpenEdit = async () => { reads++; return { proposal: null }; };
  t.edit(t.els[0], 'Tracked operations.'); await t.flush();
  for (let i = 0; i < 6; i++) await t.flush();
  assert.equal(t.calls.length, 4, 'initial POST plus at most three automatic retries');
  assert.equal(reads, 4); assert.equal([...t.timers.values()].filter(timer => timer.ms === 2000).length, 0);
  assert.equal(t.ctl.refs.manualState.textContent, 'Not saved. Your text is kept.Try again');
  assert.equal(t.ctl.manual.drafts[t.nodes[0].id].text, 'Tracked operations.');
  assert.ok(t.calls.every(body => body.baseRunId === 'r0'));
  assert.ok(t.calls.every(body => JSON.stringify(body.manualOps) === JSON.stringify(t.calls[0].manualOps)));
  t.ctl.refs.manualState.querySelector('[data-manual="retry"]').dispatchEvent({ type: 'click' }); await settle(); await settle();
  assert.equal(t.calls.length, 5);
  for (let i = 0; i < 6; i++) await t.flush();
  assert.equal(t.calls.length, 8); assert.equal(reads, 9, "Try again performs one explicit recovery read in addition to pending-error recovery"); assert.equal([...t.timers.values()].filter(timer => timer.ms === 2000).length, 0);
  t.ctl.close('role-closed');
});

for (const which of ['resume', 'cover_letter']) test(`SCRP-F106 R5-#6 ${which} a transient gate can save on the third automatic retry`, async () => {
  const t = await desk(which, (_body, n) => { if (n <= 3) throw { code: 'materials_pending', status: 409 }; return { run: { runId: 'r1', n: 1 } }; });
  t.api.getOpenEdit = async () => ({ proposal: null }); t.edit(t.els[0], 'Tracked operations.');
  for (let i = 0; i < 4; i++) await t.flush();
  assert.equal(t.calls.length, 4); assert.equal(Object.keys(t.ctl.manual.drafts).length, 0);
  assert.match(t.ctl.refs.manualState.textContent, /Saved as v1/); t.ctl.close();
});

for (const which of ['resume', 'cover_letter']) for (const channel of ['beforeinput', 'input', 'paste']) {
  test(`SCRP-F107 R5-#7 ${which} ${channel} normalizes markup beside a locked run on both sides`, async () => {
    for (const [base, after] of [
      ['Cut defects 38%* across teams.', 'Cut defects 38%* across all teams.'],
      ['Hit `38%` across teams.', 'Hit `38%` across all teams.'],
      ['Cut defects 38%*5 across teams.', 'Cut defects 38%*50 across teams.'],
    ]) await checkNumericRun(which, base, after, after.includes('*50'), ['38%'], channel);
  });
}

for (const which of ['resume', 'cover_letter']) for (const channel of ['beforeinput', 'input', 'paste']) {
  test(`SCRP-F110 R6-#1 ${which} ${channel} D28 blocks value-changing figure attachments`, async () => {
    for (const figure of ['.38', '-38', '- 38', '38 000', '38\u00a0000', '38\u202f000', '38 %', '38 ‰', '38–40', '38\u200b0', '38\u03010', '+38', '38/40', '38:40', '38×40', "38'000", '38^2']) {
      await checkNumericRun(which, 'Processed 38 shipments.', `Processed ${figure} shipments.`, true, ['38'], channel);
    }
    for (const [base, after] of [
      ['Reached 38.', 'Reached 38 today.'],
      ['Processed 38 shipments.', '38 shipments were processed.'],
      ['USD 38', 'USD 38 total'],
    ]) await checkNumericRun(which, base, after, false, ['38'], channel);
  });
}
