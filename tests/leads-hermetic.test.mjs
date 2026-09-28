import assert from 'node:assert/strict';
import { it } from 'node:test';
import vm from 'node:vm';
import { DISPOSABLE_AUTH, installHermeticNetworkFence } from './e2e-fixtures/hermetic-harness.mjs';
import { readRepoFile } from './oneflow-l0-harness.mjs';

it('the configured API-origin Leads Chat request receives the hermetic error card response', async () => {
  let intercept;
  const page = { route: async (_pattern, handler) => { intercept = handler; } };
  const fence = await installHermeticNetworkFence(page, { baseUrl: 'http://127.0.0.1:49123' });
  let response;
  await intercept({
    request: () => ({ url: () => `${DISPOSABLE_AUTH.materialsOrigin}/api/leads/chat`, method: () => 'POST' }),
    fulfill: async (value) => { response = value; },
    abort: async () => { throw new Error('route unexpectedly aborted'); },
    continue: async () => { throw new Error('route unexpectedly continued'); },
  });
  assert.equal(response.status, 503);
  assert.equal(JSON.parse(response.body).code, 'agent_not_connected');
  assert.deepEqual(fence.unexpectedExternal, []);

  const win = {
    JobBoredProfileApi: { profileUrl: (path) => `${DISPOSABLE_AUTH.materialsOrigin}${path}` },
    JobBoredLeadsTune: { proposalRows: () => ({ rows: [], mask: [] }), countsProfile: () => ({}) },
    fetch: async (url, init) => {
      let reply;
      await intercept({
        request: () => ({ url: () => url, method: () => init.method }),
        fulfill: async (value) => { reply = value; },
        abort: async () => { throw new Error('route unexpectedly aborted'); },
        continue: async () => { throw new Error('route unexpectedly continued'); },
      });
      return { ok: reply.status < 400, status: reply.status, json: async () => JSON.parse(reply.body) };
    },
  };
  vm.runInNewContext(readRepoFile('leads-agent.js'), { window: win }, { filename: 'leads-agent.js' });
  const out = await win.JobBoredLeadsAgent.propose({ message: 'Show remote leads', settings: {}, view: {}, counts: null });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'agent_not_connected');
  assert.equal(out.error.status, 503);
});
