/* Leads Chat's read-only transport. leads-tune.js owns Apply and all writes. */
(function (root) {
  'use strict';

  function invalidReply() {
    return { ok: false, error: { code: 'invalid_reply', message: "The agent sent back something JobBored couldn't read" } };
  }

  function errorFrom(body, status) {
    var e = body && typeof body === 'object' ? body : {};
    return { ok: false, error: {
      code: typeof e.code === 'string' ? e.code : 'agent_error',
      message: typeof e.error === 'string' ? e.error : 'The agent did not answer.',
      status: status,
    } };
  }

  function countContext(request, tune, core) {
    var leads = root.JobBoredLeads;
    if (request.counts == null || !core || typeof core.countsFor !== 'function' || !leads || typeof leads.rows !== 'function') return null;
    try {
      var rows = leads.rows();
      var profile = tune.countsProfile(request.settings, leads.profile && leads.profile());
      var view = core.normalizeView(request.view);
      var roles = request.settings.targetRoles || [];
      var lenses = ['targets', 'all', 'other'].concat(roles);
      var byLens = Object.create(null);
      lenses.forEach(function (lens) {
        byLens[lens] = core.countsFor(rows, profile, Object.assign({}, view, { lens: lens }));
      });
      var facets = typeof core.facetCounts === 'function' ? core.facetCounts(rows, profile, view) : null;
      return { counts: core.countsFor(rows, profile, view), countsByLens: byLens, facets: facets };
    } catch (_) {
      return null;
    }
  }

  function validatedChanges(reply, request, tune) {
    var built = tune.proposalRows(reply.changes || [], request.settings, request.view);
    return built.rows.map(function (row, index) {
      var change = { field: row.kind === 'view' ? 'view.' + row.key : row.path, op: 'set', value: row.after };
      if (row.note) change.note = row.note;
      if (built.mask[index] === false) change['default'] = false;
      return change;
    });
  }

  async function propose(request) {
    var tune = root.JobBoredLeadsTune;
    var core = root.JobBoredApp && root.JobBoredApp.leadsCore;
    if (!tune || typeof tune.proposalRows !== 'function' || !request ||
        typeof request.message !== 'string' || !request.message.trim() ||
        !request.settings || !request.view) {
      return { ok: false, error: { code: 'invalid_request', message: 'The chat agent needs a message and the current Leads settings.' } };
    }
    var context = countContext(request, tune, core);
    var body = {
      message: request.message,
      settings: request.settings,
      view: request.view,
      counts: context ? context.counts : request.counts || null,
      countsByLens: context ? context.countsByLens : null,
      facets: context ? context.facets : null,
    };
    var url = root.JobBoredProfileApi && typeof root.JobBoredProfileApi.profileUrl === 'function'
      ? root.JobBoredProfileApi.profileUrl('/api/leads/chat') : '/api/leads/chat';
    var auth = root.JobBoredHostedApiAuth;
    var fetcher = auth && typeof auth.apiFetch === 'function' ? auth.apiFetch : root.fetch;
    var response;
    try {
      response = await fetcher.call(auth || root, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (_) {
      return { ok: false, error: { code: 'agent_error', message: 'The chat agent could not reach the local API.' } };
    }
    var reply;
    try { reply = await response.json(); } catch (_) { return invalidReply(); }
    if (!response.ok) return errorFrom(reply, response.status);
    if (!reply || reply.ok !== true || typeof reply.reply !== 'string' || !reply.reply.trim() ||
        (reply.changes !== undefined && !Array.isArray(reply.changes))) return invalidReply();
    try {
      return { ok: true, reply: reply.reply, changes: validatedChanges(reply, request, tune) };
    } catch (_) {
      return invalidReply();
    }
  }

  root.JobBoredLeadsAgent = { propose: propose };
})(typeof window !== 'undefined' ? window : globalThis);
