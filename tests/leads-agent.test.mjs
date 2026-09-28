import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { readRepoFile } from './oneflow-l0-harness.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
function load(fetchImpl, hostedToken = "") {
  const doc = { readyState: 'loading', addEventListener() {} };
  const win = {
    document: doc,
    JobBoredProfileApi: { profileUrl: (path) => `http://127.0.0.1:3847${path}` },
    JobBoredApp: { leadsCore: {
      countsFor: (rows) => ({ visible: rows.length, hidden: 0, byReason: {} }),
      facetCounts: () => ({ sources: { greenhouse: 2 } }),
      normalizeView: (view) => view || { lens: 'targets' },
    } },
    JobBoredLeads: { rows: () => [{ title: 'RevOps lead' }], profile: () => ({ hardConstraints: {} }) },
    fetch: fetchImpl,
    location: { href: 'http://127.0.0.1:8080/', origin: 'http://127.0.0.1:8080' },
    COMMAND_CENTER_CONFIG: hostedToken ? { jobBoredApiUrl: 'http://127.0.0.1:3847', jobBoredApiToken: hostedToken } : {},
  };
  const ctx = { window: win, fetch: fetchImpl, document: doc };
  vm.createContext(ctx);
  if (hostedToken) vm.runInContext(readRepoFile('hosted-api-auth.js'), ctx, { filename: 'hosted-api-auth.js' });
  vm.runInContext(readRepoFile('leads-tune.js'), ctx, { filename: 'leads-tune.js' });
  vm.runInContext(readRepoFile('leads-agent.js'), ctx, { filename: 'leads-agent.js' });
  return win;
}
const req = {
  message: 'Make it remote',
  settings: { targetRoles: ['RevOps'], targetSeniority: 'any', workMode: 'any', acceptableLocations: [], salaryFloor: null, salaryRequired: false, skipTitles: [], wants: [], avoids: [], companyBlocklist: [], keywordsInclude: [], keywordsExclude: [], sourcePreset: 'ats_only', groundedWebEnabled: false, maxLeadsPerRun: 15 },
  view: { lens: 'targets', fitMin: 0, matchMin: 0, salaryMin: 0, foundWithinDays: 0, sources: [], workModes: [], stages: [], companies: [] },
  counts: { visible: 1, hidden: 0, byReason: {} },
};

describe('Leads agent transport', () => {
  it('posts once, validates settings and view changes, and asks LC for counts without writing', async () => {
    const calls = [];
    const win = load(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, reply: 'Try remote leads.', changes: [
        { field: 'hardConstraints.workMode', op: 'set', value: 'remote_only' },
        { field: 'view.fit', op: 'set', value: 8, default: false },
        { field: 'tieBreakers.favoredCompanies', op: 'set', value: ['Acme'] },
      ] }) };
    });
    let counted = 0;
    win.JobBoredApp.leadsCore.countsFor = () => { counted++; return { visible: 1, hidden: 0, byReason: {} }; };
    assert.equal(win.JobBoredLeadsTune.resolveTransport(), win.JobBoredLeadsAgent);
    const out = await win.JobBoredLeadsAgent.propose(req);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:3847/api/leads/chat');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(out.ok, true);
    assert.deepEqual(plain(out.changes.map((c) => c.field)), ['hardConstraints.workMode', 'view.fitMin']);
    assert.ok(counted >= 1);
    assert.equal(JSON.stringify(req.settings).includes('remote_only'), false);
  });

  it('reports how many suggestions the allowlist dropped, so the card can say so', async () => {
    const win = load(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, reply: 'Try remote.', changes: [
      { field: 'hardConstraints.workMode', op: 'set', value: 'remote_only' },
      { field: 'tieBreakers.favoredCompanies', op: 'add', value: ['Acme'] },
      { field: 'experiences', op: 'set', value: [] },
    ] }) }));
    const out = await win.JobBoredLeadsAgent.propose(req);
    assert.equal(out.ok, true);
    assert.deepEqual(plain(out.changes.map((c) => c.field)), ['hardConstraints.workMode']);
    assert.equal(out.dropped, 2);

    const none = load(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, reply: 'Favouring Acme.', changes: [
      { field: 'tieBreakers.favoredCompanies', op: 'add', value: ['Acme'] },
    ] }) }));
    const all = await none.JobBoredLeadsAgent.propose(req);
    assert.deepEqual(plain(all.changes), []);
    assert.equal(all.dropped, 1, 'an all-dropped reply still reports its count');
  });

  it('counts a no-op as accepted, so a no-op plus a refusal is not told as all-refused', async () => {
    const win = load(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, reply: 'Keeping any work mode.', changes: [
      { field: 'hardConstraints.workMode', op: 'set', value: 'any' },
      { field: 'tieBreakers.favoredCompanies', op: 'add', value: ['Acme'] },
    ] }) }));
    const out = await win.JobBoredLeadsAgent.propose(req);
    assert.equal(out.ok, true);
    assert.deepEqual(plain(out.changes), [], 'the no-op makes no row');
    assert.equal(out.dropped, 1);
    assert.equal(out.accepted, 1, 'the no-op passed the allowlist');
  });

  it('uses hosted apiFetch so the configured API token reaches the provider route', async () => {
    const calls = [];
    const win = load(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, reply: 'Ready.', changes: [] }) };
    }, 'example-hosted-token');
    const out = await win.JobBoredLeadsAgent.propose(req);
    assert.equal(out.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer example-hosted-token');
    assert.equal(calls[0].init.headers['X-Api-Token'], 'example-hosted-token');
  });

  it('keeps the API error code and HTTP status', async () => {
    const win = load(async () => ({ ok: false, status: 429, json: async () => ({ error: 'Rate limited', code: 'http_429', retryable: true }) }));
    const out = await win.JobBoredLeadsAgent.propose(req);
    assert.equal(out.ok, false);
    assert.deepEqual(plain(out.error), { code: 'http_429', message: 'Rate limited', status: 429 });
  });

  it('rejects malformed model replies as a typed error', async () => {
    const win = load(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, changes: [] }) }));
    const out = await win.JobBoredLeadsAgent.propose(req);
    assert.equal(out.ok, false);
    assert.equal(out.error.code, 'invalid_reply');
  });
});
